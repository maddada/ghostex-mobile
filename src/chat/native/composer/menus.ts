/**
 * The rows of the composer's menus, built from the document the way desktop builds them
 * (`actions.rs`, `show_actions`; `option_menu/window.rs`, `show_option_menu`). Rows that need the
 * app shell (`{type: 'host', ...}`) appear only for the actions the screen performs.
 */

import type { ChatDocument } from '../../rust/document';
import { arr, isTrue, obj, str } from './json';
import { rowsOf, type MenuRow } from './MenuSheet';
import { SWITCH_TO_NATIVE_INFO, SWITCH_TO_TERMINAL_BASED_INFO } from './switchInfo';
import { sessionDetailsRingOf } from '../cards/SessionDetailsSheet';
import {
  assembleSessionMenu,
  entryDanger,
  entryIcon,
  entryLabel,
  type SessionMenuLayout,
  type SessionMenuMake,
} from '../../../session-menu/layout';
import type { SidebarMenuItem } from '../../../screens/sessions-screen/sidebar-menus';

/** The toolbar controls in desktop's order, which is also the order they fold into More actions
 * (`toolbar.rs`, `COMPOSER_CONTROLS`). Maximize is desktop-only. Files & Links, Summary mode (under
 * View) and Stash Prompt are always More actions rows, and Dictate always shows right before Send and
 * never folds (desktop CDXC:SessionChat 2026-10-20). */
export const COMPOSER_CONTROLS = [
  { id: 'note', action: 'sessionNote', label: 'Note', icon: 'titlebar/note.svg' },
  { id: 'attach', action: 'attachPath', label: 'Attach a file or folder', icon: 'titlebar/paperclip.svg' },
  { id: 'terminal', action: 'terminalView', label: 'Terminal View', icon: 'titlebar/terminal-2.svg' },
] as const;

export type ComposerControlId = (typeof COMPOSER_CONTROLS)[number]['id'];
/** A host gate under `composerActions`: the toolbar controls plus the More actions rows they gate. */
export type ComposerActionId = ComposerControlId | 'summary' | 'stash' | 'dictate';

export function overflowed(document: ChatDocument, id: string): boolean {
  return document.composerOverflow?.overflowed?.includes(id) === true || rowFolded(document, id);
}

/** A control Settings › Experience keeps in More actions instead of the row (gx-chat-core `composer/row.rs`). */
export function rowFolded(document: ChatDocument, id: string): boolean {
  return document.composerRow?.folded?.includes(id) === true;
}

/** Why the terminal reads not ready while its button is off the row: ••• turns red and this row says it. */
export function terminalIssue(document: ChatDocument): string | null {
  const issue = document.composerRow?.terminalIssue;
  return typeof issue === 'string' && issue.length > 0 ? issue : null;
}

export type MoreActionsInput = {
  document: ChatDocument;
  /** The one session menu (session-menu/layout.ts), whose `phoneChat` spot this menu is. */
  layout: SessionMenuLayout;
  /**
   * The places this chat shares with the long-press menu (Coordinator, Mark Thread Done, Copy, Tag As, Link to…),
   * filled for its session (`sessionMenuRows` of sidebar-menus.ts `sessionMenuPlaces`); absent while the screen runs
   * none of them or the session is not known yet.
   */
  sessionRows?: (id: string) => MenuRow[];
  /** Controls this composer can draw (the host gates plus what the phone serves). */
  available: (id: ComposerActionId) => boolean;
  /** Whether the screen performs this app-shell action (`NativeComposer`'s `hostActions`). */
  serves: (action: string) => boolean;
  /** The chat box's text, which Side Chat toggles its `/btw ` prefix on. */
  draft?: string;
  /** The session's title, for Voice Call's hint (the row shows when `serves('voiceCall')`). */
  voiceCallTitle?: string;
  /** A GBot's chat: the GBot's name, the row then being "Call <GBot>" (src/voice/gbotCall.ts). */
  voiceCallGbotName?: string;
  /**
   * The composer draws no toolbar control and no option pill but the model's (a chat in a pane slot, `chatPlacement`):
   * every control it may draw and the option settings are rows here, as when they all overflow.
   */
  allFolded?: boolean;
  /** The session sleeps: the core's Sleep row reads Wake, as the sidebar's does. */
  sleeping?: boolean;
  /**
   * The computer has Delayed Send on (`sessions/delayedActionsSwitch.ts`); off, no Delayed Send row. On when absent.
   * Close After Done is a shared place, so `sessionRows` already follows its switch.
   */
  delayedSend?: boolean;
};

/**
 * The View row: one choice of Summary, Normal and Detailed, picking one turning the others off
 * (desktop's `view_modes_row` in `actions.rs`; the user decision is in gx-chat-core
 * `transcript/view_level.rs`). Summary shows only where this chat has it.
 */
function viewModesRow(document: ChatDocument, summaryAvailable: boolean): MenuRow {
  const level = document.viewLevel ?? 'normal';
  const levels: { value: 'summary' | 'normal' | 'detailed'; label: string; iconPath: string }[] = [
    { value: 'summary', label: 'Summary', iconPath: 'titlebar/list-check.svg' },
    { value: 'normal', label: 'Normal', iconPath: 'titlebar/leaf.svg' },
    { value: 'detailed', label: 'Detailed', iconPath: 'titlebar/list-details.svg' },
  ];
  const modes: MenuRow[] = levels
    .filter((row) => row.value !== 'summary' || summaryAvailable)
    .map((row) => ({
      label: row.label,
      iconPath: row.iconPath,
      checked: level === row.value,
      command: { type: 'setDetailLevel', level: row.value },
    }));
  // Quiet View, for any chat, under the three levels (desktop `actions.rs`; gx-chat-core
  // `transcript/quiet_view.rs` has the user's words): the chat remembers its own choice. Absent on
  // an older computer, which sends no Quiet View settings.
  const quiet = document.quietView;
  if (quiet !== undefined && quiet !== null) {
    const on = quiet.on === true;
    modes.push({ separator: true });
    modes.push({
      label: 'Quiet View',
      iconPath: 'titlebar/eye-off.svg',
      checked: on,
      command: { type: 'setQuietView', on: !on },
      ...(level === 'summary' ? { description: 'Summary view folds more, so it wins while it is on' } : {}),
    });
  }
  // Auto-read, under the view settings since layout A (2026-11-12, Q2723), which the one session menu keeps.
  const autoRead = autoReadRow(document);
  if (autoRead !== null) modes.push({ separator: true }, autoRead);
  return {
    label: 'View',
    iconPath: 'titlebar/eye.svg',
    detail: level === 'summary' ? 'Summary' : level === 'detailed' ? 'Detailed' : 'Normal',
    children: modes,
  };
}

/**
 * The Branches row: the core's own list of this conversation's forks, only when it has any
 * (desktop's `fork_branches_row` in `fork_branches.rs`, where the user decision is recorded).
 */
function branchesRow(document: ChatDocument): MenuRow | null {
  const branches = obj(document.forkBranches);
  const tooltip = str(branches, 'tooltip');
  // A phone has no hover, so the summary sentence sits under the list's heading.
  const children = withIcon(
    rowsOf(branches?.menu).map((row) =>
      row.heading === true && tooltip.length > 0 ? { ...row, description: tooltip } : row,
    ),
    'titlebar/git-branch.svg',
  );
  if (children.length === 0) return null;
  return { label: 'Branches', iconPath: 'titlebar/git-branch.svg', detail: String(branches?.count ?? ''), children };
}

/**
 * Read aloud's Auto-read check, in View, which says why it is quiet during a voice call or dictation. Stop Reading
 * is a row of its own while this chat is being read (`moreActionsRows`).
 *
 * CDXC:VoiceMode 2026-10-20 DECISION: User: the Auto-read switch lives in the composer's ⋯ (More actions) menu on both apps; it reads each finished reply of the chat on screen. Its rows show only while the chat's computer has Read aloud on and the phone has a voice (`readAloud.available`).
 */
function autoReadRow(document: ChatDocument): MenuRow | null {
  const state = document.readAloud;
  if (state?.available !== true) return null;
  const held =
    state.autoReadHeld === 'voiceConversation'
      ? 'Quiet during the voice call'
      : state.autoReadHeld === 'dictation'
        ? 'Quiet while you dictate'
        : null;
  return {
    label: 'Auto-read',
    iconPath: 'titlebar/volume.svg',
    checked: state.autoRead,
    ...(held !== null ? { description: held } : {}),
    command: { type: 'readAloudAuto' },
  };
}

/**
 * The Skills row: the Ghostex skills the agent has installed, each putting its pill in the chat box
 * (core `composer/ghostex_skills.rs`, a user decision there), then Configure / Install more.
 */
function skillsRow(document: ChatDocument): MenuRow {
  const skills: MenuRow[] = (document.ghostexSkills ?? []).map((skill) => ({
    label: skill.name,
    iconPath: 'titlebar/wand.svg',
    description: skill.description ?? null,
    command: { type: 'insertSkill', name: skill.name },
  }));
  if (skills.length === 0) skills.push({ label: 'No Ghostex skills installed', iconPath: 'titlebar/puzzle.svg', disabled: true });
  skills.push(
    { separator: true },
    { label: 'Configure / Install more', iconPath: 'titlebar/settings.svg', command: { type: 'openSkillsSettings' } },
  );
  return { label: 'Skills', iconPath: 'titlebar/sparkles.svg', children: skills };
}

/**
 * CDXC:SessionChat 2026-10-11 DECISION:
 * User: on the phone, while the agent works, a long press on Send opens a small sheet with "Interrupt & Send" and "Queue"; while it is idle a long press still just queues. More actions keeps its Interrupt & Send row too.
 * Superseded 2026-11-12 (`sendChoiceRows`): More actions has no send rows; this menu has Compact & Send too.
 */
export function sendChoiceRows({
  ready,
  canQueue,
  working = true,
  compact = false,
}: {
  ready: boolean;
  canQueue: boolean;
  /** Interrupt & Send shows only while the agent works. */
  working?: boolean;
  /** Compact & Send shows while there is text to send. */
  compact?: boolean;
}): MenuRow[] {
  const rows: MenuRow[] = [];
  if (working) {
    rows.push({
      label: 'Interrupt & Send',
      iconPath: 'titlebar/arrow-up.svg',
      disabled: !ready,
      command: { type: 'submit', mode: 'interrupt' },
    });
  }
  // CDXC:SessionChat 2026-11-12 DECISION: User: "Move send ones under holding send button": Compact & Send left
  // More actions for this menu, as Interrupt & Send did (desktop keeps both in Send's right-click menu).
  if (compact) {
    rows.push({
      label: 'Compact & Send',
      iconPath: 'titlebar/arrows-diagonal-minimize.svg',
      disabled: !(ready && canQueue),
      command: { type: 'submit', mode: 'compact' },
    });
  }
  rows.push({
    label: 'Queue',
    iconPath: 'titlebar/stack-push.svg',
    disabled: !(ready && canQueue),
    command: { type: 'submit', mode: 'queue' },
  });
  return rows;
}

/**
 * CDXC:SessionChat 2026-11-11 DECISION:
 * User: "Pls shorten the placeholder text on mobile app so it fits in 1 line: 'Hold (up arrow glyph) for options' and add + @ / and what they do there at the top as 3 new items".
 * The chat box's placeholder is now "Hold ↑ for options", so a hold on Send always opens this menu: the three
 * characters that open a picker (the words are the desktop's: the placeholder's "skills and commands", the
 * `/mention` command's "Mention a file", the `+` list's agents), then, after a divider, what a hold did before
 * (Interrupt & Send and Queue while the agent works, Queue while it is idle) once there is a draft to send, with
 * Compact & Send before Queue while the draft has text (2026-11-12).
 */
export const TRIGGER_ROWS: readonly MenuRow[] = [
  {
    character: '/',
    label: 'Skills and commands',
    description: 'Use a skill or run a command',
    command: { type: 'insertTrigger', character: '/' },
  },
  {
    character: '@',
    label: 'Mention a file',
    description: 'Pick a file from this project',
    command: { type: 'insertTrigger', character: '@' },
  },
  {
    character: '+',
    label: 'Add an agent',
    description: 'Mention another agent in this project',
    command: { type: 'insertTrigger', character: '+' },
  },
];

export function sendMenuRows({
  ready,
  canQueue,
  hasDraft,
  hasText,
  working,
}: {
  ready: boolean;
  canQueue: boolean;
  hasDraft: boolean;
  /** The draft has text, which Compact & Send needs. */
  hasText: boolean;
  working: boolean;
}): MenuRow[] {
  const rows: MenuRow[] = TRIGGER_ROWS.map((row) => ({ ...row, disabled: !ready }));
  if (!hasDraft) return rows;
  return [...rows, { separator: true }, ...sendChoiceRows({ ready, canQueue, working, compact: hasText })];
}

/**
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User, of the chat's top bar ⋯ menu and the chat box's ⋯ (More actions): "please merge these 2. No need for top 3 dots. The one in chat is enough." The rows only the top bar menu had (the app's own screens and the tab, which the core's `hostActions` do not carry) are More actions rows now, each shown only where the screen performs it (`serves`); the top bar keeps its ⋯ in the terminal view alone, which has no chat box. Settings and Disconnect left.
 *
 * CDXC:ContextMenus 2026-11-20 SEE-ALSO: packages/gx-core/src/sidebar_menu/layout.rs, where the user's decision (Q4292,
 * "Apply as shown") is recorded. This menu is the `phoneChat` spot of the one session menu (session-menu/layout.ts):
 * the tiles Rename, Files & Links and Side Chat, the chat's own rows, the rows every session menu shares
 * (Coordinator, Mark Thread Done, Copy, Tag As, from the long-press menu's builders for this chat's session), one More
 * submenu and Close. It supersedes layout A (2026-11-12, Q2723): the Agent ›, Project › and More › submenus are this one
 * More, and every row's name and icon are the layout's.
 */

/** A submenu row whose value rows lack a glyph get the given one (the core's option values, a fork's branch). */
function withIcon(rows: MenuRow[], iconPath: string): MenuRow[] {
  return rows.map((row) =>
    row.heading === true || row.separator === true || row.iconPath !== undefined || typeof row.icon === 'string'
      ? row
      : { ...row, iconPath },
  );
}

/** The layout's icon id as the path this sheet's rows name glyphs by. */
function iconPathOf(icon: string): string {
  return `titlebar/${icon}.svg`;
}

/**
 * Rows of the long-press menu's builders (screens/sessions-screen/sidebar-menus.ts) as this sheet's rows: each row's
 * command goes to the screen as the `sessionMenu` host action with the computer and session the rows were built for,
 * and the screen runs it on that session (screens/terminal-screen/use-session-menu-runner.tsx). Coordinator › View
 * Playbook is the chat's own `viewPlaybook` host action, which opens the playbook of the chat's computer and project.
 */
export function sessionMenuRows(
  items: readonly SidebarMenuItem[],
  target: { machineId: string; sessionId: string },
): MenuRow[] {
  return items.map((item): MenuRow => {
    if (item.separator === true) return { separator: true };
    if (item.heading === true) return { heading: true, label: item.label ?? '' };
    const row: MenuRow = {
      label: item.label ?? '',
      checked: item.checked,
      disabled: item.disabled,
      ...(item.icon !== undefined ? { iconPath: iconPathOf(item.icon) } : {}),
      ...(item.iconColor !== undefined ? { iconColor: item.iconColor } : {}),
      ...(item.danger === true ? { destructive: true } : {}),
      ...(item.suffix !== undefined ? { detail: item.suffix } : {}),
    };
    if (item.children !== undefined) return { ...row, children: sessionMenuRows(item.children, target) };
    const command = item.command;
    if (command === undefined) return row;
    if (command.type === 'coordinatorSessionAction' && command.action === 'viewPlaybook') {
      return { ...row, command: { type: 'host', action: 'viewPlaybook' } };
    }
    return { ...row, command: { type: 'host', action: 'sessionMenu', menuCommand: command, ...target } };
  });
}

/** How this sheet's rows are put together around the layout's places. */
const CHAT_MENU_MAKE: SessionMenuMake<MenuRow> = {
  separator: () => ({ separator: true }),
  tiles: (tiles) => ({ tiles }),
  more: (label, icon, children) => ({ label, iconPath: iconPathOf(icon), children }),
  isSeparator: (row) => row.separator === true,
};

/** The places the chat fills from the long-press menu's builders, for its session (`MoreActionsInput.sessionRows`). */
const SHARED_PLACES = new Set([
  'coordinator',
  'markThreadDone',
  'copy',
  'tagAs',
  'closeAfterDone',
  'linkTo',
  'makeCoordinator',
  'postponeBy',
  'close',
]);

/** The chat's host action for a place of the layout, where the two names differ. */
const HOST_ACTION_FOR: Record<string, string> = {
  delayedSend: 'delayedActions',
  files: 'docs',
};

export function moreActionsRows({
  document,
  layout,
  available,
  serves,
  sessionRows,
  draft = '',
  voiceCallTitle = '',
  voiceCallGbotName = '',
  allFolded = false,
  sleeping = false,
  delayedSend = true,
}: MoreActionsInput): MenuRow[] {
  const folded = (id: string): boolean => allFolded || overflowed(document, id);
  const actions = document.hostActions ?? [];
  const label = (id: string, alt = false): string => entryLabel(layout, id, alt);
  const icon = (id: string, alt = false): string => iconPathOf(entryIcon(layout, id, alt));
  /** A row under the layout's name and icon for `id`, red when the layout says so. */
  const layoutRow = (id: string, command: MenuRow, extra: MenuRow = {}, alt = false): MenuRow => ({
    label: label(id, alt),
    iconPath: icon(id, alt),
    ...(entryDanger(layout, id) ? { destructive: true } : {}),
    ...extra,
    command,
  });
  /** A row of an app-shell action the screen performs, when it does. */
  const hostRow = (id: string, extra: MenuRow = {}, alt = false): MenuRow[] => {
    const action = HOST_ACTION_FOR[id] ?? id;
    return serves(action) ? [layoutRow(id, { type: 'host', action }, extra, alt)] : [];
  };
  /** A row of a host action the core offers here (gx-chat-core `composer/host_actions.rs`) and the screen performs. */
  const coreRow = (id: string, alt = false): MenuRow[] => {
    const action = HOST_ACTION_FOR[id] ?? id;
    return actions.some((entry) => entry.id === action) ? hostRow(id, {}, alt) : [];
  };

  const fill = (id: string): MenuRow[] => {
    if (SHARED_PLACES.has(id)) return sessionRows === undefined ? [] : sessionRows(id);
    switch (id) {
      case 'delayedSend':
        // Delayed Send off on the computer (CDXC:DelayedSend 2026-11-28 in sessions/delayedActionsSwitch.ts).
        return delayedSend ? coreRow(id) : [];
      case 'rename':
      case 'fork':
      case 'fullReload':
        return coreRow(id);
      case 'sleep':
        // The session sleeps: the core's Sleep row reads Wake, as the sidebar's does.
        return coreRow(id, sleeping);
      case 'filesLinks':
        // Files & Links is always here, never a toolbar button (desktop `actions.rs`, CDXC:FilesAndLinks
        // 2026-10-15 there); it opens as a sheet.
        return document.composerActions?.files !== false
          ? [
              layoutRow(
                id,
                { type: 'composerHost', action: 'filesLinks' },
                { checked: document.filesLinks?.open === true },
              ),
            ]
          : [];
      case 'sideChat':
        // Side Chat: offered only for agents that take `/btw` (core `composer/side_chat.rs`).
        return typeof document.sideChat === 'string'
          ? [layoutRow(id, { type: 'toggleSideChat', text: draft }, { checked: draft.startsWith(document.sideChat) })]
          : [];
      case 'chatToolbar': {
        // The toolbar controls folded off the chat box, in their own words (`COMPOSER_CONTROLS`).
        const rows: MenuRow[] = [];
        if (folded('attach') && available('attach')) {
          rows.push({
            label: 'Attach a file or folder',
            iconPath: 'titlebar/paperclip.svg',
            command: { type: 'composerHost', action: 'attachPath' },
          });
        }
        // Terminal View never folds for width on the phone's full chat box (`NativeComposer`), so it is a row only in a
        // pane's, on Native sessions, or where Settings › Experience keeps it off the row; for Terminal sessions there
        // a terminal problem shows under it, with Copy Report (CDXC:Experience 2026-11-15 in gx-chat-core composer/row.rs).
        if ((allFolded || rowFolded(document, 'terminal')) && available('terminal')) {
          const issue = terminalIssue(document);
          rows.push({
            label: document.nonCliMode === true ? 'Switch to Terminal-based' : 'Terminal View',
            iconPath: 'titlebar/terminal-2.svg',
            ...(issue === null ? {} : { description: issue }),
            ...(document.nonCliMode === true ? { info: SWITCH_TO_TERMINAL_BASED_INFO } : {}),
            // On a Native chat the row really switches, after the chat screen's sheet asks (`SwitchToTerminalSheet`).
            command:
              document.nonCliMode === true
                ? { type: 'host', action: 'switchToTerminalBased', source: 'more_menu' }
                : { type: 'composerHost', action: 'terminalView' },
          });
          if (issue !== null) {
            rows.push({ label: 'Copy Report', iconPath: 'titlebar/copy.svg', command: { type: 'copyReport' } });
          }
        }
        return rows;
      }
      case 'switchToNative': {
        const offer = document.nativeSwitch;
        if (offer == null || offer.showMenuItem !== true) return [];
        if (offer.queued) {
          return [
            {
              label: 'Cancel Switch to Native',
              iconPath: 'titlebar/clock.svg',
              detail: 'When this reply ends',
              command: { type: 'host', action: 'cancelSwitchToNative' },
            },
          ];
        }
        return [
          layoutRow(
            id,
            {
              type: 'host',
              action: 'switchToNative',
              family: offer.family,
              agentName: offer.agentName,
              nativeDefault: offer.nativeDefault,
            },
            { info: SWITCH_TO_NATIVE_INFO },
          ),
        ];
      }
      case 'view':
        return [{ ...viewModesRow(document, available('summary')), label: label(id), iconPath: icon(id) }];
      case 'stopReading':
        // Stop Reading, while this chat is being read; Auto-read lives under View.
        return document.readAloud?.available === true && document.readAloud.speaking
          ? [layoutRow(id, { type: 'readAloudStop' })]
          : [];
      case 'searchConversation':
        // The transcript's search bar, which the top bar menu opened before the two menus merged.
        return [layoutRow(id, { type: 'searchOpen' })];
      case 'switchAccount': {
        if (!actions.some((action) => action.id === 'switchAccount')) return [];
        // Desktop's rule (actions.rs, a user decision there): Claude and Codex sessions open the
        // Accounts & limits panel; other agents keep the daemon's switchable-agent rows.
        if (obj(document.accountPanel) !== null) {
          return [{ label: label(id), iconPath: icon(id), children: [{ accounts: document.accountPanel }] }];
        }
        if (!serves('switchAccount')) return [];
        const accounts = arr(document.switchableAgents).map((account) => ({
          label: str(account, 'name'),
          icon: str(account, 'icon'),
          command: { type: 'host', action: 'switchAccount', agentId: obj(account)?.agentId ?? null },
        }));
        return accounts.length > 0 ? [{ label: label(id), iconPath: icon(id), children: accounts }] : [];
      }
      case 'note': {
        /**
         * CDXC:SessionChat 2026-10-29 DECISION:
         * User, on the terminal view's More actions menu matching the chat's (Q729, "Yes, add it"): the chat's More actions menu gets a Session note row after Close After Done, with the same "1" badge when a note exists, on the computer and the phone. The note toolbar button is never offered (the core's `composerActions.note` is off), so this row is the only way in unless the control folded here itself.
         * Here it opens the chat's own note panel, the one the terminal view's menu opens on the phone; the computer opens the same note dialog the terminal row opens (desktop `actions.rs`). Since 2026-11-20 it is the layout's Note, in More.
         */
        // The screen lists `sessionNote` among its actions only while the computer has Session notes on
        // (`sessions/sessionNotesSwitch.ts`; CDXC:SessionNotes 2026-10-30).
        const noteFolded = folded('note') && available('note');
        if (!((serves('sessionNote') && document.composerActions?.files !== false) || noteFolded)) return [];
        return [
          layoutRow(
            id,
            { type: 'composerHost', action: 'sessionNote' },
            { ...(document.composerChrome.notePresence ? { badge: '1' } : {}), checked: document.note.open },
          ),
        ];
      }
      case 'export':
        // The chat's own Handoff / Export dialog (NativeChatScreen), on the sessions the long-press menu offers it for.
        return (sessionRows === undefined || sessionRows('export').length > 0) && serves('exportTranscript')
          ? [layoutRow(id, { type: 'host', action: 'exportTranscript' })]
          : [];
      case 'branches': {
        const branches = branchesRow(document);
        return branches === null ? [] : [{ ...branches, label: label(id), iconPath: icon(id) }];
      }
      case 'voiceCall': {
        // A voice call about this session (`src/voice/callAbout.ts` has the DECISION).
        if (!serves('voiceCall')) return [];
        const chatName = voiceCallTitle.length > 0 ? voiceCallTitle : 'this chat';
        return [
          layoutRow(
            id,
            { type: 'host', action: 'voiceCall' },
            {
              ...(voiceCallGbotName.length > 0 ? { label: `Call ${voiceCallGbotName}` } : {}),
              description:
                voiceCallGbotName.length > 0
                  ? `Talk with ${voiceCallGbotName} about ${chatName}`
                  : `Talk only about ${chatName}`,
            },
          ),
        ];
      }
      case 'promptEditor':
        // Prompt Editor writes the next message in a full-screen sheet; the core leaves it out of this menu for the
        // desktop, whose chat box has its own button, which the phone's has not.
        return hostRow(id);
      case 'catchUp':
        /**
         * CDXC:SessionChat 2026-10-17 DECISION:
         * User: "Move catch me up on mobile to be inside the 3 dots menu above side chat". The phone has no Catch me up button on the composer; this row sends the same action (it opens the card, or closes it when open) whenever the button would have shown. Desktop keeps its button.
         * The one session menu (2026-11-20) puts it in More.
         */
        return document.catchUp?.button === true
          ? [layoutRow(id, { type: 'catchUp' }, document.catchUp.loading ? { label: 'Catching up…' } : {})]
          : [];
      case 'files':
      case 'changes':
      case 'newTerminal':
      case 'killSession':
        return hostRow(id);
      case 'stashPrompt': {
        // Stash Prompt stashes the draft, or opens Saved prompts from an empty chat box (actions.rs
        // `stash_menu_row`). The stash count is the row's `badge`, a circle after the label (user, 2026-10-22).
        if (!available('stash')) return [];
        const stashed = document.composerChrome.stashBadge;
        return [
          layoutRow(id, { type: 'composerHost', action: 'stashPrompt' }, stashed !== null ? { badge: stashed } : {}),
        ];
      }
      case 'skills':
        return [{ ...skillsRow(document), label: label(id), iconPath: icon(id) }];
      case 'chatOptions':
        return chatOptionRows(document, allFolded);
      default:
        return [];
    }
  };
  return assembleSessionMenu(layout, 'phoneChat', fill, CHAT_MENU_MAKE);
}

/**
 * The option settings, when they fold here because the core says they overflow or the composer draws none of them;
 * then only where there is one to show, as the core's `hasOverflowOptions` has it.
 */
function chatOptionRows(document: ChatDocument, allFolded: boolean): MenuRow[] {
  const rows: MenuRow[] = [];
  const labels = obj(document.optionLabels);
  const merged = obj(document.modelMenu) !== null;
  // CDXC:SessionDetails 2026-11-12 DECISION: the Context window row and its sheet went where Session details carries
  // the context (its first tab's Context card and its second tab's details, `SessionDetailsSheet.tsx`); a computer too
  // old to send Session details keeps them.
  const contextRow = obj(document.contextMeter) !== null && sessionDetailsRingOf(document) === null;
  const optionsFolded = allFolded
    ? (isTrue(labels, 'showOptions') && !merged) || contextRow
    : document.composerOverflow?.optionsOverflowed === true;
  // Settings › Experience can keep the context ring off the row: then only its row is here.
  const ringOff = document.composerRow?.hideContextRing === true;
  if (optionsFolded || ringOff) {
    if (contextRow) {
      rows.push({
        label: 'Context window',
        iconPath: 'titlebar/circle-half.svg',
        detail: str(document.contextMeter, 'percentage'),
        children: [{ context: document.contextMeter }],
      });
    }
    if (optionsFolded && isTrue(labels, 'showOptions') && !merged) {
      rows.push({
        label: str(labels, 'optionsTitle') || 'Options',
        iconPath: 'titlebar/adjustments-horizontal.svg',
        detail: str(labels, 'options'),
        disabled: str(labels, 'options').length === 0,
        children: withIcon(rowsOf(obj(document.optionMenus)?.options), 'titlebar/brain.svg'),
      });
    }
  }
  return rows;
}

/** A pill's menu (`show_option_menu`): the document's rows. */
export function optionMenuRows(document: ChatDocument, kind: 'model' | 'options' | 'mode'): MenuRow[] {
  return arr(obj(document.optionMenus)?.[kind])
    .map((row) => obj(row))
    .filter((row): row is MenuRow => row !== null);
}
