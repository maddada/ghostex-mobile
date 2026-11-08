/**
 * Pairing v2 (GitHub #495): this phone's own P-256 device key, in the Secure Enclave (iOS) or the
 * Android Keystore (StrongBox when present). It never leaves the phone; the computer keeps its
 * public half and checks the phone's signed asks against it (pairing status, token renewal).
 * An app build from before 2026-11-08 has no device key, and such a phone can't pair any more.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';

export const DEVICE_KEY_ALGORITHM = 'ecdsaP256Sha256';

export function hasDeviceKey(): boolean {
  return typeof GhostexNative.deviceKeyPublic === 'function' && typeof GhostexNative.deviceKeySign === 'function';
}

/** The public half (65-byte uncompressed point, base64), creating the key on first use. */
export async function deviceKeyPublic(): Promise<string> {
  if (!GhostexNative.deviceKeyPublic) throw new Error('This app build has no device key; update Ghostex.');
  return GhostexNative.deviceKeyPublic();
}

/** Base64 ASN.1 DER signature over `payload` (UTF-8). */
export async function deviceKeySign(payload: string): Promise<string> {
  if (!GhostexNative.deviceKeySign) throw new Error('This app build has no device key; update Ghostex.');
  return GhostexNative.deviceKeySign(payload);
}
