//
//  SSHConnection.swift
//  GhostexNative
//
//  Ported subset of VVTerm/Core/SSH/SSHClient.swift (the SSHSession actor).
//
//  Kept: socket connect (all resolved addresses), TCP tuning (TCP_NODELAY,
//  small send buffer, SO_NOSIGPIPE), libssh2 handshake with fast cipher/MAC
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
    var connectionTimeout: TimeInterval = 30
    /// Send SSH protocol keep-alive packets on this connection.
    var keepAliveEnabled: Bool = true
    /// Keep-alive interval in seconds; clamped to 10...120 when enabled.
    var keepAliveIntervalSec: Int = 30
    /// tailcat peer token. Non-empty means dial the tailcat loopback forward for
    /// `machineId` instead of `host`:`port`. Host-key identity stays `host`:`port`.
    var tailcatToken: String = ""
}

struct SSHExecResult: Sendable {
    let stdout: String
    let stderr: String
    let exitCode: Int
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

/// Per-session storage for keyboard-interactive password (used by C callback).
private final class KeyboardInteractiveContext: @unchecked Sendable {
    private nonisolated(unsafe) var _password: String?
    private let lock = NSLock()

    nonisolated init() {}

    nonisolated func setPassword(_ password: String?) {
        lock.lock()
        defer { lock.unlock() }
        _password = password
    }

    nonisolated func password() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return _password
    }
}

private func keyboardInteractivePassword(
    from abstract: UnsafeMutablePointer<UnsafeMutableRawPointer?>?
) -> String? {
    guard let abstract, let contextPointer = abstract.pointee else { return nil }
    let context = Unmanaged<KeyboardInteractiveContext>.fromOpaque(contextPointer).takeUnretainedValue()
    return context.password()
}

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
    guard numPrompts > 0, let responses = responses, let password = keyboardInteractivePassword(from: abstract) else {
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

        init(id: UUID, command: String, continuation: CheckedContinuation<SSHExecResult, Error>) {
            self.id = id
            self.command = command
            self.continuation = continuation
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
    private var keepAliveTask: Task<Void, Never>?
    private var execRequests: [UUID: ExecRequest] = [:]

    /// Local port forwards owned by this connection, keyed by remote port.
    var portForwards: [Int: PortForwardListener] = [:]

    /// Every accepted forward connection's direct-tcpip channel, serviced by `ioLoop`.
    var forwardChannels: [UUID: PortForwardChannel] = [:]

    /**
     * Channels whose close is still being driven. A non-blocking
     * `libssh2_channel_close` answers EAGAIN until the remote's CHANNEL_CLOSE
     * arrives, so `ioLoop` finishes them (see `drainClosingChannels`); dropping
     * the pointer at the first EAGAIN would leak the channel for the life of the
     * session.
     */
    var closingForwardChannels: [ClosingChannel] = []

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
    private var channelOpenClaim: UUID?

    let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "app.ghostex.mobile",
        category: "SSHConnection"
    )

    /// Atomic socket storage for emergency abort from any thread
    private let atomicSocket = AtomicSocket()

    /// Session-specific auth callback context passed to the libssh2 session abstract pointer.
    private let keyboardInteractiveContext = KeyboardInteractiveContext()

    /// Track if cleanup has been performed
    private var hasBeenCleaned = false

    init(config: SSHConnectionConfig) {
        self.config = config
    }

    var isConnected: Bool {
        isActive && !transportDead && libssh2Session != nil
    }

    /// Flag the whole connection dead on socket-level libssh2 errors so
    /// callers (ensureConnected / reopen flows) actually reconnect.
    func noteTransportError(_ code: Int) {
        guard code == Int(LIBSSH2_ERROR_SOCKET_SEND) || code == Int(LIBSSH2_ERROR_SOCKET_RECV)
            || code == Int(LIBSSH2_ERROR_SOCKET_DISCONNECT)
            || code == Int(LIBSSH2_ERROR_SOCKET_TIMEOUT) else {
            return
        }
        let wasAlive = !transportDead
        transportDead = true
        /*
         * Forwards dial through this session. With the transport gone every
         * socket the loopback listeners accept would be dropped without a byte,
         * so they come down with it — `listPortForwards` promises never to name
         * a forward whose channels can no longer be opened.
         */
        if wasAlive {
            closeAllPortForwards()
        }
    }

    /// Immediately abort the connection by closing the socket (any thread).
    nonisolated func abort() {
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

        // Optimize socket buffers for interactive SSH
        var sendBufSize: Int32 = 8192
        var recvBufSize: Int32 = 65536
        setsockopt(socket, SOL_SOCKET, SO_SNDBUF, &sendBufSize, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(socket, SOL_SOCKET, SO_RCVBUF, &recvBufSize, socklen_t(MemoryLayout<Int32>.size))

        // Prevent SIGPIPE on broken connections
        var noSigPipe: Int32 = 1
        setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))

        // Store in atomic storage for emergency abort
        atomicSocket.socket = socket

        // Create libssh2 session (use _ex variant since macros not available in Swift)
        let sessionAbstract = Unmanaged.passUnretained(keyboardInteractiveContext).toOpaque()
        libssh2Session = libssh2_session_init_ex(nil, nil, nil, sessionAbstract)
        guard let session = libssh2Session else {
            Darwin.close(socket)
            throw SSHError.unknown("Failed to create libssh2 session")
        }

        // Prefer fast ciphers - AES-GCM and ChaCha20 are hardware-accelerated on Apple Silicon
        let fastCiphers = "aes128-gcm@openssh.com,aes256-gcm@openssh.com,chacha20-poly1305@openssh.com,aes128-ctr,aes256-ctr"
        libssh2_session_method_pref(session, LIBSSH2_METHOD_CRYPT_CS, fastCiphers)
        libssh2_session_method_pref(session, LIBSSH2_METHOD_CRYPT_SC, fastCiphers)

        // Prefer fast MACs
        let fastMACs = "hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,hmac-sha2-256,hmac-sha2-512"
        libssh2_session_method_pref(session, LIBSSH2_METHOD_MAC_CS, fastMACs)
        libssh2_session_method_pref(session, LIBSSH2_METHOD_MAC_SC, fastMACs)

        // Set blocking mode for handshake
        libssh2_session_set_blocking(session, 1)

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
        libssh2_session_set_blocking(session, 0)

        // Protocol-level keepalive so a half-dead transport surfaces as a
        // socket error quickly on resume instead of hanging reads. Interval 0
        // disables keep-alives entirely (libssh2_keepalive_send no-ops).
        libssh2_keepalive_config(session, 1, UInt32(config.keepAliveEnabled ? keepAliveIntervalSeconds : 0))

        isActive = true
        transportDead = false
        startKeepAliveLoop()
        logger.info("SSH session established")
    }

    /// tailcat forwards listen on loopback only; the tunnel itself carries the traffic.
    private static let tailcatLoopbackHost = "127.0.0.1"

    /**
     * Where the TCP connection actually goes. A tailcat machine dials the loopback
     * port of the forward the bridge keeps for `config.machineId`; starting it is
     * idempotent, so a reconnect reuses the already-established tunnel. The very
     * first call per machine performs the peer rendezvous and blocks for seconds —
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
            let keyData = Data(keyString.utf8)
            let passphrase = config.credentials.passphrase
            logger.info("Attempting publickey auth for user: \(username)")

            authResult = keyData.withUnsafeBytes { rawBuffer -> Int32 in
                guard let baseAddress = rawBuffer.bindMemory(to: CChar.self).baseAddress else {
                    return LIBSSH2_ERROR_ALLOC
                }

                return libssh2_userauth_publickey_frommemory(
                    session,
                    username,
                    Int(username.utf8.count),
                    nil,
                    0,
                    baseAddress,
                    Int(keyData.count),
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

                keyboardInteractiveContext.setPassword(password)
                defer { keyboardInteractiveContext.setPassword(nil) }

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

        stopKeepAliveLoop()

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
        closingForwardChannels.removeAll()
        channelOpenClaim = nil

        if let session = libssh2Session {
            libssh2_session_disconnect_ex(session, 11, "Normal shutdown", "")
            libssh2_session_free(session)
            libssh2Session = nil
        }
    }

    private func cleanup() {
        stopKeepAliveLoop()
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
        guard let session = libssh2Session else {
            throw SSHError.notConnected
        }

        // Claim the session's channel-open state BEFORE switching to blocking mode, so a
        // non-blocking exec/forward open parked on EAGAIN cannot have its state taken over
        // here, and so the io loop never runs while the session is blocking.
        let opener = try await awaitChannelOpenClaim()
        defer { releaseChannelOpen(opener) }

        // Set blocking for channel setup
        libssh2_session_set_blocking(session, 1)
        defer { libssh2_session_set_blocking(session, 0) }

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
            libssh2_channel_close(channel)
            libssh2_channel_free(channel)
            throw SSHError.shellRequestFailed
        }

        if let command = startupCommand, !command.isEmpty {
            let commandLength = UInt32(command.utf8.count)
            let execResult: Int32 = command.withCString { ptr in
                libssh2_channel_process_startup(channel, "exec", 4, ptr, commandLength)
            }
            guard execResult == 0 else {
                libssh2_channel_close(channel)
                libssh2_channel_free(channel)
                throw SSHError.shellRequestFailed
            }
        } else {
            let shellResult = libssh2_channel_process_startup(channel, "shell", 5, nil, 0)
            guard shellResult == 0 else {
                libssh2_channel_close(channel)
                libssh2_channel_free(channel)
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
            var didWork = false

            if !shellChannels.isEmpty {
                let states = Array(shellChannels.values)
                for state in states {
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

            // Channels still being closed keep the loop alive: nothing else
            // drives their EAGAIN retries.
            if shellChannels.isEmpty, execRequests.isEmpty, forwardChannels.isEmpty,
                closingForwardChannels.isEmpty {
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
        libssh2_channel_close(state.channel)
        libssh2_channel_free(state.channel)
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
        for request in execRequests.values {
            if let channel = request.channel {
                libssh2_channel_close(channel)
                libssh2_channel_free(channel)
                request.channel = nil
            }
        }
        execRequests.removeAll()
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
            request.continuation.resume(throwing: error)
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
            let newChannel = libssh2_channel_open_ex(
                session,
                "session",
                UInt32("session".utf8.count),
                2 * 1024 * 1024,
                32768,
                nil,
                0
            )
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
                finishExecRequest(request.id, error: SSHError.channelOpenFailed)
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

    private func cancelExecRequest(_ requestId: UUID, error: Error) {
        guard execRequests[requestId] != nil else { return }
        finishExecRequest(requestId, error: error)
    }

    private func finishExecRequest(_ requestId: UUID, error: Error?) {
        guard let request = execRequests.removeValue(forKey: requestId) else { return }
        // A request abandoned mid-open (timeout, cancellation) must not strand the claim.
        releaseChannelOpen(requestId)

        var exitCode: Int32 = 0
        if let channel = request.channel {
            libssh2_channel_close(channel)
            exitCode = libssh2_channel_get_exit_status(channel)
            libssh2_channel_free(channel)
            request.channel = nil
        }

        if let error = error {
            request.continuation.resume(throwing: error)
        } else {
            let stdout = String(data: request.output, encoding: .utf8) ?? ""
            let stderr = String(data: request.stderr, encoding: .utf8) ?? ""
            request.continuation.resume(
                returning: SSHExecResult(stdout: stdout, stderr: stderr, exitCode: Int(exitCode))
            )
        }
    }

    func waitForSocket() async {
        guard let session = libssh2Session, socket >= 0 else { return }

        let direction = libssh2_session_block_directions(session)
        guard direction != 0 else { return }

        var pfd = pollfd()
        pfd.fd = socket
        pfd.events = 0

        if direction & LIBSSH2_SESSION_BLOCK_INBOUND != 0 {
            pfd.events |= Int16(POLLIN)
        }
        if direction & LIBSSH2_SESSION_BLOCK_OUTBOUND != 0 {
            pfd.events |= Int16(POLLOUT)
        }

        // Poll with 5ms timeout - short enough for responsiveness,
        // long enough to avoid busy spinning
        _ = poll(&pfd, 1, 5)
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

        while remaining > 0 {
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
    }

    // MARK: - Execute Command

    func execute(_ command: String, timeout: TimeInterval? = nil) async throws -> SSHExecResult {
        guard libssh2Session != nil else {
            throw SSHError.notConnected
        }
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
                let request = ExecRequest(id: requestId, command: command, continuation: continuation)
                execRequests[request.id] = request
            }
        }, onCancel: { [weak self] in
            Task {
                await self?.cancelExecRequest(requestId, error: CancellationError())
            }
        })
    }

    // MARK: - Keep Alive

    /// Configured cadence clamped to the contract range.
    private var keepAliveIntervalSeconds: Int {
        min(max(config.keepAliveIntervalSec, 10), 120)
    }

    /// libssh2 only emits keep-alives from libssh2_keepalive_send, so an idle
    /// session (no shell I/O driving the transport) needs this loop. It ends
    /// when the connection is disconnected or the transport dies.
    private func startKeepAliveLoop() {
        guard config.keepAliveEnabled, keepAliveTask == nil else { return }
        let interval = keepAliveIntervalSeconds
        keepAliveTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000_000)
                if Task.isCancelled { break }
                guard let self, await self.sendKeepAlive() else { break }
            }
        }
    }

    private func stopKeepAliveLoop() {
        keepAliveTask?.cancel()
        keepAliveTask = nil
    }

    /// Returns false once the transport is unusable so the loop stops.
    /// libssh2 tracks the cadence internally (keepalive_config interval) and
    /// silently skips sends that are not due yet or would block (EAGAIN).
    @discardableResult
    func sendKeepAlive() -> Bool {
        guard isConnected, let session = libssh2Session else { return false }
        var secondsToNext: Int32 = 0
        let rc = libssh2_keepalive_send(session, &secondsToNext)
        if rc != 0 {
            noteTransportError(Int(rc))
            return false
        }
        return true
    }

    // MARK: - Upload

    /// Quote a path for POSIX shells (used by the exec-fallback upload).
    static func shellQuoted(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }

    func upload(
        _ data: Data,
        to remotePath: String,
        permissions: Int32 = 0o600,
        strategy: SSHUploadStrategy = .automatic
    ) async throws {
        if strategy == .execPreferred {
            logger.info("Using exec-preferred upload strategy [path: \(remotePath, privacy: .public)]")
            try await uploadViaExec(data, to: remotePath)
            return
        }

        do {
            logger.info("Trying SCP upload [path: \(remotePath, privacy: .public)]")
            try await uploadViaSCP(data, to: remotePath, permissions: permissions)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            logger.warning("SCP upload failed, retrying with exec channel: \(error.localizedDescription, privacy: .public)")
            try await uploadViaExec(data, to: remotePath)
        }
    }

    private func uploadViaSCP(_ data: Data, to remotePath: String, permissions: Int32) async throws {
        guard let session = libssh2Session else {
            throw SSHError.notConnected
        }
        guard !remotePath.isEmpty else {
            throw SSHError.sftpFailed("Upload path is empty")
        }
        logger.info("Opening SCP upload channel [path: \(remotePath, privacy: .public)]")

        var scpChannel: OpaquePointer?
        do {
            while scpChannel == nil {
                try Task.checkCancellation()
                scpChannel = remotePath.withCString { pathPtr in
                    libssh2_scp_send64(
                        session,
                        pathPtr,
                        permissions,
                        Int64(data.count),
                        0,
                        0
                    )
                }

                if scpChannel != nil {
                    break
                }

                let lastError = libssh2_session_last_errno(session)
                if lastError == LIBSSH2_ERROR_EAGAIN {
                    await waitForSocket()
                    continue
                }
                throw SSHError.sftpFailed("SCP channel open failed: \(lastError)")
            }

            guard let scpChannel else {
                throw SSHError.sftpFailed("SCP channel open failed")
            }

            let bytes = [UInt8](data)
            var offset = 0
            while offset < bytes.count {
                try Task.checkCancellation()
                let written = bytes.withUnsafeBufferPointer { buffer -> Int in
                    guard let baseAddress = buffer.baseAddress else { return -1 }
                    let pointer = UnsafeRawPointer(baseAddress.advanced(by: offset)).assumingMemoryBound(to: CChar.self)
                    return Int(libssh2_channel_write_ex(scpChannel, 0, pointer, bytes.count - offset))
                }

                if written > 0 {
                    offset += written
                } else if written == Int(LIBSSH2_ERROR_EAGAIN) {
                    await waitForSocket()
                } else {
                    throw SSHError.sftpFailed("SCP write failed: \(written)")
                }
            }

            _ = try await finishUploadChannel(scpChannel)
            logger.info("SCP upload finished [path: \(remotePath, privacy: .public)]")
        } catch {
            if let scpChannel {
                libssh2_channel_close(scpChannel)
                libssh2_channel_free(scpChannel)
            }
            throw error
        }
    }

    private func uploadViaExec(_ data: Data, to remotePath: String) async throws {
        guard let session = libssh2Session else {
            throw SSHError.notConnected
        }
        guard !remotePath.isEmpty else {
            throw SSHError.sftpFailed("Upload path is empty")
        }
        logger.info("Opening exec upload channel [path: \(remotePath, privacy: .public)]")

        let quotedPath = Self.shellQuoted(remotePath)
        let command = "cat > \(quotedPath) && chmod 600 \(quotedPath)"

        var execChannel: OpaquePointer?
        do {
            while execChannel == nil {
                try Task.checkCancellation()
                execChannel = libssh2_channel_open_ex(
                    session,
                    "session",
                    UInt32("session".utf8.count),
                    2 * 1024 * 1024,
                    32768,
                    nil,
                    0
                )

                if execChannel != nil {
                    break
                }

                let lastError = libssh2_session_last_errno(session)
                if lastError == LIBSSH2_ERROR_EAGAIN {
                    await waitForSocket()
                    continue
                }
                throw SSHError.sftpFailed("Exec upload channel open failed: \(lastError)")
            }

            guard let execChannel else {
                throw SSHError.sftpFailed("Exec upload channel open failed")
            }

            _ = libssh2_channel_handle_extended_data2(
                execChannel,
                LIBSSH2_CHANNEL_EXTENDED_DATA_IGNORE
            )

            while true {
                try Task.checkCancellation()
                let execResult = libssh2_channel_process_startup(
                    execChannel,
                    "exec",
                    4,
                    command,
                    UInt32(command.utf8.count)
                )
                if execResult == 0 {
                    break
                }
                if execResult == Int32(LIBSSH2_ERROR_EAGAIN) {
                    await waitForSocket()
                    continue
                }
                throw SSHError.sftpFailed("Exec upload startup failed: \(execResult)")
            }

            let bytes = [UInt8](data)
            var offset = 0
            while offset < bytes.count {
                try Task.checkCancellation()
                let written = bytes.withUnsafeBufferPointer { buffer -> Int in
                    guard let baseAddress = buffer.baseAddress else { return -1 }
                    let pointer = UnsafeRawPointer(baseAddress.advanced(by: offset)).assumingMemoryBound(to: CChar.self)
                    return Int(libssh2_channel_write_ex(execChannel, 0, pointer, bytes.count - offset))
                }

                if written > 0 {
                    offset += written
                } else if written == Int(LIBSSH2_ERROR_EAGAIN) {
                    await waitForSocket()
                } else {
                    throw SSHError.sftpFailed("Exec upload write failed: \(written)")
                }
            }

            let exitStatus = try await finishUploadChannel(execChannel, drainOutput: true)
            guard exitStatus == 0 else {
                throw SSHError.sftpFailed("Exec upload failed with exit status \(exitStatus)")
            }
            logger.info("Exec upload finished [path: \(remotePath, privacy: .public)]")
        } catch {
            if let execChannel {
                libssh2_channel_close(execChannel)
                libssh2_channel_free(execChannel)
            }
            throw error
        }
    }

    private func finishUploadChannel(
        _ channel: OpaquePointer,
        drainOutput: Bool = false
    ) async throws -> Int32 {
        while true {
            try Task.checkCancellation()
            let sendEOFResult = libssh2_channel_send_eof(channel)
            if sendEOFResult == 0 {
                break
            }
            if sendEOFResult == Int32(LIBSSH2_ERROR_EAGAIN) {
                await waitForSocket()
                continue
            }
            throw SSHError.sftpFailed("Upload send EOF failed: \(sendEOFResult)")
        }

        while true {
            try Task.checkCancellation()
            if drainOutput {
                try await drainChannelOutput(channel)
            }
            let waitEOFResult = libssh2_channel_wait_eof(channel)
            if waitEOFResult == 0 {
                break
            }
            if waitEOFResult == Int32(LIBSSH2_ERROR_EAGAIN) {
                await waitForSocket()
                continue
            }
            throw SSHError.sftpFailed("Upload wait EOF failed: \(waitEOFResult)")
        }

        while true {
            try Task.checkCancellation()
            let closeResult = libssh2_channel_close(channel)
            if closeResult == 0 {
                break
            }
            if closeResult == Int32(LIBSSH2_ERROR_EAGAIN) {
                await waitForSocket()
                continue
            }
            throw SSHError.sftpFailed("Upload close failed: \(closeResult)")
        }

        while true {
            try Task.checkCancellation()
            let waitClosedResult = libssh2_channel_wait_closed(channel)
            if waitClosedResult == 0 {
                break
            }
            if waitClosedResult == Int32(LIBSSH2_ERROR_EAGAIN) {
                await waitForSocket()
                continue
            }
            throw SSHError.sftpFailed("Upload wait close failed: \(waitClosedResult)")
        }

        let exitStatus = libssh2_channel_get_exit_status(channel)
        libssh2_channel_free(channel)
        return exitStatus
    }

    private func drainChannelOutput(_ channel: OpaquePointer) async throws {
        var buffer = [CChar](repeating: 0, count: 4096)

        while true {
            try Task.checkCancellation()
            let stdoutRead = libssh2_channel_read_ex(channel, 0, &buffer, buffer.count)
            if stdoutRead > 0 {
                continue
            }
            if stdoutRead == Int(LIBSSH2_ERROR_EAGAIN) || stdoutRead == 0 {
                break
            }
            throw SSHError.sftpFailed("Exec upload stdout drain failed: \(stdoutRead)")
        }

        while true {
            try Task.checkCancellation()
            let stderrRead = libssh2_channel_read_ex(channel, 1, &buffer, buffer.count)
            if stderrRead > 0 {
                continue
            }
            if stderrRead == Int(LIBSSH2_ERROR_EAGAIN) || stderrRead == 0 {
                break
            }
            throw SSHError.sftpFailed("Exec upload stderr drain failed: \(stderrRead)")
        }
    }
}
