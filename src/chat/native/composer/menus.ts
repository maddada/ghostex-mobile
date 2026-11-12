/**
 * The rows of the composer's menus, built from the document the way desktop builds them
 * (`actions.rs`, `show_actions`; `option_menu/window.rs`, `show_option_menu`). Rows that need the
 * app shell (`{type: 'host', ...}`) appear only for the actions the screen performs.
 */

import type { ChatDocument } from '../../rust/document';
import { arr, isTrue, obj, str } from './json';
import { rowsOf, type MenuRow } from './MenuSheet';

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
  closeAfterDone: 'titlebar/clock.svg',
  delayedActions: 'titlebar/clock-check.svg',
  exportTranscript: 'titlebar/file-export.svg',
  fork: 'titlebar/git-branch.svg',
  fullReload: 'titlebar/refresh.svg',
  rename: 'titlebar/pencil.svg',
  sleep: 'titlebar/moon.svg',
  switchAccount: 'titlebar/switch-horizontal.svg',
  viewPlaybook: 'titlebar/book.svg',
};

/**
 * The computer's actions that sit in the Chat group, after Side chat, in the core's order (desktop
 * `actions.rs`). View playbook comes only on a coordinator's chat (gx-chat-core `composer/document.rs`)
 * and shows only where the screen serves it (`TerminalScreen`), opening the sheet the coordinator's
 * long-press menu opens (CDXC:Coordinators 2026-11-09 on gx-chat-core `composer/host_actions.rs`).
 */
const CHAT_GROUP_HOST_ACTIONS = new Set(['delayedActions', 'closeAfterDone', 'viewPlaybook']);

/**
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User, of the chat's top bar ⋯ menu and the chat box's ⋯ (More actions): "please merge these 2. No need for top 3 dots. The one in chat is enough." The rows only the top bar menu had (the app's own screens and the tab, which the core's `hostActions` do not carry) are More actions rows now, each shown only where the screen performs it (`serves`); the top bar keeps its ⋯ in the terminal view alone, which has no chat box.
 */
type ShellRow = { id: string; label: string; icon: string; destructive?: true };
const PROJECT_SHELL_ROWS: readonly ShellRow[] = [
  { id: 'docs', label: 'Files', icon: 'titlebar/folder.svg' },
  { id: 'changes', label: 'Changes', icon: 'titlebar/file-diff.svg' },
  { id: 'newTerminal', label: 'New terminal', icon: 'titlebar/terminal-2.svg' },
];
const APP_SHELL_ROWS: readonly ShellRow[] = [
  { id: 'settings', label: 'Settings', icon: 'titlebar/settings.svg' },
  { id: 'disconnect', label: 'Disconnect', icon: 'titlebar/logout.svg', destructive: true },
  { id: 'killSession', label: 'Kill session', icon: 'titlebar/axe.svg', destructive: true },
];

export function overflowed(document: ChatDocument, id: string): boolean {
  return document.composerOverflow?.overflowed?.includes(id) === true;
}

export type MoreActionsInput = {
  document: ChatDocument;
  /** Controls this composer can draw (the host gates plus what the phone serves). */
  available: (id: ComposerActionId) => boolean;
  /** Whether the screen performs this app-shell action (`NativeComposer`'s `hostActions`). */
  serves: (action: string) => boolean;
  /**
   * Compact & Send, while there is a draft. Desktop offers it in Send's own right-click menu
   * (`show_send_actions` in `actions.rs`) and on Option+Enter; a phone has neither, and Send's hold
   * already queues, so it leads this menu instead.
   */
  compactAndSend?: { disabled: boolean } | null;
  /**
   * Interrupt & Send, while there is a draft and the agent is working: it stops the running turn
   * and sends the draft now. Desktop has it on Ctrl+Enter and in Send's right-click menu.
   */
  interruptAndSend?: { disabled: boolean } | null;
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
  const children = rowsOf(branches?.menu).map((row) =>
    row.heading === true && tooltip.length > 0 ? { ...row, description: tooltip } : row,
  );
  if (children.length === 0) return null;
  return { label: 'Branches', iconPath: 'titlebar/git-branch.svg', detail: String(branches?.count ?? ''), children };
}

/**
 * Read aloud's rows, below View: Stop reading while this chat is being read, then the Auto-read
 * check, which says why it is quiet during a voice call or dictation.
 *
 * CDXC:VoiceMode 2026-10-20 DECISION: User: the Auto-read switch lives in the composer's ⋯ (More actions) menu on both apps; it reads each finished reply of the chat on screen. Its rows show only while the chat's computer has Read aloud on and the phone has a voice (`readAloud.available`).
 */
function readAloudRows(document: ChatDocument): MenuRow[] {
  const state = document.readAloud;
  if (state?.available !== true) return [];
  const rows: MenuRow[] = [];
  if (state.speaking) {
    rows.push({ label: 'Stop reading', iconPath: 'titlebar/player-stop.svg', command: { type: 'readAloudStop' } });
  }
  const held =
    state.autoReadHeld === 'voiceConversation'
      ? 'Quiet during the voice call'
      : state.autoReadHeld === 'dictation'
        ? 'Quiet while you dictate'
        : null;
  rows.push({
    label: 'Auto-read',
    iconPath: 'titlebar/volume.svg',
    checked: state.autoRead,
    ...(held !== null ? { description: held } : {}),
    command: { type: 'readAloudAuto' },
  });
  return rows;
}

/**
 * The Skills row: the Ghostex skills the agent has installed, each putting its pill in the chat box
 * (core `composer/ghostex_skills.rs`, a user decision there), then Configure / Install more.
 */
function skillsRow(document: ChatDocument): MenuRow {
  const skills: MenuRow[] = (document.ghostexSkills ?? []).map((skill) => ({
    label: skill.name,
    description: skill.description ?? null,
    command: { type: 'insertSkill', name: skill.name },
  }));
  if (skills.length === 0) skills.push({ label: 'No Ghostex skills installed', disabled: true });
  skills.push(
    { separator: true },
    { label: 'Configure / Install more', iconPath: 'titlebar/settings.svg', command: { type: 'openSkillsSettings' } },
  );
  return { label: 'Skills', iconPath: 'titlebar/sparkles.svg', children: skills };
}

/**
 * CDXC:SessionChat 2026-10-11 DECISION:
 * User: on the phone, while the agent works, a long press on Send opens a small sheet with "Interrupt & Send" and "Queue"; while it is idle a long press still just queues. More actions keeps its Interrupt & Send row too.
 */
export function sendChoiceRows({ ready, canQueue }: { ready: boolean; canQueue: boolean }): MenuRow[] {
  return [
    {
      label: 'Interrupt & Send',
      iconPath: 'titlebar/arrow-up.svg',
      disabled: !ready,
      command: { type: 'submit', mode: 'interrupt' },
    },
    {
      label: 'Queue',
      iconPath: 'titlebar/stack-push.svg',
      disabled: !(ready && canQueue),
      command: { type: 'submit', mode: 'queue' },
    },
  ];
}

/**
 * CDXC:SessionChat 2026-11-11 DECISION:
 * User: "Pls shorten the placeholder text on mobile app so it fits in 1 line: 'Hold (up arrow glyph) for options' and add + @ / and what they do there at the top as 3 new items".
 * The chat box's placeholder is now "Hold ↑ for options", so a hold on Send always opens this menu: the three
 * characters that open a picker (the words are the desktop's: the placeholder's "skills and commands", the
 * `/mention` command's "Mention a file", the `+` list's agents), then, after a divider, what a hold did before
 * (Interrupt & Send and Queue while the agent works, Queue while it is idle) once there is a draft to send.
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
  working,
}: {
  ready: boolean;
  canQueue: boolean;
  hasDraft: boolean;
  working: boolean;
}): MenuRow[] {
  const rows: MenuRow[] = TRIGGER_ROWS.map((row) => ({ ...row, disabled: !ready }));
  if (!hasDraft) return rows;
  const choices = sendChoiceRows({ ready, canQueue });
  return [...rows, { separator: true }, ...(working ? choices : choices.slice(1))];
}

export function moreActionsRows({
  document,
  available,
  serves,
  compactAndSend = null,
  interruptAndSend = null,
  draft = '',
  voiceCallTitle = '',
  voiceCallGbotName = '',
  allFolded = false,
  sleeping = false,
}: MoreActionsInput): MenuRow[] {
  const rows: MenuRow[] = [];
  if (interruptAndSend !== null) {
    rows.push({
      label: 'Interrupt & Send',
      iconPath: 'titlebar/arrow-up.svg',
      disabled: interruptAndSend.disabled,
      command: { type: 'submit', mode: 'interrupt' },
    });
  }
  if (compactAndSend !== null) {
    rows.push({
      label: 'Compact & Send',
      iconPath: 'titlebar/arrow-up.svg',
      disabled: compactAndSend.disabled,
      command: { type: 'submit', mode: 'compact' },
    });
  }
  if (interruptAndSend !== null || compactAndSend !== null) rows.push({ separator: true });
  const labels = obj(document.optionLabels);
  const merged = obj(document.modelMenu) !== null;
  // The option settings fold here when the core says they overflow, or when the composer draws none of them; then
  // only where there is one to show, as the core's `hasOverflowOptions` has it.
  const optionsFolded = allFolded
    ? (isTrue(labels, 'showOptions') && !merged) || obj(document.contextMeter) !== null
    : document.composerOverflow?.optionsOverflowed === true;
  if (optionsFolded) {
    rows.push({ heading: true, label: 'Model settings' });
    if (isTrue(labels, 'showOptions') && !merged) {
      rows.push({
        label: str(labels, 'optionsTitle') || 'Options',
        detail: str(labels, 'options'),
        disabled: str(labels, 'options').length === 0,
        children: arr(obj(document.optionMenus)?.options),
      });
    }
    if (obj(document.contextMeter) !== null) {
      rows.push({
        label: 'Context window',
        detail: str(document.contextMeter, 'percentage'),
        children: [{ context: document.contextMeter }],
      });
    }
    rows.push({ separator: true });
  }
  rows.push({ heading: true, label: 'Chat' });
  // The transcript's search bar, which the top bar menu opened before the two menus merged.
  rows.push({ label: 'Search conversation', iconPath: 'titlebar/search.svg', command: { type: 'searchOpen' } });
  const branches = branchesRow(document);
  if (branches !== null) rows.push(branches);
  rows.push(viewModesRow(document, available('summary')));
  rows.push(...readAloudRows(document));
  // Under Auto-read: a voice call about this session (`src/voice/callAbout.ts` has the DECISION).
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
  /**
   * CDXC:SessionChat 2026-10-17 DECISION:
   * User: "Move catch me up on mobile to be inside the 3 dots menu above side chat". The phone has no Catch me up button on the composer; this row sends the same action (it opens the card, or closes it when open) whenever the button would have shown. Desktop keeps its button.
   */
  if (document.catchUp?.button === true) {
    rows.push({
      label: document.catchUp.loading ? 'Catching up…' : 'Catch me up',
      iconPath: 'titlebar/sparkles.svg',
      command: { type: 'catchUp' },
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
    rows.push({ label: 'Prompt editor', iconPath: 'titlebar/pencil.svg', command: { type: 'host', action: 'promptEditor' } });
  }
  const actions = document.hostActions ?? [];
  const hostRow = (action: (typeof actions)[number]): MenuRow =>
    action.id === 'sleep' && sleeping
      ? { label: 'Wake', iconPath: 'titlebar/player-play.svg', command: { type: 'host', action: action.id } }
      : {
          label: action.label,
          iconPath: HOST_ACTION_ICONS[action.id] ?? null,
          command: { type: 'host', action: action.id },
        };
  for (const action of actions)
    if (CHAT_GROUP_HOST_ACTIONS.has(action.id) && serves(action.id)) rows.push(hostRow(action));
  /**
   * CDXC:SessionChat 2026-10-29 DECISION:
   * User, on the terminal view's More actions menu matching the chat's (Q729, "Yes, add it"): the chat's More actions menu gets a Session note row after Close After Done, with the same "1" badge when a note exists, on the computer and the phone. The note toolbar button is never offered (the core's `composerActions.note` is off), so this row is the only way in unless the control folded here itself.
   * Here it opens the chat's own note panel, the one the terminal view's menu opens on the phone; the computer opens the same note dialog the terminal row opens (desktop `actions.rs`).
   */
  // The screen lists `sessionNote` among its actions only while the computer has Session notes on
  // (`sessions/sessionNotesSwitch.ts`; CDXC:SessionNotes 2026-10-30).
  const folded = (id: string): boolean => allFolded || overflowed(document, id);
  const noteFolded = folded('note') && available('note');
  if (serves('sessionNote') && !noteFolded && document.composerActions?.files !== false) {
    rows.push({
      label: 'Session note',
      iconPath: 'titlebar/note.svg',
      ...(document.composerChrome.notePresence ? { badge: '1' } : {}),
      checked: document.note.open,
      command: { type: 'composerHost', action: 'sessionNote' },
    });
  }
  for (const control of COMPOSER_CONTROLS) {
    if (!folded(control.id) || !available(control.id)) continue;
    // Terminal View never folds on the phone's full chat box (`NativeComposer`), so it is a row only in a pane's.
    if (control.id === 'terminal' && !allFolded) continue;
    const row: MenuRow = {
      label: control.label,
      iconPath: control.icon,
      command: { type: 'composerHost', action: control.action },
    };
    if (control.id === 'note') row.checked = document.note.open;
    rows.push(row);
  }
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
  const agentRows: MenuRow[] = [];
  for (const action of actions) {
    if (action.group !== 'agent') continue;
    if (action.id === 'switchAccount') {
      // Desktop's rule (actions.rs, a user decision there): Claude and Codex sessions open the
      // Accounts & limits panel; other agents keep the daemon's switchable-agent rows.
      if (obj(document.accountPanel) !== null) {
        agentRows.push({
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
        agentRows.push({ label: 'Switch Account', iconPath: HOST_ACTION_ICONS.switchAccount, children: accounts });
    } else if (serves(action.id)) {
      agentRows.push(hostRow(action));
    }
  }
  if (agentRows.length > 0) {
    rows.push({ separator: true }, { heading: true, label: 'Agent' }, ...agentRows);
  }
  const other = actions.filter(
    (action) => action.group !== 'agent' && !CHAT_GROUP_HOST_ACTIONS.has(action.id) && serves(action.id),
  );
  if (other.length > 0) rows.push({ separator: true }, ...other.map(hostRow));
  // Second from the bottom, as on desktop (actions.rs `skills_row`).
  rows.splice(Math.max(rows.length - 1, 0), 0, skillsRow(document));
  // Stash prompt then takes second from the bottom, below Skills (actions.rs `stash_menu_row`): it
  // stashes the draft, or opens Saved prompts from an empty chat box. The stash count is the row's
  // `badge`, a circle after the label (user, 2026-10-22), as on desktop.
  if (available('stash')) {
    const stashed = document.composerChrome.stashBadge;
    rows.splice(Math.max(rows.length - 1, 0), 0, {
      label: 'Stash prompt',
      iconPath: 'titlebar/stack-push.svg',
      ...(stashed !== null ? { badge: stashed } : {}),
      command: { type: 'composerHost', action: 'stashPrompt' },
    });
  }
  const shellRow = (row: ShellRow): MenuRow => ({
    label: row.label,
    iconPath: row.icon,
    ...(row.destructive === true ? { destructive: true } : {}),
    command: { type: 'host', action: row.id },
  });
  const projectRows = PROJECT_SHELL_ROWS.filter((row) => serves(row.id)).map(shellRow);
  if (projectRows.length > 0) rows.push({ separator: true }, { heading: true, label: 'Project' }, ...projectRows);
  const appRows = APP_SHELL_ROWS.filter((row) => serves(row.id)).map(shellRow);
  if (appRows.length > 0) rows.push({ separator: true }, ...appRows);
  return rows;
}

/** A pill's menu (`show_option_menu`): the document's rows. */
export function optionMenuRows(document: ChatDocument, kind: 'model' | 'options' | 'mode'): MenuRow[] {
  return arr(obj(document.optionMenus)?.[kind])
    .map((row) => obj(row))
    .filter((row): row is MenuRow => row !== null);
}
