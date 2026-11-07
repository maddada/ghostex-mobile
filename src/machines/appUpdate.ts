/**
 * A computer's Ghostex version and its Update button on the phone: reads and drives that computer's
 * `/api/appUpdate*` (server/src/app_update/) through the gxserver forward the chat link already
 * holds, follows an install through the restart, and words the row the way the desktop does.
 *
 * CDXC:RemoteMachines 2026-10-17 DECISION:
 * User (#245) said yes to the phone part: where the phone lists its computers (Machines and Edit
 * machine), show the Ghostex version that computer runs, that an update is available, an Update
 * button with the desktop's progress steps and ending, and the "Keep this machine up to date"
 * switch, with the desktop's wording. The install is that computer's own updater; the phone only
 * asks gxserver, and while the new build replaces gxserver the forward dies, so failed reads are
 * waited out and the phone's normal auto-reconnect brings the link back.
 * SEE-ALSO: apps/desktop/src/app/remote_conn/app_update.rs (the desktop's twin of this file; the
 * wording and the view rules change together), server/src/app_update/status.rs (the status shape).
 */

import { create } from 'zustand';

import { chatMachineLink, UNREACHABLE_MESSAGE } from '../chat/rust/machine-link';
import { isDemoMachine } from '../demo/identity';
import type { MachineConnectionTarget } from './credentials';

const REQUEST_TIMEOUT_MS = 20_000;
const FOLLOW_POLL_MS = 2_000;
/** An install is followed this long, through the computer's restart, before it is given up on. */
const FOLLOW_LIMIT_MS = 20 * 60_000;
/** A read younger than this is shown as it is when a screen opens. */
export const APP_UPDATE_FRESH_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

const TOO_OLD_MESSAGE = "This computer's Ghostex is too old to update from here; update it there once.";

/** `compose_status` in server/src/app_update/status.rs, as far as the phone reads it. */
export type AppUpdateStatus = {
  version?: string | null;
  platform?: string | null;
  phase?: string | null;
  supported?: boolean;
  unsupportedReason?: string | null;
  availableVersion?: string | null;
  progress?: number | null;
  message?: string | null;
  autoUpdate?: boolean;
  pendingInstall?: unknown;
  lastResult?: { outcome?: string; toVersion?: string; message?: string | null; finishedAt?: string } | null;
};

export type RemoteAppUpdate = {
  /** The computer's last status answer. */
  status: AppUpdateStatus | null;
  /** Why the last request failed, in words for the user. */
  error: string | null;
  /** A request is in flight. */
  busy: boolean;
  /** A check or an install is being followed. */
  following: boolean;
  refreshedAt: number | null;
};

export type AppUpdateOp = 'refresh' | 'check' | 'install';

export type AppUpdateAction = { label: string; op: AppUpdateOp; enabled: boolean };

/** What a computer's row shows (`remote_app_update_view` on the desktop). */
export type AppUpdateView = {
  versionText: string | null;
  detail: string | null;
  tone: 'muted' | 'warning' | 'success';
  action: AppUpdateAction | null;
  busy: boolean;
  progress: number | null;
  /** The switch's value, or `null` when this computer cannot update itself. */
  autoUpdate: boolean | null;
  updateAvailable: boolean;
};

type AppUpdateState = {
  byMachineId: Record<string, RemoteAppUpdate>;
};

export const useAppUpdateStore = create<AppUpdateState>(() => ({ byMachineId: {} }));

const EMPTY: RemoteAppUpdate = { status: null, error: null, busy: false, following: false, refreshedAt: null };

function current(machineId: string): RemoteAppUpdate {
  return useAppUpdateStore.getState().byMachineId[machineId] ?? EMPTY;
}

function patch(machineId: string, change: Partial<RemoteAppUpdate>): void {
  useAppUpdateStore.setState((state) => ({
    byMachineId: { ...state.byMachineId, [machineId]: { ...(state.byMachineId[machineId] ?? EMPTY), ...change } },
  }));
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function appUpdateView(update: RemoteAppUpdate): AppUpdateView {
  const status = update.status;
  if (status === null) {
    return {
      versionText: null,
      detail: update.error,
      tone: 'warning',
      action: update.error === null ? null : { label: 'Retry', op: 'refresh', enabled: !update.busy },
      busy: update.busy,
      progress: null,
      autoUpdate: null,
      updateAvailable: false,
    };
  }
  const version = text(status.version);
  const available = text(status.availableVersion);
  let phase = text(status.phase) ?? 'idle';
  // A Linux server runs gxserver without the app; there is nothing to open.
  if (phase === 'appNotRunning' && text(status.platform) === 'linux') phase = 'idle';
  const supported = status.supported === true;
  const progress = typeof status.progress === 'number' ? status.progress : null;
  // "Updated to …" is news for a day, not a permanent label.
  const finishedAt = Date.parse(text(status.lastResult?.finishedAt) ?? '');
  const lastResult = status.lastResult != null && Date.now() - finishedAt < DAY_MS ? status.lastResult : null;
  const inProgress =
    phase === 'downloading' ||
    phase === 'installing' ||
    phase === 'restarting' ||
    (phase === 'checking' && update.following);
  let tone: AppUpdateView['tone'] = 'muted';
  let detail: string | null = null;
  if (update.error !== null) {
    tone = 'warning';
    detail = update.error;
  } else if (phase === 'downloading') {
    detail = progress === null ? 'Downloading the update…' : `Downloading ${Math.round(progress * 100)}%`;
  } else if (phase === 'installing') {
    detail = 'Installing the update…';
  } else if (phase === 'restarting') {
    detail = 'Restarting Ghostex there…';
  } else if (phase === 'checking') {
    detail = 'Checking for updates…';
  } else if (phase === 'appNotRunning') {
    tone = 'warning';
    detail = 'Ghostex is not open on this computer; open it there to update from here.';
  } else if (phase === 'failed') {
    tone = 'warning';
    detail = text(status.message) ?? 'The update failed.';
  } else if (lastResult?.outcome === 'installed') {
    tone = 'success';
    const to = text(lastResult.toVersion);
    detail = to === null ? null : `Updated to ${to}`;
  } else if (lastResult?.outcome === 'failed') {
    tone = 'warning';
    detail = text(lastResult.message);
  } else if (available !== null && !supported) {
    const reason = text(status.unsupportedReason);
    detail = reason === null ? null : `${available} is out. ${reason}`;
  } else if (available !== null) {
    detail = `Ghostex ${available} is available`;
  } else if (phase === 'upToDate') {
    detail = 'Up to date';
  } else if (!supported) {
    // Why there is no Update button (a build without its updater, a Linux package).
    detail = text(status.unsupportedReason);
  }
  let action: AppUpdateAction | null = null;
  if (!inProgress) {
    if (available !== null && supported)
      action = { label: `Update to ${available}`, op: 'install', enabled: !update.busy };
    else if (supported || phase === 'appNotRunning')
      action = { label: 'Check for updates', op: 'check', enabled: !update.busy };
  }
  return {
    versionText: version === null ? null : `Ghostex ${version}`,
    detail,
    tone,
    action,
    busy: update.busy || inProgress,
    progress,
    autoUpdate: supported ? status.autoUpdate === true : null,
    updateAvailable: available !== null && supported && !inProgress,
  };
}

/**
 * The Machines card's line: the version, then what is happening or available (`tile_update_line`).
 * The desktop announces how an install ended in a toast; the phone has none, so the card also
 * carries "Updated to …" and every warning (not open, too old, why it failed).
 */
export function appUpdateCardLine(view: AppUpdateView): string | null {
  const state = view.updateAvailable || view.busy || view.tone !== 'muted' ? view.detail : null;
  return [view.versionText, state].filter((part): part is string => part !== null).join(' · ') || null;
}

type Answer = { status: AppUpdateStatus } | { error: string };

/** One `/api/appUpdate*` request through the computer's gxserver forward. */
async function request(machine: MachineConnectionTarget, method: string, params: unknown): Promise<Answer> {
  const link = chatMachineLink(machine);
  const route = await link.route();
  // A computer without the endpoint handshake predates these endpoints too.
  if (route === 'legacy') return { error: TOO_OLD_MESSAGE };
  if (route !== 'socket') return { error: UNREACHABLE_MESSAGE };
  const answer = await link.rpc(method, params, REQUEST_TIMEOUT_MS);
  if (answer.error !== null) {
    // A gxserver from before these endpoints does not know the path.
    if (answer.error.code === 'notFound') return { error: TOO_OLD_MESSAGE };
    return { error: answer.error.message };
  }
  const status = (answer.result as { status?: unknown } | null)?.status;
  if (typeof status !== 'object' || status === null) return { error: 'The computer sent an unreadable update status.' };
  return { status: status as AppUpdateStatus };
}

const METHOD_FOR_OP: Record<AppUpdateOp, string> = {
  refresh: 'appUpdateStatus',
  check: 'appUpdateCheck',
  install: 'appUpdateInstall',
};

/** Reads the computer's version and update, unless a request or a follow is already running or the answer is fresh. */
export function refreshAppUpdate(machine: MachineConnectionTarget, options: { ifOlderThanMs?: number } = {}): void {
  if (isDemoMachine(machine)) return;
  const update = current(machine.id);
  if (update.busy || update.following) return;
  if (
    options.ifOlderThanMs !== undefined &&
    update.refreshedAt !== null &&
    Date.now() - update.refreshedAt < options.ifOlderThanMs
  ) {
    return;
  }
  void run(machine, 'refresh');
}

/** The row's action: read again, check for an update, or install it. */
export function runAppUpdateOp(machine: MachineConnectionTarget, op: AppUpdateOp): void {
  if (isDemoMachine(machine) || current(machine.id).busy) return;
  void run(machine, op);
}

/** The "Keep this machine up to date" switch, stored on that computer. */
export function setAppAutoUpdate(machine: MachineConnectionTarget, enabled: boolean): void {
  if (isDemoMachine(machine)) return;
  const update = current(machine.id);
  if (update.busy) return;
  // The switch moves at once; the answer settles it.
  if (update.status !== null) patch(machine.id, { status: { ...update.status, autoUpdate: enabled } });
  void run(machine, 'setAuto', { enabled });
}

async function run(machine: MachineConnectionTarget, op: AppUpdateOp | 'setAuto', params: unknown = {}): Promise<void> {
  patch(machine.id, { busy: true });
  const method = op === 'setAuto' ? 'appUpdateSetAuto' : METHOD_FOR_OP[op];
  const answer = await request(machine, method, params);
  const follow = (op === 'check' || op === 'install') && 'status' in answer;
  const before = current(machine.id).status;
  // A refused switch goes back to what the computer last said.
  const unchanged =
    op === 'setAuto' && before !== null
      ? { status: { ...before, autoUpdate: !(params as { enabled: boolean }).enabled } }
      : {};
  patch(machine.id, {
    busy: false,
    refreshedAt: Date.now(),
    ...('status' in answer ? { status: answer.status, error: null } : { error: answer.error, ...unchanged }),
    ...(follow ? { following: true } : {}),
  });
  if (follow) void followAppUpdate(machine);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the computer until the check or the install is over. Through the restart the forward is
 * gone and the SSH connection may be too, so a failed read only waits for the next poll.
 */
async function followAppUpdate(machine: MachineConnectionTarget): Promise<void> {
  const started = Date.now();
  try {
    while (Date.now() - started < FOLLOW_LIMIT_MS) {
      await sleep(FOLLOW_POLL_MS);
      const answer = await request(machine, 'appUpdateStatus', {});
      if (!('status' in answer)) continue;
      const phase = text(answer.status.phase) ?? '';
      const pending = answer.status.pendingInstall != null;
      const done = !pending && !['checking', 'downloading', 'installing', 'restarting'].includes(phase);
      patch(machine.id, { status: answer.status, error: null, refreshedAt: Date.now() });
      if (done) return;
    }
  } finally {
    patch(machine.id, { following: false });
  }
}
