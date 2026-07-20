//
//  GhostexTerminalHostView.swift
//  GhostexNative
//
//  Expo view with prop `sessionKey`. Mounting attaches the registry entry's
//  terminal view (rendering + touch + IME input); unmounting detaches without
//  killing the entry (warm sessions).
//

import UIKit
import ExpoModulesCore

final class GhostexTerminalHostView: ExpoView {
    let onSingleTap = EventDispatcher()

    private(set) var sessionKey: String?
    private weak var attachedTerminalView: GhosttyTerminalView?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        backgroundColor = .black
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setSessionKey(_ newKey: String) {
        guard newKey != sessionKey else {
            attachIfNeeded()
            return
        }
        detachTerminalView()
        sessionKey = newKey
        attachIfNeeded()
    }

    private func attachIfNeeded() {
        guard let sessionKey else { return }
        guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
              let terminalView = entry.view else {
            return
        }
        guard terminalView.superview !== self else { return }

        // Steal the view from any previous host (a session shows in one place).
        terminalView.removeFromSuperview()
        entry.hostView?.attachedTerminalView = nil
        entry.hostView = self

        terminalView.frame = bounds
        addSubview(terminalView)
        attachedTerminalView = terminalView

        terminalView.onSingleTap = { [weak self] in
            self?.onSingleTap()
        }

        terminalView.resumeRendering()
        terminalView.sizeDidChange(bounds.size)
    }

    func detachTerminalView() {
        guard let terminalView = attachedTerminalView else { return }
        terminalView.onSingleTap = nil
        terminalView.pauseRendering()
        terminalView.removeFromSuperview()
        attachedTerminalView = nil
        if let sessionKey, let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey), entry.hostView === self {
            entry.hostView = nil
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let terminalView = attachedTerminalView else {
            // The entry may have been created after the prop was set.
            attachIfNeeded()
            return
        }
        if terminalView.frame != bounds {
            terminalView.frame = bounds
        }
        terminalView.sizeDidChange(bounds.size)
    }

    override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        if newWindow == nil {
            detachTerminalView()
        } else {
            attachIfNeeded()
        }
    }
}
