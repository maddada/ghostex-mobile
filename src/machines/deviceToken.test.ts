/** Run with `bun test src`. When a pairing v2 device token is renewed with the device key. */

import { describe, expect, test } from 'bun:test';

import { DEVICE_TOKEN_RENEW_BEFORE_MS, deviceTokenNeedsRenewal } from './deviceTokenModel';

describe('device token renewal', () => {
  test('renews in its last week, and a lapsed token too; an older token without expiry is left alone', () => {
    const now = 1_800_000_000_000;
    expect(deviceTokenNeedsRenewal(now + 30 * 24 * 3600_000, now)).toBe(false);
    expect(deviceTokenNeedsRenewal(now + DEVICE_TOKEN_RENEW_BEFORE_MS - 1, now)).toBe(true);
    expect(deviceTokenNeedsRenewal(now - 1, now)).toBe(true);
    expect(deviceTokenNeedsRenewal(null, now)).toBe(false);
  });
});
