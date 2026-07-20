//
//  GhostexNativeModule.swift
//  GhostexNative
//
//  Expo module implementing the ghostex-mobile native contract
//  (docs/ARCHITECTURE.md). PTY bytes never cross the JS bridge: the SSH shell
//  channel is piped into libghostty entirely natively.
//

import Foundation
import UIKit
import ExpoModulesCore

// MARK: - Records

struct SshConfigRecord: Record {
    @Field var host: String = ""
    @Field var port: Int = 22
    @Field var username: String = ""
    @Field var password: String?
    @Field var privateKey: String?
    @Field var passphrase: String?
}

struct OpenTerminalOptionsRecord: Record {
    @Field var command: String?
    @Field var termType: String?
    @Field var fontSize: Double?
}

struct KeyModifiersRecord: Record {
    @Field var ctrl: Bool = false
    @Field var alt: Bool = false
    @Field var shift: Bool = false
    @Field var cmd: Bool = false
}

// MARK: - Module

public class GhostexNativeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("GhostexNative")

        Events(
            "onTerminalState",
            "onTerminalTitle",
            "onTerminalBell",
            "onFontSizeChange",
            "onConnectionState"
        )

        // MARK: Connection lifecycle

        AsyncFunction("connect") { (machineId: String, config: SshConfigRecord) async throws in
            let credentials = SSHCredentials(
                password: config.password,
                privateKey: config.privateKey,
                passphrase: config.passphrase
            )
            let connectionConfig = SSHConnectionConfig(
                host: config.host,
                port: config.port,
                username: config.username,
                credentials: credentials
            )

            self.sendConnectionState(machineId, state: "connecting")

            let connection = SSHConnection(config: connectionConfig)
            do {
                try await connection.connect()
            } catch {
                let exception = ghostexException(from: error)
                self.sendConnectionState(
                    machineId,
                    state: "failed",
                    error: exception.reason,
                    errorCode: exception.code
                )
                throw exception
            }

            // Reconnecting with new config replaces the previous client.
            let previous = GhostexConnectionStore.shared.set(connection, for: machineId)
            if let previous {
                await previous.disconnect()
            }

            self.sendConnectionState(machineId, state: "connected")
        }

        AsyncFunction("disconnect") { (machineId: String) async throws in
            guard let connection = GhostexConnectionStore.shared.set(nil, for: machineId) else {
                self.sendConnectionState(machineId, state: "disconnected")
                return
            }

            // Tear down terminals bound to this machine first so their pumps
            // finish cleanly.
            await MainActor.run {
                for entry in GhostexTerminalRegistry.shared.entries(forMachineId: machineId) {
                    entry.teardown()
                    _ = GhostexTerminalRegistry.shared.remove(entry.sessionKey)
                    self.sendTerminalState(entry.sessionKey, state: "closed")
                }
            }

            await connection.disconnect()
            self.sendConnectionState(machineId, state: "disconnected")
        }

        AsyncFunction("isConnected") { (machineId: String) async -> Bool in
            guard let connection = GhostexConnectionStore.shared.connection(for: machineId) else {
                return false
            }
            return await connection.isConnected
        }

        // MARK: Non-interactive exec

        AsyncFunction("exec") { (machineId: String, command: String, timeoutMs: Double?) async throws -> [String: Any] in
            guard let connection = GhostexConnectionStore.shared.connection(for: machineId) else {
                throw GhostexException(code: .notConnected, reason: "No connection for machine \(machineId)")
            }
            do {
                let timeout = timeoutMs.map { $0 / 1000.0 }
                let result = try await connection.execute(command, timeout: timeout)
                return [
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "exitCode": result.exitCode,
                ]
            } catch {
                throw ghostexException(from: error)
            }
        }

        // MARK: PTY terminal lifecycle

        AsyncFunction("openTerminal") { (sessionKey: String, machineId: String, opts: OpenTerminalOptionsRecord) async throws in
            guard let connection = GhostexConnectionStore.shared.connection(for: machineId) else {
                throw GhostexException(code: .notConnected, reason: "No connection for machine \(machineId)")
            }
            guard await connection.isConnected else {
                throw GhostexException(code: .notConnected, reason: "Machine \(machineId) is not connected")
            }

            // Replace an existing entry with the same key.
            await MainActor.run {
                if let existing = GhostexTerminalRegistry.shared.remove(sessionKey) {
                    existing.teardown()
                }
            }

            self.sendTerminalState(sessionKey, state: "opening")

            let fontSize = TerminalDefaults.clampedFontSize(opts.fontSize ?? TerminalDefaults.defaultFontSize)
            let termType = opts.termType ?? "xterm-256color"
            let command = opts.command

            // Create the terminal view + surface natively (custom I/O mode).
            let (entry, cols, rows) = try await MainActor.run {
                () throws -> (TerminalSessionEntry, Int, Int) in
                let registry = GhostexTerminalRegistry.shared
                let app = registry.sharedGhosttyApp()
                guard let ghosttyApp = app.app else {
                    throw GhostexException(code: .channelFailed, reason: "libghostty failed to initialize")
                }

                let entry = TerminalSessionEntry(
                    sessionKey: sessionKey,
                    machineId: machineId,
                    connection: connection,
                    fontSize: fontSize
                )

                let view = GhosttyTerminalView(
                    frame: .zero,
                    worktreePath: NSTemporaryDirectory(),
                    ghosttyApp: ghosttyApp,
                    appWrapper: app,
                    command: nil,
                    fontSize: fontSize,
                    useCustomIO: true
                )
                entry.view = view

                view.onTitleChange = { [weak self] title in
                    self?.sendEvent("onTerminalTitle", [
                        "sessionKey": sessionKey,
                        "title": title,
                    ])
                }
                view.onBell = { [weak self] in
                    self?.sendEvent("onTerminalBell", [
                        "sessionKey": sessionKey,
                    ])
                }
                view.onZoomAction = { [weak self, weak entry, weak view] action in
                    guard let entry, let view else { return nil }
                    let overrides = view.surfacePresentationOverrides.applyingZoom(action)
                    view.applyPresentationOverrides(overrides)
                    entry.fontSize = overrides.resolvedFontSize()
                    self?.sendEvent("onFontSizeChange", [
                        "sessionKey": entry.sessionKey,
                        "fontSize": entry.fontSize,
                    ])
                    return TerminalZoomResult(
                        presentationOverrides: overrides,
                        effectiveFontSize: overrides.resolvedFontSize()
                    )
                }
                view.onResize = { [weak entry] cols, rows in
                    guard let entry, let shellId = entry.shellId else { return }
                    let connection = entry.connection
                    Task {
                        try? await connection.resize(cols: cols, rows: rows, for: shellId)
                    }
                }

                // Surface write -> SSH channel, entirely natively.
                view.setupWriteCallback()
                view.writeCallback = { [weak entry] data in
                    guard let entry, let shellId = entry.shellId else { return }
                    let connection = entry.connection
                    Task {
                        try? await connection.write(data, to: shellId)
                    }
                }

                registry.register(entry)

                let size = view.terminalSize()
                let cols = size.map { max(Int($0.columns), 2) } ?? 80
                let rows = size.map { max(Int($0.rows), 2) } ?? 24
                return (entry, cols, rows)
            }

            // Open the PTY shell channel.
            let handle: ShellHandle
            do {
                handle = try await connection.startShell(
                    cols: cols,
                    rows: rows,
                    terminalType: termType,
                    startupCommand: command
                )
            } catch {
                await MainActor.run {
                    entry.teardown()
                    _ = GhostexTerminalRegistry.shared.remove(sessionKey)
                }
                let exception = ghostexException(from: error)
                self.sendTerminalState(
                    sessionKey,
                    state: "failed",
                    error: exception.reason,
                    errorCode: exception.code
                )
                throw exception
            }

            // SSH channel bytes -> ghostty_surface_feed_data, entirely natively.
            await MainActor.run {
                entry.shellId = handle.id
                entry.pumpTask = Task { [weak self, weak entry] in
                    for await data in handle.stream {
                        guard let entry else { break }
                        await MainActor.run {
                            entry.view?.feedData(data)
                        }
                    }
                    // Stream finished: channel closed (EOF, error, or teardown).
                    guard let entry else { return }
                    let wasClosed = await MainActor.run { () -> Bool in
                        let closed = entry.isClosed
                        entry.shellId = nil
                        return closed
                    }
                    if !wasClosed {
                        self?.sendTerminalState(entry.sessionKey, state: "closed")
                    }
                }
            }

            self.sendTerminalState(sessionKey, state: "open")
        }

        AsyncFunction("closeTerminal") { (sessionKey: String) async in
            await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.remove(sessionKey) else { return }
                entry.teardown()
            }
            self.sendTerminalState(sessionKey, state: "closed")
        }

        AsyncFunction("listTerminals") { () async -> [String] in
            await MainActor.run {
                GhostexTerminalRegistry.shared.sessionKeys()
            }
        }

        // MARK: Input

        AsyncFunction("sendText") { (sessionKey: String, text: String) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }
                view.sendText(text)
            }
        }

        AsyncFunction("sendKey") { (sessionKey: String, key: String, mods: KeyModifiersRecord?) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }

                var ghosttyMods: Ghostty.Input.Mods = []
                if let mods {
                    if mods.ctrl { ghosttyMods.insert(.ctrl) }
                    if mods.alt { ghosttyMods.insert(.alt) }
                    if mods.shift { ghosttyMods.insert(.shift) }
                    if mods.cmd { ghosttyMods.insert(.super) }
                }

                if let terminalKey = Self.terminalKey(named: key) {
                    view.sendTerminalKey(terminalKey, accumulatedMods: ghosttyMods)
                    return
                }

                guard key.count == 1, let character = key.first else {
                    throw GhostexException(code: .channelFailed, reason: "Unknown key: \(key)")
                }
                view.sendCharacterKey(character, mods: ghosttyMods)
            }
        }

        AsyncFunction("focusTerminal") { (sessionKey: String) async in
            await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view,
                      view.window != nil else {
                    // No-op when the terminal view is not attached anywhere.
                    return
                }
                _ = view.requestKeyboardFocus(for: .explicitUserRequest)
            }
        }

        AsyncFunction("blurTerminal") { (sessionKey: String) async in
            await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    return
                }
                view.dismissKeyboardForUser()
            }
        }

        AsyncFunction("setFontSize") { (sessionKey: String, size: Double) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }
                let clamped = TerminalDefaults.clampedFontSize(size)
                entry.fontSize = clamped
                view.applyPresentationOverrides(TerminalPresentationOverrides(fontSize: clamped))
            }
        }

        AsyncFunction("scrollToBottom") { (sessionKey: String) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }
                view.scrollToBottom()
            }
        }

        // MARK: File upload

        AsyncFunction("uploadFile") { (machineId: String, localPath: String, remotePath: String) async throws in
            guard let connection = GhostexConnectionStore.shared.connection(for: machineId) else {
                throw GhostexException(code: .notConnected, reason: "No connection for machine \(machineId)")
            }

            let localURL = URL(fileURLWithPath: localPath)
            let data: Data
            do {
                data = try Data(contentsOf: localURL)
            } catch {
                throw GhostexException(code: .sftpFailed, reason: "Cannot read local file: \(localPath)")
            }

            do {
                try await connection.upload(data, to: remotePath, permissions: 0o600, strategy: .automatic)
            } catch {
                throw ghostexException(from: error)
            }
        }

        // MARK: Keys / known hosts

        AsyncFunction("generateSshKey") { (type: String, comment: String, passphrase: String?) async throws -> [String: Any] in
            guard let keyType = SSHKeyType(rawValue: type) else {
                throw GhostexException(code: .channelFailed, reason: "Unknown key type: \(type)")
            }
            // NOTE: passphrase-encrypted export is not supported (matches the
            // donor generator); the key is returned unencrypted.
            _ = passphrase

            do {
                let generated = try SSHKeyGenerator.generate(type: keyType, comment: comment)
                return [
                    "privateKey": String(decoding: generated.privateKey, as: UTF8.self),
                    "publicKey": generated.publicKey,
                    "fingerprint": generated.fingerprint,
                ]
            } catch {
                throw GhostexException(
                    code: .channelFailed,
                    reason: (error as? LocalizedError)?.errorDescription ?? "Key generation failed"
                )
            }
        }

        AsyncFunction("resetHostKey") { (host: String, port: Int) in
            KnownHostsManager.shared.remove(host: host, port: port)
        }

        // MARK: View

        View(GhostexTerminalHostView.self) {
            Events("onSingleTap")

            Prop("sessionKey") { (view: GhostexTerminalHostView, sessionKey: String) in
                view.setSessionKey(sessionKey)
            }
        }
    }

    // MARK: - Helpers

    private func sendTerminalState(
        _ sessionKey: String,
        state: String,
        error: String? = nil,
        errorCode: String? = nil
    ) {
        var payload: [String: Any] = [
            "sessionKey": sessionKey,
            "state": state,
        ]
        if let error {
            payload["error"] = error
        }
        if let errorCode {
            payload["errorCode"] = errorCode
        }
        sendEvent("onTerminalState", payload)
    }

    private func sendConnectionState(
        _ machineId: String,
        state: String,
        error: String? = nil,
        errorCode: String? = nil
    ) {
        var payload: [String: Any] = [
            "machineId": machineId,
            "state": state,
        ]
        if let error {
            payload["error"] = error
        }
        if let errorCode {
            payload["errorCode"] = errorCode
        }
        sendEvent("onConnectionState", payload)
    }

    /// Map contract TerminalKey names to the ported TerminalKey enum.
    static func terminalKey(named name: String) -> TerminalKey? {
        switch name {
        case "escape": return .escape
        case "tab": return .tab
        case "enter": return .enter
        case "backspace": return .backspace
        case "delete": return .delete
        case "insert": return .insert
        case "home": return .home
        case "end": return .end
        case "pageUp": return .pageUp
        case "pageDown": return .pageDown
        case "up": return .arrowUp
        case "down": return .arrowDown
        case "left": return .arrowLeft
        case "right": return .arrowRight
        case "f1": return .f1
        case "f2": return .f2
        case "f3": return .f3
        case "f4": return .f4
        case "f5": return .f5
        case "f6": return .f6
        case "f7": return .f7
        case "f8": return .f8
        case "f9": return .f9
        case "f10": return .f10
        case "f11": return .f11
        case "f12": return .f12
        default: return nil
        }
    }
}
