/**
 * The terminal screen's single header menu (⋯). It merges what used to be two
 * separate trailing buttons: the Agent Actions menu (the phone's copy of the
 * desktop terminal-overlay action strip and the shared chat view's "Agent
 * Actions" cluster — same ids and same order: rename, sleep, delayedActions,
 * fork, fullReload, promptEditor, exportTranscript) and the screen's overflow
 * menu (search conversation, attach, new terminal, settings, disconnect).
 *
 * The Agent Actions section is present only for a resolved gxserver session;
 * the screen section is always present, so shell tabs still get the menu. The
 * two Stash Prompt entries stay desktop-only because gxserver exposes no CLI
 * verb for them, and the phone reaches gxserver over SSH only.
 *
 * Presentation reuses the sessions-drawer ContextMenu so this menu looks and
 * behaves exactly like the session context menu one screen back.
 */

import ContextMenu, { type ContextMenuItem } from '../sessions/ContextMenu';
import {
  ClockGlyph,
  ExitGlyph,
  FileExportGlyph,
  GitForkGlyph,
  PencilGlyph,
  PlayGlyph,
  RefreshGlyph,
  SearchGlyph,
  SettingsGlyph,
  SleepGlyph,
  TerminalGlyph,
} from '../sessions/icons';
import { PaperclipIcon, PencilIcon } from './icons';
import { GhostexPalette } from '../../theme/palette';

export type TerminalMenuActionId =
  | 'rename'
  | 'sleep'
  | 'delayedActions'
  | 'fork'
  | 'fullReload'
  | 'promptEditor'
  | 'exportTranscript'
  | 'searchConversation'
  | 'attachPath'
  | 'newTerminal'
  | 'settings'
  | 'disconnect';

export type TerminalMenuProps = {
  visible: boolean;
  /** Session (or tab) the actions apply to — shown as the menu's header title. */
  sessionTitle: string;
  /** Agent Actions only exist for a resolved gxserver session. */
  agentActionsEnabled: boolean;
  /** Flips the lifecycle row between Sleep and Wake. */
  sleeping: boolean;
  /** gxserver can only fork agents that keep a resumable session file. */
  forkEnabled: boolean;
  /** gxserver can only export transcripts of the agents it can decode. */
  exportTranscriptEnabled: boolean;
  /** Searching the transcript only means anything while chat mode is showing. */
  searchConversationEnabled: boolean;
  /** Attach needs an open terminal (or, in chat mode, a chat-capable session). */
  attachEnabled: boolean;
  /** Disconnect needs a tab to close. */
  disconnectEnabled: boolean;
  onSelect: (id: TerminalMenuActionId) => void;
  onClose: () => void;
};

const ICON_SIZE = 14;

export default function TerminalMenu({
  visible,
  sessionTitle,
  agentActionsEnabled,
  sleeping,
  forkEnabled,
  exportTranscriptEnabled,
  searchConversationEnabled,
  attachEnabled,
  disconnectEnabled,
  onSelect,
  onClose,
}: TerminalMenuProps) {
  const iconColor = GhostexPalette.FOREGROUND;
  const items: ContextMenuItem[] = [];

  if (agentActionsEnabled) {
    items.push(
      { kind: 'label', key: 'agent-actions', label: 'Agent Actions' },
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
    );
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
    );
    if (exportTranscriptEnabled) {
      items.push({
        kind: 'item',
        key: 'exportTranscript',
        label: 'Export Transcript',
        icon: <FileExportGlyph size={ICON_SIZE} color={iconColor} />,
        onPress: () => onSelect('exportTranscript'),
      });
    }
    items.push({ kind: 'separator', key: 'agent-separator' });
  }

  items.push({ kind: 'label', key: 'session-label', label: 'Session' });
  // The chat page has no search button of its own; this row is its entry point.
  if (searchConversationEnabled) {
    items.push({
      kind: 'item',
      key: 'searchConversation',
      label: 'Search Conversation',
      icon: <SearchGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('searchConversation'),
    });
  }
  items.push(
    {
      kind: 'item',
      key: 'attachPath',
      label: 'Send & Attach File',
      icon: <PaperclipIcon size={ICON_SIZE} color={iconColor} />,
      disabled: !attachEnabled,
      onPress: () => onSelect('attachPath'),
    },
    {
      kind: 'item',
      key: 'newTerminal',
      label: 'New Terminal',
      icon: <TerminalGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('newTerminal'),
    },
    {
      kind: 'item',
      key: 'settings',
      label: 'Settings',
      icon: <SettingsGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('settings'),
    },
    {
      kind: 'item',
      key: 'disconnect',
      label: 'Disconnect',
      icon: <ExitGlyph size={ICON_SIZE} color={GhostexPalette.DANGER} />,
      destructive: true,
      disabled: !disconnectEnabled,
      onPress: () => onSelect('disconnect'),
    },
  );

  return <ContextMenu visible={visible} title={sessionTitle} items={items} onClose={onClose} />;
}
