//
//  SSHUpload.swift
//  GhostexNative
//
//  File uploads over the connection: SCP, with an exec (`cat >`) fallback.
//

import Foundation
import libssh2

extension SSHConnection {
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

    /**
     * Opens an upload's channel under the channel-open claim. Every wait can outlive the session, so it is checked
     * again after each one (`liveSession`); an open the caller gives up on (cancelled, or the session went) after
     * libssh2 started it is finished without the upload (SSHChannelOpens.swift), never left for the next opener.
     */
    private func openUploadChannel(
        generation: Int,
        what: String,
        open: @escaping (OpaquePointer) -> OpaquePointer?
    ) async throws -> OpaquePointer {
        let opener = try await awaitChannelOpenClaim(timeout: config.connectionTimeout)
        // SCP's startup includes the remote scp's acknowledgement, which libssh2 waits for without a bound.
        let deadline = Date().addingTimeInterval(Self.abandonedOpenLimit)
        var started = false
        do {
            while true {
                try Task.checkCancellation()
                if started, Date() >= deadline { throw SSHError.timeout }
                let session = try liveSession(since: generation)
                if let channel = open(session) {
                    releaseChannelOpen(opener)
                    return channel
                }
                let lastError = libssh2_session_last_errno(session)
                guard lastError == LIBSSH2_ERROR_EAGAIN else {
                    releaseChannelOpen(opener)
                    throw SSHError.sftpFailed("\(what) channel open failed: \(lastError)")
                }
                started = true
                await waitForSocket()
            }
        } catch {
            let timedOut: Bool
            if case SSHError.timeout = error { timedOut = true } else { timedOut = false }
            if started, channelOpenClaim == opener, sessionGeneration == generation, libssh2Session != nil,
                timedOut || !(error is SSHError) {
                abandonOpen(AbandonedChannelOpen(owner: opener, holdsCommandSlot: false, what: what, resume: open))
            } else if channelOpenClaim == opener {
                releaseChannelOpen(opener)
            }
            throw error
        }
    }

    /// Closes an upload's channel through the closing queue, unless the session (and the channel with it) is gone.
    private func retireUploadChannel(_ channel: OpaquePointer, generation: Int) {
        guard sessionGeneration == generation, libssh2Session != nil else { return }
        retireChannel(channel)
    }

    private func uploadViaSCP(_ data: Data, to remotePath: String, permissions: Int32) async throws {
        let generation = sessionGeneration
        guard libssh2Session != nil else {
            throw SSHError.notConnected
        }
        guard !remotePath.isEmpty else {
            throw SSHError.sftpFailed("Upload path is empty")
        }
        logger.info("Opening SCP upload channel [path: \(remotePath, privacy: .public)]")

        let size = Int64(data.count)
        let scpChannel = try await openUploadChannel(generation: generation, what: "SCP") { session in
            remotePath.withCString { libssh2_scp_send64(session, $0, permissions, size, 0, 0) }
        }
        // `finishUploadChannel` frees the channel: only a failure before it returns retires it.
        let exitStatus: Int32
        do {
            try await writeUpload(data, to: scpChannel, generation: generation, what: "SCP")
            exitStatus = try await finishUploadChannel(scpChannel, generation: generation)
        } catch {
            retireUploadChannel(scpChannel, generation: generation)
            throw error
        }
        // The remote scp reports a failed write (a full disk) only in its exit status; the exec upload is tried next.
        guard exitStatus == 0 else {
            throw SSHError.sftpFailed("SCP upload failed with exit status \(exitStatus)")
        }
        logger.info("SCP upload finished [path: \(remotePath, privacy: .public)]")
    }

    private func uploadViaExec(_ data: Data, to remotePath: String) async throws {
        let generation = sessionGeneration
        guard libssh2Session != nil else {
            throw SSHError.notConnected
        }
        guard !remotePath.isEmpty else {
            throw SSHError.sftpFailed("Upload path is empty")
        }
        logger.info("Opening exec upload channel [path: \(remotePath, privacy: .public)]")

        let quotedPath = Self.shellQuoted(remotePath)
        let command = "cat > \(quotedPath) && chmod 600 \(quotedPath)"

        let execChannel = try await openUploadChannel(generation: generation, what: "Exec upload") { session in
            Self.openSessionChannel(session)
        }
        let exitStatus: Int32
        do {
            _ = libssh2_channel_handle_extended_data2(
                execChannel,
                LIBSSH2_CHANNEL_EXTENDED_DATA_IGNORE
            )

            while true {
                try Task.checkCancellation()
                _ = try liveSession(since: generation)
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

            try await writeUpload(data, to: execChannel, generation: generation, what: "Exec upload")
            exitStatus = try await finishUploadChannel(execChannel, generation: generation, drainOutput: true)
        } catch {
            retireUploadChannel(execChannel, generation: generation)
            throw error
        }
        // Checked after the catch: `finishUploadChannel` already freed the channel (retiring it again was a double free).
        guard exitStatus == 0 else {
            throw SSHError.sftpFailed("Exec upload failed with exit status \(exitStatus)")
        }
        logger.info("Exec upload finished [path: \(remotePath, privacy: .public)]")
    }

    private func writeUpload(_ data: Data, to channel: OpaquePointer, generation: Int, what: String) async throws {
        let bytes = [UInt8](data)
        var offset = 0
        while offset < bytes.count {
            try Task.checkCancellation()
            _ = try liveSession(since: generation)
            if sendQueue.pendingBytes > SSHSendQueue.backpressureBytes {
                await waitForSocket()
                continue
            }
            let written = bytes.withUnsafeBufferPointer { buffer -> Int in
                guard let baseAddress = buffer.baseAddress else { return -1 }
                let pointer = UnsafeRawPointer(baseAddress.advanced(by: offset)).assumingMemoryBound(to: CChar.self)
                return Int(libssh2_channel_write_ex(channel, 0, pointer, bytes.count - offset))
            }

            if written > 0 {
                offset += written
            } else if written == Int(LIBSSH2_ERROR_EAGAIN) {
                await waitForSocket()
            } else {
                throw SSHError.sftpFailed("\(what) write failed: \(written)")
            }
        }
    }

    /// Repeats `step` until it stops answering EAGAIN, checking the session after every wait.
    private func untilDone(
        generation: Int,
        failure: String,
        _ step: () throws -> Int32
    ) async throws {
        while true {
            try Task.checkCancellation()
            _ = try liveSession(since: generation)
            let result = try step()
            if result == 0 { return }
            if result == Int32(LIBSSH2_ERROR_EAGAIN) {
                await waitForSocket()
                continue
            }
            throw SSHError.sftpFailed("\(failure): \(result)")
        }
    }

    private func finishUploadChannel(
        _ channel: OpaquePointer,
        generation: Int,
        drainOutput: Bool = false
    ) async throws -> Int32 {
        try await untilDone(generation: generation, failure: "Upload send EOF failed") { libssh2_channel_send_eof(channel) }
        while true {
            try Task.checkCancellation()
            _ = try liveSession(since: generation)
            if drainOutput {
                try drainChannelOutput(channel)
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
        try await untilDone(generation: generation, failure: "Upload close failed") { libssh2_channel_close(channel) }
        try await untilDone(generation: generation, failure: "Upload wait close failed") {
            libssh2_channel_wait_closed(channel)
        }

        let exitStatus = libssh2_channel_get_exit_status(channel)
        libssh2_channel_free(channel)
        return exitStatus
    }

    private func drainChannelOutput(_ channel: OpaquePointer) throws {
        var buffer = [CChar](repeating: 0, count: 4096)

        while true {
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
