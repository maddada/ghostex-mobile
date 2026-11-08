/**
 * CDXC:RemotePairing 2026-11-08 DECISION:
 * User (GitHub #495, Q1721): a paired phone's gxserver token is bound to its device key. The
 * computer lets it lapse after 30 days; before then (and whenever it has lapsed) the phone signs a
 * renewal with its device key and gets a fresh token, the old one stopping at once. A token copied
 * off the phone therefore stops working by itself, and only this phone's key can renew it.
 * Renewal runs in the endpoint handshake (`chat/rust/serverEndpoint.ts`), over the forward to the
 * computer's loopback gxserver the chat link uses anyway.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import {
  getDeviceApiToken,
  getDeviceTokenExpiresAt,
  setDeviceApiToken,
  setDeviceTokenExpiresAt,
} from './credentials';
import { deviceKeySign, hasDeviceKey } from './deviceKey';
import { deviceTokenNeedsRenewal } from './deviceTokenModel';
import { deviceTokenRenewPayload } from './pairingWords';
import { useMachinesStore } from './store';

const RENEW_TIMEOUT_MS = 15_000;
/** Mirrors `GXSERVER_PROTOCOL_VERSION` in the gxserver crate. */
const GXSERVER_PROTOCOL_VERSION = 1;

function readExpiry(text: string | null): number | null {
  if (text === null || text.length === 0) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * This machine's device token, renewed first when it is close to lapsing. `port` is the computer's
 * gxserver port, `forwardHost` the address its end of the forward dials. Returns the stored token
 * unchanged when renewal isn't needed or can't run (it then works until it lapses, and the next
 * handshake tries again).
 */
export async function freshDeviceToken(machineId: string, port: number, forwardHost: string): Promise<string | null> {
  const token = await getDeviceApiToken(machineId);
  if (!token) return token;
  const expiresAtMs = readExpiry(await getDeviceTokenExpiresAt(machineId));
  const deviceId = useMachinesStore.getState().machines.find((machine) => machine.id === machineId)?.deviceId;
  if (!deviceTokenNeedsRenewal(expiresAtMs, Date.now()) || !deviceId || !hasDeviceKey()) return token;
  try {
    const { localPort } = await GhostexNative.startPortForward(machineId, port, forwardHost);
    const timestampMs = Date.now();
    const signature = await deviceKeySign(deviceTokenRenewPayload(deviceId, timestampMs));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RENEW_TIMEOUT_MS);
    let body: unknown;
    try {
      const response = await fetch(`http://127.0.0.1:${localPort}/api/renewDeviceToken`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: `renew-${timestampMs.toString(36)}`,
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
          params: { deviceId, timestampMs, signature },
        }),
        signal: controller.signal,
      });
      body = await response.json();
    } finally {
      clearTimeout(timer);
    }
    const result =
      typeof body === 'object' && body !== null && 'result' in body ? (body as { result: unknown }).result : null;
    if (typeof result !== 'object' || result === null) return token;
    const fresh = (result as Record<string, unknown>).deviceApiToken;
    const freshExpiry = (result as Record<string, unknown>).deviceTokenExpiresAtMs;
    if (typeof fresh !== 'string' || typeof freshExpiry !== 'number') return token;
    await Promise.all([setDeviceApiToken(machineId, fresh), setDeviceTokenExpiresAt(machineId, String(freshExpiry))]);
    return fresh;
  } catch {
    return token;
  }
}
