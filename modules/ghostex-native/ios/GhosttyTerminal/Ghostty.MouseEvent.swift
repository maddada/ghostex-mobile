//
//  Ghostty.MouseEvent.swift
//  GhostexNative
//
//  Ported from VVTerm/GhosttyTerminal/Ghostty.MouseEvent.swift, macOS paths dropped.
//

import Foundation
import UIKit
import GhosttyKit

extension Ghostty.Input {
    /// Represents a mouse input event with button state, button type, and modifier keys.
    struct MouseButtonEvent {
        let action: MouseState
        let button: MouseButton
        let mods: Mods

        init(
            action: MouseState,
            button: MouseButton,
            mods: Mods = []
        ) {
            self.action = action
            self.button = button
            self.mods = mods
        }
    }

    /// Represents a mouse position/movement event with coordinates and modifier keys.
    struct MousePosEvent {
        let x: Double
        let y: Double
        let mods: Mods

        init(
            x: Double,
            y: Double,
            mods: Mods = []
        ) {
            self.x = x
            self.y = y
            self.mods = mods
        }
    }

    /// Represents a mouse scroll event with scroll deltas and modifier keys.
    struct MouseScrollEvent {
        let x: Double
        let y: Double
        let mods: ScrollMods

        init(
            x: Double,
            y: Double,
            mods: ScrollMods = .init(rawValue: 0)
        ) {
            self.x = x
            self.y = y
            self.mods = mods
        }
    }
}

// MARK: Ghostty.Input.MouseState

extension Ghostty.Input {
    /// `ghostty_input_mouse_state_e`
    enum MouseState: String, CaseIterable {
        case release
        case press

        var cMouseState: ghostty_input_mouse_state_e {
            switch self {
            case .release: GHOSTTY_MOUSE_RELEASE
            case .press: GHOSTTY_MOUSE_PRESS
            }
        }
    }
}

// MARK: Ghostty.Input.MouseButton

extension Ghostty.Input {
    /// `ghostty_input_mouse_button_e`
    enum MouseButton: String, CaseIterable {
        case unknown
        case left
        case right
        case middle

        var cMouseButton: ghostty_input_mouse_button_e {
            switch self {
            case .unknown: GHOSTTY_MOUSE_UNKNOWN
            case .left: GHOSTTY_MOUSE_LEFT
            case .right: GHOSTTY_MOUSE_RIGHT
            case .middle: GHOSTTY_MOUSE_MIDDLE
            }
        }
    }
}

// MARK: Ghostty.Input.Momentum

extension Ghostty.Input {
    /// `ghostty_input_mouse_momentum_e` - Momentum phase for scroll events
    enum Momentum: UInt8, CaseIterable {
        case none = 0
        case began = 1
        case stationary = 2
        case changed = 3
        case ended = 4
        case cancelled = 5
        case mayBegin = 6

        var cMomentum: ghostty_input_mouse_momentum_e {
            switch self {
            case .none: GHOSTTY_MOUSE_MOMENTUM_NONE
            case .began: GHOSTTY_MOUSE_MOMENTUM_BEGAN
            case .stationary: GHOSTTY_MOUSE_MOMENTUM_STATIONARY
            case .changed: GHOSTTY_MOUSE_MOMENTUM_CHANGED
            case .ended: GHOSTTY_MOUSE_MOMENTUM_ENDED
            case .cancelled: GHOSTTY_MOUSE_MOMENTUM_CANCELLED
            case .mayBegin: GHOSTTY_MOUSE_MOMENTUM_MAY_BEGIN
            }
        }
    }
}
