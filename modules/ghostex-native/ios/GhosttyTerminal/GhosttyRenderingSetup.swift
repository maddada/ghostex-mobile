//
//  GhosttyRenderingSetup.swift
//  GhostexNative
//
//  Ported from VVTerm/GhosttyTerminal/GhosttyRenderingSetup.swift.
//  iOS-only; font size is passed explicitly instead of read from AppStorage.
//

import Metal
import OSLog
import UIKit
import GhosttyKit

/// Manages surface creation configuration for the Ghostty terminal.
@MainActor
final class GhosttyRenderingSetup {
    nonisolated private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "app.ghostex.mobile",
        category: "GhosttyRendering"
    )

    /// On iOS, Ghostty handles all Metal layer configuration internally.
    /// It creates its own IOSurfaceLayer and adds it as a sublayer of the view's layer.
    func setupLayer(for view: UIView) {
        Self.logger.debug("iOS: Ghostty will configure Metal layer internally")
    }

    /// Create and configure the Ghostty surface (iOS).
    ///
    /// - Parameters:
    ///   - view: The UIView to render into
    ///   - ghosttyApp: The Ghostty app handle
    ///   - worktreePath: Working directory path
    ///   - initialBounds: Initial view bounds
    ///   - fontSize: Font size in points for this surface
    ///   - useCustomIO: If true, uses callback backend for custom I/O (SSH clients)
    func setupSurface(
        view: UIView,
        ghosttyApp: ghostty_app_t,
        worktreePath: String,
        initialBounds: CGRect,
        fontSize: Double,
        command: String? = nil,
        useCustomIO: Bool = false
    ) -> ghostty_surface_t? {
        var surfaceConfig = ghostty_surface_config_new()

        // CRITICAL: Set platform information for iOS
        surfaceConfig.platform_tag = GHOSTTY_PLATFORM_IOS
        surfaceConfig.platform.ios.uiview = Unmanaged.passUnretained(view).toOpaque()

        // Set userdata
        surfaceConfig.userdata = Unmanaged.passUnretained(view).toOpaque()

        // Set scale factor for retina displays
        let scale = view.contentScaleFactor
        surfaceConfig.scale_factor = Double(scale)

        // Set font size
        surfaceConfig.font_size = Float(fontSize)

        // Enable custom I/O backend for SSH clients
        surfaceConfig.use_custom_io = useCustomIO

        // Set working directory
        var workingDirPtr: UnsafeMutablePointer<CChar>?
        var commandPtr: UnsafeMutablePointer<CChar>?

        if let workingDir = strdup(worktreePath) {
            workingDirPtr = workingDir
            surfaceConfig.working_directory = UnsafePointer(workingDir)
        }

        // Set command if provided (only relevant when not using custom I/O)
        if !useCustomIO, let command = command, !command.isEmpty {
            if let cmd = strdup(command) {
                commandPtr = cmd
                surfaceConfig.command = UnsafePointer(cmd)
                Self.logger.info("Setting command: \(command)")
            }
        }

        defer {
            if let wd = workingDirPtr {
                free(wd)
            }
            if let cmd = commandPtr {
                free(cmd)
            }
        }

        // Create the surface
        guard let cSurface = ghostty_surface_new(ghosttyApp, &surfaceConfig) else {
            Self.logger.error("ghostty_surface_new failed")
            return nil
        }

        // Set content scale BEFORE size (order matters - matches official Ghostty)
        ghostty_surface_set_content_scale(cSurface, scale, scale)

        // Then set size with scaled dimensions
        let initialSize = initialBounds.size.width > 0 ? initialBounds.size : CGSize(width: 800, height: 600)
        let scaledWidth = UInt32(initialSize.width * scale)
        let scaledHeight = UInt32(initialSize.height * scale)
        ghostty_surface_set_size(cSurface, scaledWidth, scaledHeight)

        Self.logger.info("Ghostty surface created - scale: \(scale), size: \(scaledWidth)x\(scaledHeight)")

        return cSurface
    }
}
