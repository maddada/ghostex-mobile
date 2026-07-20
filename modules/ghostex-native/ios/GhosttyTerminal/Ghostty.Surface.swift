//
//  Ghostty.Surface.swift
//  GhostexNative
//
//  Ported from VVTerm/GhosttyTerminal/Ghostty.Surface.swift (unchanged
//  except for dropped macOS-only call sites).
//

import Foundation
import GhosttyKit

extension Ghostty {
    /// Represents a single surface within Ghostty.
    ///
    /// Wraps a `ghostty_surface_t`
    final class Surface: @unchecked Sendable {
        private var surface: ghostty_surface_t?
        private let lock = NSLock()

        /// Track if surface has been explicitly freed
        private var hasBeenFreed = false

        /// Read the underlying C value for this surface. This is unsafe because the value will be
        /// freed when the Surface class is deinitialized.
        var unsafeCValue: ghostty_surface_t? {
            lock.lock()
            defer { lock.unlock() }
            return surface
        }

        /// Initialize from the C structure.
        init(cSurface: ghostty_surface_t) {
            self.surface = cSurface
        }

        /// Explicitly free the surface. Call this from cleanup() on main actor.
        @MainActor
        func free() {
            lock.lock()
            guard !hasBeenFreed, let surf = surface else {
                lock.unlock()
                return
            }
            hasBeenFreed = true
            surface = nil
            lock.unlock()

            ghostty_surface_free(surf)
        }

        deinit {
            lock.lock()
            guard !hasBeenFreed, let surf = surface else {
                lock.unlock()
                return
            }
            hasBeenFreed = true
            surface = nil
            lock.unlock()

            // Fallback: schedule free on main thread. Prefer calling free().
            DispatchQueue.main.async {
                ghostty_surface_free(surf)
            }
        }

        /// Send text to the terminal as if it was typed.
        @MainActor
        func sendText(_ text: String) {
            guard let surface = unsafeCValue else { return }
            let len = text.utf8CString.count
            if (len == 0) { return }

            text.withCString { ptr in
                // len includes the null terminator so we do len - 1
                ghostty_surface_text(surface, ptr, UInt(len - 1))
            }
        }

        /// Send a key event to the terminal.
        @MainActor
        func sendKeyEvent(_ event: Input.KeyEvent) {
            guard let surface = unsafeCValue else { return }
            event.withCValue { cEvent in
                ghostty_surface_key(surface, cEvent)
            }
        }

        /// Whether the terminal has captured mouse input.
        @MainActor
        var mouseCaptured: Bool {
            guard let surface = unsafeCValue else { return false }
            return ghostty_surface_mouse_captured(surface)
        }

        /// Whether closing this terminal requires user confirmation.
        @MainActor
        var needsConfirmQuit: Bool {
            guard let surface = unsafeCValue else { return false }
            return ghostty_surface_needs_confirm_quit(surface)
        }

        /// Send a mouse button event to the terminal.
        @MainActor
        @discardableResult
        func sendMouseButton(_ event: Input.MouseButtonEvent) -> Bool {
            guard let surface = unsafeCValue else { return false }
            return ghostty_surface_mouse_button(
                surface,
                event.action.cMouseState,
                event.button.cMouseButton,
                event.mods.cMods)
        }

        /// Send a mouse position event to the terminal.
        @MainActor
        func sendMousePos(_ event: Input.MousePosEvent) {
            guard let surface = unsafeCValue else { return }
            ghostty_surface_mouse_pos(
                surface,
                event.x,
                event.y,
                event.mods.cMods)
        }

        /// Send a mouse scroll event to the terminal.
        @MainActor
        func sendMouseScroll(_ event: Input.MouseScrollEvent) {
            guard let surface = unsafeCValue else { return }
            ghostty_surface_mouse_scroll(
                surface,
                event.x,
                event.y,
                event.mods.cScrollMods)
        }

        /// Perform a keybinding action, e.g. `scroll_to_bottom`.
        @MainActor
        func perform(action: String) -> Bool {
            guard let surface = unsafeCValue else { return false }
            let len = action.utf8CString.count
            if (len == 0) { return false }
            return action.withCString { cString in
                ghostty_surface_binding_action(surface, cString, UInt(len - 1))
            }
        }

        /// Terminal grid size information
        struct TerminalSize {
            let columns: UInt16
            let rows: UInt16
            let widthPx: UInt32
            let heightPx: UInt32
            let cellWidthPx: UInt32
            let cellHeightPx: UInt32
        }

        /// Get current terminal size
        @MainActor
        func terminalSize() -> TerminalSize? {
            guard let surface = unsafeCValue else { return nil }
            let cSize = ghostty_surface_size(surface)
            return TerminalSize(
                columns: cSize.columns,
                rows: cSize.rows,
                widthPx: cSize.width_px,
                heightPx: cSize.height_px,
                cellWidthPx: cSize.cell_width_px,
                cellHeightPx: cSize.cell_height_px
            )
        }

        // MARK: - Custom I/O API (for SSH clients)

        /// Feed data into the terminal for display.
        @MainActor
        func feedData(_ data: Data) {
            guard let surface = unsafeCValue else { return }
            guard !data.isEmpty else { return }
            data.withUnsafeBytes { buffer in
                if let ptr = buffer.baseAddress?.assumingMemoryBound(to: UInt8.self) {
                    ghostty_surface_feed_data(surface, ptr, buffer.count)
                }
            }
        }

        /// Feed string data into the terminal for display.
        @MainActor
        func feedText(_ text: String) {
            guard let data = text.data(using: .utf8) else { return }
            feedData(data)
        }

        /// Callback type for receiving terminal write data.
        typealias WriteCallback = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int) -> Void

        /// Set the write callback for custom I/O backend.
        @MainActor
        func setWriteCallback(_ callback: WriteCallback?, userdata: UnsafeMutableRawPointer?) {
            guard let surface = unsafeCValue else { return }
            ghostty_surface_set_write_callback(surface, callback, userdata)
        }
    }
}
