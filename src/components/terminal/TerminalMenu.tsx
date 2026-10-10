/**
 * The terminal screen's single header menu (⋯). It merges what used to be two
 * separate trailing buttons: the Agent Actions menu (the phone's copy of the
 * desktop terminal-overlay action strip and the shared chat view's "Agent
 * Actions" cluster — same ids and same order: rename, sleep, delayedActions,
 * fork, fullReload, promptEditor, Session Note, exportTranscript) and the screen's overflow menu (search conversation,
 * the project's Docs, attach, new terminal, settings, disconnect, kill session).
 *
 * The Agent Actions section is present only for a resolved gxserver session;
 * the screen section is always present, so shell tabs still get the menu.
 *
 * Presentation reuses the sessions-drawer ContextMenu so this menu looks and
 * behaves exactly like the session context menu one screen back.
 */

import ContextMenu, { type ContextMenuItem } from '../sessions/ContextMenu';
import {
  AxeGlyph,
  ClockGlyph,
  ExitGlyph,
  FileExportGlyph,
  GitForkGlyph,
  NoteGlyph,
  PencilGlyph,
  PlayGlyph,
  RefreshGlyph,
  SearchGlyph,
  SettingsGlyph,
  SleepGlyph,
  SparklesGlyph,
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
  | 'sessionNote'
  | 'exportTranscript'
  | 'searchConversation'
  | 'docs'
  | 'attachPath'
  | 'newTerminal'
  | 'settings'
  | 'disconnect'
  | 'killSession'
  | 'skills';

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
  /** Session Note needs a provider conversation and the chat view. */
  sessionNoteEnabled: boolean;
  /** Searching the transcript only means anything while chat mode is showing. */
  searchConversationEnabled: boolean;
  /** Docs needs the session's project (its id and folder on the computer). */
  docsEnabled: boolean;
  /** Attach needs an open terminal (or, in chat mode, a chat-capable session). */
  attachEnabled: boolean;
  /** Disconnect needs a tab to close. */
  disconnectEnabled: boolean;
  /** Kill Session needs a resolved gxserver session identity. */
  killSessionEnabled: boolean;
  /** Skills lists the agent's Ghostex skills and types one into its terminal input. */
  skillsEnabled: boolean;
  onSelect: (id: TerminalMenuActionId) => void;
  onClose: () => void;
  /**
   * Fires once the menu's dismissal has fully completed (iOS only). Actions
   * that present something natively — the document picker behind Send & Attach
   * File — have to run from here, never from `onSelect`.
   */
  onDismissed?: () => void;
};

const ICON_SIZE = 14;

export default function TerminalMenu({
  visible,
  sessionTitle,
  agentActionsEnabled,
  sleeping,
  forkEnabled,
  exportTranscriptEnabled,
  sessionNoteEnabled,
  searchConversationEnabled,
  docsEnabled,
  attachEnabled,
  disconnectEnabled,
  killSessionEnabled,
  skillsEnabled,
  onSelect,
  onClose,
  onDismissed,
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
    if (sessionNoteEnabled) {
      items.push({
        kind: 'item',
        key: 'sessionNote',
        label: 'Session Note',
        icon: <NoteGlyph size={ICON_SIZE} color={iconColor} />,
        onPress: () => onSelect('sessionNote'),
      });
    }
    // Just above Handoff / Export, as in the desktop terminal's ⋯ menu (gx-chat-core
    // `composer/ghostex_skills.rs`); its list opens as a menu of its own.
    if (skillsEnabled) {
      items.push({
        kind: 'item',
        key: 'skills',
        label: 'Skills',
        icon: <SparklesGlyph size={ICON_SIZE} color={iconColor} />,
        submenu: true,
        onPress: () => onSelect('skills'),
      });
    }
    if (exportTranscriptEnabled) {
      items.push({
        kind: 'item',
        key: 'exportTranscript',
        label: 'Handoff / Export',
        icon: <FileExportGlyph size={ICON_SIZE} color={iconColor} />,
        onPress: () => onSelect('exportTranscript'),
      });
    }
    items.push({ kind: 'separator', key: 'agent-separator' });
  }

  items.push({ kind: 'label', key: 'session-label', label: 'Session' });
  // The chat screen has no search button of its own; this row is its entry point.
  if (searchConversationEnabled) {
    items.push({
      kind: 'item',
      key: 'searchConversation',
      label: 'Search Conversation',
      icon: <SearchGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('searchConversation'),
    });
  }
  if (docsEnabled) {
    items.push({
      kind: 'item',
      key: 'docs',
      label: 'Docs',
      icon: <NoteGlyph size={ICON_SIZE} color={iconColor} />,
      onPress: () => onSelect('docs'),
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

  if (killSessionEnabled) {
    items.push({
      kind: 'item',
      key: 'killSession',
      label: 'Kill Session',
      icon: <AxeGlyph size={ICON_SIZE} color={GhostexPalette.DANGER} />,
      destructive: true,
      onPress: () => onSelect('killSession'),
    });
  }

  return (
    <ContextMenu
      visible={visible}
      title={sessionTitle}
      items={items}
      onClose={onClose}
      onDismissed={onDismissed}
    />
  );
}
