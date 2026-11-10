//
//  GhostexVoiceAudio.swift
//  GhostexNative
//
//  The microphone, the speaker and the audio session of a voice conversation, a dictation recording
//  and Read aloud: the iOS twin of GhostexVoiceAudio.kt.
//
//  Everything that crosses the socket is 24 kHz mono PCM16, the format gxserver's `/api/voice`
//  speaks in both directions (docs/2026-10-20/voice-mode/voice-agent-client-contract.md, section 2).
//
//  CDXC:VoiceMode 2026-11-04 WHY: The provider's voice activity detection interrupts the agent
//  whenever it hears speech, so a speaker that leaks into the microphone makes the agent cut itself
//  off. A conversation therefore runs as a call, like Android's `MODE_IN_COMMUNICATION`: the
//  `playAndRecord` category in `voiceChat` mode, and one `AVAudioEngine` whose input has Apple's voice
//  processing (echo cancellation, which takes its reference from the same engine's output) switched
//  on. The same category routes the microphone and the speaker through a Bluetooth headset or the
//  car (CarPlay, hands-free) when one is connected, and the loudspeaker otherwise, never the earpiece:
//  the phone is in a pocket or a holder. Dictation never plays anything, so it records without voice
//  processing. SEE-ALSO: GhostexVoice.swift (the socket), GhostexVoiceCall.swift (CallKit).
//

import AVFoundation
import Foundation
import os

/// What uses the app's one audio session; the strongest use picks its category.
enum GhostexAudioUse: Int, Comparable {
    case speech = 0
    case recording = 1
    case conversation = 2

    static func < (lhs: GhostexAudioUse, rhs: GhostexAudioUse) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// The app's `AVAudioSession`, shared by the voice agent, Dictate's recorder and Read aloud.
final class GhostexAudioSession {
    static let shared = GhostexAudioSession()

    private let lock = NSLock()
    private var uses: Set<GhostexAudioUse> = []

    /**
     * Takes the session for `use` and sets the category the strongest current use needs. `activate`
     * false leaves the activation to CallKit, which activates the session for a call itself
     * (`provider(_:didActivate:)`).
     */
    func acquire(_ use: GhostexAudioUse, activate: Bool = true) throws {
        lock.lock()
        defer { lock.unlock() }
        uses.insert(use)
        try configure()
        if activate { try AVAudioSession.sharedInstance().setActive(true) }
    }

    /// Gives the session back; the last use out deactivates it so other apps' audio comes back up.
    func release(_ use: GhostexAudioUse) {
        lock.lock()
        defer { lock.unlock() }
        guard uses.remove(use) != nil else { return }
        if uses.isEmpty {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } else {
            try? configure()
        }
    }

    /// True while `use` (or a stronger one) holds the session.
    func held(atLeast use: GhostexAudioUse) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return uses.contains { $0 >= use }
    }

    /// Activates the session again after an interruption ended.
    func reactivate() {
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    private func configure() throws {
        guard let top = uses.max() else { return }
        let session = AVAudioSession.sharedInstance()
        switch top {
        case .conversation:
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        case .recording:
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
        case .speech:
            // Music and navigation duck under a reply; a navigation prompt interrupts it (`spokenAudio`).
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        }
        if top != .speech {
            // The format gxserver speaks: asking for it saves the engine a resample when the route allows it.
            try? session.setPreferredSampleRate(Double(GhostexVoiceAudio.sampleRate))
            try? session.setPreferredIOBufferDuration(0.02)
            if #available(iOS 14.5, *) { try? session.setPrefersNoInterruptionsFromSystemAlerts(true) }
        }
    }
}

enum GhostexVoiceAudio {
    static let sampleRate = 24_000
    /// 40 ms of PCM16 mono at 24 kHz: what the CLI sends per frame (the contract allows 20 to 100 ms).
    static let chunkBytes = 1_920
    static let bytesPerMs = 48

    static let log = Logger(subsystem: "io.ghostex", category: "GhostexVoice")

    /// The wire format, and the float format the speaker plays it in.
    static let wireFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(sampleRate), channels: 1, interleaved: true)!
    static let playFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: 1, interleaved: false)!

    // MARK: Debug feed

    /**
     * Developer-only microphone stand-in, as on Android: queued WAV audio replaces what the microphone
     * hears, chunk for chunk, so the timing stays the microphone's. Debug builds only: copy a 16-bit
     * mono 24 kHz WAV to the app's `Documents/voice-feed.wav` and post the Darwin notification
     * `io.ghostex.debug.VOICE_FEED` (`xcrun simctl spawn booted notifyutil -p io.ghostex.debug.VOICE_FEED`).
     * Never surfaced to users.
     */
    private static let feedLock = NSLock()
    private static var debugFeed: [Data] = []

    static func takeDebugChunk() -> Data? {
        feedLock.lock()
        defer { feedLock.unlock() }
        return debugFeed.isEmpty ? nil : debugFeed.removeFirst()
    }

    #if DEBUG
    private static var debugFeedInstalled = false

    static func installDebugFeed() {
        feedLock.lock()
        defer { feedLock.unlock() }
        guard !debugFeedInstalled else { return }
        debugFeedInstalled = true
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            nil,
            { _, _, _, _, _ in
                let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let path = documents.appendingPathComponent("voice-feed.wav").path
                let error = GhostexVoiceAudio.queueDebugWav(path)
                GhostexVoiceAudio.log.info("debug feed \(error == nil ? "queued \(path)" : "refused: \(error!)", privacy: .public)")
            },
            "io.ghostex.debug.VOICE_FEED" as CFString,
            nil,
            .deliverImmediately
        )
    }
    #else
    static func installDebugFeed() {}
    #endif

    /// Queues a 16-bit mono 24 kHz WAV for the microphone path. Answers a short error, or nil.
    static func queueDebugWav(_ path: String) -> String? {
        guard let bytes = FileManager.default.contents(atPath: path) else { return "Could not read \(path)." }
        guard bytes.count >= 44, String(decoding: bytes[0..<4], as: UTF8.self) == "RIFF",
              String(decoding: bytes[8..<12], as: UTF8.self) == "WAVE" else { return "\(path) is not a WAV file." }
        func int32(_ at: Int) -> Int { bytes[at..<at + 4].enumerated().reduce(0) { $0 | (Int($1.element) << (8 * $1.offset)) } }
        func int16(_ at: Int) -> Int { Int(bytes[at]) | (Int(bytes[at + 1]) << 8) }
        var offset = 12
        var channels = 0, rate = 0, bits = 0
        while offset + 8 <= bytes.count {
            let id = String(decoding: bytes[offset..<offset + 4], as: UTF8.self)
            let size = int32(offset + 4)
            let body = offset + 8
            if id == "fmt " {
                channels = int16(body + 2)
                rate = int32(body + 4)
                bits = int16(body + 14)
            } else if id == "data" {
                guard channels == 1, rate == sampleRate, bits == 16 else {
                    return "\(path) must be 16-bit mono 24 kHz (it is \(bits)-bit, \(channels) channel(s), \(rate) Hz)."
                }
                let end = min(bytes.count, body + size)
                var chunks: [Data] = []
                var at = body
                while at < end {
                    var chunk = Data(bytes[at..<min(at + chunkBytes, end)])
                    if chunk.count < chunkBytes { chunk.append(Data(count: chunkBytes - chunk.count)) }
                    chunks.append(chunk)
                    at += chunkBytes
                }
                feedLock.lock()
                debugFeed.append(contentsOf: chunks)
                feedLock.unlock()
                return nil
            }
            offset = body + size + (size & 1)
        }
        return "\(path) has no audio data."
    }
}

/**
 * The microphone (and for a conversation the speaker) on one `AVAudioEngine`. The microphone is
 * converted to 24 kHz PCM16 and handed over in 40 ms chunks; the agent's audio is queued on a player
 * node behind a time-pitch unit (the voice screen's speed, pitch kept).
 *
 * The playback position is counted in the player node's own samples, which are the provider's
 * frames whatever the speed, so [cut] reports how much of a reply was heard in the provider's time,
 * as GhostexVoiceAudio.kt's `Player.cut` does.
 */
final class GhostexVoiceEngine {
    private let conversation: Bool
    private let onChunk: (Data) -> Void
    private let onError: (String) -> Void

    private var engine = AVAudioEngine()
    private var player: AVAudioPlayerNode?
    private var timePitch: AVAudioUnitTimePitch?
    private var converter: AVAudioConverter?
    /// The microphone format the tap and converter were made for.
    private var tapFormat: AVAudioFormat?
    private var pending = Data()
    private var configObserver: NSObjectProtocol?
    /**
     * Bumped by every build; a watchdog or a retry scheduled for an older build gives up, so a route change
     * that lands during a retry never starts a second chain of rebuilds beside the first.
     */
    private var generation = 0
    /// When the current engine was built, and how many builds in a row a configuration change undid within a moment.
    private var builtAt = Date.distantPast
    private var quickRebuilds = 0
    /// "The microphone stopped." was said for this failure; an engine that runs again clears it.
    private var reportedFailure = false

    /// Guards the playback bookkeeping below, touched from the socket's queue and `cut`.
    private let playLock = NSLock()
    private var speed: Float = 1
    /// Player samples up to which audio is scheduled, and where the current reply started (-1: not yet).
    private var scheduledEnd: Int64 = 0
    private var itemStart: Int64 = -1
    private(set) var itemId: String?
    private(set) var running = false

    /// A line for the Logs sheet, and the system log (`GhostexVoice.journal`).
    private func note(_ message: String) {
        GhostexVoice.journal(message, mode: conversation ? "conversation" : "dictation")
    }

    init(conversation: Bool, onChunk: @escaping (Data) -> Void, onError: @escaping (String) -> Void) {
        self.conversation = conversation
        self.onChunk = onChunk
        self.onError = onError
    }

    /// Builds the graph and starts it. The audio session must already be active.
    func start() throws {
        guard !running else { return }
        running = true
        rebuildLock.lock()
        defer { rebuildLock.unlock() }
        do {
            try build()
        } catch {
            running = false
            teardown()
            throw error
        }
        watch(0, generation)
    }

    /**
     * Gives up on this failure: says "The microphone stopped." once. More failures before an engine runs again
     * stay quiet (GitHub #500: one per try piled up on the voice screen); Unmute, Talk or a route change try again.
     */
    private func fail() {
        guard !reportedFailure else { return }
        reportedFailure = true
        note("gave up on the microphone after its tries; saying \"The microphone stopped.\"")
        onError("The microphone stopped.")
    }

    /**
     * An engine whose session changed category or route just before it started can stop on its own
     * a moment later ("iounit stopped unexpectedly", seen when Dictate starts recording) without a
     * configuration change to say so: it is built again.
     */
    private func watch(_ attempt: Int, _ built: Int) {
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            self.rebuildLock.lock()
            let current = self.running && self.generation == built
            let stopped = !self.engine.isRunning
            if current && !stopped { self.reportedFailure = false }
            self.rebuildLock.unlock()
            guard current, stopped else { return }
            if attempt < 4, self.restartInPlace(built) {
                // Watched again, so an engine that keeps stopping still ends in one error.
                self.watch(attempt + 1, built)
                return
            }
            guard attempt < 4 else {
                self.fail()
                return
            }
            self.note("the microphone stopped by itself right after starting; building it again (try \(attempt + 1))")
            self.rebuild(attempt + 1, after: built)
        }
    }

    /**
     * CDXC:VoiceMode 2026-11-09 WHY: GitHub #500 (Jakey, iPhone SE, no headphones): "The microphone stopped."
     * repeated on every try and the agent stopped hearing him (not reproducible in the Simulator, which runs without voice processing). The engine watched for configuration changes
     * before it switched voice processing on, and switching it on can post one (it changes the input format): each build answered its own
     * notification with a new engine, so the microphone was torn down and built again in a loop, and every
     * chain that ran out of tries said so again. The observer now starts once the engine runs, a change that
     * left the engine running needs nothing (a route change stops it), and changes that keep undoing fresh
     * builds give up instead of looping.
     */
    private func configurationChanged(_ changed: AVAudioEngine) {
        rebuildLock.lock()
        let current = running && changed === engine
        let stillRunning = engine.isRunning
        let built = generation
        if current && !stillRunning {
            quickRebuilds = Date().timeIntervalSince(builtAt) < 2 ? quickRebuilds + 1 : 0
        }
        let quick = quickRebuilds
        rebuildLock.unlock()
        guard current else { return }
        if stillRunning {
            note("the audio configuration changed; the microphone still runs, so it is kept")
            return
        }
        note("the audio configuration changed and stopped the microphone; starting it again")
        if restartInPlace(built) { return }
        // Each attempt counts toward the cap, so a change that stops every new engine at once ends in one error.
        rebuild(quick, after: built)
    }

    /**
     * CDXC:VoiceMode 2026-11-10 WHY: On the user's iPhone 15 Pro Max (iOS 27.2) every call said "The microphone stopped" and the agent never heard anything. The phone's own log showed why: each engine started, and about 120 ms later switching voice processing on settled the output layout ("iounit configuration changed > stopping the engine"). Answering that with a brand-new engine switched voice processing on again, which stopped it again, 38 times a minute. The engine that stopped is started again as it is (voice processing stays on, so nothing changes a second time); only when that fails is a new one built.
     */
    private func restartInPlace(_ built: Int) -> Bool {
        rebuildLock.lock()
        defer { rebuildLock.unlock() }
        guard running, generation == built, !engine.isRunning else { return engine.isRunning }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        if format != tapFormat {
            guard format.sampleRate > 0, format.channelCount > 0,
                  let converter = AVAudioConverter(from: format, to: GhostexVoiceAudio.wireFormat) else { return false }
            input.removeTap(onBus: 0)
            self.converter = converter
            tapFormat = format
            pending = Data()
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                self?.captured(buffer)
            }
        }
        do {
            engine.prepare()
            try engine.start()
            player?.play()
            note("the microphone started again as it was")
            return true
        } catch {
            note("the microphone did not start again as it was: \(error.localizedDescription)")
            return false
        }
    }

    private func build() throws {
        // A fresh engine binds to the session as it is configured now.
        generation += 1
        engine = AVAudioEngine()
        let input = engine.inputNode
        if conversation {
            #if !targetEnvironment(simulator)
            // The Simulator's audio deadlocks starting a voice-processing unit (CoreAudio aborts the
            // app: "Initialize: RPC timeout"), so it runs without echo cancellation there.
            do {
                try input.setVoiceProcessingEnabled(true)
            } catch {
                note("echo cancellation (voice processing) is unavailable: \(error.localizedDescription)")
            }
            #endif
            let player = AVAudioPlayerNode()
            let timePitch = AVAudioUnitTimePitch()
            timePitch.rate = speed
            engine.attach(player)
            engine.attach(timePitch)
            engine.connect(player, to: timePitch, format: GhostexVoiceAudio.playFormat)
            engine.connect(timePitch, to: engine.mainMixerNode, format: GhostexVoiceAudio.playFormat)
            self.player = player
            self.timePitch = timePitch
        } else {
            // A record-only engine still needs its output side wired (the main mixer to the
            // speaker, silent), or its I/O unit stops right after starting.
            engine.mainMixerNode.outputVolume = 0
        }
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0,
              let converter = AVAudioConverter(from: format, to: GhostexVoiceAudio.wireFormat) else {
            throw NSError(domain: "GhostexVoice", code: 1, userInfo: [NSLocalizedDescriptionKey: "Ghostex could not open the microphone."])
        }
        self.converter = converter
        tapFormat = format
        pending = Data()
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.captured(buffer)
        }
        engine.prepare()
        try engine.start()
        player?.play()
        builtAt = Date()
        #if targetEnvironment(simulator)
        let processing = false
        #else
        let processing = conversation && engine.inputNode.isVoiceProcessingEnabled
        #endif
        note("the microphone started (\(Int(format.sampleRate)) Hz, \(format.channelCount) channel\(format.channelCount == 1 ? "" : "s"), echo cancellation \(processing ? "on" : "off"))")
        // Watched only from here: switching voice processing on above can post a configuration change of its own.
        let built = engine
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: built,
            queue: nil
        ) { [weak self, weak built] _ in
            guard let built else { return }
            DispatchQueue.global().async { self?.configurationChanged(built) }
        }
    }

    /// Restarts come from the configuration change and the watchdog; one at a time.
    private let rebuildLock = NSLock()

    /**
     * A new route (a headset, the car), a sample rate change or an engine that stopped by itself:
     * the old engine's devices may be gone, so a new engine is built in its place. The audio still
     * queued for the speaker is dropped. Gives up with a microphone error after a few tries.
     */
    private func rebuild(_ attempt: Int, after built: Int? = nil) {
        rebuildLock.lock()
        defer { rebuildLock.unlock() }
        // Another rebuild got there first: its own watchdog and retries carry on from here.
        guard running, built == nil || built == generation else { return }
        guard attempt <= 4 else {
            fail()
            return
        }
        note("building a new microphone (try \(attempt))")
        teardown()
        playLock.lock()
        scheduledEnd = 0
        itemStart = -1
        playLock.unlock()
        do {
            try build()
            watch(attempt, generation)
        } catch {
            note("the new microphone did not start: \(error.localizedDescription)")
            guard attempt < 4 else {
                fail()
                return
            }
            let failed = generation
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.rebuild(attempt + 1, after: failed) }
        }
    }

    /**
     * Unmute or Talk on a call whose microphone stopped: builds the engine again with a fresh count of tries,
     * so the person can bring the microphone back without hanging up.
     */
    func recover() {
        rebuildLock.lock()
        let stopped = running && !engine.isRunning
        rebuildLock.unlock()
        guard stopped else { return }
        note("Unmute or Talk: building the microphone again")
        DispatchQueue.global().async { [weak self] in self?.rebuild(0) }
    }

    /// Takes the engine apart (it is not reused).
    private func teardown() {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
        configObserver = nil
        engine.inputNode.removeTap(onBus: 0)
        player?.stop()
        engine.stop()
        #if !targetEnvironment(simulator)
        // The next engine opens its own voice-processing unit; this one lets go of it first.
        if conversation { try? engine.inputNode.setVoiceProcessingEnabled(false) }
        #endif
        player = nil
        timePitch = nil
    }

    /// Starts the engine again after an interruption (a call, Siri) stopped it.
    func resume() {
        guard running, !engine.isRunning else { return }
        do {
            try engine.start()
            player?.play()
            note("the microphone started again after the interruption")
        } catch {
            note("the microphone did not start again after the interruption: \(error.localizedDescription)")
            DispatchQueue.global().async { [weak self] in self?.rebuild(0) }
        }
    }

    func stop() {
        rebuildLock.lock()
        defer { rebuildLock.unlock() }
        guard running else { return }
        running = false
        generation += 1
        teardown()
        note("the microphone stopped (the call or recording ended)")
    }

    private func captured(_ buffer: AVAudioPCMBuffer) {
        guard let converter, buffer.frameLength > 0 else { return }
        let ratio = GhostexVoiceAudio.wireFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: GhostexVoiceAudio.wireFormat, frameCapacity: capacity) else { return }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, out.frameLength > 0, let samples = out.int16ChannelData else { return }
        pending.append(UnsafeBufferPointer(start: samples[0], count: Int(out.frameLength)))
        while pending.count >= GhostexVoiceAudio.chunkBytes {
            let chunk = pending.prefix(GhostexVoiceAudio.chunkBytes)
            pending.removeFirst(GhostexVoiceAudio.chunkBytes)
            onChunk(GhostexVoiceAudio.takeDebugChunk() ?? Data(chunk))
        }
    }

    // MARK: Playback (conversation only)

    func beginItem(_ id: String) {
        playLock.lock()
        itemId = id
        itemStart = -1
        playLock.unlock()
    }

    /// Queues PCM16 audio from gxserver for the speaker.
    func enqueue(_ audio: Data) {
        guard running, let player else { return }
        let frames = audio.count / 2
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: GhostexVoiceAudio.playFormat, frameCapacity: AVAudioFrameCount(frames)),
              let channel = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        audio.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for index in 0..<frames { channel[index] = Float(Int16(littleEndian: samples[index])) / 32_768 }
        }
        playLock.lock()
        let start = max(scheduledEnd, nowSample())
        if itemStart < 0 { itemStart = start }
        scheduledEnd = start + Int64(frames)
        player.scheduleBuffer(buffer, completionHandler: nil)
        playLock.unlock()
    }

    private func nowSample() -> Int64 {
        guard let player, let nodeTime = player.lastRenderTime, nodeTime.isSampleTimeValid,
              let playerTime = player.playerTime(forNodeTime: nodeTime) else { return 0 }
        return max(0, playerTime.sampleTime)
    }

    /// True while agent audio is queued or still playing.
    func playing() -> Bool {
        playLock.lock()
        defer { playLock.unlock() }
        return scheduledEnd > nowSample()
    }

    /// Plays the agent `speed` times as fast with its pitch kept (`voiceAgentSpeed`).
    func setSpeed(_ value: Float) {
        speed = value
        timePitch?.rate = value
    }

    /// Stops the reply at once; answers the milliseconds of `id` the speaker played.
    @discardableResult
    func cut(_ id: String?) -> Int64 {
        guard let player else { return 0 }
        playLock.lock()
        defer { playLock.unlock() }
        let now = nowSample()
        let played: Int64 = (id != nil && id == itemId && itemStart >= 0) ? max(0, min(now, scheduledEnd) - itemStart) : 0
        player.stop()
        if running && engine.isRunning { player.play() }
        scheduledEnd = 0
        itemStart = -1
        return played * 1000 / Int64(GhostexVoiceAudio.sampleRate)
    }
}
