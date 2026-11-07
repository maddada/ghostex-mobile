/** Run with `bun test src/app/networkChanges.test.ts`: which app builds the lifecycle hears network changes from. */
import { describe, expect, test } from 'bun:test';

import { networkChangesHeard } from './networkChanges';

describe('networkChangesHeard', () => {
  test('Android always reports network changes', () => {
    expect(networkChangesHeard('android', {})).toBe(true);
  });

  test('an iOS build without the native event is not listened to', () => {
    expect(networkChangesHeard('ios', {})).toBe(false);
  });

  test('an iOS build that has it is', () => {
    expect(networkChangesHeard('ios', { emitsNetworkChanges: () => true })).toBe(true);
  });

  test('a capability check that throws counts as no event', () => {
    const native = {
      emitsNetworkChanges: (): boolean => {
        throw new Error('gone');
      },
    };
    expect(networkChangesHeard('ios', native)).toBe(false);
  });
});
