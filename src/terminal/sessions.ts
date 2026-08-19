/**
 * Terminal tab/session orchestration.
 * - sessionKey = `${machineId}:${sessionId}` for attach tabs,
 *   `${machineId}:tab:${uuid}` for plain shells (docs/ARCHITECTURE.md).
 * - Warm-session policy: up to 7 native terminal entries stay alive; the least
 *   recently used non-selected entry is evicted via closeTerminal.
 * - Attach flow (sessions-drawer.md §5 / terminal-screen.md §6): connect if
 *   needed → openTerminal with the login-shell-wrapped attach command → ~2s
 *   after the entry first opens, refresh the native viewport once.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { attachCommand, loginShellCommand, shellQuote } from '../commands/ghostexCli';
import { ensureConnected } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import { useSettingsStore } from '../settings/store';

export const MAX_WARM_SESSIONS = 7;
/**
 * Delay before the one-shot native viewport refresh after an attach opens.
 */
export const ATTACH_VIEWPORT_REFRESH_DELAY_MS = 2000;

const FONT_SIZES_STORAGE_KEY = 'terminal.fontSizes.v1';
const CHAT_MODE_STORAGE_KEY = 'terminal.chatMode.v1';

export type TerminalTabKind = 'attach' | 'shell';
export type TerminalTabState = 'opening' | 'open' | 'closed' | 'failed';

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
  /** Starting directory for shell tabs (unset → login-shell default, ~). */
  cwd?: string;
  state: TerminalTabState;
  error?: string;
};

/**
 * Interactive login shell started in `cwd` (shell-tab open and reopen share
 * it); null when no directory is requested, which makes the native PTY start
 * its own plain login shell.
 */
function shellCommandIn(cwd: string | undefined): string | null {
  if (cwd === undefined || cwd.length === 0) return null;
  return loginShellCommand(`cd ${shellQuote(cwd)} && exec "$SHELL" -l`);
}

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
  /** LRU of warm native entries, most recently used last. */
  warmOrder: string[];
  /** Per-session font size overrides, persisted. */
  fontSizeBySessionKey: Record<string, number>;
  /**
   * Tabs currently showing the Session Chat surface instead of the terminal.
   * Per tab by design: toggling one tab never affects the others. Persisted:
   * a session reopened after a restart (or after its tab was closed) comes
   * back in whichever view it last used. Attach-tab keys are stable
   * `${machineId}:${sessionId}`, so entries survive restarts correctly.
   */
  chatModeSessionKeys: string[];

  hydrate: () => Promise<void>;
  /** Open (or re-select) an attach tab for a remote Ghostex session. */
  attachSession: (
    machine: MachineConnectionTarget,
    session: { sessionId: string; projectId?: string; title?: string },
  ) => Promise<string>;
  /** Open an interactive login-shell tab on a machine (in `cwd` when given). */
  openShellTab: (
    machine: MachineConnectionTarget,
    options?: { title?: string; cwd?: string },
  ) => Promise<string>;
  selectTab: (sessionKey: string) => void;
  /** Close a tab and its warm native entry. */
  closeTab: (sessionKey: string) => Promise<void>;
  /** Kill/sleep actions must also drop the warm surface for that session. */
  closeWarmSessionFor: (machineId: string, sessionId: string) => Promise<void>;
  /**
   * Re-run the open flow for a failed/closed tab. Shared by the Terminal
   * screen's Retry/Reconnect buttons and the app-resume auto-reattach.
   */
  reopenTab: (sessionKey: string) => Promise<void>;
  setFontSizeForSession: (sessionKey: string, size: number) => void;
  /** Drop all pinch-zoom overrides and re-apply the global default everywhere. */
  clearFontSizeOverrides: () => void;
  /** Flip one tab between terminal and Session Chat view. */
  toggleChatMode: (sessionKey: string) => void;
};

function isFontSizeMap(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'number');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export const useTerminalStore = create<TerminalState>()((set, get) => {
  const touchWarm = (sessionKey: string): void => {
    const order = get().warmOrder.filter((key) => key !== sessionKey);
    order.push(sessionKey);
    set({ warmOrder: order });
  };

  const dropWarm = (sessionKey: string): void => {
    set({ warmOrder: get().warmOrder.filter((key) => key !== sessionKey) });
  };

  /** Enforce the max-7 warm policy by closing least recently used entries. */
  const evictExcessWarmEntries = async (): Promise<void> => {
    while (get().warmOrder.length > MAX_WARM_SESSIONS) {
      const { warmOrder, selectedSessionKey } = get();
      const victim = warmOrder.find((key) => key !== selectedSessionKey) ?? warmOrder[0];
      await get().closeTab(victim);
    }
  };

  const removeTab = (sessionKey: string): void => {
    const tabs = get().tabs.filter((tab) => tab.sessionKey !== sessionKey);
    let selectedSessionKey = get().selectedSessionKey;
    if (selectedSessionKey === sessionKey) {
      selectedSessionKey = tabs.length > 0 ? tabs[tabs.length - 1].sessionKey : null;
    }
    set({ tabs, selectedSessionKey });
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

  const openTab = async (
    machine: MachineConnectionTarget,
    tab: TerminalTab,
    command: string | null,
  ): Promise<string> => {
    set({ tabs: [...get().tabs, tab], selectedSessionKey: tab.sessionKey });
    touchWarm(tab.sessionKey);
    await evictExcessWarmEntries();
    try {
      await ensureConnected(machine);
      const opts: { command?: string; fontSize?: number; zmxBacked?: boolean; scrollbackRows?: number } = {
        fontSize: initialFontSize(tab.sessionKey),
        zmxBacked: tab.kind === 'attach',
        scrollbackRows: useSettingsStore.getState().settings.scrollbackRows,
      };
      if (command !== null) opts.command = command;
      await GhostexNative.openTerminal(tab.sessionKey, machine.id, opts);
    } catch (error) {
      patchTab(tab.sessionKey, {
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      dropWarm(tab.sessionKey);
      throw error;
    }
    return tab.sessionKey;
  };

  return {
    hydrated: false,
    tabs: [],
    selectedSessionKey: null,
    warmOrder: [],
    fontSizeBySessionKey: {},
    chatModeSessionKeys: [],

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
      let chatModeSessionKeys: string[] = [];
      try {
        const raw = await AsyncStorage.getItem(CHAT_MODE_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (isStringArray(parsed)) chatModeSessionKeys = parsed;
        }
      } catch {
        // Corrupt persisted chat modes fall back to terminal view everywhere.
      }
      set({ hydrated: true, fontSizeBySessionKey, chatModeSessionKeys });
    },

    attachSession: async (machine, session) => {
      const sessionKey = attachSessionKey(machine.id, session.sessionId);
      const existing = get().tabs.find((tab) => tab.sessionKey === sessionKey);
      if (existing !== undefined) {
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
        set({ selectedSessionKey: sessionKey });
        touchWarm(sessionKey);
        return sessionKey;
      }
      const tab: TerminalTab = {
        sessionKey,
        machineId: machine.id,
        title: session.title !== undefined && session.title.length > 0 ? session.title : session.sessionId,
        kind: 'attach',
        ghostexSessionId: session.sessionId,
        ...(session.projectId !== undefined && session.projectId.length > 0
          ? { ghostexProjectId: session.projectId }
          : {}),
        state: 'opening',
      };
      const command = loginShellCommand(attachCommand(session.sessionId, session.projectId));
      return openTab(machine, tab, command);
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
      return openTab(machine, tab, shellCommandIn(tab.cwd));
    },

    selectTab: (sessionKey) => {
      if (!get().tabs.some((tab) => tab.sessionKey === sessionKey)) return;
      set({ selectedSessionKey: sessionKey });
      touchWarm(sessionKey);
      // Auto scroll: land at the live bottom when returning to a warm tab.
      if (useSettingsStore.getState().settings.autoScroll) {
        void GhostexNative.scrollToBottom(sessionKey).catch(() => undefined);
      }
    },

    closeTab: async (sessionKey) => {
      cancelZmxRefresh(sessionKey);
      zmxRefreshSent.delete(sessionKey);
      dropWarm(sessionKey);
      removeTab(sessionKey);
      // Chat mode is intentionally NOT cleared here: the persisted last-used
      // view survives tab close so a later reopen restores it.
      try {
        await GhostexNative.closeTerminal(sessionKey);
      } catch {
        // Entry may already be gone natively.
      }
    },

    closeWarmSessionFor: async (machineId, sessionId) => {
      const sessionKey = attachSessionKey(machineId, sessionId);
      if (
        get().tabs.some((tab) => tab.sessionKey === sessionKey) ||
        get().warmOrder.includes(sessionKey)
      ) {
        await get().closeTab(sessionKey);
      }
    },

    reopenTab: async (sessionKey) => {
      const tab = get().tabs.find((entry) => entry.sessionKey === sessionKey);
      // An open tab is already showing a live terminal, and a tab mid-open has
      // an attach in flight; reopening either would race two attaches onto one
      // session key. Everything else is a restart.
      if (tab === undefined || tab.state === 'opening' || tab.state === 'open') return;
      const record = useMachinesStore
        .getState()
        .machines.find((machine) => machine.id === tab.machineId);
      if (record === undefined) return;
      const target: MachineConnectionTarget = {
        id: record.id,
        host: record.host,
        username: record.username,
        port: record.port,
      };
      patchTab(sessionKey, { state: 'opening', error: undefined });
      // A fresh attach gets a fresh native viewport refresh.
      cancelZmxRefresh(sessionKey);
      zmxRefreshSent.delete(sessionKey);
      touchWarm(sessionKey);
      try {
        /*
         * Reconnect means "throw the dead terminal away and start over", so the
         * native entry goes first. Without this, openTerminal finds a warm entry
         * under the same session key and resolves as a no-op — which is exactly
         * how a Reconnect could report success while the user kept staring at
         * the exited process.
         */
        await GhostexNative.closeTerminal(sessionKey).catch(() => undefined);
        await ensureConnected(target);
        const opts: { command?: string; fontSize?: number; zmxBacked?: boolean; scrollbackRows?: number } = {
          fontSize: initialFontSize(sessionKey),
          zmxBacked: tab.kind === 'attach',
          scrollbackRows: useSettingsStore.getState().settings.scrollbackRows,
        };
        if (tab.kind === 'attach' && tab.ghostexSessionId !== undefined) {
          // Same project-scoped selector the first attach used. A bare session
          // id still works, but costs the daemon an extra inventory lookup on
          // every reconnect to rediscover the project this tab already knows.
          opts.command = loginShellCommand(
            attachCommand(tab.ghostexSessionId, tab.ghostexProjectId),
          );
        } else if (tab.kind === 'shell') {
          const command = shellCommandIn(tab.cwd);
          if (command !== null) opts.command = command;
        }
        await GhostexNative.openTerminal(sessionKey, tab.machineId, opts);
      } catch (error) {
        patchTab(sessionKey, {
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
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

    toggleChatMode: (sessionKey) => {
      const current = get().chatModeSessionKeys;
      const chatModeSessionKeys = current.includes(sessionKey)
        ? current.filter((key) => key !== sessionKey)
        : [...current, sessionKey];
      set({ chatModeSessionKeys });
      void AsyncStorage.setItem(CHAT_MODE_STORAGE_KEY, JSON.stringify(chatModeSessionKeys));
    },
  };
});

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
    useTerminalStore.setState({
      tabs: store.tabs.map((entry) =>
        entry.sessionKey === event.sessionKey
          ? { ...entry, state: event.state, error: event.error }
          : entry,
      ),
    });
    if (event.state === 'open' && tab.kind === 'attach' && Platform.OS === 'ios') {
      scheduleZmxRefresh(event.sessionKey);
    }
    // Auto scroll: newly opened/reattached terminals start at the live bottom.
    if (event.state === 'open' && useSettingsStore.getState().settings.autoScroll) {
      void GhostexNative.scrollToBottom(event.sessionKey).catch(() => undefined);
    }
    if (event.state === 'closed' || event.state === 'failed') {
      cancelZmxRefresh(event.sessionKey);
    }
  });

  GhostexNative.addListener('onTerminalTitle', (event) => {
    const store = useTerminalStore.getState();
    if (!store.tabs.some((tab) => tab.sessionKey === event.sessionKey)) return;
    if (event.title.trim().length === 0) return;
    useTerminalStore.setState({
      tabs: store.tabs.map((tab) =>
        tab.sessionKey === event.sessionKey ? { ...tab, title: event.title } : tab,
      ),
    });
  });

  GhostexNative.addListener('onFontSizeChange', (event) => {
    // Native pinch-to-zoom ratchet; persist per session for the next open.
    useTerminalStore.getState().setFontSizeForSession(event.sessionKey, event.fontSize);
  });
}
