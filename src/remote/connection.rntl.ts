/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The return-to-the-app check of an Easy Connect computer: a probe that got no answer
 * at all drops the stalled tunnel before the new connect, so the bridge builds a fresh one at once instead of
 * re-checking the dead one; a probe that failed at once, or a plain SSH computer, keeps the tunnel.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import type { MachineConnectionTarget } from '../machines/credentials';
import { ensureConnected } from './connection';

jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    isConnected: jest.fn(),
    exec: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
    stopTailcatForward: jest.fn(),
  },
}));
jest.mock('../machines/credentials', () => ({ resolveSshConfig: async () => ({ host: '127.0.0.1', port: 22 }) }));
jest.mock('./commands', () => ({ forgetRemoteEnvironment: () => undefined }));
jest.mock('../cloudBoxes/types', () => ({ isCloudBoxMachineId: () => false }));
jest.mock('../machines/easyConnectDial', () => ({
  easyConnectDialCandidates: async () => [],
  noteEasyConnectDial: () => undefined,
  refreshEasyConnectAddressesSoon: () => undefined,
}));

const native = GhostexNative as unknown as Record<string, jest.Mock>;
const easyConnect: MachineConnectionTarget = { id: 'ec', host: 'mac', username: 'me', port: 22, transport: 'tailcat' };
const plainSsh: MachineConnectionTarget = { id: 'ssh', host: 'mac.local', username: 'me', port: 22 };

beforeEach(() => {
  for (const fn of Object.values(native)) fn.mockReset();
  native.isConnected.mockResolvedValue(true);
  native.disconnect.mockResolvedValue(undefined);
  native.connect.mockResolvedValue(undefined);
  native.stopTailcatForward.mockResolvedValue(undefined);
});

function timedOut(): Error {
  return Object.assign(new Error('Connection timed out'), { code: 'E_TIMEOUT' });
}

test('a live connection that answers is kept as it is', async () => {
  native.exec.mockResolvedValue({ exitCode: 0, stdout: '__GHOSTEX_CONNECTED__\n', stderr: '' });
  await ensureConnected(easyConnect, { verify: true });
  expect(native.disconnect).not.toHaveBeenCalled();
  expect(native.stopTailcatForward).not.toHaveBeenCalled();
  expect(native.connect).not.toHaveBeenCalled();
});

test('an Easy Connect probe with no answer drops the stalled tunnel before it connects again', async () => {
  native.exec.mockRejectedValue(timedOut());
  await ensureConnected(easyConnect, { verify: true });
  expect(native.stopTailcatForward).toHaveBeenCalledWith('ec');
  expect(native.disconnect).toHaveBeenCalledWith('ec');
  expect(native.connect).toHaveBeenCalledTimes(1);
  expect(native.stopTailcatForward.mock.invocationCallOrder[0]).toBeLessThan(
    native.connect.mock.invocationCallOrder[0]!,
  );
});

test('an Easy Connect probe that failed at once keeps the tunnel for the bridge to reuse', async () => {
  native.exec.mockRejectedValue(Object.assign(new Error('channel closed'), { code: 'E_CHANNEL' }));
  await ensureConnected(easyConnect, { verify: true });
  expect(native.stopTailcatForward).not.toHaveBeenCalled();
  expect(native.connect).toHaveBeenCalledTimes(1);
});

test('a plain SSH computer never touches a tunnel', async () => {
  native.exec.mockRejectedValue(timedOut());
  await ensureConnected(plainSsh, { verify: true });
  expect(native.stopTailcatForward).not.toHaveBeenCalled();
  expect(native.connect).toHaveBeenCalledTimes(1);
});
