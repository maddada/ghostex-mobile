/**
 * Sessions drawer as the app's home page (docs/specs/sessions-drawer.md §§1-6):
 * header + status line + Recent Projects + flat drawer list built from
 * buildDrawerItems, with session/project context menus, creation flows,
 * recovery sheet, and focus-scoped 5s inventory polling.
 */

import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative } from '../../modules/ghostex-native/src';
import ActionSheet, { type ActionSheetItem } from '../components/common/ActionSheet';
import ConfirmDialog from '../components/common/ConfirmDialog';
import DetailsSheet from '../components/common/DetailsSheet';
import ProgressOverlay from '../components/common/ProgressOverlay';
import PromptDialog from '../components/common/PromptDialog';
import StateCard from '../components/common/StateCard';
import { createdSessionId, runGhostexCli } from '../components/sessions/cli';
import { useCollapseStore } from '../components/sessions/collapseStore';
import { buildDrawerList, drawerStatusLine, type DrawerListEntry } from '../components/sessions/drawerModel';
import { MachinesGlyph, RefreshGlyph, SettingsGlyph } from '../components/sessions/icons';
import {
  CollectionHeaderRow,
  collectionRailColor,
  GroupHeaderRow,
  MachineHeaderRow,
  ProjectAgentsRow,
  ProjectEmptyRow,
  ProjectHeaderRow,
  SessionListToggleRow,
} from '../components/sessions/rows';
import SessionRow from '../components/sessions/SessionRow';
import {
  attachCommand,
  createAgentCommand,
  createChatCommand,
  createSessionCommand,
  focusSessionCommand,
  killSessionCommand,
  loginShellCommand,
  moveProjectCommand,
  renameSessionCommand,
  restoreRecentProjectCommand,
  runActionCommand,
  shellQuote,
  sleepSessionCommand,
  wakeSessionCommand,
} from '../commands/ghostexCli';
import {
  CHATS_PROJECT_KEY,
  projectKeyForSession,
  type ProjectHeaderItem,
  type SessionItem,
} from '../contract/grouping';
import {
  displayStatus,
  formatLastActive,
  type GhostexQuickAction,
  type GhostexSession,
} from '../contract/mobileSummary';
import { ProgressCopy, RenameCopy, SessionCopy, StateCardCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { machineDisplayLabel, selectedMachine, useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { attachSessionKey, useTerminalStore } from '../terminal/sessions';
import { GhostexPalette, GhostexRadii } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

type SessionContext = { machine: MachineRecord; item: SessionItem };
type ProjectContext = { machine: MachineRecord; header: ProjectHeaderItem };

type Overlay =
  | { kind: 'none' }
  | { kind: 'sessionMenu'; ctx: SessionContext }
  | { kind: 'sessionDetails'; ctx: SessionContext }
  | { kind: 'rename'; ctx: SessionContext; error: string | null }
  | { kind: 'killConfirm'; ctx: SessionContext }
  | { kind: 'copyText'; title: string; text: string }
  | { kind: 'projectMenu'; ctx: ProjectContext }
  | { kind: 'projectKillConfirm'; ctx: ProjectContext }
  | { kind: 'projectDetails'; ctx: ProjectContext }
  | { kind: 'recentProjects'; machine: MachineRecord }
  | { kind: 'recovery'; machine: MachineRecord | null };

const NONE: Overlay = { kind: 'none' };

/** `ssh -tt [-p port] user@host '<login-shell attach command>'` (§2 row 7). */
function attachSshCommand(machine: MachineRecord, session: GhostexSession): string {
  const portFlag = machine.port === 22 ? '' : ` -p ${machine.port}`;
  const remote = loginShellCommand(
    attachCommand(session.sessionId, session.projectId.length > 0 ? session.projectId : undefined),
  );
  return `ssh -tt${portFlag} ${machine.username}@${machine.host} ${shellQuote(remote)}`;
}

function sessionTitle(session: GhostexSession): string {
  return session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
}

export default function SessionsScreen({ navigation }: Props) {
  const machines = useMachinesStore((state) => state.machines);
  const machine = useMachinesStore((state) => selectedMachine(state));
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
  const refreshMachine = useInventoryStore((state) => state.refreshMachine);
  const refreshAll = useInventoryStore((state) => state.refreshAll);
  const startPolling = useInventoryStore((state) => state.startPolling);
  const stopPolling = useInventoryStore((state) => state.stopPolling);

  const collapse = useCollapseStore();
  const selectedSessionKey = useTerminalStore((state) => state.selectedSessionKey);

  const [overlay, setOverlay] = useState<Overlay>(NONE);
  const [progress, setProgress] = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const machineById = useCallback(
    (id: string): MachineRecord | null => machines.find((entry) => entry.id === id) ?? null,
    [machines],
  );

  const setTransientStatus = useCallback((message: string | null): void => {
    if (statusTimer.current !== null) {
      clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
    setStatusOverride(message);
    if (message !== null) {
      statusTimer.current = setTimeout(() => setStatusOverride(null), 6000);
    }
  }, []);

  // Poll every 5s only while this screen is focused AND a machine is selected.
  useFocusEffect(
    useCallback(() => {
      void useCollapseStore.getState().hydrate();
      if (machine !== null) startPolling();
      return () => stopPolling();
    }, [machine !== null, startPolling, stopPolling]),
  );

  const entries = useMemo(
    () =>
      buildDrawerList({
        machines,
        inventoriesByMachineId,
        collapse: {
          expandedProjectsByMachine: collapse.expandedProjectsByMachine,
          expandedCollectionsByMachine: collapse.expandedCollectionsByMachine,
          expandedGroupsByMachine: collapse.expandedGroupsByMachine,
          collapsedSessionListsByMachine: collapse.collapsedSessionListsByMachine,
          collapsedMachineIds: collapse.collapsedMachineIds,
        },
      }),
    [
      machines,
      inventoriesByMachineId,
      collapse.expandedProjectsByMachine,
      collapse.expandedCollectionsByMachine,
      collapse.expandedGroupsByMachine,
      collapse.collapsedSessionListsByMachine,
      collapse.collapsedMachineIds,
    ],
  );

  const selectedInventory = machine === null ? undefined : inventoriesByMachineId[machine.id];
  const statusLine = statusOverride ?? drawerStatusLine(machine, selectedInventory);
  const recentProjects = selectedInventory?.summary?.recentProjects ?? [];

  // -------------------------------------------------------------------------
  // Actions.
  // -------------------------------------------------------------------------

  const openTailscale = useCallback((): void => {
    Linking.openURL('tailscale://').catch(() => {
      void Linking.openURL('https://tailscale.com/download').catch(() => {
        // No handler available; nothing else to do.
      });
    });
  }, []);

  const attach = useCallback(
    async (target: MachineRecord, session: GhostexSession): Promise<void> => {
      setOverlay(NONE);
      setTransientStatus(ProgressCopy.preparingAttach(session.alias));
      try {
        const sessionKey = await useTerminalStore.getState().attachSession(target, {
          sessionId: session.sessionId,
          projectId: session.projectId.length > 0 ? session.projectId : undefined,
          title: sessionTitle(session),
        });
        setTransientStatus(ProgressCopy.attached(session.alias, machineDisplayLabel(target)));
        navigation.navigate('Terminal', {
          sessionKey,
          machineId: target.id,
          title: sessionTitle(session),
        });
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [navigation, setTransientStatus],
  );

  /** Attach a session that only exists as an id (creation flows, §6). */
  const attachCreated = useCallback(
    async (target: MachineRecord, sessionId: string): Promise<void> => {
      const created = useInventoryStore
        .getState()
        .inventoriesByMachineId[target.id]?.summary?.sessions.find(
          (session) => session.sessionId === sessionId,
        );
      const sessionKey = await useTerminalStore.getState().attachSession(target, {
        sessionId,
        projectId: created !== undefined && created.projectId.length > 0 ? created.projectId : undefined,
        title: created !== undefined ? sessionTitle(created) : undefined,
      });
      navigation.navigate('Terminal', {
        sessionKey,
        machineId: target.id,
        title: created !== undefined ? sessionTitle(created) : undefined,
      });
    },
    [navigation],
  );

  const runSessionCommand = useCallback(
    async (
      target: MachineRecord,
      command: string,
      options?: { closeWarmSessionId?: string },
    ): Promise<void> => {
      setOverlay(NONE);
      try {
        if (options?.closeWarmSessionId !== undefined) {
          await useTerminalStore.getState().closeWarmSessionFor(target.id, options.closeWarmSessionId);
        }
        await runGhostexCli(target, command);
        await refreshMachine(target);
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMachine, setTransientStatus],
  );

  /** Creation flow (§6): progress overlay → CLI → refresh → auto-attach. */
  const runCreationFlow = useCallback(
    async (target: MachineRecord, command: string, message: string): Promise<void> => {
      setOverlay(NONE);
      setProgress(message);
      try {
        const result = await runGhostexCli(target, command);
        await refreshMachine(target);
        setProgress(null);
        const sessionId = createdSessionId(result);
        if (sessionId !== null) {
          await attachCreated(target, sessionId);
        }
      } catch (error) {
        setProgress(null);
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [attachCreated, refreshMachine, setTransientStatus],
  );

  const fullReconnect = useCallback(async (): Promise<void> => {
    for (const target of machines) {
      try {
        await GhostexNative.disconnect(target.id);
      } catch {
        // Not connected is fine; refresh reconnects below.
      }
    }
    await refreshAll();
  }, [machines, refreshAll]);

  const submitRename = useCallback(
    async (ctx: SessionContext, value: string): Promise<void> => {
      const title = value.trim();
      if (title.length === 0) {
        setOverlay({ kind: 'rename', ctx, error: RenameCopy.emptyTitleError });
        return;
      }
      const { session } = ctx.item;
      await runSessionCommand(
        ctx.machine,
        renameSessionCommand(
          session.sessionId,
          title,
          session.projectId.length > 0 ? session.projectId : undefined,
        ),
      );
    },
    [runSessionCommand],
  );

  const runQuickAction = useCallback(
    (target: MachineRecord, projectId: string, projectTitle: string, action: GhostexQuickAction): void => {
      const name = action.name !== undefined && action.name.length > 0 ? action.name : action.actionType;
      if (action.actionType === 'browser') {
        const url = action.url ?? '';
        if (url.length === 0) return;
        void Linking.openURL(url)
          .then(() => setTransientStatus(ProgressCopy.openedInBrowser(name)))
          .catch(() => setTransientStatus(ProgressCopy.openedInBrowser(name)));
        return;
      }
      const commandId = action.commandId ?? '';
      if (commandId.length === 0) return;
      void runCreationFlow(
        target,
        runActionCommand(commandId, projectId),
        ProgressCopy.startingAgent(name, projectTitle),
      );
    },
    [runCreationFlow, setTransientStatus],
  );

  const restoreRecentProject = useCallback(
    async (target: MachineRecord, projectId: string, title: string): Promise<void> => {
      setOverlay(NONE);
      setTransientStatus(ProgressCopy.restoringProject(title));
      try {
        await runGhostexCli(target, restoreRecentProjectCommand(projectId));
        await refreshMachine(target);
        setTransientStatus(ProgressCopy.restoredProject(title));
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMachine, setTransientStatus],
  );

  const sessionsForProject = useCallback(
    (target: MachineRecord, header: ProjectHeaderItem): GhostexSession[] => {
      const summary = useInventoryStore.getState().inventoriesByMachineId[target.id]?.summary;
      if (summary === null || summary === undefined) return [];
      return summary.sessions.filter((session) => {
        const project = summary.projects.find((entry) => entry.projectId === session.projectId);
        const key =
          project !== undefined && project.isChat === true
            ? CHATS_PROJECT_KEY
            : projectKeyForSession(session);
        return key === header.projectKey;
      });
    },
    [],
  );

  const runProjectSessionsAction = useCallback(
    async (ctx: ProjectContext, action: 'wake' | 'sleep' | 'kill'): Promise<void> => {
      setOverlay(NONE);
      const sessions = sessionsForProject(ctx.machine, ctx.header);
      try {
        for (const session of sessions) {
          const projectId = session.projectId.length > 0 ? session.projectId : undefined;
          if (action === 'sleep' || action === 'kill') {
            await useTerminalStore.getState().closeWarmSessionFor(ctx.machine.id, session.sessionId);
          }
          const command =
            action === 'wake'
              ? wakeSessionCommand(session.sessionId, projectId)
              : action === 'sleep'
                ? sleepSessionCommand(session.sessionId, projectId)
                : killSessionCommand(session.sessionId, projectId);
          await runGhostexCli(ctx.machine, command);
        }
        await refreshMachine(ctx.machine);
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMachine, sessionsForProject, setTransientStatus],
  );

  // -------------------------------------------------------------------------
  // Menus.
  // -------------------------------------------------------------------------

  const sessionMenuItems = (ctx: SessionContext): ActionSheetItem[] => {
    const { session } = ctx.item;
    const projectId = session.projectId.length > 0 ? session.projectId : undefined;
    return [
      {
        key: 'attach',
        label: 'Attach',
        detail: 'Open this ZMX session in the terminal.',
        onPress: () => void attach(ctx.machine, session),
      },
      {
        key: 'focus',
        label: 'Focus on Mac',
        detail: 'Focus this session in the running Ghostex app.',
        onPress: () => void runSessionCommand(ctx.machine, focusSessionCommand(session.sessionId, projectId)),
      },
      {
        key: 'rename',
        label: 'Rename',
        detail: 'Update this session title in Ghostex.',
        onPress: () => setOverlay({ kind: 'rename', ctx, error: null }),
      },
      {
        key: 'wake',
        label: 'Wake',
        detail: 'Resume this persistent Ghostex session on the Mac.',
        onPress: () => void runSessionCommand(ctx.machine, wakeSessionCommand(session.sessionId, projectId)),
      },
      {
        key: 'sleep',
        label: 'Sleep',
        detail: 'Leave the session persistent but idle on the Mac.',
        onPress: () =>
          void runSessionCommand(ctx.machine, sleepSessionCommand(session.sessionId, projectId), {
            closeWarmSessionId: session.sessionId,
          }),
      },
      {
        key: 'kill',
        label: 'Kill',
        detail: 'Stop this remote session on the Mac.',
        destructive: true,
        onPress: () => setOverlay({ kind: 'killConfirm', ctx }),
      },
      {
        key: 'copy-attach',
        label: 'Copy attach command',
        detail: 'Copy the SSH command for this session.',
        onPress: () =>
          setOverlay({
            kind: 'copyText',
            title: 'Copy attach command',
            text: attachSshCommand(ctx.machine, session),
          }),
      },
      {
        key: 'refresh',
        label: 'Refresh sessions',
        detail: 'Reload the ZMX session list from the Mac.',
        onPress: () => {
          setOverlay(NONE);
          void refreshMachine(ctx.machine);
        },
      },
      {
        key: 'details',
        label: 'Details',
        onPress: () => setOverlay({ kind: 'sessionDetails', ctx }),
      },
    ];
  };

  const projectMenuItems = (ctx: ProjectContext): ActionSheetItem[] => {
    const { header } = ctx;
    const orderedHeaders = entries.filter(
      (entry) =>
        entry.machineId === ctx.machine.id &&
        entry.item.type === 'PROJECT_HEADER' &&
        !entry.item.isChatCollection,
    );
    const index = orderedHeaders.findIndex(
      (entry) => entry.item.type === 'PROJECT_HEADER' && entry.item.projectKey === header.projectKey,
    );
    const canMove = header.projectId.length > 0;
    return [
      {
        key: 'move-up',
        label: 'Move project up',
        disabled: !canMove || index <= 0,
        onPress: () =>
          void runSessionCommand(ctx.machine, moveProjectCommand(header.projectId, 'up')),
      },
      {
        key: 'move-down',
        label: 'Move project down',
        disabled: !canMove || index < 0 || index >= orderedHeaders.length - 1,
        onPress: () =>
          void runSessionCommand(ctx.machine, moveProjectCommand(header.projectId, 'down')),
      },
      {
        key: 'refresh',
        label: 'Refresh sessions',
        onPress: () => {
          setOverlay(NONE);
          void refreshMachine(ctx.machine);
        },
      },
      {
        key: 'wake',
        label: 'Wake project sessions',
        onPress: () => void runProjectSessionsAction(ctx, 'wake'),
      },
      {
        key: 'sleep',
        label: 'Sleep project sessions',
        onPress: () => void runProjectSessionsAction(ctx, 'sleep'),
      },
      {
        key: 'kill',
        label: 'Kill project sessions',
        destructive: true,
        onPress: () => setOverlay({ kind: 'projectKillConfirm', ctx }),
      },
      {
        key: 'copy-path',
        label: 'Copy project path',
        onPress: () =>
          setOverlay({ kind: 'copyText', title: 'Copy project path', text: header.projectPath }),
      },
      {
        key: 'details',
        label: 'Details',
        onPress: () => setOverlay({ kind: 'projectDetails', ctx }),
      },
    ];
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
        openTailscale();
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
      label: 'Add SSH machine',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('MachineForm');
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

  // -------------------------------------------------------------------------
  // Rendering.
  // -------------------------------------------------------------------------

  /** Colored left rail for rows nested inside an expanded collection. */
  const withCollectionRail = (
    node: ReactElement,
    collectionColor: string | undefined,
    listKey: string,
  ): ReactElement => {
    if (collectionColor === undefined) return node;
    return (
      <View
        key={listKey}
        style={[styles.collectionChild, { borderLeftColor: collectionRailColor(collectionColor) }]}
      >
        {node}
      </View>
    );
  };

  const renderEntry = ({ item: listEntry }: { item: DrawerListEntry }) => {
    const { item, machineId } = listEntry;
    const itemMachine = machineById(machineId);
    switch (item.type) {
      case 'STATE_CARD':
        return (
          <StateCard
            title={item.title}
            body={item.body}
            actionHint={item.actionHint}
            onPress={() => setOverlay({ kind: 'recovery', machine: itemMachine })}
          />
        );
      case 'MACHINE_HEADER':
        return (
          <MachineHeaderRow
            title={item.title}
            collapsed={item.collapsed}
            onPress={() => collapse.toggleMachine(item.machineId)}
          />
        );
      case 'COLLECTION_HEADER':
        return (
          <CollectionHeaderRow
            title={item.title}
            color={item.color}
            collapsed={item.collapsed}
            workingCount={item.workingCount}
            attentionCount={item.attentionCount}
            awakeCount={item.awakeCount}
            onPress={() => collapse.toggleCollection(machineId, item.collectionId)}
          />
        );
      case 'PROJECT_HEADER':
        return withCollectionRail(
          <ProjectHeaderRow
            title={item.title}
            collapsed={item.collapsed}
            isChatCollection={item.isChatCollection}
            workingCount={item.workingCount}
            attentionCount={item.attentionCount}
            awakeCount={item.awakeCount}
            showMenu={!item.isChatCollection}
            onToggle={() => collapse.toggleProject(machineId, item.projectKey)}
            onCreate={() => {
              if (itemMachine === null) return;
              if (item.isChatCollection) {
                void runCreationFlow(itemMachine, createChatCommand(), ProgressCopy.creatingQuickSession);
                return;
              }
              void runCreationFlow(
                itemMachine,
                createSessionCommand({
                  projectId: item.projectId.length > 0 ? item.projectId : undefined,
                  groupId:
                    item.projectId.length === 0 && item.legacyGroupId.length > 0
                      ? item.legacyGroupId
                      : undefined,
                }),
                ProgressCopy.creatingTerminal(item.title),
              );
            }}
            onMenu={() => {
              if (itemMachine === null) return;
              setOverlay({ kind: 'projectMenu', ctx: { machine: itemMachine, header: item } });
            }}
          />,
          item.collectionColor,
          listEntry.listKey,
        );
      case 'PROJECT_AGENTS_ROW':
        return withCollectionRail(
          <ProjectAgentsRow
            agents={item.agents}
            quickActions={item.quickActions}
            onAgentPress={(agent) => {
              if (itemMachine === null) return;
              if (item.projectId.length === 0) {
                setTransientStatus(ProgressCopy.noStableProjectId);
                return;
              }
              const agentName = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
              void runCreationFlow(
                itemMachine,
                createAgentCommand(agent.agentId, item.projectId),
                ProgressCopy.startingAgent(agentName, item.projectTitle),
              );
            }}
            onQuickActionPress={(action) => {
              if (itemMachine === null) return;
              runQuickAction(itemMachine, item.projectId, item.projectTitle, action);
            }}
          />,
          item.collectionColor,
          listEntry.listKey,
        );
      case 'PROJECT_EMPTY':
        return withCollectionRail(
          <ProjectEmptyRow text={item.text} />,
          item.collectionColor,
          listEntry.listKey,
        );
      case 'GROUP_HEADER':
        return withCollectionRail(
          <GroupHeaderRow
            title={item.title}
            count={item.count}
            collapsed={item.collapsed}
            onPress={() => collapse.toggleGroup(machineId, item.groupCollapseKey)}
          />,
          item.collectionColor,
          listEntry.listKey,
        );
      case 'SESSION': {
        const active = selectedSessionKey === attachSessionKey(machineId, item.session.sessionId);
        return withCollectionRail(
          <SessionRow
            session={item.session}
            active={active}
            onPress={() => {
              if (itemMachine !== null) void attach(itemMachine, item.session);
            }}
            onLongPress={() => {
              if (itemMachine === null) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              setOverlay({ kind: 'sessionMenu', ctx: { machine: itemMachine, item } });
            }}
          />,
          item.collectionColor,
          listEntry.listKey,
        );
      }
      case 'SESSION_LIST_TOGGLE':
        return withCollectionRail(
          <SessionListToggleRow
            label={item.label}
            collapsed={item.collapsed}
            onPress={() => collapse.toggleSessionList(machineId, item.projectKey)}
          />,
          item.collectionColor,
          listEntry.listKey,
        );
      default:
        return null;
    }
  };

  const refreshing = selectedInventory?.refreshing === true;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Ghostex</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          style={styles.headerButton}
          onPress={() => void fullReconnect()}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={GhostexPalette.FOREGROUND} />
          ) : (
            <RefreshGlyph size={22} color={GhostexPalette.FOREGROUND} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Machines"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Machines')}
        >
          <MachinesGlyph size={22} color={GhostexPalette.FOREGROUND} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <SettingsGlyph size={22} color={GhostexPalette.FOREGROUND} />
        </Pressable>
      </View>
      <Text style={styles.statusLine} numberOfLines={2}>
        {statusLine}
      </Text>
      {recentProjects.length > 0 && machine !== null ? (
        <Pressable
          accessibilityRole="button"
          style={styles.recentButton}
          onPress={() => setOverlay({ kind: 'recentProjects', machine })}
        >
          <Text style={styles.recentButtonLabel}>Recent Projects</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.listKey}
        renderItem={renderEntry}
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />

      <ProgressOverlay visible={progress !== null} message={progress ?? ''} />

      {overlay.kind === 'sessionMenu' ? (
        <ActionSheet
          visible
          title={sessionTitle(overlay.ctx.item.session)}
          subtitle={`Session ${overlay.ctx.item.session.alias} · ${displayStatus(overlay.ctx.item.session)}`}
          items={sessionMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'sessionDetails' ? (
        <DetailsSheet
          visible
          title={sessionTitle(overlay.ctx.item.session)}
          subtitle="Remote session metadata from the Ghostex CLI."
          entries={[
            { label: 'Machine', value: machineDisplayLabel(overlay.ctx.machine) },
            { label: 'Project', value: overlay.ctx.item.projectTitle },
            { label: 'Project path', value: overlay.ctx.item.projectPath },
            { label: 'Status', value: displayStatus(overlay.ctx.item.session) },
            { label: 'Focused on Mac', value: overlay.ctx.item.session.isFocused ? 'Yes' : 'No' },
            {
              label: 'Last active',
              value: formatLastActive(
                overlay.ctx.item.session.lastInteractionAt.length > 0
                  ? overlay.ctx.item.session.lastInteractionAt
                  : overlay.ctx.item.session.lastActiveAt,
                new Date(),
              ),
            },
            { label: 'Provider', value: 'zmx' },
            {
              label: 'ZMX session',
              value:
                overlay.ctx.item.session.zmxName.length > 0
                  ? overlay.ctx.item.session.zmxName
                  : overlay.ctx.item.session.providerSessionName,
            },
            {
              label: 'Agent',
              value:
                overlay.ctx.item.session.agentName.length > 0
                  ? overlay.ctx.item.session.agentName
                  : overlay.ctx.item.session.agent,
            },
            { label: 'Session id', value: overlay.ctx.item.session.sessionId },
          ]}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'rename' ? (
        <PromptDialog
          visible
          title={RenameCopy.title}
          body={RenameCopy.body}
          placeholder={RenameCopy.inputHint}
          initialValue={overlay.ctx.item.session.title}
          error={overlay.error}
          confirmLabel="Rename"
          onSubmit={(value) => void submitRename(overlay.ctx, value)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'killConfirm' ? (
        <ConfirmDialog
          visible
          title="Kill remote session?"
          body="This stops the selected Ghostex session on the connected machine."
          targetLine={`${overlay.ctx.item.session.alias} · ${sessionTitle(overlay.ctx.item.session)}`}
          confirmLabel="Kill"
          destructive
          onConfirm={() =>
            void runSessionCommand(
              overlay.ctx.machine,
              killSessionCommand(
                overlay.ctx.item.session.sessionId,
                overlay.ctx.item.session.projectId.length > 0
                  ? overlay.ctx.item.session.projectId
                  : undefined,
              ),
              { closeWarmSessionId: overlay.ctx.item.session.sessionId },
            )
          }
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'copyText' ? (
        <ConfirmDialog
          visible
          title={overlay.title}
          body={overlay.text}
          selectableBody
          confirmLabel="Close"
          cancelLabel={null}
          onConfirm={() => setOverlay(NONE)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'projectMenu' ? (
        <ActionSheet
          visible
          title={overlay.ctx.header.title}
          subtitle={`${overlay.ctx.header.sessionCount} ZMX session(s)`}
          items={projectMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'projectKillConfirm' ? (
        <ConfirmDialog
          visible
          title="Kill project sessions?"
          body={`This stops ${overlay.ctx.header.sessionCount} Ghostex sessions in this project on the connected machine.`}
          confirmLabel="Kill"
          destructive
          onConfirm={() => void runProjectSessionsAction(overlay.ctx, 'kill')}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'projectDetails' ? (
        <DetailsSheet
          visible
          title={overlay.ctx.header.title}
          subtitle="Project summary from the remote sidebar list."
          entries={[
            { label: 'Path', value: overlay.ctx.header.projectPath },
            { label: 'Sessions', value: String(overlay.ctx.header.sessionCount) },
            { label: 'Working', value: String(overlay.ctx.header.workingCount) },
            { label: 'Attention', value: String(overlay.ctx.header.attentionCount) },
            { label: 'Sleeping', value: String(overlay.ctx.header.sleepingCount) },
          ]}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'recentProjects' ? (
        <ActionSheet
          visible
          title="Recent Projects"
          subtitle="Choose a parked project to restore to the active sidebar."
          items={recentProjects.map((project) => {
            const title =
              project.title !== undefined && project.title.length > 0
                ? project.title
                : project.projectId;
            return {
              key: project.projectId,
              label: title,
              detail: `${project.path ?? ''} · ${project.sessionCount ?? 0} session(s)`,
              onPress: () => void restoreRecentProject(overlay.machine, project.projectId, title),
            };
          })}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'recovery' ? (
        <ActionSheet
          visible
          title={
            overlay.machine !== null
              ? machineDisplayLabel(overlay.machine)
              : StateCardCopy.noMachines.title
          }
          items={recoveryItems(overlay.machine)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    color: GhostexPalette.FOREGROUND,
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerButton: {
    width: 48,
    height: 48,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderRadius: GhostexRadii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLine: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 4,
  },
  recentButton: {
    marginTop: 8,
    height: 44,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentButtonLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    marginTop: 12,
  },
  listContent: {
    paddingBottom: 24,
  },
  collectionChild: {
    borderLeftWidth: 2,
    marginLeft: 2,
    paddingLeft: 5,
  },
});
