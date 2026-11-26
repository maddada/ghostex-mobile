/**
 * Remote screen: this computer's screen on the phone, through its gxserver (`/api/remoteScreenStart`
 * starts the computer's screen helper and answers a viewer path holding a fresh ticket).
 *
 * CDXC:RemoteScreen 2026-11-26 DECISION: the user chose a remote screen built on voxl, kept behind
 * an off-by-default setting (Q5110 to Q5115). The switch is the computer's own `remoteScreenEnabled`:
 * the phone shows Open screen only when that computer advertises `remoteScreen` and
 * `/api/remoteScreenStatus` says it is on, so there is one switch, never a second one on the phone.
 *
 * CDXC:RemoteScreen 2026-11-26 WHY: the phone asks for about 1080p (`maxPixels`). A 4K PC otherwise
 * streams 3840x2160 H.264 (level 5.2), which a phone decodes slowly or not at all; the computer's
 * helper scales its picture down and maps touches back to the full screen.
 */
import { useEffect, useState } from 'react';

import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from '../machines/credentials';

/** gxserver's capability for the remote screen calls. */
export const REMOTE_SCREEN_CAPABILITY = 'remoteScreen';
/** About 1080p: a 16:9 screen streams 1920x1080, other shapes the same number of pixels. */
export const PHONE_MAX_PIXELS = 1920 * 1080;
const STATUS_TIMEOUT_MS = 15_000;
/** Starting the helper waits up to 15 s on the computer for its first frame. */
const START_TIMEOUT_MS = 30_000;

export type RemoteScreenStart = { kind: 'ready'; uri: string } | { kind: 'failed'; code: string; message: string };

/** Whether this computer has the remote screen switched on (false while unknown or unreachable). */
export async function readRemoteScreenEnabled(machine: MachineConnectionTarget): Promise<boolean> {
  const link = chatMachineLink(machine);
  if ((await link.route()) !== 'socket') return false;
  if (link.capabilities()?.includes(REMOTE_SCREEN_CAPABILITY) !== true) return false;
  const answer = await link.rpc('remoteScreenStatus', {}, STATUS_TIMEOUT_MS);
  if (answer.error !== null) return false;
  return (answer.result as { enabled?: unknown } | null)?.enabled === true;
}

/** `readRemoteScreenEnabled` for a page: false until it answers. */
export function useRemoteScreenEnabled(machine: MachineConnectionTarget | null): boolean {
  const [enabled, setEnabled] = useState(false);
  const machineId = machine?.id ?? null;
  useEffect(() => {
    if (machine === null) return;
    let live = true;
    void readRemoteScreenEnabled(machine).then((value) => {
      if (live) setEnabled(value);
    });
    return () => {
      live = false;
    };
    // The machine record changes identity on every store write; its id is what matters here.
  }, [machineId]);
  return enabled;
}

/** Starts (or joins) the computer's screen at phone size and answers the viewer's address on this phone. */
export async function startRemoteScreen(machine: MachineConnectionTarget): Promise<RemoteScreenStart> {
  const link = chatMachineLink(machine);
  const gxserver = await link.gxserverLink();
  if (gxserver === null) return { kind: 'failed', code: 'unreachable', message: '' };
  const answer = await link.rpc('remoteScreenStart', { maxPixels: PHONE_MAX_PIXELS }, START_TIMEOUT_MS);
  if (answer.error !== null) {
    return { kind: 'failed', code: answer.error.code ?? 'failed', message: answer.error.message };
  }
  const path = (answer.result as { path?: unknown } | null)?.path;
  if (typeof path !== 'string' || !path.startsWith('/api/remoteScreen/')) {
    return { kind: 'failed', code: 'badAnswer', message: '' };
  }
  return { kind: 'ready', uri: `http://127.0.0.1:${gxserver.localPort}${path}` };
}

/** Ends the computer's screen session; the stream stops for every viewer. */
export async function stopRemoteScreen(machine: MachineConnectionTarget): Promise<void> {
  await chatMachineLink(machine).rpc('remoteScreenStop', {}, STATUS_TIMEOUT_MS);
}
