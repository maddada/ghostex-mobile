/**
 * The Rust chat core's gxserver transport on the phone: one SSH exec per request, and a
 * `readSessionChat` long poll that stands in for the desktop's chat socket.
 *
 * CDXC:Mobile 2026-09-24 WHY:
 * The core asks for gxserver calls by method and params (`sendRpc`) and folds gxserver chat frames.
 * The phone reaches the computer only through SSH exec and has no streaming channel, so:
 * every `sendRpc` is one `ghostex session-chat-rpc <method> --params-base64 <json>` exec (the verb
 * prints the daemon's own `{ok, result}` or refusal), and the live stream is the same long poll the
 * WebView chat runs (`readSessionChat` with `waitMs` and `fingerprint`), each changed answer handed
 * to the core as a `sessionChatSnapshot` frame. One verb for every method keeps this file a dumb
 * pipe: a method the core adds needs no phone change, only its name in the verb's allowlist.
 * SEE-ALSO: server/src/ghostex_cli/session_chat_rpc.rs, apps/mobile/views/chat/session-chat-main.tsx
 * (`snapshotEventFromRead`, the WebView's long poll)
 *
 * Positions: a read's `(epoch, seq)` is the follower's current position when one exists and
 * `(0, 0)` when none does, so it jumps back to zero whenever the last desktop viewer of the session
 * closes. The core drops a snapshot behind the one it holds on the same `serverId`
 * (`snapshot_is_stale`), so a synthesized frame whose position went backwards starts a new
 * synthetic server generation instead of being dropped for the rest of the session.
 */

import type { MachineConnectionTarget } from '../../machines/credentials';
import { execRemoteCommand } from '../../remote/commands';
import { ensureConnected } from '../../inventory/client';
import type { ChatRpcError } from './events';

/** The gxserver wire protocol the synthesized frames claim (`GXSERVER_PROTOCOL_VERSION`). */
const PROTOCOL_VERSION = 1;
/** How long the daemon holds a long poll before answering unchanged (the WebView's value). */
const LONG_POLL_WAIT_MS = 20_000;
/** Backoff after a failed poll, before the next attempt. */
const POLL_ERROR_RETRY_MS = 3_000;
/**
 * A daemon older than the fingerprint long poll answers at once and without a fingerprint; pacing
 * those iterations is the WebView's hot-loop guard for that version skew.
 */
const NO_FINGERPRINT_POLL_DELAY_MS = 3_000;
/** The desktop chat's own request timeout (`native_chat/rpc.rs`), plus room for the SSH exec. */
const RPC_EXEC_TIMEOUT_MS = 75_000;
/** Room above a long poll's `waitMs` for the SSH exec itself. */
const LONG_POLL_EXEC_MARGIN_MS = 25_000;

/** How one request ended, in the `rpcSettled` event's spelling. */
export type RpcAnswer = { result: unknown; error: null } | { result?: undefined; error: ChatRpcError };

/** UTF-8 bytes of `text` as a binary string, for `btoa`. */
function utf8Binary(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) out += String.fromCharCode(code);
    else if (code < 0x800) out += String.fromCharCode(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      out += String.fromCharCode(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      out += String.fromCharCode(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
  }
  return out;
}

/** The `session-chat-rpc` command line for one request. Base64 so no shell re-quotes the JSON. */
export function sessionChatRpcCommand(method: string, params: unknown): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(method)) throw new Error(`Invalid chat request method: ${method}`);
  return `ghostex session-chat-rpc ${method} --params-base64 ${btoa(utf8Binary(JSON.stringify(params ?? {})))}`;
}

/** The last line of stdout that parses as a JSON object: the verb prints exactly one. */
function lastJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? '';
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // A shell banner line; keep looking.
    }
  }
  return null;
}

/**
 * Performs one gxserver chat request over SSH and answers in the core's terms. Never throws: a
 * transport failure is a refusal too, because a request the core never hears back about keeps its
 * lane in flight for ever.
 */
export async function sessionChatRpc(
  machine: MachineConnectionTarget,
  method: string,
  params: unknown,
  timeoutMs = RPC_EXEC_TIMEOUT_MS
): Promise<RpcAnswer> {
  const endpoint = `/api/${method}`;
  try {
    await ensureConnected(machine);
    const exec = await execRemoteCommand(machine.id, sessionChatRpcCommand(method, params), timeoutMs);
    const outcome = lastJsonLine(exec.stdout);
    if (outcome?.ok === true) return { result: outcome.result ?? null, error: null };
    if (outcome?.ok === false) {
      return {
        error: {
          code: typeof outcome.code === 'string' ? outcome.code : null,
          message: typeof outcome.message === 'string' ? outcome.message : 'Request failed.',
          endpoint: typeof outcome.endpoint === 'string' ? outcome.endpoint : endpoint,
        },
      };
    }
    const detail = `${exec.stderr}`.trim() || `${exec.stdout}`.trim();
    // An older Ghostex has no `session-chat-rpc` verb and prints its usage instead.
    const unknownVerb = /Unknown command: session-chat-rpc/u.test(detail);
    return {
      error: {
        code: unknownVerb ? 'unsupportedClient' : null,
        message: unknownVerb
          ? 'Update Ghostex on this computer to use the new chat engine.'
          : detail.split('\n').slice(-1)[0] || 'The computer did not answer the chat request.',
        endpoint,
      },
    };
  } catch (error) {
    return {
      error: { code: 'unreachable', message: error instanceof Error ? error.message : String(error), endpoint },
    };
  }
}

/** The fields of a `readSessionChat` answer the long poll reads itself. */
type ReadAnswer = { epoch?: unknown; seq?: unknown; fingerprint?: unknown; [key: string]: unknown };

export type LongPollCallbacks = {
  /** A changed read, already shaped as a `sessionChatSnapshot` frame. */
  onFrame(frame: Record<string, unknown>): void;
  /** The poll's own health: `subscribed` on its first answer, `lost` on its first failure,
   * `resubscribed` on the first answer after a failure. */
  onConnection(update: 'subscribed' | 'lost' | 'resubscribed'): void;
};

/**
 * The chat stream: `readSessionChat` long polls, each changed answer emitted as a snapshot frame.
 * One per open chat; `start` answers the core's `subscribe`, `stop` its `unsubscribe`, `restart`
 * its `reconnect`.
 */
export class SessionChatLongPoll {
  private generation = 0;
  private limit = 0;
  private running = false;
  /** Bumped when a read's position went backwards, so the core never reads the frame as stale. */
  private serverGeneration = 1;
  private lastPosition: { epoch: number; seq: number } | null = null;
  private wake: (() => void) | null = null;

  constructor(
    private readonly machine: MachineConnectionTarget,
    private readonly projectId: string,
    private readonly sessionId: string,
    private readonly callbacks: LongPollCallbacks
  ) {}

  /** Starts (or widens) the poll. The window only grows, like the daemon follower's. */
  start(limit: number): void {
    this.limit = Math.max(this.limit, limit);
    if (this.running) return;
    this.running = true;
    void this.loop(++this.generation);
  }

  /** The core's own tail reads carry its window; a poll must never answer with fewer rows. */
  widen(limit: number): void {
    if (limit > this.limit) this.limit = limit;
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.wake?.();
  }

  /** `reconnect`: drop the fingerprint and read at once. */
  restart(): void {
    const limit = this.limit;
    this.stop();
    this.start(limit);
  }

  private sleep(ms: number, generation: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      if (generation !== this.generation) this.wake();
    });
  }

  private async loop(generation: number): Promise<void> {
    let fingerprint: string | undefined;
    let emitted = false;
    let healthy: boolean | null = null;
    while (generation === this.generation) {
      const params: Record<string, unknown> = {
        projectId: this.projectId,
        sessionId: this.sessionId,
        ...(this.limit > 0 ? { limit: this.limit } : {}),
        ...(fingerprint !== undefined ? { fingerprint, waitMs: LONG_POLL_WAIT_MS } : {}),
      };
      const answer = await sessionChatRpc(
        this.machine,
        'readSessionChat',
        params,
        (fingerprint !== undefined ? LONG_POLL_WAIT_MS : 0) + LONG_POLL_EXEC_MARGIN_MS + RPC_EXEC_TIMEOUT_MS
      );
      if (generation !== this.generation) return;
      if (answer.error !== null) {
        if (healthy !== false) this.callbacks.onConnection('lost');
        healthy = false;
        fingerprint = undefined;
        await this.sleep(POLL_ERROR_RETRY_MS, generation);
        continue;
      }
      const read = (answer.result ?? {}) as ReadAnswer;
      if (healthy === null) this.callbacks.onConnection('subscribed');
      else if (healthy === false) this.callbacks.onConnection('resubscribed');
      healthy = true;
      const next = typeof read.fingerprint === 'string' ? read.fingerprint : undefined;
      const changed = next === undefined || next !== fingerprint;
      fingerprint = next;
      if (changed || !emitted) {
        emitted = true;
        this.callbacks.onFrame(this.snapshotFrame(read));
      }
      if (next === undefined) await this.sleep(NO_FINGERPRINT_POLL_DELAY_MS, generation);
    }
  }

  /** `snapshotEventFromRead` in the WebView page, with a position the core can order. */
  private snapshotFrame(read: ReadAnswer): Record<string, unknown> {
    const epoch = typeof read.epoch === 'number' ? read.epoch : 0;
    const seq = typeof read.seq === 'number' ? read.seq : 0;
    const previous = this.lastPosition;
    if (previous !== null && (epoch < previous.epoch || (epoch === previous.epoch && seq < previous.seq))) {
      this.serverGeneration += 1;
    }
    this.lastPosition = { epoch, seq };
    const { fingerprint: _fingerprint, ...rest } = read;
    return {
      ...rest,
      type: 'sessionChatSnapshot',
      projectId: this.projectId,
      sessionId: this.sessionId,
      epoch,
      seq,
      protocolVersion: PROTOCOL_VERSION,
      serverId: `mobile-read:${this.serverGeneration}`,
    };
  }
}
