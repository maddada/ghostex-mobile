//
//  GhosttyTerminalView+Sizing.swift
//  GhostexNative
//
//  Size change handling and per-surface presentation overrides.
//  Moved verbatim from GhosttyTerminalView.swift (no logic changes).
//

import UIKit
import GhosttyKit

@MainActor
extension GhosttyTerminalView {
    // MARK: - Size Change Handling (matches official Ghostty iOS pattern)

    func sizeDidChange(_ size: CGSize) {
        if isShuttingDown { return }
        guard let surface = surface?.unsafeCValue else { return }
        guard size.width > 0 && size.height > 0 else { return }

        updateContentScaleIfNeeded()
        configureIOSurfaceLayers(size: size)

        let scale = self.contentScaleFactor
        let pixelWidth = floor(size.width * scale)
        let pixelHeight = floor(size.height * scale)
        guard pixelWidth > 0 && pixelHeight > 0 else { return }
        let pixelSize = CGSize(width: pixelWidth, height: pixelHeight)

        let sizeChanged = pixelSize != lastPixelSize || scale != lastContentScale
        if sizeChanged {
            lastPixelSize = pixelSize
            lastContentScale = scale

            ghostty_surface_set_content_scale(surface, scale, scale)
            ghostty_surface_set_size(
                surface,
                UInt32(pixelWidth),
                UInt32(pixelHeight)
            )
            reportGridResizeIfNeeded()
        }

        if !isPaused {
            ghostty_surface_refresh(surface)
            ghostty_surface_draw(surface)
            if usesNativeTouchSelection {
                refreshNativeSelectionSnapshot()
            }
            markIOSurfaceLayersForDisplay()
        }

        if !didSignalReady {
            didSignalReady = true
            DispatchQueue.main.async { [weak self] in
                self?.onReady?()
            }
        }
    }

    func applyPresentationOverrides(_ presentationOverrides: TerminalPresentationOverrides) {
        surfacePresentationOverrides = presentationOverrides

        guard let surface = surface?.unsafeCValue else { return }
        ghosttyAppWrapper?.updateSurfaceConfig(
            surface,
            presentationOverrides: presentationOverrides,
            scrollbackRows: scrollbackRows
        )
        lastPixelSize = .zero
        sizeDidChange(bounds.size)
        requestRender()
    }

    /// Re-push this surface's config so module-global setting changes
    /// (cursor style/blink) take effect on an already-open terminal.
    func reapplySurfaceConfig() {
        applyPresentationOverrides(surfacePresentationOverrides)
    }

    private func reportGridResizeIfNeeded() {
        guard let size = terminalSize() else { return }
        let cols = Int(size.columns)
        let rows = Int(size.rows)
        guard cols > 0, rows > 0 else { return }
        guard cols != lastReportedGrid.cols || rows != lastReportedGrid.rows else { return }
        lastReportedGrid = (cols, rows)
        onResize?(cols, rows)
    }
}
