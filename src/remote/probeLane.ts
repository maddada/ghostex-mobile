import { Platform } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';

let cached: boolean | null = null;

/**
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * Whether this Android build runs the connection check in its own native lane and ends a timed-out command alone
 * (`probeLane()`, gx-xgs.12). Without it a fourth exec waits on the native connection's three permits and comes back
 * "still busy" without reaching the computer, which a check reads as a dead connection, so the Android stall checks
 * stay off on builds that lack it (the installed 11.6 apps keep today's behaviour). iPhone: always false, its lane is
 * in JS (src/remote/channelBudget.ts).
 * SEE-ALSO: src/remote/stallWatch.ts (`watching`), src/remote/connection.ts (`probeConnection`).
 */
export function nativeProbeLane(): boolean {
  if (cached === null) {
    const probeLane = GhostexNative.probeLane;
    cached = Platform.OS === 'android' && typeof probeLane === 'function' && probeLane.call(GhostexNative) === true;
  }
  return cached;
}
