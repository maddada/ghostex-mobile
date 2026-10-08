/**
 * The phone's warm chat connection to one computer: one `/api/events?stream=sessionChat` socket for
 * every open chat on it, and each chat request as a direct `POST /api/<method>`, both through the
 * SSH port forward to that computer's gxserver. It is the TypeScript twin of
 * `packages/gx-chat-client` (socket, followers, reconnect ladder) plus the desktop chat's
 * `native_chat/rpc.rs` (one call, one envelope); the chat rules stay in gx-chat-core, which folds
 * these frames exactly as it folds the desktop's.
 *
 * CDXC:Mobile 2026-10-08 DECISION:
 * User picked "Phone: one warm connection" from the chat-open report: each chat request was its
 * own SSH exec + login shell + `ghostex` CLI + HTTP call, with only 3 SSH command slots per
 * computer. Hard rule: "pls dont break things for users who set default to terminal at all". So
 * chat traffic (reads, the live stream, sends, prompt answers) rides one socket and plain HTTP over
 * the port forward the GPUI transcript already uses, which leaves the SSH command slots to
 * inventory and terminals; the terminal attach path is untouched. Old computers keep the exec path
 * (`transport.ts`): the handshake is `ghostex server endpoint` (missing verb or another wire
 * protocol means old) plus the forward's own probe (an sshd that refuses forwarding), decided
 * before any chat request is sent, never by a request failing first.
 *
 * The socket lives in JavaScript rather than in the phone library's Rust (`gx-chat-client` behind
 * UniFFI) because it is transport, not a chat rule: React Native's WebSocket and fetch reach the
 * loopback forward directly, and a Rust socket would need a thread calling back into JS through new
 * Kotlin and Swift event plumbing plus an HTTP client, and a native rebuild for every change.
 * SEE-ALSO: packages/gx-chat-client/src/wire.rs, apps/desktop/src/app/native_chat/rpc.rs,
 * server/src/server/ws.rs (`handle_events`), apps/mobile/app/src/chat/gpui/endpoint.ts
 */

import { AppState, type AppStateStatus } from 'react-native';

import { GhostexNative } from '../../../modules/ghostex-native/src';
import { ensureConnected } from '../../inventory/client';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { readServerEndpoint } from '../gpui/endpoint';
import type { RpcAnswer } from './transport';

/** `GXSERVER_PROTOCOL_VERSION`: the only wire this client speaks. */
const PROTOCOL_VERSION = 1;
const PROTOCOL_HEADER = 'x-gxserver-protocol-version';
/** `RECONNECT_DELAYS_MS` in `packages/gx-chat-client/src/wire.rs`; the last step repeats. */
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000];
/** Opens that failed in a row before the endpoint is asked for again (port or token may have moved). */
const FAILED_OPENS_BEFORE_RECHECK = 3;
/** How long an older Ghostex is taken at its word before the handshake runs again (it may update). */
const LEGACY_RECHECK_MS = 10 * 60_000;
/** How long "Ghostex is not answering" is kept before the handshake runs again. */
const UNAVAILABLE_RECHECK_MS = 5_000;
/** The socket stays open this long after its last chat closes, so the next chat reuses it. */
const IDLE_CLOSE_MS = 30_000;
/** The four chat frame types a chat-only stream carries (`FRAME_TYPES` in `wire.rs`). */
const FRAME_TYPES = new Set(['sessionChatSnapshot', 'sessionChatReplaced', 'sessionChatAppended', 'sessionChatState']);

/**
 * How this computer's chat traffic travels: `socket` (the warm link), `legacy` (an older Ghostex, or
 * an sshd that refuses forwarding: one SSH exec per request), or `unavailable` (the handshake could
 * not finish, usually because Ghostex is not running; requests use exec until it is asked again).
 */
export type ChatRoute = 'socket' | 'legacy' | 'unavailable';

type Endpoint = { port: number; authToken: string };

type LinkState =
  | { kind: 'unknown' }
  | { kind: 'probing'; done: Promise<ChatRoute> }
  | { kind: 'socket'; endpoint: Endpoint }
  | { kind: 'legacy' | 'unavailable'; until: number };

/** React Native's WebSocket constructor, whose third argument the DOM typings do not know. */
type HeaderWebSocket = new (
  url: string,
  protocols: string | string[] | undefined,
  options: { headers: Record<string, string> }
) => WebSocket;

/** One conversation the socket follows. */
type Follower = {
  projectId: string;
  sessionId: string;
  limit: number;
  onFrame(frame: Record<string, unknown>): void;
};

function followerKey(projectId: string, sessionId: string): string {
  return JSON.stringify([projectId, sessionId]);
}

function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function foreground(): boolean {
  return AppState.currentState !== 'background';
}

class ChatMachineLink {
  private state: LinkState = { kind: 'unknown' };
  /** The route the last handshake settled on, so listeners hear only real changes. */
  private lastRoute: ChatRoute | null = null;
  private readonly routeListeners = new Set<(route: ChatRoute) => void>();
  private readonly followers = new Map<string, Follower>();
  private socket: WebSocket | null = null;
  private socketOpen = false;
  /** Bumped for every socket, so a late callback of a replaced one does nothing. */
  private socketGeneration = 0;
  private connecting = false;
  private failedOpens = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private machine: MachineConnectionTarget) {
    AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') this.reconnectNow();
    });
    GhostexNative.addListener('onConnectionState', (event) => {
      if (event.machineId === this.machine.id && event.state === 'connected') this.reconnectNow();
    });
  }

  /** The newest connection target for this computer (credentials can change while the app runs). */
  retarget(machine: MachineConnectionTarget): void {
    this.machine = machine;
  }

  /** The route already known, or `null` when the handshake has to run (again). */
  current(): ChatRoute | null {
    const state = this.state;
    if (state.kind === 'socket') return 'socket';
    if ((state.kind === 'legacy' || state.kind === 'unavailable') && Date.now() < state.until) return state.kind;
    return null;
  }

  /** The route for the next request, running the handshake when nothing current is known. */
  route(): Promise<ChatRoute> {
    const known = this.current();
    if (known !== null) return Promise.resolve(known);
    if (this.state.kind === 'probing') return this.state.done;
    const done = this.handshake().then((outcome) => {
      const previous = this.lastRoute;
      this.lastRoute = outcome.route;
      this.state =
        outcome.route === 'socket'
          ? { kind: 'socket', endpoint: outcome.endpoint }
          : {
              kind: outcome.route,
              until: Date.now() + (outcome.route === 'legacy' ? LEGACY_RECHECK_MS : UNAVAILABLE_RECHECK_MS),
            };
      if (outcome.route !== previous) for (const listener of this.routeListeners) listener(outcome.route);
      if (outcome.route === 'socket') this.ensureSocket();
      return outcome.route;
    });
    this.state = { kind: 'probing', done };
    return done;
  }

  /** Called with each new route once the handshake settles on a different one. */
  onRouteChange(listener: (route: ChatRoute) => void): () => void {
    this.routeListeners.add(listener);
    return () => this.routeListeners.delete(listener);
  }

  // ---- the handshake -----------------------------------------------------------------------------

  private async handshake(): Promise<{ route: 'socket'; endpoint: Endpoint } | { route: 'legacy' | 'unavailable' }> {
    try {
      const answer = await readServerEndpoint(this.machine);
      if (answer.kind === 'unsupported') return { route: 'legacy' };
      if (answer.kind === 'failed') return { route: 'unavailable' };
      // A computer on another wire protocol keeps the exec path, whose CLI speaks its own daemon's.
      if (answer.protocolVersion !== PROTOCOL_VERSION) return { route: 'legacy' };
      await GhostexNative.startPortForward(this.machine.id, answer.port);
      return { route: 'socket', endpoint: { port: answer.port, authToken: answer.authToken } };
    } catch (error) {
      // An sshd with `AllowTcpForwarding no` will never carry the link; anything else may pass.
      return { route: errorCode(error) === 'E_FORWARDING_PROHIBITED' ? 'legacy' : 'unavailable' };
    }
  }

  /** Forgets the endpoint so the next request or reconnect asks the computer again. */
  private recheck(): void {
    if (this.state.kind === 'socket') this.state = { kind: 'unknown' };
  }

  /**
   * The phone's loopback port for this computer's gxserver. Both calls are cheap when the SSH
   * connection and the forward are alive; after a reconnect (which closes every forward) they
   * dial and forward again.
   */
  private async forward(endpoint: Endpoint): Promise<number> {
    await ensureConnected(this.machine);
    try {
      const { localPort } = await GhostexNative.startPortForward(this.machine.id, endpoint.port);
      return localPort;
    } catch (error) {
      // Nothing listens on the old port: gxserver is down or moved.
      if (errorCode(error) === 'E_PORT_NOT_LISTENING') this.recheck();
      throw error;
    }
  }

  // ---- requests ----------------------------------------------------------------------------------

  /**
   * One chat request over the forward, answered in the core's terms like `native_chat/rpc.rs`.
   * Never throws. A request that could not be delivered answers `unreachable`, which is what the
   * exec path answers for a failed SSH command, so the core's retry rules are the same for both.
   */
  async rpc(method: string, params: unknown, timeoutMs: number): Promise<RpcAnswer> {
    const endpoint = `/api/${method}`;
    const state = this.state;
    if (state.kind !== 'socket') {
      return { error: { code: 'unreachable', message: 'The computer is not connected.', endpoint } };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const localPort = await this.forward(state.endpoint);
      const response = await fetch(`http://127.0.0.1:${localPort}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.endpoint.authToken}`,
          'Content-Type': 'application/json',
          [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
        },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, params: params ?? {} }),
        signal: controller.signal,
      });
      const text = await response.text();
      // A refused token means gxserver issued a new one; the next request asks for it.
      if (response.status === 401) this.recheck();
      let envelope: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === 'object' && parsed !== null) envelope = parsed as Record<string, unknown>;
      } catch {
        // Answered below.
      }
      if (envelope === null) return { error: { code: null, message: 'gxserver returned invalid JSON.', endpoint } };
      if (envelope.ok === false) {
        return {
          error: {
            code: typeof envelope.error === 'string' ? envelope.error : null,
            message: typeof envelope.message === 'string' ? envelope.message : 'Request failed.',
            endpoint,
          },
        };
      }
      if (!response.ok || envelope.ok !== true) {
        return { error: { code: null, message: `gxserver request failed with HTTP ${response.status}.`, endpoint } };
      }
      return { result: envelope.result ?? null, error: null };
    } catch (error) {
      return {
        error: {
          code: 'unreachable',
          message: controller.signal.aborted ? 'The computer did not answer the chat request in time.' : errorMessage(error),
          endpoint,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- the socket --------------------------------------------------------------------------------

  /**
   * Follows a conversation with at least `limit` messages. The first follow subscribes it on the
   * wire; a repeat only records the wider window for the next (re)subscribe, `ChatStreams::follow`'s
   * rule.
   */
  follow(projectId: string, sessionId: string, limit: number, onFrame: (frame: Record<string, unknown>) => void): void {
    const key = followerKey(projectId, sessionId);
    const existing = this.followers.get(key);
    if (existing !== undefined) {
      existing.limit = Math.max(existing.limit, limit);
      existing.onFrame = onFrame;
      return;
    }
    this.followers.set(key, { projectId, sessionId, limit, onFrame });
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.socketOpen) this.send(this.subscribeMessage(this.followers.get(key)!));
    else this.ensureSocket();
  }

  /** Subscribes a followed conversation again, which makes gxserver send a fresh snapshot. */
  refresh(projectId: string, sessionId: string): void {
    const follower = this.followers.get(followerKey(projectId, sessionId));
    if (follower !== undefined && this.socketOpen) this.send(this.subscribeMessage(follower));
  }

  /** Stops following a conversation. The socket closes a while after its last follower leaves. */
  unfollow(projectId: string, sessionId: string): void {
    const key = followerKey(projectId, sessionId);
    if (!this.followers.delete(key)) return;
    if (this.socketOpen) this.send(JSON.stringify({ type: 'unsubscribeSessionChat', projectId, sessionId }));
    if (this.followers.size > 0 || this.idleTimer !== null) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.followers.size === 0) this.closeSocket();
    }, IDLE_CLOSE_MS);
  }

  private subscribeMessage(follower: Follower): string {
    return JSON.stringify({
      type: 'subscribeSessionChat',
      projectId: follower.projectId,
      sessionId: follower.sessionId,
      limit: follower.limit,
    });
  }

  private send(message: string): void {
    try {
      this.socket?.send(message);
    } catch {
      // A socket that cannot send is closing; its close handler reconnects and resubscribes.
    }
  }

  /** Opens the socket when a chat follows this computer and none is open or opening. */
  private ensureSocket(): void {
    if (this.followers.size === 0 || this.socket !== null || this.connecting || this.retryTimer !== null) return;
    void this.connect();
  }

  /** Back in the foreground, or SSH just reconnected: try at once instead of waiting out the ladder. */
  private reconnectNow(): void {
    if (this.socket !== null || this.connecting || this.followers.size === 0) return;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.failedOpens = 0;
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.connecting || !foreground()) return;
    this.connecting = true;
    try {
      const route = await this.route();
      // A computer that turned out to be old: its followers move to the exec long poll themselves.
      if (route === 'legacy' || this.followers.size === 0) return;
      const state = this.state;
      if (route !== 'socket' || state.kind !== 'socket') {
        this.openFailed();
        return;
      }
      let localPort: number;
      try {
        localPort = await this.forward(state.endpoint);
      } catch {
        this.openFailed();
        return;
      }
      if (this.followers.size === 0) return;
      this.open(localPort, state.endpoint);
    } finally {
      this.connecting = false;
    }
  }

  private open(localPort: number, endpoint: Endpoint): void {
    const generation = ++this.socketGeneration;
    const url = `ws://127.0.0.1:${localPort}/api/events?protocolVersion=${PROTOCOL_VERSION}&stream=sessionChat`;
    // React Native's WebSocket takes headers, so the token never travels in the URL.
    const socket = new (WebSocket as unknown as HeaderWebSocket)(url, undefined, {
      headers: { Authorization: `Bearer ${endpoint.authToken}`, [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) },
    });
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.socketGeneration) return;
      this.socketOpen = true;
      this.failedOpens = 0;
      // gxserver has no replay: every open subscribes every follower, and each answers with a
      // fresh snapshot that replaces whatever a dropped socket lost.
      for (const follower of this.followers.values()) this.send(this.subscribeMessage(follower));
    };
    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (generation !== this.socketGeneration || typeof event.data !== 'string') return;
      this.receive(event.data);
    };
    socket.onerror = () => {
      // `onclose` follows and does the work.
    };
    socket.onclose = () => {
      if (generation !== this.socketGeneration) return;
      const wasOpen = this.socketOpen;
      this.socket = null;
      this.socketOpen = false;
      if (this.followers.size === 0) return;
      if (wasOpen) this.scheduleReconnect();
      else this.openFailed();
    };
  }

  private openFailed(): void {
    this.failedOpens += 1;
    if (this.failedOpens >= FAILED_OPENS_BEFORE_RECHECK) {
      this.failedOpens = 0;
      this.recheck();
    }
    this.scheduleReconnect();
  }

  /** The next ladder step. In the background nothing is scheduled; `active` reconnects at once. */
  private scheduleReconnect(): void {
    if (this.retryTimer !== null || this.followers.size === 0 || !foreground()) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.failedOpens, RECONNECT_DELAYS_MS.length - 1)];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private closeSocket(): void {
    this.socketGeneration += 1;
    const socket = this.socket;
    this.socket = null;
    this.socketOpen = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
  }

  /**
   * Routes one socket message to the chat that follows its conversation: the checks `route` in
   * `wire.rs` makes. The `eventStreamReady` header, model catalog pushes and frames for a
   * conversation unfollowed a moment ago are dropped here.
   */
  private receive(text: string): void {
    let frame: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (
      typeof frame.type !== 'string' ||
      !FRAME_TYPES.has(frame.type) ||
      typeof frame.epoch !== 'number' ||
      typeof frame.seq !== 'number' ||
      typeof frame.serverId !== 'string' ||
      frame.protocolVersion !== PROTOCOL_VERSION ||
      typeof frame.projectId !== 'string' ||
      typeof frame.sessionId !== 'string'
    ) {
      return;
    }
    this.followers.get(followerKey(frame.projectId, frame.sessionId))?.onFrame(frame);
  }
}

const links = new Map<string, ChatMachineLink>();

/** The one chat link for a computer, created on first use and kept for the life of the app. */
export function chatMachineLink(machine: MachineConnectionTarget): ChatMachineLink {
  let link = links.get(machine.id);
  if (link === undefined) {
    link = new ChatMachineLink(machine);
    links.set(machine.id, link);
  } else {
    link.retarget(machine);
  }
  return link;
}

export type { ChatMachineLink };
