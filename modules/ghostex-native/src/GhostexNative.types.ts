export type SshConfig = {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
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
};

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
