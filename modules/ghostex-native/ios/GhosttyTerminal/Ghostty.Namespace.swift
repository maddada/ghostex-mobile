//
//  Ghostty.Namespace.swift
//  GhostexNative
//
//  Ported from the VVTerm fork (VVTerm/GhosttyTerminal). iOS only.
//

import Foundation
import OSLog
import UIKit
import GhosttyKit

/// Namespace for the libghostty Swift wrapper.
enum Ghostty {
    static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "app.ghostex.mobile",
        category: "Ghostty"
    )
}

/// Minimal clipboard helper (replaces VVTerm's Core/Terminal Clipboard +
/// TerminalTextCleaner integration; no copy transformations in the module).
enum Clipboard {
    static func readString() -> String? {
        UIPasteboard.general.string
    }

    static func copy(_ string: String) {
        UIPasteboard.general.string = string
    }
}
