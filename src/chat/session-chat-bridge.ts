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

import { File, Paths } from 'expo-file-system';

import { GhostexNative } from '../../modules/ghostex-native/src';
import {
  answerSessionChatPromptCommand,
  interruptSessionChatCommand,
  readSessionChatCommand,
  sendSessionChatMessageCommand,
  type SessionChatReadOptions,
} from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import {
  localPathFromUri,
  remoteAttachmentPathScript,
  sanitizeAttachmentFilename,
} from '../components/terminal/uploads';
import { ensureConnected } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { SESSION_CHAT_SUPPORTED_AGENT_IDS } from './session-chat-agents.generated';

/**
 * Agent icon ids whose sessions have a chat projection. Generated from
 * SESSION_CHAT_SUPPORTED_AGENTS in the main repo's shared/session-chat.ts by
 * `bun run build:mobile-chat` (the shared module itself is outside this
 * submodule's compile scope).
 */
const SESSION_CHAT_AGENT_IDS = new Set(SESSION_CHAT_SUPPORTED_AGENT_IDS);

export function isSessionChatSupportedAgent(agentId: string): boolean {
  return SESSION_CHAT_AGENT_IDS.has(agentId);
}

export type SessionChatBridgeRequest = {
  id: number;
  op: 'read' | 'send' | 'answerPrompt' | 'interrupt' | 'saveImage';
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
/** Exec timeout for staging a machine-side temp path (mirrors uploads.ts). */
const REMOTE_PATH_EXEC_TIMEOUT_MS = 20000;
/** Filename used when the composer pastes bytes without one. */
const PASTED_IMAGE_FALLBACK_NAME = 'pasted-image.png';

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
    record.op !== 'interrupt' &&
    record.op !== 'saveImage'
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
 * Composer image paste. gxserver's saveSessionChatImage endpoint has no CLI
 * verb — base64 bytes on an SSH command line would blow past ARG_MAX — so the
 * bytes take the same route as a terminal attachment: decode into an app cache
 * file, stage a temp path on the machine, SFTP the file there, and hand the
 * absolute remote path back for the transcript's `[Image #N](path)` link. The
 * local copy exists only to give the native uploader a path and is deleted
 * either way.
 */
async function saveChatImage(
  machine: MachineConnectionTarget,
  params: Record<string, unknown>,
): Promise<{ path: string; bytes: number }> {
  const raw = typeof params.base64Data === 'string' ? params.base64Data : '';
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (base64.length === 0) throw new Error('The pasted image carried no data.');
  const suggested = stringParam(params, 'suggestedName') ?? PASTED_IMAGE_FALLBACK_NAME;
  const sanitized = sanitizeAttachmentFilename(suggested);

  const localFile = new File(Paths.cache, `ghostex-chat-${Date.now()}-${sanitized}`);
  try {
    localFile.create({ intermediates: true, overwrite: true });
    localFile.write(base64, { encoding: 'base64' });
    const bytes = localFile.size;

    await ensureConnected(machine);
    const exec = await GhostexNative.exec(
      machine.id,
      remoteAttachmentPathScript(sanitized),
      REMOTE_PATH_EXEC_TIMEOUT_MS,
    );
    const remotePath = exec.stdout.trim().split('\n').pop()?.trim() ?? '';
    if (exec.exitCode !== 0 || remotePath.length === 0) {
      throw new Error(
        exec.stderr.trim().length > 0 ? exec.stderr.trim() : 'Remote path creation failed.',
      );
    }

    await GhostexNative.uploadFile(machine.id, localPathFromUri(localFile.uri), remotePath);
    return { bytes, path: remotePath };
  } finally {
    // Cache-directory scratch file; nothing downstream reads it again.
    localFile.delete();
  }
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
        // Desktop parity: answering a session clears its attention status.
        acknowledgeSessionAttention(machine.id, sessionId);
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
      case 'saveImage': {
        return { id: request.id, ok: true, result: await saveChatImage(machine, params) };
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
