/**
 * Payload reader for the pairing QR code the desktop app shows in
 * Settings → Remote → Tailcat.
 *
 * That panel (packages/core-ui/settings-modal/tabs/remote-tailcat.tsx in the
 * Ghostex main repo) encodes the pairing address verbatim — it calls the qrcode
 * library with the token string itself, with no URL, scheme, or deep-link
 * wrapper around it. So a scanned payload either *is* a tailcat token or it is
 * some unrelated QR code that must be rejected rather than pasted into the form.
 */

import { TAILCAT_TOKEN_PREFIX } from './store';

/**
 * Returns the token when `payload` is a tailcat pairing address, else null.
 *
 * The accepted shape matches what the machines store validates on save: a
 * non-empty, case-sensitive string starting with "tc". Scanning adds one more
 * check the paste path cannot make — a token is a single opaque word, so any
 * payload carrying whitespace is prose or a URL, not an address.
 */
export function readTailcatQrPayload(payload: string): string | null {
  const token = payload.trim();
  if (token.length <= TAILCAT_TOKEN_PREFIX.length) return null;
  if (!token.startsWith(TAILCAT_TOKEN_PREFIX)) return null;
  if (/\s/u.test(token)) return null;
  return token;
}
