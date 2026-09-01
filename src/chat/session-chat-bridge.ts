/**
 * React Native side of the Session Chat webview bridge.
 *
 * The chat page (built from the main repo's apps/mobile/views/chat/session-chat-main.tsx
 * into assets/webview/session-chat/) posts
 * `{ id, op, params }` requests (including the read-only `readSkills` and
 * `readFiles` catalogs)
 * via window.ReactNativeWebView.postMessage and
 * expects `{ id, ok, result?, error? }` responses delivered through
 * `window.ghostexMobileChatDeliver`. This module maps each op onto the
 * matching `ghostex` Session Chat CLI verb over the machine's SSH channel —
 * the phone has no HTTP path to gxserver, and keeping RN a dumb verb runner
 * leaves all chat behavior (long-poll pacing, frame synthesis, UI) in the
 * shared page code. That now includes Ghostex's prompt queue and the
 * cross-client composer draft (plan 016), whose seven verbs are ordinary ops
 * here, plus one id-less page → RN notice carrying the live queue count for
 * the app's own chrome.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

import { GhostexNative } from '../../modules/ghostex-native/src';
import {
  answerSessionChatPromptCommand,
  handoffSessionChatDraftCommand,
  interruptSessionChatCommand,
  loginShellCommand,
  queueSessionChatPromptCommand,
  readSessionChatCommand,
  readSessionChatFilesCommand,
  readSessionChatQueueCommand,
  readSessionChatSkillsCommand,
  removeSessionChatQueuedPromptCommand,
  reorderSessionChatQueueCommand,
  savedPromptsCommand,
  sendSessionChatKeyCommand,
  sendSessionChatMessageCommand,
  sendSessionChatQueuedPromptCommand,
  sessionNoteReadCommand,
  sessionNoteSaveCommand,
  setSessionChatDraftCommand,
  switchDraftAgentCommand,
  updateSessionChatQueuedPromptCommand,
  type SavedPromptsAction,
  type SessionChatKey,
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
 * SESSION_CHAT_SUPPORTED_AGENTS in the main repo's packages/shared/session-chat.ts by
 * `bun run build:mobile-chat` (the shared module itself is outside this
 * submodule's compile scope).
 */
const SESSION_CHAT_AGENT_IDS = new Set(SESSION_CHAT_SUPPORTED_AGENT_IDS);

export function isSessionChatSupportedAgent(agentId: string): boolean {
  const normalized = agentId.trim().toLowerCase();
  const transcriptAgentId =
    normalized === 'cursor-cli' || normalized === 'cursor-agent' || normalized === 'cursor cli' ? 'cursor' : normalized;
  return SESSION_CHAT_AGENT_IDS.has(transcriptAgentId);
}

/**
 * Every op the page may ask for. Kept as one list so the request type and the
 * parser's guard can never drift apart — a page op the guard forgot is
 * silently dropped, which reads in the UI as a control that does nothing.
 *
 * The `queue*` / `*QueuedPrompt` / `setDraft` entries are Ghostex's own prompt
 * queue and the cross-client composer draft (plan 016). They are NOT the agent
 * CLI's internal queue.
 *
 * The `sessionNote*` entries back the composer's note panel; the note itself is
 * keyed by the session's agent conversation id on the daemon side.
 */
const SESSION_CHAT_BRIDGE_OPS = [
  'read',
  'readSkills',
  'readFiles',
  'switchDraftAgent',
  'send',
  'sendKey',
  'switchToTerminalForAgentPicker',
  'answerPrompt',
  'interrupt',
  'saveImage',
  'saveAttachment',
  'loadImage',
  'queuePrompt',
  'updateQueuedPrompt',
  'removeQueuedPrompt',
  'reorderQueue',
  'sendQueuedPrompt',
  'setDraft',
  'sessionNoteRead',
  'sessionNoteSave',
  'savedPrompts',
  'jumpToSavedPromptSession',
] as const;

export type SessionChatBridgeOp = (typeof SESSION_CHAT_BRIDGE_OPS)[number];

export type SessionChatBridgeRequest = {
  id: number;
  op: SessionChatBridgeOp;
  params?: Record<string, unknown>;
};

/**
 * Host notices: unsolicited page → RN messages with no request id.
 *
 * `queueCount`: the queue lives on gxserver and the page already long-polls
 * for it, so the app chrome (the terminal view's "Queued: N" button) learns the
 * count from the page that is already mounted for that session instead of
 * opening a second polling channel of its own.
 *
 * `draftHandoffToTerminal`: the answer to a host-initiated chat → terminal
 * draft handoff. The page has already parked `content` in Saved Prompts as
 * `promptId` before releasing it, so the host types it into the agent CLI and
 * drops that row only once the terminal has taken it.
 */
export type SessionChatBridgeNotice =
  { notice: 'queueCount'; count: number } | { notice: 'draftHandoffToTerminal'; content: string; promptId?: string };

export type SessionChatBridgeResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

/** Exec timeout for non-read ops; sends queue server-side and return fast. */
const SESSION_CHAT_ACTION_TIMEOUT_MS = 20000;
/**
 * The daemon waits on the agent CLI's Ctrl+G prompt-editor handshake (up to
 * 16s) before it can answer with the draft, so this verb needs far more room
 * than the queue-and-return ops above.
 */
const SESSION_CHAT_DRAFT_HANDOFF_TIMEOUT_MS = 40000;
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
  const op = SESSION_CHAT_BRIDGE_OPS.find((candidate) => candidate === record.op);
  if (op === undefined) return null;
  const params =
    typeof record.params === 'object' && record.params !== null && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : {};
  return { id: record.id, op, params };
}

/** Id-less page → RN messages (see SessionChatBridgeNotice). */
export function parseSessionChatBridgeNotice(raw: string): SessionChatBridgeNotice | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.notice === 'queueCount') {
    const count = record.count;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null;
    return { notice: 'queueCount', count: Math.floor(count) };
  }
  if (record.notice === 'draftHandoffToTerminal') {
    const content = record.content;
    // The page never announces an empty handoff: nothing moved out of chat.
    if (typeof content !== 'string' || content.length === 0) return null;
    const promptId = record.promptId;
    return {
      notice: 'draftHandoffToTerminal',
      content,
      ...(typeof promptId === 'string' && promptId.length > 0 ? { promptId } : {}),
    };
  }
  return null;
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
  kind: 'image' | 'file'
): Promise<{ path: string; bytes: number }> {
  const raw = typeof params.base64Data === 'string' ? params.base64Data : '';
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (base64.length === 0) throw new Error('The attachment carried no data.');
  const suggestedName = stringParam(params, 'suggestedName');
  const sanitized = sanitizeAttachmentFilename(
    suggestedName ?? (kind === 'image' ? PASTED_IMAGE_FALLBACK_NAME : ATTACHMENT_FALLBACK_NAME)
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
      loginShellCommand(remoteSessionChatUploadPathScript(kind === 'image' ? 'i' : 'f', prefix, tail)),
      REMOTE_PATH_EXEC_TIMEOUT_MS
    );
    const remotePath = exec.stdout.trim().split('\n').pop()?.trim() ?? '';
    if (exec.exitCode !== 0 || remotePath.length === 0) {
      throw new Error(exec.stderr.trim().length > 0 ? exec.stderr.trim() : 'Remote path creation failed.');
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
  params: Record<string, unknown>
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
    throw new Error(exec.stderr.trim().length > 0 ? exec.stderr.trim() : 'Could not read the image file.');
  }
  return { base64Data, bytes: Math.floor((base64Data.length * 3) / 4), mediaType };
}

/**
 * Move whatever the user typed into the agent CLI out of the terminal and
 * return it, so the chat composer can take ownership of that draft when the
 * user switches views. Returns an empty string when the CLI composer was empty
 * or the transfer could not be made — both leave the terminal untouched, and
 * neither is worth interrupting a view switch over.
 *
 * Unlike every other verb here this is host-initiated, not page-initiated: the
 * page has no way to know the user just arrived from the terminal.
 */
export async function handoffSessionChatDraft(
  machine: MachineConnectionTarget,
  projectId: string,
  sessionId: string
): Promise<string> {
  if (projectId.trim().length === 0 || sessionId.trim().length === 0) return '';
  try {
    const result = await runGhostexCli(machine, handoffSessionChatDraftCommand(sessionId, projectId), {
      timeoutMs: SESSION_CHAT_DRAFT_HANDOFF_TIMEOUT_MS,
    });
    const content = (result.json as { content?: unknown } | undefined)?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

/**
 * Drop the Saved Prompts row a chat → terminal handoff parked its draft in.
 * Called only once the agent CLI has actually taken the text, so a row that
 * outlives its handoff is the user's copy of a prompt that never landed.
 *
 * Host-initiated like the handoff above, and silent for the same reason: the
 * user asked to see the terminal, not to tidy up Saved Prompts.
 */
export async function releaseSessionChatDraftHandoffStash(
  machine: MachineConnectionTarget,
  promptId: string
): Promise<void> {
  try {
    await runGhostexCli(machine, savedPromptsCommand('delete', { promptId }), {
      timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
    });
  } catch {
    // The row stays in Saved Prompts, which is where the text is recoverable.
  }
}

/*
 * ---------------------------------------------------------------------------
 * Synced composer draft, for the app's own chrome
 * ---------------------------------------------------------------------------
 * The Prompt Editor sheet is a second composer for the same session, so it
 * takes over the session's synced draft while it is open: it seeds from
 * whatever the last client wrote and publishes whatever the user leaves
 * behind. It writes under its OWN client id, which is the honest description
 * of what it is — the chat page's composer is a different buffer on the same
 * device, and marking these writes as the page's own echo would make the page
 * ignore text the user actually typed.
 */

const PROMPT_EDITOR_CLIENT_ID_STORAGE_KEY = 'sessionChat.promptEditorClient.v1';
let promptEditorClientId: string | null = null;

/**
 * Stable per-install id for Prompt Editor draft writes. Persisted, because a
 * fresh id per app run would make this device's own previous draft look like a
 * different client every time.
 */
async function resolvePromptEditorClientId(): Promise<string> {
  if (promptEditorClientId !== null) return promptEditorClientId;
  try {
    const stored = await AsyncStorage.getItem(PROMPT_EDITOR_CLIENT_ID_STORAGE_KEY);
    if (stored !== null && stored.trim().length > 0) {
      promptEditorClientId = stored.trim();
      return promptEditorClientId;
    }
  } catch {
    // An unreadable store just means a fresh id for this app run.
  }
  const generated = `gx-mobile-editor-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  promptEditorClientId = generated;
  void AsyncStorage.setItem(PROMPT_EDITOR_CLIENT_ID_STORAGE_KEY, generated).catch(() => undefined);
  return generated;
}

export type SessionChatSyncedDraft = {
  /**
   * False when this machine's Ghostex predates the queue/draft endpoints. The
   * caller then leaves the draft alone entirely rather than writing back into
   * a verb that does not exist.
   */
  supported: boolean;
  content: string;
};

/**
 * Read the session's synced composer draft. Never throws: a machine without
 * the verb, or an unreachable one, answers "unsupported" and the Prompt Editor
 * simply opens empty instead of blocking on an SSH round trip.
 */
export async function readSessionChatSyncedDraft(
  machine: MachineConnectionTarget,
  projectId: string,
  sessionId: string
): Promise<SessionChatSyncedDraft> {
  if (projectId.trim().length === 0 || sessionId.trim().length === 0) {
    return { content: '', supported: false };
  }
  try {
    const result = await runGhostexCli(machine, readSessionChatQueueCommand(sessionId, projectId), {
      timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
    });
    const draft = (result.json as { draft?: unknown } | null)?.draft;
    const content =
      typeof draft === 'object' && draft !== null && !Array.isArray(draft)
        ? (draft as { content?: unknown }).content
        : undefined;
    return { content: typeof content === 'string' ? content : '', supported: true };
  } catch {
    return { content: '', supported: false };
  }
}

/**
 * Publish `content` as the session's synced draft. Throws on failure so the
 * caller can tell the user their words did not leave the phone — silently
 * swallowing this would lose a long prompt.
 */
export async function writeSessionChatSyncedDraft(
  machine: MachineConnectionTarget,
  projectId: string,
  sessionId: string,
  content: string
): Promise<void> {
  const clientId = await resolvePromptEditorClientId();
  await runGhostexCli(machine, setSessionChatDraftCommand(sessionId, projectId, content, clientId), {
    timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
  });
}

/**
 * Run one bridge request against a session's machine. Never throws: failures
 * become `{ ok: false, error }` responses the page surfaces in its own UI.
 */
export async function runSessionChatBridgeRequest(
  machine: MachineConnectionTarget,
  projectId: string,
  sessionId: string,
  request: SessionChatBridgeRequest
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
        const waitMs = options.waitMs !== undefined && options.fingerprint !== undefined ? options.waitMs : 0;
        const result = await runGhostexCli(machine, readSessionChatCommand(sessionId, projectId, options), {
          timeoutMs: waitMs + SESSION_CHAT_READ_TIMEOUT_MARGIN_MS,
        });
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'readSkills': {
        const result = await runGhostexCli(machine, readSessionChatSkillsCommand(sessionId, projectId), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'readFiles': {
        const result = await runGhostexCli(machine, readSessionChatFilesCommand(sessionId, projectId), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'switchDraftAgent': {
        const agentId = stringParam(params, 'agentId');
        if (agentId === undefined) {
          return { id: request.id, ok: false, error: 'The draft-agent switch carried no agent id.' };
        }
        const result = await runGhostexCli(
          machine,
          switchDraftAgentCommand(sessionId, projectId, agentId),
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
      case 'sendKey': {
        const key = stringParam(params, 'key');
        const supportedKeys: readonly SessionChatKey[] = ['enter', 'shift-tab', 'shift-up', 'shift-down'];
        if (key === undefined || !supportedKeys.includes(key as SessionChatKey)) {
          return { id: request.id, ok: false, error: 'Unknown chat terminal key.' };
        }
        const result = await runGhostexCli(
          machine,
          sendSessionChatKeyCommand(sessionId, projectId, key as SessionChatKey),
          { timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS },
        );
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'switchToTerminalForAgentPicker':
      case 'jumpToSavedPromptSession': {
        return {
          id: request.id,
          ok: false,
          error: 'This chat action must be handled by the native WebView host.',
        };
      }
      case 'answerPrompt': {
        await runGhostexCli(machine, answerSessionChatPromptCommand(sessionId, projectId, params), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
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
      /*
       * Ghostex prompt queue + synced composer draft (plan 016). Each verb
       * answers with the full authoritative queue, which the page installs in
       * place of its own list, so a phone that lost a race with another client
       * self-corrects on the very next call. There is no `readQueue` op: the
       * page learns the queue from its ordinary chat reads, which carry it.
       */
      case 'queuePrompt': {
        const text = typeof params.text === 'string' ? params.text : '';
        if (text.trim().length === 0) {
          return { id: request.id, ok: false, error: 'Nothing to queue.' };
        }
        const result = await runGhostexCli(machine, queueSessionChatPromptCommand(sessionId, projectId, text), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'updateQueuedPrompt': {
        const promptId = stringParam(params, 'promptId');
        if (promptId === undefined) {
          return { id: request.id, ok: false, error: 'This queued prompt has no id.' };
        }
        const result = await runGhostexCli(
          machine,
          updateSessionChatQueuedPromptCommand(sessionId, projectId, promptId, {
            ...(typeof params.text === 'string' ? { text: params.text } : {}),
            ...(params.retry === true ? { retry: true } : {}),
          }),
          { timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS }
        );
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'removeQueuedPrompt': {
        const promptId = stringParam(params, 'promptId');
        if (promptId === undefined) {
          return { id: request.id, ok: false, error: 'This queued prompt has no id.' };
        }
        const result = await runGhostexCli(
          machine,
          removeSessionChatQueuedPromptCommand(sessionId, projectId, promptId),
          { timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS }
        );
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'reorderQueue': {
        const promptIds = Array.isArray(params.promptIds)
          ? params.promptIds.filter((value): value is string => typeof value === 'string')
          : [];
        if (promptIds.length === 0) {
          return { id: request.id, ok: false, error: 'The queue order carried no rows.' };
        }
        const result = await runGhostexCli(machine, reorderSessionChatQueueCommand(sessionId, projectId, promptIds), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'sendQueuedPrompt': {
        const promptId = stringParam(params, 'promptId');
        if (promptId === undefined) {
          return { id: request.id, ok: false, error: 'This queued prompt has no id.' };
        }
        const result = await runGhostexCli(
          machine,
          sendSessionChatQueuedPromptCommand(sessionId, projectId, promptId),
          { timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS }
        );
        // Desktop parity: delivering a prompt is answering the session.
        acknowledgeSessionAttention(machine.id, sessionId);
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'setDraft': {
        // An EMPTY content is how a draft is cleared, so it is valid input and
        // must not be filtered out the way an empty send would be.
        const content = typeof params.content === 'string' ? params.content : '';
        const clientId = stringParam(params, 'clientId');
        if (clientId === undefined) {
          return { id: request.id, ok: false, error: 'The draft push carried no client id.' };
        }
        const result = await runGhostexCli(
          machine,
          setSessionChatDraftCommand(sessionId, projectId, content, clientId),
          { timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS }
        );
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      /*
       * Session note. The read answers `{ agentSessionId?, note? }` verbatim —
       * both keys are absent when the session has no provider conversation yet,
       * which is how the page knows to hide the control. An EMPTY note is how a
       * note is cleared, so it is valid input on the save.
       */
      case 'sessionNoteRead': {
        const result = await runGhostexCli(machine, sessionNoteReadCommand(sessionId, projectId), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'sessionNoteSave': {
        const note = typeof params.note === 'string' ? params.note : '';
        const result = await runGhostexCli(machine, sessionNoteSaveCommand(sessionId, projectId, note), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: result.json ?? {} };
      }
      case 'savedPrompts': {
        const action = stringParam(params, 'action');
        const supportedActions: readonly SavedPromptsAction[] = [
          'list',
          'save',
          'delete',
          'save-tag',
          'delete-tag',
          'set-tags',
        ];
        if (action === undefined || !supportedActions.includes(action as SavedPromptsAction)) {
          return { id: request.id, ok: false, error: 'Unknown Saved Prompts action.' };
        }
        const payload =
          typeof params.payload === 'object' && params.payload !== null && !Array.isArray(params.payload)
            ? (params.payload as Record<string, unknown>)
            : {};
        const result = await runGhostexCli(machine, savedPromptsCommand(action as SavedPromptsAction, payload), {
          timeoutMs: SESSION_CHAT_ACTION_TIMEOUT_MS,
        });
        return { id: request.id, ok: true, result: result.json ?? {} };
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
