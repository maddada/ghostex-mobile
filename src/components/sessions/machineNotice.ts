/**
 * What the Sessions screen says about a computer that is not connected: the phone's counterpart of
 * gx-core's `machine_notice` (packages/gx-core/src/sidebar_view/machine_connection.rs).
 *
 * CDXC:RemoteMachines 2026-11-12 DECISION:
 * User, on a "madda@100.77.81.4: Cannot reach mac…" pill floating over the first project rows under a
 * "Session refresh failed: …" status line: "error blocks the top rows please fix this best way", then
 * "Also no need to show floating connecting there". Nothing floats over the list any more. A computer's
 * connection state has one place, the status line above the search row, in the screen's flow: one
 * short line naming the computer ("Can't reach MacBook · list from 2 min ago", "Connecting to
 * MacBook…"). It goes away by itself when the computer answers. 2026-11-12 (Q2738 to Q2742): its tap opens the
 * Connections sheet (the full reason, the fix, Retry and Logs) instead of details under the line, it speaks for every
 * computer ("2 computers aren't connected"), and a connecting computer shows only after 5 s. Supersedes the 2026-10-25 floating
 * card and pill (which matched the desktop sidebar's overlay); the 2026-09-16 rule stays: a failure
 * keeps showing through retries (its Retry busy) until a refresh succeeds.
 *
 * SEE-ALSO: src/screens/sessions-screen/MachineNotice.tsx (the drawing),
 * src/components/sessions/drawerStatusLine.ts (the line when nothing is wrong).
 */

import { MachineNoticeCopy } from '../../copy';
import type { FailureReasonCode } from '../../inventory/client';
import type { MachineInventory } from '../../inventory/store';
import type { MachineRecord } from '../../machines/store';
import type { MachineTabConnectionState } from './MachineTabs';

export type MachineNotice =
  | { kind: 'connecting'; title: string }
  | {
      kind: 'failure';
      /** Short, with the computer named: "Can't reach MacBook". */
      title: string;
      /** The full reason the details show. */
      reason: string;
      failureKey: FailureReasonCode;
      retrying: boolean;
      /** When the list on screen was read (epoch ms) while it is an older copy; null when there is none. */
      staleSince: number | null;
    };

/**
 * The name the line uses: the name the user gave, else the one the computer reported when paired,
 * else its address without the user ("100.77.81.4", not "madda@100.77.81.4").
 */
export function machineShortName(
  machine: Pick<MachineRecord, 'name' | 'computerName' | 'host' | 'username' | 'transport'>,
): string {
  if (machine.name.trim().length > 0) return machine.name.trim();
  if (machine.computerName !== undefined && machine.computerName.trim().length > 0) return machine.computerName.trim();
  if (machine.transport === 'tailcat' || machine.transport === 'demo' || machine.host.length === 0) {
    return machine.username.length > 0 ? machine.username : 'your computer';
  }
  return machine.host;
}

function failureTitle(code: FailureReasonCode, name: string): string {
  switch (code) {
    case 'authFailed':
      return MachineNoticeCopy.cannotSignIn(name);
    case 'ghostexMissing':
      return MachineNoticeCopy.setupNeeded(name);
    // SSH worked but the computer's Ghostex did not answer yet; the store retries on its own.
    case 'ghostexNotAnswering':
      return MachineNoticeCopy.reconnecting(name);
    case 'channelsBusy':
      return MachineNoticeCopy.busy(name);
    default:
      return MachineNoticeCopy.cannotReach(name);
  }
}

export function machineNotice(
  machineName: string,
  inventory: MachineInventory | undefined,
  connectionState: MachineTabConnectionState,
): MachineNotice | null {
  if (inventory?.lastError != null) {
    const failureKey = inventory.lastErrorCode ?? 'unknown';
    return {
      kind: 'failure',
      title: failureTitle(failureKey, machineName),
      reason: inventory.lastError,
      failureKey,
      retrying: inventory.retrying,
      staleSince: inventory.summary !== null ? inventory.loadedAt : null,
    };
  }
  if (connectionState === 'busy') {
    return { kind: 'connecting', title: MachineNoticeCopy.connecting(machineName) };
  }
  return null;
}

/** "a moment ago", "2 min ago", "3 h ago", "2 d ago". */
export function agoText(since: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return MachineNoticeCopy.justNow;
  if (minutes < 60) return MachineNoticeCopy.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return MachineNoticeCopy.hoursAgo(hours);
  return MachineNoticeCopy.daysAgo(Math.floor(hours / 24));
}

export type NoticeEntry = { machineId: string; notice: MachineNotice };

/** The one line for the shown notices: failures first, then a connecting computer. */
export function noticeLine(entries: readonly NoticeEntry[], now: number): {
  kind: 'connecting' | 'failure';
  text: string;
} | null {
  const failures = entries.flatMap(({ notice }) => (notice.kind === 'failure' ? [notice] : []));
  if (failures.length > 1) return { kind: 'failure', text: MachineNoticeCopy.several(failures.length) };
  const failure = failures[0];
  if (failure !== undefined) {
    const stale = failure.staleSince === null ? '' : ` · ${MachineNoticeCopy.staleShort(agoText(failure.staleSince, now))}`;
    return { kind: 'failure', text: `${failure.title}${stale}` };
  }
  const connecting = entries.find(({ notice }) => notice.kind === 'connecting');
  return connecting === undefined ? null : { kind: 'connecting', text: connecting.notice.title };
}
