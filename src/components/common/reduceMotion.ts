/**
 * The system's Reduce Motion setting, in one place: readable from React (`useReduceMotion`) and from
 * non-React code (`isReduceMotionOn`, e.g. the keyboard store that requests the app-wide
 * `LayoutAnimation`). It follows `AccessibilityInfo.isReduceMotionEnabled()` and `reduceMotionChanged`
 * while at least one subscriber is mounted; the last one leaving stops following. The value last read
 * stays until the next subscriber's fresh read replaces it, so a screen that remounts never sees the
 * setting off for a moment while it is on. Until the very first read resolves the value is false.
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

/** The setting as last read; kept up to date while someone is subscribed. */
export function isReduceMotionOn(): boolean {
  return value;
}

/** The system's Reduce Motion setting, followed while mounted. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribeReduceMotion, isReduceMotionOn, isReduceMotionOn);
}
