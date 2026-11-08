import { describe, expect, mock, test } from 'bun:test';

mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));
mock.module('../chat/rust/machine-link', () => ({ chatMachineLink: () => ({}) }));
mock.module('../../modules/ghostex-native/src', () => ({ GhostexNative: {} }));

const { approvalIdOf } = await import('./approvals');

describe('approvalIdOf', () => {
  test('reads the request id gxserver names in its approvalRequired message', () => {
    expect(
      approvalIdOf(
        'Waiting for your approval on your computer or phone: Let Phone (ios) approve requests for this computer. Approve it there, then repeat this call with approvalId "apr_QmzpJ-WQJhQEkYD4".',
      ),
    ).toBe('apr_QmzpJ-WQJhQEkYD4');
    expect(approvalIdOf('Only your own computer or phone can do this.')).toBeNull();
  });
});
