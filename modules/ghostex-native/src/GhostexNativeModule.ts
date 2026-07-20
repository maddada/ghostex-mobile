import { NativeModule, requireNativeModule } from 'expo';

import type {
  ExecResult,
  GeneratedSshKey,
  GhostexNativeEvents,
  KeyModifiers,
  OpenTerminalOptions,
  SshConfig,
  SshKeyType,
  TerminalKey,
} from './GhostexNative.types';

declare class GhostexNativeModule extends NativeModule<GhostexNativeEvents> {
  // Connection lifecycle (one SSH client per machineId).
  connect(machineId: string, config: SshConfig): Promise<void>;
  disconnect(machineId: string): Promise<void>;
  isConnected(machineId: string): Promise<boolean>;

  // Non-interactive command in its own channel (inventory + ghostex CLI actions).
  exec(machineId: string, command: string, timeoutMs?: number): Promise<ExecResult>;

  // PTY terminal registry. Entries survive view unmount (warm sessions).
  openTerminal(sessionKey: string, machineId: string, opts: OpenTerminalOptions): Promise<void>;
  closeTerminal(sessionKey: string): Promise<void>;
  listTerminals(): Promise<string[]>;

  sendText(sessionKey: string, text: string): Promise<void>;
  sendKey(sessionKey: string, key: TerminalKey, mods?: KeyModifiers): Promise<void>;
  setFontSize(sessionKey: string, size: number): Promise<void>;
  scrollToBottom(sessionKey: string): Promise<void>;

  /** Make the attached view first responder and show the soft keyboard. No-op if no view attached. */
  focusTerminal(sessionKey: string): Promise<void>;
  /** Resign first responder / hide the soft keyboard for the attached view. */
  blurTerminal(sessionKey: string): Promise<void>;

  // SFTP upload with 0600 permissions.
  uploadFile(machineId: string, localPath: string, remotePath: string): Promise<void>;

  generateSshKey(type: SshKeyType, comment: string, passphrase?: string): Promise<GeneratedSshKey>;
  resetHostKey(host: string, port: number): Promise<void>;
}

export default requireNativeModule<GhostexNativeModule>('GhostexNative');
