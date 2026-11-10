/**
 * State machine behind the Scan code screen. Every barcode and every pasted
 * string goes through `readPairingCode`; the user never picks a code type.
 *
 * - easyConnect → the waiting screen (`pairEasyConnect`: "Reaching…", then the
 *   three words), then Sessions; a failure stays on its own screen until the
 *   person picks Scan again or Paste a code.
 * - tailscale → freeze, then the password sheet; "Save and connect" saves the
 *   machine with the password in the secure keystore, then Sessions.
 * - legacyAddress → the Easy Connect form, prefilled with the address (the
 *   documented Advanced route: name and user are typed there).
 * - anything else → red toast, keep scanning.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';

import { ScanCopy } from '../../copy';
import { useOpenSessionsAfterPairing } from '../../machines/justPaired';
import { pairEasyConnect, type EasyConnectPairingResult } from '../../machines/pairing';
import {
  tailscaleCodeAddress,
  type EasyConnectCode,
  type ReadPairingCodeResult,
  type TailscaleCode,
} from '../../machines/pairingCodes';
import { useMachinesStore } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import type { ScanFailure } from './pairingFailure';
import { readScan } from './readScan';

export type ScanPhase =
  | { kind: 'scanning' }
  /** `words`: the phone is Pending and these three words must match the computer's (pairing v2). */
  | { kind: 'pairing'; code: EasyConnectCode; words?: string[]; giveUpAtMs?: number }
  | { kind: 'tailscale'; code: TailscaleCode }
  /** A pairing that did not finish: its screen stays until Scan again or Paste a code. */
  | { kind: 'failed'; failure: ScanFailure };

export type ScanToast = { tone: 'error' | 'ok'; title: string; detail?: string };

export type ScanSheet = 'none' | 'paste' | 'where';

const TOAST_MS = 3500;
/** The camera re-reads the same foreign QR many times a second; one toast per code. */
const REPEAT_REJECT_MS = 4000;

type ScanNavigation = NativeStackNavigationProp<RootStackParamList, 'ScanCode'>;

export function useScanController(
  navigation: ScanNavigation,
  rePairMachineId: string | null,
  initialSheet: ScanSheet = 'none',
) {
  const [phase, setPhase] = useState<ScanPhase>({ kind: 'scanning' });
  const [toast, setToast] = useState<ScanToast | null>(null);
  const [sheet, setSheet] = useState<ScanSheet>(initialSheet);
  const [tailscaleBusy, setTailscaleBusy] = useState(false);
  const [tailscaleError, setTailscaleError] = useState<string | null>(null);
  const phaseRef = useRef<ScanPhase>(phase);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRejected = useRef<{ payload: string; at: number } | null>(null);
  const mounted = useRef(true);
  const pairingAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
      // Leaving the screen stops a Pending phone from waiting on.
      pairingAbort.current?.abort();
    };
  }, []);

  const movePhase = useCallback((next: ScanPhase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const showToast = useCallback((next: ScanToast): void => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      if (mounted.current) setToast(null);
    }, TOAST_MS);
  }, []);

  const haptic = (type: Haptics.NotificationFeedbackType): void => {
    void Haptics.notificationAsync(type).catch(() => undefined);
  };

  const finish = useOpenSessionsAfterPairing(navigation);

  const runEasyConnect = useCallback(
    async (code: EasyConnectCode): Promise<void> => {
      movePhase({ kind: 'pairing', code });
      haptic(Haptics.NotificationFeedbackType.Success);
      let result: EasyConnectPairingResult;
      const abort = new AbortController();
      pairingAbort.current = abort;
      try {
        result = await pairEasyConnect(code, {
          rePairMachineId: rePairMachineId ?? undefined,
          signal: abort.signal,
          onPending: ({ words, giveUpAtMs }) => {
            if (mounted.current && !abort.signal.aborted) movePhase({ kind: 'pairing', code, words, giveUpAtMs });
          },
        });
      } catch (error) {
        // pairEasyConnect maps its own failures, but `finish`/store writes outside
        // it can still throw; the scanner must never stay frozen on "Pairing…".
        result = {
          ok: false,
          reason: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (pairingAbort.current === abort) pairingAbort.current = null;
      if (!mounted.current) return;
      if (result.ok) {
        finish(result.machine.id);
        return;
      }
      if (result.reason === 'cancelled') {
        movePhase({ kind: 'scanning' });
        return;
      }
      haptic(Haptics.NotificationFeedbackType.Error);
      movePhase({
        kind: 'failed',
        failure: { reason: result.reason, message: result.message, computer: code.name, waitedMs: result.waitedMs },
      });
    },
    [finish, movePhase, rePairMachineId],
  );

  /** Route an already-decoded code (from the camera or the paste sheet). */
  const routeCode = useCallback(
    (parsed: Exclude<ReadPairingCodeResult, null>): void => {
      if (phaseRef.current.kind !== 'scanning') return;
      setSheet('none');
      if (parsed.kind === 'easyConnect') {
        void runEasyConnect(parsed.code);
      } else if (parsed.kind === 'tailscale') {
        haptic(Haptics.NotificationFeedbackType.Success);
        setTailscaleError(null);
        movePhase({ kind: 'tailscale', code: parsed.code });
      } else {
        navigation.navigate({
          name: 'MachineForm',
          params: { tailcatToken: parsed.address },
          merge: true,
        });
      }
    },
    [movePhase, navigation, runEasyConnect],
  );

  /**
   * Route a barcode's payloads (the scanner's raw text first, then its display text); a code
   * none of them reads as shows the red toast and scanning continues.
   */
  const handlePayload = useCallback(
    (...payloads: (string | undefined)[]): void => {
      if (phaseRef.current.kind !== 'scanning') return;
      const read = readScan(payloads);
      if (read.kind === 'rejected') {
        const now = Date.now();
        const last = lastRejected.current;
        if (last === null || last.payload !== read.payload || now - last.at > REPEAT_REJECT_MS) {
          lastRejected.current = { payload: read.payload, at: now };
          haptic(Haptics.NotificationFeedbackType.Warning);
          // A Ghostex code this build cannot read comes from a newer computer: say to update,
          // not that it is foreign (a 10.32 phone said "not a Ghostex code" to 10.33's link).
          showToast({ tone: 'error', ...(read.outdated ? ScanCopy.outdated : ScanCopy.rejected) });
        }
        return;
      }
      routeCode(read.parsed);
    },
    [routeCode, showToast],
  );

  const saveTailscale = useCallback(
    async (password: string): Promise<void> => {
      const current = phaseRef.current;
      if (current.kind !== 'tailscale' || tailscaleBusy) return;
      setTailscaleBusy(true);
      setTailscaleError(null);
      const { code } = current;
      try {
        const result = await useMachinesStore.getState().addMachine({
          name: code.name,
          host: tailscaleCodeAddress(code),
          username: code.user,
          port: code.port,
          savePassword: true,
          password,
          transport: 'ssh',
        });
        if (!mounted.current) return;
        setTailscaleBusy(false);
        if (result.ok) {
          finish(result.machine.id);
          return;
        }
        const detail = Object.values(result.errors).filter((line) => line !== result.errors.general);
        setTailscaleError(detail.length > 0 ? detail.join(' ') : result.errors.general);
      } catch (error) {
        // The secure store can refuse to write (e.g. a missing keychain entitlement);
        // the sheet must show that text and let the user try again, not spin forever.
        if (!mounted.current) return;
        setTailscaleBusy(false);
        setTailscaleError(error instanceof Error ? error.message : String(error));
      }
    },
    [finish, tailscaleBusy],
  );

  /** Leave a failure's screen for the scanner, or for the scanner's paste sheet. */
  const scanAgain = useCallback((): void => movePhase({ kind: 'scanning' }), [movePhase]);
  const pasteAfterFailure = useCallback((): void => {
    movePhase({ kind: 'scanning' });
    setSheet('paste');
  }, [movePhase]);

  /** Stop waiting as Pending; the computer's request lapses by itself. */
  const cancelPairing = useCallback((): void => {
    pairingAbort.current?.abort();
  }, []);

  const dismissTailscale = useCallback((): void => {
    if (tailscaleBusy) return;
    setTailscaleError(null);
    movePhase({ kind: 'scanning' });
  }, [movePhase, tailscaleBusy]);

  return {
    phase,
    toast,
    sheet,
    setSheet,
    handlePayload,
    routeCode,
    tailscaleBusy,
    tailscaleError,
    saveTailscale,
    dismissTailscale,
    cancelPairing,
    scanAgain,
    pasteAfterFailure,
  };
}
