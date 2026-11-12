/**
 * Which way a Tailscale or SSH computer that also has Easy Connect is dialled, and when the phone
 * moves back to Tailscale. No React Native imports: `bun test` runs this file directly.
 *
 * CDXC:RemotePairing 2026-11-12 DECISION:
 * User (Q2716 = A, Q2717 = move-back): one saved computer with two routes, Tailscale first and Easy
 * Connect when Tailscale doesn't answer (straight to Easy Connect when Tailscale is off on this
 * phone), and "move back to it as soon as it returns, even though that drops the link briefly".
 * Moving back is tried only once Tailscale is up on the phone and a separate test connection over
 * it got through: on Android a new connection for a computer drops the old one at once, so trying
 * Tailscale on the live connection would cut Easy Connect even when Tailscale can't reach.
 * SEE-ALSO: src/remote/connection.ts (`connectEitherRoute`), src/app/routeMoveBack.ts,
 * server/src/remote_access/tailnet_owner.rs in the Ghostex repo.
 */

/** The two ways to reach a computer that has both. */
export type MachineRoute = 'tailscale' | 'easyConnect';

/**
 * The routes in the order they are dialled. `tailscaleOnPhone` is whether Tailscale's VPN is on
 * here (null when this app build can't tell): off goes straight to Easy Connect, and Tailscale
 * stays as the last try in case the computer is reachable another way (the same network).
 */
export function routeDialOrder(tailscaleOnPhone: boolean | null): MachineRoute[] {
  return tailscaleOnPhone === false ? ['easyConnect', 'tailscale'] : ['tailscale', 'easyConnect'];
}

/**
 * Whether a route that failed with `errorCode` lets the phone try the other one. A host key that
 * changed is a warning the person must see, so it is never dialled around.
 */
export function triesOtherRoute(errorCode: unknown): boolean {
  return errorCode !== 'E_HOST_KEY_MISMATCH';
}

/**
 * How long Tailscale's TCP connect may take before a computer that also has Easy Connect tries Easy
 * Connect (the head start the user picked). Only app builds whose native connect takes a per-call
 * timeout use it; older builds wait out their own (8 s on Android, 20 s on iOS).
 */
export const TAILSCALE_HEAD_START_SEC = 2;

/** How often a computer on Easy Connect checks whether Tailscale reaches it again. */
export const MOVE_BACK_INTERVAL_MS = 15_000;

export type MoveBackInput = {
  /** The route the computer is connected on now; undefined when not connected. */
  route: MachineRoute | undefined;
  tailscaleOnPhone: boolean | null;
  /** A check for this computer is under way. */
  trying: boolean;
  /** When the last check started, or null. */
  lastTryAtMs: number | null;
  nowMs: number;
  /** The network changed or the app came back: check now, whatever the interval. */
  force: boolean;
};

/** Whether to check now that Tailscale reaches a computer connected through Easy Connect. */
export function shouldTryMoveBack(input: MoveBackInput): boolean {
  if (input.route !== 'easyConnect' || input.trying) return false;
  if (input.tailscaleOnPhone === false) return false;
  if (input.force) return true;
  return input.lastTryAtMs === null || input.nowMs - input.lastTryAtMs >= MOVE_BACK_INTERVAL_MS;
}

/** The machine id a test connection over Tailscale uses, apart from the computer's live one. */
export function tailscaleProbeId(machineId: string): string {
  return `${machineId}#tailscale-check`;
}
