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
    /// Settings › Voice's preview of a waiting music piece.
    case preview = -1
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
        case .preview:
            // A few seconds of a waiting music piece: other audio ducks under it, as under Read aloud.
            try session.setCategory(.playback, mode: .default, options: [.duckOthers])
        }
        if top >= .recording {
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

    /// The waiting music pieces' format (src/voice/music: mono AAC at 44.1 kHz), until a piece is opened.
    static let musicFormat = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    /// The waiting music fades in and out in this many 20 ms steps: 0.3 s.
    static let musicFadeSteps = 15

    /// A file path from what JavaScript passes for a bundled file (expo-asset's `file://` URI, or a plain path); nil otherwise.
    static func localFilePath(_ uri: String) -> String? {
        if uri.hasPrefix("/") { return uri }
        guard let url = URL(string: uri), url.isFileURL, !url.path.isEmpty, url.path != "/" else { return nil }
        return url.path
    }

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
    /// The buffers queued on the current player that it has not taken yet; a new player gets a new count.
    private var playQueue = GhostexPlayQueue()
    private(set) var itemId: String?
    private(set) var running = false

    /**
     * The waiting music (conversation only): a second player node on the same engine, straight into the main mixer
     * beside the agent's player, so it follows the call's route and is in the echo canceller's reference. Its own
     * volume; the agent's speed never touches it. Guarded by `musicLock`; never held while taking `rebuildLock`.
     */
    private let musicLock = NSLock()
    private let musicQueue = DispatchQueue(label: "io.ghostex.voice.music")
    private var music: AVAudioPlayerNode?
    private var musicPath: String?
    private var musicFile: AVAudioFile?
    private var musicVolume: Float = 0.3
    /// The music should be heard: set by `startMusic`, cleared by `stopMusic` and by the agent's reply audio.
    private var musicOn = false
    /// The file is queued on `music`, which plays it (perhaps fading out).
    private var musicQueued = false
    /// Bumped whenever the queued loops stop counting: their completions then queue nothing more.
    private var musicToken = 0
    private var musicFade: DispatchSourceTimer?
    private var musicFadeFrom: Float = 0
    private var musicFadeStep = 0

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
            if let player, !resetPlayerIfIdle() {
                player.play()
                note("the microphone started again as it was; audio was still queued for the speaker, so the player kept it")
            } else {
                note("the microphone started again as it was")
            }
            resumeMusic()
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
            playQueue = GhostexPlayQueue()
            let music = AVAudioPlayerNode()
            engine.attach(music)
            musicLock.lock()
            engine.connect(music, to: engine.mainMixerNode, format: musicFile?.processingFormat ?? GhostexVoiceAudio.musicFormat)
            self.music = music
            musicLock.unlock()
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
        resumeMusic()
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
        musicLock.lock()
        dropMusicQueueLocked()
        music = nil
        musicLock.unlock()
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
            resumeMusic()
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
        musicLock.lock()
        musicOn = false
        musicLock.unlock()
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
        stopMusicForReply()
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
        let queue = playQueue
        queue.added()
        // Called once the player has taken the buffer or dropped it on a stop.
        player.scheduleBuffer(buffer) { queue.taken() }
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

    /**
     * CDXC:VoiceMode 2026-11-25 WHY: On an iPhone on iOS 27.2.1 the agent's replies were silent from the start of a call
     * until the first cut, then audible for the rest of the call, with CallKit and without. The phone's log showed why:
     * after the engine that switching voice processing on had stopped was started again in place, the player said it was
     * playing and its clock ran, but it took none of the audio queued on it and the mixer rendered silence; the first cut
     * stops and starts the player, and from then on it played. So the restart in place now resets the player as `cut`
     * does, the way it ran on that iPhone at the start of a call, when nothing was queued yet.
     *
     * CDXC:VoiceMode 2026-11-26 WHY: The engine is also started again in place in the middle of a call (headphones,
     * Bluetooth or CarPlay connecting can stop it), and a reset then would drop the rest of a reply already queued and
     * make a later cut count words heard before it as unheard. So the player is reset only while it holds no buffer it
     * has not taken; with audio still queued the restart keeps playing as before (`player.play()`), which is what it did
     * before the silence fix. Counted in buffers, not on the player's clock, because in the silence the clock ran while
     * no buffer was taken. Answers whether it reset.
     */
    private func resetPlayerIfIdle() -> Bool {
        guard let player else { return false }
        playLock.lock()
        defer { playLock.unlock() }
        guard playQueue.empty else { return false }
        player.stop()
        player.play()
        scheduledEnd = 0
        itemStart = -1
        return true
    }

    // MARK: Waiting music (conversation only)

    /**
     * The piece and volume this phone set (`voiceSetWaitingMusic`); nil plays nothing. Another piece replaces one
     * that is playing at once; no piece fades the one that plays out first and lets its file go only once silent
     * (`fadeMusicLocked`). A piece that cannot be opened leaves no music and says why in the Logs.
     */
    func setMusic(path: String?, volume: Float) {
        rebuildLock.lock()
        musicLock.lock()
        musicVolume = volume
        if musicFade == nil, musicOn, musicQueued { music?.volume = volume }
        var problem: String?
        if path != musicPath {
            musicPath = path
            if path == nil, musicQueued {
                musicOn = false
                fadeMusicLocked()
            } else {
                dropMusicQueueLocked()
                musicFile = nil
                if let path {
                    do {
                        musicFile = try AVAudioFile(forReading: URL(fileURLWithPath: path))
                    } catch {
                        problem = "the waiting music could not be opened: \(error.localizedDescription)"
                    }
                }
                if let music, let file = musicFile, let engine = music.engine, music.outputFormat(forBus: 0) != file.processingFormat {
                    engine.disconnectNodeOutput(music)
                    engine.connect(music, to: engine.mainMixerNode, format: file.processingFormat)
                }
                if musicOn { queueMusicLocked(fadeIn: false) }
            }
        }
        musicLock.unlock()
        rebuildLock.unlock()
        if let problem { note(problem) }
    }

    /// The gate's start: fades the music in over 0.3 s. False when there is nothing to play.
    func startMusic() -> Bool {
        musicLock.lock()
        defer { musicLock.unlock() }
        // `musicPath` nil with a file still open: the last piece is fading out to be let go.
        guard conversation, running, music != nil, musicFile != nil, musicPath != nil else { return false }
        musicOn = true
        if musicQueued {
            // Still fading out: it fades back in from where it is.
            fadeMusicLocked()
        } else {
            queueMusicLocked(fadeIn: true)
        }
        return true
    }

    /// The gate's stop: fades the music out within 0.3 s, then stops the node.
    func stopMusic() {
        musicLock.lock()
        defer { musicLock.unlock() }
        guard musicOn else { return }
        musicOn = false
        fadeMusicLocked()
    }

    /**
     * CDXC:VoiceMode 2026-11-26 WHY: The agent's reply must never play over the waiting music, also while the phone
     * is locked and JavaScript does not run, and also when a `state` frame comes late. So the first audio of a reply
     * fades the music out here, on the socket's own path, whatever the session's gate knows.
     */
    private func stopMusicForReply() {
        musicLock.lock()
        defer { musicLock.unlock() }
        guard musicOn else { return }
        musicOn = false
        fadeMusicLocked()
    }

    /// After the engine started again (in place, as a new engine, after an interruption): music that should be heard plays on.
    private func resumeMusic() {
        musicLock.lock()
        defer { musicLock.unlock() }
        guard musicOn else { return }
        dropMusicQueueLocked()
        queueMusicLocked(fadeIn: false)
    }

    /// Queues the piece twice on the node (each finished pass queues one more, so the loop never runs dry) and plays it.
    private func queueMusicLocked(fadeIn: Bool) {
        guard let music, let file = musicFile, music.engine?.isRunning == true else { return }
        let token = musicToken
        musicQueued = true
        music.volume = fadeIn ? 0 : musicVolume
        scheduleMusicPass(music, file, token)
        scheduleMusicPass(music, file, token)
        music.play()
        if fadeIn { fadeMusicLocked() }
    }

    /// One pass of the whole piece, queued right behind the previous one, so the loop point has no gap.
    private func scheduleMusicPass(_ node: AVAudioPlayerNode, _ file: AVAudioFile, _ token: Int) {
        node.scheduleSegment(
            file,
            startingFrame: 0,
            frameCount: AVAudioFrameCount(file.length),
            at: nil,
            completionCallbackType: .dataConsumed
        ) { [weak self, weak node] _ in
            // A stop runs this while holding `musicLock`, so the next pass is queued from `musicQueue`.
            self?.musicQueue.async {
                guard let self, let node else { return }
                self.musicLock.lock()
                defer { self.musicLock.unlock() }
                guard self.musicToken == token, self.musicQueued, self.music === node else { return }
                self.scheduleMusicPass(node, file, token)
            }
        }
    }

    /// Stops the node at once and forgets its queue and any fade; whether the music should be heard stays as it is.
    private func dropMusicQueueLocked() {
        musicToken += 1
        musicFade?.cancel()
        musicFade = nil
        if musicQueued { music?.stop() }
        musicQueued = false
    }

    /**
     * Moves the node's volume to `musicVolume` while the music should be heard, or to silence, in
     * `musicFadeSteps` steps of 20 ms (0.3 s); once silent, the node stops and its queue is dropped, and with no
     * piece set any more (the music was turned off) the file is let go.
     */
    private func fadeMusicLocked() {
        musicFade?.cancel()
        musicFade = nil
        guard let music, musicQueued else { return }
        musicFadeFrom = music.volume
        musicFadeStep = 0
        let token = musicToken
        let timer = DispatchSource.makeTimerSource(queue: musicQueue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(20))
        timer.setEventHandler { [weak self, weak timer] in
            guard let self, let timer else { return }
            self.musicLock.lock()
            defer { self.musicLock.unlock() }
            guard self.musicToken == token, self.musicFade === timer, let music = self.music else {
                timer.cancel()
                return
            }
            self.musicFadeStep += 1
            let steps = GhostexVoiceAudio.musicFadeSteps
            let to: Float = self.musicOn ? self.musicVolume : 0
            music.volume = self.musicFadeStep >= steps ? to : self.musicFadeFrom + (to - self.musicFadeFrom) * Float(self.musicFadeStep) / Float(steps)
            guard self.musicFadeStep >= steps else { return }
            timer.cancel()
            self.musicFade = nil
            if !self.musicOn {
                self.dropMusicQueueLocked()
                if self.musicPath == nil { self.musicFile = nil }
            }
        }
        musicFade = timer
        timer.resume()
    }
}

/// How many buffers a player node was given and has not taken or dropped yet; its completion handlers run off the socket's queue.
private final class GhostexPlayQueue {
    private let lock = NSLock()
    private var buffers = 0

    func added() {
        lock.lock()
        buffers += 1
        lock.unlock()
    }

    func taken() {
        lock.lock()
        buffers = max(0, buffers - 1)
        lock.unlock()
    }

    var empty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return buffers == 0
    }
}

/**
 * When a call's waiting music plays: once the agent's first reply audio of the call has arrived and the agent has then
 * been thinking or running a tool for `delay` without a break, until the agent speaks or listens again, its reply
 * audio arrives, the person talks (a hold, or `userSpeaking`), the call's audio is taken away (an interruption,
 * CallKit's hold), the link to the computer drops, the music is turned off or the call ends. Each start waits the
 * whole `delay` again. Only what happens goes in and only `play` and `stop` come out; the session owns the timer
 * (`schedule`) and the audio. `play` answers whether the music started: one that did not (no piece, the call's audio
 * not running yet) is not taken as playing, and the next event that still lets it play, such as the call's audio
 * starting (`audioRestarted`), waits the whole `delay` again. Not thread-safe: the session calls it on its queue.
 *
 * CDXC:VoiceMode 2026-11-26 DECISION: The user asked for waiting music in a voice agent call while the agent thinks or
 * works, so silence does not sound like a dropped call: open-source pieces to choose from, their own volume, and a
 * switch. It is on by default, plays at 30 % of the call's playback after 1.5 s of thinking or a running tool, and its
 * settings are kept on the phone, per device (Settings › Voice, src/voice/waitingMusic.ts). Only a conversation has a
 * gate: Dictate and Read aloud never play it, and nothing plays outside a call.
 * CDXC:VoiceMode 2026-11-26 WHY: A call goes on with the phone locked, and its `state` frames and reply audio arrive
 * on this socket whether or not JavaScript runs (React Native stops its timers while the app is paused, GhostexVoice.kt),
 * so the 1.5 s start and every stop are decided here, natively; JavaScript only sets the switch, volume and piece.
 * CDXC:VoiceMode 2026-11-27 WHY: The music played right at the start of a call, before the agent's greeting: gxserver
 * reports `thinking` for every response it asks for, the greeting included. The music is meant for the agent's work,
 * not for the call's setup, so it waits for the agent's first reply audio of the call (`replied`). A rejoin keeps
 * that (the session and its gate stay); a new call has a new gate and starts without it.
 */
final class GhostexWaitingMusicGate {
    static let delay: TimeInterval = 1.5

    private let schedule: (TimeInterval, @escaping () -> Void) -> Void
    private let play: () -> Bool
    private let stop: (String) -> Void

    private var enabled = false
    /// The latest `state` frame's value, and whether the agent's reply audio came after it.
    private var agentState = ""
    private var replying = false
    /// The agent's first reply audio of this call has arrived; never cleared, so a rejoin keeps it.
    private var replied = false
    private var talking = false
    private var paused = false
    private var linkDown = false
    private var ended = false
    /// The start waiting out its delay; anything that ends the wait clears it, so that timer then does nothing.
    private var pending: Int?
    private var waits = 0
    private(set) var playing = false

    init(schedule: @escaping (TimeInterval, @escaping () -> Void) -> Void, play: @escaping () -> Bool, stop: @escaping (String) -> Void) {
        self.schedule = schedule
        self.play = play
        self.stop = stop
    }

    /// The switch, and whether this build has a piece to play.
    func setEnabled(_ value: Bool) {
        enabled = value
        update()
    }

    /// A `state` frame: `thinking` and `toolRunning` wait for the music; anything else stops it.
    func agentState(_ value: String) {
        agentState = value
        replying = false
        update()
    }

    /// The agent's reply audio arrived: it speaks, whatever the last `state` frame said. The first one arms the music.
    func replyAudio() {
        guard !replying else { return }
        replying = true
        replied = true
        update()
    }

    /// Talk is held (push-to-talk, or a muted Regular call held open).
    func setTalking(_ value: Bool) {
        talking = value
        update()
    }

    /// Another app or CallKit took the call's audio.
    func setPaused(_ value: Bool) {
        paused = value
        update()
    }

    /// The socket dropped and the call is joining again: what the agent was doing is unknown until a new `state` frame.
    func setLinkDown(_ value: Bool) {
        linkDown = value
        if value {
            agentState = ""
            replying = false
        }
        update()
    }

    func end() {
        ended = true
        update()
    }

    /**
     * The call's audio started, or was built anew (the system's media reset) without the music: nothing plays on it
     * now, whatever the gate thought, and the music starts again after the whole `delay` if the agent still works. A
     * start that was already waiting is dropped too, so its timer does nothing: the whole `delay` counts from here.
     */
    func audioRestarted() {
        playing = false
        pending = nil
        update()
    }

    /// Why the music must not play now, or nil while the agent thinks or works.
    private var blocker: String? {
        if ended { return "the call ended" }
        if !enabled { return "waiting music is off" }
        if paused { return "the call's audio was taken away" }
        if linkDown { return "the link to the computer dropped" }
        if talking { return "you are holding Talk" }
        if replying { return "the agent's reply audio arrived" }
        if !replied { return "the agent has not replied yet" }
        if agentState == "thinking" || agentState == "toolRunning" { return nil }
        return agentState.isEmpty ? "the agent is not working" : "the agent is \(agentState)"
    }

    private func update() {
        if let reason = blocker {
            pending = nil
            if playing {
                playing = false
                stop(reason)
            }
            return
        }
        guard !playing, pending == nil else { return }
        waits += 1
        let wait = waits
        pending = wait
        schedule(Self.delay) { [weak self] in
            guard let self, self.pending == wait else { return }
            self.pending = nil
            self.playing = self.play()
        }
    }
}

/**
 * Settings › Voice's short preview of a waiting music piece, outside any call, at the volume set. One at a time: a new
 * one replaces the last, a volume change applies to it, and it fades out by itself after `seconds`.
 */
enum GhostexWaitingMusicPreview {
    private static let lock = NSLock()
    private static var player: AVAudioPlayer?
    private static var plays = 0

    static func play(path: String, volume: Float, seconds: Double) throws {
        let next = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
        next.numberOfLoops = -1
        next.volume = volume
        lock.lock()
        defer { lock.unlock() }
        if player == nil { try GhostexAudioSession.shared.acquire(.preview) }
        player?.stop()
        player = next
        plays += 1
        let play = plays
        next.play()
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { end(play, fade: true) }
    }

    static func stop() {
        lock.lock()
        let play = plays
        lock.unlock()
        end(play, fade: false)
    }

    static func setVolume(_ volume: Float) {
        lock.lock()
        player?.volume = volume
        lock.unlock()
    }

    private static func end(_ play: Int, fade: Bool) {
        lock.lock()
        guard play == plays, let current = player else {
            lock.unlock()
            return
        }
        if fade {
            lock.unlock()
            current.setVolume(0, fadeDuration: 0.3)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { end(play, fade: false) }
            return
        }
        player = nil
        lock.unlock()
        current.stop()
        GhostexAudioSession.shared.release(.preview)
    }
}
