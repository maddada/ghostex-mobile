//
//  GhosttyTerminalView+ScrollAndZoom.swift
//  GhostexNative
//
//  Pan-scroll with momentum and pinch-to-zoom (the momentum stored properties live in the root file).
//  Moved verbatim from GhosttyTerminalView.swift (no logic changes).
//

import UIKit
import GhosttyKit

@MainActor
extension GhosttyTerminalView {
    // MARK: - Scroll Gesture

    // iOS terminal touch scrolling uses strong direct deltas and carries that
    // speed into flick momentum (see docs/specs/terminal-screen.md section 4).
    private static let scrollMultiplier: Double = 4.0
    private static let momentumVelocityScale: Double = 0.75

    /// Momentum deceleration rate (0.0-1.0, higher = longer momentum)
    private static let momentumDeceleration: Double = 0.94

    /// Minimum velocity to trigger momentum scrolling
    private static let minimumMomentumVelocity: Double = 35.0


    @objc func handlePanGesture(_ recognizer: UIPanGestureRecognizer) {
        guard let surface = surface else { return }
        if isSelecting { return }
        if isPinchingTerminalZoom { return }
        if touchSelection != nil {
            if recognizer.state == .began,
               !isPointOnTouchSelectionHandle(recognizer.location(in: self)) {
                clearTouchSelection()
            }
            return
        }

        let translation = recognizer.translation(in: self)
        let location = recognizer.location(in: self)

        switch recognizer.state {
        case .began:
            isScrolling = true
            stopMomentumScrolling()
        case .changed:
            // Update mouse position so TUI apps receive wheel events with coordinates.
            let pos = ghosttyPoint(location)
            surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: []))
            // Send scroll delta directly; the constants above own touch-scroll speed.
            let scrollEvent = Ghostty.Input.MouseScrollEvent(
                x: Double(translation.x) * Self.scrollMultiplier,
                y: Double(translation.y) * Self.scrollMultiplier,
                mods: Ghostty.Input.ScrollMods(precision: true, momentum: .none)
            )
            surface.sendMouseScroll(scrollEvent)
            requestRender()

            // Reset translation so we get delta on next call
            recognizer.setTranslation(.zero, in: self)
        case .ended:
            isScrolling = false
            let velocity = recognizer.velocity(in: self)
            startMomentumScrolling(velocity: velocity)
        case .cancelled, .failed:
            isScrolling = false
            stopMomentumScrolling()
        default:
            break
        }
    }

    private func startMomentumScrolling(velocity: CGPoint) {
        // Only start momentum if velocity is significant
        guard abs(velocity.y) > Self.minimumMomentumVelocity || abs(velocity.x) > Self.minimumMomentumVelocity else {
            sendMomentumEnd()
            return
        }

        // Scale velocity for momentum (divide by 60 for per-frame amount at 60fps)
        momentumVelocity = CGPoint(
            x: velocity.x / 60.0 * Self.scrollMultiplier * Self.momentumVelocityScale,
            y: velocity.y / 60.0 * Self.scrollMultiplier * Self.momentumVelocityScale
        )

        momentumPhase = .began
        momentumDisplayLink = CADisplayLink(target: self, selector: #selector(momentumScrollTick))
        momentumDisplayLink?.add(to: .main, forMode: .common)
    }

    @objc private func momentumScrollTick() {
        guard let surface = surface else {
            stopMomentumScrolling()
            return
        }

        // Apply deceleration
        momentumVelocity.x *= Self.momentumDeceleration
        momentumVelocity.y *= Self.momentumDeceleration

        // Stop if velocity is very low
        if abs(momentumVelocity.x) < 0.5 && abs(momentumVelocity.y) < 0.5 {
            stopMomentumScrolling()
            sendMomentumEnd()
            return
        }

        // Send momentum scroll event (began -> changed)
        let scrollEvent = Ghostty.Input.MouseScrollEvent(
            x: Double(momentumVelocity.x),
            y: Double(momentumVelocity.y),
            mods: Ghostty.Input.ScrollMods(
                precision: true,
                momentum: momentumPhase == .began ? .began : .changed
            )
        )
        surface.sendMouseScroll(scrollEvent)
        momentumPhase = .changed
        requestRender()
    }

    func stopMomentumScrolling() {
        momentumDisplayLink?.invalidate()
        momentumDisplayLink = nil
        momentumVelocity = .zero
        momentumPhase = .none
    }

    private func sendMomentumEnd() {
        guard let surface = surface else { return }
        let endEvent = Ghostty.Input.MouseScrollEvent(
            x: 0,
            y: 0,
            mods: Ghostty.Input.ScrollMods(precision: true, momentum: .ended)
        )
        surface.sendMouseScroll(endEvent)
        momentumPhase = .none
    }

    /// Scroll to the bottom of the scrollback.
    func scrollToBottom() {
        stopMomentumScrolling()
        _ = surface?.perform(action: "scroll_to_bottom")
        requestRender()
    }

    // MARK: - Pinch Zoom

    @objc func handlePinchGesture(_ recognizer: UIPinchGestureRecognizer) {
        guard canHandlePinchZoom else {
            isPinchingTerminalZoom = false
            return
        }

        switch recognizer.state {
        case .began:
            isPinchingTerminalZoom = true
            pinchReferenceScale = recognizer.scale
            stopMomentumScrolling()
            showZoomIndicator()
        case .changed:
            guard isPinchingTerminalZoom else { return }
            let relativeScale = recognizer.scale / pinchReferenceScale
            if relativeScale >= CGFloat(TerminalZoomPresentation.pinchZoomInThreshold) {
                if let result = onZoomAction?(.zoomIn) {
                    showZoomIndicator(fontSize: result.effectiveFontSize)
                }
                pinchReferenceScale = recognizer.scale
            } else if relativeScale <= CGFloat(TerminalZoomPresentation.pinchZoomOutThreshold) {
                if let result = onZoomAction?(.zoomOut) {
                    showZoomIndicator(fontSize: result.effectiveFontSize)
                }
                pinchReferenceScale = recognizer.scale
            }
        case .ended, .cancelled, .failed:
            isPinchingTerminalZoom = false
            pinchReferenceScale = 1
            scheduleZoomIndicatorHide(after: TerminalZoomPresentation.indicatorGestureEndHideDelay)
        default:
            break
        }
    }

    private func showZoomIndicator() {
        showZoomIndicator(fontSize: surfacePresentationOverrides.resolvedFontSize())
    }

    private func showZoomIndicator(fontSize: Double) {
        zoomIndicatorView.update(fontSize: fontSize)
        setNeedsLayout()
        layoutIfNeeded()
        zoomIndicatorView.layoutIfNeeded()
        bringSubviewToFront(zoomIndicatorView)

        zoomIndicatorHideWorkItem?.cancel()
        zoomIndicatorView.isHidden = false
        UIView.animate(withDuration: TerminalZoomPresentation.indicatorFadeInDuration) {
            self.zoomIndicatorView.alpha = 1
        }
        scheduleZoomIndicatorHide(after: TerminalZoomPresentation.indicatorHideDelay)
    }

    private func scheduleZoomIndicatorHide(after delay: TimeInterval) {
        zoomIndicatorHideWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            UIView.animate(withDuration: TerminalZoomPresentation.indicatorFadeOutDuration, animations: {
                self.zoomIndicatorView.alpha = 0
            }, completion: { _ in
                self.zoomIndicatorView.isHidden = true
            })
        }
        zoomIndicatorHideWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    var canHandlePinchZoom: Bool {
        if usesNativeTouchSelection, nativeSelectionInteractionActive || nativeSelectedRange != nil {
            return false
        }
        if usesAppOwnedTouchSelection, touchSelection != nil {
            return false
        }
        return true
    }
}
