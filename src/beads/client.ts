/**
 * The phone Beads view's calls to a computer: gxserver's `beadsView` (the snapshot) and
 * `runBeadsAction` (a bead's `show`, every write, Pull and Push), the same calls and fields the
 * desktop Beads view sends, over the computer's warm link or, on an SSH-only link,
 * `ghostex session-chat-rpc`, which lets only the Beads view's own actions through.
 *
 * SEE-ALSO: apps/desktop/src/app/native_beads/view.rs (`rpc_params`, `run_action`),
 * server/src/ghostex_cli/session_chat_rpc.rs (`BEADS_VIEW_ACTIONS`)
 */

import { sessionChatRpc } from '../chat/rust/transport';
import type { MachineConnectionTarget } from '../machines/credentials';
import { snapshotFrom, type BeadsSnapshot } from './model';

/** A bd write can wait on a busy Dolt server; a sync can take longer. */
const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 60_000;
const SYNC_TIMEOUT_MS = 180_000;

/** The computer's Ghostex predates the phone's Beads view (or its SSH bridge does). */
export class BeadsUnsupportedError extends Error {}

/** The project a Beads read or write is for: the fields the desktop's Tree sends. */
export type BeadsProject = { projectId: string; projectPath: string };

function scope(project: BeadsProject): Record<string, unknown> {
  return {
    projectId: project.projectId,
    ...(project.projectPath.length > 0 ? { projectPath: project.projectPath } : {}),
    projectBoardScope: true,
  };
}

/**
 * A computer whose Ghostex has no Beads view for the phone: an older CLI's own words over SSH, or
 * an older gxserver's `notFound` for the endpoint. A `notFound` naming something that "does not
 * exist" (a project removed or moved) is that project's error, not an old computer.
 */
function unsupported(error: { code?: string | null; message: string }): boolean {
  if (error.code === 'notFound') return !/does not exist/u.test(error.message);
  return (
    error.code === 'unsupportedClient' ||
    /Unknown session chat method|Unknown command: session-chat-rpc|Unsupported Beads action/u.test(error.message)
  );
}

export async function readBeadsView(
  machine: MachineConnectionTarget,
  project: BeadsProject,
  options: { knownRevision?: string; refresh?: boolean },
): Promise<BeadsSnapshot> {
  const params: Record<string, unknown> = { ...scope(project) };
  if (options.knownRevision !== undefined && options.knownRevision.length > 0) params.knownRevision = options.knownRevision;
  if (options.refresh === true) params.refresh = true;
  const answer = await sessionChatRpc(machine, 'beadsView', params, READ_TIMEOUT_MS);
  if (answer.error !== null) {
    if (unsupported(answer.error)) throw new BeadsUnsupportedError(answer.error.message);
    throw new Error(answer.error.message);
  }
  return snapshotFrom(answer.result);
}

/** One `runBeadsAction` answer: bd's exit code and output, or gxserver's refusal. */
export type BeadsActionReply = {
  ok: boolean;
  /** The whole answer, for `show` (`detailsFrom`). */
  result: unknown;
  /** gxserver's error code (`workspaceChanged`, `timeout`) or null. */
  code: string | null;
  message: string;
  output: string;
};

export async function runBeadsAction(
  machine: MachineConnectionTarget,
  project: BeadsProject,
  params: Record<string, unknown>,
  workspaceKey: string,
): Promise<BeadsActionReply> {
  const action = typeof params.action === 'string' ? params.action : '';
  // The workspace the screen read this bead from; gxserver refuses the call if the project now
  // points at another one.
  const sent: Record<string, unknown> = { ...params, ...scope(project), expectedWorkspaceKey: workspaceKey };
  const timeout = action === 'doltPull' || action === 'doltPush' ? SYNC_TIMEOUT_MS : action === 'show' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
  const answer = await sessionChatRpc(machine, 'runBeadsAction', sent, timeout);
  if (answer.error !== null) {
    if (unsupported(answer.error)) throw new BeadsUnsupportedError(answer.error.message);
    return { ok: false, result: null, code: answer.error.code ?? null, message: answer.error.message, output: '' };
  }
  const result = (answer.result ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof result[key] === 'string' ? (result[key] as string).trim() : '');
  const output = [text('stderr'), text('stdout')].filter((part) => part.length > 0).join('\n');
  const error = result.error as { code?: unknown } | undefined;
  return {
    ok: result.exitCode === 0,
    result,
    code: typeof error?.code === 'string' ? error.code : null,
    message: '',
    output,
  };
}
