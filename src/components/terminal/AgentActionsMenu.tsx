/**
 * Agent Actions menu for the terminal screen header — the phone's copy of the
 * desktop terminal-overlay action strip and the shared chat view's "Agent
 * Actions" cluster. Same ids and same order as those surfaces
 * (rename, sleep, delayedActions, fork, fullReload, promptEditor, attachPath);
 * the two Stash Prompt entries are desktop-only because gxserver exposes no
 * CLI verb for them, and the phone reaches gxserver over SSH only.
 *
 * Presentation reuses the sessions-drawer ContextMenu so this menu looks and
 * behaves exactly like the session context menu one screen back.
 */

import ContextMenu, { type ContextMenuItem } from '../sessions/ContextMenu';
import {
  ClockGlyph,
  GitForkGlyph,
  PencilGlyph,
  PlayGlyph,
  RefreshGlyph,
  SleepGlyph,
} from '../sessions/icons';
import { PaperclipIcon, PencilIcon } from './icons';
import { GhostexPalette } from '../../theme/palette';

export type AgentActionId =
  | 'rename'
  | 'sleep'
  | 'delayedActions'
  | 'fork'
  | 'fullReload'
  | 'promptEditor'
  | 'attachPath';

export type AgentActionsMenuProps = {
  visible: boolean;
  /** Session the actions apply to — shown as the menu's header title. */
  sessionTitle: string;
  /** Flips the lifecycle row between Sleep and Wake. */
  sleeping: boolean;
  /** gxserver can only fork agents that keep a resumable session file. */
  forkEnabled: boolean;
  onSelect: (id: AgentActionId) => void;
  onClose: () => void;
};

const ICON_SIZE = 14;

export default function AgentActionsMenu({
  visible,
  sessionTitle,
  sleeping,
  forkEnabled,
  onSelect,
  onClose,
}: AgentActionsMenuProps) {
  const iconColor = GhostexPalette.FOREGROUND;
  const items: ContextMenuItem[] = [
    {
      kind: 'item',
      key: 'rename',
      label: 'Rename',
      icon: <PencilGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('rename'),
    },
    {
      kind: 'item',
      key: 'sleep',
      label: sleeping ? 'Wake' : 'Sleep',
      icon: sleeping ? (
        <PlayGlyph size={ICON_SIZE} color={iconColor} />
      ) : (
        <SleepGlyph size={ICON_SIZE} color={iconColor} />
      ),
      onPress: () => onSelect('sleep'),
    },
    {
      kind: 'item',
      key: 'delayedActions',
      label: 'Delayed Actions',
      icon: <ClockGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('delayedActions'),
    },
  ];
  if (forkEnabled) {
    items.push({
      kind: 'item',
      key: 'fork',
      label: 'Fork',
      icon: <GitForkGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('fork'),
    });
  }
  items.push(
    {
      kind: 'item',
      key: 'fullReload',
      label: 'Full Reload',
      icon: <RefreshGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('fullReload'),
    },
    {
      kind: 'item',
      key: 'promptEditor',
      label: 'Prompt Editor',
      icon: <PencilIcon size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('promptEditor'),
    },
    {
      kind: 'item',
      key: 'attachPath',
      label: 'Attach File or Folder',
      icon: <PaperclipIcon size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('attachPath'),
    },
  );

  return (
    <ContextMenu
      visible={visible}
      title={sessionTitle}
      subtitle="Agent Actions"
      items={items}
      onClose={onClose}
    />
  );
}
