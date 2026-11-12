/**
 * The rows of the composer's menus, built from the document the way desktop builds them
 * (`actions.rs`, `show_actions`; `option_menu/window.rs`, `show_option_menu`). Rows that need the
 * app shell (`{type: 'host', ...}`) appear only for the actions the screen performs.
 */

import type { ChatDocument } from '../../rust/document';
import { arr, isTrue, obj, str } from './json';
import { rowsOf, type MenuRow } from './MenuSheet';
import { sessionDetailsRingOf } from '../cards/SessionDetailsSheet';

/** The toolbar controls in desktop's order, which is also the order they fold into More actions
 * (`toolbar.rs`, `COMPOSER_CONTROLS`). Maximize is desktop-only. Files and links, Summary mode (under
 * View) and Stash prompt are always More actions rows, and Dictate always shows right before Send and
 * never folds (desktop CDXC:SessionChat 2026-10-20). */
export const COMPOSER_CONTROLS = [
  { id: 'note', action: 'sessionNote', label: 'Session note', icon: 'titlebar/note.svg' },
  { id: 'attach', action: 'attachPath', label: 'Attach a file or folder', icon: 'titlebar/paperclip.svg' },
  { id: 'terminal', action: 'terminalView', label: 'Terminal View', icon: 'titlebar/terminal-2.svg' },
] as const;

export type ComposerControlId = (typeof COMPOSER_CONTROLS)[number]['id'];
/** A host gate under `composerActions`: the toolbar controls plus the More actions rows they gate. */
export type ComposerActionId = ComposerControlId | 'summary' | 'stash' | 'dictate';

const HOST_ACTION_ICONS: Record<string, string> = {
  delayedActions: 'titlebar/clock-check.svg',
  fork: 'titlebar/git-fork.svg',
  fullReload: 'titlebar/refresh.svg',
  rename: 'titlebar/pencil.svg',
  sleep: 'titlebar/moon.svg',
  switchAccount: 'titlebar/switch-horizontal.svg',
  viewPlaybook: 'titlebar/book.svg',
};

export function overflowed(document: ChatDocument, id: string): boolean {
  return document.composerOverflow?.overflowed?.includes(id) === true;
}

export type MoreActionsInput = {
  document: ChatDocument;
  /** Controls this composer can draw (the host gates plus what the phone serves). */
  available: (id: ComposerActionId) => boolean;
  /** Whether the screen performs this app-shell action (`NativeComposer`'s `hostActions`). */
  serves: (action: string) => boolean;
  /** The chat box's text, which Side chat toggles its `/btw ` prefix on. */
  draft?: string;
  /** The session's title, for Voice call about this chat's hint (the row shows when `serves('voiceCall')`). */
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
  // Auto-read, under the view settings since layout A (CDXC:SessionChat 2026-11-12 above `moreActionsRows`).
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
 * Read aloud's Auto-read check, in View, which says why it is quiet during a voice call or dictation. Stop reading
 * is a first-page row of its own while this chat is being read (`moreActionsRows`).
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
 * User picked layout A of the "phone chat menu cleanup" page (Q2723) for the chat box's ⋯ (More actions), on the phone
 * and the computer, then which rows go (Q2725): "Move send ones under holding send button". The first page holds the
 * rows a phone uses (Attach, Search conversation, Files and links, Voice call, Side chat, Prompt editor, View ›, and
 * Catch me up, Stop reading and a pane's Terminal View when they apply), then three submenus: Agent › (the session's
 * actions, Session note, Branches, Kill session), Project › (Files, Changes, New terminal) and More › (Stash prompt,
 * Skills, and the folded Context window and Options). Auto-read moved into View ›. Interrupt & Send and Compact & Send
 * left for Send's hold menu (`sendMenuRows`); Close After Done and Handoff / Export left (gx-chat-core
 * `composer/host_actions.rs`, which no longer offers them here); Settings and Disconnect left (the Sessions list's ⋯
 * and the tab's ×). Every row, submenu and value row has its own glyph. The computer's menu takes the same shape
 * (desktop `actions.rs` `show_actions`) without the phone-only rows.
 */
const AGENT_FIRST = ['rename', 'sleep', 'fork', 'fullReload', 'switchAccount'];

/**
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User, of the chat's top bar ⋯ menu and the chat box's ⋯ (More actions): "please merge these 2. No need for top 3 dots. The one in chat is enough." The rows only the top bar menu had (the app's own screens and the tab, which the core's `hostActions` do not carry) are More actions rows now, each shown only where the screen performs it (`serves`); the top bar keeps its ⋯ in the terminal view alone, which has no chat box. Layout A (above) keeps Files, Changes and New terminal under Project and Kill session under Agent; Settings and Disconnect left.
 */

const SHELL_ICONS: Record<string, string> = {
  docs: 'titlebar/folder.svg',
  changes: 'titlebar/file-diff.svg',
  newTerminal: 'titlebar/terminal.svg',
  killSession: 'titlebar/axe.svg',
};

/** A submenu row whose value rows lack a glyph get the given one (the core's option values, a fork's branch). */
function withIcon(rows: MenuRow[], iconPath: string): MenuRow[] {
  return rows.map((row) =>
    row.heading === true || row.separator === true || row.iconPath !== undefined || typeof row.icon === 'string'
      ? row
      : { ...row, iconPath },
  );
}

export function moreActionsRows({
  document,
  available,
  serves,
  draft = '',
  voiceCallTitle = '',
  voiceCallGbotName = '',
  allFolded = false,
  sleeping = false,
}: MoreActionsInput): MenuRow[] {
  const rows: MenuRow[] = [];
  const folded = (id: string): boolean => allFolded || overflowed(document, id);
  const actions = document.hostActions ?? [];
  const hostRow = (action: (typeof actions)[number]): MenuRow =>
    action.id === 'sleep' && sleeping
      ? { label: 'Wake', iconPath: 'titlebar/player-play.svg', command: { type: 'host', action: action.id } }
      : {
          label: action.label,
          iconPath: HOST_ACTION_ICONS[action.id] ?? null,
          command: { type: 'host', action: action.id },
        };

  // The first page.
  if (folded('attach') && available('attach')) {
    rows.push({
      label: 'Attach a file or folder',
      iconPath: 'titlebar/paperclip.svg',
      command: { type: 'composerHost', action: 'attachPath' },
    });
  }
  // The transcript's search bar, which the top bar menu opened before the two menus merged.
  rows.push({ label: 'Search conversation', iconPath: 'titlebar/search.svg', command: { type: 'searchOpen' } });
  // Files and links is always here, never a toolbar button (desktop `actions.rs`,
  // CDXC:FilesAndLinks 2026-10-15 there); it opens as a sheet.
  if (document.composerActions?.files !== false) {
    rows.push({
      label: 'Files and links',
      iconPath: 'titlebar/link.svg',
      checked: document.filesLinks?.open === true,
      command: { type: 'composerHost', action: 'filesLinks' },
    });
  }
  // A voice call about this session (`src/voice/callAbout.ts` has the DECISION).
  if (serves('voiceCall')) {
    const chatName = voiceCallTitle.length > 0 ? voiceCallTitle : 'this chat';
    rows.push({
      label: voiceCallGbotName.length > 0 ? `Call ${voiceCallGbotName}` : 'Voice call about this chat',
      iconPath: 'titlebar/headset.svg',
      description:
        voiceCallGbotName.length > 0 ? `Talk with ${voiceCallGbotName} about ${chatName}` : `Talk only about ${chatName}`,
      command: { type: 'host', action: 'voiceCall' },
    });
  }
  // Side chat: offered only for agents that take `/btw` (core `composer/side_chat.rs`).
  if (typeof document.sideChat === 'string') {
    rows.push({
      label: 'Side chat',
      iconPath: 'titlebar/message-circle.svg',
      checked: draft.startsWith(document.sideChat),
      command: { type: 'toggleSideChat', text: draft },
    });
  }
  // Prompt editor writes the next message in a full-screen sheet; the core leaves it out of this menu for the
  // desktop, whose chat box has its own button, which the phone's has not.
  if (serves('promptEditor')) {
    rows.push({ label: 'Prompt editor', iconPath: 'titlebar/edit.svg', command: { type: 'host', action: 'promptEditor' } });
  }
  rows.push(viewModesRow(document, available('summary')));
  // Stop reading, while this chat is being read; Auto-read lives under View.
  if (document.readAloud?.available === true && document.readAloud.speaking) {
    rows.push({ label: 'Stop reading', iconPath: 'titlebar/player-stop.svg', command: { type: 'readAloudStop' } });
  }
  /**
   * CDXC:SessionChat 2026-10-17 DECISION:
   * User: "Move catch me up on mobile to be inside the 3 dots menu above side chat". The phone has no Catch me up button on the composer; this row sends the same action (it opens the card, or closes it when open) whenever the button would have shown. Desktop keeps its button.
   * Layout A (2026-11-12, above) puts it under View, with the other rows that show only now and then.
   */
  if (document.catchUp?.button === true) {
    rows.push({
      label: document.catchUp.loading ? 'Catching up…' : 'Catch me up',
      iconPath: 'titlebar/history.svg',
      command: { type: 'catchUp' },
    });
  }
  // Terminal View never folds on the phone's full chat box (`NativeComposer`), so it is a row only in a pane's.
  if (allFolded && available('terminal')) {
    rows.push({
      label: 'Terminal View',
      iconPath: 'titlebar/terminal-2.svg',
      command: { type: 'composerHost', action: 'terminalView' },
    });
  }
  // Agent ›: the session's actions, then the ones about this chat, then Kill session.
  const sessionRows: MenuRow[] = [];
  const chatRows: MenuRow[] = [];
  // Every host action the core offers here (gx-chat-core `composer/host_actions.rs`), the agent's own first.
  const ordered = [
    ...AGENT_FIRST.flatMap((id) => actions.filter((action) => action.id === id)),
    ...actions.filter((action) => !AGENT_FIRST.includes(action.id)),
  ];
  for (const action of ordered) {
    const into = AGENT_FIRST.includes(action.id) ? sessionRows : chatRows;
    if (action.id === 'switchAccount') {
      // Desktop's rule (actions.rs, a user decision there): Claude and Codex sessions open the
      // Accounts & limits panel; other agents keep the daemon's switchable-agent rows.
      if (obj(document.accountPanel) !== null) {
        into.push({
          label: 'Switch Account',
          iconPath: HOST_ACTION_ICONS.switchAccount,
          children: [{ accounts: document.accountPanel }],
        });
        continue;
      }
      if (!serves('switchAccount')) continue;
      const accounts = arr(document.switchableAgents).map((account) => ({
        label: str(account, 'name'),
        icon: str(account, 'icon'),
        command: { type: 'host', action: 'switchAccount', agentId: obj(account)?.agentId ?? null },
      }));
      if (accounts.length > 0)
        into.push({ label: 'Switch Account', iconPath: HOST_ACTION_ICONS.switchAccount, children: accounts });
    } else if (serves(action.id)) {
      into.push(hostRow(action));
    }
  }
  /**
   * CDXC:SessionChat 2026-10-29 DECISION:
   * User, on the terminal view's More actions menu matching the chat's (Q729, "Yes, add it"): the chat's More actions menu gets a Session note row after Close After Done, with the same "1" badge when a note exists, on the computer and the phone. The note toolbar button is never offered (the core's `composerActions.note` is off), so this row is the only way in unless the control folded here itself.
   * Here it opens the chat's own note panel, the one the terminal view's menu opens on the phone; the computer opens the same note dialog the terminal row opens (desktop `actions.rs`). Layout A (2026-11-12) puts it under Agent.
   */
  // The screen lists `sessionNote` among its actions only while the computer has Session notes on
  // (`sessions/sessionNotesSwitch.ts`; CDXC:SessionNotes 2026-10-30).
  const noteFolded = folded('note') && available('note');
  if ((serves('sessionNote') && document.composerActions?.files !== false) || noteFolded) {
    chatRows.push({
      label: 'Session note',
      iconPath: 'titlebar/note.svg',
      ...(document.composerChrome.notePresence ? { badge: '1' } : {}),
      checked: document.note.open,
      command: { type: 'composerHost', action: 'sessionNote' },
    });
  }
  const branches = branchesRow(document);
  if (branches !== null) chatRows.push(branches);
  const killRows: MenuRow[] = serves('killSession')
    ? [
        {
          label: 'Kill session',
          iconPath: SHELL_ICONS.killSession,
          destructive: true,
          command: { type: 'host', action: 'killSession' },
        },
      ]
    : [];
  const agentRows = [sessionRows, chatRows, killRows]
    .filter((group) => group.length > 0)
    .flatMap((group, index) => (index === 0 ? group : [{ separator: true }, ...group]));

  // Project ›: the project's own screens and a new terminal.
  const projectRows: MenuRow[] = [
    { id: 'docs', label: 'Files' },
    { id: 'changes', label: 'Changes' },
    { id: 'newTerminal', label: 'New terminal' },
  ]
    .filter((row) => serves(row.id))
    .map((row) => ({ label: row.label, iconPath: SHELL_ICONS[row.id], command: { type: 'host', action: row.id } }));

  // More ›: Stash prompt, Skills, then the option settings when they fold here.
  const moreRows: MenuRow[] = [];
  // Stash prompt stashes the draft, or opens Saved prompts from an empty chat box (actions.rs
  // `stash_menu_row`). The stash count is the row's `badge`, a circle after the label (user, 2026-10-22).
  if (available('stash')) {
    const stashed = document.composerChrome.stashBadge;
    moreRows.push({
      label: 'Stash prompt',
      iconPath: 'titlebar/stack-push.svg',
      ...(stashed !== null ? { badge: stashed } : {}),
      command: { type: 'composerHost', action: 'stashPrompt' },
    });
  }
  moreRows.push(skillsRow(document));
  const labels = obj(document.optionLabels);
  const merged = obj(document.modelMenu) !== null;
  // The option settings fold here when the core says they overflow, or when the composer draws none of them; then
  // only where there is one to show, as the core's `hasOverflowOptions` has it.
  // CDXC:SessionDetails 2026-11-12 DECISION: the Context window row and its sheet went where Session details carries
  // the context (its first tab's Context card and its second tab's details, `SessionDetailsSheet.tsx`); a computer too
  // old to send Session details keeps them.
  const contextRow = obj(document.contextMeter) !== null && sessionDetailsRingOf(document) === null;
  const optionsFolded = allFolded
    ? (isTrue(labels, 'showOptions') && !merged) || contextRow
    : document.composerOverflow?.optionsOverflowed === true;
  if (optionsFolded) {
    if (contextRow) {
      moreRows.push({
        label: 'Context window',
        iconPath: 'titlebar/circle-half.svg',
        detail: str(document.contextMeter, 'percentage'),
        children: [{ context: document.contextMeter }],
      });
    }
    if (isTrue(labels, 'showOptions') && !merged) {
      moreRows.push({
        label: str(labels, 'optionsTitle') || 'Options',
        iconPath: 'titlebar/adjustments-horizontal.svg',
        detail: str(labels, 'options'),
        disabled: str(labels, 'options').length === 0,
        children: withIcon(rowsOf(obj(document.optionMenus)?.options), 'titlebar/brain.svg'),
      });
    }
  }

  const submenus: MenuRow[] = [];
  if (agentRows.length > 0) submenus.push({ label: 'Agent', iconPath: 'titlebar/robot.svg', children: agentRows });
  if (projectRows.length > 0) submenus.push({ label: 'Project', iconPath: 'titlebar/folders.svg', children: projectRows });
  submenus.push({ label: 'More', iconPath: 'titlebar/dots.svg', children: moreRows });
  return [...rows, { separator: true }, ...submenus];
}

/** A pill's menu (`show_option_menu`): the document's rows. */
export function optionMenuRows(document: ChatDocument, kind: 'model' | 'options' | 'mode'): MenuRow[] {
  return arr(obj(document.optionMenus)?.[kind])
    .map((row) => obj(row))
    .filter((row): row is MenuRow => row !== null);
}
