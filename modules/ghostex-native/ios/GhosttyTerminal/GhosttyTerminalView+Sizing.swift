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
        guard let pixelSize = surfacePixelSize(forBounds: size, scale: scale) else { return }
        let pixelWidth = pixelSize.width
        let pixelHeight = pixelSize.height

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

    /// Pixel size the surface takes: the view's bounds, or, while a grid is pinned,
    /// that many cells plus whatever padding the surface currently carries.
    func surfacePixelSize(forBounds size: CGSize, scale: CGFloat) -> CGSize? {
        if let pinned = pinnedGrid,
           let current = terminalSize(),
           current.cellWidthPx > 0, current.cellHeightPx > 0 {
            let paddingWidth = max(Int(current.widthPx) - Int(current.columns) * Int(current.cellWidthPx), 0)
            let paddingHeight = max(Int(current.heightPx) - Int(current.rows) * Int(current.cellHeightPx), 0)
            return CGSize(
                width: pinned.cols * Int(current.cellWidthPx) + paddingWidth,
                height: pinned.rows * Int(current.cellHeightPx) + paddingHeight
            )
        }
        let pixelWidth = floor(size.width * scale)
        let pixelHeight = floor(size.height * scale)
        guard pixelWidth > 0 && pixelHeight > 0 else { return nil }
        return CGSize(width: pixelWidth, height: pixelHeight)
    }

    /// setTerminalGrid(cols > 0): resize the surface (and, through onResize, the pty) to
    /// an explicit grid and ignore bounds changes until `unpinGrid`.
    func pinGrid(cols: Int, rows: Int) {
        pinnedGrid = (cols, rows)
        lastPixelSize = .zero
        sizeDidChange(bounds.size)
    }

    /// setTerminalGrid(0, 0): size from bounds again and always report the resulting grid.
    func unpinGrid() {
        pinnedGrid = nil
        lastPixelSize = .zero
        lastReportedGrid = (0, 0)
        sizeDidChange(bounds.size)
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
