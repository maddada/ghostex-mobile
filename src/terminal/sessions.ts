import { remoteTerminalCommand, remoteShellCommand } from '../remote/commands';
/**
 * Terminal tab/session orchestration.
 * - sessionKey = `${machineId}:${sessionId}` for attach tabs,
 *   `${machineId}:tab:${uuid}` for plain shells (docs/ARCHITECTURE.md).
 * - Warm-session policy: up to 7 native terminal entries stay alive, fewer when
 *   their scrollback would pass the shared budget (./warmBudget.ts); the least
 *   recently used entry that is not on screen (the selected one, the pane beside it) is evicted via closeTerminal.
 * - Attach flow (sessions-drawer.md §5 / terminal-screen.md §6): connect if
 *   needed → openTerminal with the login-shell-wrapped attach command → ~2s
 *   after the entry first opens, refresh the native viewport once.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { attachCommand } from '../commands/ghostexCli';
import { ensureConnected } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import { useSettingsStore, type PreferredAgentInterface } from '../settings/store';
import {
  moveTab,
  openSplit,
  splitOrder,
  splitSuccessor,
  splitView,
  syncSplit,
  type TabDrop,
  type TabSplit,
} from './tabSplit';
import { warmPoolOverBudget } from './warmBudget';
import { forgetAttach, noteAttachOpened } from './zmxDisplay';
import { isDemoMachineId } from '../demo/identity';
import { logAppEvent } from '../app/appLog';
import { FailureCopy } from '../copy';
import { isChannelRefusal, reportChannelRefused } from '../remote/channelBudget';
import { isSlowOpenFailure, noteSlowOpenFailure } from '../remote/stallWatch';
import { clearDialBackoff } from '../remote/dialBackoff';

const tabOpenRequests = new Map<string, Promise<unknown>>();
/** Scrollback rows each warm native entry was opened with (the setting applies to new terminals only). */
const warmScrollbackRows = new Map<string, number>();

/** The scrollback setting for a terminal being opened now, remembered for the warm budget. */
function scrollbackRowsForNewTerminal(sessionKey: string): number {
  const rows = useSettingsStore.getState().settings.scrollbackRows;
  warmScrollbackRows.set(sessionKey, rows);
  return rows;
}

/**
 * A terminal that failed to open on a live connection fails alone (the native open deadline no
 * longer retires the connection, so the session's chat keeps working). The connection is probed
 * in the background instead and replaced only when it no longer answers, which recovers a wedged
 * transport the way the old teardown did.
 */
function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'error';
}

/**
 * A terminal the computer refused a channel for says so in plain words, and the refusal goes to the escape path
 * (src/remote/channelPressure.ts); any other failure keeps its own message. An open that failed only after the stall
 * watch's wait is the iPhone's stuck connection, not a refusal: it goes to the stall watch instead
 * (src/remote/stallWatch.ts), so terminals are not detached for it.
 */
function terminalOpenError(machineId: string, error: unknown, openStartedAt: number | null): string {
  if (isChannelRefusal(error) && openStartedAt !== null && isSlowOpenFailure(openStartedAt)) {
    noteSlowOpenFailure(machineId, Date.now() - openStartedAt);
    return error instanceof Error ? error.message : String(error);
  }
  if (isChannelRefusal(error)) {
    reportChannelRefused(machineId);
    return FailureCopy.channelsBusy;
  }
  return error instanceof Error ? error.message : String(error);
}

function verifyAfterFailedOpen(machine: MachineConnectionTarget): void {
  void ensureConnected(machine, { verify: true, reason: 'a terminal that failed to open' }).catch(() => undefined);
}

function trackTabOpen<T>(sessionKey: string, work: () => Promise<T>): Promise<T> {
  const request = Promise.resolve().then(work);
  tabOpenRequests.set(sessionKey, request);
  const clear = () => {
    if (tabOpenRequests.get(sessionKey) === request) tabOpenRequests.delete(sessionKey);
  };
  void request.then(clear, clear);
  return request;
}

/**
 * CDXC:RemoteMachines 2026-10-06 SEE-ALSO:
 * Each warm terminal holds one session channel on the machine's shared SSH connection, and OpenSSH allows 10 by default; the other three are two command slots (commands and uploads) and the connection check's lane, on both platforms (`COMMAND_CHANNEL_SLOTS` in src/remote/channelBudget.ts and modules/ghostex-native/android/.../GhostexSshConnection.kt, `commandSlots` in modules/ghostex-native/ios/SSH/SSHConnection.swift). Change them together.
 */
export const MAX_WARM_SESSIONS = 7;
/**
 * Delay before the one-shot native viewport refresh after an attach opens.
 */
export const ATTACH_VIEWPORT_REFRESH_DELAY_MS = 2000;

const FONT_SIZES_STORAGE_KEY = 'terminal.fontSizes.v1';
const SESSION_VIEW_MODES_STORAGE_KEY = 'terminal.sessionViewModes.v1';
/** Pre-Default-Agent-View persistence: a plain array of chat-mode session keys. */
const LEGACY_CHAT_MODE_STORAGE_KEY = 'terminal.chatMode.v1';

export type TerminalTabKind = 'attach' | 'shell';
/**
 * `detached`: an attach tab opened in Chat View that has no terminal yet. It holds no SSH channel
 * and runs no `ghostex attach`; the first switch to its Terminal view attaches it
 * (`ensureTerminalAttached`).
 */
export type TerminalTabState = 'detached' | 'opening' | 'open' | 'closed' | 'failed';

export type TerminalTab = {
  sessionKey: string;
  machineId: string;
  title: string;
  kind: TerminalTabKind;
  /** Stable Ghostex session id (attach tabs only). */
  ghostexSessionId?: string;
  /**
   * Owning gxserver project (attach tabs only), remembered from the row the
   * tab was opened from. `ghostex attach` and the keep-awake lease both take
   * project-scoped selectors, so keeping it here spares every later call a
   * daemon-side lookup of a bare session id — and keeps a reattach targeting
   * the same project the first attach did.
   */
  ghostexProjectId?: string;
  /** Launcher identity available before the inventory catches up with creation. */
  ghostexAgentId?: string;
  /** Starting directory for shell tabs (unset → login-shell default, ~). */
  cwd?: string;
  state: TerminalTabState;
  error?: string;
};

export function attachSessionKey(machineId: string, sessionId: string): string {
  return `${machineId}:${sessionId}`;
}

function randomTabId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** One-shot guard so the native viewport refresh runs at most once per open entry. */
const zmxRefreshSent = new Set<string>();
const zmxRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelZmxRefresh(sessionKey: string): void {
  const timer = zmxRefreshTimers.get(sessionKey);
  if (timer !== undefined) {
    clearTimeout(timer);
    zmxRefreshTimers.delete(sessionKey);
  }
}

function scheduleZmxRefresh(sessionKey: string): void {
  if (zmxRefreshSent.has(sessionKey) || zmxRefreshTimers.has(sessionKey)) return;
  const timer = setTimeout(() => {
    zmxRefreshTimers.delete(sessionKey);
    if (zmxRefreshSent.has(sessionKey)) return;
    zmxRefreshSent.add(sessionKey);
    void GhostexNative.refreshTerminalViewport(sessionKey).catch(() => {
      // The entry may have closed while the timer was pending.
    });
  }, ATTACH_VIEWPORT_REFRESH_DELAY_MS);
  zmxRefreshTimers.set(sessionKey, timer);
}

type TerminalState = {
  hydrated: boolean;
  tabs: TerminalTab[];
  selectedSessionKey: string | null;
  /**
   * The session the second pane shows beside the selected one (the active pane's), while two session panes are on
   * the terminal screen, and the session beside the chooser from a pick until the pick is selected; null otherwise.
   * Its terminal is as protected from eviction as the selected one's, and when the selected tab closes it takes over
   * the selection.
   */
  paneSessionKey: string | null;
  /**
   * The chat's tabs side by side (`tabSplit.ts`): which tabs are on the right side and what each side shows; null while
   * they are on one side. Kept in step with the tabs and the selection by the store's own subscription below.
   */
  tabSplit: TabSplit | null;
  /** LRU of warm native entries, most recently used last. */
  warmOrder: string[];
  /** Per-session font size overrides, persisted. */
  fontSizeBySessionKey: Record<string, number>;
  /**
   * Per-tab chat/terminal view choice. Desktop-parity inherit semantics: a
   * session the user never flipped has no entry and follows the global
   * `preferredAgentInterface` setting (including later changes to it); an
   * explicit flip is persisted, so a session reopened after a restart (or
   * after its tab was closed) comes back in whichever view it last used.
   * Attach-tab keys are stable `${machineId}:${sessionId}`, so entries
   * survive restarts correctly.
   */
  sessionViewModeBySessionKey: Record<string, PreferredAgentInterface>;
  /**
   * The unsent text of each session's text editor (the command pad's pen), in memory only: closing the editor,
   * however it closes, switching sessions or leaving the terminal screen keeps it, Send empties it, and a restart
   * starts without it. A session without a draft has no entry.
   */
  textEditorDraftBySessionKey: Record<string, string>;

  hydrate: () => Promise<void>;
  /**
   * Open (or re-select) an attach tab for a remote Ghostex session. `select: false` opens it without changing the
   * selection (a stored pane's session coming back beside the selected one). `current`, when given, is checked
   * after any existing opening finishes so an obsolete notification tap selects nothing.
   */
  attachSession: (
    machine: MachineConnectionTarget,
    session: { sessionId: string; projectId?: string; title?: string; agentId?: string },
    options?: { select?: boolean; current?: () => boolean },
  ) => Promise<string>;
  /**
   * Open (or re-select) a session's tab for its Chat View without attaching its terminal. A tab
   * that already has a terminal keeps it.
   */
  openChatTab: (
    machine: MachineConnectionTarget,
    session: { sessionId: string; projectId?: string; title?: string },
  ) => string;
  /** Attach a `detached` tab's terminal (its first switch to the Terminal view). */
  ensureTerminalAttached: (sessionKey: string) => Promise<void>;
  /** Open an interactive login-shell tab on a machine (in `cwd` when given). */
  openShellTab: (machine: MachineConnectionTarget, options?: { title?: string; cwd?: string }) => Promise<string>;
  /** `scrollToBottom: false` keeps the terminal where it is scrolled (a pane already on screen taking the focus). */
  selectTab: (sessionKey: string, options?: { scrollToBottom?: boolean }) => void;
  setPaneSessionKey: (sessionKey: string | null) => void;
  /** A held tab dropped in a tab bar: its new place, on that bar's side (`moveTab` in tabSplit.ts). */
  moveTab: (sessionKey: string, drop: TabDrop) => void;
  /** A held tab dropped on the chat's right half: it opens on a new right side, selected. */
  splitTab: (sessionKey: string) => void;
  /** The split's handle: every tab back in one bar, in the order the two bars showed them. */
  mergeTabs: () => void;
  /** Close a tab and its warm native entry. */
  closeTab: (sessionKey: string) => Promise<void>;
  /** Kill/sleep actions must also drop the warm surface for that session. */
  closeWarmSessionFor: (machineId: string, sessionId: string) => Promise<void>;
  /**
   * Frees channels on a computer that refused one: detaches its off-screen agent terminals, least recently used first,
   * until `keep` stay attached there. Their tabs stay and attach again when shown; plain shells and terminals on screen
   * are never touched. Returns how many it detached (src/remote/channelPressure.ts).
   */
  detachIdleTerminals: (machineId: string, keep: number) => Promise<number>;
  /**
   * Re-run the open flow for a failed/closed tab. Shared by the Terminal
   * screen's Retry/Reconnect buttons and the app-resume auto-reattach.
   */
  /** `dialNow` (default true) dials a computer waiting after unanswered dials; the automatic restore passes false. */
  reopenTab: (sessionKey: string, options?: { dialNow?: boolean }) => Promise<void>;
  setFontSizeForSession: (sessionKey: string, size: number) => void;
  /** Drop all pinch-zoom overrides and re-apply the global default everywhere. */
  clearFontSizeOverrides: () => void;
  /**
   * Effective view for one tab: its explicit choice when it has one,
   * otherwise the global Default Agent View setting.
   */
  chatModeArmed: (sessionKey: string) => boolean;
  /** Pin one tab to an explicit chat or terminal view. */
  setSessionViewMode: (sessionKey: string, mode: PreferredAgentInterface) => void;
  /** Flip one tab between terminal and Session Chat view. */
  toggleChatMode: (sessionKey: string) => void;
  /** Keeps `text` as the session's editor draft; an empty one removes the entry. */
  setTextEditorDraft: (sessionKey: string, text: string) => void;
};

function isFontSizeMap(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'number');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isSessionViewModeMap(value: unknown): value is Record<string, PreferredAgentInterface> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => entry === 'terminal' || entry === 'chat');
}

export const useTerminalStore = create<TerminalState>()((set, get) => {
  const touchWarm = (sessionKey: string): void => {
    const order = get().warmOrder.filter((key) => key !== sessionKey);
    order.push(sessionKey);
    set({ warmOrder: order });
  };

  const dropWarm = (sessionKey: string): void => {
    warmScrollbackRows.delete(sessionKey);
    set({ warmOrder: get().warmOrder.filter((key) => key !== sessionKey) });
  };

  /**
   * Enforce the warm policy (max 7, within the scrollback budget) by closing least recently used entries; the
   * terminals on screen (the selected one and the pane beside it) are never the victim, so with two panes both may
   * stay above the budget.
   */
  const evictExcessWarmEntries = async (): Promise<void> => {
    const rowsOf = (key: string): number =>
      warmScrollbackRows.get(key) ?? useSettingsStore.getState().settings.scrollbackRows;
    while (warmPoolOverBudget(get().warmOrder.map(rowsOf), MAX_WARM_SESSIONS)) {
      const { warmOrder, selectedSessionKey, paneSessionKey, tabs, tabSplit } = get();
      // With the tabs side by side, the other side's tab is on screen too.
      const split = splitView(
        tabs.map((tab) => tab.sessionKey),
        selectedSessionKey,
        tabSplit,
      );
      const beside = split === null ? null : split.focus === 'left' ? split.rightShown : split.leftShown;
      const offScreen = warmOrder.find((key) => key !== selectedSessionKey && key !== paneSessionKey && key !== beside);
      // Only the two terminals on screen are left: like a single one (warmBudget.ts), neither is closed to make room.
      if (offScreen === undefined && paneSessionKey !== null) break;
      const victim = offScreen ?? warmOrder[0];
      await get().closeTab(victim);
    }
  };

  const removeTab = (sessionKey: string): void => {
    const tabs = get().tabs.filter((tab) => tab.sessionKey !== sessionKey);
    let { selectedSessionKey, paneSessionKey } = get();
    if (paneSessionKey === sessionKey) paneSessionKey = null;
    if (selectedSessionKey === sessionKey) {
      // The pane beside the closed one stays on screen and takes the selection; with the tabs side by side, the
      // closed tab's neighbour on its side (else the other side's tab); otherwise the last tab, as before.
      const successor = splitSuccessor(
        get().tabs.map((tab) => tab.sessionKey),
        get().tabSplit,
        sessionKey,
      );
      selectedSessionKey = paneSessionKey ?? successor ?? (tabs.length > 0 ? tabs[tabs.length - 1].sessionKey : null);
      paneSessionKey = null;
    }
    set({ tabs, selectedSessionKey, paneSessionKey });
  };

  const patchTab = (sessionKey: string, patch: Partial<TerminalTab>): void => {
    set({
      tabs: get().tabs.map((tab) => (tab.sessionKey === sessionKey ? { ...tab, ...patch } : tab)),
    });
  };

  const initialFontSize = (sessionKey: string): number => {
    const override = get().fontSizeBySessionKey[sessionKey];
    if (override !== undefined) return override;
    return useSettingsStore.getState().settings.fontSize;
  };

  const openTab = (
    machine: MachineConnectionTarget,
    tab: TerminalTab,
    command: string | null,
    select = true,
  ): Promise<string> =>
    trackTabOpen(tab.sessionKey, async () => {
      set({ tabs: [...get().tabs, tab], selectedSessionKey: select ? tab.sessionKey : get().selectedSessionKey });
      touchWarm(tab.sessionKey);
      await evictExcessWarmEntries();
      let connected = false;
      let openStartedAt: number | null = null;
      try {
        await ensureConnected(machine, { dialNow: true, reason: 'opening a terminal' });
        connected = true;
        if (!get().tabs.some((entry) => entry.sessionKey === tab.sessionKey)) return tab.sessionKey;
        if (isDemoMachineId(machine.id)) {
          patchTab(tab.sessionKey, { state: 'open', error: undefined });
          return tab.sessionKey;
        }
        const opts: { command?: string; fontSize?: number; zmxBacked?: boolean; scrollbackRows?: number } = {
          fontSize: initialFontSize(tab.sessionKey),
          zmxBacked: tab.kind === 'attach',
          scrollbackRows: scrollbackRowsForNewTerminal(tab.sessionKey),
        };
        const remoteCommand =
          command !== null
            ? await remoteTerminalCommand(machine.id, command)
            : await remoteShellCommand(machine.id, tab.cwd);
        if (remoteCommand !== null) opts.command = remoteCommand;
        openStartedAt = Date.now();
        await GhostexNative.openTerminal(tab.sessionKey, machine.id, opts);
        if (!get().tabs.some((entry) => entry.sessionKey === tab.sessionKey)) {
          await GhostexNative.closeTerminal(tab.sessionKey);
        }
      } catch (error) {
        patchTab(tab.sessionKey, { state: 'failed', error: terminalOpenError(machine.id, error, openStartedAt) });
        dropWarm(tab.sessionKey);
        if (connected) verifyAfterFailedOpen(machine);
        throw error;
      }
      return tab.sessionKey;
    });

  return {
    hydrated: false,
    tabs: [],
    selectedSessionKey: null,
    paneSessionKey: null,
    tabSplit: null,
    warmOrder: [],
    fontSizeBySessionKey: {},
    sessionViewModeBySessionKey: {},
    textEditorDraftBySessionKey: {},

    hydrate: async () => {
      if (get().hydrated) return;
      let fontSizeBySessionKey: Record<string, number> = {};
      try {
        const raw = await AsyncStorage.getItem(FONT_SIZES_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (isFontSizeMap(parsed)) fontSizeBySessionKey = parsed;
        }
      } catch {
        // Corrupt persisted sizes fall back to the global default.
      }
      let sessionViewModeBySessionKey: Record<string, PreferredAgentInterface> = {};
      try {
        const raw = await AsyncStorage.getItem(SESSION_VIEW_MODES_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (isSessionViewModeMap(parsed)) sessionViewModeBySessionKey = parsed;
        } else {
          // One-time migration: sessions the user had switched to chat under
          // the old array format keep chat as their explicit choice.
          const legacyRaw = await AsyncStorage.getItem(LEGACY_CHAT_MODE_STORAGE_KEY);
          if (legacyRaw !== null) {
            const legacy: unknown = JSON.parse(legacyRaw);
            if (isStringArray(legacy)) {
              for (const sessionKey of legacy) sessionViewModeBySessionKey[sessionKey] = 'chat';
            }
            await AsyncStorage.setItem(SESSION_VIEW_MODES_STORAGE_KEY, JSON.stringify(sessionViewModeBySessionKey));
            await AsyncStorage.removeItem(LEGACY_CHAT_MODE_STORAGE_KEY);
          }
        }
      } catch {
        // Corrupt persisted view modes fall back to the global default everywhere.
      }
      set({ hydrated: true, fontSizeBySessionKey, sessionViewModeBySessionKey });
    },

    attachSession: async (machine, session, options) => {
      const select = options?.select ?? true;
      const current = options?.current;
      const sessionKey = attachSessionKey(machine.id, session.sessionId);
      const pending = tabOpenRequests.get(sessionKey);
      if (pending) await pending;
      // A later tap or the person moved on while that opening ran: the obsolete request selects nothing.
      if (current?.() === false) return sessionKey;
      const existing = get().tabs.find((tab) => tab.sessionKey === sessionKey);
      if (existing !== undefined) {
        if (session.agentId) patchTab(sessionKey, { ghostexAgentId: session.agentId });
        if (session.projectId !== undefined && session.projectId.length > 0) {
          patchTab(sessionKey, { ghostexProjectId: session.projectId });
        }
        // Upgrade a placeholder title (raw session id) when the caller knows
        // the real one (e.g. a notification deep link).
        if (
          session.title !== undefined &&
          session.title.length > 0 &&
          (existing.title.length === 0 || existing.title === session.sessionId)
        ) {
          patchTab(sessionKey, { title: session.title });
        }
        if (select) set({ selectedSessionKey: sessionKey });
        touchWarm(sessionKey);
        await ensureConnected(machine, { verify: true, dialNow: true, reason: 'opening an agent terminal' });
        const opening = tabOpenRequests.get(sessionKey);
        if (opening) await opening;
        const current = get().tabs.find((tab) => tab.sessionKey === sessionKey);
        if (current?.state === 'closed' || current?.state === 'failed' || current?.state === 'detached') {
          await get().reopenTab(sessionKey);
        }
        const attached = get().tabs.find((tab) => tab.sessionKey === sessionKey);
        if (attached?.state !== 'open') throw new Error(attached?.error ?? 'The terminal is not connected yet.');
        return sessionKey;
      }
      const tab: TerminalTab = {
        sessionKey,
        machineId: machine.id,
        title: session.title !== undefined && session.title.length > 0 ? session.title : session.sessionId,
        kind: 'attach',
        ghostexSessionId: session.sessionId,
        ghostexAgentId: session.agentId,
        ...(session.projectId !== undefined && session.projectId.length > 0
          ? { ghostexProjectId: session.projectId }
          : {}),
        state: 'opening',
      };
      const command = attachCommand(session.sessionId, session.projectId);
      return openTab(machine, tab, command, select);
    },

    /**
     * CDXC:SessionChat 2026-10-08 DECISION:
     * User: "How about if we don't connect the terminal until user switches to it but if we're just using chat view then we don't do ssh connection for that session", picking "Chat-only, no terminal", with the rule "pls dont break things for users who set default to terminal at all". A session opened in Chat View gets a `detached` tab: no PTY channel, no login shell, no `ghostex attach`. Its chat needs none of them (it talks to gxserver over the warm chat link; a send wakes a sleeping session in gxserver, and gxserver holds the 200-column chat grid while the chat is shown, `chatGridClaim.ts`). The first switch to its Terminal view attaches it. Supersedes the 2026-10-08 "attach in the background" step of "Phone opens chat first".
     */
    openChatTab: (machine, session) => {
      // The person opened a chat: its link dials now even if the computer waits after unanswered dials.
      clearDialBackoff(machine.id, 'opening a chat');
      const sessionKey = attachSessionKey(machine.id, session.sessionId);
      const existing = get().tabs.find((tab) => tab.sessionKey === sessionKey);
      const projectId = session.projectId !== undefined && session.projectId.length > 0 ? session.projectId : undefined;
      if (existing !== undefined) {
        if (projectId !== undefined) patchTab(sessionKey, { ghostexProjectId: projectId });
        if (
          session.title !== undefined &&
          session.title.length > 0 &&
          (existing.title.length === 0 || existing.title === session.sessionId)
        ) {
          patchTab(sessionKey, { title: session.title });
        }
        set({ selectedSessionKey: sessionKey });
        if (existing.state !== 'detached') touchWarm(sessionKey);
        return sessionKey;
      }
      const tab: TerminalTab = {
        sessionKey,
        machineId: machine.id,
        title: session.title !== undefined && session.title.length > 0 ? session.title : session.sessionId,
        kind: 'attach',
        ghostexSessionId: session.sessionId,
        ...(projectId !== undefined ? { ghostexProjectId: projectId } : {}),
        state: 'detached',
      };
      set({ tabs: [...get().tabs, tab], selectedSessionKey: sessionKey });
      return sessionKey;
    },

    ensureTerminalAttached: async (sessionKey) => {
      const tab = get().tabs.find((entry) => entry.sessionKey === sessionKey);
      if (tab?.state !== 'detached') return;
      await get().reopenTab(sessionKey);
      await evictExcessWarmEntries();
    },

    openShellTab: async (machine, options) => {
      const sessionKey = `${machine.id}:tab:${randomTabId()}`;
      const title = options?.title ?? '';
      const cwd = options?.cwd?.trim() ?? '';
      const tab: TerminalTab = {
        sessionKey,
        machineId: machine.id,
        title: title.length > 0 ? title : 'Terminal',
        kind: 'shell',
        ...(cwd.length > 0 ? { cwd } : {}),
        state: 'opening',
      };
      // command == null → interactive login shell in the native PTY.
      return openTab(machine, tab, null);
    },

    selectTab: (sessionKey, options) => {
      if (!get().tabs.some((tab) => tab.sessionKey === sessionKey)) return;
      set({ selectedSessionKey: sessionKey });
      touchWarm(sessionKey);
      // Auto scroll: land at the live bottom when returning to a warm tab. A pane that was on screen all along is
      // not returned to: it keeps the place its reader scrolled it to.
      if (
        useSettingsStore.getState().settings.autoScroll &&
        options?.scrollToBottom !== false &&
        !isDemoMachineId(sessionKey.split(':')[0] ?? '')
      ) {
        void GhostexNative.scrollToBottom(sessionKey).catch(() => undefined);
      }
    },

    setPaneSessionKey: (paneSessionKey) => {
      if (get().paneSessionKey !== paneSessionKey) set({ paneSessionKey });
    },

    moveTab: (sessionKey, drop) => {
      const { tabs, tabSplit, selectedSessionKey } = get();
      const moved = moveTab(
        tabs.map((tab) => tab.sessionKey),
        tabSplit,
        sessionKey,
        drop,
      );
      const byKey = new Map(tabs.map((tab) => [tab.sessionKey, tab]));
      const fromRight = tabSplit?.right.includes(sessionKey) === true;
      const toRight = moved.split?.right.includes(sessionKey) === true;
      set({
        tabs: moved.keys.map((key) => byKey.get(key)).filter((tab): tab is TerminalTab => tab !== undefined),
        tabSplit: moved.split,
        // A tab dropped in the other side's bar is what the user is looking at there; in the only bar (a narrow
        // window keeping a split) the selection stays.
        selectedSessionKey:
          moved.split !== null && drop.bar !== 'single' && fromRight !== toRight ? sessionKey : selectedSessionKey,
      });
    },

    splitTab: (sessionKey) => {
      const { tabs, selectedSessionKey } = get();
      const opened = openSplit(
        tabs.map((tab) => tab.sessionKey),
        selectedSessionKey,
        sessionKey,
      );
      if (opened === null) return;
      const byKey = new Map(tabs.map((tab) => [tab.sessionKey, tab]));
      set({
        tabs: opened.keys.map((key) => byKey.get(key)).filter((tab): tab is TerminalTab => tab !== undefined),
        tabSplit: opened.split,
        selectedSessionKey: sessionKey,
      });
      touchWarm(sessionKey);
    },

    mergeTabs: () => {
      const { tabs, tabSplit } = get();
      if (tabSplit === null) return;
      const byKey = new Map(tabs.map((tab) => [tab.sessionKey, tab]));
      set({
        tabs: splitOrder(
          tabs.map((tab) => tab.sessionKey),
          tabSplit,
        )
          .map((key) => byKey.get(key))
          .filter((tab): tab is TerminalTab => tab !== undefined),
        tabSplit: null,
      });
    },

    closeTab: async (sessionKey) => {
      cancelZmxRefresh(sessionKey);
      zmxRefreshSent.delete(sessionKey);
      forgetAttach(sessionKey);
      dropWarm(sessionKey);
      removeTab(sessionKey);
      // Chat mode is intentionally NOT cleared here: the persisted last-used
      // view survives tab close so a later reopen restores it.
      try {
        const machineId = sessionKey.split(':')[0] ?? '';
        if (!isDemoMachineId(machineId)) await GhostexNative.closeTerminal(sessionKey);
      } catch {
        // Entry may already be gone natively.
      }
    },

    detachIdleTerminals: async (machineId, keep) => {
      // What is on screen now: read again before each detach, since the user may pick a tab while one closes.
      const onScreen = (): Set<string> => {
        const { selectedSessionKey, paneSessionKey, tabs, tabSplit } = get();
        const split = splitView(
          tabs.map((tab) => tab.sessionKey),
          selectedSessionKey,
          tabSplit,
        );
        const beside = split === null ? null : split.focus === 'left' ? split.rightShown : split.leftShown;
        return new Set([selectedSessionKey, paneSessionKey, beside].filter((key): key is string => key !== null));
      };
      const { warmOrder, tabs } = get();
      const attached = warmOrder
        .map((key) => tabs.find((tab) => tab.sessionKey === key))
        .filter((tab): tab is TerminalTab => tab !== undefined && tab.machineId === machineId && tab.kind === 'attach')
        .filter((tab) => tab.state === 'open' || tab.state === 'failed' || tab.state === 'closed');
      let detached = 0;
      for (const tab of attached) {
        if (attached.length - detached <= keep) break;
        const current = get().tabs.find((entry) => entry.sessionKey === tab.sessionKey);
        if (current === undefined || current.state === 'detached' || current.state === 'opening') continue;
        if (onScreen().has(tab.sessionKey) || tabOpenRequests.has(tab.sessionKey)) continue;
        cancelZmxRefresh(tab.sessionKey);
        zmxRefreshSent.delete(tab.sessionKey);
        forgetAttach(tab.sessionKey);
        dropWarm(tab.sessionKey);
        patchTab(tab.sessionKey, { state: 'detached', error: undefined });
        await GhostexNative.closeTerminal(tab.sessionKey).catch(() => undefined);
        detached += 1;
      }
      return detached;
    },

    closeWarmSessionFor: async (machineId, sessionId) => {
      const sessionKey = attachSessionKey(machineId, sessionId);
      if (get().tabs.some((tab) => tab.sessionKey === sessionKey) || get().warmOrder.includes(sessionKey)) {
        await get().closeTab(sessionKey);
      }
    },

    reopenTab: (sessionKey, options) => {
      const existing = tabOpenRequests.get(sessionKey);
      if (existing)
        return existing.then(
          () => undefined,
          () => undefined,
        );
      return trackTabOpen(sessionKey, async () => {
        const tab = get().tabs.find((entry) => entry.sessionKey === sessionKey);
        // An open tab is already showing a live terminal, and a tab mid-open has
        // an attach in flight; reopening either would race two attaches onto one
        // session key. Everything else is a restart.
        if (tab === undefined || tab.state === 'opening' || tab.state === 'open') return;
        const record = useMachinesStore.getState().machines.find((machine) => machine.id === tab.machineId);
        if (record === undefined) return;
        const target: MachineConnectionTarget = {
          id: record.id,
          host: record.host,
          username: record.username,
          port: record.port,
          transport: record.transport,
        };
        patchTab(sessionKey, { state: 'opening', error: undefined });
        // A fresh attach gets a fresh native viewport refresh and display announcement.
        cancelZmxRefresh(sessionKey);
        zmxRefreshSent.delete(sessionKey);
        forgetAttach(sessionKey);
        touchWarm(sessionKey);
        // The reopened terminal takes the current scrollback setting, which may no longer fit beside
        // the others; a background tab that does not fit is the one closed, and stays closed.
        scrollbackRowsForNewTerminal(sessionKey);
        await evictExcessWarmEntries();
        if (!get().tabs.some((entry) => entry.sessionKey === sessionKey)) return;
        let connected = false;
        let openStartedAt: number | null = null;
        try {
          if (isDemoMachineId(tab.machineId)) {
            patchTab(sessionKey, { state: 'open', error: undefined });
            return;
          }
          /*
           * Reconnect means "throw the dead terminal away and start over", so the
           * native entry goes first. Without this, openTerminal finds a warm entry
           * under the same session key and resolves as a no-op — which is exactly
           * how a Reconnect could report success while the user kept staring at
           * the exited process.
           */
          await GhostexNative.closeTerminal(sessionKey).catch(() => undefined);
          await ensureConnected(target, { dialNow: options?.dialNow ?? true, reason: 'reconnecting a terminal' });
          connected = true;
          const opts: { command?: string; fontSize?: number; zmxBacked?: boolean; scrollbackRows?: number } = {
            fontSize: initialFontSize(sessionKey),
            zmxBacked: tab.kind === 'attach',
            scrollbackRows: scrollbackRowsForNewTerminal(sessionKey),
          };
          if (tab.kind === 'attach' && tab.ghostexSessionId !== undefined) {
            // Same project-scoped selector the first attach used. A bare session
            // id still works, but costs the daemon an extra inventory lookup on
            // every reconnect to rediscover the project this tab already knows.
            opts.command = await remoteTerminalCommand(
              tab.machineId,
              attachCommand(tab.ghostexSessionId, tab.ghostexProjectId),
            );
          } else if (tab.kind === 'shell') {
            const command = await remoteShellCommand(tab.machineId, tab.cwd);
            if (command !== null) opts.command = command;
          }
          openStartedAt = Date.now();
          await GhostexNative.openTerminal(sessionKey, tab.machineId, opts);
        } catch (error) {
          patchTab(sessionKey, { state: 'failed', error: terminalOpenError(tab.machineId, error, openStartedAt) });
          logAppEvent(`Terminal: ${tab.machineId}: reopening ${tab.kind} tab failed (${errorCodeOf(error)})`);
          if (connected) verifyAfterFailedOpen(target);
        }
      });
    },

    setFontSizeForSession: (sessionKey, size) => {
      const fontSizeBySessionKey = { ...get().fontSizeBySessionKey, [sessionKey]: size };
      set({ fontSizeBySessionKey });
      void AsyncStorage.setItem(FONT_SIZES_STORAGE_KEY, JSON.stringify(fontSizeBySessionKey));
    },

    clearFontSizeOverrides: () => {
      set({ fontSizeBySessionKey: {} });
      void AsyncStorage.setItem(FONT_SIZES_STORAGE_KEY, JSON.stringify({}));
      const size = useSettingsStore.getState().settings.fontSize;
      for (const tab of get().tabs) {
        void GhostexNative.setFontSize(tab.sessionKey, size).catch(() => undefined);
      }
    },

    chatModeArmed: (sessionKey) => {
      const explicit = get().sessionViewModeBySessionKey[sessionKey];
      const mode = explicit ?? useSettingsStore.getState().settings.preferredAgentInterface;
      return mode === 'chat';
    },

    setSessionViewMode: (sessionKey, mode) => {
      const sessionViewModeBySessionKey = {
        ...get().sessionViewModeBySessionKey,
        [sessionKey]: mode,
      };
      set({ sessionViewModeBySessionKey });
      void AsyncStorage.setItem(SESSION_VIEW_MODES_STORAGE_KEY, JSON.stringify(sessionViewModeBySessionKey));
    },

    toggleChatMode: (sessionKey) => {
      get().setSessionViewMode(sessionKey, get().chatModeArmed(sessionKey) ? 'terminal' : 'chat');
    },

    setTextEditorDraft: (sessionKey, text) => {
      const { [sessionKey]: current, ...others } = get().textEditorDraftBySessionKey;
      if (current === text || (current === undefined && text.length === 0)) return;
      set({ textEditorDraftBySessionKey: text.length === 0 ? others : { ...others, [sessionKey]: text } });
    },
  };
});

/*
 * The split follows the tabs and the selection: a closed tab leaves it, a side without tabs ends it, the selected tab
 * is what its side shows, and the tab list stays in the order the two bars show (a tab opened meanwhile joins the left
 * side's end). Each write reaches a state this leaves alone, so it settles after one more call.
 */
useTerminalStore.subscribe((state) => {
  const keys = state.tabs.map((tab) => tab.sessionKey);
  const tabSplit = syncSplit(keys, state.selectedSessionKey, state.tabSplit);
  const order = tabSplit === null ? keys : splitOrder(keys, tabSplit);
  const reordered = order.some((key, index) => key !== keys[index]);
  if (tabSplit === state.tabSplit && !reordered) return;
  const byKey = new Map(state.tabs.map((tab) => [tab.sessionKey, tab]));
  useTerminalStore.setState({
    tabSplit,
    ...(reordered
      ? { tabs: order.map((key) => byKey.get(key)).filter((tab): tab is TerminalTab => tab !== undefined) }
      : {}),
  });
});

const restoring = new Map<string, Promise<void>>();

/** Reattach serially, selected first, then the pane beside it, without respawning ordinary shell processes. */
export function restoreAttachTabs(machineId: string): Promise<void> {
  const existing = restoring.get(machineId);
  if (existing) return existing;
  const request = (async () => {
    const store = useTerminalStore.getState();
    const tabs = store.tabs.filter((tab) => tab.machineId === machineId && tab.kind === 'attach');
    // What is on screen first: the selected terminal (2), the pane beside it (1), then the rest in tab order.
    const rank = (sessionKey: string): number =>
      sessionKey === store.selectedSessionKey ? 2 : sessionKey === store.paneSessionKey ? 1 : 0;
    tabs.sort((a, b) => rank(b.sessionKey) - rank(a.sessionKey));
    for (const tab of tabs) {
      if (AppState.currentState === 'background' || AppState.currentState === 'inactive') break;
      const current = useTerminalStore.getState().tabs.find((entry) => entry.sessionKey === tab.sessionKey);
      if (current?.state === 'closed' || current?.state === 'failed') {
        await useTerminalStore.getState().reopenTab(tab.sessionKey, { dialNow: false });
      }
    }
  })();
  restoring.set(machineId, request);
  const clear = () => {
    if (restoring.get(machineId) === request) restoring.delete(machineId);
  };
  void request.then(clear, clear);
  return request;
}

let eventsInstalled = false;

/**
 * Subscribe to native terminal lifecycle events. Call once at app startup;
 * subscriptions live for the app's lifetime.
 */
export function initTerminalEvents(): void {
  if (eventsInstalled) return;
  eventsInstalled = true;

  GhostexNative.addListener('onTerminalState', (event) => {
    const store = useTerminalStore.getState();
    const tab = store.tabs.find((entry) => entry.sessionKey === event.sessionKey);
    if (tab === undefined) return;
    if (event.state === 'closed' && tab.state === 'opening' && tabOpenRequests.has(event.sessionKey)) return;
    // A detached tab has no terminal: a close or failure arriving now is the end of the one it gave up on purpose
    // (`detachIdleTerminals`), and the tab stays detached so it attaches when shown instead of reading Disconnected
    // and being reopened by the next recovery.
    if (tab.state === 'detached' && event.state !== 'open') return;
    useTerminalStore.setState({
      tabs: store.tabs.map((entry) =>
        entry.sessionKey === event.sessionKey ? { ...entry, state: event.state, error: event.error } : entry,
      ),
    });
    if (event.state === 'open' && tab.kind === 'attach' && Platform.OS === 'ios') {
      scheduleZmxRefresh(event.sessionKey);
    }
    // zmx display policy (zmxDisplay.ts): announce visible/hidden once the
    // attach client can read stdin; closed/failed entries are forgotten.
    if (event.state === 'open' && tab.kind === 'attach') {
      noteAttachOpened(event.sessionKey);
    }
    if (event.state === 'closed' || event.state === 'failed') {
      cancelZmxRefresh(event.sessionKey);
      forgetAttach(event.sessionKey);
    }
    // Auto scroll: newly opened/reattached terminals start at the live bottom.
    if (event.state === 'open' && useSettingsStore.getState().settings.autoScroll) {
      void GhostexNative.scrollToBottom(event.sessionKey).catch(() => undefined);
    }
  });

  GhostexNative.addListener('onTerminalTitle', (event) => {
    const store = useTerminalStore.getState();
    if (!store.tabs.some((tab) => tab.sessionKey === event.sessionKey)) return;
    if (event.title.trim().length === 0) return;
    useTerminalStore.setState({
      tabs: store.tabs.map((tab) => (tab.sessionKey === event.sessionKey ? { ...tab, title: event.title } : tab)),
    });
  });

  GhostexNative.addListener('onFontSizeChange', (event) => {
    // Native pinch-to-zoom ratchet; persist per session for the next open.
    useTerminalStore.getState().setFontSizeForSession(event.sessionKey, event.fontSize);
  });
}
