//
//  TerminalSupport.swift
//  GhostexNative
//
//  Supporting value types ported from VVTerm's Core/Terminal:
//  TerminalDefaults (slimmed, no persistence seeding), TerminalZoomPresentation,
//  TerminalPresentationOverrides/TerminalZoomAction/TerminalZoomResult,
//  TerminalGridPoint/TerminalGridSelection, TerminalKeyboardFocusPolicy,
//  TerminalHardwareTextInputRoutingPolicy, TerminalVisiblePreeditPolicy.
//

import Foundation
import UIKit

// MARK: - Terminal Defaults (slimmed: fixed dark defaults, no AppStorage)

enum TerminalDefaults {
    static let minimumFontSize = 4.0
    static let maximumFontSize = 32.0
    static let fontSizeStep = 1.0

    static let defaultFontSize = 13.0

    /// Scrollback row limit choices exposed by the JS settings contract.
    static let defaultScrollbackRows = 10000
    static let allowedScrollbackRows: Set<Int> = [2000, 10000, 50000]

    nonisolated static func clampedFontSize(_ fontSize: Double) -> Double {
        min(max(fontSize.rounded(), minimumFontSize), maximumFontSize)
    }
}

// MARK: - Runtime Settings (module-global, set via setTerminalSettings)

/// Module-global terminal behavior settings mirroring the JS
/// TerminalRuntimeSettings contract. Defaults match the pre-settings-screen
/// behavior so terminals opened before the first JS push are unchanged.
struct TerminalRuntimeSettings {
    enum CursorStyle: String {
        case block
        case underline
        case bar
    }

    var autoScroll = true
    var cursorStyle: CursorStyle = .bar
    var cursorBlink = true
    var softKeyboardEnabled = true
    var openUrlsOnTap = true
}

// MARK: - Zoom

enum TerminalZoomAction {
    case zoomIn
    case zoomOut
    case reset
}

struct TerminalZoomResult: Hashable {
    let presentationOverrides: TerminalPresentationOverrides
    let effectiveFontSize: Double
}

struct TerminalPresentationOverrides: Codable, Hashable {
    static let empty = TerminalPresentationOverrides()

    var fontSize: Double?

    init(fontSize: Double? = nil) {
        self.fontSize = fontSize.map(TerminalDefaults.clampedFontSize)
    }

    var isEmpty: Bool {
        fontSize == nil
    }

    func resolvedFontSize() -> Double {
        fontSize ?? TerminalDefaults.defaultFontSize
    }

    func applyingZoom(_ action: TerminalZoomAction) -> TerminalPresentationOverrides {
        var overrides = self
        let currentFontSize = resolvedFontSize()

        switch action {
        case .zoomIn:
            overrides.fontSize = TerminalDefaults.clampedFontSize(currentFontSize + TerminalDefaults.fontSizeStep)
        case .zoomOut:
            overrides.fontSize = TerminalDefaults.clampedFontSize(currentFontSize - TerminalDefaults.fontSizeStep)
        case .reset:
            overrides.fontSize = nil
        }

        return overrides
    }
}

enum TerminalZoomPresentation {
    static let pinchZoomInThreshold = 1.12
    static let pinchZoomOutThreshold = 0.89
    static let indicatorFadeInDuration = 0.12
    static let indicatorFadeOutDuration = 0.18
    static let indicatorHideDelay = 0.8
    static let indicatorGestureEndHideDelay = 0.45
    static let indicatorMinimumWidth = 112.0
    static let indicatorMinimumHeight = 72.0

    static var indicatorTitle: String {
        "Font Size"
    }

    static func formattedFontSize(_ fontSize: Double) -> String {
        String(format: "%.0f pt", fontSize)
    }
}

// MARK: - Grid Selection

struct TerminalGridPoint: Comparable, Equatable {
    var row: Int
    var column: Int

    static func < (lhs: TerminalGridPoint, rhs: TerminalGridPoint) -> Bool {
        if lhs.row == rhs.row {
            return lhs.column < rhs.column
        }
        return lhs.row < rhs.row
    }
}

struct TerminalGridSelection: Equatable {
    var start: TerminalGridPoint
    var end: TerminalGridPoint

    var orderedStart: TerminalGridPoint {
        min(start, end)
    }

    var orderedEnd: TerminalGridPoint {
        max(start, end)
    }

    var normalized: TerminalGridSelection {
        .init(start: orderedStart, end: orderedEnd)
    }
}

// MARK: - Keyboard Focus Policy

enum TerminalKeyboardFocusReason {
    case explicitUserRequest
    case initialActivation
    case reconnectRestore
    case directTouch
    case terminalTap
    case selectionGesture
    case hardwareKeyboard
}

struct TerminalKeyboardFocusPolicy {
    private enum Mode {
        case typing
        case browse
    }

    private var mode: Mode = .typing
    private(set) var shouldRestoreOnReconnect = false

    var allowsAutomaticFocus: Bool {
        mode == .typing
    }

    var isBrowsing: Bool {
        mode == .browse
    }

    mutating func requestFocus(for reason: TerminalKeyboardFocusReason) -> Bool {
        switch reason {
        case .explicitUserRequest, .terminalTap, .hardwareKeyboard:
            mode = .typing
            shouldRestoreOnReconnect = true
            return true
        case .initialActivation, .directTouch, .selectionGesture:
            guard mode == .typing else { return false }
            shouldRestoreOnReconnect = true
            return true
        case .reconnectRestore:
            return mode == .typing && shouldRestoreOnReconnect
        }
    }

    mutating func dismissForUser() {
        mode = .browse
        shouldRestoreOnReconnect = false
    }

    mutating func markForReconnect() {
        guard mode == .typing else { return }
        shouldRestoreOnReconnect = true
    }

    mutating func clearReconnect() {
        shouldRestoreOnReconnect = false
    }
}

// MARK: - Hardware Text Input Routing Policy

enum TerminalHardwareTextInputRoutingPolicy {
    static func shouldRoutePressToSystemTextInput(
        hasControlModifier: Bool,
        hasAlternateModifier: Bool,
        hasCommandModifier: Bool,
        hasActiveIMEComposition: Bool,
        isSystemTextInputToggleKey: Bool,
        hasTerminalFallbackKey: Bool,
        keyProducesText: Bool
    ) -> Bool {
        if hasCommandModifier {
            return false
        }
        if hasActiveIMEComposition {
            return true
        }
        if hasControlModifier {
            return false
        }
        if isSystemTextInputToggleKey {
            return true
        }
        if hasTerminalFallbackKey {
            return false
        }
        if hasAlternateModifier {
            return keyProducesText
        }
        if keyProducesText {
            return true
        }
        return false
    }

    static func shouldRecordPendingInterpretedHardwareKey(
        keyProducesText: Bool,
        hasControlModifier: Bool,
        hasAlternateModifier: Bool,
        hasCommandModifier: Bool,
        hasActiveIMEComposition: Bool,
        isSystemTextInputToggleKey: Bool
    ) -> Bool {
        keyProducesText
            && !hasActiveIMEComposition
            && !hasControlModifier
            && !hasAlternateModifier
            && !hasCommandModifier
            && !isSystemTextInputToggleKey
    }
}

// MARK: - Visible Preedit Policy

enum TerminalVisiblePreeditPolicy {
    static func shouldDisplay(_ text: String, inputModePrimaryLanguage: String?) -> Bool {
        let normalized = text.precomposedStringWithCanonicalMapping
        let trimmed = normalized.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        if containsNativePreeditScript(in: normalized) {
            return true
        }

        guard allowsRomanizedPreedit(for: inputModePrimaryLanguage) else {
            return false
        }

        return normalized.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) ||
                CharacterSet.whitespacesAndNewlines.contains(scalar) ||
                scalar == "'" ||
                scalar == "-"
        }
    }

    private static func allowsRomanizedPreedit(for inputModePrimaryLanguage: String?) -> Bool {
        guard let normalizedLanguage = inputModePrimaryLanguage?.lowercased() else { return false }
        return normalizedLanguage.hasPrefix("zh") || normalizedLanguage.hasPrefix("ja")
    }

    private static func containsNativePreeditScript(in text: String) -> Bool {
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 0x1100...0x11FF,   // Hangul Jamo
                 0x3130...0x318F,   // Hangul Compatibility Jamo
                 0xA960...0xA97F,   // Hangul Jamo Extended-A
                 0xAC00...0xD7AF,   // Hangul Syllables
                 0xD7B0...0xD7FF,   // Hangul Jamo Extended-B
                 0x3040...0x309F,   // Hiragana
                 0x30A0...0x30FF,   // Katakana
                 0x31F0...0x31FF,   // Katakana Phonetic Extensions
                 0x3400...0x4DBF,   // CJK Unified Ideographs Extension A
                 0x4E00...0x9FFF,   // CJK Unified Ideographs
                 0xF900...0xFAFF,   // CJK Compatibility Ideographs
                 0x20000...0x2A6DF, // CJK Unified Ideographs Extension B
                 0x2A700...0x2B73F, // Extension C
                 0x2B740...0x2B81F, // Extension D
                 0x2B820...0x2CEAF, // Extension E/F
                 0x2CEB0...0x2EBEF, // Extension G/I
                 0x3100...0x312F,   // Bopomofo
                 0x31A0...0x31BF:   // Bopomofo Extended
                return true
            default:
                continue
            }
        }
        return false
    }
}

// MARK: - Character to Ghostty Key Mapping (US layout)

/// Replaces VVTerm's TerminalAccessoryShortcutKey lookup: maps a single
/// character typed on the software keyboard to a physical Ghostty key so the
/// terminal receives full key events (and correct encodings) when possible.
enum GhosttyCharacterKeyMap {
    struct Mapping {
        let key: Ghostty.Input.Key
        let text: String?
        let codepoint: UInt32
        let requiresShift: Bool
    }

    /// unshifted-char -> key
    private static let unshifted: [Character: Ghostty.Input.Key] = {
        var map: [Character: Ghostty.Input.Key] = [:]
        let letters: [(Character, Ghostty.Input.Key)] = [
            ("a", .a), ("b", .b), ("c", .c), ("d", .d), ("e", .e), ("f", .f),
            ("g", .g), ("h", .h), ("i", .i), ("j", .j), ("k", .k), ("l", .l),
            ("m", .m), ("n", .n), ("o", .o), ("p", .p), ("q", .q), ("r", .r),
            ("s", .s), ("t", .t), ("u", .u), ("v", .v), ("w", .w), ("x", .x),
            ("y", .y), ("z", .z),
            ("0", .digit0), ("1", .digit1), ("2", .digit2), ("3", .digit3),
            ("4", .digit4), ("5", .digit5), ("6", .digit6), ("7", .digit7),
            ("8", .digit8), ("9", .digit9),
            ("-", .minus), ("=", .equal), ("[", .bracketLeft), ("]", .bracketRight),
            ("\\", .backslash), (";", .semicolon), ("'", .quote), ("`", .backquote),
            (",", .comma), (".", .period), ("/", .slash), (" ", .space),
        ]
        for (char, key) in letters {
            map[char] = key
        }
        return map
    }()

    /// shifted-char -> (unshifted-char producing it, key)
    private static let shifted: [Character: (unshifted: Character, key: Ghostty.Input.Key)] = {
        var map: [Character: (Character, Ghostty.Input.Key)] = [:]
        let pairs: [(Character, Character, Ghostty.Input.Key)] = [
            ("!", "1", .digit1), ("@", "2", .digit2), ("#", "3", .digit3),
            ("$", "4", .digit4), ("%", "5", .digit5), ("^", "6", .digit6),
            ("&", "7", .digit7), ("*", "8", .digit8), ("(", "9", .digit9),
            (")", "0", .digit0), ("_", "-", .minus), ("+", "=", .equal),
            ("{", "[", .bracketLeft), ("}", "]", .bracketRight),
            ("|", "\\", .backslash), (":", ";", .semicolon), ("\"", "'", .quote),
            ("~", "`", .backquote), ("<", ",", .comma), (">", ".", .period),
            ("?", "/", .slash),
        ]
        for (shiftedChar, unshiftedChar, key) in pairs {
            map[shiftedChar] = (unshiftedChar, key)
        }
        let uppercase: [(Character, Character, Ghostty.Input.Key)] = unshifted.compactMap { entry in
            guard entry.key.isLetter, let upper = String(entry.key).uppercased().first else { return nil }
            return (upper, entry.key, entry.value)
        }
        for (shiftedChar, unshiftedChar, key) in uppercase {
            map[shiftedChar] = (unshiftedChar, key)
        }
        return map
    }()

    static func mapping(for character: Character) -> Mapping? {
        if let key = unshifted[character] {
            let codepoint = String(character).unicodeScalars.first?.value ?? 0
            return Mapping(key: key, text: String(character), codepoint: codepoint, requiresShift: false)
        }
        if let (unshiftedChar, key) = shifted[character] {
            let codepoint = String(unshiftedChar).unicodeScalars.first?.value ?? 0
            return Mapping(key: key, text: String(character), codepoint: codepoint, requiresShift: true)
        }
        return nil
    }
}
