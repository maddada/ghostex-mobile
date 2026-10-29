export type SshConfig = {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Send SSH protocol keep-alive packets on this connection. Defaults to true. */
  keepAliveEnabled?: boolean;
  /** Keep-alive interval in seconds (10-120). Ignored when keepAliveEnabled is false. */
  keepAliveIntervalSec?: number;
  /**
   * tailcat peer token. When set, the native layer starts (or reuses) a tailcat
   * loopback forward keyed on the machineId and dials 127.0.0.1 through it
   * instead of host:port. Host-key identity stays keyed on host:port, so the
   * caller must pass a stable synthetic host for tailcat machines.
   */
  tailcatToken?: string;
  /**
   * `none`: authenticate with the SSH "none" method only (Tailscale SSH, where
   * the tailnet policy decides). Password and key material are ignored. Absent
   * or `credentials` uses the password / private key above.
   */
  authMethod?: 'credentials' | 'none';
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type OpenTerminalOptions = {
  /** Command to run in the PTY. Omit for an interactive login shell. */
  command?: string;
  /** Defaults to "xterm-256color". */
  termType?: string;
  /** Initial font size in points (iOS) / sp (Android). */
  fontSize?: number;
  /**
   * True for `ghostex attach` (zmx-backed) sessions. On Android the native
   * module runs the Termux-fork post-attach viewport refresh (visible-attach
   * retry loop → size update → ZMX redraw OSC → PageUp/PageDown nudge); iOS
   * still refreshes from JS.
   */
  zmxBacked?: boolean;
  /**
   * Scrollback row limit for this terminal's buffer (applies to newly created
   * buffers only). 500-20000 in 500-row steps. Defaults to 2000.
   */
  scrollbackRows?: number;
};

export type CursorStyle = 'block' | 'underline' | 'bar';

/**
 * Module-global terminal presentation/behavior settings. Applied via
 * setTerminalSettings to all live and warm terminal entries immediately, and
 * to every terminal opened afterwards.
 */
export type TerminalRuntimeSettings = {
  /** Follow new output when the user is already at the bottom. When false, never move the viewport on output. */
  autoScroll: boolean;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  /** When false, terminal taps must not implicitly present the software keyboard (explicit focusTerminal still works). */
  softKeyboardEnabled: boolean;
  /** When true, tapping a URL rendered in the terminal opens it in the system browser. */
  openUrlsOnTap: boolean;
};

/** Short app alert sounds played natively (no bundled JS audio dependency). */
export type TerminalAlertSoundKind = 'bell' | 'attention';

/** The side of the app's window where the system stands its vertical bar (iPhone Duo; iOS 27.1 SDK). */
export type VerticalBarEdge = 'leading' | 'trailing';

/** A rectangle in window points. */
export type WindowRect = { x: number; y: number; width: number; height: number };

/**
 * Where the system's bars sit in the app's window (iOS 27.1 `UIView.LayoutRegion.bar`): the side bar
 * while the status bar stands on a side (`edge`), the bar region along the top, the window's size and
 * its top, left and right safe-area insets, and the fold's division regions. Before iOS 27.1 only the
 * size and insets.
 */
export type BarLayout = {
  edge?: VerticalBarEdge;
  sideBar?: WindowRect;
  topBar?: WindowRect;
  windowWidth?: number;
  windowHeight?: number;
  safeTop?: number;
  safeLeft?: number;
  safeRight?: number;
  /** The top of the system layout margins of a view filling the window: safe area plus UIKit's margin. */
  marginTop?: number;
  horizontalSizeClass?: SizeClass;
  verticalSizeClass?: SizeClass;
  /**
   * The fold's division regions in window points, margins included (iOS 27.1
   * `reservedRegions(kind: .division, options: .includeInactive)`): active (half folded) and inactive
   * (flat) alike, so the persistent chrome keeps off the fold before it folds and nothing moves when it
   * does; menus keep off only the active ones.
   */
  divisions?: FoldDivision[];
};

/** A division region of the fold (`BarLayout.divisions`), and whether the fold divides the display there now. */
export type FoldDivision = WindowRect & {
  /** `UIView.ReservedRegion.isActive`: true while the device is half folded, false while it lies flat. */
  active: boolean;
};

export type SizeClass = 'regular' | 'compact';

export type TerminalKey =
  | 'escape'
  | 'tab'
  | 'enter'
  | 'backspace'
  | 'delete'
  | 'insert'
  | 'home'
  | 'end'
  | 'pageUp'
  | 'pageDown'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'f4'
  | 'f5'
  | 'f6'
  | 'f7'
  | 'f8'
  | 'f9'
  | 'f10'
  | 'f11'
  | 'f12'
  | (string & {});

export type KeyModifiers = {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  cmd?: boolean;
  ctrlLocked?: boolean;
  altLocked?: boolean;
  shiftLocked?: boolean;
};

export type GhostexErrorCode =
  | 'E_AUTH_FAILED'
  | 'E_HOST_KEY_MISMATCH'
  | 'E_UNREACHABLE'
  | 'E_REFUSED'
  | 'E_TIMEOUT'
  | 'E_NOT_CONNECTED'
  | 'E_CHANNEL_FAILED'
  | 'E_SFTP_FAILED'
  | 'E_KEYGEN_FAILED'
  /** startPortForward: the remote accepted the channel request but nothing listens on that port. */
  | 'E_PORT_NOT_LISTENING'
  /** startPortForward: the remote sshd refuses direct-tcpip channels (AllowTcpForwarding no). */
  | 'E_FORWARDING_PROHIBITED';

/**
 * One live SSH local port forward: a loopback listener on the phone whose
 * accepted connections are piped, one direct-tcpip channel each, to
 * `localhost:remotePort` on the machine.
 */
export type PortForward = {
  /** Port the web app listens on, on the remote machine's loopback. */
  remotePort: number;
  /** OS-assigned port on the phone's 127.0.0.1 that mirrors it. */
  localPort: number;
};

export type TerminalStateEvent = {
  sessionKey: string;
  state: 'opening' | 'open' | 'closed' | 'failed';
  error?: string;
  errorCode?: GhostexErrorCode;
};

export type TerminalTitleEvent = {
  sessionKey: string;
  title: string;
};

export type TerminalBellEvent = {
  sessionKey: string;
};

export type FontSizeChangeEvent = {
  sessionKey: string;
  fontSize: number;
};

export type KeyModifiersConsumedEvent = {
  sessionKey: string;
};

/** Terminal grid in cells. */
export type TerminalGrid = {
  cols: number;
  rows: number;
};

/** A view-driven resize settled on a new grid (never fired while a grid is pinned). */
export type TerminalGridChangeEvent = {
  sessionKey: string;
  cols: number;
  rows: number;
};

export type VisibleWindowFrameChangeEvent = {
  /** Bottom edge of the unobscured native window, in React Native layout points. */
  bottom: number;
};

export type ConnectionStateEvent = {
  machineId: string;
  state: 'connecting' | 'connected' | 'disconnected' | 'failed';
  error?: string;
  errorCode?: GhostexErrorCode;
};

export type GhostexNativeEvents = {
  onNetworkChanged: (event: Record<string, never>) => void;
  onTerminalState: (event: TerminalStateEvent) => void;
  onTerminalTitle: (event: TerminalTitleEvent) => void;
  onTerminalBell: (event: TerminalBellEvent) => void;
  onFontSizeChange: (event: FontSizeChangeEvent) => void;
  onKeyModifiersConsumed: (event: KeyModifiersConsumedEvent) => void;
  onVisibleWindowFrameChange: (event: VisibleWindowFrameChangeEvent) => void;
  onTerminalGridChange: (event: TerminalGridChangeEvent) => void;
  onConnectionState: (event: ConnectionStateEvent) => void;
  onBarLayoutChange: (event: BarLayout) => void;
  onVoiceEvent: (event: VoiceEvent) => void;
  onSpeechEvent: (event: SpeechEvent) => void;
};

/**
 * Android only (GhostexSpeech.kt): utterance `token` of `speechSpeak` ended, played to its end or
 * cut off; or `voiceModeStop`, the "Voice mode on" notification's Stop (or Exit), which turns
 * Auto-read off.
 */
export type SpeechEvent = { token: string; kind: 'ended' | 'voiceModeStop'; interrupted: boolean };

/** Android only: the chat Read aloud's Voice mode reads, for its notification (GhostexForegroundService.kt). */
export type ReadAloudMode = {
  title: string;
  machineId: string;
  /** The Ghostex session id the notification's tap opens. */
  sessionId: string;
  /** The computer's name while its link is down; the notification says it is reconnecting. */
  reconnecting?: string | null;
};

/** One voice of the phone's text-to-speech engine (`speechVoices`). */
export type SpeechVoice = {
  name: string;
  /** ISO 639 language, such as `en`. */
  language: string;
  /** BCP 47 tag, such as `en-US`. */
  locale: string;
  /** The locale's name in the phone's language, such as "English (United States)". */
  localeLabel: string;
  /** Speaks only with a network connection. */
  network: boolean;
  /** Needs a download first (the engine fetches it on first use). */
  notInstalled: boolean;
};

/** The engine's voices, the one it uses by default, and the phone's language. */
export type SpeechVoices = { voices: SpeechVoice[]; defaultVoice: string | null; language: string };

/** Android only: what `voiceStart` opens (gxserver's `/api/voice`, see GhostexVoice.kt). */
export type VoiceStartOptions = {
  mode: VoiceMode;
  /** The phone's loopback forward to the computer's gxserver. */
  localPort: number;
  authToken: string;
  /** The computer's name, shown in the "Voice mode on" notification. */
  title: string;
  provider?: 'xai' | 'openai';
  /** Dictation only: a BCP-47 hint for the recognizer. */
  language?: string;
  /** Conversation only: `<projectId>:<sessionId>` for a call about one session (gxserver's `focus` query). */
  focus?: string;
};

export type VoiceMode = 'conversation' | 'dictation';

/**
 * A voice session's event: `frame` carries one JSON text frame from gxserver verbatim (the client
 * contract's server-to-client table); `status` is the phone's own news about the link and audio.
 */
export type VoiceEvent =
  | { sessionId: string; mode: VoiceMode; kind: 'frame'; json: string }
  | {
      sessionId: string;
      mode: VoiceMode;
      kind: 'status';
      status:
        | 'open'
        | 'reattaching'
        | 'linkNeeded'
        | 'failed'
        | 'lost'
        | 'closed'
        | 'micError'
        | 'focusPaused'
        | 'focusResumed'
        | 'muted'
        | 'unmuted'
        | 'talking'
        | 'notTalking'
        /** A hold that means nothing now: `message` is `muted` (push-to-talk) or `heard` (Regular, unmuted). */
        | 'talkRefused';
      message: string | null;
    };

/** A Dictate recording on the phone, waiting for the computer to take it (GhostexVoiceRecorder.kt). */
export type LocalDictation = {
  id: string;
  path: string;
  createdAt: number;
  durationMs: number;
  bytes: number;
  dismissed: boolean;
};

/** The conversation the native side is running, if any (after a JavaScript reload). */
export type VoiceStatus = {
  id: string;
  mode: VoiceMode;
  conversationId: string | null;
  state: string;
  muted: boolean;
  /** The hold is on (the voice screen's button or the notification's Talk). */
  talking?: boolean;
  title: string;
  reattaching: boolean;
};

export type GeneratedSshKey = {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
};

/** One row of the Android persistent-notification session inventory. */
export type NotificationSessionRow = {
  title: string;
  /** working | attention | done | sleep | idle — drives the status dot. */
  status: string;
  project: string;
  /** Row-tap deep link target: ghostex://session?machineId=…&sessionId=…. */
  machineId: string;
  sessionId: string;
};

export type SshKeyType = 'ed25519' | 'rsa4096';

export type GhostexTerminalViewProps = {
  /** Registry key of the native terminal entry this view renders. */
  sessionKey: string;
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
  /** Fired on a single tap that did not interact with a selection. */
  onSingleTap?: () => void;
  onOpenUrl: (event: { nativeEvent: { url: string } }) => void;
  /**
   * iOS only (the Android view declares no such event): the top edge of the cursor row in
   * this view's own points, from its top edge (Ghostty v1.3.1 `imePoint`: `y` is the cell's bottom, `height`
   * the cell's height, so the top is `y - height`), whenever it changes and once when the terminal is
   * attached. The terminal screen slides the view with the keyboard by it.
   */
  onCaretChange?: (event: { nativeEvent: { top: number } }) => void;
};

export type GhostexSelectionMenuViewProps = import('react-native').ViewProps & {
  /** The selection bar's Add to Chat (`text`: the selected words) and More (`text` is empty). */
  onSelectionAction?: (event: { nativeEvent: { action: 'addToChat' | 'more'; text: string } }) => void;
  /** A hold on the message that is not on its words, a link or an element that owns its hold. */
  onHold?: () => void;
};

/** One image copied into the app's cache, as `GhostexImageIntakeView` reports it. */
export type IntakeImageFile = { uri: string; name: string; mimeType: string };

export type GhostexImageIntakeViewProps = import('react-native').ViewProps & {
  /** Images dropped on this view are taken (the chat view while its composer shows). */
  dropTarget?: boolean;
  /** Images the keyboard inserted, Paste put in, or a drop brought, copied into the cache. */
  onImages?: (event: {
    nativeEvent: { via: 'keyboard' | 'paste' | 'drop'; files: IntakeImageFile[]; failed: number };
  }) => void;
  /** An image is held over the drop target (`dropTarget`). */
  onDropActive?: (event: { nativeEvent: { active: boolean } }) => void;
};
