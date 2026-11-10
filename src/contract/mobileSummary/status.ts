/**
 * Status normalization and displayStatus (spec §7).
 * Part of the mobile summary contract (`./index.ts`).
 */

import type { GhostexSession } from './session';

// ---------------------------------------------------------------------------
// Status normalization + displayStatus (spec §7).
// ---------------------------------------------------------------------------

export function normalizedToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalize a protocol status token: lowercase, `_`/space → `-`, plus alias map
 * needs-attention/attention-required→attention; active/busy/processing→working;
 * sleeping→sleep.
 */
export function normalizeStatusToken(value: string): string {
  const normalized = normalizedToken(value).replace(/[_ ]/g, '-');
  if (normalized === 'needs-attention' || normalized === 'attention-required') return 'attention';
  if (normalized === 'active' || normalized === 'busy' || normalized === 'processing') return 'working';
  if (normalized === 'sleeping') return 'sleep';
  return normalized;
}

function isActionableStatus(value: string): boolean {
  return value === 'attention' || value === 'working' || value === 'done' || value === 'error';
}

export function normalizedNativePaneState(value: string, isSleeping: boolean, activity: string, status: string): string {
  const normalized = normalizedToken(value).replace(/[_ ]/g, '-');
  if (normalized === 'mounted' || normalized === 'mounting' || normalized === 'unmounted') {
    return normalized;
  }
  return defaultNativePaneState(isSleeping, activity, status);
}

function defaultNativePaneState(isSleeping: boolean, activity: string, status: string): string {
  if (isSleeping) return 'unmounted';
  const states = [normalizeStatusToken(activity), normalizeStatusToken(status)];
  if (states.some((s) => s === 'working' || s === 'attention' || s === 'running' || s === 'idle')) {
    return 'mounted';
  }
  return 'unmounted';
}

export function normalizedProviderSessionState(value: string): string {
  const normalized = normalizedToken(value).replace(/[_ ]/g, '-');
  if (
    normalized === 'persistence-disabled' ||
    normalized === 'exists' ||
    normalized === 'missing' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }
  if (
    normalized === 'disabled' ||
    normalized === 'none' ||
    normalized === 'off' ||
    normalized === 'disabled-persistence'
  ) {
    return 'persistence-disabled';
  }
  if (normalized === 'running') return 'exists';
  return 'unknown';
}

export function deriveIsLive(
  nativePaneState: string,
  providerSessionState: string,
  isSleeping: boolean,
  activity: string,
  status: string,
): boolean {
  if (nativePaneState === 'mounted' || nativePaneState === 'mounting' || providerSessionState === 'exists') {
    return true;
  }
  const activityState = normalizeStatusToken(activity);
  const statusState = normalizeStatusToken(status);
  if (
    activityState === 'working' ||
    activityState === 'attention' ||
    statusState === 'working' ||
    statusState === 'attention'
  ) {
    return true;
  }
  if (
    isSleeping ||
    activityState === 'sleep' ||
    statusState === 'sleep' ||
    activityState === 'done' ||
    statusState === 'done' ||
    activityState === 'error' ||
    statusState === 'error' ||
    statusState === 'exited'
  ) {
    return false;
  }
  return activityState === 'running' || statusState === 'running' || activityState === 'idle' || statusState === 'idle';
}

/**
 * displayStatus per spec §7:
 * sleeping&&!live → "sleep"; else first actionable (attention|working|done|error)
 * from normalized activity then status; else !live && sleepish → "sleep"; else
 * first non-empty non-"running" activity/status; else "idle".
 */
export function displayStatus(session: Pick<GhostexSession, 'activity' | 'status' | 'isSleeping' | 'isLive'>): string {
  if (session.isSleeping && !session.isLive) return 'sleep';
  const activityState = normalizeStatusToken(session.activity);
  const statusState = normalizeStatusToken(session.status);
  if (isActionableStatus(activityState)) return activityState;
  if (isActionableStatus(statusState)) return statusState;
  if (!session.isLive && (activityState === 'sleep' || statusState === 'sleep')) return 'sleep';
  if (activityState.length > 0 && activityState !== 'running' && (!session.isLive || activityState !== 'sleep')) {
    return activityState;
  }
  if (statusState.length > 0 && statusState !== 'running' && (!session.isLive || statusState !== 'sleep')) {
    return statusState;
  }
  return 'idle';
}
