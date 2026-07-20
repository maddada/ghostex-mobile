//
//  TerminalNativeTextSelection.swift
//  GhostexNative
//
//  Ported from VVTerm/GhosttyTerminal/TerminalNativeTextSelection.swift.
//  Pruned: find-navigator overlay/decorations and text-search helpers.
//

#if os(iOS)
import UIKit

final class TerminalNativeTextPosition: UITextPosition {
    let offset: Int

    init(offset: Int) {
        self.offset = offset
        super.init()
    }
}

final class TerminalNativeTextRange: UITextRange {
    let startPosition: TerminalNativeTextPosition
    let endPosition: TerminalNativeTextPosition

    override var start: UITextPosition { startPosition }
    override var end: UITextPosition { endPosition }
    override var isEmpty: Bool { startPosition.offset == endPosition.offset }

    var nsRange: NSRange {
        NSRange(location: startPosition.offset, length: endPosition.offset - startPosition.offset)
    }

    init(start: Int, end: Int) {
        let lowerBound = min(start, end)
        let upperBound = max(start, end)
        self.startPosition = TerminalNativeTextPosition(offset: lowerBound)
        self.endPosition = TerminalNativeTextPosition(offset: upperBound)
        super.init()
    }
}

final class TerminalNativeSelectionRect: UITextSelectionRect {
    private let storedRect: CGRect
    private let storedContainsStart: Bool
    private let storedContainsEnd: Bool

    init(rect: CGRect, containsStart: Bool, containsEnd: Bool) {
        self.storedRect = rect
        self.storedContainsStart = containsStart
        self.storedContainsEnd = containsEnd
        super.init()
    }

    override var rect: CGRect { storedRect }
    override var writingDirection: NSWritingDirection { .leftToRight }
    override var containsStart: Bool { storedContainsStart }
    override var containsEnd: Bool { storedContainsEnd }
    override var isVertical: Bool { false }

    @available(iOS 17.4, *)
    override var transform: CGAffineTransform { .identity }
}

struct TerminalNativeTextSnapshot {
    struct Line {
        let text: String
        let startOffset: Int
        let utf16Length: Int
    }

    static let empty = TerminalNativeTextSnapshot(lines: [], cellSize: CGSize(width: 1, height: 1), columns: 1)

    let lines: [Line]
    let text: String
    let nsText: NSString
    let cellSize: CGSize
    let columns: Int

    init(lines rawLines: [String], cellSize: CGSize, columns: Int) {
        let sanitizedCellSize = CGSize(width: max(cellSize.width, 1), height: max(cellSize.height, 1))
        self.cellSize = sanitizedCellSize
        self.columns = max(columns, 1)

        var runningOffset = 0
        var builtLines: [Line] = []
        for (index, line) in rawLines.enumerated() {
            let utf16Length = (line as NSString).length
            builtLines.append(Line(text: line, startOffset: runningOffset, utf16Length: utf16Length))
            runningOffset += utf16Length
            if index < rawLines.count - 1 {
                runningOffset += 1
            }
        }

        self.lines = builtLines
        self.text = rawLines.joined(separator: "\n")
        self.nsText = self.text as NSString
    }

    var length: Int {
        nsText.length
    }

    func clampedOffset(_ offset: Int) -> Int {
        min(max(offset, 0), length)
    }

    func clampedRange(_ range: NSRange) -> NSRange {
        let location = clampedOffset(range.location)
        let upperBound = clampedOffset(range.location + range.length)
        return NSRange(location: location, length: max(upperBound - location, 0))
    }

    func nativeRange(from range: UITextRange?) -> NSRange? {
        guard let range = range as? TerminalNativeTextRange else { return nil }
        return clampedRange(range.nsRange)
    }

    func nativeRange(_ range: NSRange?) -> TerminalNativeTextRange? {
        guard let range else { return nil }
        let clamped = clampedRange(range)
        return TerminalNativeTextRange(start: clamped.location, end: clamped.location + clamped.length)
    }

    func text(in range: NSRange) -> String? {
        guard length > 0 else { return nil }
        let clamped = clampedRange(range)
        guard clamped.length > 0 else { return "" }
        return nsText.substring(with: clamped)
    }

    func offset(for point: CGPoint) -> Int {
        guard !lines.isEmpty else { return 0 }
        let row = min(max(Int(floor(point.y / cellSize.height)), 0), lines.count - 1)
        let column = min(max(Int(floor(point.x / cellSize.width)), 0), columns)
        let line = lines[row]
        return clampedOffset(line.startOffset + min(column, line.utf16Length))
    }

    func characterRange(at point: CGPoint) -> NSRange? {
        guard length > 0, !lines.isEmpty else { return nil }
        let offset = offset(for: point)
        let (lineIndex, column) = lineAndColumn(for: offset)
        let line = lines[lineIndex]
        guard line.utf16Length > 0 else { return nil }
        let clampedColumn = min(column, max(line.utf16Length - 1, 0))
        return NSRange(location: line.startOffset + clampedColumn, length: 1)
    }

    func caretRect(for offset: Int) -> CGRect {
        let (lineIndex, column) = lineAndColumn(for: offset)
        let caretWidth = max(2, cellSize.width * 0.08)
        return CGRect(
            x: CGFloat(min(column, columns)) * cellSize.width,
            y: CGFloat(lineIndex) * cellSize.height,
            width: caretWidth,
            height: cellSize.height
        ).integral
    }

    func firstRect(for range: NSRange) -> CGRect {
        let rects = selectionRects(for: range)
        if let firstRect = rects.first?.rect {
            return firstRect
        }
        return caretRect(for: range.location)
    }

    func selectionRects(for range: NSRange) -> [TerminalNativeSelectionRect] {
        let clamped = clampedRange(range)
        guard clamped.length > 0, !lines.isEmpty else { return [] }

        let lowerBound = clamped.location
        let upperBound = clamped.location + clamped.length
        var rects: [TerminalNativeSelectionRect] = []

        for (lineIndex, line) in lines.enumerated() {
            let lineStart = line.startOffset
            let lineEnd = line.startOffset + line.utf16Length
            let selectionStart = max(lowerBound, lineStart)
            let selectionEnd = min(upperBound, lineEnd)
            guard selectionEnd > selectionStart else { continue }

            let startColumn = min(selectionStart - lineStart, columns)
            let endColumn = min(selectionEnd - lineStart, columns)
            let width = max(CGFloat(endColumn - startColumn) * cellSize.width, cellSize.width)
            let rect = CGRect(
                x: CGFloat(startColumn) * cellSize.width,
                y: CGFloat(lineIndex) * cellSize.height,
                width: width,
                height: cellSize.height
            ).integral
            rects.append(
                TerminalNativeSelectionRect(
                    rect: rect,
                    containsStart: selectionStart == lowerBound,
                    containsEnd: selectionEnd == upperBound
                )
            )
        }

        return rects
    }

    func lineAndColumn(for offset: Int) -> (line: Int, column: Int) {
        guard !lines.isEmpty else { return (0, 0) }

        let clamped = clampedOffset(offset)
        for (index, line) in lines.enumerated() {
            let lineStart = line.startOffset
            let lineEnd = line.startOffset + line.utf16Length

            if clamped < lineEnd {
                return (index, clamped - lineStart)
            }

            if clamped == lineEnd {
                return (index, line.utf16Length)
            }
        }

        let lastLine = lines[lines.count - 1]
        return (lines.count - 1, lastLine.utf16Length)
    }
}
#endif
