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
  | 'E_KEYGEN_FAILED';

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
  onTerminalState: (event: TerminalStateEvent) => void;
  onTerminalTitle: (event: TerminalTitleEvent) => void;
  onTerminalBell: (event: TerminalBellEvent) => void;
  onFontSizeChange: (event: FontSizeChangeEvent) => void;
  onKeyModifiersConsumed: (event: KeyModifiersConsumedEvent) => void;
  onVisibleWindowFrameChange: (event: VisibleWindowFrameChangeEvent) => void;
  onConnectionState: (event: ConnectionStateEvent) => void;
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
};
