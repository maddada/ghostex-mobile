/** Run with `bun test src/app/securityNotice.test.ts`: who sees the 11.0.1 security notice, and what it says. */
import { describe, expect, mock, test } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({ default: {} }));
mock.module('react-native', () => ({ Alert: { alert: () => undefined } }));

const { machinesToPairAgain, securityNoticeText } = await import('./securityNotice');

describe('machinesToPairAgain', () => {
  test('only Easy Connect computers that are switched on', () => {
    expect(
      machinesToPairAgain([
        { name: 'Studio', transport: 'tailcat' },
        { name: 'Old box', transport: 'tailcat', disabled: true },
        { name: 'Server', transport: 'ssh' },
        { name: 'Laptop' },
      ]),
    ).toEqual(['Studio']);
  });
});

describe('securityNoticeText', () => {
  test('nothing for a phone without Easy Connect computers', () => {
    expect(securityNoticeText([])).toBeNull();
  });

  test('names the computers to pair with again', () => {
    expect(securityNoticeText(['Studio', 'Office'])?.message).toStartWith(
      'Pair this phone again with Studio and Office.',
    );
    expect(securityNoticeText(['A', 'B', 'C', 'D'])?.message).toStartWith(
      'Pair this phone again with A, B and 2 more.',
    );
  });
});
