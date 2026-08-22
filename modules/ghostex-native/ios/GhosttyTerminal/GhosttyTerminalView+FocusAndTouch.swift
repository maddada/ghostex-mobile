//
//  GhosttyTerminalView+FocusAndTouch.swift
//  GhostexNative
//
//  First responder / keyboard focus, UIView overrides, and touch input.
//  Moved verbatim from GhosttyTerminalView.swift (no logic changes).
//

import UIKit
import GhosttyKit

@MainActor
extension GhosttyTerminalView {
    // MARK: - First Responder / Keyboard Focus

    override var canBecomeFirstResponder: Bool {
        return true
    }

    var canRouteTerminalInput: Bool {
        acceptsTerminalInput && !isShuttingDown && surface != nil
    }

    var isKeyboardInBrowseMode: Bool {
        keyboardFocusPolicy.isBrowsing
    }

    var shouldRestoreKeyboardFocusOnReconnect: Bool {
        keyboardFocusPolicy.shouldRestoreOnReconnect
    }

    override var inputAccessoryView: UIView? {
        // The RN app renders the key bar; no UIKit accessory.
        nil
    }

    @discardableResult
    func requestKeyboardFocus(for reason: TerminalKeyboardFocusReason) -> Bool {
        // First-responder status is what presents the IME (UIKeyInput), so
        // with the soft keyboard disabled, touch-driven focus must not go
        // through; the explicit keyboard button (module focusTerminal) and
        // hardware-keyboard focus still may.
        if !Ghostty.App.runtimeSettings.softKeyboardEnabled {
            switch reason {
            case .directTouch, .terminalTap, .selectionGesture:
                return false
            case .explicitUserRequest, .initialActivation, .reconnectRestore, .hardwareKeyboard:
                break
            }
        }
        guard keyboardFocusPolicy.requestFocus(for: reason) else { return false }
        guard !isFirstResponder else { return true }
        return becomeFirstResponder()
    }

    @discardableResult
    func requestKeyboardFocus() -> Bool {
        requestKeyboardFocus(for: .explicitUserRequest)
    }

    func dismissKeyboardForUser() {
        keyboardFocusPolicy.dismissForUser()
        if isFirstResponder {
            _ = resignFirstResponder()
        }
    }

    func markKeyboardFocusForReconnect() {
        keyboardFocusPolicy.markForReconnect()
    }

    fileprivate func shouldAutoFocusKeyboard(for touches: Set<UITouch>) -> Bool {
        guard keyboardFocusPolicy.allowsAutomaticFocus else { return false }
        guard touches.count == 1 else { return false }
        return true
    }

    override func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        if became, let surface = surface?.unsafeCValue {
            ghostty_surface_set_focus(surface, true)
        }
        return became
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned {
            if let surface = surface?.unsafeCValue {
                ghostty_surface_set_focus(surface, false)
            }
            invalidateLocalTextInputSession()
            stopKeyRepeat()
        }
        return resigned
    }

    // MARK: - UIView Overrides

    override func layoutSubviews() {
        super.layoutSubviews()
        if usesAppOwnedTouchSelection {
            touchSelectionOverlay.frame = bounds
            updateTouchSelectionOverlay()
        }
        sizeDidChange(bounds.size)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else {
            if let surface = surface?.unsafeCValue {
                ghostty_surface_set_occlusion(surface, false)
            }
            return
        }
        updateContentScaleIfNeeded()
        if let surface = surface?.unsafeCValue {
            ghostty_surface_set_occlusion(surface, !isPaused)
        }
        sizeDidChange(bounds.size)
    }

    // MARK: - Touch Input

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesBegan(touches, with: event)
        let location = touches.first?.location(in: self)
        if usesNativeTouchSelection, nativeSelectionInteractionActive {
            return
        }
        if usesNativeTouchSelection, nativeSelectedRange != nil || prefersNativeSelectionFirstResponder {
            if let location, isPointOnNativeSelectionHandleHitArea(location) {
                return
            }
            clearNativeSelectionStateForTerminalInput()
            guard shouldAutoFocusKeyboard(for: touches) else { return }
            requestKeyboardFocus(for: .directTouch)
            return
        }
        if usesAppOwnedTouchSelection,
           touchSelection != nil,
           let location,
           !isPointOnTouchSelectionHandle(location) {
            clearTouchSelection()
        }
        if let location, isPointOnTouchSelectionHandle(location) {
            return
        }
        // Tap just focuses keyboard - no mouse events (avoids accidental selection)
        guard shouldAutoFocusKeyboard(for: touches) else { return }
        requestKeyboardFocus(for: .directTouch)
    }

    /// Discrete single tap that did not interact with a selection.
    @objc func handleSingleTap(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        let location = recognizer.location(in: self)
        if usesNativeTouchSelection,
           nativeSelectionInteractionActive || isPointOnNativeSelectionHandleHitArea(location) {
            return
        }
        if isPointOnTouchSelectionHandle(location) {
            return
        }
        // A completed terminal tap is an explicit return to typing, including
        // after navigation or a user keyboard dismissal left us in browse mode.
        requestKeyboardFocus(for: .terminalTap)
        if surface?.mouseCaptured == true {
            sendCapturedTerminalTap(at: location)
        } else {
            sendLinkActivationTap(at: location)
        }
        onSingleTap?()
    }

    /// Forward a direct tap as a normal left click when the running terminal
    /// application has enabled mouse reporting.
    private func sendCapturedTerminalTap(at location: CGPoint) {
        guard canRouteTerminalInput, let surface else { return }
        let pos = ghosttyPoint(location)
        surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: []))
        surface.sendMouseButton(.init(action: .press, button: .left, mods: []))
        surface.sendMouseButton(.init(action: .release, button: .left, mods: []))
        requestRender()
    }

    /// With "open URLs on tap" enabled, forward a plain tap as a super+left
    /// click so libghostty runs its link matcher at the tapped cell and fires
    /// GHOSTTY_ACTION_OPEN_URL when a URL is there (core requires the link
    /// modifier on the click; it does nothing when no link is under the
    /// cell). Skipped while an app has the mouse captured so TUI apps keep
    /// receiving their normal input.
    private func sendLinkActivationTap(at location: CGPoint) {
        guard Ghostty.App.runtimeSettings.openUrlsOnTap else { return }
        guard canRouteTerminalInput, let surface else { return }
        guard !surface.mouseCaptured else { return }

        let pos = ghosttyPoint(location)
        // Position first: core resolves the link under the cursor from the
        // last reported mouse position, not from the click event itself.
        surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: [.super]))
        surface.sendMouseButton(.init(action: .press, button: .left, mods: [.super]))
        surface.sendMouseButton(.init(action: .release, button: .left, mods: [.super]))
    }

    func ghosttyPoint(_ location: CGPoint) -> CGPoint {
        // UIKit coordinates are top-left origin; Ghostty iOS expects the same.
        location
    }
}
