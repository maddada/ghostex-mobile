//
//  SSHSendQueue.swift
//  GhostexNative
//
//  The session's own send queue under libssh2, and the context object libssh2 hands back to its callbacks.
//

import Foundation
import libssh2

/**
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * libssh2 1.11.0 keeps one partly sent packet per session, and the next send from any caller finishes that old packet
 * and returns success without sending its own (transport.c `send_existing`). A lost CHANNEL_OPEN made every later open
 * on the iPhone's connection wait libssh2's 60 s read timeout and fail as "Failed to open channel", while the channels
 * already open kept flowing (gx-xgs, proved against the vendored library). Checking each call's EAGAIN cannot fix it:
 * `libssh2_keepalive_send` returns success with its packet half sent, a channel read answers the computer's keepalive
 * inside the read, and a write on a channel whose window is 0 hides the pending packet's OUTBOUND flag. So libssh2 sends
 * through this queue (`LIBSSH2_CALLBACK_SEND`): every buffer is copied in whole and reported as sent, libssh2 never
 * holds a partial packet, and the queue drains to the socket in exactly the order libssh2 produced the bytes (one FIFO,
 * nothing ever bypasses it, or the connection's MAC sequence breaks).
 * - Non-blocking mode (normal operation): the callback writes what the socket takes at once; the rest waits for the
 *   connection's I/O loop, which runs while the queue holds bytes (`SSHConnection.flushSendQueue`).
 * - Blocking mode (handshake, login, opening a terminal): libssh2 waits for the computer's reply without the I/O loop,
 *   so the callback drains the whole queue itself, earlier bytes first, bounded by the connection timeout.
 * - A failure (socket error, more than `maxQueuedBytes`, no drain progress for `stallSeconds`, the blocking bound)
 *   only shuts the socket down and records why; the callback never frees anything. The connection notices on its next
 *   pass (`SSHConnection.noteSendQueueFailure`) and settles every operation once, after the libssh2 call returned.
 * SEE-ALSO: SSHConnection.swift (`connect`, `ioLoop`, `waitForSocket`), SSHPortForward.swift (producers wait while the
 * queue is above `backpressureBytes`).
 */
final class SSHSendQueue: @unchecked Sendable {
    /// Producers (terminal input, forwards, command input, uploads) wait while more than this is queued.
    static let backpressureBytes = 256 * 1024
    /// More than this queued means the socket stopped taking bytes long ago: the transport is dead.
    static let maxQueuedBytes = 8 * 1024 * 1024
    /// Queued bytes that make no progress for this long mean the transport is dead.
    static let stallSeconds: TimeInterval = 15

    private let lock = NSLock()
    private var storage: [UInt8] = []
    private var head = 0
    private var blocking = false
    private var blockingTimeout: TimeInterval = 20
    private var socket: Int32 = -1
    /// When the queue last had bytes it could not hand to the socket with nothing moving since.
    private var stuckSince: Date?
    private var failure: String?

    #if GHOSTEX_SSH_HARNESS
    /// Harness only: the socket takes nothing while set (a congested uplink).
    nonisolated(unsafe) static var holdSocketWrites = false
    /// Harness only: overrides `maxQueuedBytes` when above 0.
    nonisolated(unsafe) static var maxQueuedBytesOverride = 0
    #endif

    nonisolated init() {}

    nonisolated var pendingBytes: Int {
        lock.lock()
        defer { lock.unlock() }
        return storage.count - head
    }

    /// Why the queue stopped, or nil while it works.
    nonisolated var failureReason: String? {
        lock.lock()
        defer { lock.unlock() }
        return failure
    }

    nonisolated func attach(socket: Int32, blockingTimeout: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        self.socket = socket
        self.blockingTimeout = blockingTimeout
    }

    /// Mirrors `libssh2_session_set_blocking`: in blocking mode the callback drains the queue itself.
    nonisolated func setBlocking(_ blocking: Bool) {
        lock.lock()
        defer { lock.unlock() }
        self.blocking = blocking
    }

    /// Shuts the socket down (never closes or frees anything) and stops the queue. The first reason is kept.
    nonisolated func fail(_ reason: String) {
        lock.lock()
        defer { lock.unlock() }
        failLocked(reason)
    }

    /// The socket is about to be closed: the queue forgets it (a closed descriptor number can be reused) and stops.
    nonisolated func detach(_ reason: String) {
        lock.lock()
        defer { lock.unlock() }
        socket = -1
        failLocked(reason)
    }

    private func failLocked(_ reason: String) {
        guard failure == nil else { return }
        failure = reason
        if socket >= 0 { Darwin.shutdown(socket, SHUT_RDWR) }
        storage.removeAll()
        head = 0
    }

    /// The send callback's body: takes the whole buffer or fails. Returns what libssh2 expects of a send.
    nonisolated func accept(socket fd: Int32, bytes: UnsafeRawPointer?, length: Int) -> Int {
        lock.lock()
        defer { lock.unlock() }
        if failure != nil { return -Int(EPIPE) }
        if socket < 0 { socket = fd }
        guard length > 0, let bytes else { return 0 }
        if storage.count - head + length > currentMaxQueuedBytes {
            failLocked("more than \(currentMaxQueuedBytes / 1024) KB waited to be sent")
            return -Int(ENOBUFS)
        }
        if storage.count == head { stuckSince = nil }
        storage.append(contentsOf: UnsafeRawBufferPointer(start: bytes, count: length))
        if blocking {
            return drainBlockingLocked() ? length : -Int(EPIPE)
        }
        _ = flushLocked()
        return failure == nil ? length : -Int(EPIPE)
    }

    /// Writes what the socket takes now. True when it moved bytes; a dead socket or a stall fails the queue.
    @discardableResult
    nonisolated func flush() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return flushLocked()
    }

    private var currentMaxQueuedBytes: Int {
        #if GHOSTEX_SSH_HARNESS
        if Self.maxQueuedBytesOverride > 0 { return Self.maxQueuedBytesOverride }
        #endif
        return Self.maxQueuedBytes
    }

    private func flushLocked() -> Bool {
        guard failure == nil, socket >= 0 else { return false }
        var moved = false
        while head < storage.count {
            #if GHOSTEX_SSH_HARNESS
            if Self.holdSocketWrites { break }
            #endif
            let written = storage.withUnsafeBytes { raw -> Int in
                Darwin.send(socket, raw.baseAddress!.advanced(by: head), storage.count - head, MSG_DONTWAIT)
            }
            if written > 0 {
                head += written
                moved = true
                continue
            }
            let error = errno
            if written < 0, error == EAGAIN || error == EINTR { break }
            failLocked("the socket refused queued bytes (\(written < 0 ? String(cString: strerror(error)) : "closed"))")
            return moved
        }
        if head == storage.count {
            storage.removeAll(keepingCapacity: storage.capacity <= 1024 * 1024)
            head = 0
            stuckSince = nil
            return moved
        }
        if head > 64 * 1024, head * 2 > storage.count {
            storage.removeFirst(head)
            head = 0
        }
        if moved {
            stuckSince = Date()
        } else if let since = stuckSince {
            if Date().timeIntervalSince(since) >= Self.stallSeconds {
                failLocked("queued bytes made no progress for \(Int(Self.stallSeconds)) s")
            }
        } else {
            stuckSince = Date()
        }
        return moved
    }

    /// Blocking sections: every queued byte, earlier ones first, reaches the socket before libssh2 waits for a reply.
    private func drainBlockingLocked() -> Bool {
        let deadline = Date().addingTimeInterval(blockingTimeout)
        while failure == nil {
            _ = flushLocked()
            if failure != nil { return false }
            if head == storage.count { return true }
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 {
                failLocked("a blocking send did not drain within \(Int(blockingTimeout)) s")
                return false
            }
            var pfd = pollfd(fd: socket, events: Int16(POLLOUT), revents: 0)
            _ = poll(&pfd, 1, Int32(min(remaining, 0.25) * 1000) + 1)
        }
        return false
    }
}

/// libssh2's session abstract: the keyboard-interactive password and the send queue, reached from C callbacks.
final class SSHSessionContext: @unchecked Sendable {
    let sendQueue = SSHSendQueue()
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

    nonisolated static func from(_ abstract: UnsafeMutablePointer<UnsafeMutableRawPointer?>?) -> SSHSessionContext? {
        guard let abstract, let pointer = abstract.pointee else { return nil }
        return Unmanaged<SSHSessionContext>.fromOpaque(pointer).takeUnretainedValue()
    }
}

/// `LIBSSH2_CALLBACK_SEND`: copies every buffer into the session's queue and reports it sent in full.
nonisolated(unsafe) let sshQueuedSendCallback: @convention(c) (
    libssh2_socket_t,
    UnsafeRawPointer?,
    Int,
    Int32,
    UnsafeMutablePointer<UnsafeMutableRawPointer?>?
) -> Int = { socket, buffer, length, _, abstract in
    guard let context = SSHSessionContext.from(abstract) else { return -Int(EPIPE) }
    return context.sendQueue.accept(socket: socket, bytes: buffer, length: length)
}
