/**
 * The "direct" or "via relay" part of an Easy Connect machine's connection details: what the
 * tailcat bridge last saw of the tunnel's path (`ForwardPath` in apps/mobile/tailcat-bridge/bridge.go).
 *
 * CDXC:RemotePairing 2026-11-06 DECISION:
 * User (Q1491): the phone shows whether its link is direct or relayed in the next store build. The
 * bridge's `tailcatPath` exists only in app builds made after this, so the row reads it only when
 * the function is there: an over-the-air bundle on an older build shows the row as before.
 */

import { useEffect, useState } from 'react';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { readEasyConnectPath, type EasyConnectPath } from './easyConnectPathModel';

export { isPublicRelayName, type EasyConnectPath } from './easyConnectPathModel';

const POLL_MS = 10_000;

/** The tunnel's path while the machine is connected; null when unknown or on an older app build. */
export function useEasyConnectPath(machineId: string, connected: boolean): EasyConnectPath | null {
  const [path, setPath] = useState<EasyConnectPath | null>(null);
  useEffect(() => {
    const read = GhostexNative.tailcatPath;
    if (!connected || typeof read !== 'function') {
      setPath(null);
      return;
    }
    let live = true;
    const poll = (): void => {
      read
        .call(GhostexNative, machineId)
        .then((text) => {
          if (live) setPath(readEasyConnectPath(text));
        })
        .catch(() => {
          if (live) setPath(null);
        });
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [machineId, connected]);
  return path;
}
