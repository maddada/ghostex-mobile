/**
 * Sidebar extensions on the phone's sessions screen: the selected computer's extension modes (a header button each,
 * which swaps the project list for the extension's panel, as the desktop's top-row button does), the sections an
 * extension adds above and below the projects, and what their items do.
 *
 * Built-in actions run here, checked against the permissions the user granted on the computer: open a project (its
 * newest session), open a session, start an agent (with the panel's draft staged in its input), open an https link.
 * An `extension` action and a checklist's edits go to the computer (`/api/extensionPanelAction` over the chat link),
 * which applies the edit and tells the extension; the new panel arrives with the next sessions list, and a tick shows
 * at once until it does. Side panel views are not drawn on the phone: they belong to the computer's work area, and the
 * phone's session screen has no side panel to hold them.
 *
 * CDXC:Extensions 2026-11-14 DECISION:
 * Q27, user: "just desktop and mobile for now please". The phone draws a sidebar extension's own mode, its sections in
 * the Project list and its 7 blocks from the sessions list's optional `extensionPanels`; a computer that sends none
 * draws nothing new. The Settings switches for the mode and the sections live on the computer, which leaves them out
 * of what it sends.
 * SEE-ALSO: apps/desktop/src/app/native_sidebar/extension_panel/ (the desktop's twin), contract/extensionPanels.ts.
 */

import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { chatMachineLink } from '../chat/rust/machine-link';
import { createAgentCommand } from '../commands/ghostexCli';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '../components/sessions/ContextMenu';
import PromptDialog from '../components/common/PromptDialog';
import SegmentedStrip from '../components/common/SegmentedStrip';
import { ArrowGlyph, PencilGlyph, TrashGlyph } from '../components/sessions/icons';
import { ds, useSidebarInk } from '../components/sessions/rows';
import { rowActivityIndicator } from '../components/sessions/sessionStatus';
import { projectHeaderOf, type ProjectHeaderItem, type SessionItem } from '../contract/grouping';
import {
  actionAllowed,
  blocksOfTab,
  extensionModes,
  extensionSections,
  permissionLabel,
  requiredPermission,
  resolvePanelProject,
  selectedTab,
  type ChecklistItem,
  type ExtensionPanelEntry,
  type PanelAction,
  type PanelMenuItem,
  type PanelRow,
} from '../contract/extensionPanels';
import {
  hasQuestion,
  visibleSessions,
  type GhostexAgentLauncher,
  type GhostexMobileSummary,
  type GhostexSession,
} from '../contract/mobileSummary';
import { ProgressCopy } from '../copy';
import type { MachineInventory } from '../inventory/store';
import type { MachineRecord } from '../machines/store';
import { sessionItemOf } from '../screens/sessions-screen/use-unified-list';
import { SidebarPalette } from '../theme/palette';
import PanelBlockView, { type PanelHandlers, type PanelPlace, type PanelRefFacts } from './PanelBlockView';
import { PanelIcon, hasPanelIcon } from './panelIcons';

const RPC_TIMEOUT_MS = 15_000;

export type ExtensionPanelsDeps = {
  machine: MachineRecord | null;
  machineById: (machineId: string) => MachineRecord | null;
  inventoriesByMachineId: Record<string, MachineInventory>;
  attach: (target: MachineRecord, session: GhostexSession) => Promise<void>;
  launchAgent: (target: MachineRecord, header: ProjectHeaderItem, agent: GhostexAgentLauncher) => void;
  resolvePrimaryAgent: (header: ProjectHeaderItem) => GhostexAgentLauncher | null;
  runCreationFlow: (target: MachineRecord, command: string, message: string) => Promise<unknown>;
  openSessionMenu: (target: MachineRecord, item: SessionItem) => void;
  openProjectMenu: (target: MachineRecord, header: ProjectHeaderItem) => void;
  notify: (title: string, message: string) => void;
  refreshMachineFresh: (target: MachineRecord) => Promise<void>;
};

type Menu = { title: string; items: ContextMenuItem[]; anchor: MenuAnchor };
type Prompt = { title: string; initial: string; confirm: string; submit: (text: string) => void };
type Pending = { done: boolean; revision: number };

function pendingKey(place: PanelPlace, blockId: string, itemId: string): string {
  return `${place.machineId}|${place.extensionId}|${blockId}|${itemId}`;
}

/** A session's dot as its row in the list draws it (sessionStatus.ts), for a `session` item. */
function sessionDot(session: GhostexSession): string | null {
  switch (rowActivityIndicator(session)) {
    case 'approval':
      return SidebarPalette.ROW_APPROVAL;
    case 'failed':
      return SidebarPalette.ROW_FAILED;
    default:
      break;
  }
  if (hasQuestion(session.pendingQuestionCount, session.awaitingAnswer)) return SidebarPalette.ROW_QUESTION;
  if (session.activity === 'working') return SidebarPalette.ROW_WORKING;
  if (session.activity === 'attention') return SidebarPalette.ROW_ATTENTION;
  return null;
}

/** A project's dot: its most urgent session's (approval, question, attention, working), as the desktop item draws it. */
function projectDot(sessions: readonly GhostexSession[]): string | null {
  if (sessions.some((session) => session.awaitingApproval)) return SidebarPalette.ROW_APPROVAL;
  if (sessions.some((session) => hasQuestion(session.pendingQuestionCount, session.awaitingAnswer))) {
    return SidebarPalette.ROW_QUESTION;
  }
  if (sessions.some((session) => session.activity === 'attention')) return SidebarPalette.ROW_ATTENTION;
  if (sessions.some((session) => session.activity === 'working')) return SidebarPalette.ROW_WORKING;
  return null;
}

function sessionTitle(session: GhostexSession): string {
  return session.displayTitle || session.title || 'Session';
}

function newestSession(sessions: readonly GhostexSession[]): GhostexSession | null {
  let newest: GhostexSession | null = null;
  for (const session of sessions) {
    if (newest === null || session.lastInteractionAt > newest.lastInteractionAt) newest = session;
  }
  return newest;
}

export function useExtensionPanels(deps: ExtensionPanelsDeps) {
  const { machine, inventoriesByMachineId } = deps;
  const ink = useSidebarInk();
  const [mode, setMode] = useState<{ machineId: string; extensionId: string } | null>(null);
  const [tabs, setTabs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [menu, setMenu] = useState<Menu | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const summaryOf = useCallback(
    (machineId: string): GhostexMobileSummary | null => inventoriesByMachineId[machineId]?.summary ?? null,
    [inventoriesByMachineId],
  );
  const panels = machine === null ? null : (summaryOf(machine.id)?.extensionPanels ?? null);
  const modes = useMemo(() => extensionModes(panels), [panels]);
  // A mode the computer no longer offers (turned off, uninstalled, its mode switched off) goes back to the projects.
  const active =
    machine !== null && mode !== null && mode.machineId === machine.id
      ? (modes.find((entry) => entry.extensionId === mode.extensionId) ?? null)
      : null;

  const placeOf = useCallback(
    (machineId: string, entry: ExtensionPanelEntry): PanelPlace => ({
      machineId,
      extensionId: entry.extensionId,
      granted: entry.grantedPermissions,
      revision: entry.sidebar?.revision ?? 0,
    }),
    [],
  );

  const projectIdOf = useCallback(
    (machineId: string, reference: string): string | null => {
      const summary = summaryOf(machineId);
      return summary === null ? null : resolvePanelProject(reference, summary.projects);
    },
    [summaryOf],
  );

  const sendRpc = useCallback(
    async (place: PanelPlace, params: Record<string, unknown>): Promise<boolean> => {
      const target = deps.machineById(place.machineId);
      if (target === null) return false;
      const link = chatMachineLink(target);
      await link.route();
      const answer = await link.rpc(
        'extensionPanelAction',
        { extension: place.extensionId, surface: 'sidebar', ...params },
        RPC_TIMEOUT_MS,
      );
      if (answer.error !== null) {
        deps.notify("Panel didn't update", answer.error.message);
        return false;
      }
      void deps.refreshMachineFresh(target).catch(() => {});
      return true;
    },
    [deps],
  );

  const sendEdit = useCallback(
    (place: PanelPlace, blockId: string, edit: Record<string, unknown>): void => {
      void sendRpc(place, { blockId, edit }).catch((error: unknown) =>
        deps.notify("Panel didn't update", error instanceof Error ? error.message : String(error)),
      );
    },
    [deps, sendRpc],
  );

  const run = useCallback(
    (place: PanelPlace, blockId: string, itemId: string | undefined, action: PanelAction): void => {
      const target = deps.machineById(place.machineId);
      if (target === null) return;
      if (!actionAllowed(action, place.granted)) {
        deps.notify(
          'Extension not allowed',
          `${place.extensionId} needs “${permissionLabel(requiredPermission(action) ?? '')}”. Allow it in Settings > Extensions on the computer.`,
        );
        return;
      }
      const summary = summaryOf(place.machineId);
      switch (action.kind) {
        case 'openProject': {
          const projectId = projectIdOf(place.machineId, action.project);
          if (projectId === null || summary === null) {
            deps.notify('Project not found', `${action.project} isn't a project on this computer.`);
            return;
          }
          const newest = newestSession(
            visibleSessions(summary.sessions).filter((session) => session.projectId === projectId),
          );
          if (newest !== null) {
            void deps.attach(target, newest);
            return;
          }
          // No session to open: back to the projects, where its card offers New session.
          setMode(null);
          return;
        }
        case 'focusSession': {
          const [projectId, sessionId] = action.session.split(':');
          const session = summary?.sessions.find(
            (entry) => entry.projectId === projectId && entry.sessionId === sessionId,
          );
          if (session === undefined) {
            deps.notify('Session not found', "This session isn't on this computer anymore.");
            return;
          }
          void deps.attach(target, session);
          return;
        }
        case 'newAgent': {
          const projectId = projectIdOf(place.machineId, action.project);
          const header =
            projectId === null || summary === null
              ? null
              : projectHeaderOf(place.machineId, summary, projectId, { throughCollections: true });
          if (header === null) {
            deps.notify('Project not found', `${action.project} isn't a project on this computer.`);
            return;
          }
          const agent =
            (action.agent === undefined ? undefined : header.agents.find((entry) => entry.agentId === action.agent)) ??
            deps.resolvePrimaryAgent(header);
          if (agent === null) {
            deps.notify('No agent to start', 'Add an agent on the computer first.');
            return;
          }
          if (action.draft === undefined) {
            deps.launchAgent(target, header, agent);
            return;
          }
          // The draft waits in the new agent's input, not sent (`--first-input-draft`).
          const name = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
          void deps.runCreationFlow(
            target,
            createAgentCommand(agent.agentId, header.projectId, action.draft, false, true),
            ProgressCopy.startingAgent(name, header.title),
          );
          return;
        }
        case 'openUrl':
          // A loopback address is the computer's own, which this phone can't reach.
          if (!action.url.startsWith('https://')) {
            deps.notify('Opens on the computer', 'This link only works on the computer.');
            return;
          }
          void Linking.openURL(action.url).catch(() => {});
          return;
        case 'openView':
          deps.notify('Opens on the computer', 'This view is only on the computer.');
          return;
        case 'extension':
          void sendRpc(place, {
            blockId,
            action: action.name,
            ...(itemId === undefined ? {} : { itemId }),
            ...(action.data === undefined ? {} : { data: action.data }),
          }).catch((error: unknown) =>
            deps.notify("Panel didn't update", error instanceof Error ? error.message : String(error)),
          );
          return;
      }
    },
    [deps, projectIdOf, sendRpc, summaryOf],
  );

  const panelMenuItems = useCallback(
    (
      place: PanelPlace,
      blockId: string,
      itemId: string | undefined,
      items: readonly PanelMenuItem[] | undefined,
    ): ContextMenuItem[] =>
      (items ?? []).map((item, index): ContextMenuItem => {
        const row = {
          kind: 'item' as const,
          key: `panel-${index}`,
          label: item.title,
          disabled: !actionAllowed(item.action, place.granted),
          onPress: () => {
            setMenu(null);
            run(place, blockId, itemId, item.action);
          },
        };
        return hasPanelIcon(item.icon)
          ? { ...row, icon: <PanelIcon name={item.icon} size={14} color={ink.text} /> }
          : row;
      }),
    [ink.text, run],
  );

  const handlers: PanelHandlers = useMemo(
    () => ({
      run,
      rowMenu: (place, blockId, row: PanelRow, anchor) => {
        const target = deps.machineById(place.machineId);
        if (target === null) return;
        const own = panelMenuItems(place, blockId, row.id, row.menu);
        const summary = summaryOf(place.machineId);
        // The item's own Ghostex menu: the project's or the session's, as its row in the list has it.
        let ghostex: { label: string; open: () => void } | null = null;
        if (summary !== null && row.project !== undefined) {
          const projectId = resolvePanelProject(row.project, summary.projects);
          const header =
            projectId === null
              ? null
              : projectHeaderOf(place.machineId, summary, projectId, { throughCollections: true });
          if (header !== null) ghostex = { label: header.title, open: () => deps.openProjectMenu(target, header) };
        } else if (summary !== null && row.session !== undefined) {
          const [projectId, sessionId] = row.session.split(':');
          const session = summary.sessions.find(
            (entry) => entry.projectId === projectId && entry.sessionId === sessionId,
          );
          if (session !== undefined) {
            ghostex = {
              label: sessionTitle(session),
              open: () => deps.openSessionMenu(target, sessionItemOf(target.id, session, summary)),
            };
          }
        }
        if (own.length === 0) {
          ghostex?.open();
          return;
        }
        const items: ContextMenuItem[] = [...own];
        if (ghostex !== null) {
          const open = ghostex.open;
          items.push({ kind: 'separator', key: 'ghostex-separator' });
          items.push({
            kind: 'item',
            key: 'ghostex-menu',
            label: row.project !== undefined ? 'Project options' : 'Session options',
            submenu: true,
            onPress: () => {
              setMenu(null);
              open();
            },
          });
        }
        setMenu({ title: row.title ?? ghostex?.label ?? '', items, anchor });
      },
      itemMenu: (place, blockId, item: ChecklistItem, editable, anchor) => {
        const items = panelMenuItems(place, blockId, item.id, item.menu);
        if (editable) {
          if (items.length > 0) items.push({ kind: 'separator', key: 'edit-separator' });
          items.push({
            kind: 'item',
            key: 'rename',
            label: 'Rename',
            icon: <PencilGlyph size={14} color={ink.text} />,
            onPress: () => {
              setMenu(null);
              setPrompt({
                title: 'Rename item',
                initial: item.text,
                confirm: 'Rename',
                submit: (text) => sendEdit(place, blockId, { op: 'rename', itemId: item.id, text }),
              });
            },
          });
          items.push({
            kind: 'item',
            key: 'delete',
            label: 'Delete',
            destructive: true,
            icon: <TrashGlyph size={14} color={SidebarPalette.ROW_FAILED} />,
            onPress: () => {
              setMenu(null);
              sendEdit(place, blockId, { op: 'delete', itemId: item.id });
            },
          });
        }
        if (items.length > 0) setMenu({ title: item.text, items, anchor });
      },
      check: (place, blockId, item, done) => {
        setPending((current) => ({
          ...current,
          [pendingKey(place, blockId, item.id)]: { done, revision: place.revision },
        }));
        sendEdit(place, blockId, { op: 'check', itemId: item.id, done });
      },
      add: (place, blockId) =>
        setPrompt({
          title: 'Add item',
          initial: '',
          confirm: 'Add',
          submit: (text) => sendEdit(place, blockId, { op: 'add', text }),
        }),
      done: (place, blockId, item) => {
        const tick = pending[pendingKey(place, blockId, item.id)];
        // Until the computer's next panel arrives (a new revision), the tap just made shows.
        return tick !== undefined && tick.revision === place.revision ? tick.done : item.done;
      },
      project: (place, reference): PanelRefFacts | null => {
        const summary = summaryOf(place.machineId);
        const projectId = summary === null ? null : resolvePanelProject(reference, summary.projects);
        const project =
          projectId === null ? undefined : summary?.projects.find((entry) => entry.projectId === projectId);
        if (summary === null || project === undefined) return null;
        const sessions = visibleSessions(summary.sessions).filter((session) => session.projectId === project.projectId);
        return { title: project.name || reference, dot: projectDot(sessions) };
      },
      session: (place, reference): PanelRefFacts | null => {
        const [projectId, sessionId] = reference.split(':');
        const session = summaryOf(place.machineId)?.sessions.find(
          (entry) => entry.projectId === projectId && entry.sessionId === sessionId,
        );
        return session === undefined ? null : { title: sessionTitle(session), dot: sessionDot(session) };
      },
    }),
    [deps, ink.text, panelMenuItems, pending, run, sendEdit, summaryOf],
  );

  /** The header's buttons, one per extension mode of the selected computer. */
  const modeButtons = (style: StyleProp<ViewStyle>, color: string): ReactNode =>
    machine === null
      ? null
      : modes.map((entry) => {
          const selected = active?.extensionId === entry.extensionId;
          const title = entry.sidebar!.mode!.title;
          return (
            <Pressable
              key={entry.extensionId}
              accessibilityRole="button"
              accessibilityLabel={selected ? 'Show projects' : `Show ${title}`}
              accessibilityState={{ selected }}
              style={style}
              onPress={() => setMode(selected ? null : { machineId: machine.id, extensionId: entry.extensionId })}
            >
              {selected ? (
                <ArrowGlyph size={22} color={color} direction="left" />
              ) : hasPanelIcon(entry.sidebar!.mode!.icon) ? (
                <PanelIcon name={entry.sidebar!.mode!.icon} size={22} color={color} />
              ) : (
                <View style={[styles.letter, { borderColor: color }]}>
                  <Text style={[styles.letterText, { color }]}>{title.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
            </Pressable>
          );
        });

  /** The extension's mode in the project list's place: its title, its tabs and the blocks of the tab. */
  const modeView = (refreshControl?: ReactElement): ReactElement | null => {
    if (active === null || machine === null) return null;
    const sidebar = active.sidebar!;
    const place = placeOf(machine.id, active);
    const tabKey = `${machine.id}|${active.extensionId}`;
    const tab = selectedTab(sidebar.document, tabs[tabKey]);
    const blocks = blocksOfTab(sidebar.document, tab);
    return (
      <ScrollView
        style={styles.mode}
        contentContainerStyle={styles.modeContent}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.modeTitle}>
          <PanelIcon name={sidebar.mode!.icon} size={ds(15)} color={ink.muted} />
          <Text style={[styles.modeTitleText, { color: ink.selectedText }]} numberOfLines={1}>
            {sidebar.document.title ?? sidebar.mode!.title}
          </Text>
        </View>
        {sidebar.document.tabs.length > 1 && tab !== null ? (
          <View style={styles.tabs}>
            <SegmentedStrip
              accessibilityLabel={`${active.title} tabs`}
              items={sidebar.document.tabs.map((entry) => ({ key: entry.id, label: entry.title }))}
              selected={tab}
              onSelect={(next) => setTabs((current) => ({ ...current, [tabKey]: next }))}
            />
          </View>
        ) : null}
        {blocks.length === 0 ? <Text style={[styles.nothing, { color: ink.muted }]}>Nothing here yet.</Text> : null}
        {blocks.map((block) => (
          <PanelBlockView key={block.id} block={block} place={place} handlers={handlers} />
        ))}
      </ScrollView>
    );
  };

  /** The sections above (`projectsTop`) or below (`projectsBottom`) the projects of the selected computer. */
  const sections = (where: 'projectsTop' | 'projectsBottom'): ReactElement | null => {
    if (machine === null) return null;
    const shown = extensionSections(panels, where);
    if (shown.length === 0) return null;
    return (
      <View style={where === 'projectsTop' ? styles.sectionsTop : styles.sectionsBottom}>
        {shown.map(({ entry, block }) => (
          <PanelBlockView
            key={`${entry.extensionId}:${block.id}`}
            block={block}
            place={placeOf(machine.id, entry)}
            handlers={handlers}
          />
        ))}
      </View>
    );
  };

  const overlays = (
    <>
      {menu !== null ? (
        <ContextMenu
          visible
          title={menu.title}
          items={menu.items}
          rowAnchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {prompt !== null ? (
        <PromptDialog
          visible
          title={prompt.title}
          placeholder="Item"
          initialValue={prompt.initial}
          confirmLabel={prompt.confirm}
          onSubmit={(value) => {
            const text = value.trim();
            setPrompt(null);
            if (text.length > 0) prompt.submit(text);
          }}
          onCancel={() => setPrompt(null)}
        />
      ) : null}
    </>
  );

  return { active: active !== null, modeButtons, modeView, sections, overlays };
}

const styles = StyleSheet.create({
  mode: {
    flex: 1,
  },
  modeContent: {
    paddingHorizontal: ds(8),
    paddingBottom: ds(24),
  },
  modeTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(8),
    height: ds(34),
    paddingHorizontal: ds(5),
  },
  modeTitleText: {
    flex: 1,
    fontSize: ds(15.55),
    fontWeight: '500',
  },
  tabs: {
    paddingBottom: ds(8),
  },
  nothing: {
    paddingHorizontal: ds(8),
    paddingVertical: ds(6),
  },
  sectionsTop: {
    paddingBottom: ds(6),
  },
  sectionsBottom: {
    paddingTop: ds(10),
  },
  /* An extension whose icon the phone can't draw: its first letter in a small outlined square. */
  letter: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
