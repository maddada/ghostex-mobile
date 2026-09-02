//
//  SSHPortForward.swift
//  GhostexNative
//
//  SSH local port forwarding (direct-tcpip) on top of the machine's existing,
//  already-authenticated libssh2 session: a loopback listener on the phone whose
//  every accepted connection gets its own channel to `localhost:<remotePort>` on
//  the remote. Nothing is configured on the PC.
//
//  All libssh2 calls stay on the SSHConnection actor, and the channels are
//  serviced by the same `ioLoop` that already drives shell and exec channels, so
//  the session handle is never touched from two threads. Only Network.framework
//  callbacks run off-actor, and they hop straight back in.
//

import Foundation
import Network
import os.log
import libssh2

// MARK: - Forward state

/// One accepted loopback connection bridged onto its own direct-tcpip channel.
/// Only ever touched on the SSHConnection actor.
final class PortForwardChannel {
    let id: UUID
    let remotePort: Int
    let channel: OpaquePointer
    let connection: NWConnection

    /// Bytes read from the phone-side socket that libssh2 has not accepted yet.
    var pendingToRemote = Data()
    /// True while an NWConnection send is in flight (back-pressure, remote -> local).
    var sendInFlight = false
    /// True while an NWConnection receive is armed (back-pressure, local -> remote).
    var receiveArmed = false
    /// The phone-side socket reached EOF; the channel still has to be told.
    var localEOF = false
    var sentEOF = false

    init(id: UUID, remotePort: Int, channel: OpaquePointer, connection: NWConnection) {
        self.id = id
        self.remotePort = remotePort
        self.channel = channel
        self.connection = connection
    }
}

/// One live forward: the loopback listener plus the channels it has spawned.
final class PortForwardListener {
    let remotePort: Int
    let localPort: Int
    let listener: NWListener
    var channelIds: Set<UUID> = []

    /// Every listener and connection callback runs here; the actor owns the state.
    static let queue = DispatchQueue(label: "app.ghostex.mobile.portforward", qos: .userInitiated)

    init(remotePort: Int, localPort: Int, listener: NWListener) {
        self.remotePort = remotePort
        self.localPort = localPort
        self.listener = listener
    }
}

/// One live forward as reported to JS.
struct PortForwardInfo: Sendable {
    let remotePort: Int
    let localPort: Int
}

/// A direct-tcpip channel whose non-blocking close is still in progress.
struct ClosingChannel {
    let channel: OpaquePointer
    /// When to stop waiting for the remote and free the channel regardless.
    let deadline: Date
    /// `libssh2_channel_close` has already returned success for this channel.
    var closed: Bool
}

/// Hands one accepted connection from the listener queue to the actor. NWConnection is
/// safe to use from any thread (its own callbacks are queue-scheduled), it is just not
/// marked Sendable.
final class PortForwardConnectionBox: @unchecked Sendable {
    let connection: NWConnection

    init(_ connection: NWConnection) {
        self.connection = connection
    }
}

/// One-shot gate so a listener's repeated state updates resume the continuation once.
private final class ListenerReadyGate: @unchecked Sendable {
    private let lock = NSLock()
    private var settled = false

    func settle() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if settled { return false }
        settled = true
        return true
    }
}

// MARK: - SSHConnection port forwarding

extension SSHConnection {
    /// direct-tcpip target host, resolved on the remote machine.
    private static var remoteLoopbackHost: String { "localhost" }
    /// The forward is reachable from this device only; the SSH channel carries the traffic.
    private static var forwardLoopbackHost: String { "127.0.0.1" }
    private static var forwardBufferBytes: Int { 32768 }
    private static var minTCPPort: Int { 1 }
    private static var maxTCPPort: Int { 65535 }
    /**
     * How long one direct-tcpip open may take, including the wait for the
     * session's channel-open claim. The claim serialises every opener, so an
     * open that never finished would keep shells and exec channels from ever
     * starting.
     */
    private static var directChannelOpenTimeout: TimeInterval { 15 }
    /// A loopback listener that has not reached `.ready` by then never will.
    private static var listenerReadyTimeoutNanoseconds: UInt64 { 10_000_000_000 }
    /// How long a channel close may wait for the remote's CHANNEL_CLOSE.
    private static var channelCloseTimeout: TimeInterval { 5 }

    /**
     * Start (or reuse) the loopback forward for `localhost:remotePort` on the machine and
     * return the port it listens on here. One probe channel is opened and closed first, so
     * a port nothing is bound to, and an sshd that refuses forwarding, fail here instead of
     * leaving the app with a listener that can never carry a byte.
     */
    func startPortForward(remotePort: Int) async throws -> Int {
        guard remotePort >= Self.minTCPPort, remotePort <= Self.maxTCPPort else {
            throw SSHError.portOutOfRange(remotePort)
        }
        guard isConnected else { throw SSHError.notConnected }
        if let existing = portForwards[remotePort] {
            return existing.localPort
        }

        logger.info(
            "startPortForward \(self.config.machineId, privacy: .public) remotePort=\(remotePort)"
        )

        /*
         * Both steps below suspend, and a stop or a disconnect can land in
         * either gap. Publishing the listener afterwards would rebind a forward
         * the caller already asked to be gone, and nothing would ever close it —
         * so every resumption re-checks the session and this token.
         */
        let generation = portForwardTeardownGeneration

        let probe = try await openDirectChannel(remotePort: remotePort)
        retireForwardChannel(probe)

        guard isConnected, portForwardTeardownGeneration == generation else {
            throw SSHError.notConnected
        }
        // A concurrent start for the same port may have finished while the probe ran.
        if let existing = portForwards[remotePort] {
            return existing.localPort
        }

        let forward = try await makeLoopbackListener(remotePort: remotePort)
        if let existing = portForwards[remotePort] {
            forward.listener.cancel()
            return existing.localPort
        }
        guard isConnected, portForwardTeardownGeneration == generation else {
            forward.listener.cancel()
            throw SSHError.notConnected
        }
        portForwards[remotePort] = forward
        watchForwardListener(forward)
        logger.info(
            "portForward \(self.config.machineId, privacy: .public):\(remotePort) listening on 127.0.0.1:\(forward.localPort)"
        )
        return forward.localPort
    }

    /// Close the forward for `remotePort`, including its in-flight channels. No-op when absent.
    func stopPortForward(remotePort: Int) {
        guard let forward = portForwards.removeValue(forKey: remotePort) else { return }
        portForwardTeardownGeneration += 1
        logger.info(
            "stopPortForward \(self.config.machineId, privacy: .public) remotePort=\(remotePort)"
        )
        forward.listener.stateUpdateHandler = nil
        forward.listener.cancel()
        for id in Array(forward.channelIds) {
            closeForwardChannel(id)
        }
        forward.channelIds.removeAll()
    }

    /// Live forwards, lowest remote port first.
    func listPortForwards() -> [PortForwardInfo] {
        portForwards.values
            .map { PortForwardInfo(remotePort: $0.remotePort, localPort: $0.localPort) }
            .sorted { $0.remotePort < $1.remotePort }
    }

    /// Tear every forward down. Called whenever the session behind them goes away.
    func closeAllPortForwards() {
        let forwards = portForwards
        portForwards.removeAll()
        portForwardTeardownGeneration += 1
        for forward in forwards.values {
            forward.listener.stateUpdateHandler = nil
            forward.listener.cancel()
            forward.channelIds.removeAll()
        }
        for id in Array(forwardChannels.keys) {
            closeForwardChannel(id)
        }
    }

    // MARK: Listener

    private func makeLoopbackListener(remotePort: Int) async throws -> PortForwardListener {
        let parameters = NWParameters.tcp
        // Loopback only: the phone must never republish the remote's app to its network.
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host(Self.forwardLoopbackHost),
            port: .any
        )
        if let tcp = parameters.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options {
            tcp.noDelay = true
        }

        let listener: NWListener
        do {
            listener = try NWListener(using: parameters)
        } catch {
            throw SSHError.socketError(
                "Could not bind a loopback listener: \(error.localizedDescription)"
            )
        }

        listener.newConnectionHandler = { [weak self] connection in
            let box = PortForwardConnectionBox(connection)
            Task { await self?.acceptForwardConnection(box, remotePort: remotePort) }
        }

        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let gate = ListenerReadyGate()
                /*
                 * `.waiting` is not a terminal state: Network.framework keeps
                 * retrying a listener it cannot bind and reports nothing else,
                 * which would leave this continuation suspended for good.
                 */
                let readyTimeout = Task {
                    try? await Task.sleep(nanoseconds: Self.listenerReadyTimeoutNanoseconds)
                    if gate.settle() { continuation.resume(throwing: SSHError.timeout) }
                }
                listener.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        if gate.settle() {
                            readyTimeout.cancel()
                            continuation.resume()
                        }
                    case .failed(let error):
                        if gate.settle() {
                            readyTimeout.cancel()
                            continuation.resume(
                                throwing: SSHError.socketError(
                                    "Loopback listener failed: \(error.localizedDescription)"
                                )
                            )
                        }
                    case .cancelled:
                        if gate.settle() {
                            readyTimeout.cancel()
                            continuation.resume(
                                throwing: SSHError.socketError("Loopback listener was cancelled")
                            )
                        }
                    default:
                        break
                    }
                }
                listener.start(queue: PortForwardListener.queue)
            }
        } catch {
            listener.cancel()
            throw error
        }

        guard let port = listener.port?.rawValue, port > 0 else {
            listener.cancel()
            throw SSHError.socketError("Loopback listener did not report a port")
        }
        return PortForwardListener(remotePort: remotePort, localPort: Int(port), listener: listener)
    }

    /**
     * Keep watching a listener that has already reached `.ready`. It can still
     * fail — the OS reclaims the port while the app is suspended, for one — and
     * a forward whose listener is dead accepts nothing, so it is retired rather
     * than left in the table for `listPortForwards` to report.
     */
    private func watchForwardListener(_ forward: PortForwardListener) {
        let remotePort = forward.remotePort
        forward.listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                Task { await self?.noteForwardListenerDied(remotePort: remotePort) }
            default:
                break
            }
        }
    }

    private func noteForwardListenerDied(remotePort: Int) {
        guard portForwards[remotePort] != nil else { return }
        logger.warning(
            "portForward \(self.config.machineId, privacy: .public):\(remotePort) listener stopped; dropping the forward"
        )
        stopPortForward(remotePort: remotePort)
    }

    /// Give one accepted socket its own channel. Every failure here closes that socket only.
    private func acceptForwardConnection(_ box: PortForwardConnectionBox, remotePort: Int) async {
        let connection = box.connection
        guard let forward = portForwards[remotePort], isConnected else {
            connection.cancel()
            return
        }
        connection.start(queue: PortForwardListener.queue)

        let channel: OpaquePointer
        do {
            channel = try await openDirectChannel(remotePort: remotePort)
        } catch {
            let detail = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            logger.warning(
                "portForward \(self.config.machineId, privacy: .public):\(remotePort) dial failed: \(detail, privacy: .public)"
            )
            connection.cancel()
            return
        }

        // The forward may have been stopped, or the connection replaced, while it opened.
        guard portForwards[remotePort] === forward else {
            connection.cancel()
            retireForwardChannel(channel)
            return
        }

        let id = UUID()
        forwardChannels[id] = PortForwardChannel(
            id: id,
            remotePort: remotePort,
            channel: channel,
            connection: connection
        )
        forward.channelIds.insert(id)
        startIOLoop()
        armForwardReceive(id)
    }

    // MARK: Channel open

    /**
     * Open one direct-tcpip channel to the remote's `localhost:remotePort`. Non-blocking so
     * the shell and exec channels keep flowing while the remote answers; the channel-open
     * claim is what keeps this from clobbering another opener's session state.
     */
    private func openDirectChannel(remotePort: Int) async throws -> OpaquePointer {
        /*
         * Bounded on both halves: waiting for the claim, and holding it across
         * the EAGAIN retries below. A remote that never answers the open would
         * otherwise keep the claim forever, and every shell and exec channel
         * waits behind it.
         */
        let opener = try await awaitChannelOpenClaim(timeout: Self.directChannelOpenTimeout)
        defer { releaseChannelOpen(opener) }
        let deadline = Date().addingTimeInterval(Self.directChannelOpenTimeout)

        while true {
            try Task.checkCancellation()
            guard let session = libssh2Session else { throw SSHError.notConnected }
            if let channel = libssh2_channel_direct_tcpip_ex(
                session,
                Self.remoteLoopbackHost,
                Int32(remotePort),
                Self.forwardLoopbackHost,
                0
            ) {
                return channel
            }
            let lastError = libssh2_session_last_errno(session)
            if lastError == LIBSSH2_ERROR_EAGAIN {
                if Date() >= deadline { throw SSHError.timeout }
                await waitForSocket()
                continue
            }
            throw Self.directChannelError(
                session: session,
                lastError: lastError,
                remotePort: remotePort
            )
        }
    }

    /// libssh2 1.11 renders the SSH_MSG_CHANNEL_OPEN_FAILURE reason code into the session's
    /// last error message, which is the only place the honest cause is available.
    private static func directChannelError(
        session: OpaquePointer,
        lastError: Int32,
        remotePort: Int
    ) -> SSHError {
        var messagePointer: UnsafeMutablePointer<CChar>?
        var messageLength: Int32 = 0
        libssh2_session_last_error(session, &messagePointer, &messageLength, 0)
        let message = messagePointer.map { String(cString: $0) } ?? ""

        if message.contains("administratively prohibited") {
            return .portForwardingProhibited
        }
        if message.contains("connect failed") {
            return .portForwardNotListening(remotePort)
        }
        if lastError == LIBSSH2_ERROR_SOCKET_SEND
            || lastError == LIBSSH2_ERROR_SOCKET_RECV
            || lastError == LIBSSH2_ERROR_SOCKET_DISCONNECT {
            return .socketError(
                message.isEmpty ? "direct-tcpip open failed: \(lastError)" : message
            )
        }
        return .channelOpenFailed
    }

    // MARK: Byte pumps

    /// Service every forward channel once. Called from `ioLoop`; returns true when it moved bytes.
    func pumpPortForwardChannels() -> Bool {
        // Channels being closed outlive the ones being read from, so they are
        // driven first and independently of whether any are still open.
        var didWork = drainClosingChannels()
        guard !forwardChannels.isEmpty else { return didWork }

        var buffer = [CChar](repeating: 0, count: Self.forwardBufferBytes)

        for state in Array(forwardChannels.values) {
            guard forwardChannels[state.id] != nil else { continue }

            // Remote -> local. One send at a time keeps a fast remote from queueing
            // unbounded data behind a slow local reader.
            if !state.sendInFlight {
                let bytesRead = libssh2_channel_read_ex(state.channel, 0, &buffer, buffer.count)
                if bytesRead > 0 {
                    let payload = Data(bytes: buffer, count: Int(bytesRead))
                    let id = state.id
                    state.sendInFlight = true
                    didWork = true
                    state.connection.send(
                        content: payload,
                        completion: .contentProcessed { [weak self] error in
                            Task { await self?.forwardSendFinished(id, error: error) }
                        }
                    )
                } else if bytesRead < 0, bytesRead != Int(LIBSSH2_ERROR_EAGAIN) {
                    noteTransportError(bytesRead)
                    logger.debug("portForward channel read failed: \(bytesRead)")
                    closeForwardChannel(state.id)
                    continue
                }
            }

            // Local -> remote.
            if !state.pendingToRemote.isEmpty {
                let written = writeToForwardChannel(state)
                if written < 0 {
                    closeForwardChannel(state.id)
                    continue
                }
                if written > 0 { didWork = true }
                if state.pendingToRemote.isEmpty { armForwardReceive(state.id) }
            }

            // The local side is done sending: tell the remote so it can answer and close.
            if state.localEOF, state.pendingToRemote.isEmpty, !state.sentEOF {
                let result = libssh2_channel_send_eof(state.channel)
                if result == 0 {
                    state.sentEOF = true
                    didWork = true
                } else if result != LIBSSH2_ERROR_EAGAIN {
                    closeForwardChannel(state.id)
                    continue
                }
            }

            // The remote closed its side and everything it sent has been handed over.
            if libssh2_channel_eof(state.channel) != 0, !state.sendInFlight {
                closeForwardChannel(state.id)
                didWork = true
            }
        }

        return didWork
    }

    /// Drain what the local side queued into the channel. Returns bytes written, or -1 on failure.
    private func writeToForwardChannel(_ state: PortForwardChannel) -> Int {
        var totalWritten = 0
        while !state.pendingToRemote.isEmpty {
            let pendingCount = state.pendingToRemote.count
            let written = state.pendingToRemote.withUnsafeBytes { raw -> Int in
                guard let base = raw.baseAddress else { return -1 }
                return Int(libssh2_channel_write_ex(
                    state.channel,
                    0,
                    base.assumingMemoryBound(to: CChar.self),
                    pendingCount
                ))
            }
            if written > 0 {
                state.pendingToRemote.removeFirst(written)
                totalWritten += written
                continue
            }
            if written == Int(LIBSSH2_ERROR_EAGAIN) {
                break
            }
            noteTransportError(written)
            logger.debug("portForward channel write failed: \(written)")
            return -1
        }
        return totalWritten
    }

    private func armForwardReceive(_ id: UUID) {
        guard let state = forwardChannels[id], !state.receiveArmed, !state.localEOF else { return }
        state.receiveArmed = true
        state.connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: Self.forwardBufferBytes
        ) { [weak self] data, _, isComplete, error in
            Task {
                await self?.forwardBytesFromLocal(
                    id,
                    data: data,
                    isComplete: isComplete,
                    error: error
                )
            }
        }
    }

    private func forwardBytesFromLocal(
        _ id: UUID,
        data: Data?,
        isComplete: Bool,
        error: NWError?
    ) {
        guard let state = forwardChannels[id] else { return }
        state.receiveArmed = false

        if let error {
            logger.debug(
                "portForward local read failed: \(error.localizedDescription, privacy: .public)"
            )
            closeForwardChannel(id)
            return
        }
        if let data, !data.isEmpty {
            state.pendingToRemote.append(data)
        }
        if isComplete {
            state.localEOF = true
        }
        // Nothing queued and the socket is still open: keep listening. Otherwise the io
        // loop drains what is queued and re-arms from there.
        if state.pendingToRemote.isEmpty, !state.localEOF {
            armForwardReceive(id)
        }
    }

    private func forwardSendFinished(_ id: UUID, error: NWError?) {
        guard let state = forwardChannels[id] else { return }
        state.sendInFlight = false
        if let error {
            logger.debug(
                "portForward local write failed: \(error.localizedDescription, privacy: .public)"
            )
            closeForwardChannel(id)
        }
    }

    private func closeForwardChannel(_ id: UUID) {
        guard let state = forwardChannels.removeValue(forKey: id) else { return }
        portForwards[state.remotePort]?.channelIds.remove(id)
        state.connection.cancel()
        retireForwardChannel(state.channel)
    }

    /**
     * Begin closing one direct-tcpip channel. Both `libssh2_channel_close` and
     * `libssh2_channel_free` answer EAGAIN on a non-blocking session until the
     * remote's CHANNEL_CLOSE has been exchanged; ignoring that leaves the
     * channel allocated on the session for as long as it lives, which for a
     * preview that walks a few dozen pages is a real leak. What does not finish
     * immediately is handed to the io loop, which drives it to completion.
     */
    func retireForwardChannel(_ channel: OpaquePointer) {
        var entry = ClosingChannel(
            channel: channel,
            deadline: Date().addingTimeInterval(Self.channelCloseTimeout),
            closed: false
        )
        if libssh2_channel_close(channel) == LIBSSH2_ERROR_EAGAIN {
            closingForwardChannels.append(entry)
            startIOLoop()
            return
        }
        entry.closed = true
        if libssh2_channel_free(channel) == LIBSSH2_ERROR_EAGAIN {
            closingForwardChannels.append(entry)
            startIOLoop()
        }
    }

    /// One pass over the channels still closing. Returns true when it moved one on.
    private func drainClosingChannels() -> Bool {
        guard !closingForwardChannels.isEmpty else { return false }
        let now = Date()
        var stillClosing: [ClosingChannel] = []
        var didWork = false

        for var entry in closingForwardChannels {
            if !entry.closed {
                if libssh2_channel_close(entry.channel) == LIBSSH2_ERROR_EAGAIN, now < entry.deadline {
                    stillClosing.append(entry)
                    continue
                }
                entry.closed = true
                didWork = true
            }
            /*
             * Past the deadline the free happens anyway: libssh2 documents it as
             * the "give up on the close handshake" path, and the alternative is
             * holding the allocation until the session itself is freed.
             */
            if libssh2_channel_free(entry.channel) == LIBSSH2_ERROR_EAGAIN, now < entry.deadline {
                stillClosing.append(entry)
                continue
            }
            didWork = true
        }

        closingForwardChannels = stillClosing
        return didWork
    }
}
