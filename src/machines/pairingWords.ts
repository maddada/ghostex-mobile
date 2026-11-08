/**
 * Pairing v2 (GitHub #495): the three words this phone and the computer both show while the phone
 * waits for approval. The phone works them out itself from the QR's one-time nonce and its own
 * device key, so a computer (or anything between) that shows other words is not the one this phone
 * is pairing with.
 *
 * Port of `packages/gx-protocol/src/pairing.rs`: the same bytes, the same 256 words in the same
 * order; change both together.
 */

import { sha256 } from './sha256';

export const PAIRING_WORDS_DOMAIN = 'ghostex-pairing-words-v1';
export const PAIRING_STATUS_DOMAIN = 'ghostex-pairing-status-v1';
export const DEVICE_TOKEN_RENEW_DOMAIN = 'ghostex-device-token-v1';

/** 256 words, one per byte value. Never reorder or edit: the computer's copy must match. */
export const PAIRING_WORDS: readonly string[] = [
  'acorn', 'actor', 'agent', 'alarm', 'album', 'alley', 'amber', 'anchor', 'angle', 'ankle',
  'apple', 'apron', 'arch', 'arrow', 'aspen', 'atlas', 'attic', 'autumn', 'avocado', 'badge',
  'bagel', 'baker', 'bamboo', 'banana', 'banjo', 'barn', 'basket', 'beach', 'beacon', 'beard',
  'beaver', 'bell', 'berry', 'bicycle', 'bison', 'blanket', 'blossom', 'boat', 'bonfire', 'book',
  'bottle', 'bread', 'brick', 'bridge', 'broom', 'bubble', 'bucket', 'buffalo', 'butter', 'button',
  'cabin', 'cactus', 'camel', 'camera', 'candle', 'canoe', 'canyon', 'carpet', 'carrot', 'castle',
  'cedar', 'cello', 'chair', 'cherry', 'chess', 'chimney', 'circle', 'clock', 'cloud', 'clover',
  'cobalt', 'coconut', 'comet', 'compass', 'copper', 'coral', 'cotton', 'cougar', 'cradle', 'crane',
  'crayon', 'cricket', 'crown', 'cup', 'daisy', 'dancer', 'desert', 'diamond', 'dolphin', 'donkey',
  'dragon', 'drum', 'eagle', 'easel', 'echo', 'elbow', 'elephant', 'elm', 'ember', 'engine',
  'falcon', 'feather', 'fern', 'fiddle', 'field', 'flag', 'flamingo', 'flute', 'forest', 'fossil',
  'fountain', 'fox', 'garden', 'garlic', 'gecko', 'ginger', 'giraffe', 'glacier', 'globe', 'goat',
  'grape', 'guitar', 'hammer', 'harbor', 'harp', 'hazel', 'helmet', 'heron', 'hill', 'honey',
  'horizon', 'hornet', 'igloo', 'iris', 'island', 'ivory', 'jacket', 'jaguar', 'jasmine', 'jelly',
  'jigsaw', 'juniper', 'kayak', 'kettle', 'kitten', 'kiwi', 'koala', 'ladder', 'lagoon', 'lamp',
  'lantern', 'lemon', 'leopard', 'lettuce', 'lily', 'lion', 'lizard', 'lobster', 'locket', 'lotus',
  'magnet', 'mango', 'maple', 'marble', 'meadow', 'melon', 'meteor', 'mirror', 'mitten', 'monkey',
  'moose', 'mosaic', 'muffin', 'mushroom', 'napkin', 'nectar', 'needle', 'nest', 'nutmeg', 'oasis',
  'ocean', 'olive', 'onion', 'orange', 'orbit', 'orchid', 'otter', 'owl', 'oyster', 'paddle',
  'palace', 'panda', 'parrot', 'peach', 'peanut', 'pearl', 'pebble', 'pelican', 'pencil', 'pepper',
  'piano', 'pillow', 'pine', 'planet', 'plum', 'pocket', 'pony', 'poppy', 'potato', 'pumpkin',
  'puzzle', 'quartz', 'quilt', 'rabbit', 'radish', 'rainbow', 'raven', 'ribbon', 'river', 'robin',
  'rocket', 'saddle', 'salmon', 'sapphire', 'scarf', 'seagull', 'shell', 'silver', 'sparrow', 'spider',
  'spoon', 'squirrel', 'star', 'stone', 'sunset', 'swan', 'teapot', 'tiger', 'tomato', 'tractor',
  'trumpet', 'tulip', 'turtle', 'umbrella', 'valley', 'velvet', 'violin', 'volcano', 'wagon', 'walnut',
  'whale', 'willow', 'window', 'wizard', 'yogurt', 'zebra',
];

/** `ghostex-pairing-words-v1\n<nonce>\n<devicePublicKey>`, UTF-8, no trailing newline. */
export function pairingWordsInput(nonce: string, devicePublicKey: string): string {
  return `${PAIRING_WORDS_DOMAIN}\n${nonce}\n${devicePublicKey}`;
}

/** The three words for a digest: its first three bytes, each an index into `PAIRING_WORDS`. */
export function pairingMatchWords(digest: Uint8Array): string[] {
  return Array.from(digest.slice(0, 3), (byte) => PAIRING_WORDS[byte] ?? '');
}

/** The words for the QR's nonce and this phone's device public key (base64, as sent). */
export function matchWords(nonce: string, devicePublicKey: string): string[] {
  return pairingMatchWords(sha256(new TextEncoder().encode(pairingWordsInput(nonce, devicePublicKey))));
}

/** What a pending phone signs to ask for its status. */
export function pairingStatusPayload(pendingId: string, timestampMs: number): string {
  return `${PAIRING_STATUS_DOMAIN}\n${pendingId}\n${Math.trunc(timestampMs)}`;
}

/** What a paired phone signs to renew its device token. */
export function deviceTokenRenewPayload(deviceId: string, timestampMs: number): string {
  return `${DEVICE_TOKEN_RENEW_DOMAIN}\n${deviceId}\n${Math.trunc(timestampMs)}`;
}

/** Whether two word lists are the same words in the same order. */
export function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index]);
}
