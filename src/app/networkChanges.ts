/**
 * Whether this app build reports network changes: Android always, iOS from the build that has
 * `emitsNetworkChanges` (an older iOS build declares no such event).
 *
 * CDXC:RemoteMachines 2026-11-07 WHY: an iPhone that moved from Wi-Fi to cellular said nothing, so its
 * stalled Easy Connect tunnel was found only by a timed-out request, 10 to 25 s later (#490).
 */
export function networkChangesHeard(os: string, native: { emitsNetworkChanges?(): boolean }): boolean {
  if (os === 'android') return true;
  if (os !== 'ios' || typeof native.emitsNetworkChanges !== 'function') return false;
  try {
    return native.emitsNetworkChanges() === true;
  } catch {
    return false;
  }
}
