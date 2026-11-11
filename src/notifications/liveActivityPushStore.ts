/**
 * Runs `liveActivityPush.ts` for the app's lifetime: the Live Activity's push tokens from the native module (in
 * builds that have them; older builds have none, and nothing is sent), the build's push environment, each
 * computer's capability and session list from the warm link and the inventory store, and a pass whenever one of
 * them, the computers or the settings change, or the app comes to the front. iOS only.
 */

import * as Application from 'expo-application';
import { AppState, Platform } from 'react-native';

import { GhostexLiveActivity } from '../../modules/ghostex-live-activity/src/GhostexLiveActivity';
import { logAppEvent } from '../app/appLog';
import { chatMachineLink } from '../chat/rust/machine-link';
import { useInventoryStore } from '../inventory/store';
import { enabledMachines, useMachinesStore } from '../machines/store';
import { useSettingsStore } from '../settings/store';
import { buildContentState } from './contentState';
import { currentSources } from './liveActivity';
import { setLockedPushes } from './liveActivityPushState';
import {
  LiveActivityPushRegistration,
  type LiveActivityAnswer,
  type LiveActivityEnvironment,
  type LiveActivityParams,
  type LiveActivityTokens,
} from './liveActivityPush';

/** gxserver's capability for `/api/registerLiveActivity` and pushing the banner. */
export const LIVE_ACTIVITY_PUSH_CAPABILITY = 'liveActivityPush';
const REGISTER_LIVE_ACTIVITY_METHOD = 'registerLiveActivity';
const REQUEST_TIMEOUT_MS = 10_000;
/** Changes that come in a burst (each poll updates the inventory) make one pass. */
const SETTLE_MS = 2_000;

/** The token part of the native module, present in builds made after Live Activity pushes. */
type TokenModule = {
  pushTokens?: () => LiveActivityTokens;
  addListener?: (
    event: 'onPushToken',
    listener: (event: { kind: 'update' | 'start'; token: string }) => void,
  ) => { remove(): void };
};

/** The build has the native token code (iOS, a build made for Live Activity pushes); else nothing is sent. */
export const LIVE_ACTIVITY_PUSH_SUPPORTED =
  Platform.OS === 'ios' && typeof (GhostexLiveActivity as unknown as TokenModule | null)?.pushTokens === 'function';

let installed = false;
/** The native module's token part, once the build is known to have it. */
let tokenModule: TokenModule | null = null;
let environment: LiveActivityEnvironment = 'production';
let timer: ReturnType<typeof setTimeout> | null = null;

function machine(machineId: string) {
  return useMachinesStore.getState().machines.find((entry) => entry.id === machineId);
}

function capable(machineId: string): boolean | null {
  const record = machine(machineId);
  if (record === undefined) return null;
  return chatMachineLink(record).capabilities()?.includes(LIVE_ACTIVITY_PUSH_CAPABILITY) ?? null;
}

function answered(machineId: string): boolean {
  const inventory = useInventoryStore.getState().inventoriesByMachineId[machineId];
  return inventory !== undefined && inventory.lastError === null && inventory.loadedAt !== null;
}

function active(machineId: string): boolean {
  const sources = currentSources().filter((source) => source.machineId === machineId);
  if (sources.length === 0) return false;
  const { counts } = buildContentState(sources, Date.now());
  return counts.working + counts.waiting > 0;
}

function readAnswer(result: unknown): LiveActivityAnswer {
  if (typeof result !== 'object' || result === null) return { ok: false, reason: 'refused' };
  const value = result as { serverId?: unknown; computers?: unknown; holds?: unknown; confirmed?: unknown };
  if (typeof value.serverId !== 'string') return { ok: false, reason: 'refused' };
  const speaksFor = Array.isArray(value.computers)
    ? value.computers.flatMap((computer: unknown) => {
        const serverId = (computer as { serverId?: unknown } | null)?.serverId;
        return typeof serverId === 'string' ? [serverId] : [];
      })
    : [];
  return {
    ok: true,
    serverId: value.serverId,
    speaksFor,
    holds: value.holds === true,
    confirmed: value.confirmed === true,
  };
}

async function send(machineId: string, params: LiveActivityParams): Promise<LiveActivityAnswer> {
  const record = machine(machineId);
  if (record === undefined) return { ok: false, reason: 'unreachable' };
  const link = chatMachineLink(record);
  if ((await link.route()) !== 'socket') return { ok: false, reason: 'unreachable' };
  const answer = await link.rpc(REGISTER_LIVE_ACTIVITY_METHOD, params, REQUEST_TIMEOUT_MS);
  if (answer.error === null) return readAnswer(answer.result);
  if (answer.error.code === 'notFound') return { ok: false, reason: 'unsupported' };
  if (answer.error.code === 'unreachable') return { ok: false, reason: 'unreachable' };
  return { ok: false, reason: 'refused' };
}

const registration = new LiveActivityPushRegistration({
  enabled: () => {
    const { liveActivityEnabled, liveActivityLockedUpdates } = useSettingsStore.getState().settings;
    return liveActivityEnabled && liveActivityLockedUpdates;
  },
  // Read live at each pass: the module drops the activity token when the activity ends (no event then).
  tokens: () => (tokenModule?.pushTokens === undefined ? {} : { ...tokenModule.pushTokens() }),
  environment: () => environment,
  sessionNames: () => useSettingsStore.getState().settings.liveActivitySessionNames,
  machines: () => enabledMachines(useMachinesStore.getState()),
  capable,
  answered,
  active,
  send,
  now: Date.now,
  log: logAppEvent,
});

/** How long after a clear or a register that did not get through the pass runs again. */
const RETRY_MS = 30_000;

function retry(): void {
  timer = null;
  schedule();
}

/** A pass after changes settle. */
function schedule(): void {
  if (!useSettingsStore.getState().hydrated) return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void registration.sync().then(() => {
      setLockedPushes(registration.holdsConfirmed());
      // A computer did not take a clear or the register: ask again a little later (no other computer is
      // registered meanwhile).
      if (registration.needsRetry() && timer === null) timer = setTimeout(retry, RETRY_MS);
    });
  }, SETTLE_MS);
}

/** Install once at app startup. Nothing happens in a build without the native token code, or on Android. */
export function initLiveActivityPush(): void {
  if (installed) return;
  installed = true;
  const native = GhostexLiveActivity as unknown as TokenModule | null;
  if (Platform.OS !== 'ios' || native === null || typeof native.pushTokens !== 'function') return;
  tokenModule = native;
  // iOS issued or rotated a token: the banner computer gets it at the next pass.
  native.addListener?.('onPushToken', () => schedule());
  Application.getIosPushNotificationServiceEnvironmentAsync()
    .then((value) => {
      // A development build talks to Apple's sandbox; TestFlight and App Store builds (no value) to production.
      environment = value === 'development' ? 'sandbox' : 'production';
      schedule();
    })
    .catch(() => undefined);
  useInventoryStore.subscribe(schedule);
  useMachinesStore.subscribe(schedule);
  useSettingsStore.subscribe(schedule);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') schedule();
  });
  schedule();
}

/** How long removing a computer waits for its answer to the request to stop pushing the Live Activity. */
const REMOVAL_WAIT_MS = 5_000;

/** Before a computer is removed from the phone: it stops pushing the Live Activity and forgets the tokens. */
export async function clearLiveActivityBeforeRemoval(machineId: string): Promise<void> {
  if (tokenModule === null) return;
  await registration.removing(machineId, REMOVAL_WAIT_MS);
  schedule();
}
