/**
 * React Native side of the Session Chat webview bridge.
 *
 * The chat page (built from the main repo's mobile-chat/session-chat-main.tsx
 * into src/chat/session-chat-html.generated.ts) posts
 * `{ id, op, params }` requests (including the read-only `readSkills` and
 * `readFiles` catalogs)
 * via window.ReactNativeWebView.postMessage and
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
  loginShellCommand,
  readSessionChatCommand,
  readSessionChatFilesCommand,
  readSessionChatSkillsCommand,
  sendSessionChatMessageCommand,
  type SessionChatReadOptions,
} from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import {
  localPathFromUri,
  remoteSessionChatUploadPathScript,
  sanitizeAttachmentFilename,
  sanitizeSessionChatAttachmentName,
  sessionChatImageExtension,
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
  op:
    | 'read'
    | 'readSkills'
    | 'readFiles'
    | 'send'
    | 'sendKey'
    | 'switchToTerminalForAgentPicker'
    | 'answerPrompt'
    | 'interrupt'
    | 'saveImage'
    | 'saveAttachment'
    | 'loadImage';
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
/** Filename used when a non-image attachment arrives without one. */
const ATTACHMENT_FALLBACK_NAME = 'attachment.bin';
/** Overlay-viewer image reads over SSH exec: refuse anything larger. */
const IMAGE_READ_MAX_BYTES = 10 * 1024 * 1024;
/** Exec timeout for base64-ing an image file back over the SSH channel. */
const IMAGE_READ_EXEC_TIMEOUT_MS = 45000;

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
    record.op !== 'readSkills' &&
    record.op !== 'readFiles' &&
    record.op !== 'send' &&
    record.op !== 'sendKey' &&
    record.op !== 'switchToTerminalForAgentPicker' &&
    record.op !== 'answerPrompt' &&
    record.op !== 'interrupt' &&
    record.op !== 'saveImage' &&
    record.op !== 'saveAttachment' &&
    record.op !== 'loadImage'
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
 * Composer image paste and file attach. gxserver's saveSessionChatImage /
 * saveSessionChatAttachment endpoints have no CLI verb — base64 bytes on an
 * SSH command line would blow past ARG_MAX — so the bytes take the terminal
 * attach flow's route instead: decode into an app cache file, stage a path on
 * the machine, SFTP the file there, and hand the absolute remote path back for
 * the transcript's `[Image #N](path)` link. The destination is the one those
 * endpoints would have used (the resolved Ghostex data directory's `i` folder
 * for images and `f` folder for everything else), so a chat attachment names
 * the same durable Ghostex path on the machine no matter which client uploaded
 * it. The local copy exists only to give the native uploader a path and is
 * deleted either way.
 */
async function saveChatUpload(
  machine: MachineConnectionTarget,
  params: Record<string, unknown>,
  kind: 'image' | 'file',
): Promise<{ path: string; bytes: number }> {
  const raw = typeof params.base64Data === 'string' ? params.base64Data : '';
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (base64.length === 0) throw new Error('The attachment carried no data.');
  const suggestedName = stringParam(params, 'suggestedName');
  const sanitized = sanitizeAttachmentFilename(
    suggestedName ?? (kind === 'image' ? PASTED_IMAGE_FALLBACK_NAME : ATTACHMENT_FALLBACK_NAME),
  );
  // Epoch base name, like the server's; the phone's clock only has to make the
  // name unique within the machine's directory, which the script re-checks.
  const prefix = String(Date.now());
  const tail =
    kind === 'image'
      ? `.${sessionChatImageExtension(base64, suggestedName)}`
      : `-${sanitizeSessionChatAttachmentName(suggestedName ?? '') ?? ATTACHMENT_FALLBACK_NAME}`;

  const localFile = new File(Paths.cache, `ghostex-chat-${prefix}-${sanitized}`);
  try {
    localFile.create({ intermediates: true, overwrite: true });
    localFile.write(base64, { encoding: 'base64' });
    const bytes = localFile.size;

    await ensureConnected(machine);
    const exec = await GhostexNative.exec(
      machine.id,
      loginShellCommand(
        remoteSessionChatUploadPathScript(kind === 'image' ? 'i' : 'f', prefix, tail),
      ),
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

function imageMediaTypeForPath(path: string): string | null {
  const extension = path.toLowerCase().split('.').pop() ?? '';
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'heic':
    case 'heif':
      return 'image/heic';
    default:
      return null;
  }
}

/**
 * Overlay-viewer image read. The native module has no download API, so the
 * bytes come back as base64 over the machine's SSH exec channel, with a
 * size guard so a mislabeled huge file cannot flood the bridge.
 */
async function loadChatImage(
  machine: MachineConnectionTarget,
  params: Record<string, unknown>,
): Promise<{ base64Data: string; mediaType: string; bytes: number }> {
  const path = stringParam(params, 'path') ?? '';
  if (!path.startsWith('/')) throw new Error('Image reads need an absolute path.');
  const mediaType = imageMediaTypeForPath(path);
  if (mediaType === null) throw new Error('The file is not a recognized image.');
  await ensureConnected(machine);
  const quotedPath = `'${path.replace(/'/g, `'\\''`)}'`;
  const script = [
    `image_path=${quotedPath}`,
    'byte_count=$(wc -c < "$image_path" 2>/dev/null | tr -d "[:space:]")',
    `if [ -z "$byte_count" ] || [ "$byte_count" -le 0 ] || [ "$byte_count" -gt ${IMAGE_READ_MAX_BYTES} ]; then`,
    '  echo "unreadable or too large" >&2',
    '  exit 1',
    'fi',
    'base64 < "$image_path"',
  ].join('\n');
  const exec = await GhostexNative.exec(machine.id, script, IMAGE_READ_EXEC_TIMEOUT_MS);
  // Linux base64 wraps lines; strip all whitespace either way.
  const base64Data = exec.stdout.replace(/\s+/g, '');
  if (exec.exitCode !== 0 || base64Data.length === 0) {
    throw new Error(
      exec.stderr.trim().length > 0 ? exec.stderr.trim() : 'Could not read the image file.',
    );
  }
  return { base64Data, bytes: Math.floor((base64Data.length * 3) / 4), mediaType };
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
      case 'readSkills': {
        const result = await runGhostexCli(
          machine,
          readSessionChatSkillsCommand(sessionId, projectId),
          { timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS },
        );
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'readFiles': {
        const result = await runGhostexCli(
          machine,
          readSessionChatFilesCommand(sessionId, projectId),
          { timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS },
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
      case 'sendKey':
      case 'switchToTerminalForAgentPicker': {
        return {
          id: request.id,
          ok: false,
          error: 'This chat action must be handled by the native WebView host.',
        };
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
        return {
          id: request.id,
          ok: true,
          result: await saveChatUpload(machine, params, 'image'),
        };
      }
      case 'saveAttachment': {
        return {
          id: request.id,
          ok: true,
          result: await saveChatUpload(machine, params, 'file'),
        };
      }
      case 'loadImage': {
        return { id: request.id, ok: true, result: await loadChatImage(machine, params) };
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
