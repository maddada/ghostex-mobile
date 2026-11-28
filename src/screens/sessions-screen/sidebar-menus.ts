/**
 * The Sessions list's session and project context menus, as data in the shape
 * gx-core's `MenuItem::to_json` writes (packages/gx-core/src/sidebar_menu/item.rs):
 * labels, icon ids, headings, separators, submenus and the same command
 * payloads (`{type: 'command', message}`, `batch`, `sessionAction`,
 * `projectMembership`). Nothing here draws or runs anything; the renderer is
 * ./sidebar-menu-view.tsx and the commands run in ./use-sessions-screen-menus.tsx.
 *
 * CDXC:ContextMenus 2026-11-20 SEE-ALSO: packages/gx-core/src/sidebar_menu/layout.rs, where the user's decision
 * (Q4292, "Apply as shown") is recorded. The session menu is no longer a row-for-row port of the desktop's: its order,
 * grouping, names and icons are the `phoneRow` spot of that one list, read from the chat core (session-menu/layout.ts),
 * and this file only fills each of its places with the phone's rows (`sessionMenuPlaces`), the same way gx-core
 * `full_menu` fills the desktop's `sidebar` spot. An item the phone cannot run (no `ghostex` verb for it, or it acts on
 * the computer's own screen) fills nothing rather than being drawn dead. The chat's ⋯ and the terminal's ⋯ fill their
 * shared places (Coordinator, Copy, Tag As, Link to…) from the same builders for their session.
 *
 * SEE-ALSO: packages/gx-core/src/sidebar_menu/{session,project,membership,capabilities,copy,clipboard}.rs,
 * packages/gx-core/src/sidebar_view/tags.rs (the default tag list).
 */

import { staysUnderCoordinator } from '../../contract/coordinatorTree';
import { SNOOZE_PRESETS, type SnoozePreset } from '../../contract/unified/snooze';
import {
  displayStatus,
  EMPTY_CUSTOM_SESSION_TAGS,
  hasQuestion,
  NO_SUMMARY_CAPABILITIES,
  type GhostexCustomSessionTags,
  type GhostexMobileSummary,
  type GhostexProject,
  type GhostexProjectCollection,
  type GhostexSession,
  type GhostexSummaryCapabilities,
} from '../../contract/mobileSummary';
import { COMMAND_ICONS } from '../../assets/tablerIcons.generated';
import { MORE_DETAILS_LINE, sessionLinkText, sessionMentionText } from './sessionMention';
import { claudeCloudPageUrl } from '../../contract/claudeCloud';
import { hasBackgroundWork } from '../../components/sessions/sessionStatus';
import type { SessionWorkLinks, WorkLinkKind } from '../../commands/ghostexCli';
import { enabledVisibleTagIds } from '../../contract/sessionTagList';
import { effectiveSessionTag, SESSION_TAG_SECTIONS } from '../../contract/sessionTags';
import { FORK_AGENT_ICONS, isCoordinatorAgent } from '../../sessions/sessionCommands';
import { sessionNotesOnIn } from '../../sessions/sessionNotesSwitch';
import { closeAfterDoneOnIn, delayedSendOnIn } from '../../sessions/delayedActionsSwitch';
import { sessionTagsOnIn } from '../../sessions/sessionTagsSwitch';
import { beadsOnIn } from '../../beads/featureSwitch';
import {
  assembleSessionMenu,
  entryDanger,
  entryIcon,
  entryLabel,
  type SessionMenuLayout,
  type SessionMenuMake,
} from '../../session-menu/layout';

// ---------------------------------------------------------------------------
// The menu shape (gx-core `MenuItem` JSON and `MenuCommand` payloads).
// ---------------------------------------------------------------------------

/** The gxserver-bound messages a `command` row carries (gx-core `commands.rs` `message`). */
export type SidebarMenuMessage =
  | { type: 'setSessionSleeping'; sessionId: string; sleeping: boolean }
  | { type: 'setSessionPinned'; sessionId: string; pinned: boolean }
  | { type: 'setSessionParked'; sessionId: string; parked: boolean }
  | { type: 'setSessionTag'; sessionId: string; sessionTag: string | null }
  | { type: 'closeSession'; sessionId: string }
  | { type: 'closeSessions'; sessionIds: string[] }
  | { type: 'setSessionsSleeping'; sessionIds: string[]; sleeping: true; source: 'sleepBelow' }
  | { type: 'toggleCloseAfterDone'; sessionId: string }
  | { type: 'forkSession'; sessionId: string }
  | { type: 'fullReloadSession'; sessionId: string }
  | { type: 'makeCoordinator'; sessionId: string }
  | { type: 'sleepInactiveCoordinatorThreads'; sessionId: string }
  | { type: 'exportSessionTranscript'; sessionId: string }
  | { type: 'cancelDelayedSend'; sessionId: string }
  | { type: 'copySessionDetails'; sessionId: string; text: string }
  | { type: 'copyText'; text: string }
  | { type: 'setSessionWorkLinks'; sessionId: string; links: SessionWorkLinks }
  | { type: 'copyWorkspaceProjectPathForGroup'; groupId: string }
  | { type: 'removeWorkspaceProjectForGroup'; groupId: string }
  | { type: 'wakeProjectSleepingSessions'; groupId: string }
  | { type: 'sleepInactiveProjectSessions'; groupId: string }
  | { type: 'fullReloadProjectZmxSessions'; groupId: string }
  | { type: 'closeInactiveProjectSessions'; groupId: string };

export type SidebarMenuCommand =
  | { type: 'command'; message: SidebarMenuMessage }
  | { type: 'batch'; messages: SidebarMenuMessage[] }
  | { type: 'sessionAction'; sessionId: string; action: 'rename' | 'note' | 'delayedSend' }
  /** Opens the Link to picker for one kind (gx-core `MenuCommand::link_work`). */
  | { type: 'sessionAction'; sessionId: string; action: 'linkWork'; kind: WorkLinkKind }
  /** The phone's own row: a voice call about this session (`src/voice/callAbout.ts`). */
  | { type: 'voiceCall'; sessionId: string }
  /** Move to project: a chat in No project's project sheet (./move-to-project.ts). */
  | { type: 'moveToProject'; sessionId: string }
  /** The Unified list's Snooze row: gxserver's `/api/snoozeSession` at the preset's wake time, then a sleep (`contract/unified/snooze.ts`). */
  | { type: 'snooze'; sessionId: string; preset: SnoozePreset }
  /** The Unified list's Unsnooze row: gxserver's `/api/unsnoozeSession`. */
  | { type: 'unsnooze'; sessionId: string }
  /** Clean Up Worktree / Keep Worktree: answers the merged PR's offer as the row's sheet does (`WorkChipActions.answerCleanup`). */
  | { type: 'answerWorkCleanup'; sessionId: string; answer: 'cleanUp' | 'keep' }
  /** The phone's own row: the session's links sheet (`src/chat/native/SessionLinksSheet.tsx`). */
  | { type: 'sessionLinks'; sessionId: string }
  /** The phone's own row: the session's project's Changes screen (`src/screens/ChangesScreen.tsx`). */
  | { type: 'changes'; sessionId: string }
  /** The phone's own row: the session's project's Beads screen (`src/screens/BeadsScreen.tsx`). */
  | { type: 'beads'; sessionId: string }
  /**
   * The Unified list's own row: the Actions… list of the session's computer and project, which the Project list
   * opens from the project menu (the Unified list has no project menu).
   */
  | { type: 'projectActions'; sessionId: string }
  /**
   * The phone's own project menu rows (the project menu's layout, gx-core `project_menu_layout`): New Terminal,
   * Actions…, Files, Details, Move Project Up and Down, Refresh Sessions. The project menu's screen runs them.
   */
  | { type: 'projectOwn'; action: ProjectOwnAction }
  /** The phone's own row: a Claude cloud session's terminal, whose tap opens claude.ai (`contract/claudeCloud.ts`). */
  | { type: 'claudeCloudTerminal'; sessionId: string }
  /** gx-core `MenuCommand::coordinator_session`: an orchestrator's Goal & Instructions / Memory / View playbook, a thread's Mark Thread Done / Reopen Thread. */
  | {
      type: 'coordinatorSessionAction';
      sessionId: string;
      action: 'goal' | 'memory' | 'viewPlaybook' | 'markDone' | 'reopen' | 'makeMain' | 'unlinkLead' | 'stopLeading';
    }
  | {
      type: 'projectMembership';
      groupId: string;
      action: 'createCollection' | 'moveCollection';
      collectionId?: string;
    }
  /** A row the screen drawing the menu performs itself (the terminal ⋯'s own rows, components/terminal/TerminalMenu.tsx). */
  | { type: 'host'; action: string };

/** One menu row: a label with an action, a submenu, a heading, or a separator. */
export type SidebarMenuItem = {
  label?: string;
  /** Dimmed text after the label: what a Link to row is linked to. */
  suffix?: string;
  /** Desktop icon id (`titlebar/<id>.svg`), or a custom tag's catalog icon id. */
  icon?: string;
  iconColor?: string;
  /** A colour swatch drawn instead of an icon. */
  color?: string;
  checked: boolean;
  disabled: boolean;
  danger?: true;
  heading?: true;
  separator?: true;
  /** `presentation: 'page'`: the submenu replaces the panel (every submenu does on the phone). */
  presentation?: 'page';
  children?: SidebarMenuItem[];
  /** A row of icon buttons across the menu, each an action row of its own (gx-core `MenuItem::quick_row`). */
  quick?: SidebarMenuItem[];
  command?: SidebarMenuCommand;
  /** Where the screen draws rows of its own (a layout's host place, `sidebarMenuView`'s `hostSlots`). */
  hostSlot?: string;
};

function row(label: string, icon: string, command: SidebarMenuCommand): SidebarMenuItem {
  return { label, icon, command, checked: false, disabled: false };
}

function submenu(label: string, icon: string, children: SidebarMenuItem[]): SidebarMenuItem {
  return { label, icon, children, checked: false, disabled: false };
}

function separator(): SidebarMenuItem {
  return { separator: true, checked: false, disabled: false };
}

function command(message: SidebarMenuMessage): SidebarMenuCommand {
  return { type: 'command', message };
}

// ---------------------------------------------------------------------------
// The desktop settings the menus read.
// ---------------------------------------------------------------------------

/** The session card hover buttons (gx-core `HoverAction`). */
type HoverAction = 'rename' | 'pin' | 'note' | 'snooze' | 'closeAfterDone' | 'tag' | 'park' | 'sleep' | 'close';

/**
 * CDXC:ContextMenus 2026-09-25 WHY:
 * The desktop menu is shaped by Settings the phone cannot read, apart from the two Sidebar organization sync carries
 * (Enable session parking and the Session Tags list, passed in `SessionMenuInput` since 2026-11-12). So the phone
 * uses the desktop DEFAULTS for the rest (gx-core `SidebarSettings::default`), which also keep the Copy
 * section (the two debugging copy switches are off) and the Spaces submenu (Spaces are off) out.
 * The one deliberate difference is the hover strip: the phone has no hover buttons, so its strip is
 * the desktop default (Tag, Park and Sleep left of the chevron, Close right of it) WITHOUT Close.
 * Close then always fills the layout's last place, as on the desktop whenever Close is not a hover button.
 */
const PHONE_MENU_SETTINGS = {
  enableSessionParking: true,
  showTagMenuWhenParking: true,
  showSessionCardHoverButtonsInContextMenu: true,
  hoverStrip: ['tag', 'park', 'sleep'] as readonly HoverAction[],
};

/** Built-in tag glyph ids (gx-core `builtin_presentation`); the renderer maps them to TAG_ICONS. */
export const BUILTIN_TAG_ICON_IDS: Readonly<Record<string, string>> = {
  favorite: 'star-filled',
  'high-priority': 'alert-triangle',
  'low-priority': 'arrow-down',
  research: 'microscope',
  todo: 'checkbox',
  'in-progress': 'player-play',
  testing: 'test-pipe',
  blocked: 'barrier-block',
  'on-hold': 'player-pause',
  done: 'circle-check',
  bug: 'bug',
  feature: 'puzzle',
  design: 'palette',
};

// ---------------------------------------------------------------------------
// Session facts (gx-core `capabilities.rs`).
// ---------------------------------------------------------------------------

export function isBrowserSession(session: GhostexSession): boolean {
  return session.kind === 'browser' || session.surface === 'browser';
}

export function isSleepingSession(session: GhostexSession): boolean {
  const status = displayStatus(session);
  return session.isSleeping || status === 'sleep' || status === 'sleeping';
}

/** gx-core `lifecycle_state == "running"` (`canSleepSidebarSession`). */
export function isRunningSession(session: GhostexSession): boolean {
  return !isSleepingSession(session) && session.status === 'running';
}

/**
 * A running terminal the agent is not busy in: what the project menu's Sleep Inactive and Close
 * Inactive act on. The desktop also skips rows with background work, a fact the phone's summary
 * does not carry.
 */
export function isInactiveSession(session: GhostexSession): boolean {
  const status = displayStatus(session);
  return !isBrowserSession(session) && isRunningSession(session) && status !== 'working' && status !== 'attention';
}

/** A session a Sleep or Wake menu row may act on: never a Native chat, which Ghostex stops and starts by itself (`canSleep` above). */
export function isSleepableSession(session: GhostexSession): boolean {
  return session.nonCliMode !== true;
}

function sessionAgentIcon(session: GhostexSession): string {
  return (session.agentIcon.length > 0 ? session.agentIcon : session.agent).trim().toLowerCase();
}

/**
 * gx-core `transcript_agent`: which transcript family an agent belongs to, or null. A copy of
 * `SESSION_CHAT_AGENTS` in the main repo's packages/gx-protocol/src/session_chat_agents.rs, which
 * this app cannot link; change both together.
 */
function transcriptAgent(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    switch (candidate.trim().toLowerCase()) {
      case 'antigravity':
      case 'antigravity-cli':
      case 'antigravity cli':
      case 'agy':
        return 'antigravity';
      case 'claude':
      case 'openclaude':
        return 'claude';
      case 'codex':
        return 'codex';
      case 'copilot':
      case 'github copilot':
      case 'github-copilot':
        return 'copilot';
      case 'cursor':
      case 'cursor-agent':
      case 'cursor-cli':
      case 'cursor cli':
        return 'cursor';
      case 'empryo':
        return 'empryo';
      case 'grok':
      case 'grok-build':
        return 'grok';
      case 'hermes':
      case 'hermes-agent':
      case 'hermes agent':
        return 'hermes';
      case 'opencode':
        return 'opencode';
      case 'pi':
      case 'omp':
        return 'pi';
      case 'zcode':
      case 'zcode-cli':
        return 'zcode';
      case 'freebuff':
        return 'freebuff';
      case 'dsh':
      case 'dsh-tui':
      case 'deepseek':
      case 'deepseek harness':
        return 'dsh';
      default:
        break;
    }
  }
  return null;
}

/** gx-core `supports_full_reload`, the rule this computer's own rows use. */
function supportsFullReload(session: GhostexSession, agentIcon: string): boolean {
  if (agentIcon === 'antigravity-cli') return session.agentSessionId.trim().length > 0;
  return ['codex', 'claude', 'opencode', 'pi', 'cursor-cli'].includes(agentIcon);
}

type SessionCapabilities = {
  isBrowser: boolean;
  canCloseAfterDone: boolean;
  canDelayedSend: boolean;
  canExportTranscript: boolean;
  canFork: boolean;
  canFullReload: boolean;
  canMakeCoordinator: boolean;
  canOpenNote: boolean;
  canPark: boolean;
  canRename: boolean;
  canSleep: boolean;
  canTag: boolean;
};

/**
 * gx-core `SessionCapabilities::resolve` for a row on the machine the menu is about, which is how
 * the computer's own sidebar sees it. Note, Park and Handoff / Export additionally need the
 * session's project id, because their `ghostex` verbs select the session by project and id.
 */
function sessionCapabilities(session: GhostexSession): SessionCapabilities {
  const isBrowser = isBrowserSession(session);
  const terminal = !isBrowser;
  const draft = session.isDraft === true;
  const agentIcon = sessionAgentIcon(session);
  const hasProject = session.projectId.length > 0;
  return {
    isBrowser,
    // gxserver refuses Close After Done for an orchestrator (CDXC:Sessions 2026-10-21 in
    // server/src/close_after_done.rs), so its menu offers none, like gx-core's `can_close_after_done`.
    canCloseAfterDone: terminal && !session.isCoordinator,
    canDelayedSend: terminal,
    canExportTranscript:
      terminal &&
      !draft &&
      hasProject &&
      transcriptAgent([session.agentName, session.agentIcon, session.agent]) !== null,
    canFork: terminal && !draft && FORK_AGENT_ICONS.includes(agentIcon),
    canFullReload: terminal && !draft && supportsFullReload(session, agentIcon),
    // gx-core `full_menu` shows Make Coordinator on the same sessions gxserver can promote: an
    // orchestrator agent (`isCoordinatorAgent`), not a draft, not in a box, and not already a coordinator or a coordinator's thread.
    canMakeCoordinator:
      terminal &&
      !draft &&
      hasProject &&
      session.agentbox === undefined &&
      !session.isCoordinator &&
      (session.coordinatorSessionId ?? '').length === 0 &&
      isCoordinatorAgent(agentIcon),
    canOpenNote: terminal && hasProject && session.agentSessionId.trim().length > 0,
    canPark: terminal && hasProject,
    canRename: terminal,
    // CDXC:SessionSleep 2026-11-27 DECISION: User: "don't show sleep as an option if a chat is a native chat please" (gx-core sidebar_menu/capabilities.rs).
    canSleep: session.nonCliMode !== true && (isRunningSession(session) || isSleepingSession(session)),
    canTag: terminal,
  };
}

// ---------------------------------------------------------------------------
// Tags (gx-core `enabled_visible_tag_sections` over the synced Session Tags list, contract/sessionTagList.ts).
// ---------------------------------------------------------------------------

type TagOption = { value: string; label: string; icon: string; color: string };

function tagSections(
  current: string | undefined,
  catalog: GhostexCustomSessionTags,
  tagListItems: unknown,
): TagOption[][] {
  const shown = enabledVisibleTagIds(tagListItems, catalog, current === undefined ? [] : [current]);
  const builtins = SESSION_TAG_SECTIONS.map((section, index) =>
    section.options
      .filter((option) => (shown.builtins[index] ?? []).includes(option.value))
      .map((option) => ({
        value: option.value,
        label: option.label,
        icon: BUILTIN_TAG_ICON_IDS[option.value] ?? 'tag',
        color: option.color,
      })),
  );
  // A custom id the catalog no longer has is dropped, the same as the desktop.
  const custom: TagOption[] = [];
  for (const tagId of shown.custom) {
    const tag = catalog.tags[tagId];
    if (tag === undefined) continue;
    custom.push({
      value: tagId,
      label: tag.name,
      icon: COMMAND_ICONS[tag.icon] !== undefined ? tag.icon : 'tag',
      color: tag.color,
    });
  }
  return [...builtins, custom].filter((section) => section.length > 0);
}

function tagItems(session: GhostexSession, catalog: GhostexCustomSessionTags, tagListItems: unknown): SidebarMenuItem[] {
  const current = effectiveSessionTag(session);
  const items: SidebarMenuItem[] = [];
  tagSections(current, catalog, tagListItems).forEach((section, index) => {
    if (index > 0) items.push(separator());
    for (const option of section) {
      const checked = current === option.value;
      items.push({
        ...row(
          option.label,
          option.icon,
          command({
            type: 'setSessionTag',
            sessionId: session.sessionId,
            sessionTag: checked ? null : option.value,
          }),
        ),
        iconColor: option.color,
        checked,
      });
    }
  });
  return items;
}

/** A Tag As row turned into "set this tag, then park" (gx-core `park_with_tag`). */
function parkWithTag(item: SidebarMenuItem, session: GhostexSession): SidebarMenuItem {
  if (item.command?.type !== 'command' || item.command.message.type !== 'setSessionTag') {
    return item;
  }
  const tag = item.command.message.sessionTag;
  return {
    ...item,
    command: {
      type: 'batch',
      messages: [
        {
          type: 'setSessionTag',
          sessionId: session.sessionId,
          // The row for the tag the session already has clears it; parking through it keeps it.
          sessionTag: tag === null ? (effectiveSessionTag(session) ?? null) : tag,
        },
        { type: 'setSessionParked', sessionId: session.sessionId, parked: true },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// The session row menu (gx-core `session.rs`).
// ---------------------------------------------------------------------------

export type SessionMenuInput = {
  session: GhostexSession;
  /** The capabilities of the session's computer, which Sleep Below's question rule reads (`hasQuestion`). */
  capabilities: GhostexSummaryCapabilities;
  /** The machine's custom tag catalog. */
  customTags: GhostexCustomSessionTags;
  /** The rows drawn under this one in its group, for Sleep Below and Close Below. */
  below: readonly GhostexSession[];
  /** On an orchestrator row: its own threads on the machine, for Sleep Inactive Threads. */
  threads: readonly GhostexSession[];
  /** The session's project, whose title and worktree Copy Details quotes; null when unknown. */
  project: Pick<
    GhostexProject,
    'name' | 'path' | 'worktree' | 'workMode' | 'workLinear' | 'workGithubOff' | 'workTracker' | 'isNoProject'
  > | null;
  /** The computer's gxserver has the voice agent, so the menu offers Voice Call. */
  voiceCall?: boolean;
  /** The computer has Session notes on (`sessions/sessionNotesSwitch.ts`), so the menu offers Note. */
  sessionNotes?: boolean;
  /**
   * The computer has Session Tags on (`sessions/sessionTagsSwitch.ts`), so the menu offers Tag As and the tag prompt
   * when parking; off, Add to Favorites / Remove from Favorites takes Tag As's place. On when absent.
   */
  sessionTags?: boolean;
  /**
   * The computer has Delayed Send on (`sessions/delayedActionsSwitch.ts`), so the menu offers Delayed Send and Edit
   * Delayed Send; off, an already scheduled one keeps Disable Delayed Send. On when absent.
   */
  delayedSend?: boolean;
  /**
   * The computer has Close After Done on (`sessions/delayedActionsSwitch.ts`); off, the row stays only on a session
   * already set to close, so it can be turned off. On when absent.
   */
  closeAfterDone?: boolean;
  /** The computer has its Beads extension on (`beads/featureSwitch.ts`), so the menu offers Beads. Off when absent. */
  beads?: boolean;
  /** The menu offers Snooze (or Unsnooze), as the desktop's does, run through gxserver directly. */
  snooze?: boolean;
  /**
   * The Unified list's Actions… row, with the icon of the action it would mark (`player-play`, or `world` for a
   * browser action); absent when the project and computer list no action, and in the Project list's menu.
   */
  actionsIcon?: 'player-play' | 'world';
  /** The synced Session Tags list (`sidebarSessionTagListItems`), which tags Tag As offers; the default list when absent. */
  tagListItems?: unknown;
  /** Enable session parking, synced: off leaves Park out, as the desktop does. On when absent. */
  parking?: boolean;
};

/**
 * A session menu's input from its computer's summary alone, for the chat's and the terminal's ⋯, which open on one
 * session rather than a list row: nothing is below it, and the rows only the long-press offers (Voice Call, Snooze,
 * Actions…) are the screen's own there.
 */
export function sessionMenuInputFromSummary(
  summary: GhostexMobileSummary | null | undefined,
  session: GhostexSession,
): SessionMenuInput {
  return {
    session,
    capabilities: summary?.capabilities ?? NO_SUMMARY_CAPABILITIES,
    customTags: summary?.customSessionTags ?? EMPTY_CUSTOM_SESSION_TAGS,
    below: [],
    threads: session.isCoordinator
      ? (summary?.sessions ?? []).filter(
          (thread) => thread.coordinatorProjectId === session.projectId && thread.coordinatorSessionId === session.sessionId,
        )
      : [],
    project: summary?.projects.find((project) => project.projectId === session.projectId) ?? null,
    sessionNotes: sessionNotesOnIn(summary),
    sessionTags: sessionTagsOnIn(summary),
    delayedSend: delayedSendOnIn(summary),
    closeAfterDone: closeAfterDoneOnIn(summary),
    beads: beadsOnIn(summary),
    tagListItems: summary?.sessionTagListItems,
    parking: summary?.enableSessionParking !== false,
  };
}

// ---------------------------------------------------------------------------
// The Copy submenu (gx-core `copy.rs` and `clipboard.rs`).
// ---------------------------------------------------------------------------

/** gx-core `format_identifier`: a known agent's proper name, else the id split and capitalized. */
function formatIdentifier(value: string): string {
  const known: Record<string, string> = {
    browser: 'Browser',
    claude: 'Claude',
    codex: 'Codex',
    copilot: 'Copilot',
    'cursor-cli': 'Cursor CLI',
    opencode: 'OpenCode',
    pi: 'Pi',
    terminal: 'Terminal',
  };
  if (known[value] !== undefined) return known[value];
  return value
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * gx-core `session_details_text`: what another agent needs to reach this session, ending with a
 * line that tells it to run `ghostex agents` (CDXC:ContextMenus 2026-10-28 in gx-core
 * clipboard.rs). The phone sees every session as one on the computer the menu is about, which
 * is how that computer's own sidebar copies it, so there is no Remote Machine line.
 */
/** The stored title Copy Details and Copy Reference quote. */
function sessionTitle(session: GhostexSession): string {
  return (
    [session.title, session.primaryTitle, session.displayTitle]
      .map((value) => value.trim())
      .find((value) => value.length > 0) ?? 'Session'
  );
}

function sessionDetailsText(session: GhostexSession, project: SessionMenuInput['project']): string {
  const lines = ['Ghostex Session'];
  const line = (label: string, value: string | undefined): void => {
    const text = (value ?? '').trim();
    if (text.length > 0) lines.push(`${label}: ${text}`);
  };
  line('Agent', session.agentIcon.length > 0 ? formatIdentifier(session.agentIcon) : undefined);
  line('Title', sessionTitle(session));
  line('Global Ref', session.globalRef);
  line('Agent Session ID', session.agentSessionId);
  line(session.provider.length > 0 ? session.provider : 'zmx', session.providerSessionName || session.zmxName);
  line('Project', project?.name ?? session.projectName);
  line('Project Path', project?.path ?? session.projectPath);
  line('Worktree', project?.worktree?.name);
  line('Worktree Branch', project?.worktree?.branch);
  lines.push(MORE_DETAILS_LINE);
  return lines.join('\n');
}

/**
 * A session's Link to submenu (Issues Workflow): pick the PR, Linear issues, Linear project, GitHub
 * issues or GitHub project the session is about, unlink one kind, or hand the links back to the
 * branch. Only sessions of projects with Issues Workflow on get it.
 *
 * CDXC:WorkMode 2026-10-09 DECISION:
 * User: start any session the normal way and link it later: right-click → Link to → Pull request…, Linear issue…, Linear project…, GitHub issue…. Something already linked shows its ID in the menu; picking another one replaces it and Unlink removes it. Only sessions of projects with work mode on get the submenu. The phone's session menu matches the desktop's, so it has the same submenu, and its picker is a searchable list over the computer's suggestions (`ghostex link-session --candidates`).
 *
 * SEE-ALSO: packages/gx-core/src/sidebar_menu/link_menu.rs, ./work-link-picker.tsx.
 */
function linkSubmenu(
  session: GhostexSession,
  project: SessionMenuInput['project'],
  layout: SessionMenuLayout,
): SidebarMenuItem | null {
  if (project?.workMode !== true || session.projectId.length === 0) return null;
  const id = session.sessionId;
  const work = session.work;
  const issues = work?.linearIssues ?? [];
  const githubNumbers = work?.githubIssueNumbers ?? [];
  const pullRequest = work?.pullRequestNumber != null ? `#${work.pullRequestNumber}` : undefined;
  const linearIssues = issues.length > 0 ? issues.map((issue) => issue.identifier).join(', ') : undefined;
  const linearProject = (work?.linearProjectName ?? '').length > 0 ? work?.linearProjectName : undefined;
  const githubIssues = githubNumbers.length > 0 ? githubNumbers.map((number) => `#${number}`).join(', ') : undefined;
  const githubProject = (work?.githubProjectName ?? '').length > 0 ? work?.githubProjectName : undefined;
  const pick = (label: string, icon: string, kind: WorkLinkKind, linked: string | undefined): SidebarMenuItem => ({
    ...row(label, icon, { type: 'sessionAction', sessionId: id, action: 'linkWork', kind }),
    ...(linked === undefined ? {} : { suffix: linked }),
  });
  /*
   * CDXC:WorkMode 2026-10-09 DECISION:
   * User: in a workspace whose tracker is GitHub, the phone matches the desktop: Link to offers GitHub issues and GitHub projects instead of Linear's (gx-core link_menu.rs, from the project's `workTracker`). Links of the other kind that are already set can still be unlinked below.
   *
   * CDXC:WorkMode 2026-10-24 DECISION:
   * User: "Linear parts appear once you add a Linear key, GitHub parts once gh is signed in": Pull request… and the GitHub rows need `gh` on the computer, the Linear rows a Linear key, as on the desktop.
   */
  const github = project.workGithubOff !== true;
  const children: SidebarMenuItem[] = [];
  if (github) children.push(pick('Pull request…', 'git-pull-request', 'pullRequest', pullRequest));
  if (project.workTracker === 'github') {
    if (github) {
      children.push(
        pick('GitHub issue…', 'circle-dot', 'githubIssue', githubIssues),
        pick('GitHub project…', 'box', 'githubProject', githubProject),
      );
    }
  } else if (project.workLinear === true) {
    children.push(
      pick('Linear issue…', 'hash', 'linearIssue', linearIssues),
      pick('Linear project…', 'box', 'linearProject', linearProject),
    );
  }
  // Unlink writes "explicitly none" for that kind, so the branch cannot bring it back.
  const unlink = (label: string, links: SessionWorkLinks): SidebarMenuItem =>
    row(label, 'unlink', command({ type: 'setSessionWorkLinks', sessionId: id, links }));
  const unlinkRows: SidebarMenuItem[] = [];
  if (pullRequest !== undefined) unlinkRows.push(unlink('Unlink pull request', { pullRequest: 'none' }));
  if (linearIssues !== undefined) {
    unlinkRows.push(unlink(issues.length > 1 ? 'Unlink Linear issues' : 'Unlink Linear issue', { linearIssues: [] }));
  }
  if (linearProject !== undefined) unlinkRows.push(unlink('Unlink Linear project', { linearProject: '' }));
  if (githubIssues !== undefined) {
    unlinkRows.push(
      unlink(githubNumbers.length > 1 ? 'Unlink GitHub issues' : 'Unlink GitHub issue', { githubIssues: [] }),
    );
  }
  if (githubProject !== undefined) unlinkRows.push(unlink('Unlink GitHub project', { githubProject: 'none' }));
  if (unlinkRows.length > 0) children.push(...(children.length > 0 ? [separator()] : []), ...unlinkRows);
  if (work?.handSet === true) {
    children.push(
      ...(children.length > 0 ? [separator()] : []),
      row(
        'Back to automatic',
        'refresh',
        command({ type: 'setSessionWorkLinks', sessionId: id, links: { clear: true } }),
      ),
    );
  }
  return children.length > 0 ? layoutSubmenu(layout, 'linkTo', children) : null;
}

/**
 * The menu's own Copy Reference row (named Copy ID until 2026-11-25), or null while the session has no Global Ref yet.
 *
 * CDXC:SessionChat 2026-11-25 DECISION:
 * User: "make threads and session say Copy Reference" (gx-chat-core `transcript/item_references.rs`): the row is
 * Copy Reference, one name with every question, work item, Live page and message; it still copies
 * `[<session title>](<Global Ref>)`. The Beads screen's Copy ID is another thing and keeps its name.
 *
 * CDXC:ContextMenus 2026-11-12 DECISION:
 * User: "i want a new Copy ID that let's me just copy the id and name of an agent so i can mention it in other chats" (2026-10-28), then (2026-11-12) "move Copy ID to sit directly above Tag As": Copy ID leaves the Copy submenu and is a row of the menu itself, right above Tag As, as on the desktop (gx-core copy.rs `copy_id_row`). It copies `[<session title>](<Global Ref>)`.
 * From 2026-11-15 it was a button in the menu's quick row instead (a decision the one session menu of 2026-11-20 in packages/gx-core/src/sidebar_menu/layout.rs superseded).
 *
 * CDXC:ContextMenus 2026-11-18 DECISION:
 * User: "please move copy id to the top of the copy menu item in the context menu for a session in the sidebar and move Popup to be the 3rd button after rename and pin". Copy ID is the first row of the Copy submenu again (`copySubmenu`), as on the desktop (gx-core copy.rs); the phone has no popup, so its quick row is Rename, Pin, Voice Call.
 */
function copyIdRow(session: GhostexSession): SidebarMenuItem | null {
  const ref = session.globalRef.trim();
  if (ref.length === 0) return null;
  return row('Copy Reference', 'hash', command({ type: 'copyText', text: sessionMentionText(sessionTitle(session), ref) }));
}

/**
 * The Copy submenu: Copy Details always, the other rows only when the session has something for
 * them.
 *
 * CDXC:ContextMenus 2026-10-09 DECISION:
 * User: Copy Details moves into a Copy submenu next to Copy Branch, Copy Linear ID, Copy PR Link and the like, for normal and work-mode sessions; it stays always available so anyone can hand a session to another agent. The phone's session menu matches the desktop's (2026-10-01), so it has the same submenu.
 *
 * CDXC:ContextMenus 2026-10-31 DECISION:
 * User (GitHub issue #373): a Copy Link row next to Copy Details copies the https page that opens the session (`https://ghostex.dev/open/session#<Global Ref>`), as on the desktop. A link opens on a computer; the phone only copies it for now.
 */
function copySubmenu(
  session: GhostexSession,
  project: SessionMenuInput['project'],
  layout: SessionMenuLayout,
): SidebarMenuItem {
  const copyId = copyIdRow(session);
  const children: SidebarMenuItem[] = copyId === null ? [] : [copyId];
  children.push(
    row(
      'Copy Details',
      'copy',
      command({
        type: 'copySessionDetails',
        sessionId: session.sessionId,
        text: sessionDetailsText(session, project),
      }),
    ),
  );
  const copyRow = (label: string, icon: string, text: string): void => {
    if (text.trim().length > 0) children.push(row(label, icon, command({ type: 'copyText', text })));
  };
  if (session.globalRef.trim().length > 0) {
    copyRow('Copy Link', 'link', sessionLinkText(session.globalRef.trim()));
  }
  const work = session.work;
  const linearIssues = work?.linearIssues ?? [];
  const lines = (values: readonly string[]): string =>
    values
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .join('\n');
  // The work-mode branch wins over the git probe's, as on the desktop (gx-core rows.rs).
  copyRow('Copy Branch', 'git-branch', (work?.branch ?? '').trim() || (session.gitBranch ?? ''));
  copyRow(
    linearIssues.length > 1 ? 'Copy Linear IDs' : 'Copy Linear ID',
    'hash',
    linearIssues.map((issue) => issue.identifier).join(', '),
  );
  copyRow('Copy Linear Link', 'link', lines(linearIssues.map((issue) => issue.url)));
  copyRow('Copy PR Link', 'git-pull-request', work?.pullRequestUrl ?? '');
  copyRow('Copy Issue Link', 'circle-dot', lines(work?.githubIssueUrls ?? []));
  copyRow('Copy Linear Project Link', 'box', work?.linearProjectUrl ?? '');
  // The claude.ai conversation a Claude cloud session's row is linked to (gx-core copy.rs).
  copyRow('Copy claude.ai Link', 'link', session.claudeCloud?.url ?? '');
  return layoutSubmenu(layout, 'copy', children);
}

/**
 * The `coordinator` place (gx-core `coordinator_rows`, CDXC:Coordinators 2026-10-13, the user's decision there): an
 * orchestrator's Make Main Coordinator and its Coordinator submenu, a lead-linked session's Unlink from Lead, a lead's
 * Stop Leading.
 */
function coordinatorPlaceRows(
  session: GhostexSession,
  sleepInactive: SidebarMenuItem | null,
  layout: SessionMenuLayout,
): SidebarMenuItem[] {
  if (session.isDraft === true) return [];
  const rows: SidebarMenuItem[] = [];
  if (session.isCoordinator) {
    // CDXC:Coordinators 2026-11-10 (gx-core `coordinator_rows`): gives this coordinator its project's
    // main-coordinator label on its computer; hidden on the main one and on Chief of Staff.
    if (!session.isMainCoordinator && !session.isChief) {
      rows.push(row('Make Main Coordinator', 'coordinator-crown-points', coordinatorAction(session, 'makeMain')));
    }
    /*
     * CDXC:Coordinators 2026-11-16 DECISION:
     * User (Android screenshot of a coordinator's long-press menu): "the context menu for coordinator is too long. Also
     * view playbook didn't have icon. Pls put all these under 1 menu". Goal & Instructions, Memory, View Playbook and
     * Sleep Inactive Threads are one Coordinator submenu (the crown icon) where the loose rows were; Make Main
     * Coordinator stays a row of its own above it. The desktop got the same (gx-core `coordinator_rows`, which this
     * must match; it also lists Playbook Overrides…, which the phone has no editor for).
     */
    const children: SidebarMenuItem[] = [
      row('Goal & Instructions…', 'checklist', coordinatorAction(session, 'goal')),
      row('Memory…', 'brain', coordinatorAction(session, 'memory')),
      // CDXC:Coordinators 2026-11-09 (gx-core `coordinator_rows`): the playbook this coordinator reads.
      row('View Playbook', 'book', coordinatorAction(session, 'viewPlaybook')),
    ];
    if (sleepInactive !== null) children.push(sleepInactive);
    rows.push(submenu(entryLabel(layout, 'coordinator'), entryIcon(layout, 'coordinator'), children));
  } else if ((session.coordinatorSessionId ?? '').length === 0 && (session.leadSessionId ?? '').length > 0) {
    // Lead links (gx-core `coordinator_rows`, CDXC:LeadLinks 2026-11-20): a linked session is an ordinary session, so
    // Unlink only, never Mark Thread Done; no menu ever offers linking.
    rows.push(row('Unlink from Lead', 'unlink', coordinatorAction(session, 'unlinkLead')));
  }
  if (session.isLead && !session.isCoordinator && session.leadLinkCount > 0) {
    const count = session.leadLinkCount;
    rows.push(
      row(
        count === 1 ? 'Stop Leading 1 Session' : `Stop Leading ${count} Sessions`,
        'unlink',
        coordinatorAction(session, 'stopLeading'),
      ),
    );
  }
  return rows;
}

/** The `markThreadDone` place (gx-core `thread_rows`): a thread's Mark Thread Done (disabled while it works or waits on an answer), or Reopen Thread once done. */
function threadRows(session: GhostexSession, layout: SessionMenuLayout): SidebarMenuItem[] {
  if (session.isDraft === true || session.isCoordinator || (session.coordinatorSessionId ?? '').length === 0) return [];
  const state = session.coordinatorThreadState;
  if (state === 'done') {
    return [layoutRow(layout, 'markThreadDone', coordinatorAction(session, 'reopen'), true)];
  }
  return [
    {
      ...layoutRow(layout, 'markThreadDone', coordinatorAction(session, 'markDone')),
      disabled: state === 'working' || state === 'waiting',
    },
  ];
}

function coordinatorAction(
  session: GhostexSession,
  action: 'goal' | 'memory' | 'viewPlaybook' | 'markDone' | 'reopen' | 'makeMain' | 'unlinkLead' | 'stopLeading',
): SidebarMenuCommand {
  return { type: 'coordinatorSessionAction', sessionId: session.sessionId, action };
}

/** A row under the layout's one name and icon for `id` (its reverse when `alt`), red when the layout says so. */
export function layoutRow(
  layout: SessionMenuLayout,
  id: string,
  command: SidebarMenuCommand,
  alt = false,
): SidebarMenuItem {
  const item = row(entryLabel(layout, id, alt), entryIcon(layout, id, alt), command);
  return entryDanger(layout, id) ? { ...item, danger: true } : item;
}

function layoutSubmenu(layout: SessionMenuLayout, id: string, children: SidebarMenuItem[], alt = false): SidebarMenuItem {
  return submenu(entryLabel(layout, id, alt), entryIcon(layout, id, alt), children);
}

/** A wake time still ahead (gx-core `session_is_snoozed`). */
function isSnoozedNow(session: GhostexSession): boolean {
  const wake = Date.parse(session.snoozedUntil ?? '');
  return Number.isFinite(wake) && wake > Date.now();
}

/** How a session menu's rows are put together around the places (gx-core `MenuItem` quick rows, submenus, lines). */
export const SIDEBAR_MENU_MAKE: SessionMenuMake<SidebarMenuItem> = {
  separator,
  tiles: (quick) => ({ quick, checked: false, disabled: false }),
  more: (label, icon, items) => submenu(label, icon, items),
  isSeparator: (item) => item.separator === true,
};

/**
 * What the phone's session menus fill each place of the one session menu with, for one session (gx-core `full_menu`'s
 * `fill`): none, one row, or a block. The long-press menu fills every place from here (`buildSessionMenu`); the chat's
 * and the terminal's ⋯ take the places they share with it (Coordinator, Mark Thread Done, Copy, Tag As, Close After
 * Done, Handoff / Export, Link to, Make Coordinator, Postpone By, Close) and fill the rest themselves.
 *
 * Fill nothing, because the phone has no way to run them: Switch Account, Branches, Box, claude.ai and Move to Group,
 * and Postpone By's presets (no verb for `/api/postponeDelayedSend`; Edit and Disable Delayed Send stay).
 */
export function sessionMenuPlaces(input: SessionMenuInput, layout: SessionMenuLayout): (id: string) => SidebarMenuItem[] {
  const {
    session,
    capabilities,
    customTags,
    below,
    threads,
    project,
    voiceCall = false,
    sessionNotes = true,
    sessionTags = true,
    delayedSend = true,
    closeAfterDone = true,
    snooze = false,
    actionsIcon,
    tagListItems,
    parking = true,
  } = input;
  const settings = { ...PHONE_MENU_SETTINGS, enableSessionParking: parking };
  const caps = sessionCapabilities(session);
  const id = session.sessionId;
  const enabled = settings.hoverStrip;
  // An action the hover strip offers is repeated in the menu too, with the two that have rows of
  // their own left out.
  const mirror: HoverAction[] = settings.showSessionCardHoverButtonsInContextMenu
    ? caps.isBrowser
      ? ['sleep']
      : enabled.filter((action) => action !== 'close' && action !== 'closeAfterDone')
    : [];
  const thread = staysUnderCoordinator(session);
  const shown = (action: HoverAction): boolean =>
    mirror.includes(action) || (action !== 'note' && !enabled.includes(action));
  const tags = (): SidebarMenuItem[] =>
    caps.canTag && sessionTags ? tagItems(session, customTags, tagListItems) : [];

  return (place: string): SidebarMenuItem[] => {
    switch (place) {
      // CDXC:WorkMode 2026-11-25 (gx-core layout.rs): while the merged PR's offer stands, also on a thread whose coordinator's banner answers it.
      case 'cleanUpWorktree':
        return session.work?.offerCleanup === true
          ? [layoutRow(layout, place, { type: 'answerWorkCleanup', sessionId: id, answer: 'cleanUp' })]
          : [];
      case 'keepWorktree':
        return session.work?.offerCleanup === true
          ? [layoutRow(layout, place, { type: 'answerWorkCleanup', sessionId: id, answer: 'keep' })]
          : [];
      case 'rename':
        return caps.canRename && shown('rename')
          ? [layoutRow(layout, 'rename', { type: 'sessionAction', sessionId: id, action: 'rename' })]
          : [];
      case 'pin': {
        const pinned = session.isPinned;
        // A coordinator's thread offers no Pin, Snooze or Park; a row still on one keeps its way back (gx-core
        // session.rs, CDXC:Coordinators 2026-11-25 in contract/coordinatorTree.ts).
        if (thread && !pinned) return [];
        return [layoutRow(layout, 'pin', command({ type: 'setSessionPinned', sessionId: id, pinned: !pinned }), pinned)];
      }
      case 'voiceCall':
        return voiceCall && !caps.isBrowser && session.isDraft !== true
          ? [layoutRow(layout, 'voiceCall', { type: 'voiceCall', sessionId: id })]
          : [];
      case 'snooze':
        // CDXC:Sidebar 2026-10-30 SEE-ALSO: gx-core `session.rs` `snooze`: Unsnooze on a snoozed session, else the presets.
        if (!snooze || caps.isBrowser || !shown('snooze') || (thread && !isSnoozedNow(session))) return [];
        return isSnoozedNow(session)
          ? [layoutRow(layout, 'snooze', { type: 'unsnooze', sessionId: id }, true)]
          : [
              layoutSubmenu(
                layout,
                'snooze',
                SNOOZE_PRESETS.map(({ preset, label }) =>
                  row(label, entryIcon(layout, 'snooze'), { type: 'snooze', sessionId: id, preset }),
                ),
              ),
            ];
      case 'park': {
        if (caps.isBrowser || !settings.enableSessionParking || !caps.canPark || !shown('park')) return [];
        const parked = session.isParked === true;
        if (thread && !parked) return [];
        const tagRows = tags();
        if (!parked && settings.showTagMenuWhenParking && tagRows.length > 0) {
          return [
            layoutSubmenu(layout, 'park', [
              row('No Tag Change', 'tag-off', command({ type: 'setSessionParked', sessionId: id, parked: true })),
              separator(),
              ...tagRows.map((item) => parkWithTag(item, session)),
            ]),
          ];
        }
        return [layoutRow(layout, 'park', command({ type: 'setSessionParked', sessionId: id, parked: !parked }), parked)];
      }
      case 'moveToProject':
        // CDXC:Projects 2026-11-27 (./move-to-project.ts): a chat in No project, once it has started (a draft's tray
        // picks its project), as gx-core session.rs `move_to_project_item` offers it.
        return project?.isNoProject === true && session.kind === 'agent' && session.isDraft !== true
          ? [layoutRow(layout, 'moveToProject', { type: 'moveToProject', sessionId: id })]
          : [];
      case 'coordinator': {
        // CDXC:Coordinators 2026-10-13 SEE-ALSO: the user's decision on `is_sleep_inactive_session` in server/src/coordinators/sleep_threads.rs, which decides which threads sleep (gx-core `coordinator_rows` draws the desktop's twin row). The disabled test is only the phone's Sleep Inactive hint, which never greys out a row gxserver would act on.
        const sleepInactive: SidebarMenuItem | null =
          session.isCoordinator && session.isDraft !== true
            ? {
                ...row('Sleep Inactive Threads', 'moon', command({ type: 'sleepInactiveCoordinatorThreads', sessionId: id })),
                disabled: !threads.some(isInactiveSession),
              }
            : null;
        return coordinatorPlaceRows(session, sleepInactive, layout);
      }
      case 'markThreadDone':
        return threadRows(session, layout);
      case 'copy':
        return [copySubmenu(session, project, layout)];
      case 'tagAs': {
        // Session Tags off: favouriting stays (Favorite is a tag value), in Tag As's place (gx-core `favorite_rows`).
        if (!sessionTags) {
          if (!caps.canTag) return [];
          const favorite = effectiveSessionTag(session) === 'favorite';
          return [
            row(
              favorite ? 'Remove from Favorites' : 'Add to Favorites',
              favorite ? 'star-filled' : 'star',
              command({ type: 'setSessionTag', sessionId: id, sessionTag: favorite ? null : 'favorite' }),
            ),
          ];
        }
        const tagRows = shown('tag') ? tags() : [];
        return tagRows.length > 0 ? [layoutSubmenu(layout, 'tagAs', tagRows)] : [];
      }
      case 'sleep': {
        if (!caps.canSleep || !shown('sleep')) return [];
        const sleeping = isSleepingSession(session);
        return [
          layoutRow(layout, 'sleep', command({ type: 'setSessionSleeping', sessionId: id, sleeping: !sleeping }), sleeping),
        ];
      }
      case 'fork':
        return caps.canFork ? [layoutRow(layout, 'fork', command({ type: 'forkSession', sessionId: id }))] : [];
      case 'fullReload':
        return caps.canFullReload
          ? [layoutRow(layout, 'fullReload', command({ type: 'fullReloadSession', sessionId: id }))]
          : [];
      case 'delayedSend':
        // Delayed Send off on the computer (`sessions/delayedActionsSwitch.ts`): no offer to schedule one.
        return caps.canDelayedSend && delayedSend
          ? [layoutRow(layout, 'delayedSend', { type: 'sessionAction', sessionId: id, action: 'delayedSend' })]
          : [];
      case 'note':
        return sessionNotes && caps.canOpenNote
          ? [layoutRow(layout, 'note', { type: 'sessionAction', sessionId: id, action: 'note' })]
          : [];
      case 'closeAfterDone':
        // Close After Done off on the computer: the row stays only while this session is already set to close, to undo it.
        return caps.canCloseAfterDone && (closeAfterDone || session.closeAfterDone)
          ? [layoutRow(layout, 'closeAfterDone', command({ type: 'toggleCloseAfterDone', sessionId: id }))]
          : [];
      case 'export':
        return caps.canExportTranscript
          ? [layoutRow(layout, 'export', command({ type: 'exportSessionTranscript', sessionId: id }))]
          : [];
      case 'linkTo': {
        const link = linkSubmenu(session, project, layout);
        return link === null ? [] : [link];
      }
      case 'makeCoordinator':
        return caps.canMakeCoordinator
          ? [layoutRow(layout, 'makeCoordinator', command({ type: 'makeCoordinator', sessionId: id }))]
          : [];
      case 'postponeBy':
        return caps.canDelayedSend && session.delayedSendDeadlineAt.length > 0
          ? [
              layoutSubmenu(layout, 'postponeBy', [
                // Delayed Send off on the computer: the scheduled one still goes out, and only Disable stays to stop it.
                ...(delayedSend
                  ? [row('Edit Delayed Send', 'pencil', { type: 'sessionAction', sessionId: id, action: 'delayedSend' })]
                  : []),
                row('Disable Delayed Send', 'x', command({ type: 'cancelDelayedSend', sessionId: id })),
              ]),
            ]
          : [];
      case 'openTerminal':
        // A Claude cloud session's tap opens claude.ai, so its terminal is here (CDXC:ClaudeCloud in
        // contract/claudeCloud.ts).
        return claudeCloudPageUrl(session.claudeCloud) !== null
          ? [layoutRow(layout, 'openTerminal', { type: 'claudeCloudTerminal', sessionId: id })]
          : [];
      case 'links': {
        /*
         * CDXC:SessionLinks 2026-10-24 DECISION:
         * User: "also didn't we agree to have a way to see these floating on the right of the sidebar when i hover somewhere?". The desktop shows a hovered row's links in a card beside the sidebar; the phone has no hover, so its long-press menu gets a Links row that opens the same sheet the chat strip's "+N" opens.
         */
        const linkCount = session.links?.items.length ?? 0;
        const suggestedCount = session.links?.suggested.length ?? 0;
        if (linkCount === 0 && suggestedCount === 0 && (session.links?.removed.length ?? 0) === 0) return [];
        return [
          {
            ...layoutRow(layout, 'links', { type: 'sessionLinks', sessionId: id }),
            suffix: linkCount === 0 && suggestedCount > 0 ? `${suggestedCount} suggested` : String(linkCount),
          },
        ];
      }
      case 'changes':
        // CDXC:Changes 2026-10-25 SEE-ALSO: the user's decision in src/screens/ChangesScreen.tsx (the phone's read-only Changes, opened from this menu too).
        return session.projectId.length > 0 ? [layoutRow(layout, 'changes', { type: 'changes', sessionId: id })] : [];
      case 'beads':
        // CDXC:ProjectBoard 2026-11-13 SEE-ALSO: the user's decision in src/screens/BeadsScreen.tsx (opened from a row beside Changes).
        return session.projectId.length > 0 && input.beads === true
          ? [layoutRow(layout, 'beads', { type: 'beads', sessionId: id })]
          : [];
      case 'projectActions':
        // The icon of the action it would mark (a browser action's globe).
        return actionsIcon === undefined
          ? []
          : [
              {
                ...layoutRow(layout, 'projectActions', { type: 'projectActions', sessionId: id }),
                ...(actionsIcon === 'world' ? { icon: 'world' } : {}),
              },
            ];
      case 'sleepBelow': {
        if (below.length === 0) return [];
        /**
         * CDXC:SessionSleep 2026-10-01 DECISION: User: "please don't sleep terminal sessions that have shell running or a question status", and Sleep Below is a bulk sweep too, so it skips rows with the grey shell-running dot or an unanswered question (the desktop's gx-core sidebar_menu/session.rs `full_menu`).
         */
        // The question is the row's: an open question card the computer announces counts too.
        const sleepable = below
          .filter(
            (entry) =>
              isSleepableSession(entry) &&
              isRunningSession(entry) &&
              !hasBackgroundWork(entry) &&
              !hasQuestion(entry.pendingQuestionCount, capabilities.awaitingAnswer && entry.awaitingAnswer),
          )
          .map((entry) => entry.sessionId);
        return sleepable.length > 0
          ? [
              layoutRow(
                layout,
                'sleepBelow',
                command({ type: 'setSessionsSleeping', sessionIds: sleepable, sleeping: true, source: 'sleepBelow' }),
              ),
            ]
          : [];
      }
      case 'closeBelow':
        return below.length > 0
          ? [
              layoutRow(
                layout,
                'closeBelow',
                command({ type: 'closeSessions', sessionIds: below.map((entry) => entry.sessionId) }),
              ),
            ]
          : [];
      case 'close':
        // The phone's hover strip has no Close (PHONE_MENU_SETTINGS), so Close always ends the menu.
        return enabled.includes('close') ? [] : [layoutRow(layout, 'close', command({ type: 'closeSession', sessionId: id }))];
      default:
        return [];
    }
  };
}

/** The session row's context menu: the layout's `phoneRow` spot, filled for this session. */
export function buildSessionMenu(input: SessionMenuInput, layout: SessionMenuLayout): SidebarMenuItem[] {
  return assembleSessionMenu(layout, 'phoneRow', sessionMenuPlaces(input, layout), SIDEBAR_MENU_MAKE);
}

// ---------------------------------------------------------------------------
// The project header menu (gx-core `project.rs` and `membership.rs`).
// ---------------------------------------------------------------------------

/** The phone's own project menu rows, by their place in the project menu's layout. */
export type ProjectOwnAction =
  | 'newTerminal'
  | 'projectActions'
  | 'files'
  | 'automations'
  | 'projectDetails'
  | 'moveProjectUp'
  | 'moveProjectDown'
  | 'refreshSessions';

export type ProjectMenuInput = {
  /** The id the commands name the project by (the phone's project key). */
  groupId: string;
  /** '' for a project the summary gave no stable id. */
  projectId: string;
  isWorktree: boolean;
  /** The rows the project draws. */
  sessions: readonly GhostexSession[];
  /** The collection the project belongs to, or null. */
  collectionId: string | null;
  collections: readonly GhostexProjectCollection[];
  /** The phone's own rows the project shows; one left out is not drawn. */
  own: readonly ProjectOwnAction[];
  /** Own rows drawn but greyed (Move Project Up on the first project…). */
  ownDisabled: readonly ProjectOwnAction[];
};

/** Project Group (gx-core `project_membership_menu`); Spaces is off on the desktop's defaults. */
function projectMembershipMenu(input: ProjectMenuInput, layout: SessionMenuLayout): SidebarMenuItem[] {
  if (input.projectId.length === 0) return [];
  const children: SidebarMenuItem[] = [
    row('New Group', 'plus', {
      type: 'projectMembership',
      groupId: input.groupId,
      action: 'createCollection',
    }),
  ];
  for (const collection of input.collections) {
    children.push({
      label: collection.title,
      icon: 'folder',
      checked: input.collectionId === collection.collectionId,
      disabled: false,
      command: {
        type: 'projectMembership',
        groupId: input.groupId,
        action: 'moveCollection',
        collectionId: collection.collectionId,
      },
    });
  }
  if (input.collectionId !== null) {
    children.push(separator());
    children.push(
      row('Remove from Group', 'x', {
        type: 'projectMembership',
        groupId: input.groupId,
        action: 'moveCollection',
      }),
    );
  }
  return [{ ...layoutSubmenu(layout, 'projectGroup', children), presentation: 'page' }];
}

/**
 * A project header's context menu: the project menu's `phoneProject` layout (gx-core `project_menu_layout`, the
 * user's Q4313 A), filled for this project. A worktree keeps its own short menu (Copy Path, Remove Worktree).
 *
 * Left out: Open Folder (opens Finder on the computer), Rename Project, Rename Worktree, Delete Worktree, New
 * Group and Copy Remote URL (no `ghostex` verb, and the summary carries no git remote), Hide (the desktop's own list
 * state), and Close Project.
 *
 * CDXC:ContextMenus 2026-09-25 WHY:
 * Close Project parks the project in Recent Projects through gxserver's `/api/closeProjectToRecent`,
 * which no `ghostex` verb reaches. Do not map it to `ghostex remove-project`: that is
 * `/api/removeProject`, the hard delete the desktop uses only for Remove Worktree, and the phone's
 * old Close Project did exactly that while its confirmation promised a park.
 */
export function buildProjectMenu(input: ProjectMenuInput, layout: SessionMenuLayout): SidebarMenuItem[] {
  const groupId = input.groupId;
  const copyPath = layoutRow(layout, 'copyPath', command({ type: 'copyWorkspaceProjectPathForGroup', groupId }));
  if (input.isWorktree) {
    const menu: SidebarMenuItem[] = [copyPath];
    if (input.projectId.length > 0) {
      menu.push(separator());
      menu.push({
        ...row('Remove Worktree', 'x', command({ type: 'removeWorkspaceProjectForGroup', groupId })),
        danger: true,
      });
    }
    return menu;
  }
  const sleepable = input.sessions.filter(isSleepableSession);
  const sleeping = sleepable.some(isSleepingSession);
  const running = sleepable.some(isRunningSession);
  const allSleeping = sleeping && !running;
  const hasInactive = sleepable.some(isInactiveSession);
  const fill = (id: string): SidebarMenuItem[] => {
    switch (id) {
      case 'projectDetails': {
        const rows: SidebarMenuItem[] = [];
        if (input.own.includes('automations')) {
          rows.push({
            ...row('Automations', 'clock', { type: 'projectOwn', action: 'automations' }),
            disabled: input.ownDisabled.includes('automations'),
          });
        }
        if (input.own.includes('projectDetails')) {
          rows.push({
            ...layoutRow(layout, 'projectDetails', { type: 'projectOwn', action: 'projectDetails' }),
            disabled: input.ownDisabled.includes('projectDetails'),
          });
        }
        return rows;
      }
      case 'newTerminal':
      case 'projectActions':
      case 'files':
      case 'moveProjectUp':
      case 'moveProjectDown':
      case 'refreshSessions': {
        const action: ProjectOwnAction = id;
        if (!input.own.includes(action)) return [];
        return [
          { ...layoutRow(layout, id, { type: 'projectOwn', action }), disabled: input.ownDisabled.includes(action) },
        ];
      }
      case 'copyPath':
        return [copyPath];
      case 'projectGroup':
        return projectMembershipMenu(input, layout);
      // CDXC:WorkMode 2026-10-24 DECISION: User: Issues Workflow has "No switch", so the phone's project menu drops its Work Mode row like the desktop's (supersedes the 2026-10-09 tick-row decisions).
      case 'sleepInactive':
        return [
          {
            ...layoutRow(
              layout,
              'sleepInactive',
              command(
                allSleeping
                  ? { type: 'wakeProjectSleepingSessions', groupId }
                  : { type: 'sleepInactiveProjectSessions', groupId },
              ),
              allSleeping,
            ),
            disabled: !allSleeping && !hasInactive,
          },
        ];
      case 'fullReload':
        return input.sessions.length > 0
          ? [layoutRow(layout, 'fullReload', command({ type: 'fullReloadProjectZmxSessions', groupId }))]
          : [];
      case 'closeInactive':
        return [
          {
            ...layoutRow(layout, 'closeInactive', command({ type: 'closeInactiveProjectSessions', groupId })),
            disabled: !hasInactive,
          },
        ];
      default:
        return [];
    }
  };
  return assembleSessionMenu(layout, 'phoneProject', fill, SIDEBAR_MENU_MAKE);
}
