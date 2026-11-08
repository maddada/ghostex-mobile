/** When a pairing v2 device token is renewed with the device key (`deviceToken.ts`). */

/** Renew once less than this much is left (tokens live 30 days, `DEVICE_API_TOKEN_TTL` in gxserver). */
export const DEVICE_TOKEN_RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether a token that lapses at `expiresAtMs` should be renewed now; a token without one never is. */
export function deviceTokenNeedsRenewal(expiresAtMs: number | null, nowMs: number): boolean {
  return expiresAtMs !== null && expiresAtMs - nowMs < DEVICE_TOKEN_RENEW_BEFORE_MS;
}
