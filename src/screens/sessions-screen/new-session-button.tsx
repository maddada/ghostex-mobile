/**
 * The Sessions header's New session button: it opens the project sheet (every computer's projects,
 * Recent first, ./new-session-place.ts), and a pick starts that project's remembered agent there,
 * as the project's own agent button does. This file holds the button and what a pick or an empty
 * list comes to; the screen wires them to its sheet, its toast and its launch.
 *
 * CDXC:Sidebar 2026-11-10 WHY:
 * The contributor (sebastianarena, PR #540) chose a "New session" button always visible at the top of the phone's sessions list, in the Project and the Unified layouts. Tap it, pick any project from a searchable list (Recent first, computer shown), and it starts the last-used agent there; agent, model, worktree, project and computer can still be changed in the chat draft before sending, and the account stays in the draft. It sits in the title row beside the bell and the menu (a rail entry in the side-bar poses), and Unified's search-row pencil went with it. User (Q47): it opens chat or terminal by the phone's own Default agent view, like the project's agent button, instead of always opening the chat (supersedes the 2026-11-09 always-chat rule). A pick that cannot start says why instead of doing nothing.
 * SEE-ALSO: ./new-session-place.ts (the rows and the agent's Space), ./use-sessions-screen-menus.tsx (`startNewSessionAt`).
 */

import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import type { GhostexAgentLauncher } from '../../contract/mobileSummary';
import type { ProjectHeaderItem } from '../../contract/grouping';
import { EditGlyph } from '../../components/sessions/unified/glyphs';
import { NewSessionCopy } from '../../copy';

/** What the screen's toast shows instead of a start. */
export type NewSessionNotice = { title: string; message: string };

/** A pick in the sheet: start that agent there, or say why it can't. */
export type NewSessionStart =
  | { kind: 'start'; header: ProjectHeaderItem; agent: GhostexAgentLauncher }
  | { kind: 'notice'; notice: NewSessionNotice };

/**
 * A picked project on one computer. `header` is null when the computer's summary no longer lists
 * the project; `agent` is the one its button would start (null when no agent is turned on).
 */
export function newSessionStart(input: {
  connected: boolean;
  computer: string;
  header: ProjectHeaderItem | null;
  agent: GhostexAgentLauncher | null;
}): NewSessionStart {
  const { connected, computer, header, agent } = input;
  if (!connected) return notice(NewSessionCopy.offlineTitle, NewSessionCopy.offline(computer));
  if (header === null) return notice(NewSessionCopy.goneTitle, NewSessionCopy.gone(computer));
  if (header.projectId.length === 0) return notice(NewSessionCopy.noProjectIdTitle, NewSessionCopy.noProjectId);
  if (agent === null) return notice(NewSessionCopy.noAgentsTitle, NewSessionCopy.noAgents(computer));
  return { kind: 'start', header, agent };
}

/**
 * Why the agent menu can't open on a project of a computer (a project's "+", the agent menu's
 * project row), or null when it can: the computer is off, its summary hasn't been read yet, or the
 * project is gone from it.
 */
export function agentMenuNotice(input: {
  connected: boolean;
  computer: string;
  read: boolean;
  found: boolean;
}): NewSessionNotice | null {
  if (!input.connected) return { title: NewSessionCopy.offlineTitle, message: NewSessionCopy.offline(input.computer) };
  if (!input.read) return { title: NewSessionCopy.loadingTitle, message: NewSessionCopy.loadingOne(input.computer) };
  if (!input.found) return { title: NewSessionCopy.goneTitle, message: NewSessionCopy.gone(input.computer) };
  return null;
}

/** A computer the phone has saved, as the empty sheet reads it. */
export type NewSessionComputer = {
  label: string;
  /** Its summary has been read at least once. */
  read: boolean;
  /** Its last read failed. */
  failed: boolean;
};

/** What New session does when the sheet would have no row. */
export type NewSessionEmpty =
  { kind: 'addComputer' } | { kind: 'addProject' } | { kind: 'notice'; notice: NewSessionNotice };

/**
 * An empty project list means "no projects" only when every computer was read; a computer still
 * loading its first summary, or whose read failed, is skipped by the list, so it says so instead.
 */
export function newSessionEmptyList(computers: readonly NewSessionComputer[]): NewSessionEmpty {
  if (computers.length === 0) return { kind: 'addComputer' };
  const unread = computers.filter((computer) => !computer.read);
  if (unread.length === 0) return { kind: 'addProject' };
  const failed = unread.filter((computer) => computer.failed);
  if (failed.length > 0) {
    return {
      kind: 'notice',
      notice: {
        title: NewSessionCopy.offlineTitle,
        message: NewSessionCopy.unreachable(failed.map((computer) => computer.label)),
      },
    };
  }
  return { kind: 'notice', notice: { title: NewSessionCopy.loadingTitle, message: NewSessionCopy.loading } };
}

function notice(title: string, message: string): NewSessionStart {
  return { kind: 'notice', notice: { title, message } };
}

/** The pencil in the Sessions title row, beside the bell and the menu. */
export function NewSessionButton({
  color,
  style,
  onPress,
}: {
  color: string;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={NewSessionCopy.button} style={style} onPress={onPress}>
      <EditGlyph size={20} color={color} />
    </Pressable>
  );
}
