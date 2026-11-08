import { describe, expect, test } from 'bun:test';

import {
  PAIRING_WORDS,
  deviceTokenRenewPayload,
  matchWords,
  pairingMatchWords,
  pairingStatusPayload,
  pairingWordsInput,
  sameWords,
} from './pairingWords';
import { sha256 } from './sha256';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('sha256', () => {
  test('matches the FIPS 180-4 vectors', () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(hex(sha256(encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(hex(sha256(encode('a'.repeat(1000))))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });
});

describe('pairing words', () => {
  test('the list matches the computer’s, index for index', () => {
    expect(PAIRING_WORDS.length).toBe(256);
    expect(new Set(PAIRING_WORDS).size).toBe(256);
    expect(PAIRING_WORDS[0]).toBe('acorn');
    expect(PAIRING_WORDS[127]).toBe('heron');
    expect(PAIRING_WORDS[255]).toBe('zebra');
    expect(pairingMatchWords(new Uint8Array([10, 220, 255, 1]))).toEqual(['apple', 'rocket', 'zebra']);
  });

  /** The same vector as `match_words_match_the_phone` in server/src/remote_access/pair_device.rs. */
  test('the words for a nonce and key are the computer’s', () => {
    expect(pairingWordsInput('n0nce', 'BAAA')).toBe('ghostex-pairing-words-v1\nn0nce\nBAAA');
    expect(matchWords('ZGVmZ2hpamtsbW5vcHFycw', 'BAAA')).toEqual(['harp', 'cotton', 'saddle']);
    expect(sameWords(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameWords(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  test('the signed payloads are the computer’s bytes', () => {
    expect(pairingStatusPayload('pd_1', 1_700_000_000_000)).toBe('ghostex-pairing-status-v1\npd_1\n1700000000000');
    expect(deviceTokenRenewPayload('abc', 5)).toBe('ghostex-device-token-v1\nabc\n5');
  });
});
