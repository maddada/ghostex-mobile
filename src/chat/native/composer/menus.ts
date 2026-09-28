/**
 * The rows of the composer's menus, built from the document the way desktop builds them
 * (`actions.rs`, `show_actions`; `option_menu/window.rs`, `show_option_menu`). Rows that need the
 * app shell (`{type: 'host', ...}`) appear only for the actions the screen performs.
 */

import type { ChatDocument } from '../../rust/document';
import { arr, isTrue, obj, str } from './json';
import type { MenuRow } from './MenuSheet';

/** The toolbar controls in desktop's order, which is also the order they fold into More actions
 * (`toolbar.rs`, `COMPOSER_CONTROLS`). Maximize is desktop-only. */
export const COMPOSER_CONTROLS = [
  { id: 'summary', action: 'summaryMode', label: 'Summary mode', icon: 'titlebar/list-details.svg' },
  { id: 'note', action: 'sessionNote', label: 'Session note', icon: 'titlebar/note.svg' },
  { id: 'stash', action: 'stashPrompt', label: 'Stash prompt', icon: 'titlebar/stack-push.svg' },
  { id: 'attach', action: 'attachPath', label: 'Attach a file or folder', icon: 'titlebar/paperclip.svg' },
  { id: 'terminal', action: 'terminalView', label: 'Terminal View', icon: 'titlebar/terminal-2.svg' },
] as const;

export type ComposerControlId = (typeof COMPOSER_CONTROLS)[number]['id'];

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
  /** Controls this composer can draw (the host gates plus what the phone serves). */
  available: (id: ComposerControlId) => boolean;
  /** Whether the screen performs this app-shell action (`NativeComposer`'s `hostActions`). */
  serves: (action: string) => boolean;
  /**
   * Compact & Send, while there is a draft. Desktop offers it in Send's own right-click menu
   * (`show_send_actions` in `actions.rs`) and on Option+Enter; a phone has neither, and Send's hold
   * already queues, so it leads this menu instead.
   */
  compactAndSend?: { disabled: boolean } | null;
  /** The chat box's text, which Side chat toggles its `/btw ` prefix on. */
  draft?: string;
};

/**
 * The View row: the chat's display modes as one submenu, its detail naming the ones that are on
 * (desktop's `view_modes_row` in `actions.rs`, where the user decision is recorded). The phone has
 * no Simple mode, so it lists Verbose and Summary.
 */
function viewModesRow(document: ChatDocument, verbose: boolean, summaryAvailable: boolean): MenuRow {
  const summary = summaryAvailable && document.summaryMode === true;
  const modes: MenuRow[] = [
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
  const on = [verbose ? 'Verbose' : null, summary ? 'Summary' : null].filter((name) => name !== null);
  return { label: 'View', iconPath: 'titlebar/eye.svg', detail: on.length > 0 ? on.join(', ') : 'Standard', children: modes };
}

export function moreActionsRows({ document, verbose, available, serves, compactAndSend = null, draft = '' }: MoreActionsInput): MenuRow[] {
  const rows: MenuRow[] = [];
  if (compactAndSend !== null) {
    rows.push({ label: 'Compact & Send', iconPath: 'titlebar/arrow-up.svg', disabled: compactAndSend.disabled, command: { type: 'submit', mode: 'compact' } });
    rows.push({ separator: true });
  }
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
  rows.push(viewModesRow(document, verbose, available('summary')));
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
  for (const action of actions) if (CHAT_GROUP_HOST_ACTIONS.has(action.id) && serves(action.id)) rows.push(hostRow(action));
  for (const control of COMPOSER_CONTROLS) {
    if (control.id === 'summary' || !overflowed(document, control.id) || !available(control.id)) continue;
    const row: MenuRow = { label: control.label, iconPath: control.icon, command: { type: 'composerHost', action: control.action } };
    if (control.id === 'note') row.checked = document.note.open;
    rows.push(row);
  }
  const agentRows: MenuRow[] = [];
  for (const action of actions) {
    if (action.group !== 'agent') continue;
    if (action.id === 'switchAccount') {
      // Desktop's rule (actions.rs, a user decision there): Claude and Codex sessions open the
      // Accounts & limits panel; other agents keep the daemon's switchable-agent rows.
      if (obj(document.accountPanel) !== null) {
        agentRows.push({ label: 'Switch Account', iconPath: HOST_ACTION_ICONS.switchAccount, children: [{ accounts: document.accountPanel }] });
        continue;
      }
      if (!serves('switchAccount')) continue;
      const accounts = arr(document.switchableAgents).map((account) => ({
        label: str(account, 'name'),
        icon: str(account, 'icon'),
        command: { type: 'host', action: 'switchAccount', agentId: obj(account)?.agentId ?? null },
      }));
      if (accounts.length > 0) agentRows.push({ label: 'Switch Account', iconPath: HOST_ACTION_ICONS.switchAccount, children: accounts });
    } else if (serves(action.id)) {
      agentRows.push(hostRow(action));
    }
  }
  if (agentRows.length > 0) {
    rows.push({ separator: true }, { heading: true, label: 'Agent' }, ...agentRows);
  }
  const other = actions.filter((action) => action.group !== 'agent' && !CHAT_GROUP_HOST_ACTIONS.has(action.id) && serves(action.id));
  if (other.length > 0) rows.push({ separator: true }, ...other.map(hostRow));
  return rows;
}

/** A pill's menu (`show_option_menu`): the document's rows. */
export function optionMenuRows(document: ChatDocument, kind: 'model' | 'options' | 'mode'): MenuRow[] {
  return arr(obj(document.optionMenus)?.[kind])
    .map((row) => obj(row))
    .filter((row): row is MenuRow => row !== null);
}
