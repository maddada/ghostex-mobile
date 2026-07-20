//
//  Ghostty.App.swift
//  GhostexNative
//
//  Ported from VVTerm/GhosttyTerminal/Ghostty.App.swift.
//  Pruned: settings/themes managers, CloudKit-backed appearance, macOS paths,
//  search actions, scrollbar notifications. Uses a fixed dark configuration
//  (background #000000, libghostty's built-in default font).
//

import Foundation
import UIKit
import OSLog
import GhosttyKit

// MARK: - Ghostty Namespace additions

extension Ghostty {
    /// Wrapper to hold reference to a surface for tracking.
    final class SurfaceReference {
        let surface: ghostty_surface_t
        weak var terminalView: GhosttyTerminalView?
        var isValid: Bool = true

        init(_ surface: ghostty_surface_t, terminalView: GhosttyTerminalView) {
            self.surface = surface
            self.terminalView = terminalView
        }

        func invalidate() {
            isValid = false
        }
    }
}

// MARK: - Ghostty.App

extension Ghostty {
    enum ConfigBuilder {
        /// Fixed dark configuration for the Ghostex mobile terminal.
        /// libghostty bundles JetBrains Mono as its built-in default font, so no
        /// font-family is set here.
        static func configContent(fontSize: Double) -> String {
            """
            font-size = \(Int(fontSize))
            window-inherit-font-size = false
            window-padding-balance = false
            window-padding-x = 0
            window-padding-y = 0
            window-padding-color = extend-always

            # Remote SSH sessions; no local shell integration.
            shell-integration = none

            # Cursor
            cursor-style = block
            cursor-style-blink = true

            # Fixed dark theme: black background.
            background = #000000

            # Disable audible bell (the app surfaces bells itself)
            audible-bell = false

            # Limit scrollback to prevent unbounded memory growth
            scrollback-limit = 10000

            # Faster scroll speed for iOS touch
            mouse-scroll-multiplier = 3

            # Custom keybinds
            keybind = shift+enter=text:\\n

            """
        }
    }

    /// Minimal wrapper for ghostty_app_t lifecycle management.
    @MainActor
    final class App {
        enum Readiness: String {
            case idle, loading, error, ready
        }

        /// The ghostty app instance
        private(set) var app: ghostty_app_t? = nil

        /// Readiness state
        private(set) var readiness: Readiness = .loading

        /// Track active surfaces for config propagation
        private var activeSurfaces: [Ghostty.SurfaceReference] = []
        private var surfaceConfigCache: [Int: ghostty_config_t] = [:]

        // MARK: - Initialization

        init() {
            start()
        }

        private func start() {
            // CRITICAL: Initialize libghostty first
            let initResult = ghostty_init(0, nil)
            if initResult != GHOSTTY_SUCCESS {
                Ghostty.logger.critical("ghostty_init failed with code: \(initResult)")
                readiness = .error
                return
            }

            // iOS touch selection owns copy explicitly, so don't let Ghostty
            // mirror selection changes into the pasteboard.
            let supportsSelectionClipboard = false

            // Create runtime config with callbacks
            var runtime_cfg = ghostty_runtime_config_s(
                userdata: Unmanaged.passUnretained(self).toOpaque(),
                supports_selection_clipboard: supportsSelectionClipboard,
                wakeup_cb: { userdata in App.wakeup(userdata) },
                action_cb: { app, target, action in App.action(app!, target: target, action: action) },
                read_clipboard_cb: { userdata, loc, state in App.readClipboard(userdata, location: loc, state: state) },
                confirm_read_clipboard_cb: { userdata, str, state, request in
                    App.confirmReadClipboard(userdata, string: str, state: state, request: request)
                },
                write_clipboard_cb: { userdata, loc, content, count, confirm in
                    App.writeClipboard(userdata, location: loc, contents: content, count: count, confirm: confirm)
                },
                close_surface_cb: { userdata, processAlive in App.closeSurface(userdata, processAlive: processAlive) }
            )

            guard let config = makeConfig(fontSize: TerminalDefaults.defaultFontSize) else {
                Ghostty.logger.critical("ghostty_config_new failed")
                readiness = .error
                return
            }

            // Create the ghostty app
            guard let app = ghostty_app_new(&runtime_cfg, config) else {
                Ghostty.logger.critical("ghostty_app_new failed")
                ghostty_config_free(config)
                readiness = .error
                return
            }

            // Free config after app creation (app clones it)
            ghostty_config_free(config)

            self.app = app
            self.readiness = .ready

            Ghostty.logger.info("Ghostty app initialized successfully")
        }

        deinit {
            // Cleanup must be called explicitly; the app instance lives for
            // the process lifetime in this module.
        }

        // MARK: - App Operations

        /// Clean up the ghostty app resources
        func cleanup() {
            clearSurfaceConfigCache()

            if let app = self.app {
                ghostty_app_free(app)
                self.app = nil
            }
        }

        func appTick() {
            guard let app = self.app else { return }
            ghostty_app_tick(app)
        }

        /// Register a surface for config update tracking.
        @discardableResult
        func registerSurface(_ surface: ghostty_surface_t, terminalView: GhosttyTerminalView) -> Ghostty.SurfaceReference {
            let ref = Ghostty.SurfaceReference(surface, terminalView: terminalView)
            activeSurfaces.append(ref)
            activeSurfaces = activeSurfaces.filter { $0.isValid }
            return ref
        }

        /// Unregister a surface when it's being deallocated
        func unregisterSurface(_ ref: Ghostty.SurfaceReference) {
            ref.invalidate()
            activeSurfaces = activeSurfaces.filter { $0.isValid }
        }

        func terminalView(for surface: ghostty_surface_t) -> GhosttyTerminalView? {
            activeSurfaces = activeSurfaces.filter { $0.isValid && $0.terminalView != nil }
            return activeSurfaces.first { $0.surface == surface }?.terminalView
        }

        func activeSurfaceCount() -> Int {
            activeSurfaces = activeSurfaces.filter { $0.isValid && $0.terminalView != nil }
            return activeSurfaces.count
        }

        /// Apply per-surface presentation overrides (font size).
        func updateSurfaceConfig(_ surface: ghostty_surface_t, presentationOverrides: TerminalPresentationOverrides) {
            guard let config = cachedSurfaceConfig(fontSize: presentationOverrides.resolvedFontSize()) else { return }
            ghostty_surface_update_config(surface, config)
            Ghostty.logger.info("Updated surface presentation overrides")
        }

        // MARK: - Private Helpers

        private func makeConfig(fontSize: Double) -> ghostty_config_t? {
            guard let config = ghostty_config_new() else {
                Ghostty.logger.error("ghostty_config_new failed")
                return nil
            }

            loadConfigIntoGhostty(config, fontSize: fontSize)
            ghostty_config_finalize(config)
            return config
        }

        private func cachedSurfaceConfig(fontSize: Double) -> ghostty_config_t? {
            let key = Int(TerminalDefaults.clampedFontSize(fontSize))
            if let cachedConfig = surfaceConfigCache[key] {
                return cachedConfig
            }

            guard let config = makeConfig(fontSize: Double(key)) else {
                return nil
            }

            surfaceConfigCache[key] = config
            return config
        }

        private func clearSurfaceConfigCache() {
            for config in surfaceConfigCache.values {
                ghostty_config_free(config)
            }
            surfaceConfigCache.removeAll()
        }

        /// Generate and load config content into a ghostty_config_t.
        private func loadConfigIntoGhostty(_ config: ghostty_config_t, fontSize: Double) {
            let tempDir = NSTemporaryDirectory()
            let configDir = (tempDir as NSString).appendingPathComponent("ghostex-ghostty")
            let configFilePath = (configDir as NSString).appendingPathComponent("config-\(Int(fontSize))")

            do {
                try FileManager.default.createDirectory(atPath: configDir, withIntermediateDirectories: true)

                let configContent = ConfigBuilder.configContent(fontSize: fontSize)
                try configContent.write(toFile: configFilePath, atomically: true, encoding: .utf8)

                configFilePath.withCString { pathPtr in
                    ghostty_config_load_file(config, pathPtr)
                }

                Ghostty.logger.info("Loaded terminal config, font size \(Int(fontSize))pt")
            } catch {
                Ghostty.logger.warning("Failed to write config: \(error)")
            }
        }

        // MARK: - Callbacks

        static func wakeup(_ userdata: UnsafeMutableRawPointer?) {
            guard let userdata = userdata else { return }
            let state = Unmanaged<App>.fromOpaque(userdata).takeUnretainedValue()
            DispatchQueue.main.async {
                state.appTick()
            }
        }

        static func action(_ app: ghostty_app_t, target: ghostty_target_s, action: ghostty_action_s) -> Bool {
            // Get the terminal view from surface userdata if target is a surface
            let terminalView: GhosttyTerminalView? = {
                guard target.tag == GHOSTTY_TARGET_SURFACE else { return nil }
                guard let surface = target.target.surface else { return nil }
                if let appUserdata = ghostty_app_userdata(app) {
                    let state = Unmanaged<App>.fromOpaque(appUserdata).takeUnretainedValue()
                    if let registeredView = state.terminalView(for: surface) {
                        return registeredView
                    }
                }
                guard let surfaceUserdata = ghostty_surface_userdata(surface) else { return nil }
                return Unmanaged<GhosttyTerminalView>.fromOpaque(surfaceUserdata).takeUnretainedValue()
            }()

            switch action.tag {
            case GHOSTTY_ACTION_SET_TITLE:
                if let titlePtr = action.action.set_title.title {
                    let title = String(cString: titlePtr)
                    DispatchQueue.main.async {
                        terminalView?.onTitleChange?(title)
                    }
                }
                return true

            case GHOSTTY_ACTION_RING_BELL:
                DispatchQueue.main.async {
                    terminalView?.onBell?()
                }
                return true

            case GHOSTTY_ACTION_PWD:
                if let pwdPtr = action.action.pwd.pwd {
                    let pwd = String(cString: pwdPtr)
                    DispatchQueue.main.async {
                        terminalView?.onPwdChange?(pwd)
                    }
                }
                return true

            case GHOSTTY_ACTION_CELL_SIZE:
                let cellSize = action.action.cell_size
                DispatchQueue.main.async {
                    guard let terminalView = terminalView else { return }
                    // Convert from backing (pixel) coordinates to points
                    let scale = terminalView.window?.screen.scale ?? UIScreen.main.scale
                    terminalView.cellSize = CGSize(
                        width: Double(cellSize.width) / scale,
                        height: Double(cellSize.height) / scale
                    )
                }
                return true

            case GHOSTTY_ACTION_PROMPT_TITLE:
                return true

            case GHOSTTY_ACTION_MOUSE_SHAPE,
                 GHOSTTY_ACTION_MOUSE_VISIBILITY,
                 GHOSTTY_ACTION_MOUSE_OVER_LINK,
                 GHOSTTY_ACTION_READONLY,
                 GHOSTTY_ACTION_PROGRESS_REPORT,
                 GHOSTTY_ACTION_RENDER:
                return true

            default:
                Ghostty.logger.debug("Unhandled action: \(action.tag.rawValue) on target: \(target.tag.rawValue)")
                return false
            }
        }

        static func readClipboard(_ userdata: UnsafeMutableRawPointer?, location: ghostty_clipboard_e, state: UnsafeMutableRawPointer?) {
            // userdata is the GhosttyTerminalView instance
            guard let userdata = userdata else { return }
            let terminalView = Unmanaged<GhosttyTerminalView>.fromOpaque(userdata).takeUnretainedValue()
            guard let surface = terminalView.surface?.unsafeCValue else { return }

            let clipboardString = Clipboard.readString() ?? ""

            clipboardString.withCString { ptr in
                ghostty_surface_complete_clipboard_request(surface, ptr, state, false)
            }
        }

        static func confirmReadClipboard(
            _ userdata: UnsafeMutableRawPointer?,
            string: UnsafePointer<CChar>?,
            state: UnsafeMutableRawPointer?,
            request: ghostty_clipboard_request_e
        ) {
            Ghostty.logger.debug("Clipboard read confirmation requested")
        }

        static func writeClipboard(
            _ userdata: UnsafeMutableRawPointer?,
            location: ghostty_clipboard_e,
            contents: UnsafePointer<ghostty_clipboard_content_s>?,
            count: Int,
            confirm: Bool
        ) {
            guard let contents = contents, count > 0 else { return }
            guard location != GHOSTTY_CLIPBOARD_SELECTION else { return }

            for idx in 0..<count {
                let entry = contents.advanced(by: idx).pointee
                guard let dataPtr = entry.data else { continue }

                let string = String(cString: dataPtr)
                if !string.isEmpty {
                    Clipboard.copy(string)
                    return
                }
            }
        }

        static func closeSurface(_ userdata: UnsafeMutableRawPointer?, processAlive: Bool) {
            guard let userdata = userdata else { return }
            let terminalView = Unmanaged<GhosttyTerminalView>.fromOpaque(userdata).takeUnretainedValue()

            Ghostty.logger.info("Close surface: processAlive=\(processAlive)")

            DispatchQueue.main.async {
                terminalView.onProcessExit?()
            }
        }
    }
}
