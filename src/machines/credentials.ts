/**
 * Machine credential storage.
 * - Saved credentials live in the platform secure store (Keychain/Keystore via
 *   expo-secure-store), keyed `machine.<id>.password` / `.sshkey` /
 *   `.passphrase` / `.publickey` / `.tailcattoken`.
 * - Passwords entered with savePassword=false live only in an in-memory map
 *   for this app run.
 */

import * as SecureStore from 'expo-secure-store';

import type { SshConfig } from '../../modules/ghostex-native/src';
import { useSettingsStore } from '../settings/store';

type CredentialKind = 'password' | 'sshkey' | 'passphrase' | 'publickey' | 'tailcattoken';

/**
 * How the phone reaches a machine. `ssh` (or absent) dials host:port directly;
 * `tailcat` tunnels to the pairing token's peer and dials the machine's SSH
 * port on it, with host:port kept as the stable host-key identity.
 */
export type MachineTransport = 'ssh' | 'tailcat';

function credentialKey(machineId: string, kind: CredentialKind): string {
  return `machine.${machineId}.${kind}`;
}

/** Session-only passwords for machines with savePassword=false. */
const sessionPasswords = new Map<string, string>();

export function setSessionPassword(machineId: string, password: string): void {
  if (password.length === 0) sessionPasswords.delete(machineId);
  else sessionPasswords.set(machineId, password);
}

export function getSessionPassword(machineId: string): string | null {
  return sessionPasswords.get(machineId) ?? null;
}

export function clearSessionPassword(machineId: string): void {
  sessionPasswords.delete(machineId);
}

export function clearAllSessionPasswords(): void {
  sessionPasswords.clear();
}

async function getCredential(machineId: string, kind: CredentialKind): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(credentialKey(machineId, kind));
  } catch {
    return null;
  }
}

async function setCredential(machineId: string, kind: CredentialKind, value: string): Promise<void> {
  if (value.length === 0) {
    await deleteCredential(machineId, kind);
    return;
  }
  await SecureStore.setItemAsync(credentialKey(machineId, kind), value);
}

async function deleteCredential(machineId: string, kind: CredentialKind): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(credentialKey(machineId, kind));
  } catch {
    // Missing entries are fine.
  }
}

export function getSavedPassword(machineId: string): Promise<string | null> {
  return getCredential(machineId, 'password');
}

export function setSavedPassword(machineId: string, password: string): Promise<void> {
  return setCredential(machineId, 'password', password);
}

export function deleteSavedPassword(machineId: string): Promise<void> {
  return deleteCredential(machineId, 'password');
}

export function getSshKey(machineId: string): Promise<string | null> {
  return getCredential(machineId, 'sshkey');
}

export function setSshKey(machineId: string, privateKey: string): Promise<void> {
  return setCredential(machineId, 'sshkey', privateKey);
}

export function getPassphrase(machineId: string): Promise<string | null> {
  return getCredential(machineId, 'passphrase');
}

export function setPassphrase(machineId: string, passphrase: string): Promise<void> {
  return setCredential(machineId, 'passphrase', passphrase);
}

export function getPublicKey(machineId: string): Promise<string | null> {
  return getCredential(machineId, 'publickey');
}

export function setPublicKey(machineId: string, publicKey: string): Promise<void> {
  return setCredential(machineId, 'publickey', publicKey);
}

export function getTailcatToken(machineId: string): Promise<string | null> {
  return getCredential(machineId, 'tailcattoken');
}

export function setTailcatToken(machineId: string, token: string): Promise<void> {
  return setCredential(machineId, 'tailcattoken', token);
}

/** Remove every stored credential for a machine (used when deleting it). */
export async function deleteAllCredentials(machineId: string): Promise<void> {
  clearSessionPassword(machineId);
  await Promise.all([
    deleteCredential(machineId, 'password'),
    deleteCredential(machineId, 'sshkey'),
    deleteCredential(machineId, 'passphrase'),
    deleteCredential(machineId, 'publickey'),
    deleteCredential(machineId, 'tailcattoken'),
  ]);
}

/** Session-only password wins over the saved one. */
export async function resolvePassword(machineId: string): Promise<string | null> {
  const sessionPassword = getSessionPassword(machineId);
  if (sessionPassword !== null) return sessionPassword;
  return getSavedPassword(machineId);
}

/** Whether any password (session-only or saved) is available for this machine. */
export async function hasPassword(machineId: string): Promise<boolean> {
  const password = await resolvePassword(machineId);
  return password !== null && password.length > 0;
}

export type MachineConnectionTarget = {
  id: string;
  host: string;
  username: string;
  port: number;
  /** Absent means `ssh`. */
  transport?: MachineTransport;
};

/** Build the native SshConfig for a machine from its stored credentials. */
export async function resolveSshConfig(machine: MachineConnectionTarget): Promise<SshConfig> {
  const [password, privateKey, passphrase] = await Promise.all([
    resolvePassword(machine.id),
    getSshKey(machine.id),
    getPassphrase(machine.id),
  ]);
  const { keepAliveEnabled, keepAliveIntervalSec } = useSettingsStore.getState().settings;
  const config: SshConfig = {
    host: machine.host,
    port: machine.port,
    username: machine.username,
    keepAliveEnabled,
    keepAliveIntervalSec,
  };
  if (password !== null && password.length > 0) config.password = password;
  if (privateKey !== null && privateKey.length > 0) config.privateKey = privateKey;
  if (passphrase !== null && passphrase.length > 0) config.passphrase = passphrase;
  if (machine.transport === 'tailcat') {
    // The synthetic host of a tailcat machine is not routable, so a missing
    // token must surface as an error instead of a bogus direct dial.
    const token = await getTailcatToken(machine.id);
    if (token === null || token.length === 0) {
      throw new Error(
        'No tailcat token is saved for this machine. Edit the machine and paste its pairing token again.',
      );
    }
    config.tailcatToken = token;
  }
  return config;
}
