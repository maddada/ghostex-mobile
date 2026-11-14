//
//  GhostexErrors.swift
//  GhostexNative
//
//  Contract error codes (docs/ARCHITECTURE.md): promise rejections carry the
//  code so JS can map them to human copy.
//

import Foundation
import ExpoModulesCore

enum GhostexErrorCode: String {
    case authFailed = "E_AUTH_FAILED"
    case hostKeyMismatch = "E_HOST_KEY_MISMATCH"
    case unreachable = "E_UNREACHABLE"
    case refused = "E_REFUSED"
    case timeout = "E_TIMEOUT"
    case notConnected = "E_NOT_CONNECTED"
    case channelFailed = "E_CHANNEL_FAILED"
    case sftpFailed = "E_SFTP_FAILED"
    /// exec: every native command slot is held (some by commands still closing); the command never ran.
    case busy = "E_BUSY"
    /// startPortForward: the remote accepted the request but nothing listens on that port.
    case portNotListening = "E_PORT_NOT_LISTENING"
    /// startPortForward: the remote sshd refuses direct-tcpip channels.
    case forwardingProhibited = "E_FORWARDING_PROHIBITED"
    /// shareFile (iOS): no share sheet could be shown (no screen, UIKit refused it, not a local file).
    case shareUnavailable = "E_SHARE_UNAVAILABLE"
    /// shareFile (iOS): the activity the person picked reported an error.
    case shareFailed = "E_SHARE_FAILED"
    /// shareFile (iOS): the sheet ended before it reported a result (its presenter went away, or a reload).
    case shareInterrupted = "E_SHARE_INTERRUPTED"
}

/// Expo exception carrying a contract error code.
final class GhostexException: Exception {
    private let customCode: String
    private let customReason: String

    init(code: GhostexErrorCode, reason: String) {
        self.customCode = code.rawValue
        self.customReason = reason
        super.init()
    }

    override var code: String { customCode }
    override var reason: String { customReason }
}

extension GhostexErrorCode {
    /// Map an SSH layer error onto the contract error code.
    static func from(_ error: Error) -> GhostexErrorCode {
        guard let sshError = error as? SSHError else {
            if error is CancellationError {
                return .channelFailed
            }
            return .channelFailed
        }
        switch sshError {
        case .authenticationFailed:
            return .authFailed
        case .hostKeyVerificationFailed:
            return .hostKeyMismatch
        case .connectionRefused:
            return .refused
        case .timeout, .openTimedOut:
            return .timeout
        case .busy:
            return .busy
        case .notConnected:
            return .notConnected
        case .connectionFailed, .unknown:
            return .unreachable
        case .channelOpenFailed, .shellRequestFailed, .socketError, .portOutOfRange:
            return .channelFailed
        case .sftpFailed:
            return .sftpFailed
        case .portForwardNotListening:
            return .portNotListening
        case .portForwardingProhibited:
            return .forwardingProhibited
        }
    }
}

func ghostexException(from error: Error) -> GhostexException {
    if let exception = error as? GhostexException {
        return exception
    }
    return GhostexException(
        code: GhostexErrorCode.from(error),
        reason: (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    )
}
