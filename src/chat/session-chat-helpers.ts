/**
 * The phone's Session Chat plumbing that sits outside the Rust chat core: which agents have a chat
 * view, the upload route for chat attachments, and the synced composer draft the Prompt Editor
 * sheet shares with the chat. Every call goes to the machine over its SSH channel; the phone has no
 * HTTP path to gxserver.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { readSessionChatQueueCommand, setSessionChatDraftCommand } from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import {
  localPathFromUri,
  remoteSessionChatUploadPathScript,
  sanitizeSessionChatAttachmentName,
  sessionChatImageExtension,
} from '../components/terminal/uploads';
import { ensureConnected } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { execRemoteScript, remoteUploadPath } from '../remote/commands';
import { windowsChatUploadPath } from '../remote/files';
import { SESSION_CHAT_SUPPORTED_AGENT_IDS } from './session-chat-agents.generated';

/**
 * Agent icon ids whose sessions have a chat projection. Generated from
 * SESSION_CHAT_SUPPORTED_AGENTS in the main repo's packages/shared/session-chat.ts by
 * `bun run generate:mobile-chat-agents` (the shared module itself is outside this
 * submodule's compile scope).
 */
const SESSION_CHAT_AGENT_IDS = new Set(SESSION_CHAT_SUPPORTED_AGENT_IDS);

export function isSessionChatSupportedAgent(agentId: string): boolean {
  const normalized = agentId.trim().toLowerCase();
  const transcriptAgentId =
    normalized === 'cursor-cli' || normalized === 'cursor-agent' || normalized === 'cursor cli' ? 'cursor' : normalized;
  return SESSION_CHAT_AGENT_IDS.has(transcriptAgentId);
}

const SESSION_CHAT_ACTION_TIMEOUT_MS = 20000;
/** Exec timeout for staging a machine-side temp path (mirrors uploads.ts). */
const REMOTE_PATH_EXEC_TIMEOUT_MS = 20000;
/** Filename used when a non-image attachment arrives without one. */
const ATTACHMENT_FALLBACK_NAME = 'attachment.bin';

/** Stages a machine-side path in the Ghostex `i` or `f` folder and SFTPs a local file into it. */
async function uploadStagedChatFile(
  machine: MachineConnectionTarget,
  localUri: string,
  kind: 'image' | 'file',
  prefix: string,
  tail: string
): Promise<string> {
  await ensureConnected(machine);
  const exec = await execRemoteScript(
    machine.id,
    {
      posix: remoteSessionChatUploadPathScript(kind === 'image' ? 'i' : 'f', prefix, tail),
      powershell: windowsChatUploadPath(kind === 'image' ? 'i' : 'f', prefix, tail),
    },
    REMOTE_PATH_EXEC_TIMEOUT_MS
  );
  const remotePath = exec.stdout.trim().split('\n').pop()?.trim() ?? '';
  if (exec.exitCode !== 0 || remotePath.length === 0) {
    throw new Error(exec.stderr.trim().length > 0 ? exec.stderr.trim() : 'Remote path creation failed.');
  }
  await GhostexNative.uploadFile(machine.id, localPathFromUri(localUri), await remoteUploadPath(machine.id, remotePath));
  return remotePath;
}

/**
 * A file already on the phone (a picker or camera result) uploaded as a chat attachment; answers the
 * machine path. gxserver's image and attachment save endpoints have no CLI verb (base64 bytes on an
 * SSH command line would blow past ARG_MAX), so the file takes the terminal attach flow's route: stage
 * a path in the machine's Ghostex data directory (`i` for images, `f` for everything else, the
 * folders those endpoints use) and SFTP the file there. Used by the Rust chat host for the core's
 * `importNativeAttachments` request, which carries local paths.
 */
export async function uploadSessionChatLocalFile(
  machine: MachineConnectionTarget,
  localUri: string,
  suggestedName: string | undefined,
  kind: 'image' | 'file'
): Promise<string> {
  const prefix = String(Date.now());
  const tail =
    kind === 'image'
      ? `.${sessionChatImageExtension('', suggestedName)}`
      : `-${sanitizeSessionChatAttachmentName(suggestedName ?? '') ?? ATTACHMENT_FALLBACK_NAME}`;
  return uploadStagedChatFile(machine, localUri, kind, prefix, tail);
}

/*
 * ---------------------------------------------------------------------------
 * Synced composer draft, for the app's own chrome
 * ---------------------------------------------------------------------------
 * The Prompt Editor sheet is a second composer for the same session, so it
 * takes over the session's synced draft while it is open: it seeds from
 * whatever the last client wrote and publishes whatever the user leaves
 * behind. It writes under its OWN client id, which is the honest description
 * of what it is: the chat screen's composer is a different buffer on the same
 * device, and marking these writes as the chat's own echo would make the chat
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
