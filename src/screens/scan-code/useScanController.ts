/**
 * State machine behind the Scan code screen. Every barcode and every pasted
 * string goes through `readPairingCode`; the user never picks a code type.
 *
 * - easyConnect → freeze the viewfinder, show what was read, run
 *   `pairEasyConnect`, then replace the screen with Connected.
 * - tailscale → freeze, then the password sheet; "Save and connect" saves the
 *   machine with the password in the secure keystore, then Connected.
 * - legacyAddress → the Easy Connect form, prefilled with the address (the
 *   documented Advanced route: name and user are typed there).
 * - anything else → red toast, keep scanning.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';

import { ScanCopy } from '../../copy';
import { pairEasyConnect, type EasyConnectPairingResult } from '../../machines/pairing';
import {
  readPairingCode,
  tailscaleCodeAddress,
  type EasyConnectCode,
  type ReadPairingCodeResult,
  type TailscaleCode,
} from '../../machines/pairingCodes';
import { useMachinesStore } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';

export type ScanPhase =
  | { kind: 'scanning' }
  | { kind: 'pairing'; code: EasyConnectCode }
  | { kind: 'tailscale'; code: TailscaleCode };

export type ScanToast = { tone: 'error' | 'ok'; title: string; detail?: string };

export type ScanSheet = 'none' | 'paste' | 'where';

const TOAST_MS = 3500;
/** The camera re-reads the same foreign QR many times a second; one toast per code. */
const REPEAT_REJECT_MS = 4000;

type ScanNavigation = NativeStackNavigationProp<RootStackParamList, 'ScanCode'>;

export function useScanController(navigation: ScanNavigation, rePairMachineId: string | null) {
  const [phase, setPhase] = useState<ScanPhase>({ kind: 'scanning' });
  const [toast, setToast] = useState<ScanToast | null>(null);
  const [sheet, setSheet] = useState<ScanSheet>('none');
  const [tailscaleBusy, setTailscaleBusy] = useState(false);
  const [tailscaleError, setTailscaleError] = useState<string | null>(null);
  const phaseRef = useRef<ScanPhase>(phase);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRejected = useRef<{ payload: string; at: number } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
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

  const finish = useCallback(
    (machineId: string): void => {
      useMachinesStore.getState().selectMachine(machineId);
      navigation.replace('Connected', { machineId });
    },
    [navigation],
  );

  const runEasyConnect = useCallback(
    async (code: EasyConnectCode): Promise<void> => {
      movePhase({ kind: 'pairing', code });
      haptic(Haptics.NotificationFeedbackType.Success);
      let result: EasyConnectPairingResult;
      try {
        result = await pairEasyConnect(code, { rePairMachineId: rePairMachineId ?? undefined });
      } catch (error) {
        // pairEasyConnect maps its own failures, but `finish`/store writes outside
        // it can still throw; the scanner must never stay frozen on "Pairing…".
        result = {
          ok: false,
          reason: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (!mounted.current) return;
      if (result.ok) {
        finish(result.machine.id);
        return;
      }
      haptic(Haptics.NotificationFeedbackType.Error);
      movePhase({ kind: 'scanning' });
      if (result.reason === 'expired') showToast({ tone: 'error', ...ScanCopy.expired });
      else if (result.reason === 'noSecret') showToast({ tone: 'error', ...ScanCopy.noSecret });
      else showToast({ tone: 'error', title: ScanCopy.pairingFailed.title, detail: result.message });
    },
    [finish, movePhase, rePairMachineId, showToast],
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

  /** Route a raw barcode payload; a non-Ghostex code shows the red toast and scanning continues. */
  const handlePayload = useCallback(
    (payload: string): void => {
      if (phaseRef.current.kind !== 'scanning') return;
      const parsed = readPairingCode(payload);
      if (parsed === null) {
        const now = Date.now();
        const last = lastRejected.current;
        if (last === null || last.payload !== payload || now - last.at > REPEAT_REJECT_MS) {
          lastRejected.current = { payload, at: now };
          haptic(Haptics.NotificationFeedbackType.Warning);
          showToast({ tone: 'error', ...ScanCopy.rejected });
        }
        return;
      }
      routeCode(parsed);
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
  };
}
