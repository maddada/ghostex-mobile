//
//  SSHConnection.swift
//  GhostexNative
//
//  Ported subset of VVTerm/Core/SSH/SSHClient.swift (the SSHSession actor).
//
//  Kept: socket connect (all resolved addresses), TCP tuning (TCP_NODELAY,
//  TCP keepalive, SO_NOSIGPIPE), libssh2 handshake with fast cipher/MAC
//  preferences, SHA256 host-key pinning through KnownHostsManager, password +
//  keyboard-interactive + publickey auth, non-blocking IO loop with adaptive
//  batching for shell channels, exec channels (now with stderr + exit status),
//  PTY shell channel with resize, SCP upload with exec (`cat >`) fallback.
//
//  Pruned: mosh, Cloudflare, Tailscale connection modes (a tailnet IP is plain
//  SSH), SFTP directory browsing, remote-files APIs, tmux bootstrap helpers.
//

import Foundation
import os.log
import libssh2
import Tailcatbridge

// MARK: - libssh2 Runtime

/// libssh2 has process-global lifecycle (`libssh2_init`/`libssh2_exit`).
/// Initialize once and keep alive for the app lifetime.
enum LibSSH2Runtime {
    private static let lock = NSLock()
    private static var initialized = false

    static func ensureInitialized() throws {
        lock.lock()
        defer { lock.unlock() }
        guard !initialized else { return }
        let rc = libssh2_init(0)
        guard rc == 0 else {
            throw SSHError.unknown("libssh2_init failed: \(rc)")
        }
        initialized = true
    }
}

// MARK: - Public value types

struct SSHCredentials: Sendable {
    var password: String?
    var privateKey: String?
    var passphrase: String?
    /// Tailscale SSH: offer only the "none" method and let the tailnet policy decide.
    var noneAuthOnly: Bool = false
}

struct SSHConnectionConfig: Sendable {
    /// Identifies the machine this connection belongs to; also keys its tailcat forward.
    var machineId: String
    var host: String
    var port: Int
    var username: String
    var credentials: SSHCredentials
    /// Bounds the TCP connect and every blocking libssh2 call (handshake, login, opening a shell).
    var connectionTimeout: TimeInterval = 20
    /// Probe an idle connection with TCP keep-alives, so a dead link is noticed.
    var keepAliveEnabled: Bool = true
    /// Idle seconds before the first TCP keep-alive; clamped to 10...120 when enabled.
    var keepAliveIntervalSec: Int = 30
    /// tailcat peer token. Non-empty means dial the tailcat loopback forward for
    /// `machineId` instead of `host`:`port`. Host-key identity stays `host`:`port`.
    var tailcatToken: String = ""
    /// When above 0, bounds only the TCP connect (below `connectionTimeout`): a Tailscale computer that
    /// also has Easy Connect gives Tailscale a short head start before trying Easy Connect.
    var dialTimeout: TimeInterval = 0
}

struct SSHExecResult: Sendable {
    let stdout: String
    let stderr: String
    let exitCode: Int
    /// The signal that ended the command (`KILL`, `TERM`…); its `exitCode` is then 128 + the signal's number.
    var exitSignal: String? = nil
}

struct ShellHandle {
    let id: UUID
    let stream: AsyncStream<Data>
}

enum SSHUploadStrategy: Sendable {
    case automatic
    case execPreferred
}

// MARK: - SSH Error

enum SSHError: LocalizedError {
    case notConnected
    case connectionFailed(String)
    case connectionRefused(String)
    case authenticationFailed
    case timeout
    case channelOpenFailed
    case shellRequestFailed
    case hostKeyVerificationFailed
    case sftpFailed(String)
    case socketError(String)
    /// direct-tcpip open rejected with SSH_OPEN_CONNECT_FAILED: nothing is bound there.
    case portForwardNotListening(Int)
    /// direct-tcpip open rejected with SSH_OPEN_ADMINISTRATIVELY_PROHIBITED.
    case portForwardingProhibited
    /// startPortForward was asked for a number that is not a TCP port.
    case portOutOfRange(Int)
    /// A channel open that libssh2 gave up on after its own read timeout; carries libssh2's text.
    case openTimedOut(String)
    /// Every command slot is held, some by commands whose channels the computer has not closed yet.
    case busy(closing: Int, stuck: Int)
    case unknown(String)

    var errorDescription: String? {
        switch self {
        case .notConnected: return "Not connected to server"
        case .connectionFailed(let msg): return "Connection failed: \(msg)"
        case .connectionRefused(let msg): return "Connection refused: \(msg)"
        case .authenticationFailed: return "Authentication failed"
        case .timeout: return "Connection timed out"
        case .channelOpenFailed: return "Failed to open channel"
        case .shellRequestFailed: return "Failed to request shell"
        case .hostKeyVerificationFailed:
            return "Host key verification failed. The saved SSH host fingerprint does not match the server's current key."
        case .sftpFailed(let msg): return "Upload failed: \(msg)"
        case .socketError(let msg): return "Socket error: \(msg)"
        // The machine id is an internal identifier and stays in the log lines; the user
        // already knows which machine they asked to forward from.
        case .portForwardNotListening(let port):
            return "Nothing is listening on port \(port) on the remote machine."
        case .portForwardingProhibited:
            return "The remote SSH server does not allow port forwarding (AllowTcpForwarding)."
        // Same wording and same contract code as the Android transport.
        case .portOutOfRange(let port):
            return "Port \(port) is outside the valid TCP port range."
        case .openTimedOut(let detail):
            return detail.isEmpty ? "Opening a channel timed out" : "Opening a channel timed out: \(detail)"
        // "stuck=" is read by the phone's JavaScript (the count of closes the computer never answered).
        case .busy(let closing, let stuck):
            return "Ghostex is still busy with other requests to this computer (\(closing) closing, stuck=\(stuck))."
        case .unknown(let msg): return "Unknown error: \(msg)"
        }
    }
}

// MARK: - Atomic Socket for Thread-Safe Abort

/// Thread-safe socket storage that allows closing from any thread
final class AtomicSocket: @unchecked Sendable {
    private nonisolated(unsafe) var _socket: Int32 = -1
    private let lock = NSLock()

    nonisolated init() {}

    nonisolated var socket: Int32 {
        get {
            lock.lock()
            defer { lock.unlock() }
            return _socket
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            _socket = newValue
        }
    }

    /// Close the socket immediately from any thread
    nonisolated func closeImmediately() {
        lock.lock()
        let sock = _socket
        _socket = -1
        lock.unlock()

        if sock >= 0 {
            Darwin.close(sock)
        }
    }
}

// MARK: - Keyboard Interactive Auth Helper

// C callback for keyboard-interactive authentication
nonisolated(unsafe) private let kbdintCallback: @convention(c) (
    UnsafePointer<CChar>?,  // name
    Int32,                   // name_len
    UnsafePointer<CChar>?,  // instruction
    Int32,                   // instruction_len
    Int32,                   // num_prompts
    UnsafePointer<LIBSSH2_USERAUTH_KBDINT_PROMPT>?,  // prompts
    UnsafeMutablePointer<LIBSSH2_USERAUTH_KBDINT_RESPONSE>?,  // responses
    UnsafeMutablePointer<UnsafeMutableRawPointer?>?  // abstract
) -> Void = { name, nameLen, instruction, instructionLen, numPrompts, prompts, responses, abstract in
    guard numPrompts > 0, let responses = responses, let password = SSHSessionContext.from(abstract)?.password() else {
        return
    }

    // For each prompt, provide the password
    for i in 0..<Int(numPrompts) {
        let passwordData = password.utf8CString
        let length = passwordData.count - 1  // exclude null terminator

        // Allocate memory for response (libssh2 will free it)
        let responseBuf = UnsafeMutablePointer<CChar>.allocate(capacity: length + 1)
        passwordData.withUnsafeBufferPointer { buffer in
            guard let baseAddress = buffer.baseAddress else { return }
            responseBuf.initialize(from: baseAddress, count: length)
        }
        responseBuf[length] = 0

        responses[i].text = responseBuf
        responses[i].length = UInt32(length)
    }
}

// MARK: - SSH Connection (one per machineId)

actor SSHConnection {
    private final class ExecRequest {
        let id: UUID
        let command: String
        let continuation: CheckedContinuation<SSHExecResult, Error>
        var channel: OpaquePointer?
        var output = Data()
        var stderr = Data()
        var isStarted = false
        /// The command's stdin, written once it starts and then closed with EOF. Nil leaves
        /// stdin open, which is what a plain `exec` has always done.
        let input: [UInt8]?
        var inputOffset = 0
        var sentInputEOF = false
        /// The caller's promise settles exactly once: with the result, an error, or at its own deadline.
        private(set) var settled = false

        init(id: UUID, command: String, input: [UInt8]?, continuation: CheckedContinuation<SSHExecResult, Error>) {
            self.id = id
            self.command = command
            self.input = input
            self.continuation = continuation
        }

        func settle(_ result: Result<SSHExecResult, Error>) {
            guard !settled else { return }
            settled = true
            continuation.resume(with: result)
        }
    }

    private final class ShellChannelState {
        let id: UUID
        var channel: OpaquePointer
        let continuation: AsyncStream<Data>.Continuation
        var batchBuffer = Data()
        var lastYieldTime: UInt64 = DispatchTime.now().uptimeNanoseconds
        var recentBytesPerRead: Int = 0

        init(id: UUID, channel: OpaquePointer, continuation: AsyncStream<Data>.Continuation) {
            self.id = id
            self.channel = channel
            self.continuation = continuation
        }
    }

    let config: SSHConnectionConfig
    /// Non-private so the port-forward extension in SSHPortForward.swift can open channels.
    var libssh2Session: OpaquePointer?
    private var shellChannels: [UUID: ShellChannelState] = [:]
    private var socket: Int32 = -1
    private var isActive = false
    /**
     * Set when libssh2 reports a socket-level failure (the OS tears TCP down
     * while the app is suspended). Without it a dead connection keeps
     * reporting isConnected == true and every reconnect path no-ops.
     */
    private var transportDead = false
    private var ioTask: Task<Void, Never>?
    private var livenessTask: Task<Void, Never>?
    /// The liveness check's view of the computer: the last time a byte arrived, and its unanswered keep-alive.
    private var lastInboundAt = Date()
    private var lastInboundEvidence = 0
    private var keepAliveSentAt: Date?
    /// When an idle connection was last serviced (`startServiceOpen`).
    private var lastServiceAt: Date?
    private var execRequests: [UUID: ExecRequest] = [:]
    /// Commands whose output ended and whose result waits for the computer's CLOSE (exit status comes before it).
    private var closingExecRequests: [UUID: ExecRequest] = [:]
    /// Told once when this connection's transport dies on its own (not on `disconnect`).
    private var onTransportDead: (@Sendable (String) -> Void)?

    /// Local port forwards owned by this connection, keyed by remote port.
    var portForwards: [Int: PortForwardListener] = [:]

    /// Every accepted forward connection's direct-tcpip channel, serviced by `ioLoop`.
    var forwardChannels: [UUID: PortForwardChannel] = [:]

    /**
     * Channels whose close is still being driven (forwards, commands, terminals, uploads). A non-blocking
     * `libssh2_channel_close` answers EAGAIN until the remote's CHANNEL_CLOSE arrives, so `ioLoop` finishes them
     * (see `drainClosingChannels`); dropping the pointer at the first EAGAIN would leak the channel for the life of
     * the session.
     */
    var closingChannels: [ClosingChannel] = []

    /// Opens whose caller stopped waiting; they keep the channel-open claim until libssh2 settles them
    /// (SSHChannelOpens.swift).
    var abandonedOpens: [AbandonedChannelOpen] = []

    /// Bumped when the session is freed: an operation that suspended checks it before touching its pointers again.
    private(set) var sessionGeneration = 0

    /**
     * Bumped by every teardown. `startPortForward` suspends twice (the probe and
     * the listener), and a stop or a disconnect that lands in between must not
     * be undone by the start publishing its listener afterwards.
     */
    var portForwardTeardownGeneration = 0

    /**
     * libssh2 keeps channel-open state on the SESSION, not on the channel, so two opens
     * that overlap across a suspension point clobber each other. Every opener claims this
     * token first and holds it until its open finishes — including across the EAGAIN
     * retries a non-blocking open needs.
     */
    private(set) var channelOpenClaim: UUID?

    let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "app.ghostex.mobile",
        category: "SSHConnection"
    )

    /// Atomic socket storage for emergency abort from any thread
    private let atomicSocket = AtomicSocket()

    /// libssh2's session abstract: the keyboard-interactive password and the send queue (SSHSendQueue.swift).
    private let sessionContext = SSHSessionContext()

    /// Every byte libssh2 sends goes through this queue (SSHSendQueue.swift).
    nonisolated var sendQueue: SSHSendQueue { sessionContext.sendQueue }

    /// Track if cleanup has been performed
    private var hasBeenCleaned = false

    init(config: SSHConnectionConfig) {
        self.config = config
    }

    var isConnected: Bool {
        isActive && !transportDead && libssh2Session != nil && sendQueue.failureReason == nil
    }

    /// The transport is gone, or the send queue failed and the connection has not noticed yet.
    var transportDeadOrFailing: Bool {
        transportDead || sendQueue.failureReason != nil
    }

    func setTransportDeadHandler(_ handler: @escaping @Sendable (String) -> Void) {
        onTransportDead = handler
    }

    /// Flag the whole connection dead on socket-level libssh2 errors so
    /// callers (ensureConnected / reopen flows) actually reconnect.
    func noteTransportError(_ code: Int) {
        // LIBSSH2_ERROR_TIMEOUT only comes from a blocking call that ran past the session
        // timeout set in `connect`: the transport stopped answering.
        guard code == Int(LIBSSH2_ERROR_SOCKET_SEND) || code == Int(LIBSSH2_ERROR_SOCKET_RECV)
            || code == Int(LIBSSH2_ERROR_SOCKET_DISCONNECT)
            || code == Int(LIBSSH2_ERROR_SOCKET_TIMEOUT)
            || code == Int(LIBSSH2_ERROR_TIMEOUT) else {
            return
        }
        // A send queue that failed inside libssh2's callback knows the real cause; libssh2 only saw a send error.
        markTransportDead(sendQueue.failureReason ?? "libssh2 error \(code)")
    }

    /**
     * The transport is gone (a socket error, a send queue that failed, a TCP keep-alive that went unanswered). Every
     * operation settles once, after the libssh2 call that found it returned, and JS hears it as `disconnected` so its
     * recovery runs (the iPhone used to mark the connection dead without saying so).
     */
    func markTransportDead(_ why: String) {
        guard !transportDead else { return }
        transportDead = true
        logger.error("transport \(self.config.machineId, privacy: .public) dead: \(why, privacy: .public)")
        sendQueue.fail(why)
        /*
         * Forwards dial through this session. With the transport gone every
         * socket the loopback listeners accept would be dropped without a byte,
         * so they come down with it — `listPortForwards` promises never to name
         * a forward whose channels can no longer be opened.
         */
        closeAllPortForwards()
        failAllExecRequests(error: SSHError.socketError("The connection to the computer was lost."))
        for id in Array(shellChannels.keys) {
            closeShellInternal(id)
        }
        if isActive {
            onTransportDead?(why)
        }
    }

    /// Picks up a send queue that failed inside libssh2's callback (it can only shut the socket down there).
    func noteSendQueueFailure() {
        if let reason = sendQueue.failureReason, !transportDead {
            markTransportDead(reason)
        }
    }

    /// Immediately abort the connection by closing the socket (any thread).
    nonisolated func abort() {
        sessionContext.sendQueue.detach("the connection was aborted")
        atomicSocket.closeImmediately()
    }

    // MARK: - Channel-open serialization

    /// True once `owner` holds the session's channel-open state (already holding it counts).
    func claimChannelOpen(_ owner: UUID) -> Bool {
        guard let current = channelOpenClaim else {
            channelOpenClaim = owner
            return true
        }
        return current == owner
    }

    func releaseChannelOpen(_ owner: UUID) {
        if channelOpenClaim == owner {
            channelOpenClaim = nil
        }
    }

    /// Wait until a fresh opener owns the session's channel-open state; the caller releases it.
    func awaitChannelOpenClaim() async throws -> UUID {
        let owner = UUID()
        while !claimChannelOpen(owner) {
            try Task.checkCancellation()
            try await Task.sleep(nanoseconds: Self.channelOpenClaimPollNanoseconds)
        }
        return owner
    }

    /**
     * As above, but giving up after `timeout` seconds. Openers that a user is
     * waiting on take this one, so a stuck opener ahead of them surfaces as a
     * timeout instead of an unbounded wait.
     */
    func awaitChannelOpenClaim(timeout: TimeInterval) async throws -> UUID {
        let owner = UUID()
        let deadline = Date().addingTimeInterval(timeout)
        while !claimChannelOpen(owner) {
            try Task.checkCancellation()
            if Date() >= deadline { throw SSHError.timeout }
            try await Task.sleep(nanoseconds: Self.channelOpenClaimPollNanoseconds)
        }
        return owner
    }

    /// Wait until this opener owns the session's channel-open state, then run `body`.
    func withChannelOpenClaim<T>(_ body: () async throws -> T) async throws -> T {
        let owner = try await awaitChannelOpenClaim()
        defer { releaseChannelOpen(owner) }
        return try await body()
    }

    /// Cadence for waiting on the channel-open claim (2ms).
    private static let channelOpenClaimPollNanoseconds: UInt64 = 2_000_000

    // MARK: - Connection

    func connect() async throws {
        try Task.checkCancellation()
        try LibSSH2Runtime.ensureInitialized()
        socket = -1

        // Resolve host
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        hints.ai_protocol = IPPROTO_TCP
        var result: UnsafeMutablePointer<addrinfo>?

        // Plain SSH resolves the configured host; tailcat resolves the loopback
        // forward for this machine. Host-key pinning below stays on config.host.
        let (dialHost, dialPort) = try resolveDialTarget()
        let portString = String(dialPort)
        let resolveResult = getaddrinfo(dialHost, portString, &hints, &result)
        guard resolveResult == 0, let addrInfo = result else {
            throw SSHError.connectionFailed("Failed to resolve host: \(dialHost)")
        }
        defer { freeaddrinfo(result) }

        // Connect socket (try all resolved addresses so IPv6-only hosts work)
        var lastConnectError: Int32 = 0
        var candidate: UnsafeMutablePointer<addrinfo>? = addrInfo
        let socketConnectStartedAt = Date()
        logger.info(
            "connect \(self.config.machineId, privacy: .public) -> \(dialHost, privacy: .public):\(dialPort)"
        )

        while let current = candidate {
            try Task.checkCancellation()
            let family = current.pointee.ai_family
            let sockType = current.pointee.ai_socktype == 0 ? SOCK_STREAM : current.pointee.ai_socktype
            let protocolNumber = current.pointee.ai_protocol

            let candidateSocket = Darwin.socket(family, sockType, protocolNumber)
            if candidateSocket < 0 {
                lastConnectError = errno
                candidate = current.pointee.ai_next
                continue
            }
            let dialSeconds =
                config.dialTimeout > 0 ? min(config.dialTimeout, config.connectionTimeout) : config.connectionTimeout
            var connectTimeoutSeconds = Int32(max(1, dialSeconds))
            setsockopt(
                candidateSocket, IPPROTO_TCP, TCP_CONNECTIONTIMEOUT,
                &connectTimeoutSeconds, socklen_t(MemoryLayout<Int32>.size)
            )

            let connectResult = Darwin.connect(candidateSocket, current.pointee.ai_addr, current.pointee.ai_addrlen)
            if connectResult == 0 {
                socket = candidateSocket
                break
            }

            lastConnectError = errno
            Darwin.close(candidateSocket)
            candidate = current.pointee.ai_next
        }

        guard socket >= 0 else {
            let message = lastConnectError == 0 ? "Unknown connect failure" : String(cString: strerror(lastConnectError))
            logger.error(
                "connect \(self.config.machineId, privacy: .public) socket failed: \(message, privacy: .public)"
            )
            if lastConnectError == ECONNREFUSED {
                throw SSHError.connectionRefused(message)
            }
            if lastConnectError == ETIMEDOUT {
                throw SSHError.timeout
            }
            throw SSHError.connectionFailed(message)
        }
        logger.info(
            "connect \(self.config.machineId, privacy: .public) socket up in \(Int(Date().timeIntervalSince(socketConnectStartedAt) * 1000))ms"
        )

        // Disable Nagle's algorithm for low-latency interactive typing
        var noDelay: Int32 = 1
        setsockopt(socket, IPPROTO_TCP, TCP_NODELAY, &noDelay, socklen_t(MemoryLayout<Int32>.size))

        /*
         * CDXC:RemoteMachines 2026-11-13 WHY: the send buffer is left to the system. The 8 KB cap made partly sent
         * packets routine, and libssh2 1.11.0 lost the packet after each one (SSHSendQueue.swift); with the send
         * queue the cap only slowed every upload and forward.
         */
        var recvBufSize: Int32 = 65536
        setsockopt(socket, SOL_SOCKET, SO_RCVBUF, &recvBufSize, socklen_t(MemoryLayout<Int32>.size))
        #if GHOSTEX_SSH_HARNESS
        if Self.harnessSendBufferCap > 0 {
            var cap = Self.harnessSendBufferCap
            setsockopt(socket, SOL_SOCKET, SO_SNDBUF, &cap, socklen_t(MemoryLayout<Int32>.size))
        }
        #endif

        /*
         * CDXC:RemoteMachines 2026-11-13 WHY: TCP keep-alives find a dead direct link (first probe after the
         * configured idle time, 30 s by default, then every 10 s, 3 unanswered = dead). They see only the first hop,
         * so an Easy Connect tunnel (a loopback socket here) or unacknowledged data needs the SSH-level check in
         * `checkLiveness` too.
         */
        if config.keepAliveEnabled {
            var on: Int32 = 1
            var idle = Int32(keepAliveIntervalSeconds)
            var interval: Int32 = 10
            var count: Int32 = 3
            setsockopt(socket, SOL_SOCKET, SO_KEEPALIVE, &on, socklen_t(MemoryLayout<Int32>.size))
            setsockopt(socket, IPPROTO_TCP, TCP_KEEPALIVE, &idle, socklen_t(MemoryLayout<Int32>.size))
            setsockopt(socket, IPPROTO_TCP, TCP_KEEPINTVL, &interval, socklen_t(MemoryLayout<Int32>.size))
            setsockopt(socket, IPPROTO_TCP, TCP_KEEPCNT, &count, socklen_t(MemoryLayout<Int32>.size))
        }

        // Prevent SIGPIPE on broken connections
        var noSigPipe: Int32 = 1
        setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))

        // Store in atomic storage for emergency abort
        atomicSocket.socket = socket

        // Create libssh2 session (use _ex variant since macros not available in Swift)
        let sessionAbstract = Unmanaged.passUnretained(sessionContext).toOpaque()
        libssh2Session = libssh2_session_init_ex(nil, nil, nil, sessionAbstract)
        guard let session = libssh2Session else {
            Darwin.close(socket)
            throw SSHError.unknown("Failed to create libssh2 session")
        }
        // Before the handshake: the banner is libssh2's first send (SSHSendQueue.swift).
        sendQueue.attach(socket: socket, blockingTimeout: config.connectionTimeout)
        _ = libssh2_session_callback_set(
            session, LIBSSH2_CALLBACK_SEND, unsafeBitCast(sshQueuedSendCallback, to: UnsafeMutableRawPointer.self)
        )
        _ = libssh2_session_callback_set(
            session, LIBSSH2_CALLBACK_RECV, unsafeBitCast(sshCountingRecvCallback, to: UnsafeMutableRawPointer.self)
        )

        // Prefer fast ciphers - AES-GCM and ChaCha20 are hardware-accelerated on Apple Silicon
        let fastCiphers = "aes128-gcm@openssh.com,aes256-gcm@openssh.com,chacha20-poly1305@openssh.com,aes128-ctr,aes256-ctr"
        libssh2_session_method_pref(session, LIBSSH2_METHOD_CRYPT_CS, fastCiphers)
        libssh2_session_method_pref(session, LIBSSH2_METHOD_CRYPT_SC, fastCiphers)

        // Prefer fast MACs
        let fastMACs = "hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,hmac-sha2-256,hmac-sha2-512"
        libssh2_session_method_pref(session, LIBSSH2_METHOD_MAC_CS, fastMACs)
        libssh2_session_method_pref(session, LIBSSH2_METHOD_MAC_SC, fastMACs)

        /**
         * CDXC:RemoteMachines 2026-10-16 WHY:
         * libssh2's blocking calls wait forever by default, and they run inside this actor. A
         * socket that iOS left half-dead while the app was suspended, or an Easy Connect tunnel
         * that accepts the loopback dial and then stalls, kept `startShell` or the handshake
         * waiting with the actor held, so the foreground probe, its exec watchdog and even
         * `disconnect` queued behind it: the phone stayed disconnected until it was
         * force-quit. Every blocking call now gives up after
         * `connectionTimeout`, and a timed-out call marks the transport dead
         * (`noteTransportError`) so the reconnect path replaces it.
         */
        libssh2_session_set_timeout(session, Int(config.connectionTimeout * 1000))

        // Set blocking mode for handshake
        setSessionBlocking(session, true)

        // Perform SSH handshake
        try Task.checkCancellation()
        let handshakeResult = libssh2_session_handshake(session, socket)
        guard handshakeResult == 0 else {
            cleanup()
            // A tunnel dial that fails once the loopback socket is accepted can only reach
            // libssh2 as a socket error; the bridge kept the cause, so report that.
            if let tunnelFailure = tailcatDialFailure() {
                logger.error(
                    "handshake \(self.config.machineId, privacy: .public) failed inside the tailcat tunnel: \(tunnelFailure, privacy: .public)"
                )
                throw SSHError.connectionFailed(
                    "tailcat could not reach the paired machine: \(tunnelFailure)"
                )
            }
            logger.error(
                "handshake \(self.config.machineId, privacy: .public) failed: \(handshakeResult)"
            )
            if handshakeResult == LIBSSH2_ERROR_TIMEOUT {
                throw SSHError.timeout
            }
            if handshakeResult == LIBSSH2_ERROR_SOCKET_RECV
                || handshakeResult == LIBSSH2_ERROR_SOCKET_SEND
                || handshakeResult == LIBSSH2_ERROR_SOCKET_DISCONNECT {
                throw SSHError.connectionRefused(
                    "the SSH server closed the connection (connection reset). The machine was "
                        + "reached, but its SSH server dropped the TCP connection."
                )
            }
            throw SSHError.connectionFailed("SSH handshake failed: \(handshakeResult)")
        }

        do {
            try verifyHostKey()
        } catch {
            cleanup()
            throw error
        }

        // Authenticate
        try Task.checkCancellation()
        do {
            try authenticate()
        } catch {
            cleanup()
            throw error
        }

        // Set non-blocking for I/O
        setSessionBlocking(session, false)
        // Sent only by the liveness check, after a silence, through the send queue (`checkLiveness`).
        if config.keepAliveEnabled {
            libssh2_keepalive_config(session, 1, UInt32(keepAliveIntervalSeconds))
        }

        isActive = true
        transportDead = false
        startLivenessLoop()
        logger.info("SSH session established")
    }

    #if GHOSTEX_SSH_HARNESS
    /// Harness only: puts the old 8 KB send-buffer cap back to prove the queue does not depend on it.
    nonisolated(unsafe) static var harnessSendBufferCap: Int32 = 0
    /// Harness only: a shorter bound on a forward's channel open.
    nonisolated(unsafe) static var harnessDirectOpenTimeout: TimeInterval = 0
    /// Harness only: idle connections are not serviced (to let unread bytes pile up).
    nonisolated(unsafe) static var harnessNoIdleService = false
    /// Harness only: a shorter bound on an abandoned open.
    nonisolated(unsafe) static var harnessAbandonedOpenLimit: TimeInterval = 0
    #endif

    /// libssh2's blocking mode, mirrored to the send queue, which drains itself in blocking sections.
    func setSessionBlocking(_ session: OpaquePointer, _ blocking: Bool) {
        libssh2_session_set_blocking(session, blocking ? 1 : 0)
        sendQueue.setBlocking(blocking)
    }

    /// tailcat forwards listen on loopback only; the tunnel itself carries the traffic.
    private static let tailcatLoopbackHost = "127.0.0.1"

    /**
     * Where the TCP connection actually goes. A tailcat machine dials the loopback
     * port of the forward the bridge keeps for `config.machineId`; starting it is
     * idempotent, so a reconnect reuses the already-established tunnel after the
     * bridge has probed it, and gets a rebuilt one when it no longer answers (the
     * tunnel does not survive iOS suspending the app). The first call per machine,
     * and a rebuild, perform the peer rendezvous and block for seconds —
     * acceptable here because `connect()` already blocks the actor on the socket
     * connect and the libssh2 handshake.
     */
    private func resolveDialTarget() throws -> (String, Int) {
        let token = config.tailcatToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return (config.host, config.port) }

        var localPort = 0
        var bridgeError: NSError?
        let startedAt = Date()
        logger.info(
            "tailcat startForward \(self.config.machineId, privacy: .public) remotePort=\(self.config.port) tokenLength=\(token.count)"
        )
        let started = TailcatbridgeStartForward(
            config.machineId,
            token,
            config.port,
            &localPort,
            &bridgeError
        )
        let elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1000)
        guard started, localPort > 0 else {
            let detail = bridgeError?.localizedDescription ?? "the bridge returned no local port"
            logger.error(
                "tailcat startForward \(self.config.machineId, privacy: .public) failed after \(elapsedMs)ms: \(detail, privacy: .public)"
            )
            // The machine id is an internal identifier: it stays in the log lines above,
            // never in text the app shows, where the user already knows which machine
            // they are connecting to.
            throw SSHError.connectionFailed(
                "tailcat could not reach the paired machine. Check that the remote's tailcat "
                    + "sidecar is enabled and that its token is current. (\(detail))"
            )
        }
        logger.info(
            "tailcat forward for \(self.config.machineId, privacy: .public) listening on port \(localPort) after \(elapsedMs)ms"
        )
        return (Self.tailcatLoopbackHost, localPort)
    }

    /// The tunnel's own last dial failure for this machine, or nil when there is none.
    /// A dial that fails once the loopback socket is already accepted can only reach
    /// libssh2 as a reset, so the bridge keeps the real cause for exactly this read.
    private func tailcatDialFailure() -> String? {
        guard !config.tailcatToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        let detail = TailcatbridgeLastError(config.machineId)
        return detail.isEmpty ? nil : detail
    }

    private func authenticate() throws {
        guard let session = libssh2Session else {
            throw SSHError.notConnected
        }

        let username = config.username
        var authResult: Int32 = -1

        // Query supported auth methods
        let authList = libssh2_userauth_list(session, username, UInt32(username.utf8.count))
        if let authListPtr = authList {
            let methods = String(cString: authListPtr)
            logger.info("Server auth methods: \(methods)")
        }

        // If authList is nil, check if already authenticated ("none" accepted)
        if authList == nil, libssh2_userauth_authenticated(session) != 0 {
            logger.info("Already authenticated")
            return
        }

        if config.credentials.noneAuthOnly {
            // libssh2_userauth_list already attempted the "none" method; the server declined it.
            logger.error("Server did not accept \"none\" authentication for user: \(username)")
            throw SSHError.authenticationFailed
        }

        if let keyString = config.credentials.privateKey, !keyString.isEmpty {
            // Public key auth from in-memory key material
            // NUL-terminated: libssh2's key parsing reads past the given length looking for one (AddressSanitizer
            // caught a heap over-read in sign_frommemory with the unterminated buffer).
            let keyBytes = keyString.utf8CString
            let passphrase = config.credentials.passphrase
            logger.info("Attempting publickey auth for user: \(username)")

            authResult = keyBytes.withUnsafeBufferPointer { buffer -> Int32 in
                guard let baseAddress = buffer.baseAddress else {
                    return LIBSSH2_ERROR_ALLOC
                }

                return libssh2_userauth_publickey_frommemory(
                    session,
                    username,
                    Int(username.utf8.count),
                    nil,
                    0,
                    baseAddress,
                    keyBytes.count - 1,
                    passphrase
                )
            }
        } else if let password = config.credentials.password {
            logger.info("Attempting password auth for user: \(username)")

            authResult = libssh2_userauth_password_ex(
                session,
                username,
                UInt32(username.utf8.count),
                password,
                UInt32(password.utf8.count),
                nil
            )

            // If password auth fails, try keyboard-interactive as fallback
            if authResult != 0 {
                logger.info("Password auth failed, trying keyboard-interactive...")

                sessionContext.setPassword(password)
                defer { sessionContext.setPassword(nil) }

                authResult = libssh2_userauth_keyboard_interactive_ex(
                    session,
                    username,
                    UInt32(username.utf8.count),
                    kbdintCallback
                )
            }
        } else {
            logger.error("No credentials provided")
            throw SSHError.authenticationFailed
        }

        if authResult != 0 {
            var errmsg: UnsafeMutablePointer<CChar>?
            var errmsgLen: Int32 = 0
            libssh2_session_last_error(session, &errmsg, &errmsgLen, 0)
            let errorMsg = errmsg != nil ? String(cString: errmsg!) : "Unknown error"
            logger.error("Auth failed (\(authResult)): \(errorMsg)")
            // A login that never got an answer is a dead connection, not a wrong credential:
            // reporting it as an auth failure would stop every automatic retry.
            if authResult == LIBSSH2_ERROR_TIMEOUT { throw SSHError.timeout }
            if authResult == LIBSSH2_ERROR_SOCKET_SEND || authResult == LIBSSH2_ERROR_SOCKET_RECV
                || authResult == LIBSSH2_ERROR_SOCKET_DISCONNECT {
                throw SSHError.connectionFailed("The connection dropped while logging in.")
            }
            throw SSHError.authenticationFailed
        }

        logger.info("Authentication successful")
    }

    private func verifyHostKey() throws {
        guard let session = libssh2Session else {
            throw SSHError.notConnected
        }

        let (fingerprint, keyType) = try hostKeyFingerprint(for: session)
        let host = config.host
        let port = config.port

        if let entry = KnownHostsManager.shared.entry(for: host, port: port) {
            if entry.fingerprint != fingerprint {
                logger.error("Host key mismatch for \(host):\(port). Known: \(entry.fingerprint), Presented: \(fingerprint)")
                throw SSHError.hostKeyVerificationFailed
            }
            KnownHostsManager.shared.updateSeen(host: host, port: port)
            logger.info("Host key verified for \(host):\(port)")
            return
        }

        let entry = KnownHostsManager.Entry(
            host: host,
            port: port,
            fingerprint: fingerprint,
            keyType: keyType,
            addedAt: Date(),
            lastSeenAt: Date()
        )
        KnownHostsManager.shared.save(entry: entry)
        logger.info("Trusted new host key for \(host):\(port) (\(fingerprint))")
    }

    private func hostKeyFingerprint(for session: OpaquePointer) throws -> (String, Int) {
        guard let hashPtr = libssh2_hostkey_hash(session, Int32(LIBSSH2_HOSTKEY_HASH_SHA256)) else {
            throw SSHError.hostKeyVerificationFailed
        }

        let hash = Data(bytes: hashPtr, count: 32)
        let base64 = hash.base64EncodedString().trimmingCharacters(in: CharacterSet(charactersIn: "="))
        let fingerprint = "SHA256:\(base64)"

        var keyLen: size_t = 0
        var keyType: Int32 = 0
        _ = libssh2_session_hostkey(session, &keyLen, &keyType)

        return (fingerprint, Int(keyType))
    }

    func disconnect() async {
        // Mark as inactive first to stop any pending operations
        isActive = false

        stopLivenessLoop()

        // Finish shell streams first to unblock any waiting consumers
        closeAllShellChannels()

        // Forwards dial through this session, so they die with it: listPortForwards must
        // never report a forward whose channels can no longer be opened.
        closeAllPortForwards()

        // Cancel IO task
        ioTask?.cancel()
        ioTask = nil

        // Fail any pending exec requests
        failAllExecRequests(error: SSHError.notConnected)

        // Close socket first to abort any blocking I/O in libssh2
        sendQueue.detach("the connection was closed")
        atomicSocket.closeImmediately()
        socket = -1

        // Now cleanup libssh2 resources (won't block since socket is closed)
        cleanupLibssh2()

        logger.info("Disconnected")
    }

    private func cleanupLibssh2() {
        guard !hasBeenCleaned else { return }
        hasBeenCleaned = true

        closeAllShellChannels()
        closeAllExecChannels()
        closeAllPortForwards()
        // libssh2_session_free below frees whatever channels the session still
        // owns, so a close that never finished draining is released with it.
        closingChannels.removeAll()
        abandonedOpens.removeAll()
        channelOpenClaim = nil
        // The socket is closed already (`detach` above): what is still queued can never be sent.
        sendQueue.detach("the connection was closed")

        if let session = libssh2Session {
            libssh2_session_disconnect_ex(session, 11, "Normal shutdown", "")
            libssh2_session_free(session)
            libssh2Session = nil
            sessionGeneration += 1
        }
    }

    private func cleanup() {
        stopLivenessLoop()
        sendQueue.detach("the connection was closed")
        atomicSocket.closeImmediately()
        socket = -1
        cleanupLibssh2()
    }

    // MARK: - Shell

    func startShell(
        cols: Int,
        rows: Int,
        terminalType: String = "xterm-256color",
        startupCommand: String? = nil
    ) async throws -> ShellHandle {
        let generation = sessionGeneration
        guard libssh2Session != nil else {
            throw SSHError.notConnected
        }

        // Claim the session's channel-open state BEFORE switching to blocking mode, so a
        // non-blocking exec/forward open parked on EAGAIN cannot have its state taken over
        // here, and so the io loop never runs while the session is blocking.
        let opener = try await awaitChannelOpenClaim(timeout: config.connectionTimeout)
        defer { releaseChannelOpen(opener) }
        // The wait for the claim can outlive the session (a disconnect frees it).
        let session = try liveSession(since: generation)

        // Set blocking for channel setup. The send queue drains itself while blocking, earlier bytes first
        // (forward data queued before this), so libssh2's wait for each reply never waits on unsent bytes.
        setSessionBlocking(session, true)
        defer {
            setSessionBlocking(session, false)
            noteSendQueueFailure()
        }

        // Open channel (use _ex variant since macros not available in Swift)
        guard let channel = libssh2_channel_open_ex(
            session,
            "session",
            UInt32("session".utf8.count),
            2 * 1024 * 1024,  // window size
            32768,             // packet size
            nil,
            0
        ) else {
            let lastError = libssh2_session_last_errno(session)
            noteTransportError(Int(lastError))
            if lastError == LIBSSH2_ERROR_TIMEOUT { throw SSHError.openTimedOut(Self.lastErrorText(session)) }
            throw SSHError.channelOpenFailed
        }

        // Advertise 24-bit color support; many servers gate env forwarding via
        // AcceptEnv, so ignore rejections.
        let envVars: [(String, String)] = [("COLORTERM", "truecolor")]
        for (name, value) in envVars {
            let result = libssh2_channel_setenv_ex(
                channel,
                name,
                UInt32(name.utf8.count),
                value,
                UInt32(value.utf8.count)
            )
            if result != 0 {
                logger.debug("Remote SSH server rejected env \(name, privacy: .public): \(result)")
            }
        }

        // Request PTY
        let ptyResult = libssh2_channel_request_pty_ex(
            channel,
            terminalType,
            UInt32(terminalType.utf8.count),
            nil,
            0,
            Int32(cols),
            Int32(rows),
            0,
            0
        )
        guard ptyResult == 0 else {
            noteTransportError(Int(ptyResult))
            retireChannel(channel)
            throw SSHError.shellRequestFailed
        }

        if let command = startupCommand, !command.isEmpty {
            let commandLength = UInt32(command.utf8.count)
            let execResult: Int32 = command.withCString { ptr in
                libssh2_channel_process_startup(channel, "exec", 4, ptr, commandLength)
            }
            guard execResult == 0 else {
                noteTransportError(Int(execResult))
                retireChannel(channel)
                throw SSHError.shellRequestFailed
            }
        } else {
            let shellResult = libssh2_channel_process_startup(channel, "shell", 5, nil, 0)
            guard shellResult == 0 else {
                noteTransportError(Int(shellResult))
                retireChannel(channel)
                throw SSHError.shellRequestFailed
            }
        }

        logger.info("Shell started (\(cols)x\(rows))")

        let shellId = UUID()
        let stream = AsyncStream<Data> { continuation in
            let state = ShellChannelState(id: shellId, channel: channel, continuation: continuation)
            self.shellChannels[shellId] = state

            continuation.onTermination = { [weak self] _ in
                Task { [weak self] in
                    await self?.closeShell(shellId)
                }
            }
        }

        // Start IO loop
        startIOLoop()

        return ShellHandle(id: shellId, stream: stream)
    }

    func startIOLoop() {
        guard ioTask == nil else { return }
        ioTask = Task { [weak self] in
            await self?.ioLoop()
        }
    }

    private func stopIOLoop() {
        ioTask?.cancel()
        ioTask = nil
    }

    private func ioLoop() async {
        var buffer = [CChar](repeating: 0, count: 32768)
        let batchThreshold = 65536  // 64KB batch threshold

        // Adaptive batch delay: interactive (keystrokes) vs bulk (output) modes
        let interactiveDelay: UInt64 = 1_000_000   // 1ms
        let bulkDelay: UInt64 = 5_000_000          // 5ms
        let interactiveThreshold = 100             // bytes - below this is interactive
        let bulkThreshold = 1000                   // bytes - above this is bulk

        while !Task.isCancelled, libssh2Session != nil {
            // Queued bytes go out before anything is read (SSHSendQueue.swift).
            var didWork = flushSendQueue()

            if !shellChannels.isEmpty {
                let states = Array(shellChannels.values)
                for state in states {
                    // An earlier channel's failure can have closed this one (`markTransportDead`).
                    guard shellChannels[state.id] != nil else { continue }
                    // stream_id 0 = stdout
                    let bytesRead = libssh2_channel_read_ex(state.channel, 0, &buffer, buffer.count)

                    if bytesRead > 0 {
                        let readCount = Int(bytesRead)
                        state.batchBuffer.append(Data(bytes: buffer, count: readCount))
                        didWork = true

                        // Exponential moving average (alpha = 0.3)
                        state.recentBytesPerRead = (state.recentBytesPerRead * 7 + readCount * 3) / 10

                        let maxBatchDelay: UInt64
                        if state.recentBytesPerRead < interactiveThreshold {
                            maxBatchDelay = interactiveDelay
                        } else if state.recentBytesPerRead > bulkThreshold {
                            maxBatchDelay = bulkDelay
                        } else {
                            let ratio = UInt64(state.recentBytesPerRead - interactiveThreshold) * 100 / UInt64(bulkThreshold - interactiveThreshold)
                            maxBatchDelay = interactiveDelay + (bulkDelay - interactiveDelay) * ratio / 100
                        }

                        let now = DispatchTime.now().uptimeNanoseconds
                        let timeSinceYield = now - state.lastYieldTime

                        if state.batchBuffer.count >= batchThreshold || timeSinceYield >= maxBatchDelay {
                            state.continuation.yield(state.batchBuffer)
                            state.batchBuffer = Data()
                            state.lastYieldTime = now
                        }
                    } else if bytesRead == Int(LIBSSH2_ERROR_EAGAIN) {
                        // Flush any pending data before waiting
                        if !state.batchBuffer.isEmpty {
                            state.continuation.yield(state.batchBuffer)
                            state.batchBuffer = Data()
                            state.lastYieldTime = DispatchTime.now().uptimeNanoseconds
                        }
                        state.recentBytesPerRead = 0
                    } else if bytesRead < 0 {
                        if !state.batchBuffer.isEmpty {
                            state.continuation.yield(state.batchBuffer)
                        }
                        logger.error("Read error: \(bytesRead)")
                        noteTransportError(bytesRead)
                        closeShellInternal(state.id)
                        continue
                    }

                    // Check for EOF
                    if libssh2_channel_eof(state.channel) != 0 {
                        if !state.batchBuffer.isEmpty {
                            state.continuation.yield(state.batchBuffer)
                        }
                        logger.info("Channel EOF")
                        closeShellInternal(state.id)
                        didWork = true
                    }
                }
            }

            if !execRequests.isEmpty {
                let requestIds = Array(execRequests.keys)
                for requestId in requestIds {
                    guard let request = execRequests[requestId] else { continue }
                    guard ensureExecChannelReady(request) else { continue }

                    guard let execChannel = request.channel else { continue }
                    guard pumpExecInput(request, channel: execChannel, didWork: &didWork) else { continue }

                    let bytesRead = libssh2_channel_read_ex(execChannel, 0, &buffer, buffer.count)
                    if bytesRead > 0 {
                        request.output.append(Data(bytes: buffer, count: Int(bytesRead)))
                        didWork = true
                    } else if bytesRead == Int(LIBSSH2_ERROR_EAGAIN) {
                        // No data yet
                    } else if bytesRead < 0 {
                        noteTransportError(bytesRead)
                        finishExecRequest(requestId, error: SSHError.socketError("Exec read failed: \(bytesRead)"))
                        continue
                    }

                    let stderrRead = libssh2_channel_read_ex(execChannel, 1, &buffer, buffer.count)
                    if stderrRead > 0 {
                        request.stderr.append(Data(bytes: buffer, count: Int(stderrRead)))
                        didWork = true
                    } else if stderrRead == Int(LIBSSH2_ERROR_EAGAIN) {
                        // No stderr data yet
                    } else if stderrRead < 0 {
                        noteTransportError(stderrRead)
                        finishExecRequest(requestId, error: SSHError.socketError("Exec stderr read failed: \(stderrRead)"))
                        continue
                    }

                    if let currentChannel = request.channel, libssh2_channel_eof(currentChannel) != 0 {
                        finishExecRequest(requestId, error: nil)
                        didWork = true
                    }
                }
            }

            if pumpPortForwardChannels() {
                didWork = true
            }
            if driveAbandonedOpens() {
                didWork = true
            }

            noteSendQueueFailure()

            // Channels still being closed keep the loop alive: nothing else
            // drives their EAGAIN retries. So do queued bytes.
            if shellChannels.isEmpty, execRequests.isEmpty, forwardChannels.isEmpty,
                closingChannels.isEmpty, abandonedOpens.isEmpty, sendQueue.pendingBytes == 0 {
                break
            }

            if !didWork {
                await waitForSocket()
            }

            // Always yield to prevent starving other tasks
            await Task.yield()
        }

        closeAllShellChannels()
        stopIOLoop()
    }

    func closeShell(_ shellId: UUID) async {
        closeShellInternal(shellId)
    }

    private func closeShellInternal(_ shellId: UUID) {
        guard let state = shellChannels.removeValue(forKey: shellId) else { return }
        if !state.batchBuffer.isEmpty {
            state.continuation.yield(state.batchBuffer)
        }
        // Driven to completion by the io loop like a forward channel's close: a channel dropped mid-close stays
        // open on the computer for the life of the connection and counts against its MaxSessions.
        retireChannel(state.channel)
        state.continuation.finish()
    }

    private func closeAllShellChannels() {
        let states = shellChannels
        shellChannels.removeAll()
        for state in states.values {
            if !state.batchBuffer.isEmpty {
                state.continuation.yield(state.batchBuffer)
            }
            libssh2_channel_close(state.channel)
            libssh2_channel_free(state.channel)
            state.continuation.finish()
        }
    }

    private func closeAllExecChannels() {
        failAllExecRequests(error: SSHError.notConnected)
    }

    private func failAllExecRequests(error: Error) {
        let requests = execRequests
        execRequests.removeAll()
        for request in requests.values {
            releaseChannelOpen(request.id)
            if let channel = request.channel {
                libssh2_channel_close(channel)
                libssh2_channel_free(channel)
                request.channel = nil
            }
            request.settle(.failure(error))
        }
        // Their channels stay in `closingChannels`, which the session's free releases.
        let closing = closingExecRequests
        closingExecRequests.removeAll()
        for request in closing.values {
            request.settle(.failure(error))
        }
    }

    private func ensureExecChannelReady(_ request: ExecRequest) -> Bool {
        guard let session = libssh2Session else {
            finishExecRequest(request.id, error: SSHError.notConnected)
            return false
        }

        if request.channel == nil {
            // Another opener owns the session's channel-open state; retry on a later pass.
            guard claimChannelOpen(request.id) else { return false }
            let newChannel = Self.openSessionChannel(session)
            if let newChannel = newChannel {
                request.channel = newChannel
                releaseChannelOpen(request.id)
            } else {
                let lastError = libssh2_session_last_errno(session)
                if lastError == LIBSSH2_ERROR_EAGAIN {
                    // The open is mid-flight; keep the claim until it settles.
                    return false
                }
                releaseChannelOpen(request.id)
                // libssh2 waited its 60 s read timeout for the computer's answer: a timeout, not a refusal.
                let error: SSHError = lastError == LIBSSH2_ERROR_TIMEOUT
                    ? .openTimedOut(Self.lastErrorText(session)) : .channelOpenFailed
                finishExecRequest(request.id, error: error)
                return false
            }
        }

        if !request.isStarted, let execChannel = request.channel {
            let execResult = libssh2_channel_process_startup(
                execChannel,
                "exec",
                4,
                request.command,
                UInt32(request.command.utf8.count)
            )
            if execResult == Int32(LIBSSH2_ERROR_EAGAIN) {
                return false
            }
            if execResult != 0 {
                finishExecRequest(request.id, error: SSHError.unknown("Exec failed: \(execResult)"))
                return false
            }
            request.isStarted = true
        }

        return true
    }

    /**
     * Write as much of a started request's stdin as the channel takes, then send EOF.
     * Runs on every loop pass next to the reads, so a command that answers while it is
     * still being fed can never fill its window and stall the write. False when a write
     * failure finished the request.
     */
    private func pumpExecInput(_ request: ExecRequest, channel: OpaquePointer, didWork: inout Bool) -> Bool {
        guard let input = request.input, !request.sentInputEOF else { return true }

        while request.inputOffset < input.count {
            // The send queue is full: the next pass writes more (SSHSendQueue.swift).
            if sendQueue.pendingBytes > SSHSendQueue.backpressureBytes { return true }
            let written = input.withUnsafeBufferPointer { buffer -> Int in
                guard let baseAddress = buffer.baseAddress else { return 0 }
                let pointer = UnsafeRawPointer(baseAddress.advanced(by: request.inputOffset))
                    .assumingMemoryBound(to: CChar.self)
                return Int(libssh2_channel_write_ex(channel, 0, pointer, input.count - request.inputOffset))
            }
            if written > 0 {
                request.inputOffset += written
                didWork = true
            } else if written == 0 || written == Int(LIBSSH2_ERROR_EAGAIN) {
                return true
            } else {
                noteTransportError(written)
                finishExecRequest(request.id, error: SSHError.socketError("Exec stdin write failed: \(written)"))
                return false
            }
        }

        let eofResult = libssh2_channel_send_eof(channel)
        if eofResult == 0 {
            request.sentInputEOF = true
            didWork = true
        } else if eofResult != Int32(LIBSSH2_ERROR_EAGAIN) {
            noteTransportError(Int(eofResult))
            finishExecRequest(request.id, error: SSHError.socketError("Exec stdin EOF failed: \(eofResult)"))
            return false
        }
        return true
    }

    /// The caller's deadline or cancellation: it settles now, while its channel keeps closing in the closing queue.
    private func cancelExecRequest(_ requestId: UUID, error: Error) {
        if execRequests[requestId] != nil {
            finishExecRequest(requestId, error: error)
        } else if let request = closingExecRequests.removeValue(forKey: requestId) {
            request.settle(.failure(error))
        }
    }

    /**
     * CDXC:RemoteMachines 2026-11-13 WHY:
     * A command's channel is closed through the closing queue, never dropped mid-close: a dropped channel stayed open
     * on the computer for the life of the connection, and with OpenSSH's 10 per connection a few of them made it
     * refuse new terminals and commands. The caller's promise and the cleanup are separate: the promise settles once,
     * with the result or at the caller's own deadline, and the queue owns the close (EOF, CLOSE, the computer's CLOSE,
     * free) for as long as it takes. The exit status is read only once the computer's CLOSE arrived (it sends
     * exit-status or exit-signal before it), never right after EOF: libssh2 1.11.0 starts it at 0 and has no "status
     * received" flag, so a command whose deadline passed reports E_TIMEOUT, an exit-signal reports a failure, and only
     * a command closed without either still reads 0.
     */
    private func finishExecRequest(_ requestId: UUID, error: Error?) {
        guard let request = execRequests.removeValue(forKey: requestId) else { return }
        if request.channel == nil, channelOpenClaim == requestId {
            // Its open is still in flight on the session: it is finished without running the command, and keeps the
            // claim and the slot until then (SSHChannelOpens.swift).
            abandonOpen(AbandonedChannelOpen(owner: requestId, holdsCommandSlot: true, what: "a command") { session in
                Self.openSessionChannel(session)
            })
        } else {
            releaseChannelOpen(requestId)
        }
        let channel = request.channel
        request.channel = nil

        if let error {
            request.settle(.failure(error))
            if let channel { retireChannel(channel, holdsCommandSlot: true) }
            return
        }
        guard let channel else {
            request.settle(.failure(SSHError.channelOpenFailed))
            return
        }
        closingExecRequests[requestId] = request
        retireChannel(channel, holdsCommandSlot: true, execRequestId: requestId)
    }

    /// The computer's CLOSE for a finished command arrived (or the close failed): its result is known now.
    func completeClosedExec(_ requestId: UUID, channel: OpaquePointer, closedCleanly: Bool) {
        guard let request = closingExecRequests.removeValue(forKey: requestId) else { return }
        guard closedCleanly else {
            request.settle(.failure(SSHError.socketError("The connection dropped before the command finished.")))
            return
        }
        let stdout = String(data: request.output, encoding: .utf8) ?? ""
        let stderr = String(data: request.stderr, encoding: .utf8) ?? ""
        if let signal = exitSignal(of: channel) {
            let exitCode = Self.exitCode(forSignal: signal)
            request.settle(
                .success(SSHExecResult(stdout: stdout, stderr: stderr, exitCode: exitCode, exitSignal: signal))
            )
            return
        }
        let exitCode = libssh2_channel_get_exit_status(channel)
        request.settle(.success(SSHExecResult(stdout: stdout, stderr: stderr, exitCode: Int(exitCode))))
    }

    private func exitSignal(of channel: OpaquePointer) -> String? {
        var name: UnsafeMutablePointer<CChar>?
        var length = 0
        guard libssh2_channel_get_exit_signal(channel, &name, &length, nil, nil, nil, nil) == 0, let name else {
            return nil
        }
        defer { libssh2_free(libssh2Session, name) }
        return length > 0 ? String(cString: name) : nil
    }

    /// 128 + the signal's number, as a shell reports it; 255 for a signal without a portable number.
    static func exitCode(forSignal signal: String) -> Int {
        let numbers = ["HUP": 1, "INT": 2, "QUIT": 3, "ILL": 4, "ABRT": 6, "FPE": 8, "KILL": 9, "SEGV": 11, "PIPE": 13,
                       "ALRM": 14, "TERM": 15]
        return numbers[signal].map { 128 + $0 } ?? 255
    }

    /// A command channel's open, the same call every time (an abandoned one is resumed with it).
    static func openSessionChannel(_ session: OpaquePointer) -> OpaquePointer? {
        libssh2_channel_open_ex(session, "session", UInt32("session".utf8.count), 2 * 1024 * 1024, 32768, nil, 0)
    }

    static func lastErrorText(_ session: OpaquePointer) -> String {
        var message: UnsafeMutablePointer<CChar>?
        var length: Int32 = 0
        libssh2_session_last_error(session, &message, &length, 0)
        return message.map { String(cString: $0) } ?? ""
    }

    func waitForSocket() async {
        guard let session = libssh2Session, socket >= 0 else { return }
        flushSendQueue()

        let direction = libssh2_session_block_directions(session)
        let queued = sendQueue.pendingBytes > 0
        guard direction != 0 || queued else { return }

        var pfd = pollfd()
        pfd.fd = socket
        pfd.events = 0

        if direction & LIBSSH2_SESSION_BLOCK_INBOUND != 0 {
            pfd.events |= Int16(POLLIN)
        }
        // libssh2 itself never waits to send (the queue takes every byte); the queue does.
        if direction & LIBSSH2_SESSION_BLOCK_OUTBOUND != 0 || queued {
            pfd.events |= Int16(POLLOUT)
        }

        // Poll with 5ms timeout - short enough for responsiveness,
        // long enough to avoid busy spinning
        _ = poll(&pfd, 1, 5)
        flushSendQueue()
        // A real suspension point: a terminal write waiting on a full window, or an upload, used to loop here without
        // ever giving the actor up, so every other terminal, command and the io loop waited behind it. Callers check
        // their session and channel again after this (`liveSession`, `write`).
        await Task.yield()
    }

    /// Hands queued bytes to the socket now; true when it moved some. A queue that failed ends the transport.
    @discardableResult
    func flushSendQueue() -> Bool {
        let moved = sendQueue.flush()
        noteSendQueueFailure()
        return moved
    }

    /// After a write outside the io loop: what the socket did not take at once is sent by the loop.
    private func kickSendQueue() {
        flushSendQueue()
        if sendQueue.pendingBytes > 0 { startIOLoop() }
    }

    // MARK: - Write

    func write(_ data: Data, to shellId: UUID) async throws {
        guard let state = shellChannels[shellId] else {
            throw SSHError.notConnected
        }

        // Copy data to array for async-safe access
        var bytes = [UInt8](data)
        var remaining = bytes.count
        var offset = 0

        defer { kickSendQueue() }
        while remaining > 0 {
            // Every wait below can end the transport (`waitForSocket` flushes the queue, whose failure retires and
            // frees this terminal's channel) or let a disconnect run: the channel is checked before each use.
            guard isConnected, let live = shellChannels[shellId], live === state else { throw SSHError.notConnected }
            // The send queue is full: wait for the socket to take some (SSHSendQueue.swift).
            if sendQueue.pendingBytes > SSHSendQueue.backpressureBytes {
                await waitForSocket()
                continue
            }
            // stream_id 0 = stdin
            let written = bytes.withUnsafeMutableBufferPointer { buffer -> Int in
                guard let ptr = buffer.baseAddress else { return -1 }
                return Int(libssh2_channel_write_ex(
                    state.channel, 0,
                    UnsafeRawPointer(ptr.advanced(by: offset)).assumingMemoryBound(to: CChar.self),
                    remaining
                ))
            }

            if written > 0 {
                offset += written
                remaining -= written
            } else if written == Int(LIBSSH2_ERROR_EAGAIN) {
                await waitForSocket()
            } else {
                noteTransportError(written)
                throw SSHError.socketError("Write failed: \(written)")
            }
        }
    }

    // MARK: - Resize

    func resize(cols: Int, rows: Int, for shellId: UUID) async throws {
        guard let state = shellChannels[shellId] else {
            throw SSHError.notConnected
        }

        let result = libssh2_channel_request_pty_size_ex(state.channel, Int32(cols), Int32(rows), 0, 0)
        if result != 0 && result != Int32(LIBSSH2_ERROR_EAGAIN) {
            logger.warning("PTY resize failed: \(result)")
        }
        kickSendQueue()
    }

    // MARK: - Execute Command

    /// Run `command` on its own exec channel. `input`, when given, becomes its stdin and is
    /// closed afterwards (Windows scripts travel this way, past OpenSSH's command-line limit).
    func execute(_ command: String, input: String? = nil, timeout: TimeInterval? = nil) async throws -> SSHExecResult {
        guard libssh2Session != nil else {
            throw SSHError.notConnected
        }
        let admission = min(timeout ?? Self.commandAdmissionSeconds, Self.commandAdmissionSeconds)
        try await awaitCommandSlot(admission: admission)
        startIOLoop()

        let requestId = UUID()

        // Timeout watchdog
        var timeoutTask: Task<Void, Never>?
        if let timeout {
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await self?.cancelExecRequest(requestId, error: SSHError.timeout)
            }
        }
        defer { timeoutTask?.cancel() }

        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                let request = ExecRequest(
                    id: requestId,
                    command: command,
                    input: input.map { Array($0.utf8) },
                    continuation: continuation
                )
                execRequests[request.id] = request
            }
        }, onCancel: { [weak self] in
            Task {
                await self?.cancelExecRequest(requestId, error: CancellationError())
            }
        })
    }

    // MARK: - Command slots

    /**
     * Commands the native side lets run at once: the phone's three command slots plus its connection check's lane
     * (src/remote/channelBudget.ts). A command whose channel is still closing keeps its slot until the computer's
     * CLOSE arrives, so a slot JS freed when a promise settled cannot push the computer past its MaxSessions.
     */
    static let commandSlots = 4
    /// How long a new command waits for a slot before it answers E_BUSY (the phone's non-destructive `busy`).
    static let commandAdmissionSeconds: TimeInterval = 5
    /// A close the computer has not answered this long after ours went out is stuck (`channelStats`).
    static let stuckCloseSeconds: TimeInterval = 30

    private var commandSlotsInUse: Int {
        execRequests.count + closingChannels.filter(\.holdsCommandSlot).count
            + abandonedOpens.filter(\.holdsCommandSlot).count
    }

    private func awaitCommandSlot(admission: TimeInterval) async throws {
        let deadline = Date().addingTimeInterval(admission)
        while commandSlotsInUse >= Self.commandSlots {
            try Task.checkCancellation()
            guard isConnected else { throw SSHError.notConnected }
            if Date() >= deadline {
                let stats = channelStats()
                throw SSHError.busy(closing: stats.commandsClosing, stuck: stats.stuckCommandCloses)
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    struct ChannelStats: Sendable {
        let commandsRunning: Int
        let commandsClosing: Int
        /// Command channels whose CLOSE went out `stuckCloseSeconds` ago with no CLOSE from the computer.
        let stuckCommandCloses: Int
        /// How long the oldest stuck command close has waited, in milliseconds (0 when none).
        let oldestStuckCloseMs: Int
        /// Other channels (terminals, forwards, uploads) whose close is stuck the same way.
        let stuckOtherCloses: Int
        let queuedSendBytes: Int
    }

    /// What the phone's JavaScript reads to recover from closes the computer never answers (`channelStats`).
    func channelStats() -> ChannelStats {
        let now = Date()
        let stuck = closingChannels.filter { entry in
            !entry.closed && entry.closeSentAt.map { now.timeIntervalSince($0) >= Self.stuckCloseSeconds } == true
        }
        let stuckCommands = stuck.filter(\.holdsCommandSlot)
        let oldest = stuckCommands.compactMap(\.closeSentAt).min()
        return ChannelStats(
            commandsRunning: execRequests.count,
            commandsClosing: closingChannels.filter(\.holdsCommandSlot).count,
            stuckCommandCloses: stuckCommands.count,
            oldestStuckCloseMs: oldest.map { Int(now.timeIntervalSince($0) * 1000) } ?? 0,
            stuckOtherCloses: stuck.count - stuckCommands.count,
            queuedSendBytes: sendQueue.pendingBytes
        )
    }

    // MARK: - Liveness

    /// Configured TCP keep-alive idle time clamped to the contract range.
    private var keepAliveIntervalSeconds: Int {
        min(max(config.keepAliveIntervalSec, 10), 120)
    }

    /// How often an idle connection's socket is looked at for a TCP keep-alive that went unanswered.
    private static let livenessCheckNanoseconds: UInt64 = 5_000_000_000

    /**
     * An idle connection has no io loop reading its socket, so a link the TCP keep-alives found dead would only be
     * noticed by the next command. This looks at the socket every few seconds without reading from it (`MSG_PEEK`),
     * flushes bytes the queue still holds, and ends the transport when the socket reports an error or a close.
     */
    private func startLivenessLoop() {
        lastInboundAt = Date()
        guard livenessTask == nil else { return }
        livenessTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.livenessCheckNanoseconds)
                if Task.isCancelled { break }
                guard let self, await self.checkLiveness() else { break }
            }
        }
    }

    private func stopLivenessLoop() {
        livenessTask?.cancel()
        livenessTask = nil
    }

    /**
     * CDXC:RemoteMachines 2026-11-14 WHY:
     * False once the transport is gone, which ends the loop. Besides the socket's own error, the computer has to be
     * heard from: only bytes libssh2 actually read count (the receive callback), never bytes left waiting in the
     * socket, which may be old. After `keepAliveIntervalSeconds` with nothing read, a check goes out, and if nothing is
     * read within another interval the transport is dead (about a minute by default). A loopback socket (an Easy
     * Connect tunnel) or data the computer never acknowledges keeps TCP's own checks quiet forever.
     * - With the io loop running, the check is one SSH keep-alive through the send queue (the loop reads its reply).
     * - With the connection idle, nothing reads at all: libssh2 has no public call that reads without a channel. So
     *   the check opens a session channel and closes it again (`startServiceOpen`): its open and close read and
     *   answer everything the computer sent meanwhile (its own keep-alives, a rekey), and its confirmation is fresh
     *   proof the computer answers. The same runs whenever an idle connection has unread bytes, at most once per
     *   `idleServiceSeconds`, so the computer's requests are answered while the phone is idle.
     */
    func checkLiveness(now: Date = Date()) -> Bool {
        guard isActive, !transportDead, socket >= 0, let session = libssh2Session else { return false }
        kickSendQueue()
        if let problem = Self.socketProblem(socket) {
            markTransportDead(problem)
            return false
        }
        let inbound = sessionContext.inboundBytes
        if inbound != lastInboundEvidence {
            lastInboundEvidence = inbound
            lastInboundAt = now
            keepAliveSentAt = nil
        }
        guard config.keepAliveEnabled else { return !transportDead }
        let interval = TimeInterval(keepAliveIntervalSeconds)
        if let sent = keepAliveSentAt, now.timeIntervalSince(sent) >= interval {
            markTransportDead("no answer from the computer for \(Int(now.timeIntervalSince(lastInboundAt))) s")
            return false
        }
        let silent = now.timeIntervalSince(lastInboundAt) >= interval
        var checkSent = false
        if ioTask == nil {
            let unread = Self.socketHasUnreadBytes(socket)
            let serviceDue = lastServiceAt.map { now.timeIntervalSince($0) >= Self.idleServiceSeconds } ?? true
            if (silent && keepAliveSentAt == nil) || (unread && serviceDue && !harnessSkipIdleService) {
                lastServiceAt = now
                checkSent = startServiceOpen(session)
                if checkSent, silent, keepAliveSentAt == nil { keepAliveSentAt = now }
            }
        }
        // With the io loop running, or another opener holding the claim (an upload's SCP startup reads while it
        // waits), the check is an SSH keep-alive: the deadline is armed only for a check that really went out.
        if !checkSent, silent, keepAliveSentAt == nil {
            var secondsToNext: Int32 = 0
            let result = libssh2_keepalive_send(session, &secondsToNext)
            if result != 0 {
                noteTransportError(Int(result))
                return false
            }
            keepAliveSentAt = now
            kickSendQueue()
        }
        return !transportDead
    }

    /// How often an idle connection with unread bytes from the computer is serviced at most.
    private static let idleServiceSeconds: TimeInterval = 5

    private var harnessSkipIdleService: Bool {
        #if GHOSTEX_SSH_HARNESS
        return Self.harnessNoIdleService
        #else
        return false
        #endif
    }

    /**
     * Opens a session channel that runs nothing and closes it, only so libssh2 reads (and answers) what the computer
     * sent. It takes the channel-open claim like any opener; when another open holds it, that open reads instead.
     */
    /// True when the open went out (its confirmation is then the answer); false when another opener holds the claim.
    private func startServiceOpen(_ session: OpaquePointer) -> Bool {
        let owner = UUID()
        guard claimChannelOpen(owner) else { return false }
        if let channel = Self.openSessionChannel(session) {
            releaseChannelOpen(owner)
            retireChannel(channel)
            return true
        }
        let lastError = libssh2_session_last_errno(session)
        guard lastError == LIBSSH2_ERROR_EAGAIN else {
            releaseChannelOpen(owner)
            noteTransportError(Int(lastError))
            return false
        }
        abandonOpen(AbandonedChannelOpen(owner: owner, holdsCommandSlot: false, what: "a liveness check") { session in
            Self.openSessionChannel(session)
        })
        return true
    }

    /// Whether the computer sent bytes nobody has read yet (peeked, never consumed).
    static func socketHasUnreadBytes(_ socket: Int32) -> Bool {
        var byte: UInt8 = 0
        return recv(socket, &byte, 1, MSG_PEEK | MSG_DONTWAIT) > 0
    }

    /// An error or end-of-stream waiting on the socket, without consuming any byte.
    static func socketProblem(_ socket: Int32) -> String? {
        var pfd = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
        guard poll(&pfd, 1, 0) > 0 else { return nil }
        if pfd.revents & Int16(POLLNVAL) != 0 { return "the socket is closed" }
        var pending: Int32 = 0
        var length = socklen_t(MemoryLayout<Int32>.size)
        if getsockopt(socket, SOL_SOCKET, SO_ERROR, &pending, &length) == 0, pending != 0 {
            return "socket error: \(String(cString: strerror(pending)))"
        }
        guard pfd.revents & Int16(POLLIN | POLLHUP | POLLERR) != 0 else { return nil }
        var byte: UInt8 = 0
        let peeked = recv(socket, &byte, 1, MSG_PEEK | MSG_DONTWAIT)
        if peeked == 0 { return "the computer closed the connection" }
        if peeked < 0, errno != EAGAIN, errno != EINTR {
            return "socket error: \(String(cString: strerror(errno)))"
        }
        return nil
    }
}
