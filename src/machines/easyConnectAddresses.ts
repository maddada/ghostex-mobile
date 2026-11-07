/**
 * The Easy Connect addresses a computer gives a paired phone, and the order the phone dials them.
 *
 * CDXC:RemotePairing 2026-11-06 DECISION:
 * User (Q1490 B, approved plan "How Ghostex would point at it, without re-pairing"): a computer serves
 * a second Easy Connect address on Ghostex's own relay beside the first one on Tailscale's public
 * relays. After the phone connects, it fetches both (`/api/easyConnectAddresses`, or the
 * `/api/pairDevice` reply), keeps them in the keychain, and from then on dials ours first and the
 * public one second. The address the phone was paired with stays saved exactly as it was (an older
 * app bundle keeps dialing it) and is always tried last when the list leaves it out. An address
 * that failed recently, or whose relay did not answer the phone's own check, waits behind the
 * others so a down relay costs one timeout, not one per reconnect.
 * SEE-ALSO: server/src/remote_access/easy_connect_addresses.rs, src/machines/easyConnectDial.ts.
 *
 * No React Native imports: `bun test` runs this file directly.
 */

/** Tailcat addresses start with this (`tailcat.Addr`). */
const ADDRESS_PREFIX = 'tc';

export type EasyConnectAddressKind = 'ghostex' | 'custom' | 'public';

export type EasyConnectAddress = {
  address: string;
  /** The relay the address meets on: a hostname, or `tailcat.dev` for the public relays. */
  relay: string;
  kind: EasyConnectAddressKind;
};

/** What the keychain keeps per machine. */
export type SavedEasyConnectAddresses = {
  fetchedAt: number;
  addresses: EasyConnectAddress[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The usable entries of a computer's list, in its order; anything malformed is dropped. */
export function readEasyConnectAddresses(value: unknown): EasyConnectAddress[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const addresses: EasyConnectAddress[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const address = typeof entry.address === 'string' ? entry.address.trim() : '';
    const relay = typeof entry.relay === 'string' ? entry.relay.trim() : '';
    const kind = entry.kind;
    if (!address.startsWith(ADDRESS_PREFIX) || relay.length === 0 || seen.has(address)) continue;
    if (kind !== 'ghostex' && kind !== 'custom' && kind !== 'public') continue;
    seen.add(address);
    addresses.push({ address, relay, kind });
  }
  return addresses;
}

export function encodeSavedAddresses(saved: SavedEasyConnectAddresses): string {
  return JSON.stringify(saved);
}

export function decodeSavedAddresses(text: string | null): SavedEasyConnectAddresses | null {
  if (text === null || text.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || typeof parsed.fetchedAt !== 'number') return null;
    const addresses = readEasyConnectAddresses(parsed.addresses);
    return addresses.length > 0 ? { fetchedAt: parsed.fetchedAt, addresses } : null;
  } catch {
    return null;
  }
}

/** One address to dial, and how the device log names it. */
export type DialCandidate = {
  address: string;
  relay: string;
  kind: EasyConnectAddressKind | 'paired';
};

export type DialOrderInput = {
  /** The address saved at pairing (`tailcattoken`). */
  paired: string | null;
  saved: SavedEasyConnectAddresses | null;
  /** True when the address failed recently; it then waits behind the others. */
  failedRecently: (address: string) => boolean;
  /** True when the phone's own check found the relay down; that address waits too. */
  relayDown: (relay: string) => boolean;
};

/**
 * The addresses to try, best first: the computer's list in its order (ours before the public one),
 * then the paired address when the list does not name it, with recently failed and unreachable
 * ones moved behind the rest. Nothing is ever dropped, so the last resort is still dialed.
 */
export function easyConnectDialOrder(input: DialOrderInput): DialCandidate[] {
  const candidates: DialCandidate[] = (input.saved?.addresses ?? []).map((entry) => ({ ...entry }));
  const paired = input.paired?.trim() ?? '';
  if (paired.length > 0 && !candidates.some((candidate) => candidate.address === paired)) {
    candidates.push({ address: paired, relay: 'paired', kind: 'paired' });
  }
  const held = (candidate: DialCandidate): boolean =>
    input.failedRecently(candidate.address) ||
    (candidate.kind !== 'public' && candidate.kind !== 'paired' && input.relayDown(candidate.relay));
  return [...candidates.filter((candidate) => !held(candidate)), ...candidates.filter(held)];
}

/** How long the list is trusted before the phone asks again after a connect. */
export const ADDRESS_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function addressesNeedRefresh(saved: SavedEasyConnectAddresses | null, now: number): boolean {
  return saved === null || now - saved.fetchedAt >= ADDRESS_REFRESH_INTERVAL_MS;
}

/** The longest error text a dial report carries. */
const DIAL_ERROR_MAX_CHARS = 400;

/** What the phone tells the computer about an address it gave up on (`failedDial`). */
export type FailedDialReport = {
  relay: string;
  kind: DialCandidate['kind'];
  elapsedMs: number;
  error: string;
  /** When the dial failed, by the phone's clock. */
  failedAt: number;
};

/** The text of a dial's failure, with anything that looks like an address replaced. */
export function dialErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  return text.replace(/\btc[A-Za-z0-9_-]{22,}/gu, '[address]').slice(0, DIAL_ERROR_MAX_CHARS);
}

/**
 * The `failedDial` params of the address-list request, or `null` when the report is too old to
 * be worth sending (the computer would not be able to place it next to its own link log).
 *
 * CDXC:RemotePairing 2026-11-08 WHY:
 * On 2026-11-07 the computer's link log showed this phone's hello arrive on the relay lane and the
 * phone on the public lane half a second later, twice, and the reason was only in the phone's own
 * device log. The phone now sends it to the computer it reached the other way, which logs it as
 * `easyConnect.dialFailed` (server/src/remote_access/easy_connect_addresses.rs).
 */
export function failedDialParams(report: FailedDialReport, now: number): Record<string, unknown> | null {
  const ageMs = now - report.failedAt;
  if (ageMs < 0 || ageMs > FAILED_DIAL_REPORT_MAX_AGE_MS) return null;
  return {
    failedDial: {
      relay: report.relay,
      kind: report.kind,
      elapsedMs: Math.max(0, Math.round(report.elapsedMs)),
      secondsAgo: Math.round(ageMs / 1000),
      error: report.error,
    },
  };
}

/** A failure older than this is dropped instead of reported. */
export const FAILED_DIAL_REPORT_MAX_AGE_MS = 10 * 60 * 1000;
