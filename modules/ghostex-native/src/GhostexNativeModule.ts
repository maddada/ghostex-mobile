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

  // Non-interactive command in its own channel (inventory + ghostex CLI actions).
  exec(machineId: string, command: string, timeoutMs?: number): Promise<ExecResult>;

  /**
   * SSH local port forwarding over the machine's existing, already-authenticated
   * connection: bind a listener on the phone's 127.0.0.1 and give every accepted
   * connection its own direct-tcpip channel to `localhost:remotePort` on the
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
   */
  startPortForward(machineId: string, remotePort: number): Promise<{ localPort: number }>;
  /** Close the forward's listener and every in-flight channel. No-op when there is none. */
  stopPortForward(machineId: string, remotePort: number): Promise<void>;
  /** The machine's live forwards. Empty when it has none or is not connected. */
  listPortForwards(machineId: string): Promise<PortForward[]>;

  // PTY terminal registry. Entries survive view unmount (warm sessions).
  openTerminal(sessionKey: string, machineId: string, opts: OpenTerminalOptions): Promise<void>;
  closeTerminal(sessionKey: string): Promise<void>;
  listTerminals(): Promise<string[]>;

  sendText(sessionKey: string, text: string): Promise<void>;
  sendKey(sessionKey: string, key: TerminalKey, mods?: KeyModifiers): Promise<void>;
  /** Apply one-shot modifiers to the next key produced by the terminal's software keyboard. */
  setKeyModifiers(sessionKey: string, mods: KeyModifiers): Promise<void>;
  setFontSize(sessionKey: string, size: number): Promise<void>;
  scrollToBottom(sessionKey: string): Promise<void>;

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
