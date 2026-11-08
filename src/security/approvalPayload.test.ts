import { describe, expect, test } from 'bun:test';

import { approvalSigningPayload, type ApprovalRequest } from './approvalPayload';

const request: ApprovalRequest = {
  id: 'apr_1',
  action: 'easyConnectEnable',
  summary: 'Turn on Easy Connect',
  paramsDigest: 'ab'.repeat(32),
  nonce: 'n0nce',
  requestedBy: { kind: 'session', label: 'Fix login' },
  createdAtMs: 1,
  expiresAtMs: 600_001,
  status: 'pending',
};

describe('approvalSigningPayload', () => {
  test('matches the Rust example byte for byte', () => {
    expect(approvalSigningPayload('S90', request)).toBe(
      `ghostex-approval-v1\nS90\napr_1\nn0nce\neasyConnectEnable\n\n${'ab'.repeat(32)}\n600001\napprove`,
    );
  });

  test('refuses line breaks and empty required fields', () => {
    expect(() => approvalSigningPayload('S90', { ...request, target: 'chat\nother' })).toThrow('target');
    expect(() => approvalSigningPayload('', request)).toThrow('serverId');
  });
});
