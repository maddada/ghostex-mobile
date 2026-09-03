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
    weak var ghosttyAppWrapper: Ghostty.App?
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
    var surfacePresentationOverrides = TerminalPresentationOverrides.empty

    var didSignalReady = false
    var isShuttingDown = false
    var isPaused = false
    private var customIORedrawScheduled = false
    var keyRepeatTimer: DispatchSourceTimer?
    var repeatingHardwareKey: UIKey?
    var repeatingFallbackKey: Ghostty.Input.Key?
    var repeatingFallbackModifiers: UIKeyModifierFlags = []
    var repeatingKeyCode: UInt16?

    var lastPixelSize: CGSize = .zero
    var lastContentScale: CGFloat = 0
    var lastReportedGrid: (cols: Int, rows: Int) = (0, 0)

    /// Grid pinned by setTerminalGrid (hidden zmx client resting wide); while set,
    /// bounds changes do not resize the surface. See GhosttyTerminalView+Sizing.
    var pinnedGrid: (cols: Int, rows: Int)?

    /// Cell size in points, reported by Ghostty (CELL_SIZE action)
    var cellSize: CGSize = .zero

    // MARK: - Gesture State

    var isSelecting = false
    var isScrolling = false
    var isPinchingTerminalZoom = false
    var pinchReferenceScale: CGFloat = 1
    let zoomIndicatorView = TerminalZoomIndicatorView()
    var zoomIndicatorHideWorkItem: DispatchWorkItem?

    // MARK: - Native (UITextInteraction) selection state

    var nativeSelectionSnapshot = TerminalNativeTextSnapshot.empty
    var nativeSelectedRange: NSRange?
    weak var nativeTextInputDelegate: UITextInputDelegate?
    lazy var nativeSelectionTokenizer = UITextInputStringTokenizer(textInput: self)
    var nativeSelectionAffinity: UITextStorageDirection = .forward
    var nativeSelectionInteractionActive = false
    var prefersNativeSelectionFirstResponder = false
    var shouldRestoreFocusAfterNativeSelection = false
    var nativeTextInteraction: UITextInteraction?

    // MARK: - App-owned selection state

    var touchSelectionAnchor: TerminalGridPoint?
    var touchSelectionSeed: TerminalGridSelection?
    var touchSelection: TerminalGridSelection? {
        didSet {
            updateTouchSelectionOverlay()
        }
    }
    let touchSelectionOverlay = TerminalTouchSelectionOverlayView()
    let touchSelectionLoupe = TerminalTouchSelectionLoupeView()

    lazy var selectionRecognizer: UILongPressGestureRecognizer = {
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

    lazy var scrollRecognizer: UIPanGestureRecognizer = {
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

    lazy var pinchRecognizer: UIPinchGestureRecognizer = {
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

    var editMenuInteraction: UIEditMenuInteraction?

    // MARK: - Text Input State

    var textInputModel = TerminalTextInputModel()
    var pendingSystemTextInputHardwareKeys: [UIKey] = []
    var renderedIMEPreeditText: String?
    var hardwarePressesSentToGhostty: Set<UInt16> = []
    var fallbackHardwarePressKeys: [UInt16: Ghostty.Input.Key] = [:]
    var fallbackHardwarePressModifiers: [UInt16: UIKeyModifierFlags] = [:]
    var systemTextInputPresses: Set<UInt16> = []
    var keyModifiers: Ghostty.Input.Mods = []
    var lockedKeyModifiers: Ghostty.Input.Mods = []

    struct HardwarePressResult {
        var forwardedToSystem: Set<UIPress> = []
        var didHandleGhosttyInput = false
    }

    // MARK: - Keyboard Focus

    var acceptsTerminalInput = true
    var keyboardFocusPolicy = TerminalKeyboardFocusPolicy()
    var hasHardwareKeyboardAttached = false

    // MARK: - Rendering Components

    private let renderingSetup = GhosttyRenderingSetup()

    func requestRender() {
        if isShuttingDown { return }
        if isPaused { return }
        guard surface?.unsafeCValue != nil else { return }
        guard bounds.width > 0 && bounds.height > 0 else { return }
        if usesNativeTouchSelection, nativeSelectionInteractionActive || nativeSelectedRange != nil {
            refreshNativeSelectionSnapshot()
        }
        markIOSurfaceLayersForDisplay()
    }

    func scheduleCustomIORedraw() {
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

    // MARK: - Momentum Scroll State (stored here; behavior in GhosttyTerminalView+ScrollAndZoom.swift)

    /// Display link for momentum animation
    var momentumDisplayLink: CADisplayLink?
    var momentumVelocity: CGPoint = .zero
    var momentumPhase: Ghostty.Input.Momentum = .none

    // MARK: - Custom I/O API (stored here; behavior in GhosttyTerminalView+ProcessLifecycle.swift)

    /// Callback invoked when user types in the terminal
    var writeCallback: ((Data) -> Void)?
}
