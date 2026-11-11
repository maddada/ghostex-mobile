/**
 * The notifications question, asked once the first computer is paired instead of at the first launch.
 *
 * CDXC:Notifications 2026-11-11 DECISION:
 * User, on the first-run page (step 20, the phone's notifications question at first launch), picked "Ask after
 * pairing, with a reason": nothing is paired at the first launch, so there is nothing to be notified about. Once the
 * phone has a saved computer, the app says in one line why it would notify ("Get a ping when an agent needs you")
 * and, on Turn on notifications, shows the system's own prompt: the one-time ask of `firstAsk.ts` on the iPhone (which
 * keeps the quiet defaults of Settings > Notifications), Android 13's notifications permission on Android. Not now is
 * remembered too (`pairingAskAt`), so the question comes once; Settings > Notifications turns them on later. A phone
 * that already answered the system's ask (`askedAt`) is never asked again.
 * SEE-ALSO: src/notifications/feedStore.ts (`installAttentionFeed` starts this), src/app/persistentNotification.ts
 * (Android's persistent notification, which no longer asks at startup).
 */

import { Alert, Platform } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import { enabledMachines, useMachinesStore } from '../machines/store';
import { useSettingsStore } from '../settings/store';

export const PAIRING_ASK_TITLE = 'Get a ping when an agent needs you';
export const PAIRING_ASK_BODY =
  'Ghostex can tell you when an agent finishes or has a question, even while the app is closed. You can change it later in Settings > Notifications.';

let showing = false;
let installed = false;

function due(): boolean {
  const settings = useSettingsStore.getState();
  const machines = useMachinesStore.getState();
  if (!settings.hydrated || !machines.hydrated) return false;
  const notifications = settings.settings.notifications;
  if (notifications.pairingAskAt !== undefined) return false;
  // Asked before this change, at a first launch: the answer stands.
  if (Platform.OS === 'ios' && notifications.askedAt !== undefined) return false;
  return enabledMachines(machines).length > 0;
}

function remember(): void {
  const settings = useSettingsStore.getState();
  settings.setSetting('notifications', {
    ...settings.settings.notifications,
    pairingAskAt: new Date().toISOString(),
  });
}

function ask(askIos: () => Promise<void>): void {
  if (showing || !due()) return;
  showing = true;
  Alert.alert(PAIRING_ASK_TITLE, PAIRING_ASK_BODY, [
    {
      text: 'Not now',
      style: 'cancel',
      onPress: () => {
        showing = false;
        remember();
      },
    },
    {
      text: 'Turn on notifications',
      onPress: () => {
        showing = false;
        remember();
        if (Platform.OS === 'android') {
          void GhostexNative.requestNotificationPermission().catch((error: unknown) => {
            logAppEvent(`Notifications: the Android permission ask failed (${String(error).slice(0, 80)})`);
          });
        } else {
          void askIos();
        }
      },
    },
  ]);
}

/** Watches the saved computers and settings, and asks once when the first computer is there. */
export function installAskAfterPairing(askIos: () => Promise<void>): void {
  if (installed) return;
  installed = true;
  const check = () => ask(askIos);
  useMachinesStore.subscribe(check);
  useSettingsStore.subscribe(check);
  check();
}
