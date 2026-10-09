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
   * never falls back. A live forward for the port that dials another host is replaced. The retired
   * iOS module takes no host.
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

  /** Play a short native alert sound (terminal bell beep or attention alert). */
  playAlertSound(kind: TerminalAlertSoundKind): Promise<void>;

  /** Make the attached view first responder and show the soft keyboard. No-op if no view attached. */
  focusTerminal(sessionKey: string): Promise<void>;
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

  /** Fully stop the Android app, including its foreground service and process. */
  quitApp(): Promise<void>;

  // Persistent foreground-service notification (Android only — guard with
  // Platform.OS before calling; the iOS module does not define these).
  setPersistentNotificationEnabled(enabled: boolean): Promise<void>;
  updatePersistentNotification(rows: NotificationSessionRow[]): Promise<void>;
  requestNotificationPermission(): Promise<void>;
}

export default requireNativeModule<GhostexNativeModule>('GhostexNative');
