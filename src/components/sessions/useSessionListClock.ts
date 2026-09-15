import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { newSessionPriorityExpiresAt } from '../../contract/sessionDrafts';
import type { GhostexSession } from '../../contract/mobileSummary';

export function useSessionListClock(sessions: readonly GhostexSession[]): number {
  const [clockTick, setClockTick] = useState(Date.now);
  const nowMs = useMemo(() => Date.now(), [sessions, clockTick]);
  useFocusEffect(useCallback(() => {
    const nextExpiry = sessions.reduce((next, session) => {
      const expiry = newSessionPriorityExpiresAt(session);
      return expiry > nowMs ? Math.min(next, expiry) : next;
    }, Infinity);
    if (!Number.isFinite(nextExpiry)) return;
    const delay = Math.max(0, Math.min(nextExpiry - Date.now(), 2_147_483_647));
    const timeout = setTimeout(() => setClockTick(Date.now()), delay);
    return () => clearTimeout(timeout);
  }, [sessions, nowMs]));
  return nowMs;
}
