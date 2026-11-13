/**
 * The phone's cloud kit: what each computer hands it (`cloudBoxes cloudKit`) so it can start a box
 * from a project's Default snapshot while that computer is off (Q1033 D7; the contents and the
 * user's decision are in `packages/gx-protocol/src/cloud_box/kit.rs`).
 *
 * CDXC:CloudBoxes 2026-11-02 WHY:
 * The kit holds provider keys, agent logins and secret values, so it lives only in the platform
 * secure store (Keychain / Keystore through expo-secure-store, which the app already ships), split
 * into chunks because a secure-store value should stay under 2 KB. It is read again from the
 * computer at most every [`KIT_REFRESH_MS`] while the computer answers, and dropped as soon as the
 * computer refuses it (the user turned "Start boxes from your phone" off).
 */

import * as SecureStore from 'expo-secure-store';

import { homeCloudBoxesRpc } from './boxLink';
import { logAppEvent } from '../app/appLog';

/** Computers whose Cloud Boxes refusal is already in this run's log. */
const cloudKitOffLogged = new Set<string>();

/** `CloudKit` (the TypeScript twin is `GxserverCloudKit` in packages/shared). */
export type CloudKit = {
  version: number;
  homeMachineId: string;
  gxserverVersion: string;
  issuedAt: string;
  /** `plan` (`free`, `pro`) is absent from an older computer. */
  providers: Array<{ provider: string; key: string; plan?: string }>;
  accounts: Array<{ accountId: string; agent: string; name: string; kind: string; value: string }>;
  allowDeviceKeys: string[];
  idleStopMinutes: number;
  projects: CloudKitProject[];
  /** The cap and the spend the computer last read (`CloudKitSpend`); absent from an older computer. */
  spend?: { month: string; totalUsd: number; capUsd?: number };
};

export type CloudKitProject = {
  homeProjectId: string;
  projectKey: string;
  name: string;
  repoUrl?: string;
  baseBranch?: string;
  snapshot: { snapshotId: string; provider: string; providerSnapshotId: string; size?: string; name: string };
  files: Array<{ path: string; contents: string }>;
  vars: Array<{ name: string; value: string }>;
};

const KIT_VERSION = 1;
const KIT_REFRESH_MS = 10 * 60_000;
const CHUNK_CHARS = 1_800;

const kits = new Map<string, CloudKit | null>();
const readAt = new Map<string, number>();

function countKey(machineId: string): string {
  return `cloudkit.${machineId.replace(/[^A-Za-z0-9._-]/gu, '_')}.count`;
}

function chunkKey(machineId: string, index: number): string {
  return `cloudkit.${machineId.replace(/[^A-Za-z0-9._-]/gu, '_')}.${index}`;
}

async function writeStored(machineId: string, kit: CloudKit): Promise<void> {
  const text = JSON.stringify(kit);
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += CHUNK_CHARS) chunks.push(text.slice(start, start + CHUNK_CHARS));
  await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(machineId, index), chunk)));
  const previous = Number((await SecureStore.getItemAsync(countKey(machineId)).catch(() => null)) ?? 0);
  await SecureStore.setItemAsync(countKey(machineId), String(chunks.length));
  for (let index = chunks.length; index < previous; index += 1) {
    await SecureStore.deleteItemAsync(chunkKey(machineId, index)).catch(() => undefined);
  }
}

async function readStored(machineId: string): Promise<CloudKit | null> {
  try {
    const count = Number((await SecureStore.getItemAsync(countKey(machineId))) ?? 0);
    if (!Number.isInteger(count) || count <= 0) return null;
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(machineId, index))),
    );
    if (chunks.some((chunk) => chunk === null)) return null;
    const kit = JSON.parse(chunks.join('')) as CloudKit;
    return kit.version === KIT_VERSION ? kit : null;
  } catch {
    return null;
  }
}

/** Drops a computer's kit from the phone. */
export async function forgetCloudKit(machineId: string): Promise<void> {
  kits.set(machineId, null);
  const count = Number((await SecureStore.getItemAsync(countKey(machineId)).catch(() => null)) ?? 0);
  for (let index = 0; index < count; index += 1) {
    await SecureStore.deleteItemAsync(chunkKey(machineId, index)).catch(() => undefined);
  }
  await SecureStore.deleteItemAsync(countKey(machineId)).catch(() => undefined);
}

/**
 * Reads the computer's kit when it is due (or `force`), keeping the stored one when the computer
 * does not answer and dropping it when the computer refuses (`cloudKitOff`).
 */
export async function syncCloudKit(machineId: string, force = false): Promise<void> {
  if (!force && Date.now() - (readAt.get(machineId) ?? 0) < KIT_REFRESH_MS) return;
  readAt.set(machineId, Date.now());
  const answer = await homeCloudBoxesRpc(machineId, 'cloudKit');
  if (answer.error !== null) {
    if (answer.error.code === 'cloudKitOff') {
      // Not a drop: the computer has Cloud Boxes off. Said once per run so the log can tell it from one.
      if (!cloudKitOffLogged.has(machineId)) {
        cloudKitOffLogged.add(machineId);
        logAppEvent(`gxserver: ${machineId} has Cloud Boxes off (cloudKitOff from /api/cloudBoxes); not a drop`);
      }
      await forgetCloudKit(machineId);
    }
    // Unreachable, or an older Ghostex without the action: keep what the phone has.
    return;
  }
  const kit = answer.result as CloudKit | null;
  if (kit === null || kit.version !== KIT_VERSION) return;
  if (kit.providers.length === 0 || kit.projects.length === 0) {
    await forgetCloudKit(machineId);
    return;
  }
  kits.set(machineId, kit);
  await writeStored(machineId, kit);
}

/** The kit the phone holds for a computer, from memory or the secure store. */
export async function cloudKitOf(machineId: string): Promise<CloudKit | null> {
  if (kits.has(machineId)) return kits.get(machineId) ?? null;
  const stored = await readStored(machineId);
  kits.set(machineId, stored);
  return stored;
}

/** A project the phone may start a box for with that computer off. */
export async function cloudKitProject(machineId: string, homeProjectId: string): Promise<CloudKitProject | null> {
  const kit = await cloudKitOf(machineId);
  return kit?.projects.find((project) => project.homeProjectId === homeProjectId) ?? null;
}

/**
 * Why the phone may not start a new box for this computer now: this month's spend the computer last
 * read reached its monthly cap. `null` when it may.
 *
 * CDXC:CloudBoxes 2026-11-02 DECISION: user (cap A): the kit carries the cap and the last spend
 * seen, and the phone refuses a new box at 100% with the computer off, as the computer does
 * (`server/src/cloud_boxes/spend.rs` `check_cap`); running boxes are never stopped. A kit read in
 * an earlier month says nothing about this one, so only the current UTC month counts.
 */
export function cloudKitCapRefusal(kit: CloudKit, now = new Date()): string | null {
  const spend = kit.spend;
  if (spend === undefined || spend.capUsd === undefined || spend.capUsd <= 0) return null;
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (spend.month !== month || spend.totalUsd < spend.capUsd) return null;
  return `This month's Cloud Box spend ($${spend.totalUsd.toFixed(2)}) reached your $${spend.capUsd.toFixed(2)} cap. Raise the cap on the computer to start new boxes; running boxes keep running.`;
}

/** A provider's key and plan from a computer's kit. */
export async function cloudKitProvider(
  machineId: string,
  provider: string,
): Promise<{ key: string; plan?: string } | null> {
  const kit = await cloudKitOf(machineId);
  return kit?.providers.find((entry) => entry.provider === provider) ?? null;
}
