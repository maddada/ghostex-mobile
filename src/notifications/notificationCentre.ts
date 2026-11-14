/**
 * The iPhone's notification centre through `expo-notifications` (SDK 58, MIT): local notifications, the
 * permission behind the one-time ask, banners while the app is in front, taps, and push (remote notifications
 * and their background mode are on in the config plugin): the Expo push token, its changes, the push project
 * the build carries, and the background task iOS runs for a push with content-available.
 *
 * iOS only: on Android nothing here touches expo-notifications; the Android persistent
 * notification (`src/app/persistentNotification.ts`) stays what it was.
 */

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { BackgroundPushResult } from './backgroundPush';
import { HOST_EVENT_KINDS } from './events';
import type { PermissionAdapter, PermissionState } from './firstAsk';
import type { NotificationCentre, NotificationData } from './notify';

export const NOTIFICATIONS_SUPPORTED = Platform.OS === 'ios';

/** The name the background task for pushes is defined and registered under. */
export const BACKGROUND_PUSH_TASK = 'ghostex-background-push';

function permissionState(status: Notifications.NotificationPermissionsStatus): PermissionState {
  switch (status.ios?.status) {
    case Notifications.IosAuthorizationStatus.AUTHORIZED:
    case Notifications.IosAuthorizationStatus.PROVISIONAL:
    case Notifications.IosAuthorizationStatus.EPHEMERAL:
      return 'granted';
    case Notifications.IosAuthorizationStatus.DENIED:
      return 'denied';
    default:
      return 'undetermined';
  }
}

export const expoPermission: PermissionAdapter = {
  current: async () => permissionState(await Notifications.getPermissionsAsync()),
  request: async () =>
    permissionState(
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }),
    ),
};

export const expoNotificationCentre: NotificationCentre = {
  post: async (request) => {
    await Notifications.scheduleNotificationAsync({
      identifier: request.identifier,
      content: {
        title: request.title,
        body: request.line,
        sound: request.sound,
        data: request.data,
        ...(request.threadId === undefined ? {} : { threadIdentifier: request.threadId }),
      },
      trigger: null,
    });
  },
};

/**
 * Settings › Notifications › Send a test notification: one local notification 5 seconds from now, with the sound when
 * `sound`, so the person can leave the app or lock the phone and see how a notice looks and sounds. It goes through
 * iOS only, not through a computer.
 */
export async function postTestNotification(title: string, body: string, sound: boolean): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: 'ghostex-test-notification',
    content: { title, body, sound, threadIdentifier: 'ghostex-test' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
  });
}

/** The tap target of a notification: its own data, or (a push message without a link) its session and event kind. */
function tapData(response: Notifications.NotificationResponse): Partial<NotificationData> | null {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  // The native dictionary as the SDK types it, widened by `null`, which a push without data can carry; each
  // field is checked before use.
  const data: Record<string, unknown> | null | undefined = response.notification.request.content.data;
  if (typeof data?.machineId !== 'string' || typeof data.sessionId !== 'string') return null;
  const kind = HOST_EVENT_KINDS.find((known) => known === data.kind);
  // A thread's approval opens its coordinator, where the card is relayed (`openSessionId`,
  // CDXC:Notifications 2026-11-14 in server/src/worker_alerts.rs).
  const opens = typeof data.openSessionId === 'string' && data.openSessionId.length > 0 ? data.openSessionId : null;
  return {
    machineId: data.machineId,
    sessionId: opens ?? data.sessionId,
    ...(kind !== undefined ? { kind } : {}),
    ...(typeof data.url === 'string' ? { url: data.url } : {}),
    ...(typeof data.notificationId === 'string' ? { notificationId: data.notificationId } : {}),
  };
}

/** What a notification in front shows: the app's own banner with its sound, or nothing (a push the app took). */
const SHOWN: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false,
};
const TAKEN: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

/**
 * Shows the app's notifications while it is in front (a banner over any screen, with its own sound) and hands
 * every tap to `onTap`, including the tap that started the app (a cold start), once: iOS can report that tap both
 * as the last response and to the listener. A push that iOS asks about (the app is in front, or inactive) goes to
 * `onPush` with its data: when the app takes it (true), iOS shows nothing of it and the app announces the event
 * itself, once; otherwise iOS shows the push as it came.
 */
export function installNotificationCentre(
  onTap: (data: Partial<NotificationData>) => void,
  onPush: (data: unknown) => boolean,
): void {
  if (!NOTIFICATIONS_SUPPORTED) return;
  Notifications.setNotificationHandler({
    handleNotification: async ({ request }) => {
      // A trigger as the native side reports it: `push` for a remote notification, else the app's own.
      const trigger: unknown = request.trigger;
      const pushed = typeof trigger === 'object' && trigger !== null && 'type' in trigger && trigger.type === 'push';
      return pushed && onPush(request.content.data) ? TAKEN : SHOWN;
    },
  });
  let lastTapped: string | null = null;
  const handle = (response: Notifications.NotificationResponse | null): void => {
    if (response === null) return;
    const data = tapData(response);
    if (data === null) return;
    Notifications.clearLastNotificationResponse();
    const tapped = response.notification.request.identifier;
    if (tapped === lastTapped) return;
    lastTapped = tapped;
    onTap(data);
  };
  handle(Notifications.getLastNotificationResponse());
  Notifications.addNotificationResponseReceivedListener(handle);
}

/**
 * The push project the build carries (the EAS project id in the app config), or null: a build without one
 * cannot get an Expo push token.
 */
export function pushProjectId(): string | null {
  const projectId: unknown = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null;
}

/** Fetches the phone's Expo push token for the project (from APNs and Expo); rejects when they give none. */
export async function expoPushToken(projectId: string): Promise<string> {
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/**
 * Calls `onChange` with iOS's device token each time iOS announces one: after every registration, also when the
 * token is the same as before, so the caller tells a new token from a repeated one (it stays out of the log).
 */
export function watchPushToken(onChange: (deviceToken: string) => void): void {
  if (!NOTIFICATIONS_SUPPORTED) return;
  Notifications.addPushTokenListener((token) =>
    onChange(typeof token.data === 'string' ? token.data : JSON.stringify(token.data)),
  );
}

/** Lets iOS run the background task for pushes (`BACKGROUND_PUSH_TASK`, defined where the app starts). */
export async function registerBackgroundPushTask(): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) return;
  await Notifications.registerTaskAsync(BACKGROUND_PUSH_TASK);
}

/** A background run's outcome as iOS takes it. */
export function backgroundTaskResult(result: BackgroundPushResult): Notifications.BackgroundNotificationTaskResult {
  if (result === 'newData') return Notifications.BackgroundNotificationTaskResult.NewData;
  if (result === 'failed') return Notifications.BackgroundNotificationTaskResult.Failed;
  return Notifications.BackgroundNotificationTaskResult.NoData;
}
