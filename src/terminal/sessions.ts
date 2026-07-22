/**
 * Terminal tab/session orchestration.
 * - sessionKey = `${machineId}:${sessionId}` for attach tabs,
 *   `${machineId}:tab:${uuid}` for plain shells (docs/ARCHITECTURE.md).
 * - Warm-session policy: up to 7 native terminal entries stay alive; the least
 *   recently used non-selected entry is evicted via closeTerminal.
 * - Attach flow (sessions-drawer.md §5 / terminal-screen.md §6): connect if
 *   needed → openTerminal with the login-shell-wrapped attach command → ~2s
 *   after the entry first opens, send the zmx viewport refresh OSC once.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { attachCommand, loginShellCommand } from '../commands/ghostexCli';
import { ensureConnected } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import { useSettingsStore } from '../settings/store';

export const MAX_WARM_SESSIONS = 7;
/**
 * zmx viewport refresh, iOS-only JS path: redraw OSC + PageUp/PageDown nudge
 * (the old VVTerm fork's postAttachNudgeSequence), sent once per attach ~2s
 * after first open. Android runs the Termux fork's visibility-gated refresh
 * natively in GhostexTerminalView (driven by the openTerminal zmxBacked flag),
 * so the JS timer must not fire there.
 */
export const ZMX_REFRESH_OSC = '\x1b]1337;ZMX_REFRESH\x07';
export const ZMX_POST_ATTACH_NUDGE = `${ZMX_REFRESH_OSC}\x1b[5~\x1b[6~`;
export const ZMX_REFRESH_DELAY_MS = 2000;

const FONT_SIZES_STORAGE_KEY = 'terminal.fontSizes.v1';

export type TerminalTabKind = 'attach' | 'shell';
export type TerminalTabState = 'opening' | 'open' | 'closed' | 'failed';

export type TerminalTab = {
  sessionKey: string;
  machineId: string;
  title: string;
  kind: TerminalTabKind;
  /** Stable Ghostex session id (attach tabs only). */
  ghostexSessionId?: string;
  state: TerminalTabState;
  error?: string;
};

export function attachSessionKey(machineId: string, sessionId: string): string {
  return `${machineId}:${sessionId}`;
}

function randomTabId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** One-shot guard so the zmx refresh OSC is sent at most once per open entry. */
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
    void GhostexNative.sendText(sessionKey, ZMX_POST_ATTACH_NUDGE).catch(() => {
      // The entry may have closed while the timer was pending.
    });
  }, ZMX_REFRESH_DELAY_MS);
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

  hydrate: () => Promise<void>;
  /** Open (or re-select) an attach tab for a remote Ghostex session. */
  attachSession: (
    machine: MachineConnectionTarget,
    session: { sessionId: string; projectId?: string; title?: string },
  ) => Promise<string>;
  /** Open a plain interactive login-shell tab on a machine. */
  openShellTab: (machine: MachineConnectionTarget, title?: string) => Promise<string>;
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
};

function isFontSizeMap(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'number');
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
      const opts: { command?: string; fontSize?: number; zmxBacked?: boolean } = {
        fontSize: initialFontSize(tab.sessionKey),
        zmxBacked: tab.kind === 'attach',
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
      set({ hydrated: true, fontSizeBySessionKey });
    },

    attachSession: async (machine, session) => {
      const sessionKey = attachSessionKey(machine.id, session.sessionId);
      const existing = get().tabs.find((tab) => tab.sessionKey === sessionKey);
      if (existing !== undefined) {
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
        state: 'opening',
      };
      const command = loginShellCommand(attachCommand(session.sessionId, session.projectId));
      return openTab(machine, tab, command);
    },

    openShellTab: async (machine, title) => {
      const sessionKey = `${machine.id}:tab:${randomTabId()}`;
      const tab: TerminalTab = {
        sessionKey,
        machineId: machine.id,
        title: title !== undefined && title.length > 0 ? title : 'Terminal',
        kind: 'shell',
        state: 'opening',
      };
      // command == null → interactive login shell in the native PTY.
      return openTab(machine, tab, null);
    },

    selectTab: (sessionKey) => {
      if (!get().tabs.some((tab) => tab.sessionKey === sessionKey)) return;
      set({ selectedSessionKey: sessionKey });
      touchWarm(sessionKey);
    },

    closeTab: async (sessionKey) => {
      cancelZmxRefresh(sessionKey);
      zmxRefreshSent.delete(sessionKey);
      dropWarm(sessionKey);
      removeTab(sessionKey);
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
      // A fresh attach gets a fresh viewport-refresh OSC.
      cancelZmxRefresh(sessionKey);
      zmxRefreshSent.delete(sessionKey);
      touchWarm(sessionKey);
      try {
        await ensureConnected(target);
        const opts: { command?: string; fontSize?: number; zmxBacked?: boolean } = {
          fontSize: initialFontSize(sessionKey),
          zmxBacked: tab.kind === 'attach',
        };
        if (tab.kind === 'attach' && tab.ghostexSessionId !== undefined) {
          opts.command = loginShellCommand(attachCommand(tab.ghostexSessionId));
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
