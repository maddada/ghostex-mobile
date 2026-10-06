/**
 * SessionsScreen context menus: the session and project menus (built as
 * gx-core-shaped data in ./sidebar-menus.ts, drawn by ./sidebar-menu-view.tsx,
 * and run here through the `ghostex` CLI), the collection/group/section menus,
 * the agent + actions split-button menus, and the recovery sheet items. The
 * three useCallback hooks inside (runCollectionsUpdate, resolvePrimaryAgent,
 * launchAgent) run in their original relative order.
 */

import { useCallback } from 'react';
import { Platform } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';

import { GhostexNative } from '../../../modules/ghostex-native/src';

import { openTailscaleOrDownload } from '../../app/tailscale';
import type { ActionSheetItem } from '../../components/common/ActionSheet';
import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import { isSessionChatSupportedAgent } from '../../chat/session-chat-helpers';
import { runGhostexCli } from '../../components/sessions/cli';
import { type ContextMenuItem } from '../../components/sessions/ContextMenu';
import { type DrawerBlock } from '../../components/sessions/drawerModel';
import {
  ArrowGlyph,
  ChevronDownGlyph,
  ClockGlyph,
  CrewGlyph,
  ExitGlyph,
  EyeOffGlyph,
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
  TerminalGlyph,
  TrashGlyph,
  WorldGlyph,
  XGlyph,
} from '../../components/sessions/icons';
import { useLauncherStore, lastActionKey } from '../../components/sessions/launcherStore';
import {
  coordinatorOptionsCommand,
  createAgentCommand,
  createChatCommand,
  createCoordinatorCommand,
  type CreateCoordinatorInput,
  exportSessionTranscriptCommand,
  forkSessionCommand,
  promoteCoordinatorCommand,
  moveProjectCommand,
  removeProjectCommand,
  updateProjectCollectionsCommand,
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
import {
  agentIconTint,
  displayStatus,
  EMPTY_CUSTOM_SESSION_TAGS,
  resolveAgentIconId,
  type GhostexAgentLauncher,
  type GhostexQuickAction,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { DocsCopy, ProgressCopy, StripCopy, WebPreviewCopy } from '../../copy';
import type { OptimisticInventoryChange } from '../../inventory/optimistic';
import { useInventoryStore } from '../../inventory/store';
import { useMachinesStore, type MachineRecord } from '../../machines/store';
import { useSettingsStore } from '../../settings/store';
import type { RootStackParamList } from '../../navigation/types';
import { GhostexPalette, SidebarPalette } from '../../theme/palette';
import { availableUpdate, useAndroidSelfUpdateStore } from '../../updates/androidSelfUpdateStore';
import { transcriptMentionDraft, type ExportedTranscript } from '../terminal-screen/session-lookups';
import {
  cancelDelayedSendSessionAction,
  closeAfterDoneSessionAction,
  closeSessionAction,
  lifecycleSessionAction,
  NONE,
  parkSessionAction,
  pinSessionAction,
  quickActionDisplayName,
  reloadSessionAction,
  sessionTitle,
  tagSessionAction,
  type BulkSessionAction,
  type CollectionContext,
  type GroupContext,
  type Overlay,
  type ProjectContext,
  type SessionContext,
} from './session-actions';
import { parseCoordinatorOptions, type CoordinatorOptions } from './NewCoordinatorSheet';
import { sidebarMenuView } from './sidebar-menu-view';
import {
  buildProjectMenu,
  buildSessionMenu,
  isInactiveSession,
  type SidebarMenuCommand,
  type SidebarMenuMessage,
} from './sidebar-menus';

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
  /** Full-screen progress line (null hides it). */
  setProgress: (message: string | null) => void;
  /** Drop and re-establish one machine's SSH connection, then refresh it. */
  reconnectMachine: (target: MachineRecord) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshMachine: (machine: MachineRecord) => Promise<void>;
  runBulkSessionActions: (target: MachineRecord, actions: readonly BulkSessionAction[]) => Promise<void>;
  runCreationFlow: (
    target: MachineRecord,
    command: string,
    message: string,
    chatLaunch?: { agentId: string; projectId: string; title: string }
  ) => Promise<void>;
  runQuickAction: (target: MachineRecord, projectId: string, projectTitle: string, action: GhostexQuickAction) => void;
  runSessionCommand: (
    target: MachineRecord,
    command: string,
    options?: {
      closeWarmSessionId?: string;
      optimisticChange?: OptimisticInventoryChange;
    }
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
  setProgress,
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

  // Newer Android release known from the last self-update check; the Settings
  // menu item carries it as a one-line notice.
  const availableUpdateVersion = useAndroidSelfUpdateStore((state) => availableUpdate(state.check)?.version ?? null);

  const summaryFor = (machineId: string) =>
    useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary ?? null;

  const isBrowserSession = (session: GhostexSession): boolean =>
    session.kind === 'browser' || session.surface === 'browser';

  const isRunningSession = (session: GhostexSession): boolean => session.status === 'running';

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
    [runSessionCommand]
  );

  const collectionMemberSessions = (ctx: CollectionContext): GhostexSession[] => {
    const summary = summaryFor(ctx.machine.id);
    if (summary === null) return [];
    const collection = summary.projectCollections.find((entry) => entry.collectionId === ctx.header.collectionId);
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

  // Session and project menus (desktop sidebar parity) ------------------------

  const sessionById = (machineId: string, sessionId: string): GhostexSession | null =>
    summaryFor(machineId)?.sessions.find((entry) => entry.sessionId === sessionId) ?? null;

  /** A session a menu command names, which must still be on the machine. */
  const menuSession = (machine: MachineRecord, sessionId: string): GhostexSession => {
    const session = sessionById(machine.id, sessionId);
    if (session === null) throw new Error('That session is no longer on the computer.');
    return session;
  };

  /**
   * The sessions drawn under this row in its group, which is what Sleep Below and Close Below act
   * on (gx-core `rows_below`). A named session group is a group of its own, as on the desktop, and
   * rows inside a collapsed section are not drawn, so they are not below anything.
   */
  const sessionsBelow = (ctx: SessionContext): GhostexSession[] => {
    for (let blockIndex = 0; blockIndex < entries.length; blockIndex++) {
      const block = entries[blockIndex];
      if (block.machineId !== ctx.machine.id) continue;
      if (block.kind === 'row') {
        if (block.item.key !== ctx.item.key) continue;
        const below: GhostexSession[] = [];
        for (const next of entries.slice(blockIndex + 1)) {
          if (next.kind !== 'row') break;
          if (next.item.type === 'SESSION') below.push(next.item.session);
          else if (
            next.item.type !== 'SESSION_KIND_LABEL' &&
            next.item.type !== 'SESSION_LIST_TOGGLE' &&
            next.item.type !== 'COORDINATOR_OLDER'
          )
            break;
        }
        return below;
      }
      const cards = block.kind === 'project' ? [block.card] : block.projects;
      for (const card of cards) {
        const pressedIndex = card.children.findIndex((child) => child.key === ctx.item.key);
        if (pressedIndex < 0) continue;
        const below: GhostexSession[] = [];
        let segment: string | null = null;
        let pressedSegment: string | null = null;
        card.children.forEach((child, index) => {
          if (child.type === 'GROUP_HEADER') segment = child.groupId;
          else if (child.type === 'SESSION_KIND_LABEL') segment = null;
          else if (child.type === 'SESSION') {
            if (index === pressedIndex) pressedSegment = segment;
            else if (index > pressedIndex && segment === pressedSegment) below.push(child.session);
          }
        });
        return below;
      }
    }
    return [];
  };

  /** One session-scoped message as the CLI action that performs it. */
  const sessionMessageAction = (machine: MachineRecord, message: SidebarMenuMessage): BulkSessionAction => {
    switch (message.type) {
      case 'setSessionSleeping':
        return lifecycleSessionAction(menuSession(machine, message.sessionId), message.sleeping);
      case 'setSessionPinned':
        return pinSessionAction(menuSession(machine, message.sessionId), message.pinned);
      case 'setSessionParked':
        return parkSessionAction(menuSession(machine, message.sessionId), message.parked);
      case 'setSessionTag':
        return tagSessionAction(menuSession(machine, message.sessionId), message.sessionTag);
      case 'toggleCloseAfterDone':
        return closeAfterDoneSessionAction(menuSession(machine, message.sessionId));
      case 'fullReloadSession':
        return reloadSessionAction(menuSession(machine, message.sessionId));
      case 'cancelDelayedSend':
        return cancelDelayedSendSessionAction(menuSession(machine, message.sessionId));
      default:
        throw new Error(`Menu message ${message.type} is not a single-session change.`);
    }
  };

  /** Handoff / Export: the daemon writes the markdown and answers with its absolute path. */
  const exportTranscript = async (ctx: SessionContext): Promise<void> => {
    const { machine } = ctx;
    const { session } = ctx.item;
    setOverlay(NONE);
    setProgress('Exporting transcript…');
    try {
      const result = await runGhostexCli(
        machine,
        exportSessionTranscriptCommand(session.sessionId, session.projectId),
      );
      const path = typeof result.json?.path === 'string' ? result.json.path.trim() : '';
      if (path.length === 0) {
        throw new Error('gxserver exported the transcript without reporting its path.');
      }
      setOverlay({
        kind: 'exportedTranscript',
        exported: {
          machine,
          projectId: session.projectId,
          sessionTitle: sessionTitle(session),
          agentId: session.agent.trim(),
          agentLabel: session.agentName.length > 0 ? session.agentName : session.agent,
          path,
        },
        projectTitle: ctx.item.projectTitle,
      });
    } catch (error) {
      setTransientStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
    }
  };

  /** Make Coordinator: gxserver promotes the session in place; its running turn is never touched. */
  const makeCoordinator = async (machine: MachineRecord, session: GhostexSession): Promise<void> => {
    setProgress('Making it a coordinator…');
    try {
      await runGhostexCli(machine, promoteCoordinatorCommand(session.globalRef));
      setTransientStatus('Now a coordinator');
    } catch (error) {
      setTransientStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
    }
  };

  /** The exported transcript's follow-up: the same agent, with the path staged as its first input. */
  const startTranscriptConversation = (exported: ExportedTranscript, projectTitle: string): void => {
    if (exported.agentId.length === 0) return;
    void runCreationFlow(
      exported.machine,
      createAgentCommand(
        exported.agentId,
        exported.projectId,
        transcriptMentionDraft(exported.path, exported.sessionTitle),
      ),
      ProgressCopy.startingAgent(exported.agentLabel, projectTitle),
    );
  };

  /** One `command` message from a session or project menu. */
  const runMenuMessage = (
    machine: MachineRecord,
    message: SidebarMenuMessage,
    scope: { session?: SessionContext; project?: ProjectContext },
  ): void => {
    const requireSession = (): SessionContext => {
      if (scope.session === undefined) throw new Error(`Menu message ${message.type} needs a session.`);
      return scope.session;
    };
    const requireProject = (): ProjectContext => {
      if (scope.project === undefined) throw new Error(`Menu message ${message.type} needs a project.`);
      return scope.project;
    };
    switch (message.type) {
      case 'closeSession':
        setOverlay({ kind: 'closeConfirm', ctx: requireSession() });
        return;
      case 'closeSessions': {
        const ctx = requireSession();
        const sessions = message.sessionIds.map((sessionId) => menuSession(machine, sessionId));
        setOverlay({
          kind: 'confirmAction',
          title: 'Close sessions below?',
          body: `This stops ${sessions.length} session(s) below ${sessionTitle(ctx.item.session)} on the connected machine.`,
          confirmLabel: 'Close',
          run: () => void runBulkSessionActions(machine, sessions.map(closeSessionAction)),
        });
        return;
      }
      case 'setSessionsSleeping':
        void runBulkSessionActions(
          machine,
          message.sessionIds.map((sessionId) => lifecycleSessionAction(menuSession(machine, sessionId), true)),
        );
        return;
      case 'forkSession':
        void runCreationFlow(
          machine,
          forkSessionCommand(message.sessionId),
          ProgressCopy.creatingTerminal(requireSession().item.projectTitle),
        );
        return;
      case 'exportSessionTranscript':
        void exportTranscript(requireSession());
        return;
      case 'makeCoordinator': {
        const { session } = requireSession().item;
        setOverlay({
          kind: 'confirmAction',
          title: 'Make coordinator?',
          body: `${sessionTitle(session)} keeps its conversation and keeps running: nothing restarts or interrupts it. It gets the crown now, and its coordinator playbook arrives once its current turn is over.`,
          confirmLabel: 'Make Coordinator',
          run: () => void makeCoordinator(machine, session),
        });
        return;
      }
      case 'copyWorkspaceProjectPathForGroup': {
        const { header } = requireProject();
        setOverlay(NONE);
        void Clipboard.setStringAsync(header.projectPath)
          .then(() => setTransientStatus('Path copied'))
          .catch((error: unknown) => setTransientStatus(error instanceof Error ? error.message : String(error)));
        return;
      }
      case 'removeWorkspaceProjectForGroup': {
        const { header } = requireProject();
        setOverlay({
          kind: 'confirmAction',
          title: 'Remove worktree?',
          body: `This removes the ${header.title} project from Ghostex on the computer. Its folder is not deleted.`,
          confirmLabel: 'Remove',
          run: () => void runSessionCommand(machine, removeProjectCommand(header.projectId)),
        });
        return;
      }
      case 'wakeProjectSleepingSessions': {
        const sessions = sessionsForProject(machine, requireProject().header);
        void runBulkSessionActions(
          machine,
          sessions.filter(isSleepingSession).map((session) => lifecycleSessionAction(session, false)),
        );
        return;
      }
      case 'sleepInactiveProjectSessions': {
        const sessions = sessionsForProject(machine, requireProject().header);
        void runBulkSessionActions(
          machine,
          sessions.filter(isInactiveSession).map((session) => lifecycleSessionAction(session, true)),
        );
        return;
      }
      case 'fullReloadProjectZmxSessions': {
        const sessions = sessionsForProject(machine, requireProject().header);
        void runBulkSessionActions(
          machine,
          sessions.filter((session) => !isBrowserSession(session)).map(reloadSessionAction),
        );
        return;
      }
      case 'closeInactiveProjectSessions': {
        const { header } = requireProject();
        const inactive = sessionsForProject(machine, header).filter(isInactiveSession);
        setOverlay({
          kind: 'confirmAction',
          title: 'Close inactive sessions?',
          body: `This stops ${inactive.length} inactive session(s) in ${header.title} on the connected machine.`,
          confirmLabel: 'Close',
          run: () => void runBulkSessionActions(machine, inactive.map(closeSessionAction)),
        });
        return;
      }
      default: {
        const action = sessionMessageAction(machine, message);
        void runSessionCommand(machine, action.command, {
          closeWarmSessionId: action.closeWarmSession ? action.sessionId : undefined,
          optimisticChange: action.optimisticChange,
        });
      }
    }
  };

  /** Runs a menu row's command the way the desktop's sidebar dispatcher does, through the CLI. */
  const runMenuCommand = (
    machine: MachineRecord,
    menuCommand: SidebarMenuCommand,
    scope: { session?: SessionContext; project?: ProjectContext },
  ): void => {
    try {
      switch (menuCommand.type) {
        case 'command':
          runMenuMessage(machine, menuCommand.message, scope);
          return;
        case 'batch':
          void runBulkSessionActions(
            machine,
            menuCommand.messages.map((message) => sessionMessageAction(machine, message)),
          );
          return;
        case 'sessionAction': {
          const ctx = scope.session;
          if (ctx === undefined) throw new Error('A session action needs a session.');
          if (menuCommand.action === 'rename') setOverlay({ kind: 'rename', ctx, error: null });
          else if (menuCommand.action === 'note') setOverlay({ kind: 'sessionNote', ctx });
          else setOverlay({ kind: 'delayedSend', ctx });
          return;
        }
        case 'projectMembership': {
          const ctx = scope.project;
          if (ctx === undefined) throw new Error('A project group change needs a project.');
          const state = summaryFor(machine.id)?.projectCollectionsState ?? null;
          const projectId = ctx.header.projectId;
          setOverlay(NONE);
          runCollectionsUpdate(
            machine,
            menuCommand.action === 'createCollection'
              ? stateWithNewCollection(state, projectId)
              : menuCommand.collectionId === undefined
                ? stateWithoutProject(state, projectId)
                : stateWithProjectInCollection(state, menuCommand.collectionId, projectId),
          );
          return;
        }
      }
    } catch (error) {
      setOverlay(NONE);
      setTransientStatus(error instanceof Error ? error.message : String(error));
    }
  };

  /** The session row's context menu at `menuPath` (./sidebar-menus.ts builds it). */
  const sessionMenuView = (
    ctx: SessionContext,
    menuPath: readonly string[],
  ): { subtitle: string; items: ContextMenuItem[] } => {
    const menu = buildSessionMenu({
      session: ctx.item.session,
      customTags: summaryFor(ctx.machine.id)?.customSessionTags ?? EMPTY_CUSTOM_SESSION_TAGS,
      below: sessionsBelow(ctx),
    });
    const view = sidebarMenuView(menu, menuPath, {
      openPath: (next) => setOverlay({ kind: 'sessionMenu', ctx, menuPath: next }),
      run: (menuCommand) => runMenuCommand(ctx.machine, menuCommand, { session: ctx }),
    });
    return { subtitle: view.openedLabel ?? ctx.item.projectTitle, items: view.items };
  };

  /**
   * The project header's context menu at `menuPath`: the desktop's rows (./sidebar-menus.ts), then
   * the phone's own project rows, which have no other home on the phone.
   */
  const projectMenuView = (
    ctx: ProjectContext,
    menuPath: readonly string[],
  ): { subtitle: string; items: ContextMenuItem[] } => {
    const { header } = ctx;
    const summary = summaryFor(ctx.machine.id);
    const menu = buildProjectMenu({
      groupId: header.projectKey,
      projectId: header.projectId,
      isWorktree: header.icon.isWorktree,
      sessions: sessionsForProject(ctx.machine, header),
      collectionId: collectionIdForProject(summary?.projectCollectionsState ?? null, header.projectId),
      collections: summary?.projectCollections ?? [],
    });
    const view = sidebarMenuView(menu, menuPath, {
      openPath: (next) => setOverlay({ kind: 'projectMenu', ctx, menuPath: next }),
      run: (menuCommand) => runMenuCommand(ctx.machine, menuCommand, { project: ctx }),
    });
    if (view.openedLabel !== null) return { subtitle: view.openedLabel, items: view.items };

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
    const phoneRows: ContextMenuItem[] = [{ kind: 'separator', key: 'phone-sep' }];
    if (header.projectId.length > 0 && header.projectPath.length > 0) {
      phoneRows.push({
        kind: 'item',
        key: 'docs',
        label: DocsCopy.menuLabel,
        icon: <NoteGlyph size={14} color={menuIconColor} />,
        onPress: () => {
          setOverlay(NONE);
          navigation.navigate('Docs', {
            machineId: ctx.machine.id,
            projectId: header.projectId,
            projectName: header.title,
            projectPath: header.projectPath,
          });
        },
      });
    }
    phoneRows.push(
      {
        kind: 'item',
        key: 'move-up',
        label: 'Move Project Up',
        icon: <ArrowGlyph size={14} color={menuIconColor} direction='up' />,
        disabled: !canMove || projectIndex <= 0,
        onPress: () =>
          void runSessionCommand(ctx.machine, moveProjectCommand(header.projectId, 'up'), {
            optimisticChange: { kind: 'projectOrder', projectOrder: movedProjectOrder('up') },
          }),
      },
      {
        kind: 'item',
        key: 'move-down',
        label: 'Move Project Down',
        icon: <ArrowGlyph size={14} color={menuIconColor} direction='down' />,
        disabled: !canMove || projectIndex >= orderedProjectIds.length - 1,
        onPress: () =>
          void runSessionCommand(ctx.machine, moveProjectCommand(header.projectId, 'down'), {
            optimisticChange: { kind: 'projectOrder', projectOrder: movedProjectOrder('down') },
          }),
      },
      {
        kind: 'item',
        key: 'refresh',
        label: 'Refresh Sessions',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () => {
          setOverlay(NONE);
          void refreshMachine(ctx.machine);
        },
      },
      {
        kind: 'item',
        key: 'details',
        label: 'Details',
        icon: <InfoGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'projectDetails', ctx }),
      },
    );
    return { subtitle: 'Project', items: [...view.items, ...phoneRows] };
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
            awake.map((session) => lifecycleSessionAction(session, true))
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
            sleeping.map((session) => lifecycleSessionAction(session, false))
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
            unpinned.map((session) => pinSessionAction(session, true))
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
            pinned.map((session) => pinSessionAction(session, false))
          ),
      });
    }
    if (nonBrowser.length > 0) {
      items.push({
        kind: 'item',
        key: 'full-reload',
        label: 'Full Reload sessions',
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
          run: () => runCollectionsUpdate(ctx.machine, stateWithoutCollection(state, ctx.header.collectionId)),
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
        icon: <ArrowGlyph size={14} color={menuIconColor} direction='left' />,
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
          runCollectionsUpdate(ctx.machine, stateWithCollectionColor(state, ctx.header.collectionId, option.value)),
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
        label: 'Full Reload',
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
          targets.map((session) => lifecycleSessionAction(session, !allSleeping))
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
  const sectionMenuItems = (target: MachineRecord, section: 'quick' | 'projects'): ContextMenuItem[] => {
    if (section === 'quick') {
      return [
        {
          kind: 'item',
          key: 'new-terminal',
          label: 'Quick Terminal',
          icon: <TerminalGlyph size={14} color={menuIconColor} />,
          onPress: () => void runCreationFlow(target, createChatCommand(), ProgressCopy.creatingQuickSession),
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
      label:
        availableUpdateVersion === null ? 'Settings' : `Settings · Update available: Ghostex ${availableUpdateVersion}`,
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
    [primaryAgentId]
  );

  const launchAgent = useCallback(
    (target: MachineRecord, header: ProjectHeaderItem, agent: GhostexAgentLauncher): void => {
      if (header.projectId.length === 0) {
        setTransientStatus(ProgressCopy.noStableProjectId);
        return;
      }
      const agentName = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
      const iconId = resolveAgentIconId(agent.icon, agentName);
      const chatFirst =
        useSettingsStore.getState().settings.preferredAgentInterface === 'chat' && isSessionChatSupportedAgent(iconId);
      void runCreationFlow(
        target,
        createAgentCommand(agent.agentId, header.projectId, undefined, chatFirst, true),
        ProgressCopy.startingAgent(agentName, header.title),
        chatFirst ? { agentId: iconId, projectId: header.projectId, title: agentName } : undefined
      );
    },
    [runCreationFlow, setTransientStatus]
  );

  /**
   * Agent menu: "New Coordinator…" first, then one row per agent (brand icon + name + optional chat
   * marker; selection emphasizes text).
   *
   * CDXC:Coordinators 2026-10-03 DECISION:
   * User: "On mobile app I can't start a coordinator thread from the agents drop down" and "Please move this to the top in both apps". The phone's agent menu offers New Coordinator… as its first row, as the desktop launcher does (gx-core `agent_launcher_items_with_accounts`), and it opens the phone's New Coordinator form.
   */
  const agentMenuItems = (ctx: ProjectContext): ContextMenuItem[] => {
    const selected = resolvePrimaryAgent(ctx.header.agents);
    const newCoordinator: ContextMenuItem[] =
      ctx.header.projectId.length > 0
        ? [
            {
              kind: 'item',
              key: 'new-coordinator',
              label: 'New Coordinator…',
              icon: <CrewGlyph size={14} color={SidebarPalette.MUTED} />,
              onPress: () => setOverlay({ kind: 'newCoordinator', ctx }),
            },
            { kind: 'separator', key: 'new-coordinator-separator' },
          ]
        : [];
    return [...newCoordinator, ...ctx.header.agents.map((agent): ContextMenuItem => {
      const name = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
      const iconId = resolveAgentIconId(agent.icon, name);
      const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
      const supportsChat = isSessionChatSupportedAgent(agent.agentId) || isSessionChatSupportedAgent(iconId);
      return {
        kind: 'item' as const,
        key: agent.agentId,
        label: name,
        icon: <Icon size={14} color={agentIconTint(iconId)} />,
        selected: selected !== null && selected.agentId === agent.agentId,
        selectedPresentation: 'emphasis' as const,
        trailingIcon: supportsChat ? <MessageCircleGlyph size={14} color={SidebarPalette.MUTED} /> : undefined,
        trailingIconLabel: supportsChat ? 'Supports chat' : undefined,
        onPress: () => {
          setOverlay(NONE);
          useLauncherStore.getState().setPrimaryAgent(agent.agentId);
          launchAgent(ctx.machine, ctx.header, agent);
        },
      };
    })];
  };

  /** The New Coordinator form's Create: the coordinator opens in chat, where its reports read best (as on the desktop). */
  const createCoordinator = (
    ctx: ProjectContext,
    input: Omit<CreateCoordinatorInput, 'projectId'> & { agentName: string },
  ): void => {
    const launcher = ctx.header.agents.find((agent) => agent.agentId === input.agentId);
    const iconId = resolveAgentIconId(launcher?.icon, input.agentName);
    const title = input.title.trim().length > 0 ? input.title.trim() : 'Coordinator';
    void runCreationFlow(
      ctx.machine,
      createCoordinatorCommand({ ...input, projectId: ctx.header.projectId }),
      ProgressCopy.startingCoordinator(ctx.header.title),
      { agentId: iconId, projectId: ctx.header.projectId, title },
    );
  };

  const loadCoordinatorOptions = async (ctx: ProjectContext): Promise<CoordinatorOptions> => {
    const result = await runGhostexCli(ctx.machine, coordinatorOptionsCommand());
    return parseCoordinatorOptions(result.json);
  };

  /** Actions menu: one row per project quick action, check on the last run. */
  const actionsMenuItems = (ctx: ProjectContext): ContextMenuItem[] => {
    const selectedCommandId = lastActionByProject[lastActionKey(ctx.machine.id, ctx.header.projectId)] ?? '';
    return ctx.header.quickActions.map((action, index) => {
      const name = quickActionDisplayName(action);
      const commandId = action.commandId ?? '';
      const iconId = resolveAgentIconId(action.icon, action.actionType === 'browser' ? 'browser' : name);
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
            useLauncherStore.getState().setLastAction(ctx.machine.id, ctx.header.projectId, commandId);
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
    sessionMenuView,
    projectMenuView,
    startTranscriptConversation,
    collectionMenuRootItems,
    collectionColorItems,
    groupMenuItems,
    machineMenuItems,
    appMenuItems,
    sectionMenuItems,
    resolvePrimaryAgent,
    launchAgent,
    agentMenuItems,
    createCoordinator,
    loadCoordinatorOptions,
    actionsMenuItems,
    recoveryItems,
  };
}
