/**
 * What the log and its export need to explain a dropped connection on their own: each computer's route, when its
 * connection came up and how long it lasted, the gxserver version it answered with, and a snapshot of the channels
 * this phone admitted, taken every minute while the app is in front.
 *
 * CDXC:RemoteMachines 2026-11-13 WHY: the computer's own side (sampled over SSH) showed the iPhone's connection
 * replaced every few minutes without the phone ever sitting disconnected, which the phone's log could not explain: it
 * did not say who ended a connection, why, whether the app was in the background, or what was open on it. Only the
 * phone knows those, so it writes them down; addresses never go into these lines, only the kind of route.
 */

import { AppState } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import { formatDuration, whereTheAppIs } from '../app/foregroundClock';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachineRoutes } from '../machines/easyConnectRoute';

export type ConnectionTrace = {
  route: string | null;
  /** When the current connection came up; null while none is up. */
  connectedAt: number | null;
  /** When any connection last came up in this run. */
  lastConnectedAt: number | null;
  /** How long the last dial took. */
  connectMs: number | null;
  gxserverVersion: string | null;
};

const traces = new Map<string, ConnectionTrace>();

function traceFor(machineId: string): ConnectionTrace {
  let trace = traces.get(machineId);
  if (trace === undefined) {
    trace = { route: null, connectedAt: null, lastConnectedAt: null, connectMs: null, gxserverVersion: null };
    traces.set(machineId, trace);
  }
  return trace;
}

export function connectionTrace(machineId: string): ConnectionTrace | null {
  return traces.get(machineId) ?? null;
}

/** 100.64.0.0/10, the addresses Tailscale gives out. */
function tailscaleAddress(host: string): boolean {
  const match = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(host);
  return match !== null && Number(match[1]) >= 64 && Number(match[1]) <= 127;
}

/** The kind of route a computer is reached over, never its address. */
export function routeLabel(
  machine: Pick<MachineConnectionTarget, 'id' | 'host' | 'transport' | 'tailscaleSsh'>,
): string {
  if (machine.transport === 'tailcat' || useMachineRoutes.getState().active[machine.id] === 'easyConnect') {
    return 'Easy Connect';
  }
  const host = machine.host.trim().toLowerCase();
  if (machine.tailscaleSsh === true) return 'Tailscale SSH';
  if (tailscaleAddress(host) || host.endsWith('.ts.net')) return 'Tailscale';
  return 'SSH, not a Tailscale address';
}

/** A dial that ended in a working connection. */
export function noteConnected(machine: MachineConnectionTarget, connectMs: number, now = Date.now()): void {
  const trace = traceFor(machine.id);
  trace.route = routeLabel(machine);
  trace.connectedAt = now;
  trace.lastConnectedAt = now;
  trace.connectMs = connectMs;
  logAppEvent(
    `Connection: ${machine.id} up over ${trace.route}, connect took ${formatDuration(connectMs)} (app ${whereTheAppIs(now)})`,
  );
}

/** "after 3 min up, app in front": how long the connection that just ended lasted, and where the app was. */
export function noteConnectionEnded(machineId: string, now = Date.now()): string {
  const trace = traces.get(machineId);
  const up = trace?.connectedAt ?? null;
  if (trace !== undefined) trace.connectedAt = null;
  return `${up === null ? '' : `after ${formatDuration(now - up)} up, `}app ${whereTheAppIs(now)}`;
}

/** The version a computer's gxserver answered `GET /api/health` with; logged when it changes. */
export function noteGxserverVersion(machineId: string, version: string): void {
  const trace = traceFor(machineId);
  if (trace.gxserverVersion === version) return;
  trace.gxserverVersion = version;
  logAppEvent(`gxserver: ${machineId} runs ${version}`);
}

/** Asks gxserver's open `GET /api/health` over a forward the phone already holds for its version; only for the log. */
export async function readGxserverVersion(machineId: string, localPort: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERSION_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${localPort}/api/health`, { signal: controller.signal });
    const body = (await response.json()) as { version?: unknown } | null;
    if (typeof body?.version === 'string' && body.version.length > 0) noteGxserverVersion(machineId, body.version);
  } catch {
    // Older or busy: the header says "unknown".
  } finally {
    clearTimeout(timer);
  }
}

const VERSION_TIMEOUT_MS = 5_000;
const SNAPSHOT_EVERY_MS = 60_000;
let snapshotTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Every minute while the app is in front, one line per connected computer with what this phone admitted on it
 * (`snapshot`), so a drop has a baseline before it. Identical lines collapse in the log ("×N").
 */
export function startChannelSnapshots(machineIds: () => string[], snapshot: (machineId: string) => string): void {
  if (snapshotTimer !== null) return;
  snapshotTimer = setInterval(() => {
    if (AppState.currentState !== 'active') return;
    for (const machineId of machineIds()) {
      void GhostexNative.isConnected(machineId)
        .then((connected) => {
          if (connected) logAppEvent(snapshot(machineId));
        })
        .catch(() => undefined);
    }
  }, SNAPSHOT_EVERY_MS);
}
