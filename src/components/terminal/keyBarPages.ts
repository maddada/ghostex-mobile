/**
 * Toggle pages for the key bar's PGUP/PGDN pills. PGUP opens a fixed
 * 12-key page of extra keys and terminal hotkeys (real PgUp/PgDn live here);
 * PGDN opens agent-specific hotkeys for the session's active agent. Every
 * label is at most 5 characters. Items reuse the ResolvedExtraKey shapes the
 * key bar already renders, so key pages get repeat-on-hold and text actions
 * for free. Bindings per agent live only in this file — extend AGENT_PAGES to
 * cover more agents or correct a binding.
 */

import type { KeyModifiers, TerminalKey } from '../../../modules/ghostex-native/src';
import type { ResolvedExtraKey } from '../../settings/extraKeys';

function pressKey(
  id: string,
  label: string,
  key: TerminalKey,
  options?: { mods?: KeyModifiers; repeatable?: boolean },
): ResolvedExtraKey {
  return { id, kind: 'key', label, key, mods: options?.mods, repeatable: options?.repeatable };
}

/** Ctrl+<letter> pill labelled with caret notation ("^C"). */
function ctrlKey(letter: string): ResolvedExtraKey {
  return pressKey(`page-ctrl-${letter}`, `^${letter.toUpperCase()}`, letter, {
    mods: { ctrl: true },
  });
}

/** Types a slash command into the agent composer and submits it. */
function slashCommand(label: string, command: string): ResolvedExtraKey {
  return { id: `page-cmd-${command}`, kind: 'text', label, text: command, sendEnter: true };
}

/** PGUP page: navigation cluster + common terminal control hotkeys (12). */
export const EXTRA_KEYS_PAGE: ResolvedExtraKey[][] = [
  [
    pressKey('page-pgup', 'PGUP', 'pageUp', { repeatable: true }),
    pressKey('page-pgdn', 'PGDN', 'pageDown', { repeatable: true }),
    pressKey('page-ins', 'INS', 'insert'),
    pressKey('page-del', 'DEL', 'delete', { repeatable: true }),
    ctrlKey('c'),
    ctrlKey('d'),
  ],
  [ctrlKey('z'), ctrlKey('l'), ctrlKey('r'), ctrlKey('u'), ctrlKey('w'), ctrlKey('a')],
];

/**
 * PGDN page per resolved agent icon id (contract/mobileSummary
 * resolveAgentIconId). Agents without an entry keep the plain PgDn key.
 */
const AGENT_PAGES: Record<string, ResolvedExtraKey[][]> = {
  codex: [
    [
      // Alt+R toggles Codex raw mode (plain text for copying).
      pressKey('page-codex-raw', 'RAW', 'r', { mods: { alt: true } }),
      // Ctrl+T opens the full transcript view.
      pressKey('page-codex-trns', 'TRNS', 't', { mods: { ctrl: true } }),
      ctrlKey('c'),
      slashCommand('MODEL', '/model'),
      slashCommand('APPRV', '/approvals'),
      slashCommand('NEW', '/new'),
    ],
    [
      slashCommand('CMPCT', '/compact'),
      slashCommand('DIFF', '/diff'),
      slashCommand('REVW', '/review'),
      slashCommand('STAT', '/status'),
      slashCommand('INIT', '/init'),
      slashCommand('QUIT', '/quit'),
    ],
  ],
  claude: [
    [
      // Shift+Tab cycles the permission mode (normal/auto-accept/plan).
      pressKey('page-claude-mode', 'MODE', 'tab', { mods: { shift: true } }),
      // Ctrl+B backgrounds the running bash task.
      pressKey('page-claude-bg', 'BG', 'b', { mods: { ctrl: true } }),
      ctrlKey('c'),
      slashCommand('MODEL', '/model'),
      slashCommand('CLEAR', '/clear'),
      slashCommand('RESUM', '/resume'),
    ],
    [
      slashCommand('CMPCT', '/compact'),
      slashCommand('MEM', '/memory'),
      slashCommand('COST', '/cost'),
      slashCommand('REVW', '/review'),
      slashCommand('CFG', '/config'),
      slashCommand('HELP', '/help'),
    ],
  ],
  opencode: [
    [
      // Tab toggles the composer between Build and Plan mode.
      pressKey('page-opencode-plan', 'PLAN', 'tab'),
      ctrlKey('c'),
      slashCommand('MODEL', '/models'),
      slashCommand('NEW', '/new'),
      slashCommand('UNDO', '/undo'),
      slashCommand('REDO', '/redo'),
    ],
    [
      slashCommand('CMPCT', '/compact'),
      slashCommand('SHARE', '/share'),
      slashCommand('SESS', '/sessions'),
      slashCommand('INIT', '/init'),
      slashCommand('THEME', '/themes'),
      slashCommand('HELP', '/help'),
    ],
  ],
  pi: [
    [
      ctrlKey('c'),
      ctrlKey('d'),
      slashCommand('MODEL', '/model'),
      slashCommand('CLEAR', '/clear'),
      slashCommand('CMPCT', '/compact'),
      slashCommand('HELP', '/help'),
    ],
  ],
};

/** Agent hotkey rows for the resolved agent id, or null (no PGDN page). */
export function agentKeyPage(agentId: string): ResolvedExtraKey[][] | null {
  return AGENT_PAGES[agentId] ?? null;
}
