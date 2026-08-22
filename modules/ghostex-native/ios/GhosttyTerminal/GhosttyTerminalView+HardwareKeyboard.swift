//
//  GhosttyTerminalView+HardwareKeyboard.swift
//  GhostexNative
//
//  Hardware keyboard presses, key repeat, and press routing.
//  Moved verbatim from GhosttyTerminalView.swift (no logic changes).
//

import UIKit
import GhosttyKit

@MainActor
extension GhosttyTerminalView {
    // MARK: - Keyboard Input (Hardware Keyboard)

    override var keyCommands: [UIKeyCommand]? {
        // Keep keyCommands nil; handle command shortcuts in pressesBegan.
        return nil
    }

    private func handlePasteShortcut(_ key: UIKey) -> Bool {
        let input = key.charactersIgnoringModifiers.lowercased()
        guard input == "v" else { return false }

        if key.modifierFlags.contains(.command) {
            performPasteAction(requestRenderAfterward: true)
            return true
        }

        return false
    }

    private func handleCommandShortcut(_ key: UIKey) -> Bool {
        guard key.modifierFlags.contains(.command) else { return false }
        let input = key.charactersIgnoringModifiers.lowercased()
        switch input {
        case "c":
            if canPerformAction(#selector(copy(_:)), withSender: nil) {
                copy(nil)
            }
            return true
        default:
            return false
        }
    }

    private func shouldRepeatHardwareKey(_ key: UIKey) -> Bool {
        switch key.keyCode {
        case .keyboardDeleteOrBackspace,
             .keyboardDeleteForward,
             .keyboardUpArrow,
             .keyboardDownArrow,
             .keyboardLeftArrow,
             .keyboardRightArrow,
             .keyboardHome,
             .keyboardEnd,
             .keyboardPageUp,
             .keyboardPageDown:
            return true
        default:
            return false
        }
    }

    private func fallbackHardwareKey(for key: UIKey) -> Ghostty.Input.Key? {
        switch key.keyCode {
        case .keyboardLeftShift:
            return .shiftLeft
        case .keyboardRightShift:
            return .shiftRight
        case .keyboardCapsLock:
            return .capsLock
        case .keyboardReturnOrEnter:
            return .enter
        case .keyboardDeleteOrBackspace:
            return .backspace
        case .keyboardDeleteForward:
            return .delete
        case .keyboardTab:
            return .tab
        case .keyboardEscape:
            return .escape
        case .keyboardUpArrow:
            return .arrowUp
        case .keyboardDownArrow:
            return .arrowDown
        case .keyboardLeftArrow:
            return .arrowLeft
        case .keyboardRightArrow:
            return .arrowRight
        case .keyboardHome:
            return .home
        case .keyboardEnd:
            return .end
        case .keyboardPageUp:
            return .pageUp
        case .keyboardPageDown:
            return .pageDown
        default:
            break
        }

        let candidates = [key.charactersIgnoringModifiers, key.characters]
        for candidate in candidates where !candidate.isEmpty {
            switch candidate {
            case "UIKeyInputEscape", UIKeyCommand.inputEscape:
                return .escape
            case "UIKeyInputUpArrow", UIKeyCommand.inputUpArrow:
                return .arrowUp
            case "UIKeyInputDownArrow", UIKeyCommand.inputDownArrow:
                return .arrowDown
            case "UIKeyInputLeftArrow", UIKeyCommand.inputLeftArrow:
                return .arrowLeft
            case "UIKeyInputRightArrow", UIKeyCommand.inputRightArrow:
                return .arrowRight
            case "UIKeyInputHome", UIKeyCommand.inputHome:
                return .home
            case "UIKeyInputEnd", UIKeyCommand.inputEnd:
                return .end
            case "UIKeyInputPageUp", UIKeyCommand.inputPageUp:
                return .pageUp
            case "UIKeyInputPageDown", UIKeyCommand.inputPageDown:
                return .pageDown
            default:
                continue
            }
        }

        return nil
    }

    func terminalKey(forKeyCommandInput input: String) -> TerminalKey? {
        switch input {
        case UIKeyCommand.inputEscape:
            return .escape
        case UIKeyCommand.inputUpArrow:
            return .arrowUp
        case UIKeyCommand.inputDownArrow:
            return .arrowDown
        case UIKeyCommand.inputLeftArrow:
            return .arrowLeft
        case UIKeyCommand.inputRightArrow:
            return .arrowRight
        case UIKeyCommand.inputHome:
            return .home
        case UIKeyCommand.inputEnd:
            return .end
        case UIKeyCommand.inputPageUp:
            return .pageUp
        case UIKeyCommand.inputPageDown:
            return .pageDown
        default:
            return nil
        }
    }

    private func startKeyRepeat(for key: UIKey) {
        guard shouldRepeatHardwareKey(key) else { return }
        let blockedModifiers: UIKeyModifierFlags = [.command, .control, .alternate]
        guard key.modifierFlags.intersection(blockedModifiers).isEmpty else { return }
        stopKeyRepeat()
        repeatingHardwareKey = key
        repeatingFallbackKey = fallbackHardwareKey(for: key)
        repeatingFallbackModifiers = key.modifierFlags
        repeatingKeyCode = UInt16(key.keyCode.rawValue)
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.35, repeating: 0.05)
        timer.setEventHandler { [weak self] in
            guard let self = self,
                  let cSurface = self.surface?.unsafeCValue else { return }
            guard self.canRouteTerminalInput else {
                self.stopKeyRepeat()
                return
            }
            if let repeatKey = self.repeatingHardwareKey,
               self.sendDirectHardwareKeyEvent(
                   repeatKey,
                   action: GHOSTTY_ACTION_REPEAT,
                   surface: cSurface
               ) {
                self.requestRender()
                return
            }
            if let fallbackKey = self.repeatingFallbackKey,
               let surface = self.surface {
                surface.sendKeyEvent(
                    self.fallbackHardwareEvent(
                        key: fallbackKey,
                        action: .repeat,
                        modifiers: self.repeatingFallbackModifiers
                    )
                )
            }
            self.requestRender()
        }
        keyRepeatTimer = timer
        timer.resume()
    }

    func stopKeyRepeat() {
        keyRepeatTimer?.cancel()
        keyRepeatTimer = nil
        repeatingHardwareKey = nil
        repeatingFallbackKey = nil
        repeatingFallbackModifiers = []
        repeatingKeyCode = nil
    }

    private func ghosttyInputAction(_ action: ghostty_input_action_e) -> Ghostty.Input.Action {
        switch action {
        case GHOSTTY_ACTION_PRESS:
            return .press
        case GHOSTTY_ACTION_RELEASE:
            return .release
        case GHOSTTY_ACTION_REPEAT:
            return .repeat
        default:
            return .press
        }
    }

    private func fallbackHardwareEvent(
        key: Ghostty.Input.Key,
        action: Ghostty.Input.Action,
        modifiers: UIKeyModifierFlags
    ) -> Ghostty.Input.KeyEvent {
        let mods = Ghostty.Input.Mods(uiKeyModifiers: modifiers)
        let consumedMods = Ghostty.Input.Mods(
            uiKeyModifiers: modifiers.subtracting([.control, .command])
        )
        return .init(
            key: key,
            action: action,
            text: nil,
            composing: false,
            mods: mods,
            consumedMods: consumedMods,
            unshiftedCodepoint: 0
        )
    }

    private func sendDirectHardwareKeyEvent(
        _ key: UIKey,
        action: ghostty_input_action_e,
        surface cSurface: ghostty_surface_t
    ) -> Bool {
        guard let event = Ghostty.Input.KeyEvent(uiKey: key, action: ghosttyInputAction(action))
        else {
            return false
        }
        return event.withCValue { cEvent in
            ghostty_surface_key(cSurface, cEvent)
        }
    }

    private func shouldRoutePressToSystemTextInput(_ key: UIKey) -> Bool {
        let keyProducesText = !(key.characters.isEmpty && key.charactersIgnoringModifiers.isEmpty)
        return TerminalHardwareTextInputRoutingPolicy.shouldRoutePressToSystemTextInput(
            hasControlModifier: key.modifierFlags.contains(.control),
            hasAlternateModifier: key.modifierFlags.contains(.alternate),
            hasCommandModifier: key.modifierFlags.contains(.command),
            hasActiveIMEComposition: textInputModel.hasActiveIMEComposition,
            isSystemTextInputToggleKey: key.keyCode == .keyboardCapsLock,
            hasTerminalFallbackKey: fallbackHardwareKey(for: key) != nil,
            keyProducesText: keyProducesText
        )
    }

    fileprivate func processHardwarePressesBegan(_ presses: Set<UIPress>, event _: UIPressesEvent?) -> HardwarePressResult {
        guard let surface = surface, let cSurface = surface.unsafeCValue else {
            return HardwarePressResult(forwardedToSystem: presses, didHandleGhosttyInput: false)
        }
        guard canRouteTerminalInput else {
            return HardwarePressResult(forwardedToSystem: presses, didHandleGhosttyInput: false)
        }

        var result = HardwarePressResult()
        for press in presses {
            guard let key = press.key else {
                result.forwardedToSystem.insert(press)
                continue
            }
            hasHardwareKeyboardAttached = true
            if handlePasteShortcut(key) {
                result.didHandleGhosttyInput = true
                continue
            }
            if handleCommandShortcut(key) { continue }
            if key.modifierFlags.contains(.command) {
                result.forwardedToSystem.insert(press)
                continue
            }
            if isNativeSelectionTextInputContext {
                clearNativeSelectionStateForTerminalInput()
            }
            if textInputModel.hasActiveIMEComposition, key.keyCode == .keyboardEscape {
                invalidateLocalTextInputSession()
                result.didHandleGhosttyInput = true
                continue
            }
            if shouldRoutePressToSystemTextInput(key) {
                let keyCode = UInt16(key.keyCode.rawValue)
                let keyProducesText = !(key.characters.isEmpty && key.charactersIgnoringModifiers.isEmpty)
                let shouldSendInterpretedTextDirectly =
                    TerminalHardwareTextInputRoutingPolicy.shouldRecordPendingInterpretedHardwareKey(
                        keyProducesText: keyProducesText,
                        hasControlModifier: key.modifierFlags.contains(.control),
                        hasAlternateModifier: key.modifierFlags.contains(.alternate),
                        hasCommandModifier: key.modifierFlags.contains(.command),
                        hasActiveIMEComposition: textInputModel.hasActiveIMEComposition,
                        isSystemTextInputToggleKey: key.keyCode == .keyboardCapsLock
                    )
                if shouldSendInterpretedTextDirectly,
                   sendInterpretedHardwareKeyText(key.characters, for: key) {
                    result.didHandleGhosttyInput = true
                    continue
                }
                systemTextInputPresses.insert(keyCode)
                if TerminalHardwareTextInputRoutingPolicy.shouldRecordPendingInterpretedHardwareKey(
                    keyProducesText: keyProducesText,
                    hasControlModifier: key.modifierFlags.contains(.control),
                    hasAlternateModifier: key.modifierFlags.contains(.alternate),
                    hasCommandModifier: key.modifierFlags.contains(.command),
                    hasActiveIMEComposition: textInputModel.hasActiveIMEComposition,
                    isSystemTextInputToggleKey: key.keyCode == .keyboardCapsLock
                ) {
                    pendingSystemTextInputHardwareKeys.append(key)
                }
                result.forwardedToSystem.insert(press)
                continue
            }

            let keyCode = UInt16(key.keyCode.rawValue)
            if hasLocalTextInputSession {
                invalidateLocalTextInputSession()
            }
            if sendDirectHardwareKeyEvent(key, action: GHOSTTY_ACTION_PRESS, surface: cSurface) {
                hardwarePressesSentToGhostty.insert(keyCode)
                fallbackHardwarePressKeys.removeValue(forKey: keyCode)
                fallbackHardwarePressModifiers.removeValue(forKey: keyCode)
                startKeyRepeat(for: key)
                result.didHandleGhosttyInput = true
            } else if let fallbackKey = fallbackHardwareKey(for: key) {
                surface.sendKeyEvent(
                    fallbackHardwareEvent(
                        key: fallbackKey,
                        action: .press,
                        modifiers: key.modifierFlags
                    )
                )
                hardwarePressesSentToGhostty.insert(keyCode)
                fallbackHardwarePressKeys[keyCode] = fallbackKey
                fallbackHardwarePressModifiers[keyCode] = key.modifierFlags
                startKeyRepeat(for: key)
                result.didHandleGhosttyInput = true
            }
        }

        return result
    }

    fileprivate func processHardwarePressesEnded(_ presses: Set<UIPress>, event _: UIPressesEvent?) -> HardwarePressResult {
        guard let surface = surface, let cSurface = surface.unsafeCValue else {
            return HardwarePressResult(forwardedToSystem: presses, didHandleGhosttyInput: false)
        }
        guard canRouteTerminalInput || !hardwarePressesSentToGhostty.isEmpty else {
            return HardwarePressResult(forwardedToSystem: presses, didHandleGhosttyInput: false)
        }

        var result = HardwarePressResult()
        for press in presses {
            guard let key = press.key else {
                result.forwardedToSystem.insert(press)
                continue
            }
            let keyCode = UInt16(key.keyCode.rawValue)
            guard hardwarePressesSentToGhostty.contains(keyCode) else {
                fallbackHardwarePressKeys.removeValue(forKey: keyCode)
                fallbackHardwarePressModifiers.removeValue(forKey: keyCode)
                systemTextInputPresses.remove(keyCode)
                result.forwardedToSystem.insert(press)
                continue
            }
            hardwarePressesSentToGhostty.remove(keyCode)
            if repeatingKeyCode == keyCode {
                stopKeyRepeat()
            }
            let fallbackKey = fallbackHardwarePressKeys.removeValue(forKey: keyCode)
            let fallbackModifiers =
                fallbackHardwarePressModifiers.removeValue(forKey: keyCode) ?? key.modifierFlags

            if sendDirectHardwareKeyEvent(key, action: GHOSTTY_ACTION_RELEASE, surface: cSurface) {
                result.didHandleGhosttyInput = true
            } else if let fallbackKey {
                surface.sendKeyEvent(
                    fallbackHardwareEvent(
                        key: fallbackKey,
                        action: .release,
                        modifiers: fallbackModifiers
                    )
                )
                result.didHandleGhosttyInput = true
            }
        }

        return result
    }

    fileprivate func processHardwarePressesCancelled(_ presses: Set<UIPress>) {
        for press in presses {
            guard let key = press.key else { continue }
            let keyCode = UInt16(key.keyCode.rawValue)
            hardwarePressesSentToGhostty.remove(keyCode)
            fallbackHardwarePressKeys.removeValue(forKey: keyCode)
            fallbackHardwarePressModifiers.removeValue(forKey: keyCode)
            systemTextInputPresses.remove(keyCode)
        }
        stopKeyRepeat()
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if shouldRedirectNativeSelectionPressesToTerminalInput(presses) {
            _ = exitNativeSelectionTextInputContextForTerminalInput()
        }

        let pendingCount = pendingSystemTextInputHardwareKeys.count
        let result = processHardwarePressesBegan(presses, event: event)
        if !result.forwardedToSystem.isEmpty {
            super.pressesBegan(result.forwardedToSystem, with: event)
            removeUnconsumedPendingSystemTextInputHardwareKeys(after: pendingCount)
        }

        if result.didHandleGhosttyInput {
            requestRender()
        }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let result = processHardwarePressesEnded(presses, event: event)
        if !result.forwardedToSystem.isEmpty {
            super.pressesEnded(result.forwardedToSystem, with: event)
        }

        if result.didHandleGhosttyInput {
            requestRender()
        }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        super.pressesCancelled(presses, with: event)
        processHardwarePressesCancelled(presses)
    }
}
