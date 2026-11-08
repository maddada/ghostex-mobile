/**
 * What the phone's Share sheet (CollabShareMenu.tsx) shows for a read of `/api/collab`, kept apart
 * from React Native so it can be tested: the same stages, rules and words as the desktop's Share
 * popover (apps/desktop/src/app/window/share_popover_view.rs).
 */

export const MODES = [
  { value: 'send', label: 'Send' },
  { value: 'approve', label: 'Ask me' },
  { value: 'view', label: 'View only' },
] as const;

export const LIFETIMES = [
  { value: 'hour', label: '1 hour' },
  { value: 'fourHours', label: '4 hours' },
  { value: 'day', label: '24 hours' },
  { value: 'untilStopped', label: 'Until I stop it' },
] as const;

export type Viewer = { id: string; name: string; joinedAtMs?: number | null };

export type Share_ = {
  shareId: string;
  projectId: string;
  sessionId: string;
  mode: string;
  expiresAtMs: number | null;
  viewers: Viewer[];
  held?: number;
  waitingViewerIds?: string[];
};

export type Component = {
  phase?: string;
  doneBytes?: number | null;
  totalBytes?: number | null;
  canInstall?: boolean;
  statusError?: string | null;
};

/** Installed and running: `config`, `shares`, …; otherwise `installed` and `component`. */
export type View_ = {
  installed?: boolean;
  running?: boolean;
  component?: Component;
  config?: { mode: string; expiry?: string };
  relayConnected?: boolean;
  guestPage?: { message?: string | null };
  shares?: Share_[];
};

export type Stage =
  | { kind: 'loading' }
  | { kind: 'notInstalled'; canInstall: boolean }
  | { kind: 'installWaiting' }
  | { kind: 'installing'; fraction: number | null }
  | { kind: 'notRunning'; reason: string }
  | { kind: 'ready' }
  | { kind: 'creating' }
  | { kind: 'live'; share: Share_ }
  | { kind: 'confirmStop'; share: Share_ }
  | { kind: 'ended' };

/** The sheet's state for a read of `/api/collab` (the same rules as the desktop's `stage_from_read`). */
export function stageOf(
  view: View_ | null,
  projectId: string,
  sessionId: string,
  flags: { confirmStop: boolean; justStopped: boolean; waiting: 'install' | 'create' | 'other' | null },
): Stage {
  if (view === null) return { kind: 'loading' };
  if (view.installed !== true) {
    const component = view.component ?? {};
    if (component.phase === 'downloading') {
      const total = component.totalBytes ?? 0;
      return { kind: 'installing', fraction: total > 0 ? (component.doneBytes ?? 0) / total : 0 };
    }
    if (component.phase === 'installing') return { kind: 'installing', fraction: null };
    if (flags.waiting === 'install') return { kind: 'installWaiting' };
    return { kind: 'notInstalled', canInstall: component.canInstall !== false };
  }
  if (view.running === false || view.config === undefined) {
    return { kind: 'notRunning', reason: view.component?.statusError ?? '' };
  }
  const share = (view.shares ?? []).find((entry) => entry.projectId === projectId && entry.sessionId === sessionId);
  if (share === undefined) {
    if (flags.waiting === 'create') return { kind: 'creating' };
    return flags.justStopped ? { kind: 'ended' } : { kind: 'ready' };
  }
  return flags.confirmStop ? { kind: 'confirmStop', share } : { kind: 'live', share };
}

/** Who gets disconnected, in words: "Alper and Sam", "Alper, Sam and 2 others". */
export function names(viewers: Viewer[]): string | null {
  const list = viewers.map((viewer) => viewer.name);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  const rest = list.length - 2;
  return `${list[0]}, ${list[1]} and ${rest} other${rest === 1 ? '' : 's'}`;
}

/** The band's second line while the link is live. */
export function liveSubtitle(share: Share_, connected: boolean): string {
  if (!connected) return 'Connecting to the share relay…';
  const waiting = share.held ?? 0;
  if (waiting > 0) return waiting === 1 ? '1 message waits for you' : `${waiting} messages wait for you`;
  const who = share.viewers.length === 0 ? 'Nobody is watching yet' : `${share.viewers.length} watching`;
  if (share.expiresAtMs === null) return `${who} · stays live until you stop it`;
  const at = new Date(share.expiresAtMs);
  return `${who} · ends ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function endsIn(expiresAtMs: number | null, now = Date.now()): string {
  if (expiresAtMs === null) return 'Live until you stop it';
  const minutes = Math.max(0, Math.floor((expiresAtMs - now) / 60_000));
  if (minutes < 1) return 'Ends in under a minute';
  if (minutes < 60) return `Ends in ${minutes} min`;
  return `Ends in ${Math.round(minutes / 60)} h`;
}

export function joined(at: number | null | undefined, now = Date.now()): string {
  if (at == null) return 'Watching';
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return 'Joined just now';
  if (minutes < 60) return `Joined ${minutes} min ago`;
  return `Joined ${Math.floor(minutes / 60)} h ago`;
}

export function modeLine(mode: string): string {
  if (mode === 'send') return 'Messages go straight to the agent. Turning this on asks for your approval.';
  if (mode === 'view') return "Guests watch; they can't write.";
  return 'You approve each message before the agent sees it.';
}
