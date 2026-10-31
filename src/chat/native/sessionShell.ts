/**
 * The app-shell work the native chat performs for the core's host actions that reach past this
 * chat: opening another session of the same machine (a fork branch, a handoff's new conversation)
 * and reading this session's row. Desktop does the same in the app (`session_chat_fork_branches.rs`,
 * `gx_store/git/export_transcript.rs`); the phone's equivalents are the SSH CLI verbs, the inventory
 * and the terminal tabs, the same ones the terminal screen's Fork and Export use.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { createdSessionId, runGhostexCli } from '../../components/sessions/cli';
import { sanitizeAttachmentFilename } from '../../components/terminal/uploads';
import {
  createAgentCommand,
  exportSessionTranscriptCommand,
  runInTerminalCommand,
  shellQuote,
  wakeSessionCommand,
} from '../../commands/ghostexCli';
import {
  computerStagesLineBreaks,
  handoffDraft,
  singleLineHandoffDraft,
  type HandoffInclude,
} from '../../contract/handoff/handoff';
import { resolveAgentIconId, type GhostexAgentLauncher, type GhostexSession } from '../../contract/mobileSummary';
import { SessionCopy } from '../../copy';
import { decodeBase64Utf8, readRemoteFiles } from '../../docs/remoteFiles';
import { ensureConnected } from '../../inventory/client';
import { useInventoryStore } from '../../inventory/store';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { execRemoteScript } from '../../remote/commands';
import { powershellQuote } from '../../remote/powershell';
import { machineRecordFor } from '../../screens/terminal-screen/session-lookups';
import { useSettingsStore } from '../../settings/store';
import { useTerminalStore } from '../../terminal/sessions';
import { sessionChatRpc } from '../rust/transport';
import { isSessionChatSupportedAgent, uploadSessionChatLocalFile } from '../session-chat-helpers';

const BRANCH_READ_TIMEOUT_MS = 15_000;
/** The desktop's own limit for carrying a transcript (`ATTACHMENT_MAX_BYTES`). */
const TRANSCRIPT_CARRY_MAX_BYTES = 32 * 1024 * 1024;

/** This machine's row for a session, or null before the inventory has it. */
export function sessionRecord(machineId: string, sessionId: string): GhostexSession | null {
  return (
    useInventoryStore
      .getState()
      .inventoriesByMachineId[machineId]?.summary?.sessions.find((session) => session.sessionId === sessionId) ?? null
  );
}

/** The machine's configured agents, in the inventory's order. */
export function machineAgents(machineId: string): GhostexAgentLauncher[] {
  return useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary?.agents ?? [];
}

/** The session's display title, as the terminal screen's Export names it. */
export function sessionTitle(machineId: string, sessionId: string): string {
  const title = sessionRecord(machineId, sessionId)?.displayTitle ?? '';
  return title.length > 0 ? title : SessionCopy.fallbackTitle;
}

/** Opens (or re-selects) a session's tab, which puts that session's chat on screen. */
export async function openSessionTab(machine: MachineConnectionTarget, sessionId: string, projectId: string): Promise<void> {
  const record = machineRecordFor(machine.id);
  if (record !== null) await useInventoryStore.getState().refreshMachine(record);
  const title = sessionRecord(machine.id, sessionId)?.displayTitle;
  const sessionKey = await useTerminalStore.getState().attachSession(machine, {
    sessionId,
    projectId,
    ...(title !== undefined && title.length > 0 ? { title } : {}),
  });
  useTerminalStore.getState().selectTab(sessionKey);
}

/**
 * The branch switcher's pick (`selectForkBranch`): a stopped branch is woken first, because a
 * stopped row has no live session to open, then its tab is opened. Throws when either step fails.
 * SEE-ALSO: apps/desktop/src/app/session_chat_fork_branches.rs (the same two steps on desktop).
 */
export async function openForkBranch(machine: MachineConnectionTarget, params: unknown): Promise<void> {
  const fields = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>;
  const text = (key: string): string => (typeof fields[key] === 'string' ? (fields[key] as string).trim() : '');
  const projectId = text('projectId');
  const sessionId = text('sessionId');
  if (projectId.length === 0 || sessionId.length === 0) throw new Error('The branch has no session.');
  if (text('lifecycleState') === 'stopped') await runGhostexCli(machine, wakeSessionCommand(sessionId, projectId));
  await openSessionTab(machine, sessionId, projectId);
}

/**
 * A chat's Run in terminal (`runInTerminal`): the command typed into the project's idle Commands
 * panel terminal on the computer (the desktop's choice too), or a new plain terminal in the chat
 * session's own folder when there is none, and Enter pressed (`paste`: only typed); then that
 * terminal opens as a tab.
 * SEE-ALSO: server/src/ghostex_cli/run_in_terminal.rs, and the desktop's
 * apps/desktop/src/app/session_chat/run_in_terminal.rs.
 */
export async function runCommandInTerminal(
  machine: MachineConnectionTarget,
  projectId: string,
  sessionId: string,
  command: string,
  paste: boolean,
): Promise<void> {
  const result = await runGhostexCli(machine, runInTerminalCommand(projectId, sessionId, command, paste));
  const created = typeof result.json?.sessionId === 'string' ? result.json.sessionId.trim() : '';
  if (created.length === 0) throw new Error('gxserver did not return the terminal.');
  await openSessionTab(machine, created, projectId);
}

/** `modelPickerProvider`: the model family an agent's logo belongs to. */
export function modelPickerProvider(icon: string | undefined): string | null {
  switch (icon) {
    case 'claude':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'cursor-cli':
    case 'cursor':
      return 'cursor';
    case 'grok-build':
    case 'grok':
      return 'grok';
    case 'antigravity-cli':
    case 'antigravity':
      return 'antigravity';
    default:
      return null;
  }
}

/** Writes the session's transcript to a Markdown file on the machine and returns its path. */
export async function exportTranscript(
  machine: MachineConnectionTarget,
  sessionId: string,
  projectId: string,
  include: HandoffInclude,
): Promise<string> {
  const result = await runGhostexCli(machine, exportSessionTranscriptCommand(sessionId, projectId, include));
  const path = typeof result.json?.path === 'string' ? result.json.path.trim() : '';
  if (path.length === 0) throw new Error('gxserver did not return the exported file.');
  return path;
}

/** The project's name, as a handoff's lead-in says it. */
export function projectTitle(machineId: string, projectId: string): string {
  const project = useInventoryStore
    .getState()
    .inventoriesByMachineId[machineId]?.summary?.projects.find((entry) => entry.projectId === projectId);
  return project?.name ?? '';
}

/**
 * A handoff's first input for the computer that will stage it (`handoffDraft`). The computer's
 * version decides its form: one that predates the staged paste gets it on one line, so a phone
 * updated over the air never presses Return on a computer that has not been updated.
 */
export async function stagedHandoffDraft(
  machine: MachineConnectionTarget,
  input: { path: string; sessionTitle: string; projectTitle: string },
): Promise<string> {
  const draft = handoffDraft(input.path, input.sessionTitle, input.projectTitle);
  const version = await runGhostexCli(machine, 'ghostex server status --json').then(
    (status) => {
      const health = status.json?.health as { version?: unknown } | undefined;
      return typeof health?.version === 'string' ? health.version : null;
    },
    () => null,
  );
  return computerStagesLineBreaks(version) ? draft : singleLineHandoffDraft(draft);
}

/** The branch a project's folder is on, or null when it can't be read. */
export async function projectBranch(machine: MachineConnectionTarget, path: string): Promise<string | null> {
  try {
    await ensureConnected(machine);
    const answer = await execRemoteScript(
      machine.id,
      {
        posix: `git -C ${shellQuote(path)} rev-parse --abbrev-ref HEAD`,
        powershell: `git -C ${powershellQuote(path)} rev-parse --abbrev-ref HEAD`,
      },
      BRANCH_READ_TIMEOUT_MS,
    );
    const branch = answer.stdout.trim().split(/\r?\n/u).pop()?.trim() ?? '';
    return answer.exitCode === 0 && branch.length > 0 && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

/**
 * A handoff to another computer: the transcript is on the session's computer, where a path
 * means nothing to the other one, so the phone reads it and saves a copy there. Answers the copy's
 * path. Both ends are this app's own routes: `readRemoteFiles` and the chat's attachment upload.
 *
 * CDXC:TranscriptExport 2026-10-31 WHY:
 * The computers never talk to each other (export_handoff_remote.rs). The desktop gets the text with the export (`includeMarkdown`), but the phone exports through `ghostex export-transcript`, which has no such flag on computers already out there, and has no HTTP path to gxserver.
 */
export async function carryTranscript(
  from: MachineConnectionTarget,
  path: string,
  to: MachineConnectionTarget,
): Promise<string> {
  const [read] = await readRemoteFiles(from, [path], TRANSCRIPT_CARRY_MAX_BYTES);
  if (read?.status === 'tooLarge') throw new Error('This conversation is too long to carry to another computer.');
  if (read?.status !== 'ok') throw new Error('The transcript could not be read on its computer.');
  const name = path.split(/[/\\]/).pop() ?? 'handoff.md';
  const folder = new Directory(Paths.cache, 'handoff');
  folder.create({ idempotent: true, intermediates: true });
  const file = new File(folder, `${Date.now()}-${sanitizeAttachmentFilename(name)}`);
  file.create({ overwrite: true });
  try {
    file.write(decodeBase64Utf8(read.base64));
    return await uploadSessionChatLocalFile(to, file.uri, name, 'file');
  } finally {
    file.delete();
  }
}

/** Staged first-input drafts claimed for a chat composer, by `[machineId, projectId, sessionId]`. */
const launchDrafts = new Map<string, string>();

function launchDraftKey(machineId: string, projectId: string, sessionId: string): string {
  return JSON.stringify([machineId, projectId, sessionId]);
}

/**
 * The staged draft a new session's chat composer should open with, handed out once: the chat
 * screen takes it when its composer is ready (desktop's `pending_session_chat_composer_insert`).
 */
export function takeLaunchDraft(machineId: string, projectId: string, sessionId: string): string | null {
  const key = launchDraftKey(machineId, projectId, sessionId);
  const draft = launchDrafts.get(key) ?? null;
  launchDrafts.delete(key);
  return draft;
}

/**
 * Creates an agent session whose first input is `draft` (a Handoff's transcript link), staged and
 * never sent, and answers its session id.
 *
 * CDXC:Drafts 2026-10-03 WHY:
 * `create-agent --first-input-draft` has gxserver type the draft into the agent CLI once it starts,
 * so a new conversation that opened in Chat showed an empty composer with the link hidden in the
 * parked terminal. Desktop asks gxserver for the draft when such a session opens in Chat
 * (`request_session_chat_launch_draft`); the phone does the same here, and creates the session with
 * `--defer-start` so the claim always lands before the attach starts the provider and its typing.
 * A computer whose CLI predates the claim refuses it and the draft is typed into the terminal, as
 * before.
 * SEE-ALSO: apps/desktop/src/app/session_chat/drafts_and_attachments.rs,
 * server/src/server/title_generation/first_input_draft.rs (`claim_first_user_input_draft_for_chat`).
 */
export async function createAgentWithFirstInputDraft(
  machine: MachineConnectionTarget,
  input: {
    projectId: string;
    agent: Pick<GhostexAgentLauncher, 'agentId' | 'icon' | 'name'>;
    draft: string;
    model?: { model: string; effort: string } | null;
  },
): Promise<string> {
  const { agent, projectId, model } = input;
  const agentName = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
  const opensInChat =
    useSettingsStore.getState().settings.preferredAgentInterface === 'chat' &&
    isSessionChatSupportedAgent(resolveAgentIconId(agent.icon, agentName));
  let command = createAgentCommand(agent.agentId, projectId, input.draft, opensInChat);
  if (model != null && model.model.trim().length > 0) {
    command += ` --model ${shellQuote(model.model.trim())}`;
    if (model.effort.trim().length > 0) command += ` --effort ${shellQuote(model.effort.trim())}`;
  }
  const created = await runGhostexCli(machine, command);
  const sessionId = createdSessionId(created);
  if (sessionId === null) throw new Error('Could not create the new agent session.');
  if (opensInChat) {
    const answer = await sessionChatRpc(machine, 'claimSessionChatLaunchDraft', { projectId, sessionId });
    const result = (answer.error === null ? answer.result : null) as { content?: unknown } | null;
    const content = typeof result?.content === 'string' ? result.content : '';
    if (content.length > 0) launchDrafts.set(launchDraftKey(machine.id, projectId, sessionId), content);
  }
  return sessionId;
}

/**
 * Handoff's new conversation: the agent starts with the exported file staged as its first input
 * (never sent), in the same project or in the picked project on the picked computer, and the old
 * session keeps running. It takes the picked model when the agent belongs to
 * the picked model's family and that family's launch line carries a model (Claude and Codex).
 */
export async function startHandoffConversation(
  machine: MachineConnectionTarget,
  input: {
    projectId: string;
    agent: GhostexAgentLauncher;
    path: string;
    sessionTitle: string;
    target: { provider: string; model: string; effort: string } | null;
    /** Where it goes when that is not this project here. */
    destination?: { machine: MachineConnectionTarget; projectId: string };
  },
): Promise<void> {
  const { agent, target } = input;
  const to = input.destination?.machine ?? machine;
  const toProjectId = input.destination?.projectId ?? input.projectId;
  const path = to.id === machine.id ? input.path : await carryTranscript(machine, input.path, to);
  const launchModel =
    target !== null &&
    (target.provider === 'claude' || target.provider === 'codex') &&
    modelPickerProvider(agent.icon) === target.provider
      ? target
      : null;
  const sessionId = await createAgentWithFirstInputDraft(to, {
    projectId: toProjectId,
    agent,
    draft: await stagedHandoffDraft(to, {
      path,
      sessionTitle: input.sessionTitle,
      projectTitle: projectTitle(machine.id, input.projectId),
    }),
    model: launchModel,
  });
  await openSessionTab(to, sessionId, toProjectId);
}
