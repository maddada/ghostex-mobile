/**
 * Reading the tailcat bridge's path answer (`easyConnectPath.ts`). No React Native imports: `bun test`
 * runs this file directly.
 */

import { RouteNameCopy } from '../copy';

export type EasyConnectPath = {
  path: 'direct' | 'relay';
  route?: 'lan' | 'internet';
  relay: string;
  /** The bridge's last path check's round trip, when it measured one. */
  latencyMs?: number;
};

/** The bridge's JSON, or null for an empty or unreadable answer. */
export function readEasyConnectPath(text: string): EasyConnectPath | null {
  if (text.length === 0) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.path !== 'direct' && parsed.path !== 'relay') return null;
    const route = parsed.route === 'lan' || parsed.route === 'internet' ? parsed.route : undefined;
    const latencyMs = typeof parsed.latencyMs === 'number' && parsed.latencyMs > 0 ? parsed.latencyMs : undefined;
    return { path: parsed.path, route, relay: typeof parsed.relay === 'string' ? parsed.relay : '', latencyMs };
  } catch {
    return null;
  }
}

/** Public relay regions are named by number (`region 903`); ours and custom ones by hostname. */
export function isPublicRelayName(relay: string): boolean {
  return relay.startsWith('region ') || relay.endsWith('.tailcat.dev') || relay.endsWith('.ipn.dev');
}

/**
 * The short name of the path an Easy Connect link is on: "Private Relay", "Global Relay", "Direct" or "Same network".
 *
 * CDXC:RemotePairing 2026-11-12 DECISION:
 * User: the Europe relay "is called 'Easy Connect Private Relay' and the public one 'Easy Connect Global Relay'",
 * shortened to Private Relay and Global Relay, and used everywhere the phone names the route. Ghostex's own relays (and
 * a relay of the user's own) are the Private Relay; Tailscale's public relay regions are the Global Relay.
 */
export function easyConnectRouteName(path: Pick<EasyConnectPath, 'path' | 'route' | 'relay'>): string {
  if (path.path === 'direct') return path.route === 'lan' ? RouteNameCopy.sameNetwork : RouteNameCopy.direct;
  return isPublicRelayName(path.relay) ? RouteNameCopy.globalRelay : RouteNameCopy.privateRelay;
}
