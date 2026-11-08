/**
 * GitHub #495: this phone's approver key (Secure Enclave on iOS, Android Keystore with
 * StrongBox when present). Every signature asks Face ID, the fingerprint or the screen lock
 * first; the key never leaves the phone. Separate from pairing's device key, which signs
 * without a prompt.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';

export const APPROVER_KEY_ALGORITHM = 'ecdsaP256Sha256';

export function hasApproverKey(): boolean {
  return typeof GhostexNative.approverKeyPublic === 'function' && typeof GhostexNative.approverKeySign === 'function';
}

/** The public half (65-byte uncompressed point, base64), making the key on first use. */
export async function approverKeyPublic(): Promise<string> {
  if (!GhostexNative.approverKeyPublic) throw new Error('This app build can’t approve yet; update Ghostex.');
  return GhostexNative.approverKeyPublic();
}

/** Base64 ASN.1 DER signature over `payload`, after the system prompt shows `reason`. */
export async function approverKeySign(payload: string, reason: string): Promise<string> {
  if (!GhostexNative.approverKeySign) throw new Error('This app build can’t approve yet; update Ghostex.');
  return GhostexNative.approverKeySign(payload, reason);
}
