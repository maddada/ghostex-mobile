/**
 * What the app reads from a push message of a computer (gxserver through the Expo Push Service): its `data`
 * carries the event kind (`finished`, `needsInput`, `failed`, or `agentStarted` for a push without alert), the
 * computer and session it belongs to, and the feed row it was written for (`notificationId`, optional);
 * identifiers only, never text. Expo hands the data to the app as the notification's `data` and, in the
 * background task, under `body` (also as the JSON string `dataString`). Kept free of React Native so it is
 * testable under `bun test`.
 */

/** The warm link's method that registers or removes the phone's push token on a computer (`POST /api/<method>`). */
export const REGISTER_PUSH_TOKEN_METHOD = 'registerPushToken';

/** What `ghostex server endpoint` lists for a computer that offers push: only such a computer gets a registration. */
export const PUSH_NOTIFICATIONS_CAPABILITY = 'pushNotifications';

/**
 * One push message's event: any kind (only the notifying ones notify, `mapEvent`), '' without a feed row id.
 * `worker`: a coordinator's thread's own news, which the computer sends by the phone's Workers choice
 * (CDXC:Notifications 2026-11-14 in server/src/worker_alerts.rs); absent from an older computer.
 */
export type PushEvent = {
  kind: string;
  machineId: string;
  sessionId: string;
  notificationId: string;
  worker?: boolean;
};

/** Printable ASCII without spaces, as the computer writes its identifiers. */
const IDENTIFIER = /^[\x21-\x7e]+$/u;

function identifier(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length <= maxLength && IDENTIFIER.test(value) ? value : null;
}

/** The event a push message's data names; null when it names no computer, session or kind the app can use. */
export function pushEventFromData(data: unknown): PushEvent | null {
  if (typeof data !== 'object' || data === null) return null;
  // The cast holds: `data` is a non-null object; every field taken from it is checked below.
  const record = data as Record<string, unknown>;
  const kind = identifier(record.kind, 64);
  const machineId = identifier(record.machineId, 64);
  const sessionId = identifier(record.sessionId, 64);
  if (kind === null || machineId === null || sessionId === null) return null;
  let notificationId = '';
  if (record.notificationId !== undefined) {
    const id = identifier(record.notificationId, 128);
    if (id === null) return null;
    notificationId = id;
  }
  return { kind, machineId, sessionId, notificationId, ...(record.worker === true ? { worker: true } : {}) };
}

/**
 * The phone's enabled computer a push names (`data.machineId`), or null when none has that id.
 *
 * The value is the phone's own id for that computer (`MachineRecord.id`): the phone sends it as `machineId` with
 * every registration of its push token (`pushToken.ts`), and the computer returns it as `data.machineId` in every
 * push. It is matched against the enabled computers by that id only, nothing else.
 */
export function pushMachineId(machineId: string, machines: readonly { id: string }[]): string | null {
  return machines.some((machine) => machine.id === machineId) ? machineId : null;
}
