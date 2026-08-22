//
//  GhosttyTerminalView+SoftwareKeyboard.swift
//  GhostexNative
//
//  Software keyboard / IME text input, terminal key sending, UIKeyInput + traits, and the TerminalKey enum.
//  Moved verbatim from GhosttyTerminalView.swift (no logic changes).
//

import UIKit
import GhosttyKit

@MainActor
extension GhosttyTerminalView {
    // MARK: - Text Input from Software Keyboard

    /// Send text to the terminal (paste/insert; no newline added)
    func sendText(_ text: String) {
        guard canRouteTerminalInput else { return }
        surface?.sendText(text)
        requestRender()
    }

    func pasteTextFromClipboard() {
        guard canRouteTerminalInput else { return }
        _ = surface?.perform(action: "paste_from_clipboard")
        requestRender()
    }

    func sendTerminalInputText(_ text: String) {
        guard canRouteTerminalInput else { return }
        let normalized = text.precomposedStringWithCanonicalMapping
        guard normalized.count == 1, let character = normalized.first else {
            sendRawTerminalInputText(normalized, invalidateLocalSession: false)
            return
        }
        guard let mapping = GhosttyCharacterKeyMap.mapping(for: character) else {
            sendRawTerminalInputText(normalized, invalidateLocalSession: false)
            return
        }

        var mods: Ghostty.Input.Mods = []
        if mapping.requiresShift {
            mods.insert(.shift)
        }
        sendModifiedKey(
            mapping.key,
            mods: mods,
            text: mapping.text,
            unshiftedCodepoint: mapping.codepoint,
            invalidateLocalSession: false
        )
    }

    private func sendRawTerminalInputText(_ text: String, invalidateLocalSession: Bool = true) {
        guard canRouteTerminalInput else { return }
        let terminalText = text
            .replacingOccurrences(of: "\r\n", with: "\r")
            .replacingOccurrences(of: "\n", with: "\r")
        let data = Data(terminalText.utf8)
        guard !data.isEmpty else { return }

        if invalidateLocalSession {
            invalidateLocalTextInputSession()
        }
        if let writeCallback {
            writeCallback(data)
        } else {
            surface?.sendText(terminalText)
        }
        requestRender()
    }

    /// Handle text inserted by the software keyboard / IME.
    func handleInsertText(_ text: String, fromIMEComposition: Bool = false) {
        guard canRouteTerminalInput else { return }
        if isNativeSelectionTextInputContext {
            clearNativeSelectionStateForTerminalInput()
        }

        let normalized = text.precomposedStringWithCanonicalMapping
        guard !normalized.isEmpty else { return }
        if !keyModifiers.isEmpty {
            let modifiers = consumeKeyModifiers()
            invalidateLocalTextInputSession()
            if normalized == "\n" || normalized == "\r" {
                sendTerminalKey(.enter, accumulatedMods: modifiers)
                return
            }
            if normalized == "\t" {
                sendTerminalKey(.tab, accumulatedMods: modifiers)
                return
            }
            guard let first = normalized.first else { return }
            sendCharacterKey(first, mods: modifiers)
            let remaining = String(normalized.dropFirst())
            if !remaining.isEmpty {
                sendTerminalInputText(remaining)
            }
            return
        }
        if let key = terminalKey(forKeyCommandInput: normalized) {
            sendTerminalKey(key)
            return
        }
        if normalized.hasPrefix("UIKeyInput") {
            return
        }

        if !fromIMEComposition,
           let key = consumePendingSystemTextInputHardwareKey(),
           sendInterpretedHardwareKeyText(normalized, for: key) {
            invalidateLocalTextInputSession()
            return
        }

        if normalized == "\n" || normalized == "\r" {
            _ = textInputModel.invalidateSession()
            sendTerminalGhosttyKey(.enter, mods: [])
            return
        }
        if normalized == "\t" {
            _ = textInputModel.invalidateSession()
            sendTerminalGhosttyKey(.tab, mods: [])
            return
        }

        // Plain text goes into the persistent local document; the text input
        // model reconciles it with the terminal by sending the delta.
        applyTerminalTextInputEffects(
            textInputModel.handleInsert(
                TerminalTextInputModel.insertOperation(for: normalized, fromIMEComposition: fromIMEComposition)
            )
        )
    }

    func sendKeyPress(_ key: Ghostty.Input.Key) {
        guard canRouteTerminalInput else { return }
        guard let surface = surface else { return }
        surface.sendKeyEvent(.init(key: key, action: .press))
        surface.sendKeyEvent(.init(key: key, action: .release))
        requestRender()
    }

    private func sendControlByte(_ value: UInt8) {
        guard canRouteTerminalInput else { return }
        invalidateLocalTextInputSession()
        let scalar = UnicodeScalar(value)
        sendText(String(Character(scalar)))
    }

    private func sendAnsiSequence(_ data: Data) {
        guard canRouteTerminalInput else { return }
        invalidateLocalTextInputSession()
        let text = String(decoding: data, as: UTF8.self)
        sendText(text)
    }

    private func shouldDisplayVisiblePreedit(for text: String) -> Bool {
        TerminalVisiblePreeditPolicy.shouldDisplay(
            text,
            inputModePrimaryLanguage: currentIMEPrimaryLanguage
        )
    }

    private var currentIMEPrimaryLanguage: String? {
        textInputMode?.primaryLanguage
    }

    func syncIMEPreedit(_ text: String?) {
        let visibleText: String?
        if let text, !text.isEmpty {
            let normalized = text.precomposedStringWithCanonicalMapping
            visibleText = shouldDisplayVisiblePreedit(for: normalized) ? normalized : nil
        } else {
            visibleText = nil
        }

        guard visibleText != renderedIMEPreeditText else { return }
        renderedIMEPreeditText = visibleText

        guard let cSurface = surface?.unsafeCValue else { return }

        if let visibleText, !visibleText.isEmpty {
            let len = visibleText.utf8CString.count
            guard len > 0 else {
                ghostty_surface_preedit(cSurface, nil, 0)
                requestRender()
                return
            }
            visibleText.withCString { ptr in
                ghostty_surface_preedit(cSurface, ptr, UInt(len - 1))
            }
        } else {
            ghostty_surface_preedit(cSurface, nil, 0)
        }

        requestRender()
    }

    fileprivate func sendModifiedKey(
        _ key: Ghostty.Input.Key,
        mods: Ghostty.Input.Mods,
        text: String? = nil,
        unshiftedCodepoint: UInt32 = 0,
        invalidateLocalSession: Bool = true
    ) {
        guard canRouteTerminalInput else { return }
        guard let surface = surface else { return }
        if invalidateLocalSession {
            invalidateLocalTextInputSession()
        }
        let press = Ghostty.Input.KeyEvent(
            key: key,
            action: .press,
            text: text,
            composing: false,
            mods: mods,
            consumedMods: [],
            unshiftedCodepoint: unshiftedCodepoint
        )
        surface.sendKeyEvent(press)
        let release = Ghostty.Input.KeyEvent(
            key: key,
            action: .release,
            text: nil,
            composing: false,
            mods: mods,
            consumedMods: [],
            unshiftedCodepoint: unshiftedCodepoint
        )
        surface.sendKeyEvent(release)
        requestRender()
    }

    /// Send a special key to the terminal (raw escape-sequence path).
    func sendSpecialKey(_ key: TerminalSpecialKey) {
        guard surface != nil else { return }
        let shouldInvalidateSession: Bool = switch key {
        case .arrowLeft, .arrowRight, .home, .end, .escape:
            false
        default:
            true
        }
        if shouldInvalidateSession {
            invalidateLocalTextInputSession()
        }

        switch key {
        case .enter:
            sendControlByte(0x0D)
            return
        case .backspace:
            // DEL (0x7F) is the typical backspace for terminals.
            sendControlByte(0x7F)
            return
        default:
            break
        }

        let escapeSequence = TerminalSpecialKeySequence.escapeSequence(for: key)
        sendText(escapeSequence)
    }

    /// Send control key combination (e.g., Ctrl+C)
    func sendControlKey(_ char: Character) {
        guard surface != nil else { return }
        if let controlChar = TerminalControlKey.controlCharacter(for: char) {
            sendText(String(controlChar))
        }
    }

    // MARK: - Terminal Key Sending (used by the module sendKey + key commands)

    func setKeyModifiers(_ modifiers: Ghostty.Input.Mods, locked: Ghostty.Input.Mods) {
        keyModifiers = modifiers
        lockedKeyModifiers = locked
    }

    func clearKeyModifiers() {
        keyModifiers = []
        lockedKeyModifiers = []
    }

    func consumeKeyModifiersForAccessoryKey() {
        _ = consumeKeyModifiers()
    }

    private func consumeKeyModifiers() -> Ghostty.Input.Mods {
        let modifiers = keyModifiers
        let consumedOneShotModifiers = modifiers.subtracting(lockedKeyModifiers)
        keyModifiers = lockedKeyModifiers
        if !consumedOneShotModifiers.isEmpty {
            onKeyModifiersConsumed?()
        }
        return modifiers
    }

    func sendTerminalKey(_ key: TerminalKey, accumulatedMods: Ghostty.Input.Mods = []) {
        switch key {
        case .modified(let baseKey, let mods):
            sendTerminalKey(baseKey, accumulatedMods: accumulatedMods.union(mods))
        case .escape:
            if accumulatedMods.isEmpty, hasLocalTextInputSession {
                invalidateLocalTextInputSession()
            }
            sendTerminalGhosttyKey(.escape, mods: accumulatedMods, invalidateLocalSession: false)
        case .tab:
            sendTerminalGhosttyKey(.tab, mods: accumulatedMods)
        case .enter:
            sendTerminalGhosttyKey(.enter, mods: accumulatedMods)
        case .backspace:
            if accumulatedMods.isEmpty, hasLocalTextInputSession {
                deleteBackward()
            } else {
                sendTerminalGhosttyKey(.backspace, mods: accumulatedMods)
            }
        case .delete:
            sendTerminalGhosttyKey(.delete, mods: accumulatedMods)
        case .insert:
            sendTerminalGhosttyKey(.insert, mods: accumulatedMods)
        case .arrowUp:
            sendTerminalGhosttyKey(.arrowUp, mods: accumulatedMods)
        case .arrowDown:
            sendTerminalGhosttyKey(.arrowDown, mods: accumulatedMods)
        case .arrowLeft:
            sendTerminalGhosttyKey(.arrowLeft, mods: accumulatedMods)
        case .arrowRight:
            sendTerminalGhosttyKey(.arrowRight, mods: accumulatedMods)
        case .home:
            sendTerminalGhosttyKey(.home, mods: accumulatedMods)
        case .end:
            sendTerminalGhosttyKey(.end, mods: accumulatedMods)
        case .pageUp:
            sendTerminalGhosttyKey(.pageUp, mods: accumulatedMods)
        case .pageDown:
            sendTerminalGhosttyKey(.pageDown, mods: accumulatedMods)
        case .f1:
            sendTerminalGhosttyKey(.f1, mods: accumulatedMods)
        case .f2:
            sendTerminalGhosttyKey(.f2, mods: accumulatedMods)
        case .f3:
            sendTerminalGhosttyKey(.f3, mods: accumulatedMods)
        case .f4:
            sendTerminalGhosttyKey(.f4, mods: accumulatedMods)
        case .f5:
            sendTerminalGhosttyKey(.f5, mods: accumulatedMods)
        case .f6:
            sendTerminalGhosttyKey(.f6, mods: accumulatedMods)
        case .f7:
            sendTerminalGhosttyKey(.f7, mods: accumulatedMods)
        case .f8:
            sendTerminalGhosttyKey(.f8, mods: accumulatedMods)
        case .f9:
            sendTerminalGhosttyKey(.f9, mods: accumulatedMods)
        case .f10:
            sendTerminalGhosttyKey(.f10, mods: accumulatedMods)
        case .f11:
            sendTerminalGhosttyKey(.f11, mods: accumulatedMods)
        case .f12:
            sendTerminalGhosttyKey(.f12, mods: accumulatedMods)
        case .ctrlC:
            sendTerminalControlShortcut(.c, letter: "c", mods: accumulatedMods)
        case .ctrlD:
            sendTerminalControlShortcut(.d, letter: "d", mods: accumulatedMods)
        case .ctrlZ:
            sendTerminalControlShortcut(.z, letter: "z", mods: accumulatedMods)
        case .ctrlL:
            sendTerminalControlShortcut(.l, letter: "l", mods: accumulatedMods)
        case .ctrlA:
            sendTerminalControlShortcut(.a, letter: "a", mods: accumulatedMods)
        case .ctrlE:
            sendTerminalControlShortcut(.e, letter: "e", mods: accumulatedMods)
        case .ctrlJ:
            sendTerminalControlShortcut(.j, letter: "j", mods: accumulatedMods)
        case .ctrlK:
            sendTerminalControlShortcut(.k, letter: "k", mods: accumulatedMods)
        case .ctrlU:
            sendTerminalControlShortcut(.u, letter: "u", mods: accumulatedMods)
        }
    }

    func sendTerminalGhosttyKey(
        _ key: Ghostty.Input.Key,
        mods: Ghostty.Input.Mods,
        text: String? = nil,
        unshiftedCodepoint: UInt32? = nil,
        invalidateLocalSession: Bool = true
    ) {
        let codepoint = unshiftedCodepoint ?? text?.unicodeScalars.first?.value ?? 0
        sendModifiedKey(
            key,
            mods: mods,
            text: text,
            unshiftedCodepoint: codepoint,
            invalidateLocalSession: invalidateLocalSession
        )
    }

    private func sendTerminalControlShortcut(
        _ key: Ghostty.Input.Key,
        letter: String,
        mods: Ghostty.Input.Mods
    ) {
        var mergedMods = mods
        mergedMods.insert(.ctrl)
        let codepoint = letter.unicodeScalars.first?.value ?? 0
        sendTerminalGhosttyKey(key, mods: mergedMods, text: nil, unshiftedCodepoint: codepoint)
    }

    /// Send a single character with modifiers (module sendKey path).
    func sendCharacterKey(_ character: Character, mods: Ghostty.Input.Mods) {
        if let mapping = GhosttyCharacterKeyMap.mapping(for: character) {
            var mergedMods = mods
            if mapping.requiresShift { mergedMods.insert(.shift) }
            let hasShortcutModifier = mergedMods.contains(.ctrl) || mergedMods.contains(.alt) || mergedMods.contains(.super)
            let text = hasShortcutModifier ? nil : mapping.text
            sendTerminalGhosttyKey(
                mapping.key,
                mods: mergedMods,
                text: text,
                unshiftedCodepoint: mapping.codepoint
            )
            return
        }

        // Fallback: encode manually
        if mods.contains(.super) {
            return
        }
        var data = Data()
        if mods.contains(.alt) {
            data.append(0x1B)
        }
        if mods.contains(.ctrl), let controlChar = TerminalControlKey.controlCharacter(for: character) {
            data.append(contentsOf: String(controlChar).utf8)
        } else {
            data.append(contentsOf: String(character).utf8)
        }
        sendAnsiSequence(data)
    }
}

// MARK: - Terminal Key Enum

indirect enum TerminalKey {
    case escape, tab, enter, backspace, delete, insert
    case arrowUp, arrowDown, arrowLeft, arrowRight
    case home, end, pageUp, pageDown
    case f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12
    case ctrlC, ctrlD, ctrlZ, ctrlL, ctrlA, ctrlE, ctrlJ, ctrlK, ctrlU
    case modified(TerminalKey, mods: Ghostty.Input.Mods)

    func withCtrl() -> TerminalKey {
        withModifier(.ctrl)
    }

    func withAlt() -> TerminalKey {
        withModifier(.alt)
    }

    func withShift() -> TerminalKey {
        withModifier(.shift)
    }

    func withCommand() -> TerminalKey {
        withModifier(.super)
    }

    private func withModifier(_ modifier: Ghostty.Input.Mods) -> TerminalKey {
        switch self {
        case .modified(let key, let mods):
            return .modified(key, mods: mods.union(modifier))
        default:
            return .modified(self, mods: modifier)
        }
    }
}

// MARK: - Software Keyboard (UIKeyInput)

extension GhosttyTerminalView: UIKeyInput, UITextInputTraits {
    var hasText: Bool {
        if isNativeSelectionTextInputContext {
            return nativeSelectionSnapshot.length > 0 || (nativeSelectedRange?.length ?? 0) > 0
        }
        return true
    }

    func insertText(_ text: String) {
        if isNativeSelectionTextInputContext {
            guard exitNativeSelectionTextInputContextForTerminalInput() else { return }
        }
        let wasComposing = textInputModel.hasActiveIMEComposition
        handleInsertText(text, fromIMEComposition: wasComposing)
    }

    func deleteBackward() {
        if isNativeSelectionTextInputContext {
            guard exitNativeSelectionTextInputContextForTerminalInput() else { return }
        }
        if !keyModifiers.isEmpty {
            invalidateLocalTextInputSession()
            sendTerminalKey(.backspace, accumulatedMods: consumeKeyModifiers())
        } else {
            applyTerminalTextInputEffects(textInputModel.handleDeleteBackward())
        }
    }

    fileprivate func consumePendingSystemTextInputHardwareKey() -> UIKey? {
        guard !pendingSystemTextInputHardwareKeys.isEmpty else { return nil }
        return pendingSystemTextInputHardwareKeys.removeFirst()
    }

    func discardPendingSystemTextInputHardwareKey() {
        guard !pendingSystemTextInputHardwareKeys.isEmpty else { return }
        pendingSystemTextInputHardwareKeys.removeFirst()
    }

    func removeUnconsumedPendingSystemTextInputHardwareKeys(after pendingCount: Int) {
        guard pendingSystemTextInputHardwareKeys.count > pendingCount else { return }
        pendingSystemTextInputHardwareKeys.removeSubrange(pendingCount...)
    }

    @discardableResult
    func sendInterpretedHardwareKeyText(_ text: String, for key: UIKey) -> Bool {
        guard canRouteTerminalInput, let surface else { return false }
        guard let sourceEvent = Ghostty.Input.KeyEvent(uiKey: key, action: .press) else {
            sendText(text)
            return true
        }
        let keyCode = UInt16(key.keyCode.rawValue)
        let interpretedEvent = Ghostty.Input.KeyEvent(
            key: sourceEvent.key,
            action: .press,
            text: text.isEmpty ? sourceEvent.text : text,
            composing: false,
            mods: sourceEvent.mods,
            consumedMods: sourceEvent.consumedMods,
            unshiftedCodepoint: sourceEvent.unshiftedCodepoint
        )
        surface.sendKeyEvent(interpretedEvent)
        hardwarePressesSentToGhostty.insert(keyCode)
        systemTextInputPresses.remove(keyCode)
        requestRender()
        return true
    }

    var keyboardType: UIKeyboardType {
        get { .default }
        set { }
    }

    var keyboardAppearance: UIKeyboardAppearance {
        get { .dark }
        set { }
    }

    var autocorrectionType: UITextAutocorrectionType {
        get { .no }
        set { }
    }

    var autocapitalizationType: UITextAutocapitalizationType {
        get { .none }
        set { }
    }

    var spellCheckingType: UITextSpellCheckingType {
        get { .no }
        set { }
    }

    var smartQuotesType: UITextSmartQuotesType {
        get { .no }
        set { }
    }

    var smartDashesType: UITextSmartDashesType {
        get { .no }
        set { }
    }

    var smartInsertDeleteType: UITextSmartInsertDeleteType {
        get { .no }
        set { }
    }

    @available(iOS 17.0, *)
    var inlinePredictionType: UITextInlinePredictionType {
        get { .no }
        set { }
    }

    var enablesReturnKeyAutomatically: Bool {
        get { false }
        set { }
    }

    var returnKeyType: UIReturnKeyType {
        get { .default }
        set { }
    }
}
