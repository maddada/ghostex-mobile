/**
 * The terminal screen's single header menu (⋯): the `phoneTerminal` spot of the one session menu
 * (packages/gx-core/src/sidebar_menu/layout.rs, read from the chat core by session-menu/layout.ts), filled with this
 * screen's own rows (Rename, Search Conversation, Prompt Editor, Sleep, Fork, the project's Files, Changes and Beads,
 * Send & Attach File, New Terminal, Settings, Disconnect, Kill Session…) and with the rows it shares with the
 * long-press session menu (Coordinator, Mark Thread Done, Copy, Tag As, Link to, Postpone By, Close…), which
 * screens/sessions-screen/sidebar-menus.ts builds for the session on screen.
 *
 * The session's rows are present only for a resolved gxserver session; the screen's rows always are, so shell tabs
 * still get the menu.
 *
 * Presentation reuses the sessions-drawer ContextMenu (through `sidebarMenuView`, which opens submenus as pages) so
 * this menu looks and behaves exactly like the session context menu one screen back.
 *
 * CDXC:ContextMenus 2026-11-20 SEE-ALSO: packages/gx-core/src/sidebar_menu/layout.rs (the user's decision, Q4292: one
 * session menu everywhere; the "Agent Actions" and "Session" headings went with it).
 */

import { useEffect, useState } from 'react';

import type { GhostexSession } from '../../contract/mobileSummary';
import { useInventoryStore } from '../../inventory/store';
import {
  assembleSessionMenu,
  entryDanger,
  entryIcon,
  entryLabel,
  useSessionMenuLayout,
  type SessionMenuLayout,
} from '../../session-menu/layout';
import { sidebarMenuView } from '../../screens/sessions-screen/sidebar-menu-view';
import {
  SIDEBAR_MENU_MAKE,
  sessionMenuInputFromSummary,
  sessionMenuPlaces,
  type SidebarMenuCommand,
  type SidebarMenuItem,
} from '../../screens/sessions-screen/sidebar-menus';
import { delayedSendOnIn } from '../../sessions/delayedActionsSwitch';
import { useAppearance } from '../../theme/useAppearance';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '../sessions/ContextMenu';

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
  | 'changes'
  | 'beads'
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
  /** The session's own rows only exist for a resolved gxserver session. */
  agentActionsEnabled: boolean;
  /** The resolved session and its computer, whose rows the long-press menu shares (Coordinator, Copy, Tag As…). */
  session: GhostexSession | null;
  machineId: string | null;
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
  /** Docs and Changes need the session's project (its id and folder on the computer). */
  docsEnabled: boolean;
  /** Beads needs the session's project and the computer's Beads extension on (`beads/featureSwitch.ts`). */
  beadsEnabled: boolean;
  /** Attach needs an open terminal (or, in chat mode, a chat-capable session). */
  attachEnabled: boolean;
  /** Disconnect needs a tab to close. */
  disconnectEnabled: boolean;
  /** Kill Session needs a resolved gxserver session identity. */
  killSessionEnabled: boolean;
  /** Skills lists the agent's Ghostex skills and types one into its terminal input. */
  skillsEnabled: boolean;
  onSelect: (id: TerminalMenuActionId) => void;
  /**
   * A row shared with the long-press menu, with the computer and session it was built for
   * (screens/terminal-screen/use-session-menu-runner.tsx).
   */
  onSessionCommand: (command: SidebarMenuCommand, target: { machineId: string; sessionId: string }) => void;
  /** Items shown before the menu's own, each with its own action (the iPhone Duo rail's overflow). */
  leadingItems?: readonly ContextMenuItem[];
  onClose: () => void;
  /**
   * Fires once the menu's dismissal has fully completed (iOS only). Actions
   * that present something natively — the document picker behind Send & Attach
   * File — have to run from here, never from `onSelect`.
   */
  onDismissed?: () => void;
  /** The button it opened from, so on the iPhone Duo it stands there (ContextMenu's `anchor`). */
  anchor?: MenuAnchor;
};

/** The places this menu fills itself (the layout's ids) and the screen action each runs. */
const OWN_ACTIONS: Readonly<Record<string, TerminalMenuActionId>> = {
  rename: 'rename',
  searchConversation: 'searchConversation',
  promptEditor: 'promptEditor',
  sleep: 'sleep',
  fork: 'fork',
  fullReload: 'fullReload',
  delayedSend: 'delayedActions',
  note: 'sessionNote',
  export: 'exportTranscript',
  files: 'docs',
  changes: 'changes',
  beads: 'beads',
  skills: 'skills',
  attachFile: 'attachPath',
  newTerminal: 'newTerminal',
  terminalSettings: 'settings',
  disconnect: 'disconnect',
  killSession: 'killSession',
};

/** The places shared with the long-press menu, filled for the session (`sessionMenuPlaces`). */
const SHARED_PLACES = new Set([
  'coordinator',
  'markThreadDone',
  'copy',
  'tagAs',
  'closeAfterDone',
  'linkTo',
  'makeCoordinator',
  'postponeBy',
  'close',
]);

function terminalMenu(props: TerminalMenuProps, layout: SessionMenuLayout): SidebarMenuItem[] {
  const {
    agentActionsEnabled,
    session,
    machineId,
    sleeping,
    forkEnabled,
    exportTranscriptEnabled,
    sessionNoteEnabled,
    searchConversationEnabled,
    docsEnabled,
    beadsEnabled,
    attachEnabled,
    disconnectEnabled,
    killSessionEnabled,
    skillsEnabled,
    leadingItems = [],
  } = props;
  const summary = machineId === null ? null : useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary;
  const shared =
    agentActionsEnabled && session !== null && machineId !== null
      ? sessionMenuPlaces(sessionMenuInputFromSummary(summary, session), layout)
      : null;
  const own = (id: string, options: { alt?: boolean; disabled?: boolean } = {}): SidebarMenuItem[] => {
    const action = OWN_ACTIONS[id];
    if (action === undefined) return [];
    const alt = options.alt === true;
    return [
      {
        label: entryLabel(layout, id, alt),
        icon: entryIcon(layout, id, alt),
        command: { type: 'host', action },
        checked: false,
        disabled: options.disabled === true,
        ...(entryDanger(layout, id) ? { danger: true as const } : {}),
      },
    ];
  };
  const fill = (id: string): SidebarMenuItem[] => {
    if (SHARED_PLACES.has(id)) return shared === null ? [] : shared(id);
    switch (id) {
      case 'terminalLeading':
        return leadingItems.length > 0 ? [{ hostSlot: 'terminalLeading', checked: false, disabled: false }] : [];
      case 'delayedSend':
        // Delayed Send off on the computer (CDXC:DelayedSend 2026-11-28 in sessions/delayedActionsSwitch.ts).
        return agentActionsEnabled && delayedSendOnIn(summary) ? own(id) : [];
      case 'rename':
      case 'promptEditor':
      case 'fullReload':
        return agentActionsEnabled ? own(id) : [];
      case 'sleep':
        // A Native chat has no Sleep (CDXC:SessionSleep 2026-11-27 in screens/sessions-screen/sidebar-menus.ts `canSleep`).
        return agentActionsEnabled && session?.nonCliMode !== true ? own(id, { alt: sleeping }) : [];
      case 'fork':
        return agentActionsEnabled && forkEnabled ? own(id) : [];
      case 'export':
        return agentActionsEnabled && exportTranscriptEnabled ? own(id) : [];
      case 'note':
        return agentActionsEnabled && sessionNoteEnabled ? own(id) : [];
      case 'skills':
        // The terminal's own input; chat mode has the composer's More actions > Skills.
        return skillsEnabled ? own(id) : [];
      case 'searchConversation':
        // The chat screen has no search button of its own; this row is its entry point.
        return searchConversationEnabled ? own(id) : [];
      case 'files':
      case 'changes':
        return docsEnabled ? own(id) : [];
      case 'beads':
        // CDXC:ProjectBoard 2026-11-13 SEE-ALSO: the user's decision in src/screens/BeadsScreen.tsx (a row beside Changes), shown only while the computer's Beads extension is on (src/beads/featureSwitch.ts).
        return docsEnabled && beadsEnabled ? own(id) : [];
      case 'attachFile':
        return own(id, { disabled: !attachEnabled });
      case 'newTerminal':
      case 'terminalSettings':
        return own(id);
      case 'disconnect':
        return own(id, { disabled: !disconnectEnabled });
      case 'killSession':
        return killSessionEnabled ? own(id) : [];
      default:
        return [];
    }
  };
  return assembleSessionMenu(layout, 'phoneTerminal', fill, SIDEBAR_MENU_MAKE);
}

export default function TerminalMenu(props: TerminalMenuProps) {
  const { visible, sessionTitle, onSelect, onSessionCommand, leadingItems = [], onClose, onDismissed, anchor } = props;
  const appearance = useAppearance();
  const layout = useSessionMenuLayout();
  // The submenus opened so far (Coordinator, Copy, More…), each a page of the same card.
  const [menuPath, setMenuPath] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!visible) setMenuPath([]);
  }, [visible]);

  const view = sidebarMenuView(
    terminalMenu(props, layout),
    menuPath,
    {
      openPath: setMenuPath,
      run: (command) => {
        if (command.type === 'host') onSelect(command.action as TerminalMenuActionId);
        else if (props.session !== null && props.machineId !== null) {
          onSessionCommand(command, { machineId: props.machineId, sessionId: props.session.sessionId });
        }
      },
    },
    appearance.foreground,
    { terminalLeading: leadingItems },
  );

  return (
    <ContextMenu
      visible={visible}
      title={sessionTitle}
      {...(view.openedLabel !== null ? { subtitle: view.openedLabel } : {})}
      items={view.items}
      onClose={onClose}
      onDismissed={onDismissed}
      anchor={anchor}
    />
  );
}
