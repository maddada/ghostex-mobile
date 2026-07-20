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
        case .timeout:
            return .timeout
        case .notConnected:
            return .notConnected
        case .connectionFailed, .unknown:
            return .unreachable
        case .channelOpenFailed, .shellRequestFailed, .socketError:
            return .channelFailed
        case .sftpFailed:
            return .sftpFailed
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
