/**
 * The Sessions list's session and project context menus, as data in the shape
 * gx-core's `MenuItem::to_json` writes (packages/gx-core/src/sidebar_menu/item.rs):
 * labels, icon ids, headings, separators, submenus and the same command
 * payloads (`{type: 'command', message}`, `batch`, `sessionAction`,
 * `projectMembership`). Nothing here draws or runs anything; the renderer is
 * ./sidebar-menu-view.tsx and the commands run in ./use-sessions-screen-menus.tsx.
 *
 * CDXC:ContextMenus 2026-09-25 DECISION:
 * User 2026-09-25: "please make the react native session list context menu match the gpui one".
 * The session menu is a port of `full_menu` in packages/gx-core/src/sidebar_menu/session.rs, row
 * for row: same items, order, labels, icons, headings, separators, submenus and danger rows. An
 * item the phone cannot run (no `ghostex` verb for it, or it acts on the computer's own screen) is
 * left out rather than drawn dead; the phone-only rows the old menu had (Attach, Chat, Copy attach
 * command, Details) are gone because the desktop menu has none of them. When the phone gets
 * gx-core through UniFFI, the two builders below are replaced by the core's output and the
 * renderer and the command runner stay.
 *
 * SEE-ALSO: packages/gx-core/src/sidebar_menu/{session,project,membership,capabilities,copy,clipboard}.rs,
 * packages/gx-core/src/sidebar_view/tags.rs (the default tag list).
 */

import {
  displayStatus,
  type GhostexCustomSessionTags,
  type GhostexProject,
  type GhostexProjectCollection,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { COMMAND_ICONS } from '../../assets/tablerIcons.generated';
import type { SessionWorkLinks, WorkLinkKind } from '../../commands/ghostexCli';
import { effectiveSessionTag, SESSION_TAG_SECTIONS } from '../../contract/sessionTags';
import { COORDINATOR_AGENT_ICONS, FORK_AGENT_ICONS } from '../../sessions/sessionCommands';

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
  | { type: 'exportSessionTranscript'; sessionId: string }
  | { type: 'cancelDelayedSend'; sessionId: string }
  | { type: 'copySessionDetails'; sessionId: string; text: string }
  | { type: 'copyText'; text: string }
  | { type: 'setSessionWorkLinks'; sessionId: string; links: SessionWorkLinks }
  | { type: 'setProjectWorkMode'; projectId: string; enabled: boolean }
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
  | {
      type: 'projectMembership';
      groupId: string;
      action: 'createCollection' | 'moveCollection';
      collectionId?: string;
    };

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
  command?: SidebarMenuCommand;
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

function heading(label: string): SidebarMenuItem {
  return { label, heading: true, checked: false, disabled: false };
}

function command(message: SidebarMenuMessage): SidebarMenuCommand {
  return { type: 'command', message };
}

// ---------------------------------------------------------------------------
// The desktop settings the menus read.
// ---------------------------------------------------------------------------

/** The session card hover buttons (gx-core `HoverAction`). */
type HoverAction =
  | 'rename'
  | 'pin'
  | 'note'
  | 'snooze'
  | 'closeAfterDone'
  | 'tag'
  | 'park'
  | 'sleep'
  | 'close';

/**
 * CDXC:ContextMenus 2026-09-25 WHY:
 * The desktop menu is shaped by Settings the phone cannot read: `tagListItems` is not in the
 * `ghostex settings` catalog at all, and reading the rest would cost an SSH exec per menu. So the
 * phone uses the desktop DEFAULTS (gx-core `SidebarSettings::default`), which also keep the Copy
 * section (the two debugging copy switches are off) and the Spaces submenu (Spaces are off) out.
 * The one deliberate difference is the hover strip: the phone has no hover buttons, so its strip is
 * the desktop default (Tag, Park and Sleep left of the chevron, Close right of it) WITHOUT Close.
 * The top of the menu then reads exactly like the desktop's default menu, and Close drops to the
 * bottom of the menu, which is where the desktop puts it whenever Close is not a hover button.
 */
const PHONE_MENU_SETTINGS = {
  enableSessionParking: true,
  showTagMenuWhenParking: true,
  showSessionCardHoverButtonsInContextMenu: true,
  hoverStrip: ['tag', 'park', 'sleep'] as readonly HoverAction[],
};

/**
 * Tags the desktop's first-run tag list hides and disables (gx-core `DEFAULT_OFF_TAGS`); the Tag
 * As menu leaves them out unless the session already carries one.
 */
const DEFAULT_HIDDEN_TAGS: readonly string[] = [
  'high-priority',
  'low-priority',
  'todo',
  'bug',
  'feature',
];

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
  return (
    !isBrowserSession(session) &&
    isRunningSession(session) &&
    status !== 'working' &&
    status !== 'attention'
  );
}

function sessionAgentIcon(session: GhostexSession): string {
  return (session.agentIcon.length > 0 ? session.agentIcon : session.agent).trim().toLowerCase();
}

/** gx-core `transcript_agent`: which transcript family an agent belongs to, or null. */
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
      case 'cursor':
      case 'cursor-agent':
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
      case 'pi':
      case 'omp':
        return 'pi';
      case 'zcode':
      case 'zcode-cli':
        return 'zcode';
      case 'freebuff':
        return 'freebuff';
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
    canCloseAfterDone: terminal,
    canDelayedSend: terminal,
    canExportTranscript:
      terminal &&
      !draft &&
      hasProject &&
      transcriptAgent([session.agentName, session.agentIcon, session.agent]) !== null,
    canFork: terminal && !draft && FORK_AGENT_ICONS.includes(agentIcon),
    canFullReload: terminal && !draft && supportsFullReload(session, agentIcon),
    // gx-core `full_menu` shows Make Coordinator on the same sessions gxserver can promote: Claude,
    // Codex, ZCode or Empryo, not a draft, not in a box, and not already a coordinator or a coordinator's thread.
    canMakeCoordinator:
      terminal &&
      !draft &&
      hasProject &&
      session.agentbox === undefined &&
      !session.isCoordinator &&
      session.coordinatorSessionId.length === 0 &&
      COORDINATOR_AGENT_ICONS.includes(agentIcon),
    canOpenNote: terminal && hasProject && session.agentSessionId.trim().length > 0,
    canPark: terminal && hasProject,
    canRename: terminal,
    canSleep: isRunningSession(session) || isSleepingSession(session),
    canTag: terminal,
  };
}

// ---------------------------------------------------------------------------
// Tags (gx-core `enabled_visible_tag_sections` over the default tag list).
// ---------------------------------------------------------------------------

type TagOption = { value: string; label: string; icon: string; color: string };

function tagSections(
  current: string | undefined,
  catalog: GhostexCustomSessionTags,
): TagOption[][] {
  const builtins = SESSION_TAG_SECTIONS.map((section) =>
    section.options
      .filter((option) => !DEFAULT_HIDDEN_TAGS.includes(option.value) || option.value === current)
      .map((option) => ({
        value: option.value,
        label: option.label,
        icon: BUILTIN_TAG_ICON_IDS[option.value] ?? 'tag',
        color: option.color,
      })),
  );
  // Every catalog tag is visible on the default list; a custom id the catalog no longer has is
  // dropped, the same as the desktop.
  const custom: TagOption[] = [];
  for (const tagId of catalog.order) {
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

/** The Tag As rows. New Tag… is left out: the phone has no tag editor. */
function tagItems(session: GhostexSession, catalog: GhostexCustomSessionTags): SidebarMenuItem[] {
  const current = effectiveSessionTag(session);
  const items: SidebarMenuItem[] = [];
  tagSections(current, catalog).forEach((section, index) => {
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
          sessionTag: tag === null ? effectiveSessionTag(session) ?? null : tag,
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
  /** The machine's custom tag catalog. */
  customTags: GhostexCustomSessionTags;
  /** The rows drawn under this one in its group, for Sleep Below and Close Below. */
  below: readonly GhostexSession[];
  /** The session's project, whose title and worktree Copy Details quotes; null when unknown. */
  project: Pick<GhostexProject, 'name' | 'path' | 'worktree' | 'workMode'> | null;
};

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
    gemini: 'Gemini',
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
 * gx-core `session_details_text`: what another agent needs to reach this session through
 * `$ghostex-agents`. The phone sees every session as one on the computer the menu is about, which
 * is how that computer's own sidebar copies it, so there is no Remote Machine line.
 */
function sessionDetailsText(session: GhostexSession, project: SessionMenuInput['project']): string {
  const lines = ['Ghostex Session'];
  const line = (label: string, value: string | undefined): void => {
    const text = (value ?? '').trim();
    if (text.length > 0) lines.push(`${label}: ${text}`);
  };
  const title = [session.title, session.primaryTitle, session.displayTitle]
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  line('Agent', session.agentIcon.length > 0 ? formatIdentifier(session.agentIcon) : undefined);
  line('Title', title ?? 'Session');
  line('Global Ref', session.globalRef);
  line('Agent Session ID', session.agentSessionId);
  line(session.provider.length > 0 ? session.provider : 'zmx', session.providerSessionName || session.zmxName);
  line('Project', project?.name ?? session.projectName);
  line('Project Path', project?.path ?? session.projectPath);
  line('Worktree', project?.worktree?.name);
  line('Worktree Branch', project?.worktree?.branch);
  lines.push('More details: use $ghostex-agents');
  return lines.join('\n');
}

/**
 * A work-mode session's Link to submenu: pick the PR, Linear issues, Linear project or GitHub issue
 * the session is about, unlink one kind, or hand the links back to the branch. Only sessions of
 * projects with work mode on get it.
 *
 * CDXC:WorkMode 2026-10-09 DECISION:
 * User: start any session the normal way and link it later: right-click → Link to → Pull request…, Linear issue…, Linear project…, GitHub issue…. Something already linked shows its ID in the menu; picking another one replaces it and Unlink removes it. Only sessions of projects with work mode on get the submenu. The phone's session menu matches the desktop's, so it has the same submenu, and its picker is a searchable list over the computer's suggestions (`ghostex link-session --candidates`).
 *
 * SEE-ALSO: packages/gx-core/src/sidebar_menu/link_menu.rs, ./work-link-picker.tsx.
 */
function linkSubmenu(session: GhostexSession, project: SessionMenuInput['project']): SidebarMenuItem | null {
  if (project?.workMode !== true || session.projectId.length === 0) return null;
  const id = session.sessionId;
  const work = session.work;
  const issues = work?.linearIssues ?? [];
  const githubNumbers = work?.githubIssueNumbers ?? [];
  const pullRequest = work?.pullRequestNumber != null ? `#${work.pullRequestNumber}` : undefined;
  const linearIssues = issues.length > 0 ? issues.map((issue) => issue.identifier).join(', ') : undefined;
  const linearProject = (work?.linearProjectName ?? '').length > 0 ? work?.linearProjectName : undefined;
  const githubIssues = githubNumbers.length > 0 ? githubNumbers.map((number) => `#${number}`).join(', ') : undefined;
  const pick = (label: string, icon: string, kind: WorkLinkKind, linked: string | undefined): SidebarMenuItem => ({
    ...row(label, icon, { type: 'sessionAction', sessionId: id, action: 'linkWork', kind }),
    ...(linked === undefined ? {} : { suffix: linked }),
  });
  const children: SidebarMenuItem[] = [
    pick('Pull request…', 'git-pull-request', 'pullRequest', pullRequest),
    pick('Linear issue…', 'hash', 'linearIssue', linearIssues),
    pick('Linear project…', 'box', 'linearProject', linearProject),
    pick('GitHub issue…', 'circle-dot', 'githubIssue', githubIssues),
  ];
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
    unlinkRows.push(unlink(githubNumbers.length > 1 ? 'Unlink GitHub issues' : 'Unlink GitHub issue', { githubIssues: [] }));
  }
  if (unlinkRows.length > 0) children.push(separator(), ...unlinkRows);
  if (work?.handSet === true) {
    children.push(separator(), row('Back to automatic', 'refresh', command({ type: 'setSessionWorkLinks', sessionId: id, links: { clear: true } })));
  }
  return submenu('Link to', 'link', children);
}

/**
 * The Copy submenu: Copy Details always, the other rows only when the session has something for
 * them.
 *
 * CDXC:ContextMenus 2026-10-09 DECISION:
 * User: Copy Details moves into a Copy submenu next to Copy Branch, Copy Linear ID, Copy PR Link and the like, for normal and work-mode sessions; it stays always available so anyone can hand a session to another agent. The phone's session menu matches the desktop's (2026-10-01), so it has the same submenu.
 */
function copySubmenu(session: GhostexSession, project: SessionMenuInput['project']): SidebarMenuItem {
  const children: SidebarMenuItem[] = [
    row(
      'Copy Details',
      'copy',
      command({
        type: 'copySessionDetails',
        sessionId: session.sessionId,
        text: sessionDetailsText(session, project),
      }),
    ),
  ];
  const copyRow = (label: string, icon: string, text: string): void => {
    if (text.trim().length > 0) children.push(row(label, icon, command({ type: 'copyText', text })));
  };
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
  return submenu('Copy', 'copy', children);
}

/**
 * The session row's context menu.
 *
 * Left out, because the phone has no way to run them: Snooze / Unsnooze (no `ghostex` verb for
 * gxserver's `/api/snoozeSession`), the five Postpone By presets (no verb for
 * `/api/postponeDelayedSend`), Switch Account, View 1st Message (the summary carries no first
 * message), Generate Title, Move to New Group, and New Tag…; Split Right and Focus act on the
 * computer's own panes.
 */
export function buildSessionMenu(input: SessionMenuInput): SidebarMenuItem[] {
  const { session, customTags, below, project } = input;
  const settings = PHONE_MENU_SETTINGS;
  const caps = sessionCapabilities(session);
  const id = session.sessionId;
  const sleeping = isSleepingSession(session);
  const pinned = session.isPinned;
  const parked = session.isParked === true;
  const tags = caps.canTag ? tagItems(session, customTags) : [];

  let park = row(
    parked ? 'Unpark' : 'Park',
    'archive',
    command({ type: 'setSessionParked', sessionId: id, parked: !parked }),
  );
  if (!parked && settings.showTagMenuWhenParking && caps.canTag && tags.length > 0) {
    park = submenu('Park', 'archive', [
      row('No Tag Change', 'tag-off', command({ type: 'setSessionParked', sessionId: id, parked: true })),
      separator(),
      ...tags.map((item) => parkWithTag(item, session)),
    ]);
  }

  const rows: Partial<Record<HoverAction, SidebarMenuItem>> = {
    close: {
      ...row('Close', 'x', command({ type: 'closeSession', sessionId: id })),
      danger: true,
    },
    ...(caps.canRename
      ? { rename: row('Rename', 'pencil', { type: 'sessionAction', sessionId: id, action: 'rename' }) }
      : {}),
    ...(caps.canOpenNote
      ? { note: row('Note', 'note', { type: 'sessionAction', sessionId: id, action: 'note' }) }
      : {}),
    ...(caps.canSleep
      ? {
          sleep: row(
            sleeping ? 'Wake' : 'Sleep',
            sleeping ? 'player-play' : 'moon',
            command({ type: 'setSessionSleeping', sessionId: id, sleeping: !sleeping }),
          ),
        }
      : {}),
    pin: row(
      pinned ? 'Unpin' : 'Pin',
      pinned ? 'pinned-off' : 'pin',
      command({ type: 'setSessionPinned', sessionId: id, pinned: !pinned }),
    ),
    ...(!caps.isBrowser && settings.enableSessionParking && caps.canPark ? { park } : {}),
    ...(caps.canTag && tags.length > 0 ? { tag: submenu('Tag As', 'tag', tags) } : {}),
    ...(caps.canCloseAfterDone
      ? {
          closeAfterDone: row(
            'Close After Done',
            'clock',
            command({ type: 'toggleCloseAfterDone', sessionId: id }),
          ),
        }
      : {}),
  };

  const enabled = settings.hoverStrip;
  // An action the hover strip offers is repeated in the menu too, with the two that have rows of
  // their own left out.
  const mirror: HoverAction[] = settings.showSessionCardHoverButtonsInContextMenu
    ? caps.isBrowser
      ? ['sleep']
      : enabled.filter((action) => action !== 'close' && action !== 'closeAfterDone')
    : [];
  // gx-core `full_menu` order (CDXC:ContextMenus): ChatGPT's order, mirrored hover buttons
  // included, Tag As after a line; Note shows here only as a mirrored hover button.
  const primaryOrder: HoverAction[] = ['rename', 'pin', 'snooze', 'park', 'sleep', 'note', 'tag'];
  const menu: SidebarMenuItem[] = [];
  for (const action of primaryOrder) {
    const shown = mirror.includes(action) || (action !== 'note' && !enabled.includes(action));
    const item = rows[action];
    if (!shown || item === undefined) continue;
    if (action === 'tag' && menu.length > 0) menu.push(separator());
    menu.push(action === 'pin' && !pinned ? { ...item, icon: 'pinned' } : item);
  }

  const advanced: SidebarMenuItem[] = [heading('Session')];
  if (!enabled.includes('note') && rows.note !== undefined) {
    advanced.push(rows.note);
  }
  if (caps.canDelayedSend) {
    advanced.push(row('Delayed Send', 'clock', { type: 'sessionAction', sessionId: id, action: 'delayedSend' }));
  }
  if (
    caps.canCloseAfterDone &&
    (!enabled.includes('closeAfterDone') || settings.showSessionCardHoverButtonsInContextMenu) &&
    rows.closeAfterDone !== undefined
  ) {
    advanced.push(rows.closeAfterDone);
  }
  if (caps.canFork) {
    advanced.push(row('Fork', 'git-fork', command({ type: 'forkSession', sessionId: id })));
  }
  if (caps.canFullReload) {
    advanced.push(row('Full Reload', 'refresh', command({ type: 'fullReloadSession', sessionId: id })));
  }
  if (caps.canMakeCoordinator) {
    advanced.push(row('Make Coordinator', 'users-group', command({ type: 'makeCoordinator', sessionId: id })));
  }
  if (caps.canExportTranscript) {
    advanced.push(
      row('Handoff / Export', 'file-export', command({ type: 'exportSessionTranscript', sessionId: id })),
    );
  }
  if (below.length > 0) {
    advanced.push(separator());
    advanced.push(heading('Below'));
    const sleepable = below.filter(isRunningSession).map((entry) => entry.sessionId);
    if (sleepable.length > 0) {
      advanced.push(
        row(
          'Sleep Below',
          'moon',
          command({ type: 'setSessionsSleeping', sessionIds: sleepable, sleeping: true, source: 'sleepBelow' }),
        ),
      );
    }
    advanced.push({
      ...row(
        'Close Below',
        'x',
        command({ type: 'closeSessions', sessionIds: below.map((entry) => entry.sessionId) }),
      ),
      danger: true,
    });
  }

  if (caps.canDelayedSend && session.delayedSendDeadlineAt.length > 0) {
    menu.push(
      submenu('Postpone By', 'clock', [
        row('Edit Delayed Send', 'pencil', { type: 'sessionAction', sessionId: id, action: 'delayedSend' }),
        row('Disable Delayed Send', 'x', command({ type: 'cancelDelayedSend', sessionId: id })),
      ]),
    );
  }
  if (menu.length > 0) menu.push(separator());
  const link = linkSubmenu(session, project);
  if (link !== null) menu.push(link);
  menu.push(copySubmenu(session, project));
  if (advanced.length > 1) {
    menu.push(submenu('Advanced', 'dots', advanced));
  }
  if (!enabled.includes('close') && rows.close !== undefined) {
    menu.push(separator());
    menu.push(rows.close);
  }
  return menu;
}

// ---------------------------------------------------------------------------
// The project header menu (gx-core `project.rs` and `membership.rs`).
// ---------------------------------------------------------------------------

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
  /** Work mode is on for the project (`workMode` on the summary's project row). */
  workMode: boolean;
};

/** Add to Group (gx-core `project_membership_menu`); Spaces is off on the desktop's defaults. */
function projectMembershipMenu(input: ProjectMenuInput): SidebarMenuItem[] {
  if (input.projectId.length === 0) return [];
  const children: SidebarMenuItem[] = [
    row('New Project Group', 'plus', {
      type: 'projectMembership',
      groupId: input.groupId,
      action: 'createCollection',
    }),
  ];
  for (const collection of input.collections) {
    children.push({
      label: collection.title,
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
  return [{ ...submenu('Add to Group', 'plus', children), presentation: 'page' }];
}

/**
 * A project header's context menu.
 *
 * Left out: Open Folder (opens Finder on the computer), Rename Worktree, Delete Worktree, New
 * Group and Copy Remote URL (no `ghostex` verb, and the summary carries no git remote), Hide (the
 * desktop's own list state), and Close Project.
 *
 * CDXC:ContextMenus 2026-09-25 WHY:
 * Close Project parks the project in Recent Projects through gxserver's `/api/closeProjectToRecent`,
 * which no `ghostex` verb reaches. Do not map it to `ghostex remove-project`: that is
 * `/api/removeProject`, the hard delete the desktop uses only for Remove Worktree, and the phone's
 * old Close Project did exactly that while its confirmation promised a park.
 */
export function buildProjectMenu(input: ProjectMenuInput): SidebarMenuItem[] {
  const groupId = input.groupId;
  const menu: SidebarMenuItem[] = [
    row('Copy Path', 'copy', command({ type: 'copyWorkspaceProjectPathForGroup', groupId })),
  ];
  if (input.isWorktree) {
    if (input.projectId.length > 0) {
      menu.push(separator());
      menu.push({
        ...row('Remove Worktree', 'x', command({ type: 'removeWorkspaceProjectForGroup', groupId })),
        danger: true,
      });
    }
    return menu;
  }
  menu.push(...projectMembershipMenu(input));
  /*
   * CDXC:WorkMode 2026-10-09 DECISION:
   * User: work mode is a per-project switch: right-click the project → Work mode. The phone's project menu has the same tick row, between Add to Group and the first separator like the desktop's, and runs `ghostex work-mode on|off --project-id <id>` on the computer.
   */
  if (input.projectId.length > 0) {
    menu.push({
      ...row(
        'Work Mode',
        'briefcase',
        command({ type: 'setProjectWorkMode', projectId: input.projectId, enabled: !input.workMode }),
      ),
      checked: input.workMode,
    });
  }
  menu.push(separator());
  const sleeping = input.sessions.some(isSleepingSession);
  const running = input.sessions.some(isRunningSession);
  const allSleeping = sleeping && !running;
  const hasInactive = input.sessions.some(isInactiveSession);
  menu.push({
    ...row(
      allSleeping ? 'Wake' : 'Sleep Inactive',
      allSleeping ? 'player-play' : 'moon',
      command(
        allSleeping
          ? { type: 'wakeProjectSleepingSessions', groupId }
          : { type: 'sleepInactiveProjectSessions', groupId },
      ),
    ),
    disabled: !allSleeping && !hasInactive,
  });
  if (input.sessions.length > 0) {
    menu.push(row('Full Reload', 'refresh', command({ type: 'fullReloadProjectZmxSessions', groupId })));
  }
  menu.push(separator());
  menu.push({
    ...row('Close Inactive', 'x', command({ type: 'closeInactiveProjectSessions', groupId })),
    danger: true,
    disabled: !hasInactive,
  });
  return menu;
}
