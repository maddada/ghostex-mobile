/**
 * The system's Reduce Motion setting, in one place (FL-A11Y-05, FL-STR-03): readable from React
 * (`useReduceMotion`) and from non-React code (`isReduceMotionOn`, e.g. the keyboard store that requests
 * the app-wide `LayoutAnimation`). It follows `AccessibilityInfo.isReduceMotionEnabled()` and
 * `reduceMotionChanged` while at least one subscriber is mounted; the last one leaving stops following
 * (and forgets the value, so the next subscriber reads it afresh). Until the first read resolves the
 * value is false.
 */

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, type EmitterSubscription } from 'react-native';

let value = false;
const listeners = new Set<() => void>();
let following: EmitterSubscription | null = null;
/** Invalidates a read that is still pending when following stops. */
let generation = 0;

function set(next: boolean): void {
  if (next === value) return;
  value = next;
  for (const listener of listeners) listener();
}

function startFollowing(): void {
  const mine = ++generation;
  void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
    if (mine === generation) set(enabled);
  });
  following = AccessibilityInfo.addEventListener('reduceMotionChanged', set);
}

function stopFollowing(): void {
  generation += 1;
  following?.remove();
  following = null;
  value = false;
}

/** Follows the setting for as long as the returned function is not called. */
export function subscribeReduceMotion(listener: () => void): () => void {
  if (listeners.size === 0) startFollowing();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopFollowing();
  };
}

/** The setting as last read; only current while someone is subscribed. */
export function isReduceMotionOn(): boolean {
  return value;
}

/** The system's Reduce Motion setting, followed while mounted. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribeReduceMotion, isReduceMotionOn, isReduceMotionOn);
}
