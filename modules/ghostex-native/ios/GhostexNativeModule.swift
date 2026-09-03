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
import Darwin
import AudioToolbox
import Tailcatbridge

// MARK: - Records

struct SshConfigRecord: Record {
    @Field var host: String = ""
    @Field var port: Int = 22
    @Field var username: String = ""
    @Field var password: String?
    @Field var privateKey: String?
    @Field var passphrase: String?
    /// Send SSH protocol keep-alive packets on this connection.
    @Field var keepAliveEnabled: Bool = true
    /// Keep-alive interval in seconds (10-120). Ignored when disabled.
    @Field var keepAliveIntervalSec: Int = 30
    /// tailcat peer token. When non-empty the connection dials a tailcat loopback
    /// forward instead of host:port; host-key identity still uses host:port.
    @Field var tailcatToken: String = ""
    /// `none` authenticates with the SSH "none" method only (Tailscale SSH); else `credentials`.
    @Field var authMethod: String = "credentials"
}

struct OpenTerminalOptionsRecord: Record {
    @Field var command: String?
    @Field var termType: String?
    @Field var fontSize: Double?
    /// True for `ghostex attach` (zmx-backed) sessions. The Android module runs its
    /// post-attach viewport refresh off this; iOS refreshes explicitly via
    /// refreshTerminalViewport after the JS-visible-ready delay.
    @Field var zmxBacked: Bool = false
    /// Scrollback row limit for newly created buffers: 500...20000 in 500-row steps.
    @Field var scrollbackRows: Int = 2000
}

struct TerminalRuntimeSettingsRecord: Record {
    @Field var autoScroll: Bool = true
    @Field var cursorStyle: String = "bar"
    @Field var cursorBlink: Bool = true
    @Field var softKeyboardEnabled: Bool = true
    @Field var openUrlsOnTap: Bool = true
}

struct KeyModifiersRecord: Record {
    @Field var ctrl: Bool = false
    @Field var alt: Bool = false
    @Field var shift: Bool = false
    @Field var cmd: Bool = false
    @Field var ctrlLocked: Bool = false
    @Field var altLocked: Bool = false
    @Field var shiftLocked: Bool = false
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
            "onKeyModifiersConsumed",
            "onTerminalGridChange",
            "onConnectionState"
        )

        // MARK: Connection lifecycle

        AsyncFunction("connect") { (machineId: String, config: SshConfigRecord) async throws in
            let credentials = SSHCredentials(
                password: config.password,
                privateKey: config.privateKey,
                passphrase: config.passphrase,
                noneAuthOnly: config.authMethod == "none"
            )
            let connectionConfig = SSHConnectionConfig(
                machineId: machineId,
                host: config.host,
                port: config.port,
                username: config.username,
                credentials: credentials,
                keepAliveEnabled: config.keepAliveEnabled,
                keepAliveIntervalSec: config.keepAliveIntervalSec,
                tailcatToken: config.tailcatToken
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

        // Saved machines keep their forward alive across disconnects so reconnects skip the
        // rendezvous; only throwaway callers (Test Connection) stop theirs explicitly.
        AsyncFunction("stopTailcatForward") { (machineId: String) in
            TailcatbridgeStopForward(machineId)
        }

        // Easy Connect pairing reaches the computer's gxserver API port through the
        // tunnel before any SSH machine exists, so it needs the forward on its own.
        // The rendezvous blocks for seconds on a cold start; keep it off the main thread.
        AsyncFunction("startTailcatForward") { (forwardId: String, address: String, remotePort: Int) async throws -> [String: Any] in
            var localPort = 0
            var bridgeError: NSError?
            let started = TailcatbridgeStartForward(forwardId, address, remotePort, &localPort, &bridgeError)
            guard started, localPort > 0 else {
                let detail = bridgeError?.localizedDescription ?? "the bridge returned no local port"
                throw GhostexException(
                    code: .unreachable,
                    reason: "Could not reach the computer through Easy Connect. (\(detail))"
                )
            }
            return ["localPort": localPort]
        }

        AsyncFunction("isTailscaleConnected") { () -> Bool in
            self.hasTailscaleNetworkAddress()
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

        // MARK: Local port forwarding

        // SSH local port forwarding over the machine's existing connection: a loopback
        // listener here, one direct-tcpip channel per accepted connection. Nothing is
        // configured on the PC.
        /*
         * Rejected through the promise, not by throwing. Expo wraps a thrown
         * exception in a FunctionCallException whose `code` is
         * ERR_FUNCTION_CALL, which would hide E_PORT_NOT_LISTENING and
         * E_FORWARDING_PROHIBITED from JS and leave it matching on message text
         * that differs from Android's. `promise.reject` passes the exception —
         * and its contract code — through untouched, exactly as the Android
         * module does.
         */
        AsyncFunction("startPortForward") { (machineId: String, remotePort: Int, promise: Promise) in
            guard let connection = GhostexConnectionStore.shared.connection(for: machineId) else {
                promise.reject(
                    GhostexException(code: .notConnected, reason: "No connection for machine \(machineId)")
                )
                return
            }
            Task {
                do {
                    let localPort = try await connection.startPortForward(remotePort: remotePort)
                    promise.resolve(["localPort": localPort])
                } catch {
                    promise.reject(ghostexException(from: error))
                }
            }
        }

        // Teardown, so a machine with no connection resolves instead of failing the caller.
        AsyncFunction("stopPortForward") { (machineId: String, remotePort: Int) async in
            guard let connection = GhostexConnectionStore.shared.connection(for: machineId) else {
                return
            }
            await connection.stopPortForward(remotePort: remotePort)
        }

        AsyncFunction("listPortForwards") { (machineId: String) async -> [[String: Any]] in
            guard let connection = GhostexConnectionStore.shared.connection(for: machineId) else {
                return []
            }
            return await connection.listPortForwards().map {
                ["remotePort": $0.remotePort, "localPort": $0.localPort]
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
            let scrollbackRows = opts.scrollbackRows
            guard TerminalDefaults.isValidScrollbackRows(scrollbackRows) else {
                throw GhostexException(
                    code: .channelFailed,
                    reason: "Invalid scrollbackRows: \(scrollbackRows)"
                )
            }

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
                    fontSize: fontSize,
                    zmxBacked: opts.zmxBacked
                )

                // The new surface inherits scrollback-limit from the
                // app-level config at creation time.
                app.prepareAppConfigForSurfaceCreation(scrollbackRows: scrollbackRows)

                let view = GhosttyTerminalView(
                    frame: .zero,
                    worktreePath: NSTemporaryDirectory(),
                    ghosttyApp: ghosttyApp,
                    appWrapper: app,
                    command: nil,
                    fontSize: fontSize,
                    scrollbackRows: scrollbackRows,
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
                view.onKeyModifiersConsumed = { [weak self] in
                    self?.sendEvent("onKeyModifiersConsumed", ["sessionKey": sessionKey])
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
                view.onResize = { [weak self, weak entry] cols, rows in
                    guard let entry, let shellId = entry.shellId else { return }
                    let connection = entry.connection
                    Task {
                        try? await connection.resize(cols: cols, rows: rows, for: shellId)
                    }
                    if entry.explicitGrid == nil {
                        self?.sendEvent("onTerminalGridChange", [
                            "sessionKey": entry.sessionKey,
                            "cols": cols,
                            "rows": rows,
                        ])
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
            let hadEntry = await MainActor.run { () -> Bool in
                guard let entry = GhostexTerminalRegistry.shared.remove(sessionKey) else {
                    return false
                }
                entry.teardown()
                return true
            }
            // Only a terminal that actually existed just closed. Announcing a
            // close for a key with no entry walks a tab that is mid-reopen back
            // to "Disconnected" for the moment before its new attach lands.
            if hadEntry {
                self.sendTerminalState(sessionKey, state: "closed")
            }
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

        // Bytes straight to the SSH channel: no bracketed-paste wrapping, no key
        // translation. The zmx display announcements (ZMX_VISIBLE / ZMX_HIDDEN)
        // must arrive verbatim on the attach client's stdin.
        AsyncFunction("sendRawInput") { (sessionKey: String, text: String) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let shellId = entry.shellId else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }
                let connection = entry.connection
                let data = Data(text.utf8)
                Task {
                    try? await connection.write(data, to: shellId)
                }
            }
        }

        AsyncFunction("sendKey") { (sessionKey: String, key: String, mods: KeyModifiersRecord?) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }

                view.consumeKeyModifiersForAccessoryKey()

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

        AsyncFunction("setKeyModifiers") { (sessionKey: String, mods: KeyModifiersRecord) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }
                var ghosttyMods: Ghostty.Input.Mods = []
                if mods.ctrl { ghosttyMods.insert(.ctrl) }
                if mods.alt { ghosttyMods.insert(.alt) }
                if mods.shift { ghosttyMods.insert(.shift) }
                if mods.cmd { ghosttyMods.insert(.super) }
                var lockedMods: Ghostty.Input.Mods = []
                if mods.ctrlLocked { lockedMods.insert(.ctrl) }
                if mods.altLocked { lockedMods.insert(.alt) }
                if mods.shiftLocked { lockedMods.insert(.shift) }
                view.setKeyModifiers(ghosttyMods, locked: lockedMods)
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

        AsyncFunction("getTerminalGrid") { (sessionKey: String) async throws -> [String: Any]? in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }
                guard let size = view.terminalSize(), size.columns > 0, size.rows > 0 else { return nil }
                return ["cols": Int(size.columns), "rows": Int(size.rows)]
            }
        }

        AsyncFunction("setTerminalGrid") { (sessionKey: String, cols: Int, rows: Int) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }
                if cols <= 0 || rows <= 0 {
                    entry.explicitGrid = nil
                    view.unpinGrid()
                } else {
                    entry.explicitGrid = (cols, rows)
                    view.pinGrid(cols: cols, rows: rows)
                }
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

        // MARK: Module-global terminal settings

        AsyncFunction("setTerminalSettings") { (settings: TerminalRuntimeSettingsRecord) async throws in
            guard let cursorStyle = TerminalRuntimeSettings.CursorStyle(rawValue: settings.cursorStyle) else {
                throw GhostexException(code: .channelFailed, reason: "Unknown cursor style: \(settings.cursorStyle)")
            }
            await MainActor.run {
                Ghostty.App.runtimeSettings = TerminalRuntimeSettings(
                    autoScroll: settings.autoScroll,
                    cursorStyle: cursorStyle,
                    cursorBlink: settings.cursorBlink,
                    softKeyboardEnabled: settings.softKeyboardEnabled,
                    openUrlsOnTap: settings.openUrlsOnTap
                )
                // Push the regenerated config (cursor style/blink) to every
                // live surface; warm entries share the same views.
                for entry in GhostexTerminalRegistry.shared.entries.values {
                    entry.view?.reapplySurfaceConfig()
                }
            }
        }

        AsyncFunction("refreshTerminalViewport") { (sessionKey: String) async throws in
            try await MainActor.run {
                guard let entry = GhostexTerminalRegistry.shared.entry(for: sessionKey),
                      let view = entry.view else {
                    throw GhostexException(code: .notConnected, reason: "No terminal for session \(sessionKey)")
                }
                guard entry.zmxBacked else { return }
                view.forceRefresh()
                view.sendTerminalKey(.pageUp)
                view.sendTerminalKey(.pageDown)
            }
        }

        AsyncFunction("setKeepScreenOn") { (enabled: Bool) async in
            await MainActor.run {
                UIApplication.shared.isIdleTimerDisabled = enabled
            }
        }

        AsyncFunction("playAlertSound") { (kind: String) throws in
            // System sound IDs (AudioToolbox): 1057 is a short audible
            // SIM-toolkit beep for terminal bells; 1007 is the notification
            // chime for attention alerts. Fire-and-forget, safe to repeat.
            let soundID: SystemSoundID
            switch kind {
            case "bell": soundID = 1057
            case "attention": soundID = 1007
            default:
                throw GhostexException(code: .channelFailed, reason: "Unknown alert sound: \(kind)")
            }
            AudioServicesPlaySystemSound(soundID)
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
            ViewName("GhostexTerminalView")
            Events("onSingleTap")

            Prop("sessionKey") { (view: GhostexTerminalHostView, sessionKey: String) in
                view.setSessionKey(sessionKey)
            }
        }
    }

    // MARK: - Helpers

    private func hasTailscaleNetworkAddress() -> Bool {
        var firstAddress: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&firstAddress) == 0, let firstAddress else {
            return false
        }
        defer { freeifaddrs(firstAddress) }

        var currentAddress: UnsafeMutablePointer<ifaddrs>? = firstAddress
        while let interface = currentAddress {
            defer { currentAddress = interface.pointee.ifa_next }
            guard
                (interface.pointee.ifa_flags & UInt32(IFF_UP)) != 0,
                let address = interface.pointee.ifa_addr
            else {
                continue
            }

            let family = Int32(address.pointee.sa_family)
            guard family == AF_INET || family == AF_INET6 else {
                continue
            }

            let addressLength =
                family == AF_INET
                ? socklen_t(MemoryLayout<sockaddr_in>.size)
                : socklen_t(MemoryLayout<sockaddr_in6>.size)
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard
                getnameinfo(
                    address,
                    addressLength,
                    &host,
                    socklen_t(host.count),
                    nil,
                    0,
                    NI_NUMERICHOST
                ) == 0
            else {
                continue
            }

            let ipAddress = String(cString: host).lowercased()
            if ipAddress.hasPrefix("fd7a:115c:a1e0:") {
                return true
            }
            let octets = ipAddress.split(separator: ".").compactMap { UInt8($0) }
            if octets.count == 4, octets[0] == 100, (64...127).contains(octets[1]) {
                return true
            }
        }

        return false
    }

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
