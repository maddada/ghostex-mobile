import { execRemoteCommand } from '../remote/commands';
import { isDemoMachineId } from '../demo/identity';
import { lastHelloMachineId } from './clientHello';
import { clientViewCommand, machineIdForRoute, mobileViewForRoute, type MobileView } from './mobileViews';

/**
 * Mobile screen-opened ping.
 *
 * Like the hello, this never talks to an analytics service: it runs
 * `ghostex client-view` on one computer, whose own usage-analytics setting
 * decides whether anything is recorded. The computer is the one the screen
 * belongs to (its `machineId` parameter), else the last computer that got a
 * hello, so a phone paired with two computers reports each screen once, not
 * twice. One ping per computer per screen per hour, matching the daemon's
 * window. Fire-and-forget: a computer whose Ghostex predates the verb answers
 * with a usage dump, and that is ignored.
 */

const VIEW_INTERVAL_MS = 60 * 60 * 1000;
const VIEW_EXEC_TIMEOUT_MS = 10_000;

const lastViewAt = new Map<string, number>();

function shouldReport(machineId: string, view: MobileView, now: number): boolean {
  const key = `${machineId}\u0000${view}`;
  const last = lastViewAt.get(key);
  if (last !== undefined && now - last < VIEW_INTERVAL_MS) return false;
  lastViewAt.set(key, now);
  return true;
}

/** Report the current route as a phone screen, if it is one. Never throws. */
export function reportMobileView(route: { name: string; params?: unknown } | undefined): void {
  const view = mobileViewForRoute(route?.name);
  if (view === null) return;
  const machineId = machineIdForRoute(route?.params) ?? lastHelloMachineId();
  if (machineId === null || isDemoMachineId(machineId)) return;
  if (!shouldReport(machineId, view, Date.now())) return;
  void execRemoteCommand(machineId, clientViewCommand(view), VIEW_EXEC_TIMEOUT_MS).catch(() => undefined);
}
