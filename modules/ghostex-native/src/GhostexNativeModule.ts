import { NativeModule, requireNativeModule } from 'expo';

import type {
  ExecResult,
  GeneratedSshKey,
  GhostexNativeEvents,
  KeyModifiers,
  NotificationSessionRow,
  OpenTerminalOptions,
  PortForward,
  SshConfig,
  SshKeyType,
  TerminalAlertSoundKind,
  TerminalGrid,
  TerminalKey,
  TerminalRuntimeSettings,
  VoiceMode,
  VoiceStartOptions,
  VoiceStatus,
  LocalDictation,
  SpeechVoices,
  ReadAloudMode,
  BarLayout,
} from './GhostexNative.types';

declare class GhostexNativeModule extends NativeModule<GhostexNativeEvents> {
  // Connection lifecycle (one SSH client per machineId).
  connect(machineId: string, config: SshConfig): Promise<void>;
  disconnect(machineId: string): Promise<void>;
  isConnected(machineId: string): Promise<boolean>;

  /**
   * Tear down the tailcat forward (listener + tunnel + WireGuard stack) kept for
   * this machineId. Saved machines deliberately keep theirs alive across
   * disconnects so a reconnect skips the peer rendezvous; only throwaway callers
   * such as Test Connection stop theirs. No-op when the machine has no forward.
   */
  stopTailcatForward(machineId: string): Promise<void>;

  /**
   * Open (or reuse) a tailcat loopback forward keyed on `forwardId` that pipes
   * every accepted connection to `remotePort` on the peer behind `address`, and
   * return the phone-side port. Used by Easy Connect pairing, which must reach
   * the computer's gxserver API port before any SSH machine exists; the SSH
   * path keeps starting its own forward inside `connect`. The peer is pinged
   * before this resolves, so an unreachable computer or a stale address
   * rejects here. Pair with `stopTailcatForward(forwardId)`.
   */
  startTailcatForward(forwardId: string, address: string, remotePort: number): Promise<{ localPort: number }>;

  // Non-interactive command in its own channel (inventory + ghostex CLI actions).
  exec(machineId: string, command: string, timeoutMs?: number): Promise<ExecResult>;
  /** `exec` with `input` written to the command's stdin, then EOF (Windows scripts; both platforms). */
  execWithInput(machineId: string, command: string, input: string, timeoutMs?: number): Promise<ExecResult>;

  /**
   * SSH local port forwarding over the machine's existing, already-authenticated
   * connection: bind a listener on the phone's 127.0.0.1 and give every accepted
   * connection its own direct-tcpip channel to `remoteHost:remotePort` on the
   * machine. Nothing is configured on the PC.
   *
   * Requires the machine to be connected (call `connect` first) — otherwise the
   * promise rejects with `E_NOT_CONNECTED`. Idempotent per (machineId,
   * remotePort): a second call returns the same `localPort` while the forward is
   * alive. Before resolving, one probe channel is opened and closed, so
   * `E_PORT_NOT_LISTENING` (nothing bound to that port on the PC) and
   * `E_FORWARDING_PROHIBITED` (sshd `AllowTcpForwarding no`) surface here rather
   * than as an unexplained blank WebView.
   *
   * Forwards are owned by the connection: disconnecting, reconnecting, or
   * replacing it tears every forward down.
   *
   * `remoteHost` is the address the computer dials (default `localhost`). gxserver's forward
   * names `127.0.0.1`, the only address it binds: Windows OpenSSH tries `::1` for `localhost` and
   * never falls back. A live forward for the port that dials another host is replaced, on Android
   * and iOS alike.
   */
  startPortForward(machineId: string, remotePort: number, remoteHost?: string): Promise<{ localPort: number }>;
  /** Close the forward's listener and every in-flight channel. No-op when there is none. */
  stopPortForward(machineId: string, remotePort: number): Promise<void>;
  /** The machine's live forwards. Empty when it has none or is not connected. */
  listPortForwards(machineId: string): Promise<PortForward[]>;

  // PTY terminal registry. Entries survive view unmount (warm sessions).
  openTerminal(sessionKey: string, machineId: string, opts: OpenTerminalOptions): Promise<void>;
  closeTerminal(sessionKey: string): Promise<void>;
  listTerminals(): Promise<string[]>;

  sendText(sessionKey: string, text: string): Promise<void>;
  /**
   * Write `text` to the session's stdin byte-for-byte: no bracketed-paste
   * wrapping, no newline or key translation. For in-band control sequences
   * (the zmx display announcements); interactive input keeps using `sendText`.
   */
  sendRawInput(sessionKey: string, text: string): Promise<void>;
  sendKey(sessionKey: string, key: TerminalKey, mods?: KeyModifiers): Promise<void>;
  /** Apply one-shot modifiers to the next key produced by the terminal's software keyboard. */
  setKeyModifiers(sessionKey: string, mods: KeyModifiers): Promise<void>;
  setFontSize(sessionKey: string, size: number): Promise<void>;
  scrollToBottom(sessionKey: string): Promise<void>;

  /** Current emulator grid of a terminal entry; null before its emulator exists. */
  getTerminalGrid(sessionKey: string): Promise<TerminalGrid | null>;
  /**
   * Pin the native emulator and the SSH pty to an explicit `cols`×`rows` grid
   * (used to rest a hidden zmx client at 200 columns). While pinned, layout
   * passes of an attached view do not resize the terminal. `cols`/`rows` of 0
   * hand sizing back to the view, which then reports the grid it settles on
   * through `onTerminalGridChange`.
   */
  setTerminalGrid(sessionKey: string, cols: number, rows: number): Promise<void>;

  /**
   * Apply module-global terminal settings (auto scroll, cursor style/blink,
   * soft-keyboard policy, URL-tap opening) to every live and warm terminal
   * entry immediately and to all terminals opened afterwards.
   */
  setTerminalSettings(settings: TerminalRuntimeSettings): Promise<void>;

  /**
   * Explicit ZMX viewport refresh for one terminal (refresh button): size
   * update + ZMX redraw OSC + PageUp/PageDown nudge, natively on both
   * platforms. No-op for a terminal that is not zmx-backed.
   */
  refreshTerminalViewport(sessionKey: string): Promise<void>;

  /** Keep the display awake (terminal screen active) or release the request. */
  setKeepScreenOn(enabled: boolean): Promise<void>;

  /**
   * Where the system's bars sit in the app's window: the side bar region `sideExtent` wide while the
   * status bar stands on a side (iPhone Duo folded, or unfolded in landscape), the bar region
   * `topExtent` high along the top, and the fold's division regions. Resolves with the layout now and
   * the observation's `id`; from then on `onBarLayoutChange` carries each new one (status items moving,
   * rotation, the side changing, the fold's divisions changing, and, while a listener for
   * `onBarLayoutChange` is registered, the app moving to another window). A new call replaces the
   * running observation. iOS only: guard with Platform.OS before calling.
   */
  observeBarLayout(sideExtent: number, topExtent: number): Promise<{ id: number; layout: BarLayout }>;

  /** Ends observation `id` from `observeBarLayout` (a newer one keeps running). iOS only. */
  stopObservingBarLayout(id: number): Promise<void>;

  /** Play a short native alert sound (terminal bell beep or attention alert). */
  playAlertSound(kind: TerminalAlertSoundKind): Promise<void>;

  /**
   * Make the attached view first responder and show the soft keyboard. Resolves true when the terminal holds
   * the keyboard focus afterwards; false when no view is attached or the platform refused the focus.
   */
  focusTerminal(sessionKey: string): Promise<boolean>;
  /** Resign first responder / hide the soft keyboard for the attached view. */
  blurTerminal(sessionKey: string): Promise<void>;

  // SFTP upload with 0600 permissions.
  uploadFile(machineId: string, localPath: string, remotePath: string): Promise<void>;

  generateSshKey(type: SshKeyType, comment: string, passphrase?: string): Promise<GeneratedSshKey>;
  resetHostKey(host: string, port: number): Promise<void>;

  /** Open the installed Tailscale app. Android launches its package directly. */
  openTailscale(): Promise<boolean>;

  /** Whether this device currently owns an active Tailscale IPv4 or IPv6 address. */
  isTailscaleConnected(): Promise<boolean>;

  /**
   * Evaluates `script` in the react-native-webview WebView whose view tag is `viewTag`, on the UI
   * thread right away (the chat core's hidden WebView; `src/chat/rust/wasm-core/bridge.ts`).
   * react-native-webview's own `postMessage` waits for the next frame, about 16 ms a call.
   */
  postToWebView(viewTag: number, script: string): void;

  /** Fully stop the Android app, including its foreground service and process. */
  quitApp(): Promise<void>;

  // Persistent foreground-service notification (Android only — guard with
  // Platform.OS before calling; the iOS module does not define these).
  setPersistentNotificationEnabled(enabled: boolean): Promise<void>;
  updatePersistentNotification(rows: NotificationSessionRow[]): Promise<void>;
  requestNotificationPermission(): Promise<void>;

  // Voice mode, Android only (GhostexVoice.kt): the manager voice agent and Grok dictation.
  /** Opens `/api/voice` and starts the microphone; a conversation also enters "Voice mode on". */
  voiceStart(options: VoiceStartOptions): Promise<string>;
  /** A fresh forward port and token after the SSH link was rebuilt (answers a `linkNeeded`). */
  voiceUpdateLink(mode: VoiceMode, localPort: number, authToken: string): Promise<void>;
  voiceSetMuted(muted: boolean): Promise<void>;
  /** "Stop talking": the agent's reply is cut. */
  voiceInterrupt(): Promise<void>;
  voiceSendText(text: string): Promise<void>;
  /**
   * The hold button pressed (`true`) or released: a push-to-talk turn (pressing cuts a reply being
   * spoken, releasing sends it), or a muted Regular call unmuted for as long as it is held.
   */
  voiceSetTalking(talking: boolean): Promise<void>;
  /** The finger slid off the hold button before letting go: the hold ends and nothing is sent. */
  voiceCancelTalking(): Promise<void>;
  /** Plays the agent `speed` times as fast, pitch kept, and tells gxserver the rate (`playbackRate`). */
  voiceSetSpeed(speed: number): Promise<void>;
  /** Asks gxserver to switch the conversation to `voice`; it answers with a `voice` frame. */
  voiceSetVoice(voice: string): Promise<void>;
  /** The memory card: Continue hands the last conversation's summary to the agent; Forget deletes it. */
  voiceSendControl(type: 'continueMemory' | 'forgetMemory'): Promise<void>;
  /** Moves the open call to one session (`<projectId>:<sessionId>`), or to all sessions with null. */
  voiceSetFocus(session: string | null): Promise<void>;
  /** Conversation: hang up. Dictation: stop and wait for the final text. */
  voiceEnd(mode: VoiceMode): Promise<void>;
  /** Drops a dictation without its final text. */
  voiceCancel(mode: VoiceMode): Promise<void>;
  voiceStatus(): Promise<VoiceStatus | null>;
  // Dictate's recordings, Android only (GhostexVoiceRecorder.kt): the microphone to a WAV file first.
  /** Starts recording; answers the recording's id. A microphone failure arrives as a `micError` status. */
  dictationRecordStart(): Promise<string>;
  /** Stops recording and closes the file; null when none ran. */
  dictationRecordStop(dismissed: boolean): Promise<LocalDictation | null>;
  /** Recordings the computer never confirmed, oldest first. */
  dictationUnsent(): Promise<LocalDictation[]>;
  /** `length` bytes of a recording from `offset`, as base64 (empty at the end). */
  dictationReadPiece(path: string, offset: number, length: number): Promise<string>;
  dictationDismissLocal(path: string): Promise<void>;
  /** The computer has it: the phone's copy goes. */
  dictationForget(path: string): Promise<void>;
  // Read aloud's speaker, Android only (GhostexSpeech.kt): one utterance at a time for the whole app.
  /** Starts the phone's text-to-speech engine once; false when the phone has none that works. */
  speechInit(): Promise<boolean>;
  speechVoices(): Promise<SpeechVoices>;
  /**
   * Speaks `segments` in order as utterance `token`, replacing anything speaking, with voice `voice`
   * (`''` for the engine's default) at `rate` times the normal speed. Every token ends with one
   * `onSpeechEvent`, natural or interrupted.
   */
  speechSpeak(token: string, segments: string[], voice: string, rate: number): Promise<void>;
  /** Stops utterance `token` if it is still speaking; otherwise nothing. */
  speechStop(token: string): Promise<void>;
  /**
   * Read aloud's Voice mode: the service takes the `mediaPlayback` type and shows "Voice mode on"
   * for `mode`, and the `GhostexVoiceMode` headless task starts (JavaScript ends it). Call it while
   * the app is in front. Answers whether this phone shows Ghostex notifications.
   */
  readAloudModeStart(mode: ReadAloudMode): Promise<boolean>;
  /** A new chat or reconnecting line for the running Voice mode. */
  readAloudModeUpdate(mode: ReadAloudMode): Promise<void>;
  readAloudModeStop(): Promise<void>;
  /** A notification of its own saying Voice mode turned itself off, and why. */
  readAloudModeEnded(title: string, text: string): Promise<void>;
}

export default requireNativeModule<GhostexNativeModule>('GhostexNative');
