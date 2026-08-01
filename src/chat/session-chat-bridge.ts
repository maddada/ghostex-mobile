/**
 * React Native side of the Session Chat webview bridge.
 *
 * The chat page (built from the main repo's mobile-chat/session-chat-main.tsx
 * into src/chat/session-chat-html.generated.ts) posts
 * `{ id, op, params }` requests via window.ReactNativeWebView.postMessage and
 * expects `{ id, ok, result?, error? }` responses delivered through
 * `window.ghostexMobileChatDeliver`. This module maps each op onto the
 * matching `ghostex` Session Chat CLI verb over the machine's SSH channel —
 * the phone has no HTTP path to gxserver, and keeping RN a dumb verb runner
 * leaves all chat behavior (long-poll pacing, frame synthesis, UI) in the
 * shared page code.
 */

import {
  answerSessionChatPromptCommand,
  interruptSessionChatCommand,
  readSessionChatCommand,
  sendSessionChatMessageCommand,
  type SessionChatReadOptions,
} from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import type { MachineConnectionTarget } from '../machines/credentials';

/**
 * Agent icon ids whose sessions have a chat projection (mirror of
 * SESSION_CHAT_SUPPORTED_AGENTS in the main repo's shared/session-chat.ts —
 * the shared module is outside this submodule's compile scope).
 */
const SESSION_CHAT_AGENT_IDS = new Set(['claude', 'openclaude', 'codex', 'grok']);

export function isSessionChatSupportedAgent(agentId: string): boolean {
  return SESSION_CHAT_AGENT_IDS.has(agentId);
}

export type SessionChatBridgeRequest = {
  id: number;
  op: 'read' | 'send' | 'answerPrompt' | 'interrupt';
  params?: Record<string, unknown>;
};

export type SessionChatBridgeResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

/** Exec timeout for non-read ops; sends queue server-side and return fast. */
const SESSION_CHAT_ACTION_TIMEOUT_MS = 20000;
/** Margin above a read's long-poll wait before the SSH exec itself times out. */
const SESSION_CHAT_READ_TIMEOUT_MARGIN_MS = 25000;

export function parseSessionChatBridgeRequest(raw: string): SessionChatBridgeRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== 'number') return null;
  if (
    record.op !== 'read' &&
    record.op !== 'send' &&
    record.op !== 'answerPrompt' &&
    record.op !== 'interrupt'
  ) {
    return null;
  }
  const params =
    typeof record.params === 'object' && record.params !== null && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : {};
  return { id: record.id, op: record.op, params };
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Run one bridge request against a session's machine. Never throws: failures
 * become `{ ok: false, error }` responses the page surfaces in its own UI.
 */
export async function runSessionChatBridgeRequest(
  machine: MachineConnectionTarget,
  projectId: string,
  sessionId: string,
  request: SessionChatBridgeRequest,
): Promise<SessionChatBridgeResponse> {
  const params = request.params ?? {};
  try {
    switch (request.op) {
      case 'read': {
        const options: SessionChatReadOptions = {
          limit: numberParam(params, 'limit'),
          beforeOffset: numberParam(params, 'beforeOffset'),
          waitMs: numberParam(params, 'waitMs'),
          fingerprint: stringParam(params, 'fingerprint'),
        };
        const waitMs = options.waitMs !== undefined && options.fingerprint !== undefined
          ? options.waitMs
          : 0;
        const result = await runGhostexCli(
          machine,
          readSessionChatCommand(sessionId, projectId, options),
          { timeoutMs: waitMs + SESSION_CHAT_READ_TIMEOUT_MARGIN_MS },
        );
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'send': {
        const text = typeof params.text === 'string' ? params.text : '';
        if (text.length === 0) {
          return { id: request.id, ok: false, error: 'Nothing to send.' };
        }
        await runGhostexCli(machine, sendSessionChatMessageCommand(sessionId, projectId, text), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: { queued: true } };
      }
      case 'answerPrompt': {
        await runGhostexCli(
          machine,
          answerSessionChatPromptCommand(sessionId, projectId, params),
          { timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS },
        );
        return { id: request.id, ok: true, result: { queued: true } };
      }
      case 'interrupt': {
        await runGhostexCli(machine, interruptSessionChatCommand(sessionId, projectId), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: { interrupted: true } };
      }
    }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
