//
//  Ghostty.Input.swift
//  GhostexNative
//
//  Ported from VVTerm/GhosttyTerminal/Ghostty.Input.swift, macOS paths dropped.
//

import UIKit
import GhosttyKit

extension Ghostty {
    // Input types split into separate files: Ghostty.Key.swift,
    // Ghostty.MouseEvent.swift, Ghostty.KeyEvent.swift, Ghostty.Mods.swift
    struct Input {}

    // MARK: iOS Modifier Conversion

    /// Translate UIKeyModifierFlags to a ghostty mods enum.
    static func ghosttyMods(_ flags: UIKeyModifierFlags) -> ghostty_input_mods_e {
        var mods: UInt32 = GHOSTTY_MODS_NONE.rawValue

        if flags.contains(.shift) { mods |= GHOSTTY_MODS_SHIFT.rawValue }
        if flags.contains(.control) { mods |= GHOSTTY_MODS_CTRL.rawValue }
        if flags.contains(.alternate) { mods |= GHOSTTY_MODS_ALT.rawValue }
        if flags.contains(.command) { mods |= GHOSTTY_MODS_SUPER.rawValue }
        if flags.contains(.alphaShift) { mods |= GHOSTTY_MODS_CAPS.rawValue }

        return ghostty_input_mods_e(mods)
    }
}
