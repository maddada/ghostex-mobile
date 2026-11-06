/**
 * Reading the tailcat bridge's path answer (`easyConnectPath.ts`). No React Native imports: `bun test`
 * runs this file directly.
 */

export type EasyConnectPath = {
  path: 'direct' | 'relay';
  route?: 'lan' | 'internet';
  relay: string;
};

/** The bridge's JSON, or null for an empty or unreadable answer. */
export function readEasyConnectPath(text: string): EasyConnectPath | null {
  if (text.length === 0) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.path !== 'direct' && parsed.path !== 'relay') return null;
    const route = parsed.route === 'lan' || parsed.route === 'internet' ? parsed.route : undefined;
    return { path: parsed.path, route, relay: typeof parsed.relay === 'string' ? parsed.relay : '' };
  } catch {
    return null;
  }
}

/** Public relay regions are named by number (`region 903`); ours and custom ones by hostname. */
export function isPublicRelayName(relay: string): boolean {
  return relay.startsWith('region ') || relay.endsWith('.tailcat.dev') || relay.endsWith('.ipn.dev');
}
