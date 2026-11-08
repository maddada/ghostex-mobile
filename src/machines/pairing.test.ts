/**
 * Run with `bun test src`. Pairing v2 (GitHub #495) against a fake computer: the phone sends its
 * device key, waits as Pending with the three words it worked out itself, asks with signed,
 * ever-newer timestamps, and saves the machine only once the computer says approved; a denied or
 * mismatched pairing saves nothing.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { EasyConnectCode } from './pairingCodes';

const credentials = new Map<string, string>();
const saved: { input: Record<string, unknown> }[] = [];
const signed: string[] = [];
const DEVICE_KEY = 'BDEVICEKEY=';

// Bun's module mocks are process-wide: keep the names other test files' modules read from react-native.
mock.module('react-native', () => ({
  Platform: { OS: 'android', constants: { Brand: 'Google', Model: 'Pixel 8' } },
  Alert: { alert: () => undefined },
}));
mock.module('../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    generateSshKey: () => Promise.resolve({ privateKey: 'PRIVATE', publicKey: 'ssh-ed25519 AAAA phone', fingerprint: 'x' }),
    tailcatClientPublicKey: () => Promise.resolve(`nodekey:${'ab'.repeat(32)}`),
    startTailcatForward: () => Promise.resolve({ localPort: 4242 }),
    stopTailcatForward: () => Promise.resolve(),
    resetHostKey: () => Promise.resolve(),
    deviceKeyPublic: () => Promise.resolve(DEVICE_KEY),
    approverKeyPublic: () => Promise.resolve('BAPPROVER='),
    approverKeySign: () => Promise.reject(new Error('pairing never signs with the approver key')),
    deviceKeySign: (payload: string) => {
      signed.push(payload);
      return Promise.resolve(`sig:${payload}`);
    },
  },
}));
const setter = (kind: string) => (id: string, value: string) => {
  credentials.set(`${id}:${kind}`, value);
  return Promise.resolve();
};
// Every export, so a module another test file loads after this mock still finds its names.
const unused = () => Promise.resolve(null);
mock.module('./credentials', () => ({
  setSessionPassword: unused,
  getSessionPassword: unused,
  clearSessionPassword: unused,
  clearAllSessionPasswords: unused,
  getSavedPassword: unused,
  setSavedPassword: unused,
  deleteSavedPassword: unused,
  getSshKey: unused,
  getPassphrase: unused,
  getPublicKey: unused,
  setTailcatToken: unused,
  getDeviceApiToken: unused,
  getDeviceTokenExpiresAt: unused,
  deleteAllCredentials: unused,
  resolvePassword: unused,
  hasPassword: unused,
  resolveSshConfig: unused,
  getEasyConnectAddresses: () => Promise.resolve(null),
  getTailcatToken: () => Promise.resolve(null),
  setDeviceApiToken: setter('apitoken'),
  setDeviceTokenExpiresAt: setter('apitokenexpires'),
  setEasyConnectAddresses: setter('addresses'),
  setPassphrase: setter('passphrase'),
  setPublicKey: setter('publickey'),
  setSshKey: setter('sshkey'),
}));
mock.module('./computerIdentity', () => ({
  machineForSameComputer: () => null,
  tailcatServerKey: () => null,
  dedupeMachineRecords: (records: unknown[]) => records,
}));
mock.module('./easyConnectDial', () => ({
  saveEasyConnectAddresses: () => Promise.resolve(true),
  easyConnectDialCandidates: () => Promise.resolve([]),
  noteEasyConnectDial: () => undefined,
  refreshEasyConnectAddressesSoon: () => undefined,
}));
mock.module('./store', () => ({
  TAILCAT_TOKEN_PREFIX: 'tc',
  EASY_CONNECT_LABEL: 'Easy Connect',
  machineTransportLabel: () => 'Easy Connect',
  machineDisplayLabel: () => 'Studio',
  isMachineEnabled: () => true,
  enabledMachines: () => [],
  selectedMachine: () => null,
  tailcatSyntheticHost: (id: string) => `tailcat-${id}`,
  useMachinesStore: {
    getState: () => ({
      machines: [],
      addMachine: (input: Record<string, unknown>) => {
        saved.push({ input });
        return Promise.resolve({ ok: true, machine: { id: 'm1', ...input } });
      },
    }),
  },
}));

const { pairEasyConnect } = await import('./pairing');
const { matchWords } = await import('./pairingWords');

const SECRET = 'ZGVmZ2hpamtsbW5vcHFycw';
const code: EasyConnectCode = { v: 1, address: 'tcAAAA', name: 'Studio', user: 'madda', port: 58744, sshPort: 22, secret: SECRET };

type Call = { path: string; params: Record<string, unknown> };

function fakeComputer(answers: (call: Call, index: number) => unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init: { body: string }) => {
    const path = new URL(url).pathname;
    const params = (JSON.parse(init.body) as { params: Record<string, unknown> }).params;
    const call = { path, params };
    calls.push(call);
    const result = answers(call, calls.length - 1);
    return Promise.resolve({ status: 200, json: () => Promise.resolve(result) });
  }) as unknown as typeof fetch;
  return calls;
}

const pending = (words = matchWords(SECRET, DEVICE_KEY)) => ({
  ok: true,
  result: { status: 'pending', pendingId: 'pd_1', words, expiresAtMs: Date.now() + 600_000, user: 'madda', computerName: 'Studio' },
});

beforeEach(() => {
  credentials.clear();
  saved.length = 0;
  signed.length = 0;
});

describe('pairing v2 on the phone', () => {
  test('waits as Pending with matching words and saves the machine once approved', async () => {
    let polls = 0;
    const calls = fakeComputer((call) => {
      if (call.path === '/api/pairDevice') return pending();
      polls += 1;
      return polls < 2
        ? { ok: true, result: { status: 'pending' } }
        : {
            ok: true,
            result: {
              status: 'approved',
              deviceId: 'd1',
              deviceApiToken: 'gxd_token',
              deviceTokenExpiresAtMs: 1_900_000_000_000,
              user: 'madda',
              computerName: 'Studio',
              easyConnectAddresses: [],
            },
          };
    });
    const shown: string[][] = [];
    const result = await pairEasyConnect(code, { onPending: ({ words }) => shown.push(words) });
    expect(result.ok).toBe(true);
    expect(shown).toEqual([matchWords(SECRET, DEVICE_KEY)]);
    expect(calls[0]!.params.deviceKey).toEqual({ algorithm: 'ecdsaP256Sha256', publicKey: DEVICE_KEY });
    // The Face ID / fingerprint key rides along, so approving the pairing enrolls it too.
    expect(calls[0]!.params.approverKey).toEqual({
      algorithm: 'ecdsaP256Sha256',
      publicKey: 'BAPPROVER=',
      presence: 'biometric',
    });
    // Every ask is signed with the device key, over ever-newer timestamps.
    const asks = calls.filter((call) => call.path === '/api/pairingStatus');
    expect(asks.length).toBe(2);
    const stamps = asks.map((ask) => ask.params.timestampMs as number);
    expect(stamps[1]!).toBeGreaterThan(stamps[0]!);
    for (const ask of asks) {
      expect(ask.params.signature).toBe(`sig:ghostex-pairing-status-v1\npd_1\n${ask.params.timestampMs as number}`);
    }
    expect(credentials.get('m1:apitoken')).toBe('gxd_token');
    expect(credentials.get('m1:apitokenexpires')).toBe('1900000000000');
    expect(saved[0]!.input.deviceId).toBe('d1');
  }, 10_000);

  test('a denied phone saves nothing', async () => {
    fakeComputer((call) =>
      call.path === '/api/pairDevice' ? pending() : { ok: true, result: { status: 'denied' } },
    );
    const result = await pairEasyConnect(code);
    expect(result).toMatchObject({ ok: false, reason: 'denied' });
    expect(saved.length).toBe(0);
    expect(credentials.size).toBe(0);
  });

  test('words that differ from the phone’s stop pairing before any ask', async () => {
    const calls = fakeComputer(() => pending(['acorn', 'acorn', 'acorn']));
    const result = await pairEasyConnect(code);
    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    expect(calls.filter((call) => call.path === '/api/pairingStatus').length).toBe(0);
    expect(saved.length).toBe(0);
  });

  test('a computer that asks for a newer app says so', async () => {
    fakeComputer(() => ({ ok: false, error: 'pairingNeedsAppUpdate', message: 'Update Ghostex on this phone.' }));
    expect(await pairEasyConnect(code)).toMatchObject({ ok: false, reason: 'needsUpdate' });
  });
});
