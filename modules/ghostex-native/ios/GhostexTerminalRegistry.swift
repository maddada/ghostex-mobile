//
//  GhostexTerminalRegistry.swift
//  GhostexNative
//
//  Native registries backing the module contract:
//  - machineId  -> SSHConnection (multiplexed channels)
//  - sessionKey -> TerminalSessionEntry (ghostty view + PTY shell channel)
//
//  Terminal entries survive view unmount (warm sessions); JS enforces the
//  max-warm policy by calling closeTerminal.
//

import Foundation
import UIKit

// MARK: - Connection registry (thread-safe; connections are actors)

final class GhostexConnectionStore: @unchecked Sendable {
    static let shared = GhostexConnectionStore()

    private let lock = NSLock()
    private var connections: [String: SSHConnection] = [:]

    private init() {}

    func connection(for machineId: String) -> SSHConnection? {
        lock.lock()
        defer { lock.unlock() }
        return connections[machineId]
    }

    /// Replaces any existing connection and returns the previous one (caller disconnects it).
    @discardableResult
    func set(_ connection: SSHConnection?, for machineId: String) -> SSHConnection? {
        lock.lock()
        defer { lock.unlock() }
        let previous = connections[machineId]
        if let connection {
            connections[machineId] = connection
        } else {
            connections.removeValue(forKey: machineId)
        }
        return previous
    }
}

// MARK: - Terminal session entry

/// One native terminal: ghostty surface/view + SSH PTY shell channel.
@MainActor
final class TerminalSessionEntry {
    let sessionKey: String
    let machineId: String
    let connection: SSHConnection

    var view: GhosttyTerminalView?
    var shellId: UUID?
    var fontSize: Double
    var pumpTask: Task<Void, Never>?
    weak var hostView: GhostexTerminalHostView?

    /// Set when the entry was closed intentionally (suppresses the extra
    /// "closed" event when the byte pump drains).
    var isClosed = false

    init(sessionKey: String, machineId: String, connection: SSHConnection, fontSize: Double) {
        self.sessionKey = sessionKey
        self.machineId = machineId
        self.connection = connection
        self.fontSize = fontSize
    }

    func teardown() {
        isClosed = true
        pumpTask?.cancel()
        pumpTask = nil

        if let shellId {
            let connection = self.connection
            Task {
                await connection.closeShell(shellId)
            }
        }
        shellId = nil

        hostView?.detachTerminalView()
        hostView = nil

        view?.cleanup()
        view?.removeFromSuperview()
        view = nil
    }
}

// MARK: - Terminal registry (main-actor: owns UIKit-backed entries)

@MainActor
final class GhostexTerminalRegistry {
    static let shared = GhostexTerminalRegistry()

    private(set) var entries: [String: TerminalSessionEntry] = [:]
    private var ghosttyApp: Ghostty.App?

    private init() {}

    /// Shared libghostty app instance (created lazily on first terminal).
    func sharedGhosttyApp() -> Ghostty.App {
        if let ghosttyApp {
            return ghosttyApp
        }
        let app = Ghostty.App()
        ghosttyApp = app
        return app
    }

    func entry(for sessionKey: String) -> TerminalSessionEntry? {
        entries[sessionKey]
    }

    func register(_ entry: TerminalSessionEntry) {
        entries[entry.sessionKey] = entry
    }

    func remove(_ sessionKey: String) -> TerminalSessionEntry? {
        entries.removeValue(forKey: sessionKey)
    }

    func sessionKeys() -> [String] {
        Array(entries.keys)
    }

    func entries(forMachineId machineId: String) -> [TerminalSessionEntry] {
        entries.values.filter { $0.machineId == machineId }
    }
}
