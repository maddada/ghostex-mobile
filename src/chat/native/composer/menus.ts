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
};

const CHAT_GROUP_HOST_ACTIONS = new Set(['delayedActions', 'closeAfterDone']);

export function overflowed(document: ChatDocument, id: string): boolean {
  return document.composerOverflow?.overflowed?.includes(id) === true;
}

export type MoreActionsInput = {
  document: ChatDocument;
  verbose: boolean;
  /** The phone's Simple mode setting (`sessionChatSimpleMode`). */
  simple: boolean;
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
};

/**
 * The View row: the chat's display modes as one submenu, its detail naming the ones that are on
 * (desktop's `view_modes_row` in `actions.rs`, where the user decision is recorded).
 */
function viewModesRow(document: ChatDocument, simple: boolean, verbose: boolean, summaryAvailable: boolean): MenuRow {
  const summary = summaryAvailable && document.summaryMode === true;
  const modes: MenuRow[] = [
    {
      label: 'Simple mode',
      iconPath: 'titlebar/leaf.svg',
      checked: simple,
      command: { type: 'setSimpleMode', enabled: !simple },
    },
    {
      label: 'Verbose mode',
      iconPath: verbose ? 'titlebar/eye-filled.svg' : 'titlebar/eye-off.svg',
      checked: verbose,
      command: { type: 'setVerbose', enabled: !verbose },
    },
  ];
  if (summaryAvailable) {
    modes.push({
      label: 'Summary mode',
      iconPath: summary ? 'titlebar/list-check.svg' : 'titlebar/list-details.svg',
      checked: summary,
      command: { type: 'toggleSummary' },
    });
  }
  const on = [simple ? 'Simple' : null, verbose ? 'Verbose' : null, summary ? 'Summary' : null].filter(
    (name) => name !== null,
  );
  return {
    label: 'View',
    iconPath: 'titlebar/eye.svg',
    detail: on.length > 0 ? on.join(', ') : 'Standard',
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

export function moreActionsRows({
  document,
  simple,
  verbose,
  available,
  serves,
  compactAndSend = null,
  interruptAndSend = null,
  draft = '',
  voiceCallTitle = '',
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
  if (document.composerOverflow?.optionsOverflowed === true) {
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
  const branches = branchesRow(document);
  if (branches !== null) rows.push(branches);
  rows.push(viewModesRow(document, simple, verbose, available('summary')));
  rows.push(...readAloudRows(document));
  // Under Auto-read: a voice call about this session (`src/voice/callAbout.ts` has the DECISION).
  if (serves('voiceCall')) {
    rows.push({
      label: 'Voice call about this chat',
      iconPath: 'titlebar/headset.svg',
      description: `Talk only about ${voiceCallTitle.length > 0 ? voiceCallTitle : 'this chat'}`,
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
  const actions = document.hostActions ?? [];
  const hostRow = (action: (typeof actions)[number]): MenuRow => ({
    label: action.label,
    iconPath: HOST_ACTION_ICONS[action.id] ?? null,
    command: { type: 'host', action: action.id },
  });
  for (const action of actions)
    if (CHAT_GROUP_HOST_ACTIONS.has(action.id) && serves(action.id)) rows.push(hostRow(action));
  /**
   * CDXC:SessionChat 2026-10-29 DECISION:
   * User, on the terminal view's More actions menu matching the chat's (Q729, "Yes, add it"): the chat's More actions menu gets a Session note row after Close After Done, with the same "1" badge when a note exists, on the computer and the phone. The note toolbar button is never offered (the core's `composerActions.note` is off), so this row is the only way in unless the control folded here itself.
   * Here it opens the chat's own note panel, the one the terminal view's menu opens on the phone; the computer opens the same note dialog the terminal row opens (desktop `actions.rs`).
   */
  // The screen lists `sessionNote` among its actions only while the computer has Session notes on
  // (`sessions/sessionNotesSwitch.ts`; CDXC:SessionNotes 2026-10-30).
  const noteFolded = overflowed(document, 'note') && available('note');
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
    if (!overflowed(document, control.id) || !available(control.id)) continue;
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
  return rows;
}

/** A pill's menu (`show_option_menu`): the document's rows. */
export function optionMenuRows(document: ChatDocument, kind: 'model' | 'options' | 'mode'): MenuRow[] {
  return arr(obj(document.optionMenus)?.[kind])
    .map((row) => obj(row))
    .filter((row): row is MenuRow => row !== null);
}
