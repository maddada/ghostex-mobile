/** Run with `bun test src/app/securityNotice.test.ts`: who sees the 11.0.1 security notice, and when. */
import { describe, expect, mock, test } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({ default: {} }));

const { machinesToPairAgain, remindLater, securityNoticeDue, securityNoticeText } = await import('./securityNotice');

const TAKEN = Date.parse('2026-11-08T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (at: number) => new Date(at).toISOString();

describe('machinesToPairAgain', () => {
  test('Easy Connect computers paired before the update and used in the last month, newest first', () => {
    const machines = [
      { id: 'studio', name: 'Studio', transport: 'tailcat' as const, pairedAt: iso(TAKEN - 90 * DAY), lastConnectedAt: iso(TAKEN - DAY) },
      { id: 'lab', name: 'Lab', transport: 'tailcat' as const, pairedAt: iso(TAKEN - 90 * DAY), lastConnectedAt: iso(TAKEN - 2 * DAY) },
      { id: 'old', name: 'Old box', transport: 'tailcat' as const, pairedAt: iso(TAKEN - 90 * DAY), lastConnectedAt: iso(TAKEN - 40 * DAY) },
      { id: 'again', name: 'Paired again', transport: 'tailcat' as const, pairedAt: iso(TAKEN + DAY), lastConnectedAt: iso(TAKEN + DAY) },
      { id: 'off', name: 'Off', transport: 'tailcat' as const, disabled: true, pairedAt: iso(TAKEN - DAY), lastConnectedAt: null },
      { id: 'ssh', name: 'Server', transport: 'ssh' as const, pairedAt: undefined, lastConnectedAt: iso(TAKEN - DAY) },
    ];
    expect(machinesToPairAgain(machines, TAKEN).map((machine) => machine.id)).toEqual(['studio', 'lab']);
  });
});

describe('when it opens', () => {
  test('due at once, then tomorrow twice more, then never', () => {
    let state = { takenAt: TAKEN, remindersLeft: 2 };
    expect(securityNoticeDue(state, 1, TAKEN)).toBe(true);
    state = remindLater(state, TAKEN);
    expect(securityNoticeDue(state, 1, TAKEN + DAY - 1)).toBe(false);
    expect(securityNoticeDue(state, 1, TAKEN + DAY)).toBe(true);
    state = remindLater(state, TAKEN + DAY);
    state = remindLater(state, TAKEN + 2 * DAY);
    expect(securityNoticeDue(state, 1, TAKEN + 10 * DAY)).toBe(false);
  });

  test('never when nothing waits', () => {
    expect(securityNoticeDue({ takenAt: TAKEN, remindersLeft: 2 }, 0, TAKEN)).toBe(false);
  });
});

describe('securityNoticeText', () => {
  test('names the computer to show the code on, and the others', () => {
    const text = securityNoticeText(['Studio', 'Lab']);
    expect(text?.message).toContain('On Studio, open Settings › Remote › Show QR');
    expect(text?.others).toBe('Then pair again with Lab the same way.');
    expect(securityNoticeText([])).toBeNull();
  });
});
