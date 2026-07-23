/**
 * Toggle pages for the key bar's KEYS/AGENT pills (the slots that held plain
 * PGUP/PGDN). KEYS opens a fixed page of extra keys and terminal hotkeys with
 * the real PgUp/PgDn in the rightmost column (mirroring where the base-bar
 * pills sit); AGENT opens agent-specific hotkeys for the session's active
 * agent. Labels are at most 5 characters; every item carries a description the
 * key bar shows while the pill is held. Bindings per agent live only in this
 * file — extend AGENT_PAGES to cover more agents or correct a binding.
 */

import type { KeyModifiers, TerminalKey } from '../../../modules/ghostex-native/src';
import type { ResolvedExtraKey } from '../../settings/extraKeys';

/** Page item: a renderable key-bar item plus its hold-to-see description. */
export type KeyPageItem = ResolvedExtraKey & { description: string };

function pressKey(
  id: string,
  label: string,
  key: TerminalKey,
  description: string,
  mods?: KeyModifiers,
): KeyPageItem {
  return { id, kind: 'key', label, key, mods, description };
}

/** Ctrl+<letter> pill labelled with caret notation ("^C"). */
function ctrlKey(letter: string, description: string): KeyPageItem {
  return pressKey(`page-ctrl-${letter}`, `^${letter.toUpperCase()}`, letter, description, {
    ctrl: true,
  });
}

/** Types a slash command into the agent composer and submits it. */
function slashCommand(label: string, command: string, description: string): KeyPageItem {
  return {
    id: `page-cmd-${command}`,
    kind: 'text',
    label,
    text: command,
    sendEnter: true,
    description: `${command} · ${description}`,
  };
}

/** KEYS page: terminal control hotkeys + nav keys, PgUp/PgDn rightmost. */
export const EXTRA_KEYS_PAGE: KeyPageItem[][] = [
  [
    pressKey('page-ins', 'INS', 'insert', 'Insert key'),
    pressKey('page-del', 'DEL', 'delete', 'Delete key'),
    ctrlKey('c', 'Ctrl+C · Interrupt the running program'),
    ctrlKey('d', 'Ctrl+D · End of input / exit the shell'),
    ctrlKey('z', 'Ctrl+Z · Suspend the foreground program'),
    ctrlKey('l', 'Ctrl+L · Clear / redraw the screen'),
    pressKey('page-pgup', 'PGUP', 'pageUp', 'Page Up key'),
  ],
  [
    ctrlKey('r', 'Ctrl+R · Search shell history'),
    ctrlKey('u', 'Ctrl+U · Clear the input line'),
    ctrlKey('w', 'Ctrl+W · Delete the previous word'),
    ctrlKey('a', 'Ctrl+A · Jump to line start'),
    ctrlKey('e', 'Ctrl+E · Jump to line end'),
    ctrlKey('k', 'Ctrl+K · Delete to end of line'),
    pressKey('page-pgdn', 'PGDN', 'pageDown', 'Page Down key'),
  ],
];

/**
 * AGENT page per resolved agent icon id (contract/mobileSummary
 * resolveAgentIconId). Agents without an entry keep the plain PgDn key.
 */
const AGENT_PAGES: Record<string, KeyPageItem[][]> = {
  codex: [
    [
      pressKey('page-codex-raw', 'RAW', 'r', 'Alt+R · Toggle raw mode for copying', { alt: true }),
      pressKey('page-codex-trns', 'TRNS', 't', 'Ctrl+T · Show the session transcript', {
        ctrl: true,
      }),
      ctrlKey('c', 'Ctrl+C · Interrupt Codex'),
      slashCommand('MODEL', '/model', 'Switch model or reasoning effort'),
      slashCommand('APPRV', '/approvals', 'Change the approval mode'),
      slashCommand('NEW', '/new', 'Start a new chat'),
      slashCommand('UNDO', '/undo', 'Undo the last turn of edits'),
    ],
    [
      slashCommand('CMPCT', '/compact', 'Summarize to free up context'),
      slashCommand('DIFF', '/diff', 'Show the git diff of changes'),
      slashCommand('REVW', '/review', 'Review the current changes'),
      slashCommand('STAT', '/status', 'Session status and usage'),
      slashCommand('MENT', '/mention', 'Mention a file in the prompt'),
      slashCommand('INIT', '/init', 'Create an AGENTS.md for the repo'),
      slashCommand('QUIT', '/quit', 'Exit Codex'),
    ],
  ],
  claude: [
    [
      pressKey('page-claude-mode', 'MODE', 'tab', 'Shift+Tab · Cycle permission modes', {
        shift: true,
      }),
      pressKey('page-claude-bg', 'BG', 'b', 'Ctrl+B · Background the running task', {
        ctrl: true,
      }),
      ctrlKey('c', 'Ctrl+C · Interrupt Claude'),
      slashCommand('MODEL', '/model', 'Switch model'),
      slashCommand('CLEAR', '/clear', 'Clear the conversation'),
      slashCommand('RESUM', '/resume', 'Resume a past session'),
      slashCommand('STAT', '/status', 'Show session status'),
    ],
    [
      slashCommand('CMPCT', '/compact', 'Compact the conversation context'),
      slashCommand('MEM', '/memory', 'Edit memory files'),
      slashCommand('COST', '/cost', 'Token usage and cost'),
      slashCommand('REVW', '/review', 'Review the current changes'),
      slashCommand('CFG', '/config', 'Open the settings panel'),
      slashCommand('INIT', '/init', 'Create a CLAUDE.md for the repo'),
      slashCommand('HELP', '/help', 'List commands and shortcuts'),
    ],
  ],
  opencode: [
    [
      pressKey('page-opencode-plan', 'PLAN', 'tab', 'Tab · Toggle Build / Plan mode'),
      ctrlKey('c', 'Ctrl+C · Interrupt opencode'),
      slashCommand('MODEL', '/models', 'Switch model'),
      slashCommand('NEW', '/new', 'Start a new session'),
      slashCommand('UNDO', '/undo', 'Undo the last message'),
      slashCommand('REDO', '/redo', 'Redo an undone message'),
      slashCommand('EDIT', '/editor', 'Compose in the external editor'),
    ],
    [
      slashCommand('CMPCT', '/compact', 'Compact the session context'),
      slashCommand('SHARE', '/share', 'Share the session'),
      slashCommand('SESS', '/sessions', 'List and switch sessions'),
      slashCommand('INIT', '/init', 'Create an AGENTS.md for the repo'),
      slashCommand('THEME', '/themes', 'Switch the color theme'),
      slashCommand('EXIT', '/exit', 'Exit opencode'),
      slashCommand('HELP', '/help', 'List commands and shortcuts'),
    ],
  ],
  pi: [
    [
      ctrlKey('c', 'Ctrl+C · Interrupt pi'),
      ctrlKey('d', 'Ctrl+D · Exit pi'),
      ctrlKey('l', 'Ctrl+L · Clear / redraw the screen'),
      ctrlKey('z', 'Ctrl+Z · Suspend pi'),
    ],
    [
      slashCommand('MODEL', '/model', 'Switch model'),
      slashCommand('CLEAR', '/clear', 'Clear the session'),
      slashCommand('CMPCT', '/compact', 'Compact the session context'),
      slashCommand('HELP', '/help', 'List commands and shortcuts'),
    ],
  ],
};

/** Agent hotkey rows for the resolved agent id, or null (no AGENT page). */
export function agentKeyPage(agentId: string): KeyPageItem[][] | null {
  return AGENT_PAGES[agentId] ?? null;
}
