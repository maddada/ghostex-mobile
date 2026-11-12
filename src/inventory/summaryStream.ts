/**
 * A computer's pushed sessions list: `/api/events?stream=sessionsList` over the chat link's SSH port
 * forward. While it is live, the inventory reads the list from here instead of running
 * `ghostex sessions --json --mobile-summary` over SSH every 5 s (`client.ts`), and a change reaches the
 * list as soon as gxserver sends it.
 *
 * CDXC:StateSync 2026-11-12 DECISION:
 * The user chose to push the sessions list ("push the sessions list over the existing socket") and to keep the poll for
 * every pairing that cannot: "let's please not break things on older versions at all, so we might need to keep both".
 * The stream opens only when the computer's `ghostex server endpoint` lists `sessionsListStream`; otherwise, and
 * whenever this stream is not live (not open yet, no whole list yet, nothing heard for `STALE_MS`, closed), the SSH
 * poll runs exactly as before. A gxserver without that capability would treat the unknown `stream` as its whole event
 * hub, so it is never opened there.
 * SEE-ALSO: server/src/server/sessions_list_stream.rs, src/inventory/summaryPatch.ts
 */

import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from '../machines/credentials';
import { isCloudBoxMachineId } from '../cloudBoxes/types';
import { isDemoMachine } from '../demo/identity';
import { foldListFrame, type ListState } from './summaryPatch';

export const SESSIONS_LIST_STREAM_CAPABILITY = 'sessionsListStream';

/** `GXSERVER_PROTOCOL_VERSION`, as the chat socket speaks it. */
const PROTOCOL_VERSION = 1;
const PROTOCOL_HEADER = 'x-gxserver-protocol-version';
/** gxserver sends at least an alive frame every 20 s; a stream silent longer than this is not trusted. */
const STALE_MS = 45_000;
/** How long a fresh read waits for its answer on the stream before the caller runs the SSH read instead. */
const FRESH_READ_MS = 4_000;
/** After a stream closed, it is opened again no sooner than this (the SSH poll covers the gap). */
const REOPEN_AFTER_MS = 5_000;

type HeaderWebSocket = new (
  url: string,
  protocols: string | string[] | undefined,
  options: { headers: Record<string, string> },
) => WebSocket;

type Stream = {
  socket: WebSocket | null;
  state: ListState | null;
  /** The whole list as text, the inventory's fingerprint; changes only when the list does. */
  text: string | null;
  heardAt: number;
  pendingReads: Map<string, () => void>;
  closed: boolean;
};

const streams = new Map<string, Stream>();
const closedAt = new Map<string, number>();
let changeListener: ((machineId: string) => void) | null = null;
let readCounter = 0;

/** Called with the machine id whenever its pushed list changed. */
export function onPushedListChanged(listener: (machineId: string) => void): void {
  changeListener = listener;
}

function live(stream: Stream | undefined): stream is Stream & { text: string } {
  return (
    stream !== undefined &&
    !stream.closed &&
    stream.text !== null &&
    stream.socket !== null &&
    Date.now() - stream.heardAt < STALE_MS
  );
}

function close(machineId: string, stream: Stream): void {
  if (stream.closed) return;
  stream.closed = true;
  if (streams.get(machineId) === stream) streams.delete(machineId);
  closedAt.set(machineId, Date.now());
  for (const resolve of stream.pendingReads.values()) resolve();
  stream.pendingReads.clear();
  try {
    stream.socket?.close();
  } catch {
    // Already closed.
  }
}

/**
 * The pushed list's text when the stream is live, else null (and the stream is opened in the background
 * when this computer offers it, for the next read).
 */
export function pushedList(machine: MachineConnectionTarget): string | null {
  const stream = streams.get(machine.id);
  if (live(stream)) return stream.text;
  if (stream !== undefined && stream.socket !== null && stream.text !== null) close(machine.id, stream);
  ensureStream(machine);
  return null;
}

/**
 * Asks gxserver to build the list now and waits for the answer: the list after something the user just did.
 * Null when the stream is not live or did not answer in time, so the caller reads over SSH.
 */
export async function pushedListFresh(machine: MachineConnectionTarget): Promise<string | null> {
  const stream = streams.get(machine.id);
  if (!live(stream)) return pushedList(machine);
  readCounter += 1;
  const requestId = `r${readCounter}`;
  const answered = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      stream.pendingReads.delete(requestId);
      resolve(false);
    }, FRESH_READ_MS);
    stream.pendingReads.set(requestId, () => {
      clearTimeout(timer);
      resolve(true);
    });
    try {
      stream.socket?.send(JSON.stringify({ type: 'readSessionsList', requestId }));
    } catch {
      stream.pendingReads.delete(requestId);
      clearTimeout(timer);
      resolve(false);
    }
  });
  return answered && live(stream) ? stream.text : null;
}

/** Closes every stream: the app left the foreground or the poll stopped. */
export function closePushedLists(): void {
  for (const [machineId, stream] of [...streams.entries()]) close(machineId, stream);
}

/** Closes one computer's stream (removed, re-paired). */
export function closePushedList(machineId: string): void {
  const stream = streams.get(machineId);
  if (stream !== undefined) close(machineId, stream);
}

function ensureStream(machine: MachineConnectionTarget): void {
  if (streams.has(machine.id) || isCloudBoxMachineId(machine.id) || isDemoMachine(machine)) return;
  if (Date.now() - (closedAt.get(machine.id) ?? 0) < REOPEN_AFTER_MS) return;
  const link = chatMachineLink(machine);
  const capabilities = link.capabilities();
  if (capabilities === null) {
    // The handshake (one `ghostex server endpoint`, shared with chats and the notification feed) has not run yet.
    void link.route().catch(() => undefined);
    return;
  }
  if (!capabilities.includes(SESSIONS_LIST_STREAM_CAPABILITY)) return;
  const stream: Stream = { socket: null, state: null, text: null, heardAt: 0, pendingReads: new Map(), closed: false };
  streams.set(machine.id, stream);
  void link
    .gxserverLink()
    .then((gxserver) => {
      if (stream.closed) return;
      if (gxserver === null) {
        close(machine.id, stream);
        return;
      }
      open(machine.id, stream, gxserver.localPort, gxserver.authToken);
    })
    .catch(() => close(machine.id, stream));
}

function open(machineId: string, stream: Stream, localPort: number, authToken: string): void {
  const url = `ws://127.0.0.1:${localPort}/api/events?protocolVersion=${PROTOCOL_VERSION}&stream=sessionsList`;
  // React Native's WebSocket takes headers, so the token never travels in the URL.
  const socket = new (WebSocket as unknown as HeaderWebSocket)(url, undefined, {
    headers: { Authorization: `Bearer ${authToken}`, [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) },
  });
  stream.socket = socket;
  socket.onmessage = (event: WebSocketMessageEvent) => {
    if (stream.closed || typeof event.data !== 'string') return;
    let frame: unknown;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }
    const kind = (frame as { type?: unknown } | null)?.type;
    if (kind === 'serverStopping') {
      close(machineId, stream);
      return;
    }
    const result = foldListFrame(stream.state, frame);
    if (result.kind === 'ignored') return;
    if (result.kind === 'resync') {
      // A missed or unreadable frame: the poll covers the gap and the next read opens a fresh stream.
      close(machineId, stream);
      closedAt.delete(machineId);
      return;
    }
    stream.heardAt = Date.now();
    stream.state = result.state;
    if (result.kind === 'changed') stream.text = JSON.stringify(result.state.summary);
    const requestId = (frame as { requestId?: unknown }).requestId;
    if (typeof requestId === 'string') {
      const resolve = stream.pendingReads.get(requestId);
      stream.pendingReads.delete(requestId);
      resolve?.();
    }
    if (result.kind === 'changed') changeListener?.(machineId);
  };
  socket.onerror = () => {
    // `onclose` follows.
  };
  socket.onclose = () => close(machineId, stream);
}
