//
//  GhostexVerticalBar.swift
//  GhostexNative
//
//  Where the system's bars sit in the app's window, so the app's own header can sit there too. Built
//  with the iOS 27.1 SDK, the app reaches the screen edges on the iPhone Duo. The system would stand
//  the status bar on one side of the window (`UITraitCollection.verticalBarEdge`) folded and unfolded in
//  landscape, with bars laid out vertically below it; the app's root view controller turns that off
//  from the first frame (`GhostexRootViewController`, `.disabled`) and Expo's switch (index.ts) does for
//  controllers presented over it (modals, alerts), so the status items run along the top in every pose and no
//  side bar exists, but the observer still reports one should the system stand one.
//  `UIView.LayoutRegion.bar(onEdge:extent:)` is the region a bar of a given extent takes on an edge,
//  clear of the status bar and the camera. The regions move while the app runs (a Live Activity lowers
//  the side status items), so the app follows them through `GhostexBarLayoutObserver` rather than
//  asking once.
//
//  Both are iOS 27.1 API. They compile only against an SDK whose UIKit has them (the module version
//  of the iOS 27.1 SDK's UIKit, the gate Expo SDK 58's expo-status-bar uses) and run only on iOS 27.1:
//  an older SDK or system reports the window's size and insets without regions, and the app keeps its
//  header on top as before.
//

import ExpoModulesCore
import OSLog
import UIKit

@MainActor
enum GhostexVerticalBar {
    /// The running observation: its view (kept here, it moves between windows) and its id.
    private static var observer: GhostexBarLayoutObserver?
    private static var observerID = 0

    /// The hosting window's bar layout (`layout(in:)`) and an id for `stop(id:)`; from now on
    /// `onChange` with each new layout. Following the app to another window (the Duo's outer and inner
    /// display) takes `windowChangeObservers()` as well, which the module holds while JS listens.
    /// Replaces any earlier observation.
    static func observe(
        sideExtent: CGFloat,
        topExtent: CGFloat,
        onChange: @escaping ([String: Any]) -> Void
    ) -> (id: Int, layout: [String: Any]) {
        end()
        observerID += 1
        let next = GhostexBarLayoutObserver(sideExtent: sideExtent, topExtent: topExtent, onChange: onChange)
        observer = next
        return (observerID, hostWindow().map { next.attach(to: $0) } ?? [:])
    }

    /// Ends observation `id` if it is still the running one: its view leaves the window. A newer
    /// observation (another caller's, a newer module's) is left alone.
    static func stop(id: Int) {
        if id == observerID { end() }
    }

    private static func end() {
        observer?.removeFromSuperview()
        observer = nil
    }

    /// System notifications after which the app may be shown in another window (a key window or scene
    /// changing); each moves the running observation's view there. The caller removes them
    /// (`NotificationCenter.removeObserver`) when it stops listening.
    nonisolated static func windowChangeObservers() -> [NSObjectProtocol] {
        let center = NotificationCenter.default
        return [
            UIWindow.didBecomeKeyNotification,
            UIScene.didActivateNotification,
            UIScene.didDisconnectNotification,
        ].map { name in
            center.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { followHostWindow() }
            }
        }
    }

    /// The window showing the app: the key window of the scene in the foreground (Expo's
    /// `SceneGeometry`, which looks only at that scene on iOS 27, where scenes differ in size).
    private static func hostWindow() -> UIWindow? {
        SceneGeometry.keyWindow()
    }

    /// Moves the observer to the hosting window when that is another one; a resized window is followed
    /// by layout alone, so this does nothing then.
    private static func followHostWindow() {
        guard let observer else { return }
        guard let window = hostWindow() else {
            observer.removeFromSuperview()
            return
        }
        if observer.window !== window { observer.move(to: window) }
    }

    /// The bar regions of `window`, in window points: `edge` ("leading"/"trailing") and `sideBar` while
    /// the system stands its vertical bar on that side, `topBar` for a horizontal bar of `topExtent`
    /// along the top, the window's size, its top, left and right safe-area insets (so a layout can be
    /// kept per window size and used the moment the window has that size again), `marginTop` (where a
    /// row heading the content starts: the system spacing below the safe area's top) and its size
    /// classes. Before iOS 27.1 no regions.
    static func layout(in window: UIWindow, sideExtent: CGFloat, topExtent: CGFloat, marginTop: CGFloat)
        -> [String: Any]
    {
        let insets = window.safeAreaInsets
        var result: [String: Any] = [
            "windowWidth": window.bounds.width,
            "windowHeight": window.bounds.height,
            "safeTop": insets.top,
            "safeLeft": insets.left,
            "safeRight": insets.right,
            "marginTop": marginTop,
        ]
        if let horizontal = sizeClass(window.traitCollection.horizontalSizeClass) {
            result["horizontalSizeClass"] = horizontal
        }
        if let vertical = sizeClass(window.traitCollection.verticalSizeClass) {
            result["verticalSizeClass"] = vertical
        }
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            if let side = sideEdge(of: window) {
                result["edge"] = side == .leading ? "leading" : "trailing"
                result["sideBar"] = rect(window, sideRegion(side, extent: sideExtent))
            }
            result["topBar"] = rect(window, topRegion(extent: topExtent))
        }
        #endif
        return result
    }

    private static func sizeClass(_ value: UIUserInterfaceSizeClass) -> String? {
        switch value {
        case .regular: return "regular"
        case .compact: return "compact"
        default: return nil
        }
    }

    #if canImport(UIKit, _version: 9127.0.85)
    /// The side the system stands its vertical bar on, or nil where it has none. Read from the root view
    /// controller: it decides the behavior (`GhostexRootViewController` answers `.disabled`, so no side),
    /// and the window's own trait still names the side the system would use (measured on the iPhone Duo
    /// simulator: window `trailing`, root view controller unspecified, status items in a row on top).
    @available(iOS 27.1, *)
    static func sideEdge(of window: UIWindow) -> NSDirectionalRectEdge? {
        let traits = window.rootViewController?.traitCollection ?? window.traitCollection
        switch traits.verticalBarEdge {
        case .leading: return .leading
        case .trailing: return .trailing
        default: return nil
        }
    }

    @available(iOS 27.1, *)
    static func sideRegion(_ side: NSDirectionalRectEdge, extent: CGFloat) -> UIView.LayoutRegion {
        .bar(onEdge: side, extent: extent)
    }

    @available(iOS 27.1, *)
    static func topRegion(extent: CGFloat) -> UIView.LayoutRegion {
        .bar(onEdge: UIRectEdge.top, extent: extent)
    }

    @available(iOS 27.1, *)
    private static func rect(_ window: UIWindow, _ region: UIView.LayoutRegion) -> [String: CGFloat] {
        rectValue(window.bounds.inset(by: window.edgeInsets(for: region)))
    }

    /// G3 D4's record of the fold: each division region the observer read, in the screen coordinate
    /// space of the display showing the window (WDA's frames are screen coordinates), unrounded and as
    /// `CGRectIntegral` (how WDA's `/source` rounds frames), and the window's own frame there as the
    /// calibration line (WDA lists the window with its frame). The display is told by its size.
    @available(iOS 27.1, *)
    static func logDivisions(_ regions: [UIView.ReservedRegion], of view: UIView, in window: UIWindow) {
        guard let screen = window.windowScene?.screen else { return }
        let space = screen.coordinateSpace
        let windowFrame = window.convert(window.bounds, to: space)
        let display = "\(Int(screen.bounds.width))x\(Int(screen.bounds.height))"
        logger.log(
            "D4 calibration display=\(display, privacy: .public) source=GhostexBarLayoutObserver window=\(describe(windowFrame), privacy: .public) windowIntegral=\(describe(windowFrame.integral), privacy: .public) divisions=\(regions.count, privacy: .public)"
        )
        for region in regions {
            let frame = view.convert(region.frame, to: space)
            logger.log(
                "D4 division display=\(display, privacy: .public) active=\(region.isActive, privacy: .public) frame=\(describe(frame), privacy: .public) integral=\(describe(frame.integral), privacy: .public)"
            )
        }
    }
    #endif

    /// What the observer reports, one line per change: the record of which placement the window gets.
    static func logLayout(_ layout: [String: Any]) {
        let edge = (layout["edge"] as? String) ?? "none"
        let side = (layout["sideBar"] as? [String: CGFloat]).map { describe(rectFrame($0)) } ?? "none"
        let top = (layout["topBar"] as? [String: CGFloat]).map { describe(rectFrame($0)) } ?? "none"
        let safeTop = (layout["safeTop"] as? CGFloat) ?? 0
        logger.log(
            "layout edge=\(edge, privacy: .public) sideBar=\(side, privacy: .public) topBar=\(top, privacy: .public) safeTop=\(safeTop, privacy: .public)"
        )
    }

    private static func rectFrame(_ value: [String: CGFloat]) -> CGRect {
        CGRect(x: value["x"] ?? 0, y: value["y"] ?? 0, width: value["width"] ?? 0, height: value["height"] ?? 0)
    }

    private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "app.ghostex.mobile",
        category: "GhostexVerticalBar"
    )

    private static func describe(_ frame: CGRect) -> String {
        "\(frame.minX),\(frame.minY),\(frame.width),\(frame.height)"
    }

    /// A rectangle as JS reads it (`WindowRect`).
    static func rectValue(_ frame: CGRect) -> [String: CGFloat] {
        ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
    }
}

/// Follows the bar regions of its window without polling: a transparent, non-interactive view over the
/// whole window with empty probes pinned to the window's layout guides for the top and the side bar
/// region, and one at the system spacing below the safe area's top. When UIKit moves a region, Auto
/// Layout lays this view out again (as on rotation, a safe-area change, or a change of the traits that
/// decide the side bar), and it reports the window's bar layout when that differs from the last report.
/// The probes move to the other side's guide in `updateConstraints`, after the traits that decide the
/// side changed, and the fold's division regions are read there too (`readDivisions`, FL-DUO-03);
/// `layoutSubviews` only reads the settled layout (FL-LAY-12).
@MainActor
final class GhostexBarLayoutObserver: UIView {
    private let sideExtent: CGFloat
    private let topExtent: CGFloat
    private let onChange: ([String: Any]) -> Void
    private let topProbe = UIView()
    private let sideProbe = UIView()
    /// Where a row heading the content starts (`marginTop`). UIKit's layout margins of a plain view are
    /// zero from iOS 27.1, so the system spacing below the safe area gives that place instead.
    private let marginProbe = UIView()
    private var regionConstraints: [NSLayoutConstraint] = []
    private var marginConstraints: [NSLayoutConstraint] = []
    private var pinnedSide: NSDirectionalRectEdge?
    /// The fold's division regions in window points with their fold state, as last read (`readDivisions`).
    private var divisions: [FoldDivision] = []
    private var reported: NSDictionary?

    init(sideExtent: CGFloat, topExtent: CGFloat, onChange: @escaping ([String: Any]) -> Void) {
        self.sideExtent = sideExtent
        self.topExtent = topExtent
        self.onChange = onChange
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        for probe in [topProbe, sideProbe, marginProbe] {
            probe.translatesAutoresizingMaskIntoConstraints = false
            addSubview(probe)
        }
        if #available(iOS 17.0, *) {
            var traits: [UITrait] = [UITraitHorizontalSizeClass.self, UITraitVerticalSizeClass.self]
            #if canImport(UIKit, _version: 9127.0.85)
            if #available(iOS 27.1, *) {
                traits += UITraitCollection.systemTraitsAffectingVerticalBarEdge
            }
            #endif
            registerForTraitChanges(traits) { (observer: GhostexBarLayoutObserver, _: UITraitCollection) in
                observer.setNeedsUpdateConstraints()
                observer.setNeedsLayout()
            }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    /// Joins `window`, pins the probes and returns the current layout (also the first report's base).
    func attach(to window: UIWindow) -> [String: Any] {
        frame = window.bounds
        window.addSubview(self)
        pinMarginProbe(in: window)
        pinRegionProbes(in: window)
        readDivisions()
        layoutIfNeeded()
        let layout = currentLayout(in: window)
        reported = layout as NSDictionary
        GhostexVerticalBar.logLayout(layout)
        return layout
    }

    /// Joins another window and reports its layout.
    func move(to window: UIWindow) {
        onChange(attach(to: window))
    }

    override func updateConstraints() {
        if let window, currentSide(of: window) != pinnedSide { pinRegionProbes(in: window) }
        readDivisions()
        super.updateConstraints()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let window else { return }
        let layout = currentLayout(in: window)
        let snapshot = layout as NSDictionary
        guard snapshot != reported else { return }
        reported = snapshot
        GhostexVerticalBar.logLayout(layout)
        onChange(layout)
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        setNeedsUpdateConstraints()
        setNeedsLayout()
    }

    private func currentLayout(in window: UIWindow) -> [String: Any] {
        var layout = GhostexVerticalBar.layout(
            in: window,
            sideExtent: sideExtent,
            topExtent: topExtent,
            marginTop: convert(marginProbe.frame, to: window).minY
        )
        // As JS reads them (`FoldDivision` in GhostexNative.types.ts).
        layout["divisions"] = divisions.map { division -> [String: Any] in
            var value: [String: Any] = GhostexVerticalBar.rectValue(division.frame)
            value["active"] = division.active
            return value
        }
        return layout
    }

    private func currentSide(of window: UIWindow) -> NSDirectionalRectEdge? {
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) { return GhostexVerticalBar.sideEdge(of: window) }
        #endif
        return nil
    }

    private func pinMarginProbe(in window: UIWindow) {
        NSLayoutConstraint.deactivate(marginConstraints)
        marginConstraints = [
            marginProbe.leadingAnchor.constraint(equalTo: leadingAnchor),
            marginProbe.widthAnchor.constraint(equalToConstant: 0),
            marginProbe.heightAnchor.constraint(equalToConstant: 0),
            marginProbe.topAnchor.constraint(
                equalToSystemSpacingBelow: window.safeAreaLayoutGuide.topAnchor,
                multiplier: 1
            ),
        ]
        NSLayoutConstraint.activate(marginConstraints)
    }

    private func pinRegionProbes(in window: UIWindow) {
        NSLayoutConstraint.deactivate(regionConstraints)
        regionConstraints = []
        pinnedSide = currentSide(of: window)
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            let top = window.layoutGuide(for: GhostexVerticalBar.topRegion(extent: topExtent))
            let side = pinnedSide.map {
                window.layoutGuide(for: GhostexVerticalBar.sideRegion($0, extent: sideExtent))
            }
            let guides: [(UIView, UILayoutGuide?)] = [(topProbe, top), (sideProbe, side)]
            for (probe, guide) in guides {
                guard let guide else { continue }
                regionConstraints += [
                    probe.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
                    probe.topAnchor.constraint(equalTo: guide.topAnchor),
                    probe.widthAnchor.constraint(equalTo: guide.widthAnchor),
                    probe.heightAnchor.constraint(equalTo: guide.heightAnchor),
                ]
            }
        }
        #endif
        NSLayoutConstraint.activate(regionConstraints)
    }

    /// The fold's division regions (FL-DUO-03): read here, in the view that measures where the chrome
    /// goes, inside `updateConstraints`, which UIKit runs again when the regions change. The frames are
    /// taken as given, margins included, and inactive ones too (`.includeInactive`), each with its
    /// `isActive`: the persistent chrome keeps off the fold while the display is flat, so nothing moves
    /// when it folds, and menus keep off only active ones (JS `menuRoomBeside`). A change is reported
    /// with the next layout pass. Before iOS 27.1 there are none.
    private func readDivisions() {
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            guard let window else { return }
            let regions = reservedRegions(kind: .division, options: .includeInactive)
            let read = regions.map { FoldDivision(frame: convert($0.frame, to: window), active: $0.isActive) }
            guard read != divisions else { return }
            divisions = read
            GhostexVerticalBar.logDivisions(regions, of: self, in: window)
            setNeedsLayout()
        }
        #endif
    }
}

/// A division region of the fold in window points and whether the fold divides the display there now.
private struct FoldDivision: Equatable {
    let frame: CGRect
    let active: Bool
}
