/**
 * SessionsScreen context-menu builders (desktop-parity session/project/
 * collection/group/section menus, agent + actions split-button menus, and the
 * recovery sheet items), moved verbatim from src/screens/SessionsScreen.tsx.
 * The three useCallback hooks inside (runCollectionsUpdate,
 * resolvePrimaryAgent, launchAgent) run in their original relative order.
 */

import { useCallback } from 'react';
import { Platform } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { GhostexNative } from '../../../modules/ghostex-native/src';

import { openTailscaleOrDownload } from '../../app/tailscale';
import type { ActionSheetItem } from '../../components/common/ActionSheet';
import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import { isSessionChatSupportedAgent } from '../../chat/session-chat-bridge';
import { type ContextMenuItem } from '../../components/sessions/ContextMenu';
import { type DrawerBlock } from '../../components/sessions/drawerModel';
import {
  ArrowGlyph,
  ChevronDownGlyph,
  ClockGlyph,
  CopyGlyph,
  ExitGlyph,
  EyeOffGlyph,
  GitForkGlyph,
  InfoGlyph,
  MachinesGlyph,
  MessageCircleGlyph,
  NoteGlyph,
  PaletteGlyph,
  PencilGlyph,
  PinGlyph,
  PlayGlyph,
  PlusGlyph,
  RefreshGlyph,
  SearchGlyph,
  SettingsGlyph,
  SleepGlyph,
  TagGlyph,
  TerminalGlyph,
  TrashGlyph,
  WorldGlyph,
  XGlyph,
} from '../../components/sessions/icons';
import { useLauncherStore, lastActionKey } from '../../components/sessions/launcherStore';
import {
  closeAfterDoneCommand,
  createAgentCommand,
  createChatCommand,
  forkSessionCommand,
  moveProjectCommand,
  pinSessionCommand,
  reloadSessionCommand,
  removeProjectCommand,
  sleepSessionCommand,
  tagSessionCommand,
  updateProjectCollectionsCommand,
  wakeSessionCommand,
} from '../../commands/ghostexCli';
import {
  COLLECTION_COLOR_OPTIONS,
  collectionIdForProject,
  stateWithCollectionColor,
  stateWithNewCollection,
  stateWithoutCollection,
  stateWithoutProject,
  stateWithProjectInCollection,
} from '../../contract/collectionsState';
import type { ProjectHeaderItem } from '../../contract/grouping';
import { SESSION_TAG_SECTIONS, sessionTagIcon } from '../../contract/sessionTags';
import {
  agentIconTint,
  displayStatus,
  resolveAgentIconId,
  type GhostexAgentLauncher,
  type GhostexQuickAction,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { ProgressCopy, StripCopy, WebPreviewCopy } from '../../copy';
import type { OptimisticInventoryChange } from '../../inventory/optimistic';
import {
  FORK_AGENT_ICONS,
  lifecycleMutation,
  pinMutation,
  tagMutation,
} from '../../sessions/sessionCommands';
import { useInventoryStore } from '../../inventory/store';
import { useMachinesStore, type MachineRecord } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import { GhostexPalette, SidebarPalette } from '../../theme/palette';
import {
  attachSshCommand,
  closeSessionAction,
  lifecycleSessionAction,
  NONE,
  pinSessionAction,
  quickActionDisplayName,
  reloadSessionAction,
  type BulkSessionAction,
  type CollectionContext,
  type GroupContext,
  type Overlay,
  type ProjectContext,
  type SessionContext,
} from './session-actions';

type SessionsNavigation = NativeStackScreenProps<RootStackParamList, 'Sessions'>['navigation'];

export type SessionsScreenMenusDeps = {
  entries: DrawerBlock[];
  collapse: {
    collapseAllProjects: (machineId: string) => void;
    expandAllProjects: (machineId: string, projectKeys: string[], collectionIds: string[]) => void;
  };
  lastActionByProject: Record<string, string>;
  navigation: SessionsNavigation;
  primaryAgentId: string;
  attachInChatMode: (target: MachineRecord, session: GhostexSession) => Promise<void>;
  attachInTerminalMode: (target: MachineRecord, session: GhostexSession) => Promise<void>;
  /** Drop and re-establish one machine's SSH connection, then refresh it. */
  reconnectMachine: (target: MachineRecord) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshMachine: (machine: MachineRecord) => Promise<void>;
  runBulkSessionActions: (
    target: MachineRecord,
    actions: readonly BulkSessionAction[],
  ) => Promise<void>;
  runCreationFlow: (target: MachineRecord, command: string, message: string) => Promise<void>;
  runQuickAction: (
    target: MachineRecord,
    projectId: string,
    projectTitle: string,
    action: GhostexQuickAction,
  ) => void;
  runSessionCommand: (
    target: MachineRecord,
    command: string,
    options?: {
      closeWarmSessionId?: string;
      optimisticChange?: OptimisticInventoryChange;
    },
  ) => Promise<void>;
  sessionsForProject: (target: MachineRecord, header: ProjectHeaderItem) => GhostexSession[];
  setOverlay: (overlay: Overlay) => void;
  setTransientStatus: (message: string | null) => void;
};

export function useSessionsScreenMenus({
  entries,
  collapse,
  lastActionByProject,
  navigation,
  primaryAgentId,
  attachInChatMode,
  attachInTerminalMode,
  reconnectMachine,
  refreshAll,
  refreshMachine,
  runBulkSessionActions,
  runCreationFlow,
  runQuickAction,
  runSessionCommand,
  sessionsForProject,
  setOverlay,
  setTransientStatus,
}: SessionsScreenMenusDeps) {
  // Desktop-parity context menus ---------------------------------------------

  const summaryFor = (machineId: string) =>
    useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary ?? null;

  const isBrowserSession = (session: GhostexSession): boolean =>
    session.kind === 'browser' || session.surface === 'browser';

  const isRunningSession = (session: GhostexSession): boolean => session.status === 'running';

  /** Sleepable-now sessions (awake, not working/attention) — "inactive". */
  const isInactiveAwake = (session: GhostexSession): boolean => {
    const status = displayStatus(session);
    return isRunningSession(session) && status !== 'working' && status !== 'attention';
  };

  const isSleepingSession = (session: GhostexSession): boolean => {
    const status = displayStatus(session);
    return session.isSleeping || status === 'sleep' || status === 'sleeping';
  };

  /** Write the FULL collections state back through the CLI, then refresh. */
  const runCollectionsUpdate = useCallback(
    (target: MachineRecord, state: unknown): void => {
      void runSessionCommand(target, updateProjectCollectionsCommand(state), {
        optimisticChange: { kind: 'projectCollections', state },
      });
    },
    [runSessionCommand],
  );

  const collectionMemberSessions = (ctx: CollectionContext): GhostexSession[] => {
    const summary = summaryFor(ctx.machine.id);
    if (summary === null) return [];
    const collection = summary.projectCollections.find(
      (entry) => entry.collectionId === ctx.header.collectionId,
    );
    if (collection === undefined) return [];
    return summary.sessions.filter((session) => collection.projectIds.includes(session.projectId));
  };

  const groupMemberSessions = (ctx: GroupContext): GhostexSession[] => {
    const summary = summaryFor(ctx.machine.id);
    if (summary === null) return [];
    const groups = summary.workspaceGroups?.projects?.[ctx.item.projectId]?.groups ?? [];
    const group = groups.find((entry) => entry.groupId === ctx.item.groupId);
    const memberIds = new Set(group?.sessionIds ?? []);
    return summary.sessions.filter((session) => memberIds.has(session.sessionId));
  };

  const menuIconColor = GhostexPalette.FOREGROUND;
  const dangerIconColor = '#FF7B72';

  /** SESSION context menu root — desktop sortable-session-card menu order. */
  const sessionMenuRootItems = (ctx: SessionContext): ContextMenuItem[] => {
    const { session } = ctx.item;
    const projectId = session.projectId.length > 0 ? session.projectId : undefined;
    const browser = isBrowserSession(session);
    const sleeping = isSleepingSession(session);
    const agentKey = session.agentIcon.length > 0 ? session.agentIcon : session.agent;
    const items: ContextMenuItem[] = [];

    if (!browser) {
      items.push({
        kind: 'item',
        key: 'rename',
        label: 'Rename',
        icon: <PencilGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'rename', ctx, error: null }),
      });
    }
    /*
      Session note (desktop sortable-session-card parity). The note is keyed by
      the session's agent conversation id, so a session that has not started one
      — and a session whose project the summary never named — has nothing to
      attach a note to and does not get the item at all.
    */
    if (session.agentSessionId.length > 0 && session.projectId.length > 0) {
      items.push({
        kind: 'item',
        key: 'session-note',
        label: 'Session note',
        icon: <NoteGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'sessionNote', ctx }),
      });
    }
    items.push({
      kind: 'item',
      key: 'pin',
      label: session.isPinned ? 'Unpin' : 'Pin',
      icon: <PinGlyph size={14} color={menuIconColor} />,
      onPress: () =>
        void runSessionCommand(
          ctx.machine,
          pinSessionCommand(session.sessionId, !session.isPinned),
          {
            optimisticChange: pinMutation(session.sessionId, !session.isPinned),
          },
        ),
    });
    if (!browser) {
      items.push({
        kind: 'item',
        key: 'tag',
        label: 'Tag as',
        icon: <TagGlyph size={14} color={menuIconColor} />,
        submenu: true,
        onPress: () => setOverlay({ kind: 'sessionMenu', ctx, view: 'tags' }),
      });
    }
    if (sleeping || isRunningSession(session)) {
      items.push({
        kind: 'item',
        key: 'sleep',
        label: sleeping ? 'Wake' : 'Sleep',
        icon: sleeping ? (
          <PlayGlyph size={14} color={menuIconColor} />
        ) : (
          <SleepGlyph size={14} color={menuIconColor} />
        ),
        onPress: () =>
          sleeping
            ? void runSessionCommand(
                ctx.machine,
                wakeSessionCommand(session.sessionId, projectId),
                {
                  optimisticChange: lifecycleMutation(session.sessionId, false),
                },
              )
            : void runSessionCommand(
                ctx.machine,
                sleepSessionCommand(session.sessionId, projectId),
                {
                  closeWarmSessionId: session.sessionId,
                  optimisticChange: lifecycleMutation(session.sessionId, true),
                },
              ),
      });
    }

    items.push({ kind: 'separator', key: 'sep-1' });
    items.push({
      kind: 'item',
      key: 'attach',
      label: 'Attach',
      icon: <TerminalGlyph size={14} color={menuIconColor} />,
      onPress: () => void attachInTerminalMode(ctx.machine, session),
    });
    if (
      session.projectId.length > 0 &&
      isSessionChatSupportedAgent(
        resolveAgentIconId(
          session.agentIcon,
          session.agentName.length > 0 ? session.agentName : session.agent,
        ),
      )
    ) {
      items.push({
        kind: 'item',
        key: 'chat',
        label: 'Chat',
        icon: <MessageCircleGlyph size={14} color={menuIconColor} />,
        onPress: () => void attachInChatMode(ctx.machine, session),
      });
    }
    items.push({
      kind: 'item',
      key: 'copy-attach',
      label: 'Copy attach command',
      icon: <CopyGlyph size={14} color={menuIconColor} />,
      onPress: () =>
        setOverlay({
          kind: 'copyText',
          title: 'Copy attach command',
          text: attachSshCommand(ctx.machine, session),
        }),
    });
    if (!browser) {
      items.push({
        kind: 'item',
        key: 'delayed-send',
        label: 'Delayed Send',
        icon: <ClockGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'delayedSend', ctx }),
      });
      items.push({
        kind: 'item',
        key: 'close-after-done',
        label: 'Close After Done',
        icon: <ClockGlyph size={14} color={menuIconColor} />,
        selected: session.closeAfterDone,
        onPress: () =>
          void runSessionCommand(ctx.machine, closeAfterDoneCommand(session.sessionId)),
      });
    }
    if (FORK_AGENT_ICONS.includes(agentKey)) {
      items.push({
        kind: 'item',
        key: 'fork',
        label: 'Fork',
        icon: <GitForkGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runCreationFlow(
            ctx.machine,
            forkSessionCommand(session.sessionId),
            ProgressCopy.creatingTerminal(ctx.item.projectTitle),
          ),
      });
    }
    if (!browser) {
      items.push({
        kind: 'item',
        key: 'full-reload',
        label: 'Full reload',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () => void runSessionCommand(ctx.machine, reloadSessionCommand(session.sessionId)),
      });
    }
    items.push({
      kind: 'item',
      key: 'details',
      label: 'Details',
      icon: <InfoGlyph size={14} color={menuIconColor} />,
      onPress: () => setOverlay({ kind: 'sessionDetails', ctx }),
    });

    items.push({ kind: 'separator', key: 'sep-2' });
    items.push({
      kind: 'item',
      key: 'close',
      label: 'Close Session',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      onPress: () => setOverlay({ kind: 'closeConfirm', ctx }),
    });
    return items;
  };

  /** SESSION "Tag as" submenu — grouped Priority/Progress/Type radio rows. */
  const sessionTagItems = (ctx: SessionContext): ContextMenuItem[] => {
    const { session } = ctx.item;
    const current = session.sessionTag;
    const applyTag = (value: string): void =>
      void runSessionCommand(ctx.machine, tagSessionCommand(session.sessionId, value), {
        optimisticChange: tagMutation(session.sessionId, value),
      });
    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'back',
        label: 'Back',
        icon: <ArrowGlyph size={14} color={menuIconColor} direction="left" />,
        onPress: () => setOverlay({ kind: 'sessionMenu', ctx, view: 'root' }),
      },
      { kind: 'separator', key: 'sep-back' },
    ];
    if (current.length > 0) {
      items.push({
        kind: 'item',
        key: 'clear',
        label: 'Clear tag',
        icon: <XGlyph size={14} color={menuIconColor} />,
        onPress: () => applyTag('none'),
      });
    }
    SESSION_TAG_SECTIONS.forEach((section, index) => {
      if (index > 0 || current.length > 0) {
        items.push({ kind: 'separator', key: `sep-${section.label}` });
      }
      for (const option of section.options) {
        const OptionIcon = sessionTagIcon(option.value);
        items.push({
          kind: 'item',
          key: option.value,
          label: option.label,
          // Desktop parity: each tag row carries its own glyph in the tag's
          // color, not one shared tag outline (packages/core-ui/session-tag-ui.tsx).
          icon:
            OptionIcon !== undefined ? (
              <OptionIcon size={14} color={option.color} strokeWidth={1.9} />
            ) : (
              <TagGlyph size={14} color={option.color} />
            ),
          selected: current === option.value,
          onPress: () => applyTag(current === option.value ? 'none' : option.value),
        });
      }
    });
    return items;
  };

  /** PROJECT context menu root — desktop project-header menu order + extras. */
  const projectMenuRootItems = (ctx: ProjectContext): ContextMenuItem[] => {
    const { header } = ctx;
    const orderedHeaders: ProjectHeaderItem[] = [];
    for (const block of entries) {
      if (block.machineId !== ctx.machine.id) continue;
      if (block.kind === 'project') orderedHeaders.push(block.card.header);
      else if (block.kind === 'collection') {
        for (const projectBlock of block.projects) orderedHeaders.push(projectBlock.header);
      }
    }
    const orderedProjectIds = orderedHeaders
      .map((entry) => entry.projectId)
      .filter((projectId) => projectId.length > 0);
    const projectIndex = orderedProjectIds.indexOf(header.projectId);
    const canMove = header.projectId.length > 0 && projectIndex >= 0;
    const movedProjectOrder = (direction: 'up' | 'down'): string[] => {
      const next = [...orderedProjectIds];
      const destination = direction === 'up' ? projectIndex - 1 : projectIndex + 1;
      if (projectIndex < 0 || destination < 0 || destination >= next.length) return next;
      const [projectId] = next.splice(projectIndex, 1);
      next.splice(destination, 0, projectId);
      return next;
    };
    const sessions = sessionsForProject(ctx.machine, header);
    const inactive = sessions.filter(isInactiveAwake);
    const sleeping = sessions.filter(isSleepingSession);
    const running = sessions.filter(isRunningSession);
    const allSleeping = running.length === 0 && sleeping.length > 0;
    const nonBrowser = sessions.filter((session) => !isBrowserSession(session));

    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'copy-path',
        label: 'Copy Path',
        icon: <CopyGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          setOverlay({
            kind: 'copyText',
            title: 'Copy project path',
            text: header.projectPath,
          }),
      },
    ];
    if (header.projectId.length > 0) {
      items.push({
        kind: 'item',
        key: 'add-to-group',
        label: 'Add to project group',
        icon: <PlusGlyph size={14} color={menuIconColor} />,
        submenu: true,
        onPress: () => setOverlay({ kind: 'projectMenu', ctx, view: 'collections' }),
      });
    }
    items.push({ kind: 'separator', key: 'sep-1' });
    if (allSleeping) {
      items.push({
        kind: 'item',
        key: 'wake',
        label: 'Wake',
        icon: <PlayGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionActions(
            ctx.machine,
            sleeping.map((session) => lifecycleSessionAction(session, false)),
          ),
      });
    } else {
      items.push({
        kind: 'item',
        key: 'sleep-inactive',
        label: 'Sleep Inactive',
        icon: <SleepGlyph size={14} color={menuIconColor} />,
        disabled: inactive.length === 0,
        onPress: () =>
          void runBulkSessionActions(
            ctx.machine,
            inactive.map((session) => lifecycleSessionAction(session, true)),
          ),
      });
    }
    items.push({
      kind: 'item',
      key: 'full-reload',
      label: 'Full reload',
      icon: <RefreshGlyph size={14} color={menuIconColor} />,
      disabled: nonBrowser.length === 0,
      onPress: () => void runBulkSessionActions(ctx.machine, nonBrowser.map(reloadSessionAction)),
    });
    items.push({ kind: 'separator', key: 'sep-2' });
    items.push({
      kind: 'item',
      key: 'close-inactive',
      label: 'Close inactive',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      disabled: inactive.length === 0,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Close inactive sessions?',
          body: `This stops ${inactive.length} inactive session(s) in ${header.title} on the connected machine.`,
          confirmLabel: 'Close',
          run: () => void runBulkSessionActions(ctx.machine, inactive.map(closeSessionAction)),
        }),
    });
    items.push({
      kind: 'item',
      key: 'close-project',
      label: 'Close Project',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      disabled: header.projectId.length === 0,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Close project?',
          body: `This parks ${header.title} (and its ${sessions.length} session(s)) into Recent Projects on the computer.`,
          confirmLabel: 'Close Project',
          run: () => void runSessionCommand(ctx.machine, removeProjectCommand(header.projectId)),
        }),
    });
    items.push({ kind: 'separator', key: 'sep-3' });
    items.push({
      kind: 'item',
      key: 'move-up',
      label: 'Move project up',
      icon: <ArrowGlyph size={14} color={menuIconColor} direction="up" />,
      disabled: !canMove || projectIndex <= 0,
      onPress: () =>
        void runSessionCommand(ctx.machine, moveProjectCommand(header.projectId, 'up'), {
          optimisticChange: {
            kind: 'projectOrder',
            projectOrder: movedProjectOrder('up'),
          },
        }),
    });
    items.push({
      kind: 'item',
      key: 'move-down',
      label: 'Move project down',
      icon: <ArrowGlyph size={14} color={menuIconColor} direction="down" />,
      disabled: !canMove || projectIndex >= orderedProjectIds.length - 1,
      onPress: () =>
        void runSessionCommand(ctx.machine, moveProjectCommand(header.projectId, 'down'), {
          optimisticChange: {
            kind: 'projectOrder',
            projectOrder: movedProjectOrder('down'),
          },
        }),
    });
    items.push({
      kind: 'item',
      key: 'refresh',
      label: 'Refresh sessions',
      icon: <RefreshGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        void refreshMachine(ctx.machine);
      },
    });
    items.push({
      kind: 'item',
      key: 'details',
      label: 'Details',
      icon: <InfoGlyph size={14} color={menuIconColor} />,
      onPress: () => setOverlay({ kind: 'projectDetails', ctx }),
    });
    return items;
  };

  /** PROJECT "Add to project group" submenu — desktop collections subview. */
  const projectCollectionsItems = (ctx: ProjectContext): ContextMenuItem[] => {
    const summary = summaryFor(ctx.machine.id);
    const state = summary?.projectCollectionsState ?? null;
    const projectId = ctx.header.projectId;
    const currentId = collectionIdForProject(state, projectId);
    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'back',
        label: 'Back',
        icon: <ArrowGlyph size={14} color={menuIconColor} direction="left" />,
        onPress: () => setOverlay({ kind: 'projectMenu', ctx, view: 'root' }),
      },
      { kind: 'separator', key: 'sep-back' },
      {
        kind: 'item',
        key: 'new-group',
        label: 'New project group',
        icon: <PlusGlyph size={14} color={menuIconColor} />,
        onPress: () => runCollectionsUpdate(ctx.machine, stateWithNewCollection(state, projectId)),
      },
    ];
    for (const collection of summary?.projectCollections ?? []) {
      items.push({
        kind: 'item',
        key: `col:${collection.collectionId}`,
        label: collection.title,
        swatch: collection.color,
        selected: collection.collectionId === currentId,
        onPress: () =>
          runCollectionsUpdate(
            ctx.machine,
            stateWithProjectInCollection(state, collection.collectionId, projectId),
          ),
      });
    }
    if (currentId !== null) {
      items.push({ kind: 'separator', key: 'sep-remove' });
      items.push({
        kind: 'item',
        key: 'remove',
        label: 'Remove from group',
        icon: <XGlyph size={14} color={menuIconColor} />,
        onPress: () => runCollectionsUpdate(ctx.machine, stateWithoutProject(state, projectId)),
      });
    }
    return items;
  };

  /** COLLECTION header menu root — desktop project-collection menu. */
  const collectionMenuRootItems = (ctx: CollectionContext): ContextMenuItem[] => {
    const summary = summaryFor(ctx.machine.id);
    const state = summary?.projectCollectionsState ?? null;
    const sessions = collectionMemberSessions(ctx);
    const awake = sessions.filter(isRunningSession);
    const sleeping = sessions.filter(isSleepingSession);
    const unpinned = sessions.filter((session) => !session.isPinned);
    const pinned = sessions.filter((session) => session.isPinned);
    const nonBrowser = sessions.filter((session) => !isBrowserSession(session));
    const items: ContextMenuItem[] = [];

    if (awake.length > 0) {
      items.push({
        kind: 'item',
        key: 'sleep',
        label: 'Sleep sessions',
        icon: <SleepGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionActions(
            ctx.machine,
            awake.map((session) => lifecycleSessionAction(session, true)),
          ),
      });
    }
    if (sleeping.length > 0) {
      items.push({
        kind: 'item',
        key: 'wake',
        label: 'Wake sessions',
        icon: <PlayGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionActions(
            ctx.machine,
            sleeping.map((session) => lifecycleSessionAction(session, false)),
          ),
      });
    }
    if (unpinned.length > 0) {
      items.push({
        kind: 'item',
        key: 'pin',
        label: 'Pin sessions',
        icon: <PinGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionActions(
            ctx.machine,
            unpinned.map((session) => pinSessionAction(session, true)),
          ),
      });
    }
    if (pinned.length > 0) {
      items.push({
        kind: 'item',
        key: 'unpin',
        label: 'Unpin sessions',
        icon: <PinGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionActions(
            ctx.machine,
            pinned.map((session) => pinSessionAction(session, false)),
          ),
      });
    }
    if (nonBrowser.length > 0) {
      items.push({
        kind: 'item',
        key: 'full-reload',
        label: 'Full reload sessions',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () => void runBulkSessionActions(ctx.machine, nonBrowser.map(reloadSessionAction)),
      });
    }
    if (items.length > 0) items.push({ kind: 'separator', key: 'sep-1' });
    items.push({
      kind: 'item',
      key: 'rename',
      label: 'Rename group',
      icon: <PencilGlyph size={14} color={menuIconColor} />,
      onPress: () => setOverlay({ kind: 'collectionRename', ctx, error: null }),
    });
    items.push({
      kind: 'item',
      key: 'color',
      label: 'Group color',
      icon: <PaletteGlyph size={14} color={menuIconColor} />,
      submenu: true,
      onPress: () => setOverlay({ kind: 'collectionMenu', ctx, view: 'colors' }),
    });
    items.push({
      kind: 'item',
      key: 'delete',
      label: 'Delete group',
      icon: <TrashGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Delete group?',
          body: `This removes the ${ctx.header.title} group. Its projects stay in the sidebar.`,
          confirmLabel: 'Delete',
          run: () =>
            runCollectionsUpdate(
              ctx.machine,
              stateWithoutCollection(state, ctx.header.collectionId),
            ),
        }),
    });
    items.push({
      kind: 'item',
      key: 'close-all',
      label: 'Close all sessions',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      disabled: sessions.length === 0,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Close all sessions?',
          body: `This stops ${sessions.length} session(s) in ${ctx.header.title} on the connected machine.`,
          confirmLabel: 'Close',
          run: () => void runBulkSessionActions(ctx.machine, sessions.map(closeSessionAction)),
        }),
    });
    return items;
  };

  /** COLLECTION "Group color" submenu — shared desktop/mobile swatch radio list. */
  const collectionColorItems = (ctx: CollectionContext): ContextMenuItem[] => {
    const summary = summaryFor(ctx.machine.id);
    const state = summary?.projectCollectionsState ?? null;
    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'back',
        label: 'Back',
        icon: <ArrowGlyph size={14} color={menuIconColor} direction="left" />,
        onPress: () => setOverlay({ kind: 'collectionMenu', ctx, view: 'root' }),
      },
      { kind: 'separator', key: 'sep-back' },
    ];
    for (const option of COLLECTION_COLOR_OPTIONS) {
      items.push({
        kind: 'item',
        key: option.value,
        label: option.label,
        swatch: option.value,
        selected: ctx.header.color === option.value,
        onPress: () =>
          runCollectionsUpdate(
            ctx.machine,
            stateWithCollectionColor(state, ctx.header.collectionId, option.value),
          ),
      });
    }
    return items;
  };

  /** Named session-group header menu — desktop group-head menu. */
  const groupMenuItems = (ctx: GroupContext): ContextMenuItem[] => {
    const sessions = groupMemberSessions(ctx);
    const running = sessions.filter(isRunningSession);
    const sleeping = sessions.filter(isSleepingSession);
    const allSleeping = running.length === 0 && sleeping.length > 0;
    const nonBrowser = sessions.filter((session) => !isBrowserSession(session));
    const items: ContextMenuItem[] = [];
    if (nonBrowser.length > 0) {
      items.push({
        kind: 'item',
        key: 'full-reload',
        label: 'Full reload',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () => void runBulkSessionActions(ctx.machine, nonBrowser.map(reloadSessionAction)),
      });
    }
    items.push({
      kind: 'item',
      key: 'sleep',
      label: allSleeping ? 'Wake' : 'Sleep',
      icon: allSleeping ? (
        <PlayGlyph size={14} color={menuIconColor} />
      ) : (
        <SleepGlyph size={14} color={menuIconColor} />
      ),
      disabled: allSleeping ? sleeping.length === 0 : running.length === 0,
      onPress: () => {
        const targets = allSleeping ? sleeping : running;
        void runBulkSessionActions(
          ctx.machine,
          targets.map((session) => lifecycleSessionAction(session, !allSleeping)),
        );
      },
    });
    items.push({ kind: 'separator', key: 'sep-1' });
    items.push({
      kind: 'item',
      key: 'close',
      label: 'Close',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      disabled: sessions.length === 0,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Close group?',
          body: `This stops ${sessions.length} session(s) in ${ctx.item.title} on the connected machine.`,
          confirmLabel: 'Close Group',
          run: () => void runBulkSessionActions(ctx.machine, sessions.map(closeSessionAction)),
        }),
    });
    return items;
  };

  /** Quick/Projects section-label menus — desktop section hover actions. */
  const sectionMenuItems = (
    target: MachineRecord,
    section: 'quick' | 'projects',
  ): ContextMenuItem[] => {
    if (section === 'quick') {
      return [
        {
          kind: 'item',
          key: 'new-terminal',
          label: 'Quick Terminal',
          icon: <TerminalGlyph size={14} color={menuIconColor} />,
          onPress: () =>
            void runCreationFlow(target, createChatCommand(), ProgressCopy.creatingQuickSession),
        },
      ];
    }
    const summary = summaryFor(target.id);
    const projectKeys: string[] = [];
    for (const project of summary?.projects ?? []) {
      if (project.isChat !== true) projectKeys.push(`id:${project.projectId}`);
    }
    const collectionIds = (summary?.projectCollections ?? []).map((entry) => entry.collectionId);
    return [
      {
        kind: 'item',
        key: 'add-project',
        label: 'Add Project',
        icon: <PlusGlyph size={14} color={menuIconColor} />,
        onPress: () => {
          setOverlay(NONE);
          navigation.navigate('AddProjectSource', { machineId: target.id });
        },
      },
      {
        kind: 'item',
        key: 'recent',
        label: 'Recent Projects',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'recentProjects', machine: target }),
      },
      { kind: 'separator', key: 'sep-1' },
      {
        kind: 'item',
        key: 'collapse-all',
        label: 'Collapse All',
        icon: <ChevronDownGlyph size={14} color={menuIconColor} rotated />,
        onPress: () => {
          setOverlay(NONE);
          collapse.collapseAllProjects(target.id);
        },
      },
      {
        kind: 'item',
        key: 'expand-all',
        label: 'Expand All',
        icon: <ChevronDownGlyph size={14} color={menuIconColor} />,
        onPress: () => {
          setOverlay(NONE);
          collapse.expandAllProjects(target.id, projectKeys, collectionIds);
        },
      },
    ];
  };

  /**
   * Machine tab long-press menu (mobile-06-sessions.html): the four rows the
   * mockup lists, then the machine-scoped entry points that have no other
   * always-visible home. Retry drops and re-establishes the connection, like
   * the desktop tab glyph; Hide flips the same "Show in Sessions" switch the
   * Machines list and Edit machine expose, without touching live terminals.
   */
  const machineMenuItems = (target: MachineRecord): ContextMenuItem[] => [
    ...(useInventoryStore.getState().inventoriesByMachineId[target.id]?.lastError != null
      ? [
          {
            kind: 'item' as const,
            key: 'what-can-i-check',
            label: StripCopy.menu.whatCanICheck,
            icon: <InfoGlyph size={14} color={menuIconColor} />,
            onPress: () => {
              setOverlay(NONE);
              navigation.navigate('CantReach', { machineId: target.id });
            },
          },
        ]
      : []),
    {
      kind: 'item',
      key: 'retry',
      label: StripCopy.menu.retry,
      icon: <RefreshGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        void reconnectMachine(target);
      },
    },
    {
      kind: 'item',
      key: 'edit',
      label: StripCopy.menu.edit,
      icon: <PencilGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('MachineForm', { machineId: target.id });
      },
    },
    {
      kind: 'item',
      key: 'hide',
      label: StripCopy.menu.hide,
      icon: <EyeOffGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        useMachinesStore.getState().setMachineDisabled(target.id, true);
      },
    },
    {
      kind: 'item',
      key: 'all-machines',
      label: StripCopy.menu.allMachines,
      icon: <MachinesGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('Machines');
      },
    },
    { kind: 'separator', key: 'sep-1' },
    {
      kind: 'item',
      key: 'add-project',
      label: StripCopy.menu.addProject,
      icon: <PlusGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('AddProjectSource', { machineId: target.id });
      },
    },
    {
      kind: 'item',
      key: 'web-preview',
      label: WebPreviewCopy.menuLabel,
      icon: <WorldGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('WebPreviewPorts', { machineId: target.id });
      },
    },
  ];

  /**
   * Header hamburger menu: app-level actions and Recent Projects, which moved
   * here from its full-width sessions-list button. Machine-scoped actions are
   * available only when the selected machine has the required data. Logout
   * closes the app and its live connections, which only Android lets an app do.
   */
  const appMenuItems = (target: MachineRecord | null): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'search-prompts',
        label: 'Search Prompts',
        icon: <SearchGlyph size={14} color={menuIconColor} />,
        disabled: target === null,
        onPress: () => {
          if (target === null) return;
          setOverlay(NONE);
          navigation.navigate('FindPrompts', { machineId: target.id });
        },
      },
    ];
    if (target !== null && (summaryFor(target.id)?.recentProjects.length ?? 0) > 0) {
      items.push({
        kind: 'item',
        key: 'recent-projects',
        label: 'Recent Projects',
        icon: <ClockGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'recentProjects', machine: target }),
      });
    }
    items.push({
      kind: 'item',
      key: 'settings',
      label: 'Settings',
      icon: <SettingsGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('Settings');
      },
    });
    if (Platform.OS === 'android') {
      items.push({ kind: 'separator', key: 'sep-1' });
      items.push({
        kind: 'item',
        key: 'logout',
        label: 'Logout',
        icon: <ExitGlyph size={14} color={menuIconColor} />,
        destructive: true,
        onPress: () =>
          setOverlay({
            kind: 'confirmAction',
            title: 'Quit Ghostex?',
            body: 'This fully closes Ghostex and all active mobile terminal connections.',
            confirmLabel: 'Quit',
            run: () => void GhostexNative.quitApp(),
          }),
      });
    }
    return items;
  };

  // Desktop agent split-button + actions button menus -----------------------

  const resolvePrimaryAgent = useCallback(
    (agents: GhostexAgentLauncher[]): GhostexAgentLauncher | null => {
      if (agents.length === 0) return null;
      return agents.find((agent) => agent.agentId === primaryAgentId) ?? agents[0];
    },
    [primaryAgentId],
  );

  const launchAgent = useCallback(
    (target: MachineRecord, header: ProjectHeaderItem, agent: GhostexAgentLauncher): void => {
      if (header.projectId.length === 0) {
        setTransientStatus(ProgressCopy.noStableProjectId);
        return;
      }
      const agentName =
        agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
      void runCreationFlow(
        target,
        createAgentCommand(agent.agentId, header.projectId),
        ProgressCopy.startingAgent(agentName, header.title),
      );
    },
    [runCreationFlow, setTransientStatus],
  );

  /** Agent menu: brand icon + name + optional chat marker; selection emphasizes text. */
  const agentMenuItems = (ctx: ProjectContext): ContextMenuItem[] => {
    const selected = resolvePrimaryAgent(ctx.header.agents);
    return ctx.header.agents.map((agent) => {
      const name = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
      const iconId = resolveAgentIconId(agent.icon, name);
      const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
      const supportsChat =
        isSessionChatSupportedAgent(agent.agentId) || isSessionChatSupportedAgent(iconId);
      return {
        kind: 'item' as const,
        key: agent.agentId,
        label: name,
        icon: <Icon size={14} color={agentIconTint(iconId)} />,
        selected: selected !== null && selected.agentId === agent.agentId,
        selectedPresentation: 'emphasis' as const,
        trailingIcon: supportsChat ? (
          <MessageCircleGlyph size={14} color={SidebarPalette.MUTED} />
        ) : undefined,
        trailingIconLabel: supportsChat ? 'Supports chat' : undefined,
        onPress: () => {
          setOverlay(NONE);
          useLauncherStore.getState().setPrimaryAgent(agent.agentId);
          launchAgent(ctx.machine, ctx.header, agent);
        },
      };
    });
  };

  /** Actions menu: one row per project quick action, check on the last run. */
  const actionsMenuItems = (ctx: ProjectContext): ContextMenuItem[] => {
    const selectedCommandId =
      lastActionByProject[lastActionKey(ctx.machine.id, ctx.header.projectId)] ?? '';
    return ctx.header.quickActions.map((action, index) => {
      const name = quickActionDisplayName(action);
      const commandId = action.commandId ?? '';
      const iconId = resolveAgentIconId(
        action.icon,
        action.actionType === 'browser' ? 'browser' : name,
      );
      const Icon = AGENT_ICONS[iconId];
      return {
        kind: 'item' as const,
        key: commandId.length > 0 ? commandId : `action-${index}`,
        label: name,
        icon:
          Icon !== undefined ? (
            <Icon size={14} color={agentIconTint(iconId)} />
          ) : (
            <WorldGlyph size={14} color={agentIconTint('browser')} />
          ),
        selected: commandId.length > 0 && commandId === selectedCommandId,
        onPress: () => {
          setOverlay(NONE);
          if (commandId.length > 0) {
            useLauncherStore
              .getState()
              .setLastAction(ctx.machine.id, ctx.header.projectId, commandId);
          }
          runQuickAction(ctx.machine, ctx.header.projectId, ctx.header.title, action);
        },
      };
    });
  };

  const recoveryItems = (target: MachineRecord | null): ActionSheetItem[] => [
    {
      key: 'retry',
      label: 'Retry connection',
      onPress: () => {
        setOverlay(NONE);
        if (target !== null) void refreshMachine(target);
        else void refreshAll();
      },
    },
    {
      key: 'tailscale',
      label: 'Open Tailscale',
      onPress: () => {
        setOverlay(NONE);
        void openTailscaleOrDownload();
      },
    },
    {
      key: 'setup',
      label: 'Setup',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('Machines');
      },
    },
    {
      key: 'add',
      label: 'Add a computer',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('ConnectChoose');
      },
    },
    {
      key: 'manage',
      label: 'Manage machines',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('Machines');
      },
    },
    {
      key: 'tutorial',
      label: 'Tutorial',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('Machines');
      },
    },
  ];

  return {
    summaryFor,
    runCollectionsUpdate,
    sessionMenuRootItems,
    sessionTagItems,
    projectMenuRootItems,
    projectCollectionsItems,
    collectionMenuRootItems,
    collectionColorItems,
    groupMenuItems,
    machineMenuItems,
    appMenuItems,
    sectionMenuItems,
    resolvePrimaryAgent,
    launchAgent,
    agentMenuItems,
    actionsMenuItems,
    recoveryItems,
  };
}
