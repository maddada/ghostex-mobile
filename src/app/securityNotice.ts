/**
 * The one-time 11.0.1 security notice on the phone: Ghostex got more secure, and this phone must
 * pair again with the computers it reaches through Easy Connect. Shown once, after the saved
 * computers load, and only when at least one Easy Connect computer is saved and switched on.
 *
 * CDXC:Security 2026-11-08 DECISION: User (GitHub #495, rollout): "on first start of 11.0.1, a one-time notice explaining Ghostex got more secure and asking to re-pair machines/phones that use Easy Connect, shown ONLY to users with active Easy Connect machines/devices."
 * SEE-ALSO: server/src/security_upgrade.rs and apps/desktop/src/app/gx_store/security_notice.rs in the Ghostex repo (the computer's notice).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import type { MachineRecord } from '../machines/store';

export const SECURITY_NOTICE_SEEN_KEY = 'securityNotice.11.0.1.seen';

/** The saved computers this phone reaches through Easy Connect (`tailcat`) and has switched on. */
export function machinesToPairAgain(
  machines: readonly Pick<MachineRecord, 'name' | 'transport' | 'disabled'>[],
): string[] {
  return machines
    .filter((machine) => machine.transport === 'tailcat' && machine.disabled !== true)
    .map((machine) => machine.name.trim())
    .filter((name) => name.length > 0);
}

/** "Studio", "Studio and Office", "Studio, Office and Lab", "Studio, Office and 2 more". */
function listNames(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

export function securityNoticeText(names: readonly string[]): { title: string; message: string } | null {
  if (names.length === 0) return null;
  return {
    title: 'Ghostex got more secure',
    message: `Pair this phone again with ${listNames(names)}. On the computer, open Settings > Remote and choose Show QR, then scan it here.`,
  };
}

/** Shows the notice the first time it applies; never again once shown or once it did not apply. */
export async function showSecurityNoticeOnce(
  machines: readonly Pick<MachineRecord, 'name' | 'transport' | 'disabled'>[],
): Promise<void> {
  if ((await AsyncStorage.getItem(SECURITY_NOTICE_SEEN_KEY).catch(() => null)) !== null) return;
  await AsyncStorage.setItem(SECURITY_NOTICE_SEEN_KEY, new Date().toISOString()).catch(() => undefined);
  const text = securityNoticeText(machinesToPairAgain(machines));
  if (text === null) return;
  Alert.alert(text.title, text.message, [{ text: 'OK' }]);
}
