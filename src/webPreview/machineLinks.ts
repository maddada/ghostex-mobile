/**
 * Where an address or path a computer's session hands the phone opens.
 *
 * An agent, a terminal or a page on the computer writes addresses and paths that are local to that
 * computer: `http://127.0.0.1:<port>/…`, `localhost`, `*.localhost`, `0.0.0.0`, `[::1]`, absolute
 * paths and `file://` URLs. On the phone each of them would name the phone itself, so every opener
 * classifies through here and reaches the computer over the one SSH session the phone already holds
 * to it (Easy Connect, Tailscale and plain SSH all end in that session):
 *
 * - `computer`: a listener on the computer's loopback, opened in the Web preview through a forward.
 *   The computer's own gxserver (an agent's `ghostex show` page) shares the `127.0.0.1` forward the
 *   chat link uses, so the page's answers and drafts post back to the same gxserver.
 * - `file`: a file on the computer, read over that session by the file viewer.
 * - `web`: an ordinary internet address, which the phone's browser opens as written.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { GXSERVER_FORWARD_HOST, knownGxserverPort, readServerEndpoint } from '../chat/rust/serverEndpoint';
import { remotePathFromFileUrl } from '../docs/openDoc';
import { ensureConnected } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { computerDialHost, isLoopbackHost, parseHttpUrl } from './urls';

/** A listener on the computer's loopback, as a link wrote it. */
export type ComputerAddress = {
  scheme: 'http' | 'https';
  /** Port on the computer. */
  remotePort: number;
  /** The host as written (`localhost`, `127.0.0.1`, `[::1]`, `app.localhost`). */
  host: string;
  /** Path, query and fragment, always starting with `/`. */
  path: string;
};

export type MachineLink =
  | { kind: 'computer'; address: ComputerAddress }
  | { kind: 'file'; path: string; fragment?: string }
  | { kind: 'web'; url: string };

/**
 * What an address or `file://` URL a computer's session produced names.
 *
 * CDXC:RemoteMachines 2026-10-16 DECISION:
 * User: "i want a fix please so it uses the tailscale or the easy connect instead of trying to open 127.0.0.1 when i open inline html in a remote machine ... check other similar issues in the app and fix them please", and for the phone: "also for mobile app please same issue shouldn't happen (mobile app opening something that's local on the remote machine and getting an error for ex or not being able to view it, whether it's a video or image etc)". Every phone opener (chat links and page cards, the transcript menu, terminal links, the file viewer's links and embedded files, quick actions) goes through this classification, the Web preview's own navigation applies the same `isLoopbackHost` rule, every forward opens through `openComputerForward`, and nothing tries the phone's own loopback or file system first.
 * SEE-ALSO: apps/desktop/src/app/helpers/remote/machine_urls.rs (the desktop's routing of the same addresses), server/src/visual_pages/serve.rs (a page's content policy follows the Host it was asked under, which is the phone's forward).
 */
export function classifyMachineLink(url: string): MachineLink {
  const file = remotePathFromFileUrl(url);
  if (file !== null) return { kind: 'file', ...file };
  const parsed = parseHttpUrl(url);
  if (parsed !== null && isLoopbackHost(parsed.host)) {
    return {
      kind: 'computer',
      address: { scheme: parsed.scheme, remotePort: parsed.port, host: parsed.host, path: parsed.pathAndQuery },
    };
  }
  return { kind: 'web', url };
}

/**
 * The pages gxserver serves before its auth gate, which no dev server is expected to share, so a
 * link to one is the computer's gxserver even before this app run has asked for its port.
 */
const GXSERVER_ROUTE = /^\/(?:visual|open-file|project-view-report|ext)\//u;

/** A published page (`ghostex show`): `/visual/<32 hex id>`. */
const VISUAL_PAGE_PATH = /^\/visual\/[0-9a-f]{32}(?=[/?#]|$)/u;

/**
 * The address of a published page (`ghostex show`) on the computer, when `url` names one: the chat
 * opens it in its page sheet (`chat/native/cards/PageSheet.tsx`) rather than the Web preview.
 */
export function visualPageAddress(url: string): ComputerAddress | null {
  const link = classifyMachineLink(url);
  return link.kind === 'computer' && VISUAL_PAGE_PATH.test(link.address.path) ? link.address : null;
}

/**
 * Whether `remotePort` on the computer is its gxserver. A port some handshake already learned
 * decides at once; otherwise the computer is asked only for a path gxserver alone serves, so opening
 * a dev server never waits on an extra SSH exec.
 */
export async function isGxserverAddress(
  machine: MachineConnectionTarget,
  remotePort: number,
  path: string,
): Promise<boolean> {
  const known = knownGxserverPort(machine.id);
  if (known !== null) return known === remotePort;
  if (!GXSERVER_ROUTE.test(path)) return false;
  try {
    const answer = await readServerEndpoint(machine);
    return answer.kind === 'endpoint' && answer.port === remotePort;
  } catch {
    return false;
  }
}

/** One open forward to the computer. */
export type ComputerForward = {
  localPort: number;
  /** gxserver's own forward, which the chat link owns: nothing else ever stops it. */
  gxserver: boolean;
};

/**
 * Opens (or reuses) the phone's forward to an address on the computer. gxserver's port dials
 * `127.0.0.1`, the only address it binds and the forward the chat link already holds (a forward for
 * the same port that dials another host replaces it, under the chat's socket); every other port
 * dials the host the link named.
 */
export async function openComputerForward(
  machine: MachineConnectionTarget,
  address: Pick<ComputerAddress, 'remotePort' | 'host' | 'path'>,
): Promise<ComputerForward> {
  await ensureConnected(machine, { dialNow: true, reason: 'opening a web preview link' });
  const gxserver = await isGxserverAddress(machine, address.remotePort, address.path);
  const host = gxserver ? GXSERVER_FORWARD_HOST : computerDialHost(address.host);
  const { localPort } = await GhostexNative.startPortForward(machine.id, address.remotePort, host);
  return { localPort, gxserver };
}

/** How many screens hold each forward they opened, by machine and computer port. */
const holds = new Map<string, number>();

function holdKey(machineId: string, remotePort: number): string {
  return `${machineId}\u0000${remotePort}`;
}

/** Records that one more screen uses the forward for `remotePort`, until it calls release. */
export function holdComputerForward(machineId: string, remotePort: number): void {
  const key = holdKey(machineId, remotePort);
  holds.set(key, (holds.get(key) ?? 0) + 1);
}

/**
 * Lets go of one {@link holdComputerForward}; the last one closes the forward. gxserver's forward is
 * never closed here, because the chat's socket and requests ride it: the Web preview used to close
 * it when it was left, which dropped the chat's socket under an open chat.
 */
export async function releaseComputerForward(machineId: string, remotePort: number): Promise<void> {
  const key = holdKey(machineId, remotePort);
  const count = holds.get(key) ?? 0;
  if (count > 1) {
    holds.set(key, count - 1);
    return;
  }
  holds.delete(key);
  if (knownGxserverPort(machineId) === remotePort) return;
  await GhostexNative.stopPortForward(machineId, remotePort).catch(() => undefined);
}

/**
 * Every hold on a machine's forwards is void once its SSH connection goes, because the connection
 * closes them all; the next open starts counting again.
 */
GhostexNative.addListener('onConnectionState', (event) => {
  if (event.state !== 'disconnected' && event.state !== 'failed') return;
  for (const key of [...holds.keys()]) {
    if (key.startsWith(`${event.machineId}\u0000`)) holds.delete(key);
  }
});

/** The port the computer's gxserver listens on, from an earlier handshake or by asking once. */
export async function gxserverComputerPort(machine: MachineConnectionTarget): Promise<number> {
  const known = knownGxserverPort(machine.id);
  if (known !== null) return known;
  const answer = await readServerEndpoint(machine);
  if (answer.kind !== 'endpoint') throw new Error(answer.message);
  return answer.port;
}

/**
 * The phone's origin for the computer's gxserver (`http://127.0.0.1:<forward>`), for its pre-auth
 * routes such as a file link (`/open-file/…`). Rides the chat link's forward.
 */
export async function gxserverPhoneOrigin(machine: MachineConnectionTarget): Promise<string> {
  await ensureConnected(machine);
  const port = await gxserverComputerPort(machine);
  const { localPort } = await GhostexNative.startPortForward(machine.id, port, GXSERVER_FORWARD_HOST);
  return `http://127.0.0.1:${localPort}`;
}

/**
 * A published page opened on the phone follows the chat's theme from its first paint, as the
 * desktop's page window does (`#gx-theme=…`, read by the page's bootstrap in
 * server/src/visual_pages/theme.rs, which then drops the fragment). Any other path is unchanged.
 */
export function withPageTheme(path: string, theme: 'light' | 'dark'): string {
  if (!VISUAL_PAGE_PATH.test(path) || /[#&]gx-theme=/u.test(path)) return path;
  return `${path}${path.includes('#') ? '&' : '#'}gx-theme=${theme}`;
}
