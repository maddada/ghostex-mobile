//
//  GhosttyTerminalView+TextInputHelpers.swift
//  GhostexNative
//
//  Text-input grid metrics, local text-input session, and input-effect application.
//  Moved verbatim from GhosttyTerminalView.swift (no logic changes).
//

import UIKit
import GhosttyKit

@MainActor
extension GhosttyTerminalView {
    // MARK: - Text Input Helpers

    func textInputGridMetrics() -> (cols: Int, rows: Int, cellSize: CGSize, length: Int) {
        let cols = max(lastReportedGrid.cols, 1)
        let rows = max(lastReportedGrid.rows, 1)
        let cellWidth: CGFloat
        let cellHeight: CGFloat
        if cellSize.width > 0 {
            cellWidth = cellSize.width
        } else if bounds.width > 0 {
            cellWidth = bounds.width / CGFloat(cols)
        } else {
            cellWidth = 1
        }
        if cellSize.height > 0 {
            cellHeight = cellSize.height
        } else if bounds.height > 0 {
            cellHeight = bounds.height / CGFloat(rows)
        } else {
            cellHeight = 1
        }
        let size = CGSize(width: max(cellWidth, 1), height: max(cellHeight, 1))
        let length = max(cols * rows, 1)
        return (cols, rows, size, length)
    }

    private func clampTextInputIndex(_ index: Int) -> Int {
        min(max(index, 0), textInputModel.documentLength)
    }

    var hasLocalTextInputSession: Bool {
        textInputModel.documentLength > 0 || textInputModel.hasActiveIMEComposition
    }

    func invalidateLocalTextInputSession() {
        let effects = textInputModel.invalidateSession()
        applyTerminalTextInputEffects(effects)
        syncIMEPreedit(nil)
    }

    func applyTerminalTextInputEffects(_ effects: [TerminalTextInputModel.Effect]) {
        for effect in effects {
            switch effect {
            case .willTextChange:
                nativeTextInputDelegate?.textWillChange(self)
            case .willSelectionChange:
                nativeTextInputDelegate?.selectionWillChange(self)
            case .didTextChange:
                nativeTextInputDelegate?.textDidChange(self)
            case .didSelectionChange:
                nativeTextInputDelegate?.selectionDidChange(self)
            case let .syncPreedit(text):
                syncIMEPreedit(text)
            case let .sendText(text):
                sendTerminalInputText(text)
            case let .sendBackspaces(count):
                for _ in 0..<count {
                    sendKeyPress(.backspace)
                }
            case let .moveCursor(delta):
                let key: Ghostty.Input.Key = delta < 0 ? .arrowLeft : .arrowRight
                for _ in 0..<abs(delta) {
                    sendKeyPress(key)
                }
            case let .sendSpecialKey(key):
                switch key {
                case .enter:
                    sendKeyPress(.enter)
                case .tab:
                    sendKeyPress(.tab)
                case .backspace:
                    sendKeyPress(.backspace)
                }
            }
        }
    }

    func textInputCaretRect(for index: Int) -> CGRect {
        guard let surface = surface?.unsafeCValue else {
            let metrics = textInputGridMetrics()
            return CGRect(x: 0, y: 0, width: metrics.cellSize.width, height: metrics.cellSize.height)
        }

        var x: Double = 0
        var y: Double = 0
        var width: Double = 0
        var height: Double = 0
        ghostty_surface_ime_point(surface, &x, &y, &width, &height)

        let cellWidth = max(cellSize.width, CGFloat(max(width, 1)))
        let cellHeight = max(cellSize.height, CGFloat(max(height, 1)))
        let currentCharacterIndex = textInputModel.committedCursorCharacterIndex
        let targetCharacterIndex = textInputModel.committedCharacterIndex(forDocumentOffset: clampTextInputIndex(index))
        let delta = targetCharacterIndex - currentCharacterIndex

        return CGRect(
            x: CGFloat(x) + CGFloat(delta) * cellWidth,
            y: CGFloat(y),
            width: max(CGFloat(width), cellWidth),
            height: max(CGFloat(height), cellHeight)
        )
    }
}
