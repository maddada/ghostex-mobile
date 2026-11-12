/**
 * The clock Active projects is read at (./activeProjects.ts): it moves when a session's 8 hours run out, so a
 * project leaves the list then, with no new summary needed (gx-core `active_projects_until_ms` on the desktop).
 */

import { useEffect, useMemo, useState } from 'react';

import type { GhostexSession } from '../contract/mobileSummary';
import { nextActiveExpiryMs } from './activeProjects';

export function useActiveProjectsClock(sessions: readonly GhostexSession[], on: boolean): number {
  const [tick, setTick] = useState(Date.now);
  const nowMs = useMemo(() => Date.now(), [sessions, tick]);
  useEffect(() => {
    if (!on) return;
    const next = nextActiveExpiryMs(sessions, nowMs);
    if (next === null) return;
    const timeout = setTimeout(() => setTick(Date.now()), Math.min(Math.max(0, next - Date.now()) + 50, 2_147_483_647));
    return () => clearTimeout(timeout);
  }, [sessions, nowMs, on]);
  return nowMs;
}
