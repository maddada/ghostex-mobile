/**
 * The one-time 11.0.1 security notice on the phone: Ghostex got more secure, and this phone must
 * pair again with the computers it reaches through Easy Connect. When one still has its pairing
 * from before the update, the app opens straight into the scanner with a "Pair this phone again"
 * header naming it (ScanCodeScreen's `securityNotice`), re-pairing that saved computer in place.
 * A computer counts as paired again once its pairing is newer than the update; one not used for
 * over a month before the update is left out. Remind me later brings it back tomorrow, at most
 * twice more.
 *
 * CDXC:Security 2026-11-08 DECISION: User (GitHub #495): "on first start of 11.0.1, a one-time notice explaining Ghostex got more secure and asking to re-pair machines/phones that use Easy Connect, shown ONLY to users with active Easy Connect machines/devices." Then design B (Q1726): "on the phone it opens straight into the scanner"; Q1728: pairings unused for over a month are left out; Q1729: Remind me later is tomorrow, at most twice more.
 * SEE-ALSO: server/src/security_upgrade.rs and apps/desktop/src/app/window/security_upgrade_modal.rs in the Ghostex repo (the computer's notice).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MachineRecord } from '../machines/store';

export const SECURITY_NOTICE_KEY = 'securityNotice.11.0.1.v2';
const DAY_MS = 24 * 60 * 60 * 1000;
const UNUSED_FOR_MS = 30 * DAY_MS;
const REMINDERS = 2;

export type SecurityNoticeState = {
  /** When this phone first ran the update (ms); pairings older than this are the old kind. */
  takenAt: number;
  remindAt?: number;
  remindersLeft: number;
  done?: boolean;
};

type NoticeMachine = Pick<MachineRecord, 'id' | 'name' | 'transport' | 'disabled' | 'pairedAt' | 'lastConnectedAt'>;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
};

/** The saved Easy Connect computers still paired the old way, most recently used first. */
export function machinesToPairAgain(machines: readonly NoticeMachine[], takenAt: number): NoticeMachine[] {
  return machines
    .filter((machine) => machine.transport === 'tailcat' && machine.disabled !== true)
    .filter((machine) => {
      const paired = ms(machine.pairedAt);
      return paired === null || paired < takenAt;
    })
    .filter((machine) => {
      const used = ms(machine.lastConnectedAt) ?? ms(machine.pairedAt);
      return used === null || used >= takenAt - UNUSED_FOR_MS;
    })
    .sort((a, b) => (ms(b.lastConnectedAt) ?? 0) - (ms(a.lastConnectedAt) ?? 0));
}

/** Whether the notice should open now. */
export function securityNoticeDue(state: SecurityNoticeState, waiting: number, now: number): boolean {
  return !state.done && waiting > 0 && (state.remindAt === undefined || now >= state.remindAt);
}

/** Remind me later: back tomorrow while reminders are left, then not again. */
export function remindLater(state: SecurityNoticeState, now: number): SecurityNoticeState {
  if (state.remindersLeft <= 0) return { ...state, done: true };
  return { ...state, remindersLeft: state.remindersLeft - 1, remindAt: now + DAY_MS };
}

/** The header's words for the scanner. */
export function securityNoticeText(names: readonly string[]): { title: string; message: string; others: string | null } | null {
  if (names.length === 0) return null;
  const [first, ...rest] = names;
  return {
    title: 'Pair this phone again',
    message: `Ghostex now gives each phone its own key, so a copied code can't let anyone in. On ${first}, open Settings › Remote › Show QR, then scan it here.`,
    others: rest.length > 0 ? `Then pair again with ${rest.join(', ')} the same way.` : null,
  };
}

async function readState(now: number): Promise<SecurityNoticeState> {
  const raw = await AsyncStorage.getItem(SECURITY_NOTICE_KEY).catch(() => null);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as SecurityNoticeState;
      if (typeof parsed.takenAt === 'number') return parsed;
    } catch {
      // A damaged record starts again.
    }
  }
  const state: SecurityNoticeState = { takenAt: now, remindersLeft: REMINDERS };
  await AsyncStorage.setItem(SECURITY_NOTICE_KEY, JSON.stringify(state)).catch(() => undefined);
  return state;
}

/** Remind me later from the scanner's header. */
export async function remindSecurityNoticeLater(now = Date.now()): Promise<void> {
  const state = remindLater(await readState(now), now);
  await AsyncStorage.setItem(SECURITY_NOTICE_KEY, JSON.stringify(state)).catch(() => undefined);
}

export type SecurityNoticeTarget = { rePairMachineId: string; computers: string[] };

/** What the scanner should open on, when the notice is due now; null when it isn't. */
export async function securityNoticeTarget(
  machines: readonly NoticeMachine[],
  now = Date.now(),
): Promise<SecurityNoticeTarget | null> {
  const state = await readState(now);
  const waiting = machinesToPairAgain(machines, state.takenAt);
  if (!securityNoticeDue(state, waiting.length, now)) return null;
  return { rePairMachineId: waiting[0].id, computers: waiting.map((machine) => machine.name.trim() || 'your computer') };
}
