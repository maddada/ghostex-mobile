//
//  SSHChannelOpens.swift
//  GhostexNative
//
//  Channel opens whose caller stopped waiting, and the session-lifetime checks every suspended operation repeats.
//

import Foundation
import libssh2

/// An open libssh2 has started that nobody waits for any more. Only ever touched on the SSHConnection actor.
final class AbandonedChannelOpen {
    /// The channel-open claim it keeps until libssh2's open settles.
    let owner: UUID
    /// A command's open: it keeps its native command slot until then too.
    let holdsCommandSlot: Bool
    /// The same libssh2 call the opener made, with the same arguments (libssh2 resumes the session's open state).
    let resume: (OpaquePointer) -> OpaquePointer?
    let what: String

    init(owner: UUID, holdsCommandSlot: Bool, what: String, resume: @escaping (OpaquePointer) -> OpaquePointer?) {
        self.owner = owner
        self.holdsCommandSlot = holdsCommandSlot
        self.what = what
        self.resume = resume
    }
}

extension SSHConnection {
    /**
     * CDXC:RemoteMachines 2026-11-14 WHY:
     * libssh2 keeps a channel open's state on the session, not on the channel, and the next open call on the session
     * resumes it whatever the call (channel.c `_libssh2_channel_open`). A command whose deadline passed, a forward's
     * open that timed out and an upload that was cancelled used to release the channel-open claim mid-open, so the
     * next opener (maybe of another type) adopted the old open: it could wait the old open's timeout, get the old
     * channel, and the late channel was never closed. The caller still settles at once; the open itself is handed
     * here, keeps the claim (and a command's native slot), and is driven by the io loop with the same libssh2 call
     * until it settles: a channel that opens late is closed without running anything, a failure just ends it. libssh2's
     * own read timeout (60 s) bounds it.
     * SEE-ALSO: SSHConnection.swift (`finishExecRequest`, the uploads), SSHPortForward.swift (`openDirectChannel`).
     */
    func abandonOpen(_ open: AbandonedChannelOpen) {
        logger.info("channel open for \(open.what, privacy: .public) abandoned by its caller; finishing it")
        abandonedOpens.append(open)
        startIOLoop()
    }

    /// One pass over the abandoned opens. Returns true when one settled.
    func driveAbandonedOpens() -> Bool {
        guard !abandonedOpens.isEmpty, let session = libssh2Session else { return false }
        var moved = false
        for open in abandonedOpens {
            if let channel = open.resume(session) {
                settleAbandonedOpen(open)
                retireChannel(channel, holdsCommandSlot: open.holdsCommandSlot)
                moved = true
            } else if libssh2_session_last_errno(session) != LIBSSH2_ERROR_EAGAIN {
                settleAbandonedOpen(open)
                moved = true
            }
        }
        return moved
    }

    private func settleAbandonedOpen(_ open: AbandonedChannelOpen) {
        abandonedOpens.removeAll { $0 === open }
        releaseChannelOpen(open.owner)
    }

    /**
     * The session as it was when an operation began, after a suspension: a disconnect or a dead transport in between
     * freed it (and every channel on it), so the operation must not touch the pointers it holds.
     */
    func liveSession(since generation: Int) throws -> OpaquePointer {
        guard sessionGeneration == generation, !transportDeadOrFailing, let session = libssh2Session else {
            throw SSHError.notConnected
        }
        return session
    }
}
