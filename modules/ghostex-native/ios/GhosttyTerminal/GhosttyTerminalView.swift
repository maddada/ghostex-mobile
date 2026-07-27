//
//  GhosttyTerminalView.swift
//  GhostexNative
//
//  Ported from VVTerm/GhosttyTerminal/GhosttyTerminalView+iOS.swift.
//
//  Kept: surface lifecycle + IOSurface sublayer management, custom I/O
//  (feed_data / write callback), pan-scroll with synthetic wheel events and
//  display-link momentum, pinch-to-zoom font ratchet with the "N pt/Font Size"
//  HUD, touch selection (native UITextInteraction on iPhone, app-owned overlay
//  path preserved), edit menu copy/paste, hardware keyboard presses with
//  repeat, software keyboard + IME through UIKeyInput/UITextInput backed by
//  TerminalTextInputModel.
//
//  Pruned relative to VVTerm: IME proxy text view + dictation, find navigator,
//  keyboard accessory toolbar (RN renders the key bar; inputAccessoryView is
//  nil), voice input, rich-paste interceptor, themes/config reload observers,
//  ConnectionSessionManager integration, macOS paths.
//

import UIKit
import OSLog
import GhosttyKit

@MainActor
class GhosttyTerminalView: UIView {
    static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "app.ghostex.mobile",
        category: "GhosttyTerminalView"
    )

    // MARK: - Properties

    private var ghosttyApp: ghostty_app_t?
    private weak var ghosttyAppWrapper: Ghostty.App?
    private(set) var surface: Ghostty.Surface?
    private var surfaceReference: Ghostty.SurfaceReference?
    private let worktreePath: String
    private let initialCommand: String?
    private let useCustomIO: Bool

    /// Scrollback row limit this surface was created with (config regeneration
    /// must keep emitting it so the surface-config cache key stays truthful).
    let scrollbackRows: Int

    /// Called when the terminal process exits (surface close requested)
    var onProcessExit: (() -> Void)?

    /// Called when the terminal title changes (OSC sequence)
    var onTitleChange: ((String) -> Void)?

    /// Called when the terminal working directory changes
    var onPwdChange: ((String) -> Void)?

    /// Called when the terminal rings the bell
    var onBell: (() -> Void)?

    /// Called when the surface has produced its first sized frame
    var onReady: (() -> Void)?

    /// Called when the terminal grid size changes (cols, rows)
    var onResize: ((Int, Int) -> Void)?

    /// Pinch-zoom hook: apply the zoom action, return the result so the HUD can
    /// show the effective font size. Owned by the module registry entry.
    var onZoomAction: ((TerminalZoomAction) -> TerminalZoomResult?)?

    /// Fired on a plain single tap that did not interact with a selection.
    var onSingleTap: (() -> Void)?

    /// Fired after software-keyboard input consumes the RN accessory's one-shot modifiers.
    var onKeyModifiersConsumed: (() -> Void)?

    /// Per-surface presentation overrides (font size)
    private(set) var surfacePresentationOverrides = TerminalPresentationOverrides.empty

    private var didSignalReady = false
    private var isShuttingDown = false
    private var isPaused = false
    private var customIORedrawScheduled = false
    private var keyRepeatTimer: DispatchSourceTimer?
    private var repeatingHardwareKey: UIKey?
    private var repeatingFallbackKey: Ghostty.Input.Key?
    private var repeatingFallbackModifiers: UIKeyModifierFlags = []
    private var repeatingKeyCode: UInt16?

    private var lastPixelSize: CGSize = .zero
    private var lastContentScale: CGFloat = 0
    private var lastReportedGrid: (cols: Int, rows: Int) = (0, 0)

    /// Cell size in points, reported by Ghostty (CELL_SIZE action)
    var cellSize: CGSize = .zero

    // MARK: - Gesture State

    fileprivate var isSelecting = false
    private var isScrolling = false
    private var isPinchingTerminalZoom = false
    private var pinchReferenceScale: CGFloat = 1
    private let zoomIndicatorView = TerminalZoomIndicatorView()
    private var zoomIndicatorHideWorkItem: DispatchWorkItem?

    // MARK: - Native (UITextInteraction) selection state

    fileprivate var nativeSelectionSnapshot = TerminalNativeTextSnapshot.empty
    fileprivate var nativeSelectedRange: NSRange?
    fileprivate weak var nativeTextInputDelegate: UITextInputDelegate?
    fileprivate lazy var nativeSelectionTokenizer = UITextInputStringTokenizer(textInput: self)
    fileprivate var nativeSelectionAffinity: UITextStorageDirection = .forward
    fileprivate var nativeSelectionInteractionActive = false
    fileprivate var prefersNativeSelectionFirstResponder = false
    fileprivate var shouldRestoreFocusAfterNativeSelection = false
    private var nativeTextInteraction: UITextInteraction?

    // MARK: - App-owned selection state

    private var touchSelectionAnchor: TerminalGridPoint?
    private var touchSelectionSeed: TerminalGridSelection?
    fileprivate var touchSelection: TerminalGridSelection? {
        didSet {
            updateTouchSelectionOverlay()
        }
    }
    private let touchSelectionOverlay = TerminalTouchSelectionOverlayView()
    private let touchSelectionLoupe = TerminalTouchSelectionLoupeView()

    private lazy var selectionRecognizer: UILongPressGestureRecognizer = {
        let recognizer = UILongPressGestureRecognizer(
            target: self,
            action: #selector(handleSelectionPress(_:))
        )
        recognizer.minimumPressDuration = 0.2
        recognizer.allowableMovement = 8
        recognizer.cancelsTouchesInView = true
        return recognizer
    }()

    private lazy var doubleTapRecognizer: UITapGestureRecognizer = {
        let recognizer = UITapGestureRecognizer(
            target: self,
            action: #selector(handleDoubleTap(_:))
        )
        recognizer.numberOfTapsRequired = 2
        return recognizer
    }()

    private lazy var tripleTapRecognizer: UITapGestureRecognizer = {
        let recognizer = UITapGestureRecognizer(
            target: self,
            action: #selector(handleTripleTap(_:))
        )
        recognizer.numberOfTapsRequired = 3
        return recognizer
    }()

    fileprivate lazy var scrollRecognizer: UIPanGestureRecognizer = {
        let recognizer = UIPanGestureRecognizer(
            target: self,
            action: #selector(handlePanGesture(_:))
        )
        recognizer.maximumNumberOfTouches = 1
        recognizer.requiresExclusiveTouchType = false
        recognizer.allowedTouchTypes = [
            NSNumber(value: UITouch.TouchType.direct.rawValue),
            NSNumber(value: UITouch.TouchType.indirectPointer.rawValue),
        ]
        recognizer.allowedScrollTypesMask = .all
        return recognizer
    }()

    fileprivate lazy var pinchRecognizer: UIPinchGestureRecognizer = {
        let recognizer = UIPinchGestureRecognizer(
            target: self,
            action: #selector(handlePinchGesture(_:))
        )
        recognizer.requiresExclusiveTouchType = false
        recognizer.allowedTouchTypes = [
            NSNumber(value: UITouch.TouchType.direct.rawValue)
        ]
        return recognizer
    }()

    private lazy var singleTapRecognizer: UITapGestureRecognizer = {
        let recognizer = UITapGestureRecognizer(
            target: self,
            action: #selector(handleSingleTap(_:))
        )
        recognizer.numberOfTapsRequired = 1
        recognizer.cancelsTouchesInView = false
        return recognizer
    }()

    private lazy var selectionStartHandleRecognizer: UIPanGestureRecognizer = {
        let recognizer = UIPanGestureRecognizer(target: self, action: #selector(handleSelectionHandlePan(_:)))
        recognizer.maximumNumberOfTouches = 1
        return recognizer
    }()

    private lazy var selectionEndHandleRecognizer: UIPanGestureRecognizer = {
        let recognizer = UIPanGestureRecognizer(target: self, action: #selector(handleSelectionHandlePan(_:)))
        recognizer.maximumNumberOfTouches = 1
        return recognizer
    }()

    private var editMenuInteraction: UIEditMenuInteraction?

    // MARK: - Text Input State

    fileprivate var textInputModel = TerminalTextInputModel()
    fileprivate var pendingSystemTextInputHardwareKeys: [UIKey] = []
    private var renderedIMEPreeditText: String?
    fileprivate var hardwarePressesSentToGhostty: Set<UInt16> = []
    private var fallbackHardwarePressKeys: [UInt16: Ghostty.Input.Key] = [:]
    private var fallbackHardwarePressModifiers: [UInt16: UIKeyModifierFlags] = [:]
    fileprivate var systemTextInputPresses: Set<UInt16> = []
    private var keyModifiers: Ghostty.Input.Mods = []
    private var lockedKeyModifiers: Ghostty.Input.Mods = []

    fileprivate struct HardwarePressResult {
        var forwardedToSystem: Set<UIPress> = []
        var didHandleGhosttyInput = false
    }

    // MARK: - Keyboard Focus

    var acceptsTerminalInput = true
    private var keyboardFocusPolicy = TerminalKeyboardFocusPolicy()
    private var hasHardwareKeyboardAttached = false

    // MARK: - Rendering Components

    private let renderingSetup = GhosttyRenderingSetup()

    fileprivate func requestRender() {
        if isShuttingDown { return }
        if isPaused { return }
        guard surface?.unsafeCValue != nil else { return }
        guard bounds.width > 0 && bounds.height > 0 else { return }
        if usesNativeTouchSelection, nativeSelectionInteractionActive || nativeSelectedRange != nil {
            refreshNativeSelectionSnapshot()
        }
        markIOSurfaceLayersForDisplay()
    }

    private func scheduleCustomIORedraw() {
        guard useCustomIO else { return }
        guard !customIORedrawScheduled else { return }
        customIORedrawScheduled = true

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.customIORedrawScheduled = false
            guard !self.isShuttingDown, !self.isPaused else { return }
            guard let surface = self.surface?.unsafeCValue else { return }
            guard self.bounds.width > 0 && self.bounds.height > 0 else { return }

            self.updateContentScaleIfNeeded()
            self.configureIOSurfaceLayers(size: self.bounds.size)
            ghostty_surface_refresh(surface)
            ghostty_surface_draw(surface)
            self.markIOSurfaceLayersForDisplay()
        }
    }

    // MARK: - Initialization

    init(
        frame: CGRect,
        worktreePath: String,
        ghosttyApp: ghostty_app_t,
        appWrapper: Ghostty.App? = nil,
        command: String? = nil,
        fontSize: Double? = nil,
        scrollbackRows: Int = TerminalDefaults.defaultScrollbackRows,
        useCustomIO: Bool = false
    ) {
        self.worktreePath = worktreePath
        self.ghosttyApp = ghosttyApp
        self.ghosttyAppWrapper = appWrapper
        self.initialCommand = command
        self.scrollbackRows = scrollbackRows
        self.useCustomIO = useCustomIO
        if let fontSize {
            self.surfacePresentationOverrides = TerminalPresentationOverrides(fontSize: fontSize)
        }

        // Use a reasonable default size if frame is zero
        let initialFrame = frame.width > 0 && frame.height > 0 ? frame : CGRect(x: 0, y: 0, width: 800, height: 600)
        super.init(frame: initialFrame)

        backgroundColor = .black

        // Set content scale factor for retina rendering (important before surface creation)
        self.contentScaleFactor = UIScreen.main.scale

        setupSurface()

        zoomIndicatorView.isHidden = true
        zoomIndicatorView.alpha = 0
        zoomIndicatorView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(zoomIndicatorView)
        NSLayoutConstraint.activate([
            zoomIndicatorView.centerXAnchor.constraint(equalTo: centerXAnchor),
            zoomIndicatorView.centerYAnchor.constraint(equalTo: centerYAnchor),
            zoomIndicatorView.widthAnchor.constraint(greaterThanOrEqualToConstant: TerminalZoomPresentation.indicatorMinimumWidth),
            zoomIndicatorView.heightAnchor.constraint(greaterThanOrEqualToConstant: TerminalZoomPresentation.indicatorMinimumHeight)
        ])

        if usesAppOwnedTouchSelection {
            touchSelectionOverlay.frame = bounds
            touchSelectionOverlay.isHidden = true
            addSubview(touchSelectionOverlay)
            touchSelectionLoupe.isHidden = true
            addSubview(touchSelectionLoupe)
            touchSelectionOverlay.startHandle.addGestureRecognizer(selectionStartHandleRecognizer)
            touchSelectionOverlay.endHandle.addGestureRecognizer(selectionEndHandleRecognizer)
        }

        // Setup gesture recognizers with delegate for simultaneous recognition
        scrollRecognizer.delegate = self
        pinchRecognizer.delegate = self
        if usesAppOwnedTouchSelection {
            selectionRecognizer.delegate = self
            doubleTapRecognizer.delegate = self
            tripleTapRecognizer.delegate = self
            selectionStartHandleRecognizer.delegate = self
            selectionEndHandleRecognizer.delegate = self
            doubleTapRecognizer.require(toFail: tripleTapRecognizer)
        }

        addGestureRecognizer(scrollRecognizer)
        addGestureRecognizer(pinchRecognizer)
        addGestureRecognizer(singleTapRecognizer)
        if usesAppOwnedTouchSelection {
            addGestureRecognizer(selectionRecognizer)
            addGestureRecognizer(doubleTapRecognizer)
            addGestureRecognizer(tripleTapRecognizer)
        }
        isUserInteractionEnabled = true

        if usesNativeTouchSelection {
            setupNativeTextSelectionInteractions()
        }
        // Edit menu interaction for copy/paste (also used on the app-owned path)
        let interaction = UIEditMenuInteraction(delegate: self)
        addInteraction(interaction)
        editMenuInteraction = interaction
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) not supported")
    }

    deinit {
        let wrapper = self.ghosttyAppWrapper
        let ref = self.surfaceReference
        if let wrapper = wrapper, let ref = ref {
            Task { @MainActor in
                wrapper.unregisterSurface(ref)
            }
        }
    }

    /// Explicitly cleanup the terminal before removal from view hierarchy.
    func cleanup() {
        isShuttingDown = true
        isPaused = true
        stopMomentumScrolling()
        stopKeyRepeat()
        zoomIndicatorHideWorkItem?.cancel()
        zoomIndicatorHideWorkItem = nil

        // Clear all callbacks first to prevent any further interactions
        onReady = nil
        onProcessExit = nil
        onTitleChange = nil
        onPwdChange = nil
        onBell = nil
        onResize = nil
        onZoomAction = nil
        onSingleTap = nil
        writeCallback = nil

        // Stop rendering/input callbacks and mark the surface as not visible.
        if let cSurface = surface?.unsafeCValue {
            ghostty_surface_set_write_callback(cSurface, nil, nil)
            ghostty_surface_set_focus(cSurface, false)
            ghostty_surface_set_occlusion(cSurface, false)
        }

        // Unregister surface from app wrapper synchronously
        if let wrapper = ghosttyAppWrapper, let ref = surfaceReference {
            wrapper.unregisterSurface(ref)
        }
        surfaceReference = nil

        // CRITICAL: Explicitly free the surface to release Metal resources
        surface?.free()
        surface = nil
    }

    /// Pause rendering and input without destroying the surface.
    func pauseRendering() {
        guard !isShuttingDown else { return }
        isPaused = true

        if let surface = surface?.unsafeCValue {
            ghostty_surface_set_focus(surface, false)
            ghostty_surface_set_occlusion(surface, false)
        }
    }

    /// Resume rendering/input after a pause.
    func resumeRendering() {
        guard !isShuttingDown else { return }
        isPaused = false

        if let surface = surface?.unsafeCValue {
            ghostty_surface_set_occlusion(surface, true)
        }

        sizeDidChange(bounds.size)
        requestRender()
    }

    // MARK: - Setup

    private func setupSurface() {
        guard let app = ghosttyApp else {
            Self.logger.error("Cannot create surface: ghostty_app_t is nil")
            return
        }

        guard let cSurface = renderingSetup.setupSurface(
            view: self,
            ghosttyApp: app,
            worktreePath: worktreePath,
            initialBounds: bounds,
            fontSize: surfacePresentationOverrides.resolvedFontSize(),
            command: initialCommand,
            useCustomIO: useCustomIO
        ) else {
            return
        }

        // CRITICAL: Configure the IOSurfaceLayer that Ghostty just added as a
        // sublayer. Without this, frames get discarded due to size mismatch.
        configureIOSurfaceLayers(size: bounds.size)

        self.surface = Ghostty.Surface(cSurface: cSurface)

        if let wrapper = ghosttyAppWrapper {
            self.surfaceReference = wrapper.registerSurface(cSurface, terminalView: self)
        }

        // Apply the per-surface config right away: font size overrides plus
        // the module-global cursor settings, which the app-level config the
        // surface was created from may not carry yet.
        if let wrapper = ghosttyAppWrapper {
            wrapper.updateSurfaceConfig(
                cSurface,
                presentationOverrides: surfacePresentationOverrides,
                scrollbackRows: scrollbackRows
            )
        }

        Self.logger.info("Ghostty surface created, sublayers: \(self.layer.sublayers?.count ?? 0)")
    }

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

    // MARK: - Text Input Helpers

    fileprivate func textInputGridMetrics() -> (cols: Int, rows: Int, cellSize: CGSize, length: Int) {
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

    fileprivate var hasLocalTextInputSession: Bool {
        textInputModel.documentLength > 0 || textInputModel.hasActiveIMEComposition
    }

    fileprivate func invalidateLocalTextInputSession() {
        let effects = textInputModel.invalidateSession()
        applyTerminalTextInputEffects(effects)
        syncIMEPreedit(nil)
    }

    fileprivate func applyTerminalTextInputEffects(_ effects: [TerminalTextInputModel.Effect]) {
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

    fileprivate func textInputCaretRect(for index: Int) -> CGRect {
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

    // MARK: - First Responder / Keyboard Focus

    override var canBecomeFirstResponder: Bool {
        return true
    }

    fileprivate var canRouteTerminalInput: Bool {
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
            case .directTouch, .selectionGesture:
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
    @objc private func handleSingleTap(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        let location = recognizer.location(in: self)
        if usesNativeTouchSelection,
           nativeSelectionInteractionActive || isPointOnNativeSelectionHandleHitArea(location) {
            return
        }
        if isPointOnTouchSelectionHandle(location) {
            return
        }
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

    private func ghosttyPoint(_ location: CGPoint) -> CGPoint {
        // UIKit coordinates are top-left origin; Ghostty iOS expects the same.
        location
    }

    // MARK: - Scroll Gesture

    // iOS terminal touch scrolling uses strong direct deltas and carries that
    // speed into flick momentum (see docs/specs/terminal-screen.md section 4).
    private static let scrollMultiplier: Double = 4.0
    private static let momentumVelocityScale: Double = 0.75

    /// Momentum deceleration rate (0.0-1.0, higher = longer momentum)
    private static let momentumDeceleration: Double = 0.94

    /// Minimum velocity to trigger momentum scrolling
    private static let minimumMomentumVelocity: Double = 35.0

    /// Display link for momentum animation
    private var momentumDisplayLink: CADisplayLink?
    private var momentumVelocity: CGPoint = .zero
    private var momentumPhase: Ghostty.Input.Momentum = .none

    @objc private func handlePanGesture(_ recognizer: UIPanGestureRecognizer) {
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

    private func stopMomentumScrolling() {
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

    @objc private func handlePinchGesture(_ recognizer: UIPinchGestureRecognizer) {
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

    fileprivate var canHandlePinchZoom: Bool {
        if usesNativeTouchSelection, nativeSelectionInteractionActive || nativeSelectedRange != nil {
            return false
        }
        if usesAppOwnedTouchSelection, touchSelection != nil {
            return false
        }
        return true
    }

    // MARK: - Native Text Selection (UITextInteraction, iPhone)

    fileprivate var usesNativeTouchSelection: Bool {
        UIDevice.current.userInterfaceIdiom == .phone
    }

    fileprivate var usesAppOwnedTouchSelection: Bool {
        UIDevice.current.userInterfaceIdiom == .phone && !usesNativeTouchSelection
    }

    private func setupNativeTextSelectionInteractions() {
        let interaction = UITextInteraction(for: .nonEditable)
        interaction.delegate = self
        interaction.textInput = self
        addInteraction(interaction)
        nativeTextInteraction = interaction
        for gesture in interaction.gesturesForFailureRequirements {
            scrollRecognizer.require(toFail: gesture)
        }
    }

    fileprivate func notifyNativeSelectionLayoutChange() {
        guard nativeSelectionInteractionActive || nativeSelectedRange != nil else { return }
        nativeTextInputDelegate?.textWillChange(self)
        nativeTextInputDelegate?.textDidChange(self)
        nativeTextInputDelegate?.selectionWillChange(self)
        nativeTextInputDelegate?.selectionDidChange(self)
    }

    fileprivate func refreshNativeSelectionSnapshot(resetSelection: Bool = false) {
        guard usesNativeTouchSelection else { return }

        nativeSelectionSnapshot = buildNativeSelectionSnapshot()
        if resetSelection {
            setNativeSelectedRange(nil)
            return
        }

        guard let nativeSelectedRange else { return }
        let clamped = nativeSelectionSnapshot.clampedRange(nativeSelectedRange)
        if clamped != nativeSelectedRange {
            setNativeSelectedRange(clamped)
        } else {
            notifyNativeSelectionLayoutChange()
        }
    }

    private func buildNativeSelectionSnapshot() -> TerminalNativeTextSnapshot {
        guard let surface = surface?.unsafeCValue,
              let metrics = selectionGridMetrics() else {
            return .empty
        }

        let rows = (0..<metrics.rows).map { readNativeSelectionLine(surface: surface, row: $0, columns: metrics.cols) }
        return TerminalNativeTextSnapshot(lines: rows, cellSize: metrics.cellSize, columns: metrics.cols)
    }

    private func readNativeSelectionLine(surface: ghostty_surface_t, row: Int, columns: Int) -> String {
        guard columns > 0 else { return "" }

        var text = ghostty_text_s()
        let selection = ghostty_selection_s(
            top_left: ghostty_point_s(
                tag: GHOSTTY_POINT_VIEWPORT,
                coord: GHOSTTY_POINT_COORD_EXACT,
                x: 0,
                y: UInt32(row)
            ),
            bottom_right: ghostty_point_s(
                tag: GHOSTTY_POINT_VIEWPORT,
                coord: GHOSTTY_POINT_COORD_EXACT,
                x: UInt32(columns - 1),
                y: UInt32(row)
            ),
            rectangle: true
        )

        let rawLine: String
        if ghostty_surface_read_text(surface, selection, &text) {
            defer { ghostty_surface_free_text(surface, &text) }
            rawLine = ghosttyTextString(text)
        } else {
            rawLine = ""
        }

        var line = rawLine
        while line.last == "\n" || line.last == "\r" {
            line.removeLast()
        }

        while let scalar = line.unicodeScalars.last,
              CharacterSet.whitespaces.contains(scalar) {
            line.removeLast()
        }

        let lineNSString = line as NSString
        if lineNSString.length > columns {
            line = lineNSString.substring(to: columns)
        }

        return line
    }

    fileprivate func setNativeSelectedRange(_ range: NSRange?) {
        let clampedRange = range.map { nativeSelectionSnapshot.clampedRange($0) }
        if nativeSelectedRange == clampedRange {
            notifyNativeSelectionLayoutChange()
            return
        }

        nativeTextInputDelegate?.selectionWillChange(self)
        nativeSelectedRange = clampedRange
        if clampedRange == nil, !nativeSelectionInteractionActive {
            prefersNativeSelectionFirstResponder = false
        }
        nativeTextInputDelegate?.selectionDidChange(self)
    }

    private func isPointOnNativeSelectionHandleHitArea(_ point: CGPoint) -> Bool {
        guard usesNativeTouchSelection,
              let nativeSelectedRange,
              nativeSelectedRange.length > 0 else {
            return false
        }
        let clamped = nativeSelectionSnapshot.clampedRange(nativeSelectedRange)
        guard clamped.length > 0 else { return false }

        let startRect = nativeSelectionSnapshot.caretRect(for: clamped.location)
        let endRect = nativeSelectionSnapshot.caretRect(for: clamped.location + clamped.length)
        let hitSlop = max(28, nativeSelectionSnapshot.cellSize.height * 1.5)
        return startRect.insetBy(dx: -hitSlop, dy: -hitSlop).contains(point)
            || endRect.insetBy(dx: -hitSlop, dy: -hitSlop).contains(point)
    }

    private func selectedNativeSelectionText() -> String? {
        guard let nativeSelectedRange, nativeSelectedRange.length > 0 else { return nil }
        return nativeSelectionSnapshot.text(in: nativeSelectedRange)
    }

    fileprivate func clearNativeSelectionStateForTerminalInput() {
        guard usesNativeTouchSelection else { return }
        prefersNativeSelectionFirstResponder = false
        nativeSelectionInteractionActive = false
        if nativeSelectedRange != nil {
            setNativeSelectedRange(nil)
        }
    }

    @discardableResult
    fileprivate func exitNativeSelectionTextInputContextForTerminalInput() -> Bool {
        guard isNativeSelectionTextInputContext else { return true }
        clearNativeSelectionStateForTerminalInput()
        return !isNativeSelectionTextInputContext
    }

    fileprivate func shouldRedirectNativeSelectionPressesToTerminalInput(_ presses: Set<UIPress>) -> Bool {
        guard isNativeSelectionTextInputContext else { return false }
        return presses.contains { press in
            guard let key = press.key else { return false }
            return !key.modifierFlags.contains(.command)
        }
    }

    @available(iOS 16.0, *)
    fileprivate func nativeSelectionMenuElements() -> [UIMenuElement] {
        let selectionText = normalizedSelectionMenuText()
        var actions: [UIMenuElement] = []

        if selectionText != nil {
            actions.append(UIAction(title: "Copy", image: UIImage(systemName: "doc.on.doc")) { [weak self] _ in
                self?.copy(nil)
            })
        }

        actions.append(UIAction(title: "Paste", image: UIImage(systemName: "doc.on.clipboard")) { [weak self] _ in
            self?.paste(nil)
        })

        if nativeSelectionSnapshot.length > 0 || selectionGridMetrics() != nil {
            actions.append(UIAction(title: "Select All", image: UIImage(systemName: "selection.pin.in.out")) { [weak self] _ in
                self?.selectAll(nil)
            })
        }

        return actions
    }

    private func selectAllVisibleText() {
        if usesNativeTouchSelection {
            refreshNativeSelectionSnapshot()
            guard nativeSelectionSnapshot.length > 0 else { return }
            setNativeSelectedRange(NSRange(location: 0, length: nativeSelectionSnapshot.length))
            return
        }

        guard usesAppOwnedTouchSelection,
              let metrics = selectionGridMetrics() else { return }
        touchSelection = TerminalGridSelection(
            start: TerminalGridPoint(row: 0, column: 0),
            end: TerminalGridPoint(row: metrics.rows - 1, column: metrics.cols - 1)
        )
        finishTouchSelection()
    }

    // MARK: - Grid Selection Helpers

    fileprivate func selectionGridMetrics() -> (cols: Int, rows: Int, cellSize: CGSize)? {
        guard let terminalSize = terminalSize() else { return nil }
        let cols = max(Int(terminalSize.columns), 1)
        let rows = max(Int(terminalSize.rows), 1)
        let resolvedCellWidth = cellSize.width > 0 ? cellSize.width : max(bounds.width / CGFloat(cols), 1)
        let resolvedCellHeight = cellSize.height > 0 ? cellSize.height : max(bounds.height / CGFloat(rows), 1)
        return (cols, rows, CGSize(width: resolvedCellWidth, height: resolvedCellHeight))
    }

    private func gridPoint(for location: CGPoint) -> TerminalGridPoint? {
        guard let metrics = selectionGridMetrics() else { return nil }
        let column = min(max(Int(floor(location.x / metrics.cellSize.width)), 0), metrics.cols - 1)
        let row = min(max(Int(floor(location.y / metrics.cellSize.height)), 0), metrics.rows - 1)
        return TerminalGridPoint(row: row, column: column)
    }

    private func gridPoint(
        forLinearOffset offset: Int,
        metrics: (cols: Int, rows: Int, cellSize: CGSize)
    ) -> TerminalGridPoint {
        let clampedOffset = min(max(offset, 0), max(metrics.cols * metrics.rows - 1, 0))
        return TerminalGridPoint(
            row: clampedOffset / metrics.cols,
            column: clampedOffset % metrics.cols
        )
    }

    private func selectionFromViewportText(
        _ text: ghostty_text_s,
        metrics: (cols: Int, rows: Int, cellSize: CGSize)
    ) -> TerminalGridSelection? {
        guard metrics.cols > 0, metrics.rows > 0 else { return nil }
        let start = gridPoint(forLinearOffset: Int(text.offset_start), metrics: metrics)
        let end = gridPoint(
            forLinearOffset: Int(text.offset_start + text.offset_len),
            metrics: metrics
        )
        return TerminalGridSelection(start: start, end: end).normalized
    }

    private func cellFrame(for point: TerminalGridPoint, metrics: (cols: Int, rows: Int, cellSize: CGSize)) -> CGRect {
        CGRect(
            x: CGFloat(point.column) * metrics.cellSize.width,
            y: CGFloat(point.row) * metrics.cellSize.height,
            width: metrics.cellSize.width,
            height: metrics.cellSize.height
        )
    }

    private func selectionRects(
        for selection: TerminalGridSelection,
        metrics: (cols: Int, rows: Int, cellSize: CGSize)
    ) -> [CGRect] {
        let normalized = selection.normalized
        let start = normalized.start
        let end = normalized.end

        return (start.row...end.row).map { row in
            let startColumn = row == start.row ? start.column : 0
            let endColumn = row == end.row ? end.column : max(metrics.cols - 1, 0)
            let width = CGFloat(max(endColumn - startColumn + 1, 1)) * metrics.cellSize.width
            return CGRect(
                x: CGFloat(startColumn) * metrics.cellSize.width,
                y: CGFloat(row) * metrics.cellSize.height,
                width: width,
                height: metrics.cellSize.height
            )
        }
    }

    private func selectionMenuPoint(for selection: TerminalGridSelection) -> CGPoint? {
        guard let metrics = selectionGridMetrics() else { return nil }
        let rects = selectionRects(for: selection, metrics: metrics)
        guard let firstRect = rects.first else { return nil }
        let bounds = rects.dropFirst().reduce(firstRect) { partialResult, rect in
            partialResult.union(rect)
        }
        return CGPoint(x: bounds.midX, y: min(bounds.maxY + 12, self.bounds.maxY - 1))
    }

    private func updateTouchSelectionOverlay() {
        guard usesAppOwnedTouchSelection,
              let touchSelection,
              let metrics = selectionGridMetrics() else {
            touchSelectionOverlay.isHidden = true
            touchSelectionOverlay.clear()
            return
        }

        let normalized = touchSelection.normalized
        let rects = selectionRects(for: normalized, metrics: metrics)
        let startFrame = cellFrame(for: normalized.start, metrics: metrics)
        let endFrame = cellFrame(for: normalized.end, metrics: metrics)
        touchSelectionOverlay.isHidden = false
        touchSelectionOverlay.update(
            rects: rects,
            startAnchor: CGPoint(x: startFrame.minX, y: startFrame.minY),
            endAnchor: CGPoint(x: endFrame.maxX, y: endFrame.maxY)
        )
    }

    fileprivate func isPointOnTouchSelectionHandle(_ point: CGPoint) -> Bool {
        guard usesAppOwnedTouchSelection, touchSelection != nil else { return false }

        let handlePoint = touchSelectionOverlay.convert(point, from: self)
        return touchSelectionOverlay.startHandle.frame.insetBy(dx: -22, dy: -22).contains(handlePoint) ||
            touchSelectionOverlay.endHandle.frame.insetBy(dx: -22, dy: -22).contains(handlePoint)
    }

    private func dismissEditMenuIfNeeded() {
        editMenuInteraction?.dismissMenu()
    }

    fileprivate func clearTouchSelection() {
        touchSelectionAnchor = nil
        touchSelectionSeed = nil
        touchSelection = nil
        touchSelectionLoupe.hideLoupe()
        isSelecting = false
    }

    private func updateTouchSelectionLoupe(at location: CGPoint) {
        guard usesAppOwnedTouchSelection else { return }

        let previousVisibility = touchSelectionLoupe.isHidden
        touchSelectionLoupe.isHidden = true
        touchSelectionLoupe.update(
            from: self,
            focusPoint: location,
            in: bounds,
            safeAreaInsets: safeAreaInsets
        )
        if previousVisibility {
            bringSubviewToFront(touchSelectionOverlay)
            bringSubviewToFront(touchSelectionLoupe)
        }
    }

    private func quickLookWordSelection(at location: CGPoint) -> TerminalGridSelection? {
        guard let metrics = selectionGridMetrics(),
              let surface,
              let cSurface = surface.unsafeCValue else { return nil }

        let pos = ghosttyPoint(location)
        surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: []))

        var text = ghostty_text_s()
        guard ghostty_surface_quicklook_word(cSurface, &text) else { return nil }
        defer { ghostty_surface_free_text(cSurface, &text) }
        return selectionFromViewportText(text, metrics: metrics)
    }

    private func startTouchSelection(at location: CGPoint) {
        if let wordSelection = quickLookWordSelection(at: location) {
            let normalized = wordSelection.normalized
            touchSelectionAnchor = nil
            touchSelectionSeed = normalized
            touchSelection = normalized
            isSelecting = true
            return
        }

        guard let point = gridPoint(for: location) else { return }
        touchSelectionAnchor = point
        touchSelectionSeed = nil
        touchSelection = TerminalGridSelection(start: point, end: point)
        isSelecting = true
    }

    private func updateTouchSelection(at location: CGPoint) {
        guard let point = gridPoint(for: location) else { return }

        if touchSelectionAnchor == nil, let seed = touchSelectionSeed?.normalized {
            if point < seed.start {
                touchSelectionAnchor = seed.end
            } else if point > seed.end {
                touchSelectionAnchor = seed.start
            } else {
                touchSelection = seed
                return
            }
        }

        guard let anchor = touchSelectionAnchor else { return }
        touchSelection = TerminalGridSelection(start: anchor, end: point).normalized
    }

    private func updateTouchSelectionHandle(_ kind: TerminalTouchSelectionHandleKind, at location: CGPoint) {
        guard var selection = touchSelection?.normalized,
              let point = gridPoint(for: location) else { return }

        switch kind {
        case .start:
            selection.start = point
        case .end:
            selection.end = point
        }

        touchSelection = selection.normalized
    }

    private func finishTouchSelection() {
        isSelecting = false
        touchSelectionLoupe.hideLoupe()
        guard let touchSelection,
              let menuPoint = selectionMenuPoint(for: touchSelection) else { return }
        showEditMenu(at: menuPoint)
    }

    private func currentSelectionText() -> String? {
        if let nativeSelectionText = selectedNativeSelectionText() {
            return nativeSelectionText
        }
        if let touchSelectionText = touchSelectionText() {
            return touchSelectionText
        }
        return ghosttySelectionText()
    }

    private func touchSelectionText() -> String? {
        guard let touchSelection,
              let surface = surface?.unsafeCValue else { return nil }

        let normalized = touchSelection.normalized
        var text = ghostty_text_s()
        let selection = ghostty_selection_s(
            top_left: ghostty_point_s(
                tag: GHOSTTY_POINT_VIEWPORT,
                coord: GHOSTTY_POINT_COORD_EXACT,
                x: UInt32(normalized.start.column),
                y: UInt32(normalized.start.row)
            ),
            bottom_right: ghostty_point_s(
                tag: GHOSTTY_POINT_VIEWPORT,
                coord: GHOSTTY_POINT_COORD_EXACT,
                x: UInt32(normalized.end.column),
                y: UInt32(normalized.end.row)
            ),
            rectangle: false
        )
        guard ghostty_surface_read_text(surface, selection, &text) else { return nil }
        defer { ghostty_surface_free_text(surface, &text) }
        return ghosttyTextString(text)
    }

    private func ghosttySelectionText() -> String? {
        guard let surface = surface?.unsafeCValue else { return nil }
        var text = ghostty_text_s()
        guard ghostty_surface_read_selection(surface, &text) else { return nil }
        defer { ghostty_surface_free_text(surface, &text) }
        return ghosttyTextString(text)
    }

    private func ghosttyTextString(_ text: ghostty_text_s) -> String {
        guard let rawText = text.text else { return "" }
        let buffer = UnsafeBufferPointer(
            start: UnsafeRawPointer(rawText).assumingMemoryBound(to: UInt8.self),
            count: Int(text.text_len)
        )
        return String(decoding: buffer, as: UTF8.self)
    }

    private func copyTextToClipboard(_ text: String) {
        Clipboard.copy(text)
    }

    fileprivate func normalizedSelectionMenuText() -> String? {
        guard let text = currentSelectionText()?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else { return nil }
        return text
    }

    // MARK: - Selection Gestures

    /// Double-tap to select word
    @objc private func handleDoubleTap(_ recognizer: UITapGestureRecognizer) {
        guard let surface = surface else { return }
        let location = recognizer.location(in: self)
        let pos = ghosttyPoint(location)

        clearTouchSelection()
        requestKeyboardFocus(for: .selectionGesture)

        // Double-click to select word (no modifiers)
        surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: []))
        surface.sendMouseButton(.init(action: .press, button: .left, mods: []))
        surface.sendMouseButton(.init(action: .release, button: .left, mods: []))
        surface.sendMouseButton(.init(action: .press, button: .left, mods: []))
        surface.sendMouseButton(.init(action: .release, button: .left, mods: []))
        requestRender()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.showEditMenu(at: location)
        }
    }

    /// Triple-tap to select line
    @objc private func handleTripleTap(_ recognizer: UITapGestureRecognizer) {
        guard let surface = surface else { return }
        let location = recognizer.location(in: self)
        let pos = ghosttyPoint(location)

        clearTouchSelection()
        requestKeyboardFocus(for: .selectionGesture)

        surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: []))
        for _ in 0..<3 {
            surface.sendMouseButton(.init(action: .press, button: .left, mods: []))
            surface.sendMouseButton(.init(action: .release, button: .left, mods: []))
        }
        requestRender()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.showEditMenu(at: location)
        }
    }

    /// Long press + drag for custom selection
    @objc private func handleSelectionPress(_ recognizer: UILongPressGestureRecognizer) {
        if usesAppOwnedTouchSelection {
            let location = recognizer.location(in: self)

            switch recognizer.state {
            case .began:
                dismissEditMenuIfNeeded()
                startTouchSelection(at: location)
                requestKeyboardFocus(for: .selectionGesture)
                updateTouchSelectionLoupe(at: location)
            case .changed:
                updateTouchSelection(at: location)
                updateTouchSelectionLoupe(at: location)
            case .ended:
                updateTouchSelection(at: location)
                finishTouchSelection()
            case .cancelled, .failed:
                clearTouchSelection()
            default:
                break
            }
            return
        }

        guard let surface = surface else { return }
        let location = recognizer.location(in: self)
        let pos = ghosttyPoint(location)

        switch recognizer.state {
        case .began:
            isSelecting = true
            requestKeyboardFocus(for: .selectionGesture)
            surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: []))
            surface.sendMouseButton(.init(action: .press, button: .left, mods: []))
            requestRender()
        case .changed:
            surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: []))
            requestRender()
        case .ended, .cancelled, .failed:
            surface.sendMousePos(.init(x: pos.x, y: pos.y, mods: []))
            surface.sendMouseButton(.init(action: .release, button: .left, mods: []))
            isSelecting = false
            requestRender()
            showEditMenu(at: location)
        default:
            break
        }
    }

    @objc private func handleSelectionHandlePan(_ recognizer: UIPanGestureRecognizer) {
        guard usesAppOwnedTouchSelection, touchSelection != nil else { return }

        let kind: TerminalTouchSelectionHandleKind
        if recognizer.view === touchSelectionOverlay.startHandle {
            kind = .start
        } else {
            kind = .end
        }

        let location = recognizer.location(in: self)
        switch recognizer.state {
        case .began:
            dismissEditMenuIfNeeded()
            isSelecting = true
            updateTouchSelectionHandle(kind, at: location)
            updateTouchSelectionLoupe(at: location)
        case .changed:
            updateTouchSelectionHandle(kind, at: location)
            updateTouchSelectionLoupe(at: location)
        case .ended:
            updateTouchSelectionHandle(kind, at: location)
            isSelecting = false
            finishTouchSelection()
        case .cancelled, .failed:
            isSelecting = false
            touchSelectionLoupe.hideLoupe()
        default:
            break
        }
    }

    private func showEditMenu(at location: CGPoint) {
        let hasGhosttySelection: Bool
        if let surface = surface?.unsafeCValue {
            hasGhosttySelection = ghostty_surface_has_selection(surface)
        } else {
            hasGhosttySelection = false
        }
        guard touchSelection != nil || hasGhosttySelection else {
            return
        }
        let config = UIEditMenuConfiguration(identifier: nil, sourcePoint: location)
        editMenuInteraction?.presentEditMenu(with: config)
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        switch action {
        case #selector(copy(_:)):
            if let nativeSelectedRange, nativeSelectedRange.length > 0 {
                return true
            }
            if touchSelection != nil {
                return true
            }
            guard let cSurface = surface?.unsafeCValue else { return false }
            return ghostty_surface_has_selection(cSurface)
        case #selector(selectAll(_:)):
            if usesNativeTouchSelection {
                return nativeSelectionSnapshot.length > 0 || selectionGridMetrics() != nil
            }
            return usesAppOwnedTouchSelection && selectionGridMetrics() != nil
        case #selector(paste(_:)):
            return true
        default:
            return super.canPerformAction(action, withSender: sender)
        }
    }

    @objc override func copy(_ sender: Any?) {
        guard let selectionText = currentSelectionText(), !selectionText.isEmpty else { return }
        copyTextToClipboard(selectionText)
    }

    @objc override func selectAll(_ sender: Any?) {
        selectAllVisibleText()
    }

    @objc override func paste(_ sender: Any?) {
        performPasteAction()
    }

    private func clearSelectionAfterPaste() {
        if usesNativeTouchSelection, nativeSelectedRange != nil {
            setNativeSelectedRange(nil)
            prefersNativeSelectionFirstResponder = false
        }
        if usesAppOwnedTouchSelection, touchSelection != nil {
            clearTouchSelection()
        }
    }

    private func performPasteAction(requestRenderAfterward: Bool = false) {
        invalidateLocalTextInputSession()
        pasteTextFromClipboard()
        clearSelectionAfterPaste()
        if requestRenderAfterward {
            requestRender()
        }
    }

    // MARK: - Keyboard Input (Hardware Keyboard)

    override var keyCommands: [UIKeyCommand]? {
        // Keep keyCommands nil; handle command shortcuts in pressesBegan.
        return nil
    }

    private func handlePasteShortcut(_ key: UIKey) -> Bool {
        let input = key.charactersIgnoringModifiers.lowercased()
        guard input == "v" else { return false }

        if key.modifierFlags.contains(.command) {
            performPasteAction(requestRenderAfterward: true)
            return true
        }

        return false
    }

    private func handleCommandShortcut(_ key: UIKey) -> Bool {
        guard key.modifierFlags.contains(.command) else { return false }
        let input = key.charactersIgnoringModifiers.lowercased()
        switch input {
        case "c":
            if canPerformAction(#selector(copy(_:)), withSender: nil) {
                copy(nil)
            }
            return true
        default:
            return false
        }
    }

    private func shouldRepeatHardwareKey(_ key: UIKey) -> Bool {
        switch key.keyCode {
        case .keyboardDeleteOrBackspace,
             .keyboardDeleteForward,
             .keyboardUpArrow,
             .keyboardDownArrow,
             .keyboardLeftArrow,
             .keyboardRightArrow,
             .keyboardHome,
             .keyboardEnd,
             .keyboardPageUp,
             .keyboardPageDown:
            return true
        default:
            return false
        }
    }

    private func fallbackHardwareKey(for key: UIKey) -> Ghostty.Input.Key? {
        switch key.keyCode {
        case .keyboardLeftShift:
            return .shiftLeft
        case .keyboardRightShift:
            return .shiftRight
        case .keyboardCapsLock:
            return .capsLock
        case .keyboardReturnOrEnter:
            return .enter
        case .keyboardDeleteOrBackspace:
            return .backspace
        case .keyboardDeleteForward:
            return .delete
        case .keyboardTab:
            return .tab
        case .keyboardEscape:
            return .escape
        case .keyboardUpArrow:
            return .arrowUp
        case .keyboardDownArrow:
            return .arrowDown
        case .keyboardLeftArrow:
            return .arrowLeft
        case .keyboardRightArrow:
            return .arrowRight
        case .keyboardHome:
            return .home
        case .keyboardEnd:
            return .end
        case .keyboardPageUp:
            return .pageUp
        case .keyboardPageDown:
            return .pageDown
        default:
            break
        }

        let candidates = [key.charactersIgnoringModifiers, key.characters]
        for candidate in candidates where !candidate.isEmpty {
            switch candidate {
            case "UIKeyInputEscape", UIKeyCommand.inputEscape:
                return .escape
            case "UIKeyInputUpArrow", UIKeyCommand.inputUpArrow:
                return .arrowUp
            case "UIKeyInputDownArrow", UIKeyCommand.inputDownArrow:
                return .arrowDown
            case "UIKeyInputLeftArrow", UIKeyCommand.inputLeftArrow:
                return .arrowLeft
            case "UIKeyInputRightArrow", UIKeyCommand.inputRightArrow:
                return .arrowRight
            case "UIKeyInputHome", UIKeyCommand.inputHome:
                return .home
            case "UIKeyInputEnd", UIKeyCommand.inputEnd:
                return .end
            case "UIKeyInputPageUp", UIKeyCommand.inputPageUp:
                return .pageUp
            case "UIKeyInputPageDown", UIKeyCommand.inputPageDown:
                return .pageDown
            default:
                continue
            }
        }

        return nil
    }

    fileprivate func terminalKey(forKeyCommandInput input: String) -> TerminalKey? {
        switch input {
        case UIKeyCommand.inputEscape:
            return .escape
        case UIKeyCommand.inputUpArrow:
            return .arrowUp
        case UIKeyCommand.inputDownArrow:
            return .arrowDown
        case UIKeyCommand.inputLeftArrow:
            return .arrowLeft
        case UIKeyCommand.inputRightArrow:
            return .arrowRight
        case UIKeyCommand.inputHome:
            return .home
        case UIKeyCommand.inputEnd:
            return .end
        case UIKeyCommand.inputPageUp:
            return .pageUp
        case UIKeyCommand.inputPageDown:
            return .pageDown
        default:
            return nil
        }
    }

    private func startKeyRepeat(for key: UIKey) {
        guard shouldRepeatHardwareKey(key) else { return }
        let blockedModifiers: UIKeyModifierFlags = [.command, .control, .alternate]
        guard key.modifierFlags.intersection(blockedModifiers).isEmpty else { return }
        stopKeyRepeat()
        repeatingHardwareKey = key
        repeatingFallbackKey = fallbackHardwareKey(for: key)
        repeatingFallbackModifiers = key.modifierFlags
        repeatingKeyCode = UInt16(key.keyCode.rawValue)
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.35, repeating: 0.05)
        timer.setEventHandler { [weak self] in
            guard let self = self,
                  let cSurface = self.surface?.unsafeCValue else { return }
            guard self.canRouteTerminalInput else {
                self.stopKeyRepeat()
                return
            }
            if let repeatKey = self.repeatingHardwareKey,
               self.sendDirectHardwareKeyEvent(
                   repeatKey,
                   action: GHOSTTY_ACTION_REPEAT,
                   surface: cSurface
               ) {
                self.requestRender()
                return
            }
            if let fallbackKey = self.repeatingFallbackKey,
               let surface = self.surface {
                surface.sendKeyEvent(
                    self.fallbackHardwareEvent(
                        key: fallbackKey,
                        action: .repeat,
                        modifiers: self.repeatingFallbackModifiers
                    )
                )
            }
            self.requestRender()
        }
        keyRepeatTimer = timer
        timer.resume()
    }

    private func stopKeyRepeat() {
        keyRepeatTimer?.cancel()
        keyRepeatTimer = nil
        repeatingHardwareKey = nil
        repeatingFallbackKey = nil
        repeatingFallbackModifiers = []
        repeatingKeyCode = nil
    }

    private func ghosttyInputAction(_ action: ghostty_input_action_e) -> Ghostty.Input.Action {
        switch action {
        case GHOSTTY_ACTION_PRESS:
            return .press
        case GHOSTTY_ACTION_RELEASE:
            return .release
        case GHOSTTY_ACTION_REPEAT:
            return .repeat
        default:
            return .press
        }
    }

    private func fallbackHardwareEvent(
        key: Ghostty.Input.Key,
        action: Ghostty.Input.Action,
        modifiers: UIKeyModifierFlags
    ) -> Ghostty.Input.KeyEvent {
        let mods = Ghostty.Input.Mods(uiKeyModifiers: modifiers)
        let consumedMods = Ghostty.Input.Mods(
            uiKeyModifiers: modifiers.subtracting([.control, .command])
        )
        return .init(
            key: key,
            action: action,
            text: nil,
            composing: false,
            mods: mods,
            consumedMods: consumedMods,
            unshiftedCodepoint: 0
        )
    }

    private func sendDirectHardwareKeyEvent(
        _ key: UIKey,
        action: ghostty_input_action_e,
        surface cSurface: ghostty_surface_t
    ) -> Bool {
        guard let event = Ghostty.Input.KeyEvent(uiKey: key, action: ghosttyInputAction(action))
        else {
            return false
        }
        return event.withCValue { cEvent in
            ghostty_surface_key(cSurface, cEvent)
        }
    }

    private func shouldRoutePressToSystemTextInput(_ key: UIKey) -> Bool {
        let keyProducesText = !(key.characters.isEmpty && key.charactersIgnoringModifiers.isEmpty)
        return TerminalHardwareTextInputRoutingPolicy.shouldRoutePressToSystemTextInput(
            hasControlModifier: key.modifierFlags.contains(.control),
            hasAlternateModifier: key.modifierFlags.contains(.alternate),
            hasCommandModifier: key.modifierFlags.contains(.command),
            hasActiveIMEComposition: textInputModel.hasActiveIMEComposition,
            isSystemTextInputToggleKey: key.keyCode == .keyboardCapsLock,
            hasTerminalFallbackKey: fallbackHardwareKey(for: key) != nil,
            keyProducesText: keyProducesText
        )
    }

    fileprivate func processHardwarePressesBegan(_ presses: Set<UIPress>, event _: UIPressesEvent?) -> HardwarePressResult {
        guard let surface = surface, let cSurface = surface.unsafeCValue else {
            return HardwarePressResult(forwardedToSystem: presses, didHandleGhosttyInput: false)
        }
        guard canRouteTerminalInput else {
            return HardwarePressResult(forwardedToSystem: presses, didHandleGhosttyInput: false)
        }

        var result = HardwarePressResult()
        for press in presses {
            guard let key = press.key else {
                result.forwardedToSystem.insert(press)
                continue
            }
            hasHardwareKeyboardAttached = true
            if handlePasteShortcut(key) {
                result.didHandleGhosttyInput = true
                continue
            }
            if handleCommandShortcut(key) { continue }
            if key.modifierFlags.contains(.command) {
                result.forwardedToSystem.insert(press)
                continue
            }
            if isNativeSelectionTextInputContext {
                clearNativeSelectionStateForTerminalInput()
            }
            if textInputModel.hasActiveIMEComposition, key.keyCode == .keyboardEscape {
                invalidateLocalTextInputSession()
                result.didHandleGhosttyInput = true
                continue
            }
            if shouldRoutePressToSystemTextInput(key) {
                let keyCode = UInt16(key.keyCode.rawValue)
                let keyProducesText = !(key.characters.isEmpty && key.charactersIgnoringModifiers.isEmpty)
                let shouldSendInterpretedTextDirectly =
                    TerminalHardwareTextInputRoutingPolicy.shouldRecordPendingInterpretedHardwareKey(
                        keyProducesText: keyProducesText,
                        hasControlModifier: key.modifierFlags.contains(.control),
                        hasAlternateModifier: key.modifierFlags.contains(.alternate),
                        hasCommandModifier: key.modifierFlags.contains(.command),
                        hasActiveIMEComposition: textInputModel.hasActiveIMEComposition,
                        isSystemTextInputToggleKey: key.keyCode == .keyboardCapsLock
                    )
                if shouldSendInterpretedTextDirectly,
                   sendInterpretedHardwareKeyText(key.characters, for: key) {
                    result.didHandleGhosttyInput = true
                    continue
                }
                systemTextInputPresses.insert(keyCode)
                if TerminalHardwareTextInputRoutingPolicy.shouldRecordPendingInterpretedHardwareKey(
                    keyProducesText: keyProducesText,
                    hasControlModifier: key.modifierFlags.contains(.control),
                    hasAlternateModifier: key.modifierFlags.contains(.alternate),
                    hasCommandModifier: key.modifierFlags.contains(.command),
                    hasActiveIMEComposition: textInputModel.hasActiveIMEComposition,
                    isSystemTextInputToggleKey: key.keyCode == .keyboardCapsLock
                ) {
                    pendingSystemTextInputHardwareKeys.append(key)
                }
                result.forwardedToSystem.insert(press)
                continue
            }

            let keyCode = UInt16(key.keyCode.rawValue)
            if hasLocalTextInputSession {
                invalidateLocalTextInputSession()
            }
            if sendDirectHardwareKeyEvent(key, action: GHOSTTY_ACTION_PRESS, surface: cSurface) {
                hardwarePressesSentToGhostty.insert(keyCode)
                fallbackHardwarePressKeys.removeValue(forKey: keyCode)
                fallbackHardwarePressModifiers.removeValue(forKey: keyCode)
                startKeyRepeat(for: key)
                result.didHandleGhosttyInput = true
            } else if let fallbackKey = fallbackHardwareKey(for: key) {
                surface.sendKeyEvent(
                    fallbackHardwareEvent(
                        key: fallbackKey,
                        action: .press,
                        modifiers: key.modifierFlags
                    )
                )
                hardwarePressesSentToGhostty.insert(keyCode)
                fallbackHardwarePressKeys[keyCode] = fallbackKey
                fallbackHardwarePressModifiers[keyCode] = key.modifierFlags
                startKeyRepeat(for: key)
                result.didHandleGhosttyInput = true
            }
        }

        return result
    }

    fileprivate func processHardwarePressesEnded(_ presses: Set<UIPress>, event _: UIPressesEvent?) -> HardwarePressResult {
        guard let surface = surface, let cSurface = surface.unsafeCValue else {
            return HardwarePressResult(forwardedToSystem: presses, didHandleGhosttyInput: false)
        }
        guard canRouteTerminalInput || !hardwarePressesSentToGhostty.isEmpty else {
            return HardwarePressResult(forwardedToSystem: presses, didHandleGhosttyInput: false)
        }

        var result = HardwarePressResult()
        for press in presses {
            guard let key = press.key else {
                result.forwardedToSystem.insert(press)
                continue
            }
            let keyCode = UInt16(key.keyCode.rawValue)
            guard hardwarePressesSentToGhostty.contains(keyCode) else {
                fallbackHardwarePressKeys.removeValue(forKey: keyCode)
                fallbackHardwarePressModifiers.removeValue(forKey: keyCode)
                systemTextInputPresses.remove(keyCode)
                result.forwardedToSystem.insert(press)
                continue
            }
            hardwarePressesSentToGhostty.remove(keyCode)
            if repeatingKeyCode == keyCode {
                stopKeyRepeat()
            }
            let fallbackKey = fallbackHardwarePressKeys.removeValue(forKey: keyCode)
            let fallbackModifiers =
                fallbackHardwarePressModifiers.removeValue(forKey: keyCode) ?? key.modifierFlags

            if sendDirectHardwareKeyEvent(key, action: GHOSTTY_ACTION_RELEASE, surface: cSurface) {
                result.didHandleGhosttyInput = true
            } else if let fallbackKey {
                surface.sendKeyEvent(
                    fallbackHardwareEvent(
                        key: fallbackKey,
                        action: .release,
                        modifiers: fallbackModifiers
                    )
                )
                result.didHandleGhosttyInput = true
            }
        }

        return result
    }

    fileprivate func processHardwarePressesCancelled(_ presses: Set<UIPress>) {
        for press in presses {
            guard let key = press.key else { continue }
            let keyCode = UInt16(key.keyCode.rawValue)
            hardwarePressesSentToGhostty.remove(keyCode)
            fallbackHardwarePressKeys.removeValue(forKey: keyCode)
            fallbackHardwarePressModifiers.removeValue(forKey: keyCode)
            systemTextInputPresses.remove(keyCode)
        }
        stopKeyRepeat()
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if shouldRedirectNativeSelectionPressesToTerminalInput(presses) {
            _ = exitNativeSelectionTextInputContextForTerminalInput()
        }

        let pendingCount = pendingSystemTextInputHardwareKeys.count
        let result = processHardwarePressesBegan(presses, event: event)
        if !result.forwardedToSystem.isEmpty {
            super.pressesBegan(result.forwardedToSystem, with: event)
            removeUnconsumedPendingSystemTextInputHardwareKeys(after: pendingCount)
        }

        if result.didHandleGhosttyInput {
            requestRender()
        }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let result = processHardwarePressesEnded(presses, event: event)
        if !result.forwardedToSystem.isEmpty {
            super.pressesEnded(result.forwardedToSystem, with: event)
        }

        if result.didHandleGhosttyInput {
            requestRender()
        }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        super.pressesCancelled(presses, with: event)
        processHardwarePressesCancelled(presses)
    }

    // MARK: - Text Input from Software Keyboard

    /// Send text to the terminal (paste/insert; no newline added)
    func sendText(_ text: String) {
        guard canRouteTerminalInput else { return }
        surface?.sendText(text)
        requestRender()
    }

    func pasteTextFromClipboard() {
        guard canRouteTerminalInput else { return }
        _ = surface?.perform(action: "paste_from_clipboard")
        requestRender()
    }

    private func sendTerminalInputText(_ text: String) {
        guard canRouteTerminalInput else { return }
        let normalized = text.precomposedStringWithCanonicalMapping
        guard normalized.count == 1, let character = normalized.first else {
            sendRawTerminalInputText(normalized, invalidateLocalSession: false)
            return
        }
        guard let mapping = GhosttyCharacterKeyMap.mapping(for: character) else {
            sendRawTerminalInputText(normalized, invalidateLocalSession: false)
            return
        }

        var mods: Ghostty.Input.Mods = []
        if mapping.requiresShift {
            mods.insert(.shift)
        }
        sendModifiedKey(
            mapping.key,
            mods: mods,
            text: mapping.text,
            unshiftedCodepoint: mapping.codepoint,
            invalidateLocalSession: false
        )
    }

    private func sendRawTerminalInputText(_ text: String, invalidateLocalSession: Bool = true) {
        guard canRouteTerminalInput else { return }
        let terminalText = text
            .replacingOccurrences(of: "\r\n", with: "\r")
            .replacingOccurrences(of: "\n", with: "\r")
        let data = Data(terminalText.utf8)
        guard !data.isEmpty else { return }

        if invalidateLocalSession {
            invalidateLocalTextInputSession()
        }
        if let writeCallback {
            writeCallback(data)
        } else {
            surface?.sendText(terminalText)
        }
        requestRender()
    }

    /// Handle text inserted by the software keyboard / IME.
    fileprivate func handleInsertText(_ text: String, fromIMEComposition: Bool = false) {
        guard canRouteTerminalInput else { return }
        if isNativeSelectionTextInputContext {
            clearNativeSelectionStateForTerminalInput()
        }

        let normalized = text.precomposedStringWithCanonicalMapping
        guard !normalized.isEmpty else { return }
        if !keyModifiers.isEmpty {
            let modifiers = consumeKeyModifiers()
            invalidateLocalTextInputSession()
            if normalized == "\n" || normalized == "\r" {
                sendTerminalKey(.enter, accumulatedMods: modifiers)
                return
            }
            if normalized == "\t" {
                sendTerminalKey(.tab, accumulatedMods: modifiers)
                return
            }
            guard let first = normalized.first else { return }
            sendCharacterKey(first, mods: modifiers)
            let remaining = String(normalized.dropFirst())
            if !remaining.isEmpty {
                sendTerminalInputText(remaining)
            }
            return
        }
        if let key = terminalKey(forKeyCommandInput: normalized) {
            sendTerminalKey(key)
            return
        }
        if normalized.hasPrefix("UIKeyInput") {
            return
        }

        if !fromIMEComposition,
           let key = consumePendingSystemTextInputHardwareKey(),
           sendInterpretedHardwareKeyText(normalized, for: key) {
            invalidateLocalTextInputSession()
            return
        }

        if normalized == "\n" || normalized == "\r" {
            _ = textInputModel.invalidateSession()
            sendTerminalGhosttyKey(.enter, mods: [])
            return
        }
        if normalized == "\t" {
            _ = textInputModel.invalidateSession()
            sendTerminalGhosttyKey(.tab, mods: [])
            return
        }

        // Plain text goes into the persistent local document; the text input
        // model reconciles it with the terminal by sending the delta.
        applyTerminalTextInputEffects(
            textInputModel.handleInsert(
                TerminalTextInputModel.insertOperation(for: normalized, fromIMEComposition: fromIMEComposition)
            )
        )
    }

    fileprivate func sendKeyPress(_ key: Ghostty.Input.Key) {
        guard canRouteTerminalInput else { return }
        guard let surface = surface else { return }
        surface.sendKeyEvent(.init(key: key, action: .press))
        surface.sendKeyEvent(.init(key: key, action: .release))
        requestRender()
    }

    private func sendControlByte(_ value: UInt8) {
        guard canRouteTerminalInput else { return }
        invalidateLocalTextInputSession()
        let scalar = UnicodeScalar(value)
        sendText(String(Character(scalar)))
    }

    private func sendAnsiSequence(_ data: Data) {
        guard canRouteTerminalInput else { return }
        invalidateLocalTextInputSession()
        let text = String(decoding: data, as: UTF8.self)
        sendText(text)
    }

    private func shouldDisplayVisiblePreedit(for text: String) -> Bool {
        TerminalVisiblePreeditPolicy.shouldDisplay(
            text,
            inputModePrimaryLanguage: currentIMEPrimaryLanguage
        )
    }

    private var currentIMEPrimaryLanguage: String? {
        textInputMode?.primaryLanguage
    }

    fileprivate func syncIMEPreedit(_ text: String?) {
        let visibleText: String?
        if let text, !text.isEmpty {
            let normalized = text.precomposedStringWithCanonicalMapping
            visibleText = shouldDisplayVisiblePreedit(for: normalized) ? normalized : nil
        } else {
            visibleText = nil
        }

        guard visibleText != renderedIMEPreeditText else { return }
        renderedIMEPreeditText = visibleText

        guard let cSurface = surface?.unsafeCValue else { return }

        if let visibleText, !visibleText.isEmpty {
            let len = visibleText.utf8CString.count
            guard len > 0 else {
                ghostty_surface_preedit(cSurface, nil, 0)
                requestRender()
                return
            }
            visibleText.withCString { ptr in
                ghostty_surface_preedit(cSurface, ptr, UInt(len - 1))
            }
        } else {
            ghostty_surface_preedit(cSurface, nil, 0)
        }

        requestRender()
    }

    fileprivate func sendModifiedKey(
        _ key: Ghostty.Input.Key,
        mods: Ghostty.Input.Mods,
        text: String? = nil,
        unshiftedCodepoint: UInt32 = 0,
        invalidateLocalSession: Bool = true
    ) {
        guard canRouteTerminalInput else { return }
        guard let surface = surface else { return }
        if invalidateLocalSession {
            invalidateLocalTextInputSession()
        }
        let press = Ghostty.Input.KeyEvent(
            key: key,
            action: .press,
            text: text,
            composing: false,
            mods: mods,
            consumedMods: [],
            unshiftedCodepoint: unshiftedCodepoint
        )
        surface.sendKeyEvent(press)
        let release = Ghostty.Input.KeyEvent(
            key: key,
            action: .release,
            text: nil,
            composing: false,
            mods: mods,
            consumedMods: [],
            unshiftedCodepoint: unshiftedCodepoint
        )
        surface.sendKeyEvent(release)
        requestRender()
    }

    /// Send a special key to the terminal (raw escape-sequence path).
    func sendSpecialKey(_ key: TerminalSpecialKey) {
        guard surface != nil else { return }
        let shouldInvalidateSession: Bool = switch key {
        case .arrowLeft, .arrowRight, .home, .end, .escape:
            false
        default:
            true
        }
        if shouldInvalidateSession {
            invalidateLocalTextInputSession()
        }

        switch key {
        case .enter:
            sendControlByte(0x0D)
            return
        case .backspace:
            // DEL (0x7F) is the typical backspace for terminals.
            sendControlByte(0x7F)
            return
        default:
            break
        }

        let escapeSequence = TerminalSpecialKeySequence.escapeSequence(for: key)
        sendText(escapeSequence)
    }

    /// Send control key combination (e.g., Ctrl+C)
    func sendControlKey(_ char: Character) {
        guard surface != nil else { return }
        if let controlChar = TerminalControlKey.controlCharacter(for: char) {
            sendText(String(controlChar))
        }
    }

    // MARK: - Terminal Key Sending (used by the module sendKey + key commands)

    func setKeyModifiers(_ modifiers: Ghostty.Input.Mods, locked: Ghostty.Input.Mods) {
        keyModifiers = modifiers
        lockedKeyModifiers = locked
    }

    func clearKeyModifiers() {
        keyModifiers = []
        lockedKeyModifiers = []
    }

    func consumeKeyModifiersForAccessoryKey() {
        _ = consumeKeyModifiers()
    }

    private func consumeKeyModifiers() -> Ghostty.Input.Mods {
        let modifiers = keyModifiers
        let consumedOneShotModifiers = modifiers.subtracting(lockedKeyModifiers)
        keyModifiers = lockedKeyModifiers
        if !consumedOneShotModifiers.isEmpty {
            onKeyModifiersConsumed?()
        }
        return modifiers
    }

    func sendTerminalKey(_ key: TerminalKey, accumulatedMods: Ghostty.Input.Mods = []) {
        switch key {
        case .modified(let baseKey, let mods):
            sendTerminalKey(baseKey, accumulatedMods: accumulatedMods.union(mods))
        case .escape:
            if accumulatedMods.isEmpty, hasLocalTextInputSession {
                invalidateLocalTextInputSession()
            }
            sendTerminalGhosttyKey(.escape, mods: accumulatedMods, invalidateLocalSession: false)
        case .tab:
            sendTerminalGhosttyKey(.tab, mods: accumulatedMods)
        case .enter:
            sendTerminalGhosttyKey(.enter, mods: accumulatedMods)
        case .backspace:
            if accumulatedMods.isEmpty, hasLocalTextInputSession {
                deleteBackward()
            } else {
                sendTerminalGhosttyKey(.backspace, mods: accumulatedMods)
            }
        case .delete:
            sendTerminalGhosttyKey(.delete, mods: accumulatedMods)
        case .insert:
            sendTerminalGhosttyKey(.insert, mods: accumulatedMods)
        case .arrowUp:
            sendTerminalGhosttyKey(.arrowUp, mods: accumulatedMods)
        case .arrowDown:
            sendTerminalGhosttyKey(.arrowDown, mods: accumulatedMods)
        case .arrowLeft:
            sendTerminalGhosttyKey(.arrowLeft, mods: accumulatedMods)
        case .arrowRight:
            sendTerminalGhosttyKey(.arrowRight, mods: accumulatedMods)
        case .home:
            sendTerminalGhosttyKey(.home, mods: accumulatedMods)
        case .end:
            sendTerminalGhosttyKey(.end, mods: accumulatedMods)
        case .pageUp:
            sendTerminalGhosttyKey(.pageUp, mods: accumulatedMods)
        case .pageDown:
            sendTerminalGhosttyKey(.pageDown, mods: accumulatedMods)
        case .f1:
            sendTerminalGhosttyKey(.f1, mods: accumulatedMods)
        case .f2:
            sendTerminalGhosttyKey(.f2, mods: accumulatedMods)
        case .f3:
            sendTerminalGhosttyKey(.f3, mods: accumulatedMods)
        case .f4:
            sendTerminalGhosttyKey(.f4, mods: accumulatedMods)
        case .f5:
            sendTerminalGhosttyKey(.f5, mods: accumulatedMods)
        case .f6:
            sendTerminalGhosttyKey(.f6, mods: accumulatedMods)
        case .f7:
            sendTerminalGhosttyKey(.f7, mods: accumulatedMods)
        case .f8:
            sendTerminalGhosttyKey(.f8, mods: accumulatedMods)
        case .f9:
            sendTerminalGhosttyKey(.f9, mods: accumulatedMods)
        case .f10:
            sendTerminalGhosttyKey(.f10, mods: accumulatedMods)
        case .f11:
            sendTerminalGhosttyKey(.f11, mods: accumulatedMods)
        case .f12:
            sendTerminalGhosttyKey(.f12, mods: accumulatedMods)
        case .ctrlC:
            sendTerminalControlShortcut(.c, letter: "c", mods: accumulatedMods)
        case .ctrlD:
            sendTerminalControlShortcut(.d, letter: "d", mods: accumulatedMods)
        case .ctrlZ:
            sendTerminalControlShortcut(.z, letter: "z", mods: accumulatedMods)
        case .ctrlL:
            sendTerminalControlShortcut(.l, letter: "l", mods: accumulatedMods)
        case .ctrlA:
            sendTerminalControlShortcut(.a, letter: "a", mods: accumulatedMods)
        case .ctrlE:
            sendTerminalControlShortcut(.e, letter: "e", mods: accumulatedMods)
        case .ctrlJ:
            sendTerminalControlShortcut(.j, letter: "j", mods: accumulatedMods)
        case .ctrlK:
            sendTerminalControlShortcut(.k, letter: "k", mods: accumulatedMods)
        case .ctrlU:
            sendTerminalControlShortcut(.u, letter: "u", mods: accumulatedMods)
        }
    }

    func sendTerminalGhosttyKey(
        _ key: Ghostty.Input.Key,
        mods: Ghostty.Input.Mods,
        text: String? = nil,
        unshiftedCodepoint: UInt32? = nil,
        invalidateLocalSession: Bool = true
    ) {
        let codepoint = unshiftedCodepoint ?? text?.unicodeScalars.first?.value ?? 0
        sendModifiedKey(
            key,
            mods: mods,
            text: text,
            unshiftedCodepoint: codepoint,
            invalidateLocalSession: invalidateLocalSession
        )
    }

    private func sendTerminalControlShortcut(
        _ key: Ghostty.Input.Key,
        letter: String,
        mods: Ghostty.Input.Mods
    ) {
        var mergedMods = mods
        mergedMods.insert(.ctrl)
        let codepoint = letter.unicodeScalars.first?.value ?? 0
        sendTerminalGhosttyKey(key, mods: mergedMods, text: nil, unshiftedCodepoint: codepoint)
    }

    /// Send a single character with modifiers (module sendKey path).
    func sendCharacterKey(_ character: Character, mods: Ghostty.Input.Mods) {
        if let mapping = GhosttyCharacterKeyMap.mapping(for: character) {
            var mergedMods = mods
            if mapping.requiresShift { mergedMods.insert(.shift) }
            let hasShortcutModifier = mergedMods.contains(.ctrl) || mergedMods.contains(.alt) || mergedMods.contains(.super)
            let text = hasShortcutModifier ? nil : mapping.text
            sendTerminalGhosttyKey(
                mapping.key,
                mods: mergedMods,
                text: text,
                unshiftedCodepoint: mapping.codepoint
            )
            return
        }

        // Fallback: encode manually
        if mods.contains(.super) {
            return
        }
        var data = Data()
        if mods.contains(.alt) {
            data.append(0x1B)
        }
        if mods.contains(.ctrl), let controlChar = TerminalControlKey.controlCharacter(for: character) {
            data.append(contentsOf: String(controlChar).utf8)
        } else {
            data.append(contentsOf: String(character).utf8)
        }
        sendAnsiSequence(data)
    }

    // MARK: - Process Lifecycle

    /// Check if the terminal process has exited
    var processExited: Bool {
        guard let surface = surface?.unsafeCValue else { return true }
        return ghostty_surface_process_exited(surface)
    }

    /// Get current terminal grid size
    func terminalSize() -> Ghostty.Surface.TerminalSize? {
        guard let surface = surface else { return nil }
        return surface.terminalSize()
    }

    /// Force the terminal surface to refresh/redraw
    func forceRefresh() {
        if isShuttingDown { return }
        if isPaused { return }
        guard let surface = surface?.unsafeCValue else { return }
        guard bounds.width > 0 && bounds.height > 0 else { return }

        updateContentScaleIfNeeded()
        configureIOSurfaceLayers(size: bounds.size)

        let scale = self.contentScaleFactor
        let pixelWidth = floor(bounds.width * scale)
        let pixelHeight = floor(bounds.height * scale)
        guard pixelWidth > 0 && pixelHeight > 0 else { return }
        lastPixelSize = CGSize(width: pixelWidth, height: pixelHeight)
        lastContentScale = scale
        ghostty_surface_set_content_scale(surface, scale, scale)
        ghostty_surface_set_size(surface, UInt32(pixelWidth), UInt32(pixelHeight))
        if window != nil {
            ghostty_surface_set_occlusion(surface, true)
        }

        ghostty_surface_refresh(surface)
        ghostty_surface_draw(surface)
        markIOSurfaceLayersForDisplay()
        requestRender()
    }

    /// Reset Ghostty's terminal state before binding a fresh remote shell to a reused surface.
    func resetTerminalForReconnect() {
        guard !isShuttingDown else { return }
        _ = surface?.perform(action: "reset")
        forceRefresh()
    }

    private func configureIOSurfaceLayers(size: CGSize?) {
        let scale = self.contentScaleFactor
        guard let sublayers = layer.sublayers else { return }
        let targetBounds = size.map { CGRect(origin: .zero, size: $0) } ?? bounds
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for sublayer in sublayers {
            guard isGhosttySurfaceLayer(sublayer) else { continue }
            sublayer.frame = targetBounds
            sublayer.contentsScale = scale
        }
        CATransaction.commit()
    }

    private func markIOSurfaceLayersForDisplay() {
        layer.setNeedsDisplay()
        layer.sublayers?.forEach { sublayer in
            guard isGhosttySurfaceLayer(sublayer) else { return }
            sublayer.setNeedsDisplay()
        }
    }

    private func isGhosttySurfaceLayer(_ layer: CALayer) -> Bool {
        !subviews.contains { subview in
            subview.layer === layer
        }
    }

    private func updateContentScaleIfNeeded() {
        let targetScale = window?.screen.scale ?? UIScreen.main.scale
        if contentScaleFactor != targetScale {
            contentScaleFactor = targetScale
        }
    }

    // MARK: - Custom I/O API (for SSH clients)

    /// Callback invoked when user types in the terminal
    var writeCallback: ((Data) -> Void)?

    /// Feed data from SSH channel to the terminal for rendering.
    func feedData(_ data: Data) {
        guard let surface = surface?.unsafeCValue else { return }

        data.withUnsafeBytes { buffer in
            guard let ptr = buffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
            ghostty_surface_feed_data(surface, ptr, buffer.count)
        }

        scheduleCustomIORedraw()
        requestRender()
    }

    /// Setup the write callback to capture keyboard input
    func setupWriteCallback() {
        guard let surface = surface?.unsafeCValue else { return }

        let userdata = Unmanaged.passUnretained(self).toOpaque()
        ghostty_surface_set_write_callback(surface, { userdata, data, len in
            guard let userdata = userdata else { return }
            let view = Unmanaged<GhosttyTerminalView>.fromOpaque(userdata).takeUnretainedValue()
            guard let data = data, len > 0 else { return }
            let swiftData = Data(bytes: data, count: len)
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    view.writeCallback?(swiftData)
                }
            }
        }, userdata)
    }
}

// MARK: - Native Text Selection Interaction Delegate

extension GhosttyTerminalView: UITextInteractionDelegate {
    func interactionShouldBegin(_ interaction: UITextInteraction, at point: CGPoint) -> Bool {
        guard usesNativeTouchSelection else { return false }
        prefersNativeSelectionFirstResponder = true
        shouldRestoreFocusAfterNativeSelection = isFirstResponder
        refreshNativeSelectionSnapshot()
        return nativeSelectionSnapshot.length > 0
    }

    func interactionWillBegin(_ interaction: UITextInteraction) {
        shouldRestoreFocusAfterNativeSelection = shouldRestoreFocusAfterNativeSelection || isFirstResponder
        nativeSelectionInteractionActive = true
        if !isFirstResponder {
            _ = becomeFirstResponder()
        }
        refreshNativeSelectionSnapshot()
    }

    func interactionDidEnd(_ interaction: UITextInteraction) {
        nativeSelectionInteractionActive = false
        if nativeSelectedRange == nil {
            prefersNativeSelectionFirstResponder = false
        }
        refreshNativeSelectionSnapshot()
    }
}

// MARK: - Gesture Recognizer Delegate

extension GhosttyTerminalView: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if gestureRecognizer == pinchRecognizer {
            return canHandlePinchZoom
        }
        if gestureRecognizer == scrollRecognizer {
            if usesNativeTouchSelection, nativeSelectionInteractionActive || nativeSelectedRange != nil {
                return false
            }
            if touchSelection != nil,
               isPointOnTouchSelectionHandle(touch.location(in: self)) {
                return false
            }
        }
        return true
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        if usesNativeTouchSelection,
           nativeSelectionInteractionActive || nativeSelectedRange != nil,
           gestureRecognizer == scrollRecognizer || otherGestureRecognizer == scrollRecognizer {
            return false
        }
        if gestureRecognizer == pinchRecognizer || otherGestureRecognizer == pinchRecognizer {
            return false
        }
        // Allow pan and long press to recognize simultaneously;
        // the handlers check isSelecting/isScrolling to avoid conflicts.
        return true
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        // Long press should win over pan when held long enough
        if gestureRecognizer == scrollRecognizer && otherGestureRecognizer == selectionRecognizer {
            return otherGestureRecognizer.state == .began
        }
        return false
    }
}

// MARK: - Edit Menu Interaction Delegate

extension GhosttyTerminalView: UIEditMenuInteractionDelegate {
    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        menuFor configuration: UIEditMenuConfiguration,
        suggestedActions: [UIMenuElement]
    ) -> UIMenu? {
        var actions: [UIMenuElement] = []

        if let selectionText = normalizedSelectionMenuText(), !selectionText.isEmpty {
            actions.append(UIAction(title: "Copy", image: UIImage(systemName: "doc.on.doc")) { [weak self] _ in
                self?.copy(nil)
            })
        }

        actions.append(UIAction(title: "Paste", image: UIImage(systemName: "doc.on.clipboard")) { [weak self] _ in
            self?.paste(nil)
        })

        if usesAppOwnedTouchSelection {
            actions.append(UIAction(title: "Select All", image: UIImage(systemName: "selection.pin.in.out")) { [weak self] _ in
                self?.selectAll(nil)
            })
        }

        return UIMenu(children: actions)
    }
}

// MARK: - Terminal Key Enum

indirect enum TerminalKey {
    case escape, tab, enter, backspace, delete, insert
    case arrowUp, arrowDown, arrowLeft, arrowRight
    case home, end, pageUp, pageDown
    case f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12
    case ctrlC, ctrlD, ctrlZ, ctrlL, ctrlA, ctrlE, ctrlJ, ctrlK, ctrlU
    case modified(TerminalKey, mods: Ghostty.Input.Mods)

    func withCtrl() -> TerminalKey {
        withModifier(.ctrl)
    }

    func withAlt() -> TerminalKey {
        withModifier(.alt)
    }

    func withShift() -> TerminalKey {
        withModifier(.shift)
    }

    func withCommand() -> TerminalKey {
        withModifier(.super)
    }

    private func withModifier(_ modifier: Ghostty.Input.Mods) -> TerminalKey {
        switch self {
        case .modified(let key, let mods):
            return .modified(key, mods: mods.union(modifier))
        default:
            return .modified(self, mods: modifier)
        }
    }
}

// MARK: - Software Keyboard (UIKeyInput)

extension GhosttyTerminalView: UIKeyInput, UITextInputTraits {
    var hasText: Bool {
        if isNativeSelectionTextInputContext {
            return nativeSelectionSnapshot.length > 0 || (nativeSelectedRange?.length ?? 0) > 0
        }
        return true
    }

    func insertText(_ text: String) {
        if isNativeSelectionTextInputContext {
            guard exitNativeSelectionTextInputContextForTerminalInput() else { return }
        }
        let wasComposing = textInputModel.hasActiveIMEComposition
        handleInsertText(text, fromIMEComposition: wasComposing)
    }

    func deleteBackward() {
        if isNativeSelectionTextInputContext {
            guard exitNativeSelectionTextInputContextForTerminalInput() else { return }
        }
        if !keyModifiers.isEmpty {
            invalidateLocalTextInputSession()
            sendTerminalKey(.backspace, accumulatedMods: consumeKeyModifiers())
        } else {
            applyTerminalTextInputEffects(textInputModel.handleDeleteBackward())
        }
    }

    fileprivate func consumePendingSystemTextInputHardwareKey() -> UIKey? {
        guard !pendingSystemTextInputHardwareKeys.isEmpty else { return nil }
        return pendingSystemTextInputHardwareKeys.removeFirst()
    }

    fileprivate func discardPendingSystemTextInputHardwareKey() {
        guard !pendingSystemTextInputHardwareKeys.isEmpty else { return }
        pendingSystemTextInputHardwareKeys.removeFirst()
    }

    fileprivate func removeUnconsumedPendingSystemTextInputHardwareKeys(after pendingCount: Int) {
        guard pendingSystemTextInputHardwareKeys.count > pendingCount else { return }
        pendingSystemTextInputHardwareKeys.removeSubrange(pendingCount...)
    }

    @discardableResult
    fileprivate func sendInterpretedHardwareKeyText(_ text: String, for key: UIKey) -> Bool {
        guard canRouteTerminalInput, let surface else { return false }
        guard let sourceEvent = Ghostty.Input.KeyEvent(uiKey: key, action: .press) else {
            sendText(text)
            return true
        }
        let keyCode = UInt16(key.keyCode.rawValue)
        let interpretedEvent = Ghostty.Input.KeyEvent(
            key: sourceEvent.key,
            action: .press,
            text: text.isEmpty ? sourceEvent.text : text,
            composing: false,
            mods: sourceEvent.mods,
            consumedMods: sourceEvent.consumedMods,
            unshiftedCodepoint: sourceEvent.unshiftedCodepoint
        )
        surface.sendKeyEvent(interpretedEvent)
        hardwarePressesSentToGhostty.insert(keyCode)
        systemTextInputPresses.remove(keyCode)
        requestRender()
        return true
    }

    var keyboardType: UIKeyboardType {
        get { .default }
        set { }
    }

    var keyboardAppearance: UIKeyboardAppearance {
        get { .dark }
        set { }
    }

    var autocorrectionType: UITextAutocorrectionType {
        get { .no }
        set { }
    }

    var autocapitalizationType: UITextAutocapitalizationType {
        get { .none }
        set { }
    }

    var spellCheckingType: UITextSpellCheckingType {
        get { .no }
        set { }
    }

    var smartQuotesType: UITextSmartQuotesType {
        get { .no }
        set { }
    }

    var smartDashesType: UITextSmartDashesType {
        get { .no }
        set { }
    }

    var smartInsertDeleteType: UITextSmartInsertDeleteType {
        get { .no }
        set { }
    }

    @available(iOS 17.0, *)
    var inlinePredictionType: UITextInlinePredictionType {
        get { .no }
        set { }
    }

    var enablesReturnKeyAutomatically: Bool {
        get { false }
        set { }
    }

    var returnKeyType: UIReturnKeyType {
        get { .default }
        set { }
    }
}

// MARK: - UITextInput (spacebar cursor control + native selection)

extension GhosttyTerminalView: UITextInput {
    fileprivate var isNativeSelectionTextInputContext: Bool {
        usesNativeTouchSelection
            && (nativeSelectionInteractionActive || nativeSelectedRange != nil || prefersNativeSelectionFirstResponder)
    }

    private var activeTextInputDocumentLength: Int {
        isNativeSelectionTextInputContext ? nativeSelectionSnapshot.length : textInputModel.documentLength
    }

    private var activeTextInputColumns: Int {
        isNativeSelectionTextInputContext ? nativeSelectionSnapshot.columns : textInputGridMetrics().cols
    }

    private func activeClampedTextInputOffset(_ offset: Int) -> Int {
        min(max(offset, 0), activeTextInputDocumentLength)
    }

    private func terminalTextRange(_ range: TerminalTextInputModel.Range?) -> TerminalNativeTextRange? {
        guard let range else { return nil }
        let location = activeClampedTextInputOffset(range.location)
        let end = activeClampedTextInputOffset(range.location + range.length)
        return TerminalNativeTextRange(start: location, end: end)
    }

    private func terminalTextInputRange(from range: UITextRange?) -> TerminalTextInputModel.Range? {
        guard let range = range as? TerminalNativeTextRange else { return nil }
        let location = activeClampedTextInputOffset(range.nsRange.location)
        let end = activeClampedTextInputOffset(range.nsRange.location + range.nsRange.length)
        return .init(location: location, length: max(end - location, 0))
    }

    var selectedTextRange: UITextRange? {
        get {
            if isNativeSelectionTextInputContext {
                return nativeSelectionSnapshot.nativeRange(nativeSelectedRange)
            }
            return terminalTextRange(textInputModel.selectedRange)
        }
        set {
            if isNativeSelectionTextInputContext {
                setNativeSelectedRange(nativeSelectionSnapshot.nativeRange(from: newValue))
                return
            }
            guard let range = terminalTextInputRange(from: newValue) else { return }
            applyTerminalTextInputEffects(
                textInputModel.handleSetSelection(location: range.location, length: range.length)
            )
        }
    }

    var markedTextRange: UITextRange? {
        isNativeSelectionTextInputContext ? nil : terminalTextRange(textInputModel.markedRange)
    }

    var markedTextStyle: [NSAttributedString.Key: Any]? {
        get { nil }
        set { }
    }

    var inputDelegate: UITextInputDelegate? {
        get { nativeTextInputDelegate }
        set { nativeTextInputDelegate = newValue }
    }

    var tokenizer: UITextInputTokenizer {
        nativeSelectionTokenizer
    }

    var beginningOfDocument: UITextPosition {
        TerminalNativeTextPosition(offset: 0)
    }

    var endOfDocument: UITextPosition {
        TerminalNativeTextPosition(offset: activeTextInputDocumentLength)
    }

    func text(in range: UITextRange) -> String? {
        if isNativeSelectionTextInputContext {
            guard let range = nativeSelectionSnapshot.nativeRange(from: range) else { return nil }
            return nativeSelectionSnapshot.text(in: range)
        }
        guard let range = terminalTextInputRange(from: range) else { return nil }
        return textInputModel.substring(rangeStart: range.location, rangeEnd: range.location + range.length)
    }

    func replace(_ range: UITextRange, withText text: String) {
        if isNativeSelectionTextInputContext {
            guard !text.isEmpty else { return }
            guard exitNativeSelectionTextInputContextForTerminalInput() else { return }
            handleInsertText(text, fromIMEComposition: false)
            return
        }
        let replacementRange = terminalTextInputRange(from: range)
        applyTerminalTextInputEffects(
            textInputModel.handleReplace(
                rangeStart: replacementRange?.location,
                rangeEnd: replacementRange.map { $0.location + $0.length },
                text: text
            )
        )
    }

    func setMarkedText(_ markedText: String?, selectedRange: NSRange) {
        if isNativeSelectionTextInputContext {
            guard exitNativeSelectionTextInputContextForTerminalInput() else { return }
        }
        discardPendingSystemTextInputHardwareKey()
        applyTerminalTextInputEffects(
            textInputModel.handleSetMarkedText(
                markedText,
                selectedRangeLocation: selectedRange.location,
                selectedRangeLength: selectedRange.length
            )
        )
    }

    func unmarkText() {
        if isNativeSelectionTextInputContext {
            guard exitNativeSelectionTextInputContextForTerminalInput() else { return }
        }
        discardPendingSystemTextInputHardwareKey()
        applyTerminalTextInputEffects(textInputModel.handleUnmarkText())
    }

    var textInputView: UIView {
        self
    }

    var selectionAffinity: UITextStorageDirection {
        get { nativeSelectionAffinity }
        set { nativeSelectionAffinity = newValue }
    }

    func textRange(from fromPosition: UITextPosition, to toPosition: UITextPosition) -> UITextRange? {
        guard let from = fromPosition as? TerminalNativeTextPosition,
              let to = toPosition as? TerminalNativeTextPosition else { return nil }
        return TerminalNativeTextRange(start: from.offset, end: to.offset)
    }

    func position(from position: UITextPosition, offset: Int) -> UITextPosition? {
        guard let position = position as? TerminalNativeTextPosition else { return nil }
        return TerminalNativeTextPosition(offset: activeClampedTextInputOffset(position.offset + offset))
    }

    func position(from position: UITextPosition, in direction: UITextLayoutDirection, offset: Int) -> UITextPosition? {
        guard let position = position as? TerminalNativeTextPosition else { return nil }

        let delta: Int
        switch direction {
        case .left:
            delta = -offset
        case .right:
            delta = offset
        case .up:
            delta = -(offset * activeTextInputColumns)
        case .down:
            delta = offset * activeTextInputColumns
        @unknown default:
            delta = offset
        }

        return TerminalNativeTextPosition(offset: activeClampedTextInputOffset(position.offset + delta))
    }

    func compare(_ position: UITextPosition, to other: UITextPosition) -> ComparisonResult {
        guard let position = position as? TerminalNativeTextPosition,
              let other = other as? TerminalNativeTextPosition else { return .orderedSame }
        if position.offset < other.offset { return .orderedAscending }
        if position.offset > other.offset { return .orderedDescending }
        return .orderedSame
    }

    func offset(from: UITextPosition, to other: UITextPosition) -> Int {
        guard let from = from as? TerminalNativeTextPosition,
              let other = other as? TerminalNativeTextPosition else { return 0 }
        return other.offset - from.offset
    }

    func position(within range: UITextRange, farthestIn direction: UITextLayoutDirection) -> UITextPosition? {
        guard let range = terminalTextInputRange(from: range) else { return nil }
        switch direction {
        case .left, .up:
            return TerminalNativeTextPosition(offset: range.location)
        case .right, .down:
            return TerminalNativeTextPosition(offset: range.location + range.length)
        @unknown default:
            return TerminalNativeTextPosition(offset: range.location + range.length)
        }
    }

    func characterRange(byExtending position: UITextPosition, in direction: UITextLayoutDirection) -> UITextRange? {
        guard let position = position as? TerminalNativeTextPosition else { return nil }
        switch direction {
        case .left, .up:
            let start = activeClampedTextInputOffset(position.offset - 1)
            return TerminalNativeTextRange(start: start, end: position.offset)
        case .right, .down:
            let end = activeClampedTextInputOffset(position.offset + 1)
            return TerminalNativeTextRange(start: position.offset, end: end)
        @unknown default:
            let end = activeClampedTextInputOffset(position.offset + 1)
            return TerminalNativeTextRange(start: position.offset, end: end)
        }
    }

    func baseWritingDirection(for position: UITextPosition, in direction: UITextStorageDirection) -> NSWritingDirection {
        .leftToRight
    }

    func setBaseWritingDirection(_ writingDirection: NSWritingDirection, for range: UITextRange) {
    }

    func firstRect(for range: UITextRange) -> CGRect {
        if isNativeSelectionTextInputContext {
            guard let range = nativeSelectionSnapshot.nativeRange(from: range) else { return .zero }
            return nativeSelectionSnapshot.firstRect(for: range)
        }
        guard let range = terminalTextInputRange(from: range) else { return .zero }
        return textInputCaretRect(for: range.location)
    }

    func caretRect(for position: UITextPosition) -> CGRect {
        guard let position = position as? TerminalNativeTextPosition else { return .zero }
        if isNativeSelectionTextInputContext {
            return nativeSelectionSnapshot.caretRect(for: position.offset)
        }
        return textInputCaretRect(for: position.offset)
    }

    func selectionRects(for range: UITextRange) -> [UITextSelectionRect] {
        guard isNativeSelectionTextInputContext else { return [] }
        guard let range = nativeSelectionSnapshot.nativeRange(from: range) else { return [] }
        return nativeSelectionSnapshot.selectionRects(for: range)
    }

    func closestPosition(to point: CGPoint) -> UITextPosition? {
        guard isNativeSelectionTextInputContext else {
            return TerminalNativeTextPosition(offset: textInputModel.cursorIndex)
        }
        return TerminalNativeTextPosition(offset: nativeSelectionSnapshot.offset(for: point))
    }

    func closestPosition(to point: CGPoint, within range: UITextRange) -> UITextPosition? {
        guard isNativeSelectionTextInputContext else {
            return closestPosition(to: point)
        }
        guard let range = nativeSelectionSnapshot.nativeRange(from: range) else { return nil }
        let offset = nativeSelectionSnapshot.offset(for: point)
        let clamped = min(max(offset, range.location), range.location + range.length)
        return TerminalNativeTextPosition(offset: clamped)
    }

    func characterRange(at point: CGPoint) -> UITextRange? {
        guard isNativeSelectionTextInputContext else {
            let offset = activeClampedTextInputOffset(textInputModel.cursorIndex)
            return TerminalNativeTextRange(start: offset, end: offset)
        }
        guard let range = nativeSelectionSnapshot.characterRange(at: point) else { return nil }
        return TerminalNativeTextRange(start: range.location, end: range.location + range.length)
    }

    func textStyling(at position: UITextPosition, in direction: UITextStorageDirection) -> [NSAttributedString.Key: Any]? {
        nil
    }

    @available(iOS 16.0, *)
    func editMenu(for textRange: UITextRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
        guard usesNativeTouchSelection else { return nil }
        return UIMenu(children: nativeSelectionMenuElements())
    }

    func position(within range: UITextRange, atCharacterOffset offset: Int) -> UITextPosition? {
        guard let range = terminalTextInputRange(from: range) else { return nil }
        return TerminalNativeTextPosition(offset: activeClampedTextInputOffset(range.location + offset))
    }

    func characterOffset(of position: UITextPosition, within range: UITextRange) -> Int {
        guard let position = position as? TerminalNativeTextPosition,
              let range = terminalTextInputRange(from: range) else { return 0 }
        return position.offset - range.location
    }
}

// MARK: - Zoom Indicator HUD

private final class TerminalZoomIndicatorView: UIVisualEffectView {
    private let valueLabel = UILabel()
    private let titleLabel = UILabel()
    private let stackView = UIStackView()

    override init(effect: UIVisualEffect? = UIBlurEffect(style: .systemChromeMaterialDark)) {
        super.init(effect: effect)
        isUserInteractionEnabled = false
        clipsToBounds = true
        layer.cornerRadius = 18
        layer.cornerCurve = .continuous

        valueLabel.font = .monospacedDigitSystemFont(ofSize: 24, weight: .semibold)
        valueLabel.textColor = .white
        valueLabel.textAlignment = .center

        titleLabel.font = .systemFont(ofSize: 12, weight: .medium)
        titleLabel.textColor = UIColor.white.withAlphaComponent(0.72)
        titleLabel.textAlignment = .center
        titleLabel.text = TerminalZoomPresentation.indicatorTitle

        stackView.axis = .vertical
        stackView.alignment = .center
        stackView.spacing = 3
        stackView.translatesAutoresizingMaskIntoConstraints = false
        stackView.addArrangedSubview(valueLabel)
        stackView.addArrangedSubview(titleLabel)
        contentView.addSubview(stackView)

        NSLayoutConstraint.activate([
            stackView.leadingAnchor.constraint(greaterThanOrEqualTo: contentView.leadingAnchor, constant: 18),
            stackView.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -18),
            stackView.topAnchor.constraint(greaterThanOrEqualTo: contentView.topAnchor, constant: 12),
            stackView.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -12),
            stackView.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            stackView.centerYAnchor.constraint(equalTo: contentView.centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func update(fontSize: Double) {
        valueLabel.text = TerminalZoomPresentation.formattedFontSize(fontSize)
    }
}
