import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  addressesNeedRefresh,
  decodeSavedAddresses,
  dialErrorText,
  failedDialParams,
  FAILED_DIAL_REPORT_MAX_AGE_MS,
  easyConnectDialOrder,
  encodeSavedAddresses,
  readEasyConnectAddresses,
  ADDRESS_REFRESH_INTERVAL_MS,
  type SavedEasyConnectAddresses,
} from './easyConnectAddresses';

const OURS = { address: 'tcOURS', relay: 'relay-eu.ghostex.dev', kind: 'ghostex' as const };
const PUBLIC = { address: 'tcPUBLIC', relay: 'tailcat.dev', kind: 'public' as const };
const saved: SavedEasyConnectAddresses = { fetchedAt: 1_000, addresses: [OURS, PUBLIC] };
const never = (): boolean => false;

describe('readEasyConnectAddresses', () => {
  test('keeps the computer order and drops malformed or repeated entries', () => {
    assert.deepEqual(
      readEasyConnectAddresses([
        { ...OURS, reachable: false },
        { address: 'not-an-address', relay: 'x', kind: 'public' },
        { address: 'tcX', relay: '', kind: 'public' },
        { address: 'tcY', relay: 'r', kind: 'other' },
        PUBLIC,
        PUBLIC,
      ]),
      [OURS, PUBLIC],
    );
    assert.deepEqual(readEasyConnectAddresses(null), []);
  });

  test('round-trips through the keychain text', () => {
    assert.deepEqual(decodeSavedAddresses(encodeSavedAddresses(saved)), saved);
    assert.equal(decodeSavedAddresses('{"fetchedAt":1,"addresses":[]}'), null);
    assert.equal(decodeSavedAddresses('garbage'), null);
    assert.equal(decodeSavedAddresses(null), null);
  });
});

describe('easyConnectDialOrder', () => {
  test('dials ours first, then the public relays', () => {
    const order = easyConnectDialOrder({ paired: 'tcPUBLIC', saved, failedRecently: never, relayDown: never });
    assert.deepEqual(
      order.map((candidate) => candidate.address),
      ['tcOURS', 'tcPUBLIC'],
    );
  });

  test('a phone that never fetched the list dials the paired address alone', () => {
    const order = easyConnectDialOrder({ paired: 'tcPUBLIC', saved: null, failedRecently: never, relayDown: never });
    assert.deepEqual(order, [{ address: 'tcPUBLIC', relay: 'paired', kind: 'paired' }]);
  });

  test('a paired address the list no longer names is the last resort', () => {
    const order = easyConnectDialOrder({ paired: 'tcOLDRELAY', saved, failedRecently: never, relayDown: never });
    assert.deepEqual(
      order.map((candidate) => candidate.address),
      ['tcOURS', 'tcPUBLIC', 'tcOLDRELAY'],
    );
  });

  test('a relay that is down, or an address that just failed, waits behind the public one', () => {
    const down = easyConnectDialOrder({
      paired: 'tcPUBLIC',
      saved,
      failedRecently: never,
      relayDown: (relay) => relay === 'relay-eu.ghostex.dev',
    });
    assert.deepEqual(
      down.map((candidate) => candidate.address),
      ['tcPUBLIC', 'tcOURS'],
    );
    const failed = easyConnectDialOrder({
      paired: 'tcPUBLIC',
      saved,
      failedRecently: (address) => address === 'tcOURS',
      relayDown: never,
    });
    assert.deepEqual(
      failed.map((candidate) => candidate.address),
      ['tcPUBLIC', 'tcOURS'],
    );
    // The public relays are never held back by the relay check.
    const publicDown = easyConnectDialOrder({
      paired: 'tcPUBLIC',
      saved,
      failedRecently: never,
      relayDown: () => true,
    });
    assert.deepEqual(
      publicDown.map((candidate) => candidate.address),
      ['tcPUBLIC', 'tcOURS'],
    );
  });

  test('every address stays in the list, even when all of them are held', () => {
    const order = easyConnectDialOrder({
      paired: 'tcPUBLIC',
      saved,
      failedRecently: () => true,
      relayDown: () => true,
    });
    assert.deepEqual(
      order.map((candidate) => candidate.address),
      ['tcOURS', 'tcPUBLIC'],
    );
  });
});

test('the list is asked for again after the refresh interval', () => {
  assert.equal(addressesNeedRefresh(null, 0), true);
  assert.equal(addressesNeedRefresh(saved, saved.fetchedAt + 1), false);
  assert.equal(addressesNeedRefresh(saved, saved.fetchedAt + ADDRESS_REFRESH_INTERVAL_MS), true);
});

describe('failed dial reports', () => {
  const report = {
    relay: 'relay-eu.ghostex.dev',
    kind: 'ghostex' as const,
    elapsedMs: 10_042.4,
    error: 'tailcat could not reach the paired machine. (context deadline exceeded)',
    failedAt: 5_000,
  };

  test('carry the lane, the time it took and the reason', () => {
    assert.deepEqual(failedDialParams(report, 8_000), {
      failedDial: {
        relay: 'relay-eu.ghostex.dev',
        kind: 'ghostex',
        elapsedMs: 10_042,
        secondsAgo: 3,
        error: 'tailcat could not reach the paired machine. (context deadline exceeded)',
      },
    });
  });

  test('are dropped once too old to place next to the computer log', () => {
    assert.equal(failedDialParams(report, 5_000 + FAILED_DIAL_REPORT_MAX_AGE_MS + 1), null);
    assert.equal(failedDialParams(report, 4_000), null);
  });

  test('never carry an address', () => {
    const text = dialErrorText(new Error('dial tcpGFwWCCYxcM1Q0ZlBz4EnDMF-Vu30bAbIUHXRZ failed'));
    assert.equal(text, 'dial [address] failed');
    assert.equal(dialErrorText('x'.repeat(1000)).length, 400);
  });
});
