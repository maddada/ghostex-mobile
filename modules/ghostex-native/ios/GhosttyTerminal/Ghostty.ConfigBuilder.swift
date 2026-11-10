//
//  Ghostty.ConfigBuilder.swift
//  GhostexNative
//
//  The text of the Ghostex mobile terminal's Ghostty config, and its identity.
//  Pure (no libghostty calls).
//

import Foundation
import CryptoKit

extension Ghostty {
    enum ConfigBuilder {
        /// The Ghostex mobile terminal's config: the bundled font, the cursor settings, the
        /// scrollback and the colours the theme settings resolved to (`TerminalColors`).
        static func configContent(
            fontSize: Double,
            cursorStyle: TerminalRuntimeSettings.CursorStyle,
            cursorBlink: Bool,
            scrollbackRows: Int,
            colors: TerminalColors
        ) -> String {
            """
            font-family = "JetBrainsMono Nerd Font"
            font-size = \(Int(fontSize))
            window-inherit-font-size = false
            window-padding-balance = false
            window-padding-x = 0
            window-padding-y = 0
            window-padding-color = extend-always

            # Remote SSH sessions; no local shell integration.
            shell-integration = none

            # Cursor
            cursor-style = \(cursorStyle.rawValue)
            cursor-style-blink = \(cursorBlink)

            # Colours
            \(colorLines(colors))
            # Disable audible bell (the app surfaces bells itself)
            audible-bell = false

            # Scrollback in bytes (this libghostty has no row limit): the
            # setting's rows at about 2 KiB each, see ScrollbackLimit.swift.
            scrollback-limit = \(ScrollbackLimit.bytes(forRows: scrollbackRows))

            # Faster scroll speed for iOS touch
            mouse-scroll-multiplier = 3

            # Custom keybinds
            keybind = shift+enter=text:\\n

            """
        }

        /// One line per colour role the palette sets; a role it leaves out keeps Ghostty's default, so
        /// switching palettes never keeps a colour from the previous one. Selected text keeps each
        /// cell's own colour (as on the Mac); without that, Ghostty would paint it in the background
        /// colour on the selection background.
        private static func colorLines(_ colors: TerminalColors) -> String {
            var lines = ["background = \(colors.background)"]
            if let foreground = colors.foreground { lines.append("foreground = \(foreground)") }
            if let cursor = colors.cursor { lines.append("cursor-color = \(cursor)") }
            if let cursorText = colors.cursorText { lines.append("cursor-text = \(cursorText)") }
            if let selection = colors.selectionBackground {
                lines.append("selection-background = \(selection)")
                lines.append("selection-foreground = cell-foreground")
            }
            for (index, color) in colors.palette.enumerated() {
                lines.append("palette = \(index)=\(color)")
            }
            return lines.map { $0 + "\n" }.joined()
        }

        /// The identity of a generated config: equal only for equal content, so the config cache and
        /// the temp file name follow every setting the content carries (colours included).
        static func identity(of content: String) -> String {
            SHA256.hash(data: Data(content.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
        }
    }
}
