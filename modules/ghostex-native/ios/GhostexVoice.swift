//
//  GhostexVoice.swift
//  GhostexNative
//
//  The phone's end of gxserver's `/api/voice` on iOS: the manager voice agent's conversation and the
//  composer's Grok dictation (docs/2026-10-20/voice-mode/voice-agent-client-contract.md). The iOS
//  twin of GhostexVoice.kt; the frames, statuses and reattach ladder are the same.
//
//  CDXC:VoiceMode 2026-11-04 WHY: The socket, the microphone and the speaker live here in Swift, not
//  in JavaScript, so the conversation keeps going with the phone locked: the call's audio (the
//  `audio` background mode, and CallKit's call) keeps the app running, and the socket and its
//  reattach ladder never wait on JavaScript. JavaScript only draws what `emit` reports and, when the
//  socket drops, rebuilds the SSH forward (`updateLink`).
//  SEE-ALSO: src/voice/conversation.ts in the app, GhostexVoiceAudio.swift, GhostexVoiceCall.swift.
//

import AVFoundation
import Foundation

final class GhostexVoice {
    static let protocolVersion = 1
    /// gxserver keeps a detached conversation this long (contract section 5); the phone stops trying then.
    static let reattachWindow: TimeInterval = 120
    static let reattachDelays: [TimeInterval] = [0.5, 1, 2, 3]

    /// Set by the module; every voice event for JavaScript goes through it.
    static var emitter: (([String: Any?]) -> Void)?

    private static let lock = NSLock()
    private static var conversation: Session?
    private static var dictation: Session?

    struct Options {
        let mode: String
        let localPort: Int
        let authToken: String
        let title: String
        let provider: String?
        let language: String?
        /// Conversation only: `<projectId>:<sessionId>` for a call about one session, else nil.
        let focus: String?
    }

    /// Starts a conversation or a dictation, replacing one of the same mode that is still running.
    static func start(_ options: Options) -> String {
        let session = Session(options)
        lock.lock()
        let previous: Session?
        if options.mode == "dictation" {
            previous = dictation
            dictation = session
        } else {
            previous = conversation
            conversation = session
        }
        lock.unlock()
        previous?.dispose("replaced")
        GhostexVoiceAudio.installDebugFeed()
        observeLiveActivity()
        session.start()
        return session.id
    }

    private static func current(_ mode: String) -> Session? {
        lock.lock()
        defer { lock.unlock() }
        return mode == "dictation" ? dictation : conversation
    }

    static func updateLink(mode: String, localPort: Int, authToken: String) {
        current(mode)?.updateLink(port: localPort, token: authToken)
    }

    static func setMuted(_ muted: Bool) { current("conversation")?.setMuted(muted, fromCall: false) }
    static func setTalking(_ talking: Bool) { current("conversation")?.setTalking(talking) }
    static func cancelTalking() { current("conversation")?.cancelTalking() }

    /// The Live Activity's Talk / Send: starts a push-to-talk turn, or sends the one in progress.
    static func toggleTalking() { current("conversation")?.toggleTalking() }

    private static var activityObserver: NSObjectProtocol?

    /// The Talk / Send intent runs in the app and posts `GhostexVoiceActivity.toggleTalking`.
    private static func observeLiveActivity() {
        lock.lock()
        defer { lock.unlock() }
        guard activityObserver == nil else { return }
        activityObserver = NotificationCenter.default.addObserver(
            forName: GhostexVoiceActivity.toggleTalking,
            object: nil,
            queue: nil
        ) { _ in
            GhostexVoiceAudio.log.info("Talk / Send from the Live Activity")
            GhostexVoice.toggleTalking()
        }
    }
    static func interrupt() { current("conversation")?.sendJson(["type": "interrupt"]) }
    static func sendText(_ text: String) { current("conversation")?.sendJson(["type": "text", "text": text]) }
    static func setSpeed(_ speed: Double) { current("conversation")?.setSpeed(Float(speed)) }
    static func setVoice(_ voice: String) { current("conversation")?.sendJson(["type": "voice", "voice": voice]) }

    static func setFocus(_ session: String?) {
        current("conversation")?.sendJson(["type": "focus", "session": session ?? NSNull()])
    }

    static func sendControl(_ type: String) {
        guard type == "continueMemory" || type == "forgetMemory" else { return }
        current("conversation")?.sendJson(["type": type])
    }

    /// Conversation: hang up. Dictation: stop listening and wait for the final text.
    static func end(_ mode: String) { current(mode)?.end() }

    /// Dictation only: drop it without a final text.
    static func cancel(_ mode: String) { current(mode)?.dispose("cancelled") }

    /// What JavaScript needs after a reload: the conversation still running, if any.
    static func status() -> [String: Any?]? { current("conversation")?.snapshot() }

    fileprivate static func finished(_ session: Session) {
        lock.lock()
        if conversation === session { conversation = nil }
        if dictation === session { dictation = nil }
        lock.unlock()
    }

    fileprivate static func emit(_ event: [String: Any?]) {
        emitter?(event)
    }

    /**
     * A line for the phone's Logs sheet (`kind: log`, GitHub #500): what the audio side did and the reason the
     * system gave, also written to the system log. Never audio or words. JavaScript from before it ignores it.
     */
    static func journal(_ message: String, mode: String = "conversation", session: String = "") {
        GhostexVoiceAudio.log.info("\(message, privacy: .public)")
        emit(["sessionId": session, "mode": mode, "kind": "log", "message": message])
    }

    /// An interruption's reason, as the system names it.
    fileprivate static func interruptionReason(_ info: [AnyHashable: Any]?) -> String {
        guard #available(iOS 14.5, *),
              let raw = info?[AVAudioSessionInterruptionReasonKey] as? UInt,
              let reason = AVAudioSession.InterruptionReason(rawValue: raw) else { return "no reason given" }
        switch reason {
        case .default: return "another app or a call took the audio"
        case .appWasSuspended: return "the app was suspended"
        case .builtInMicMuted: return "the built-in microphone was muted"
        default:
            if #available(iOS 17.0, *), reason == .routeDisconnected { return "the audio route disconnected" }
            return "reason \(raw)"
        }
    }

    /// A route change's reason and the route now, by port type only (never a device's name).
    fileprivate static func routeChange(_ info: [AnyHashable: Any]?) -> String {
        let raw = info?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        let reason: String
        switch AVAudioSession.RouteChangeReason(rawValue: raw) {
        case .newDeviceAvailable: reason = "a new device is available"
        case .oldDeviceUnavailable: reason = "a device went away"
        case .categoryChange: reason = "the audio category changed"
        case .override: reason = "the route was overridden"
        case .wakeFromSleep: reason = "the device woke from sleep"
        case .noSuitableRouteForCategory: reason = "no route suits the audio category"
        case .routeConfigurationChange: reason = "the route's configuration changed"
        default: reason = "reason \(raw)"
        }
        let route = AVAudioSession.sharedInstance().currentRoute
        let inputs = route.inputs.map { $0.portType.rawValue }.joined(separator: "+")
        let outputs = route.outputs.map { $0.portType.rawValue }.joined(separator: "+")
        return "\(reason); in \(inputs.isEmpty ? "none" : inputs), out \(outputs.isEmpty ? "none" : outputs)"
    }

    /// The socket's delegate for one open: its callbacks name the generation they belong to.
    private final class SocketDelegate: NSObject, URLSessionWebSocketDelegate {
        weak var session: Session?
        let generation: Int

        init(session: Session, generation: Int) {
            self.session = session
            self.generation = generation
        }

        func urlSession(_ urlSession: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
            session?.opened(generation)
        }

        func urlSession(
            _ urlSession: URLSession,
            webSocketTask: URLSessionWebSocketTask,
            didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
            reason: Data?
        ) {
            session?.lost(generation, httpCode: nil)
        }

        func urlSession(_ urlSession: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            let code = (task.response as? HTTPURLResponse)?.statusCode
            session?.lost(generation, httpCode: code == 101 ? nil : code)
        }
    }

    /// One conversation or dictation and its socket, microphone and speaker.
    fileprivate final class Session: GhostexVoiceCallDelegate {
        let id = "voice-\(Int(Date().timeIntervalSince1970 * 1000))"
        private let mode: String
        private let conversationMode: Bool
        private let title: String
        private let provider: String?
        private let language: String?
        /// The session the call was started about; sent only on the first open (a reattach keeps gxserver's).
        private let startFocus: String?

        /// Every field below is touched on this queue only.
        private let queue = DispatchQueue(label: "io.ghostex.voice")
        private var focusTitle: String?
        private var localPort: Int
        private var authToken: String

        private var urlSession: URLSession?
        private var socket: URLSessionWebSocketTask?
        private var generation = 0
        private var ready = false
        private var muted = false
        private var focusPaused = false
        private var speed: Float = 1
        /// A push-to-talk call (`ready` says so): the microphone streams only while Talk is held.
        private var pushToTalk = false
        private var talking = false
        private var conversationId: String?
        private var state = "connecting"
        /// The server said `ended` or `done`, or the user hung up: a closed socket is final.
        private var finishing = false
        private var disposed = false
        private var detachedAt: Date?
        private var attempts = 0
        private var retry: DispatchWorkItem?
        private var pingTimer: DispatchSourceTimer?
        private var pingSentAt: Date?

        private var audio: GhostexVoiceEngine?
        /// CallKit carries this conversation (it activates the audio session and shows the call).
        private var onCall = false
        private var audioFallback: DispatchWorkItem?
        private var observers: [NSObjectProtocol] = []
        private var reportedTitle: String?

        init(_ options: Options) {
            mode = options.mode
            conversationMode = options.mode != "dictation"
            title = options.title
            provider = options.provider
            language = options.language
            startFocus = options.focus
            localPort = options.localPort
            authToken = options.authToken
        }

        func snapshot() -> [String: Any?] {
            queue.sync {
                [
                    "id": id,
                    "mode": mode,
                    "conversationId": conversationId,
                    "state": state,
                    "muted": muted,
                    "talking": talking,
                    "title": title,
                    "reattaching": detachedAt != nil,
                ]
            }
        }

        func start() {
            queue.async {
                self.audio = self.makeEngine()
                self.observeAudioSession()
                if self.conversationMode && GhostexVoiceCall.available {
                    self.placeCall()
                } else {
                    self.startAudio(activate: true)
                }
                self.open()
            }
        }

        // MARK: Audio

        private func makeEngine() -> GhostexVoiceEngine {
            GhostexVoiceEngine(
                conversation: conversationMode,
                onChunk: { [weak self] chunk in self?.queue.async { self?.onMicrophone(chunk) } },
                onError: { [weak self] message in self?.queue.async { self?.status("micError", message) } }
            )
        }

        /**
         * CallKit normally activates the session within a moment; some systems (the Simulator) never
         * do, so the conversation activates it itself after a while.
         */
        private func armAudioFallback() {
            let fallback = DispatchWorkItem { [weak self] in
                guard let self, !self.disposed, self.audio?.running != true else { return }
                self.journal("CallKit did not activate the audio session within 2 s; activating it")
                self.startAudio(activate: true)
            }
            audioFallback = fallback
            queue.asyncAfter(deadline: .now() + 2, execute: fallback)
        }

        /// Puts the conversation on a CallKit call; without one, the session is activated here.
        private func placeCall() {
            do {
                try GhostexAudioSession.shared.acquire(.conversation, activate: false)
            } catch {
                journal("the audio session refused the call's setup: \(error.localizedDescription)")
            }
            onCall = true
            GhostexVoiceCall.shared.start(title: noticeTitle(), delegate: self) { [weak self] accepted in
                guard let self else { return }
                self.queue.async {
                    guard !self.disposed else { return }
                    self.journal(accepted ? "CallKit took the call" : "CallKit declined the call; the phone opens the audio itself")
                    if !accepted {
                        self.onCall = false
                        self.startAudio(activate: true)
                        return
                    }
                    self.armAudioFallback()
                }
            }
        }

        private func startAudio(activate: Bool) {
            guard !disposed, let audio, !audio.running else { return }
            do {
                let use: GhostexAudioUse = conversationMode ? .conversation : .recording
                if activate { try GhostexAudioSession.shared.acquire(use) } else { try GhostexAudioSession.shared.acquire(use, activate: false) }
                audio.setSpeed(speed)
                try audio.start()
            } catch {
                journal("the microphone did not start: \(error.localizedDescription)")
                status("micError", "Ghostex could not open the microphone.")
            }
        }

        private func observeAudioSession() {
            let center = NotificationCenter.default
            observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
                guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
                let info = note.userInfo
                self?.queue.async {
                    guard let self, !self.disposed else { return }
                    switch type {
                    case .began:
                        self.journal("audio interruption began (\(GhostexVoice.interruptionReason(info)))")
                        // A call, Siri or an alarm took the audio: the agent stops talking and listening.
                        self.onFocus(false)
                    case .ended:
                        let options = AVAudioSession.InterruptionOptions(rawValue: info?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
                        self.journal("audio interruption ended (\(options.contains(.shouldResume) ? "the system says resume" : "the system did not say resume"))")
                        if !self.onCall { GhostexAudioSession.shared.reactivate() }
                        self.audio?.resume()
                        self.onFocus(true)
                    @unknown default:
                        break
                    }
                }
            })
            observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] note in
                let change = GhostexVoice.routeChange(note.userInfo)
                self?.queue.async {
                    guard let self, !self.disposed else { return }
                    self.journal("audio route changed: \(change)")
                }
            })
            observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { [weak self] _ in
                self?.queue.async {
                    guard let self, !self.disposed, let old = self.audio else { return }
                    self.journal("the system's media services were reset; building the microphone again")
                    old.stop()
                    self.audio = self.makeEngine()
                    self.startAudio(activate: true)
                }
            })
        }

        func callAudioActivated() {
            queue.async {
                guard !self.disposed else { return }
                self.audioFallback?.cancel()
                self.audioFallback = nil
                if self.audio?.running == true {
                    self.audio?.resume()
                } else {
                    self.startAudio(activate: false)
                }
                if self.focusPaused { self.onFocus(true) }
            }
        }

        func callAudioDeactivated() {
            queue.async {
                guard !self.disposed else { return }
                self.journal("CallKit took the call's audio away")
                self.onFocus(false)
            }
        }

        func callMuted(_ muted: Bool) {
            setMuted(muted, fromCall: true)
        }

        func callHeld(_ held: Bool) {
            queue.async {
                guard !self.disposed else { return }
                self.journal(held ? "CallKit put the call on hold" : "CallKit took the call off hold")
                self.onFocus(!held)
            }
        }

        func callEndedBySystem() {
            queue.async {
                guard !self.disposed else { return }
                self.journal("CallKit ended the call")
                self.onCall = false
                self.endLocked()
            }
        }

        private func onMicrophone(_ chunk: Data) {
            guard let live = socket else { return }
            // Dictation may stream before `ready` (gxserver buffers it); a conversation starts at `ready`.
            // A hold unmutes a muted Regular call; a push-to-talk call listens only while held.
            if conversationMode && (!ready || (muted && !talking) || focusPaused || (pushToTalk && !talking)) { return }
            live.send(.data(chunk)) { _ in }
        }

        private func onFocus(_ gained: Bool) {
            guard !disposed, focusPaused == gained else { return }
            focusPaused = !gained
            // A call or Siri took the speaker: the agent stops talking and stops listening.
            if !gained && audio?.playing() == true { sendJsonLocked(["type": "interrupt"]) }
            status(gained ? "focusResumed" : "focusPaused", nil)
            refreshNotice()
        }

        // MARK: Controls

        /**
         * Mute, told to gxserver too: it drops the microphone's audio and refuses a push-to-talk hold
         * while muted (Mute wins, server/src/voice_agent/talk.rs). Muting mid-hold in a push-to-talk
         * call ends the hold with nothing sent. CallKit's Mute and the voice screen's stay in step.
         */
        func setMuted(_ value: Bool, fromCall: Bool) {
            queue.async {
                guard !self.disposed else { return }
                if fromCall && self.muted == value { return }
                self.muted = value
                if self.ready { self.sendJsonLocked(["type": "mute", "muted": value]) }
                // A microphone that stopped comes back on Unmute (GitHub #500).
                if !value { self.audio?.recover() }
                if value && self.pushToTalk && self.talking {
                    self.talking = false
                    self.status("notTalking", nil)
                }
                if !fromCall && self.onCall { GhostexVoiceCall.shared.setMuted(value) }
                self.refreshNotice()
                self.status(value ? "muted" : "unmuted", nil)
            }
        }

        func sendJson(_ json: [String: Any]) {
            queue.async { self.sendJsonLocked(json) }
        }

        private func sendJsonLocked(_ json: [String: Any]) {
            guard let socket, let data = try? JSONSerialization.data(withJSONObject: json),
                  let text = String(data: data, encoding: .utf8) else { return }
            socket.send(.string(text)) { _ in }
        }

        func setSpeed(_ value: Float) {
            queue.async {
                self.speed = value
                self.audio?.setSpeed(value)
                if self.ready { self.sendPlaybackRate() }
            }
        }

        /**
         * Push-to-talk: Talk pressed or released. gxserver cuts a reply the agent is speaking when Talk
         * is pressed (it answers `interrupted`, as for Stop) and sends what was said when it is released.
         */
        func setTalking(_ value: Bool) {
            queue.async { self.setTalkingLocked(value) }
        }

        private func setTalkingLocked(_ value: Bool) {
            guard conversationMode, ready, talking != value else { return }
            // A push-to-talk call talks while unmuted (Mute wins); a Regular call holds to unmute.
            if value && muted == pushToTalk {
                status("talkRefused", muted ? "muted" : "heard")
                return
            }
            talking = value
            if value { audio?.recover() }
            sendJsonLocked(["type": value ? "talkStart" : "talkEnd"])
            status(value ? "talking" : "notTalking", nil)
            refreshNotice()
        }

        /// The Live Activity's Talk / Send (push-to-talk calls only), like Android's notification button.
        func toggleTalking() {
            queue.async {
                guard self.pushToTalk else { return }
                self.setTalkingLocked(!self.talking)
            }
        }

        func cancelTalking() {
            queue.async {
                guard self.conversationMode, self.talking else { return }
                self.talking = false
                self.sendJsonLocked(["type": "talkCancel"])
                self.status("notTalking", nil)
                self.refreshNotice()
            }
        }

        /// gxserver times the reply's end and an interruption's estimate by this rate; it resets on every attach.
        private func sendPlaybackRate() {
            sendJsonLocked(["type": "playbackRate", "rate": Double(speed)])
        }

        func updateLink(port: Int, token: String) {
            queue.async {
                guard !self.disposed, !self.finishing else { return }
                self.localPort = port
                self.authToken = token
                if self.detachedAt != nil {
                    self.retry?.cancel()
                    self.retry = nil
                    self.open()
                }
            }
        }

        func end() {
            queue.async { self.endLocked() }
        }

        private func endLocked() {
            guard !disposed else { return }
            finishing = true
            // The microphone stops first, so a dictation's last chunk goes before its `end`.
            audio?.stop()
            sendJsonLocked(["type": "end"])
            // gxserver answers `ended` / `done` and closes; a socket that is already gone ends it here.
            if socket == nil || detachedAt != nil {
                disposeLocked("user")
            } else {
                queue.asyncAfter(deadline: .now() + 5) { [weak self] in self?.disposeLocked("user") }
            }
        }

        // MARK: Socket

        private func open() {
            guard !disposed else { return }
            generation += 1
            let gen = generation
            stopPings()
            socket?.cancel(with: .goingAway, reason: nil)
            urlSession?.invalidateAndCancel()
            var components = URLComponents()
            components.scheme = "ws"
            components.host = "127.0.0.1"
            components.port = localPort
            components.path = "/api/voice"
            var query = [
                URLQueryItem(name: "protocolVersion", value: String(GhostexVoice.protocolVersion)),
                URLQueryItem(name: "client", value: "phone"),
                URLQueryItem(name: "mode", value: conversationMode ? "conversation" : "dictation"),
            ]
            if let conversationId { query.append(URLQueryItem(name: "conversationId", value: conversationId)) }
            if conversationMode, let provider { query.append(URLQueryItem(name: "provider", value: provider)) }
            if conversationMode, conversationId == nil, let startFocus { query.append(URLQueryItem(name: "focus", value: startFocus)) }
            if !conversationMode, let language { query.append(URLQueryItem(name: "language", value: language)) }
            components.queryItems = query
            guard let url = components.url else { return }
            var request = URLRequest(url: url)
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
            request.setValue(String(GhostexVoice.protocolVersion), forHTTPHeaderField: "x-gxserver-protocol-version")
            request.timeoutInterval = 30
            ready = false
            let configuration = URLSessionConfiguration.default
            configuration.waitsForConnectivity = false
            let delegateQueue = OperationQueue()
            delegateQueue.underlyingQueue = queue
            delegateQueue.maxConcurrentOperationCount = 1
            let session = URLSession(configuration: configuration, delegate: SocketDelegate(session: self, generation: gen), delegateQueue: delegateQueue)
            let task = session.webSocketTask(with: request)
            task.maximumMessageSize = 4 * 1024 * 1024
            urlSession = session
            socket = task
            task.resume()
        }

        fileprivate func opened(_ gen: Int) {
            guard gen == generation, !disposed, let task = socket else { return }
            status("open", nil)
            receive(task, gen)
            startPings(task, gen)
        }

        private func receive(_ task: URLSessionWebSocketTask, _ gen: Int) {
            task.receive { [weak self] result in
                guard let self else { return }
                self.queue.async {
                    guard gen == self.generation, !self.disposed else { return }
                    switch result {
                    case .success(.string(let text)):
                        self.onText(text)
                    case .success(.data(let bytes)):
                        if self.conversationMode { self.audio?.enqueue(bytes) }
                    case .success:
                        break
                    case .failure:
                        // The task completes with the reason; the delegate reports it (`lost`).
                        return
                    }
                    self.receive(task, gen)
                }
            }
        }

        /// A link that died silently (cell handover, sleeping Wi-Fi) is noticed within seconds.
        private func startPings(_ task: URLSessionWebSocketTask, _ gen: Int) {
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + 10, repeating: 10)
            timer.setEventHandler { [weak self] in
                guard let self, gen == self.generation else { return }
                if let sent = self.pingSentAt, Date().timeIntervalSince(sent) > 20 {
                    task.cancel(with: .abnormalClosure, reason: nil)
                    return
                }
                if self.pingSentAt == nil { self.pingSentAt = Date() }
                task.sendPing { [weak self] error in
                    self?.queue.async {
                        guard let self, gen == self.generation else { return }
                        if error != nil {
                            task.cancel(with: .abnormalClosure, reason: nil)
                        } else {
                            self.pingSentAt = nil
                        }
                    }
                }
            }
            pingTimer = timer
            timer.resume()
        }

        private func stopPings() {
            pingTimer?.cancel()
            pingTimer = nil
            pingSentAt = nil
        }

        private func onText(_ text: String) {
            guard let data = text.data(using: .utf8),
                  let frame = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
            let string = { (key: String) -> String in (frame[key] as? String) ?? "" }
            switch string("type") {
            case "ready":
                if frame["resumed"] as? Bool == true, let detachedAt {
                    GhostexVoiceAudio.log.info("conversation reattached after \(Int(Date().timeIntervalSince(detachedAt) * 1000))ms")
                }
                ready = true
                if !string("conversationId").isEmpty { conversationId = string("conversationId") }
                detachedAt = nil
                attempts = 0
                if conversationMode {
                    focusTitle = focusTitleOf(frame["focus"])
                    pushToTalk = string("callMode") == "pushToTalk"
                    talking = false
                    status("notTalking", nil)
                    // gxserver starts every client unmuted; a reattach carries this phone's Mute over.
                    if muted { sendJsonLocked(["type": "mute", "muted": true]) }
                    sendPlaybackRate()
                    if onCall { GhostexVoiceCall.shared.connected() }
                    refreshNotice()
                }
            case "state":
                state = frame["state"] as? String ?? state
                refreshNotice()
            case "focus":
                if conversationMode {
                    focusTitle = focusTitleOf(frame["focus"])
                    refreshNotice()
                }
            case "audioStart":
                audio?.beginItem(string("itemId"))
            case "interrupted":
                let itemId = string("itemId").isEmpty ? nil : string("itemId")
                let played = audio?.cut(itemId) ?? 0
                GhostexVoiceAudio.log.info("agent reply cut after \(played)ms of playback")
                if let itemId { sendJsonLocked(["type": "playback", "itemId": itemId, "playedMs": played]) }
            case "ended", "done":
                finishing = true
            default:
                break
            }
            GhostexVoice.emit(["sessionId": id, "mode": mode, "kind": "frame", "json": text])
        }

        /// The socket closed or failed. Final after `ended` / `done`; otherwise a conversation reattaches.
        fileprivate func lost(_ gen: Int, httpCode: Int?) {
            guard gen == generation, !disposed, socket != nil else { return }
            socket = nil
            stopPings()
            urlSession?.finishTasksAndInvalidate()
            urlSession = nil
            ready = false
            if finishing {
                disposeLocked("closed")
                return
            }
            if httpCode == 401 || httpCode == 426 {
                // A refused token: gxserver issued a new one. JavaScript asks for it and calls updateLink.
                status("linkNeeded", httpCode == 401 ? "unauthorized" : "protocolMismatch")
            }
            let reattachable = conversationMode && conversationId != nil
            if !reattachable {
                status("failed", httpCode.map { "HTTP \($0)" })
                disposeLocked("failed")
                return
            }
            let now = Date()
            if detachedAt == nil {
                GhostexVoiceAudio.log.info("conversation socket lost\(httpCode.map { " (HTTP \($0))" } ?? ""); reattaching")
                detachedAt = now
                audio?.cut(nil)
                refreshNotice()
            }
            if let detachedAt, now.timeIntervalSince(detachedAt) > GhostexVoice.reattachWindow {
                status("lost", nil)
                disposeLocked("lost")
                return
            }
            status("reattaching", nil)
            status("linkNeeded", nil)
            let delay = GhostexVoice.reattachDelays[min(attempts, GhostexVoice.reattachDelays.count - 1)]
            attempts += 1
            let next = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.retry = nil
                if !self.disposed && !self.finishing && self.socket == nil { self.open() }
            }
            retry = next
            queue.asyncAfter(deadline: .now() + delay, execute: next)
        }

        private func status(_ status: String, _ message: String?) {
            GhostexVoice.emit(["sessionId": id, "mode": mode, "kind": "status", "status": status, "message": message])
        }

        /// A line for the Logs sheet about this call or recording (`GhostexVoice.journal`).
        private func journal(_ message: String) {
            GhostexVoice.journal(message, mode: mode, session: id)
        }

        /// A focus object's session title, or nil for all sessions (or an older gxserver's missing key).
        private func focusTitleOf(_ value: Any?) -> String? {
            guard let focus = value as? [String: Any], let title = focus["title"] as? String,
                  !title.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return title
        }

        /// A call about one session names it ("About Voice mode"); else the computer.
        private func noticeTitle() -> String {
            focusTitle.map { "About \($0)" } ?? title
        }

        /**
         * The call's name on the CallKit screen and, in a push-to-talk call, the Live Activity's line
         * and Talk / Send (the words of Android's "Voice mode on" notification).
         */
        private func refreshNotice() {
            guard conversationMode, !disposed else { return }
            let name = noticeTitle()
            if onCall && name != reportedTitle {
                reportedTitle = name
                GhostexVoiceCall.shared.update(title: name)
            }
            guard pushToTalk else {
                GhostexVoiceActivity.end()
                return
            }
            GhostexVoiceActivity.show(
                computer: title,
                state: GhostexVoiceActivityAttributes.ContentState(talking: talking, muted: muted, line: noticeLine(name))
            )
        }

        private func noticeLine(_ name: String) -> String {
            if detachedAt != nil { return "Reconnecting to \(name)…" }
            if focusPaused { return "Paused while another app uses audio" }
            if muted && !talking { return "Microphone muted · \(name)" }
            if talking { return "Listening · \(name)" }
            if state == "speaking" { return "Speaking · \(name)" }
            if state == "thinking" || state == "toolRunning" { return "Thinking · \(name)" }
            if pushToTalk { return "Push-to-talk · \(name)" }
            return "Listening · \(name)"
        }

        func dispose(_ reason: String) {
            queue.async { self.disposeLocked(reason) }
        }

        /// Releases everything. Idempotent.
        private func disposeLocked(_ reason: String) {
            guard !disposed else { return }
            disposed = true
            retry?.cancel()
            retry = nil
            audioFallback?.cancel()
            audioFallback = nil
            generation += 1
            stopPings()
            if let socket {
                if reason == "cancelled" && !conversationMode {
                    socket.send(.string("{\"type\":\"cancel\"}")) { _ in }
                }
                socket.cancel(with: .normalClosure, reason: nil)
            }
            socket = nil
            urlSession?.finishTasksAndInvalidate()
            urlSession = nil
            audio?.stop()
            audio = nil
            observers.forEach(NotificationCenter.default.removeObserver)
            observers = []
            GhostexAudioSession.shared.release(conversationMode ? .conversation : .recording)
            if onCall {
                onCall = false
                GhostexVoiceCall.shared.finish(failed: reason == "failed" || reason == "lost")
            }
            if conversationMode { GhostexVoiceActivity.end() }
            GhostexVoice.finished(self)
            status("closed", reason)
        }
    }
}
