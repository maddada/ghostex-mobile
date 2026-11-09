/**
 * The live announcement of feed changes: `/api/events?stream=notifications`, a socket
 * that passes only `notificationFeedChanged`, `serverStarted` and `serverStopping`. The announcement
 * carries no rows; the phone reads the feed again (`api.rs`: `/api/readNotificationFeed` stays the one
 * projection).
 *
 * Opened only when the computer's `ghostex server endpoint` lists the capability `notificationStream`:
 * a gxserver without that capability treats any `stream` other than `sessionChat` as the whole unfiltered event hub
 * (`server/src/server/ws.rs` at 86b287b1), which would pour every presentation change and chat frame
 * through the SSH forward. Without it the phone polls the feed (`eventSource.ts`).
 */

import type { GxserverLink } from '../chat/rust/machine-link';

export const NOTIFICATION_STREAM_CAPABILITY = 'notificationStream';

/** `GXSERVER_PROTOCOL_VERSION`, as the chat socket speaks it. */
const PROTOCOL_VERSION = 1;
const PROTOCOL_HEADER = 'x-gxserver-protocol-version';

/** React Native's WebSocket constructor, whose third argument the DOM typings do not know. */
type HeaderWebSocket = new (
  url: string,
  protocols: string | string[] | undefined,
  options: { headers: Record<string, string> },
) => WebSocket;

/**
 * Opens the stream; `onChanged` on each feed change, `onClosed` once when it ends, `onStopping` when the
 * computer's gxserver says it is stopping (a restart or an update). Returns a close function.
 */
export function openFeedStream(
  link: GxserverLink,
  onChanged: () => void,
  onClosed: () => void,
  onStopping?: () => void,
): () => void {
  const url = `ws://127.0.0.1:${link.localPort}/api/events?protocolVersion=${PROTOCOL_VERSION}&stream=notifications`;
  // React Native's WebSocket takes headers, so the token never travels in the URL. The cast holds: React
  // Native's global WebSocket constructor accepts that third options argument, which the DOM typings lack.
  const socket = new (WebSocket as unknown as HeaderWebSocket)(url, undefined, {
    headers: { Authorization: `Bearer ${link.authToken}`, [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) },
  });
  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    onClosed();
  };
  socket.onmessage = (event: WebSocketMessageEvent) => {
    if (typeof event.data !== 'string') return;
    try {
      const frame = JSON.parse(event.data) as { type?: unknown } | null;
      // A restarted gxserver may have written rows while it came up; read the feed again then too.
      if (frame?.type === 'notificationFeedChanged' || frame?.type === 'serverStarted') onChanged();
      else if (frame?.type === 'serverStopping') onStopping?.();
    } catch {
      // Not a frame of this stream.
    }
  };
  socket.onerror = () => {
    // `onclose` follows and does the work.
  };
  socket.onclose = finish;
  return () => {
    finish();
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  };
}
