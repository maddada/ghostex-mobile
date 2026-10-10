/**
 * The terminal ⋯ menu's Skills list: the Ghostex skills the session's agent has installed, each
 * typing its invocation into the agent's input (never Enter), then Configure / Install more. The
 * desktop terminal shows the same list as a flyout (`terminal_agent_action_bar/skills_flyout.rs`);
 * the phone's menu has no flyouts, so the list is a menu of its own.
 */

import ContextMenu, { type ContextMenuItem } from '../sessions/ContextMenu';
import { SettingsGlyph } from '../sessions/icons';
import type { TerminalSkillRow } from '../../screens/terminal-screen/session-lookups';
import { GhostexPalette } from '../../theme/palette';

export type TerminalSkillsMenuProps = {
  sessionTitle: string;
  /** Null while gxserver's skill read runs. */
  rows: TerminalSkillRow[] | null;
  error: string | null;
  onPick: (row: TerminalSkillRow) => void;
  onConfigure: () => void;
  onClose: () => void;
};

export default function TerminalSkillsMenu({ sessionTitle, rows, error, onPick, onConfigure, onClose }: TerminalSkillsMenuProps) {
  const status = (key: string, label: string): ContextMenuItem => ({ kind: 'item', key, label, disabled: true, onPress: () => undefined });
  const items: ContextMenuItem[] = [];
  if (error !== null) items.push(status('error', error));
  else if (rows === null) items.push(status('loading', 'Loading skills…'));
  else if (rows.length === 0) items.push(status('empty', 'No Ghostex skills installed'));
  else for (const row of rows) items.push({ kind: 'item', key: row.name, label: row.name, onPress: () => onPick(row) });
  items.push(
    { kind: 'separator', key: 'configure-separator' },
    {
      kind: 'item',
      key: 'configure',
      label: 'Configure / Install more',
      icon: <SettingsGlyph size={14} color={GhostexPalette.FOREGROUND} />,
      onPress: onConfigure,
    },
  );
  return <ContextMenu visible title={sessionTitle} subtitle="Skills" items={items} onClose={onClose} />;
}
