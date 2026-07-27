import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type {
  KeyModifiers,
  TerminalKey,
} from '../../modules/ghostex-native/src/GhostexNative.types';

const AGENT_HOTKEYS_STORAGE_KEY = 'agentHotkeys.v1';

export const AGENT_HOTKEY_LABEL_MAX_LENGTH = 8;
export const AGENT_HOTKEYS_MAX_PER_AGENT = 14;
export const AGENT_HOTKEY_SEQUENCE_DELAY_MS = 120;

export const CONFIGURABLE_AGENT_IDS = ['codex', 'claude', 'pi'] as const;
export type ConfigurableAgentId = (typeof CONFIGURABLE_AGENT_IDS)[number];

export type AgentHotkeyStep = {
  key: TerminalKey;
  mods: KeyModifiers;
};

export type AgentHotkey = {
  id: string;
  label: string;
  steps: AgentHotkeyStep[];
};

export type AgentHotkeyProfiles = Record<ConfigurableAgentId, AgentHotkey[]>;

export const AGENT_NAMES: Record<ConfigurableAgentId, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  pi: 'Pi',
};

const NAMED_KEYS = [
  'escape',
  'tab',
  'enter',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageUp',
  'pageDown',
  'up',
  'down',
  'left',
  'right',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
] as const;

const NAMED_KEY_ALIASES: Record<string, TerminalKey> = {
  esc: 'escape',
  escape: 'escape',
  tab: 'tab',
  enter: 'enter',
  return: 'enter',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  ins: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pageUp',
  pgup: 'pageUp',
  pagedown: 'pageDown',
  pgdn: 'pageDown',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => {
      const key = `f${index + 1}`;
      return [key, key];
    }),
  ),
};

function step(key: TerminalKey, mods: KeyModifiers): AgentHotkeyStep {
  return { key, mods };
}

function shortcut(
  id: string,
  label: string,
  key: TerminalKey,
  mods: KeyModifiers,
): AgentHotkey {
  return { id, label, steps: [step(key, mods)] };
}

function doubleCtrlC(id: string, label: string): AgentHotkey {
  return {
    id,
    label,
    steps: [step('c', { ctrl: true }), step('c', { ctrl: true })],
  };
}

export function defaultAgentHotkeys(): AgentHotkeyProfiles {
  return {
    codex: [
      shortcut('codex-history', 'HISTORY', 'r', { ctrl: true }),
      shortcut('codex-clear', 'CLEAR', 'c', { ctrl: true }),
      doubleCtrlC('codex-exit', 'EXIT'),
      shortcut('codex-reason-down', 'REAS−', ',', { alt: true }),
      shortcut('codex-reason-up', 'REAS+', '.', { alt: true }),
      shortcut('codex-mode', 'MODE', 'tab', { shift: true }),
      shortcut('codex-transcript', 'TRANSCR', 't', { ctrl: true }),
    ],
    claude: [
      shortcut('claude-undo', 'UNDO', '_', { ctrl: true, shift: true }),
      shortcut('claude-clear', 'CLEAR', 'c', { ctrl: true }),
      doubleCtrlC('claude-exit', 'EXIT'),
      shortcut('claude-auto', 'AUTO', 'tab', { shift: true }),
      shortcut('claude-suspend', 'SUSPEND', 'z', { ctrl: true }),
      shortcut('claude-tasks', 'TASKS', 't', { ctrl: true }),
      shortcut('claude-model', 'MODEL', 'p', { alt: true }),
      shortcut('claude-stash', 'STASH', 's', { ctrl: true }),
      shortcut('claude-editor', 'EDITOR', 'g', { ctrl: true }),
    ],
    pi: [
      shortcut('pi-clear-exit', 'CLR/EXIT', 'c', { ctrl: true }),
      shortcut('pi-exit-empty', 'EXIT', 'd', { ctrl: true }),
      shortcut('pi-suspend', 'SUSPEND', 'z', { ctrl: true }),
      shortcut('pi-thinking-level', 'THINK', 'tab', { shift: true }),
      shortcut('pi-model-ctrl-p', 'MODEL', 'p', { ctrl: true }),
      shortcut('pi-model-option-m', '⌥MODEL', 'm', { alt: true }),
      shortcut('pi-model-shift-ctrl-p', '⇧MODEL', 'p', { ctrl: true, shift: true }),
      shortcut('pi-model-selector', 'SELECT', 'l', { ctrl: true }),
      shortcut('pi-tools', 'TOOLS', 'o', { ctrl: true }),
      shortcut('pi-thinking', 'BLOCKS', 't', { ctrl: true }),
      shortcut('pi-editor', 'EDITOR', 'g', { ctrl: true }),
      shortcut('pi-follow-up', 'QUEUE', 'enter', { alt: true }),
    ],
  };
}

function cloneHotkey(hotkey: AgentHotkey): AgentHotkey {
  return {
    ...hotkey,
    steps: hotkey.steps.map((hotkeyStep) => ({
      key: hotkeyStep.key,
      mods: { ...hotkeyStep.mods },
    })),
  };
}

function cloneProfiles(profiles: AgentHotkeyProfiles): AgentHotkeyProfiles {
  return {
    codex: profiles.codex.map(cloneHotkey),
    claude: profiles.claude.map(cloneHotkey),
    pi: profiles.pi.map(cloneHotkey),
  };
}

function isAgentId(value: unknown): value is ConfigurableAgentId {
  return CONFIGURABLE_AGENT_IDS.includes(value as ConfigurableAgentId);
}

function sanitizeStep(value: unknown): AgentHotkeyStep | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.key !== 'string' || record.key.length === 0) return null;
  const modsRecord =
    typeof record.mods === 'object' && record.mods !== null
      ? (record.mods as Record<string, unknown>)
      : {};
  const mods: KeyModifiers = {
    ctrl: modsRecord.ctrl === true,
    alt: modsRecord.alt === true,
    shift: modsRecord.shift === true,
  };
  if (!mods.ctrl && !mods.alt && !mods.shift) return null;
  return { key: record.key, mods };
}

function sanitizeHotkey(value: unknown): AgentHotkey | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    typeof record.label !== 'string' ||
    record.label.trim().length === 0 ||
    record.label.trim().length > AGENT_HOTKEY_LABEL_MAX_LENGTH ||
    !Array.isArray(record.steps) ||
    record.steps.length === 0 ||
    record.steps.length > 4
  ) {
    return null;
  }
  const steps = record.steps.map(sanitizeStep);
  if (steps.some((item) => item === null)) return null;
  return {
    id: record.id,
    label: record.label.trim(),
    steps: steps as AgentHotkeyStep[],
  };
}

function sanitizeProfiles(value: unknown): AgentHotkeyProfiles | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const profiles = defaultAgentHotkeys();
  for (const agentId of CONFIGURABLE_AGENT_IDS) {
    const rawProfile = record[agentId];
    if (!Array.isArray(rawProfile) || rawProfile.length > AGENT_HOTKEYS_MAX_PER_AGENT) return null;
    const profile = rawProfile.map(sanitizeHotkey);
    if (profile.some((item) => item === null)) return null;
    profiles[agentId] = profile as AgentHotkey[];
  }
  return profiles;
}

function normalizeNamedKey(value: string): TerminalKey | null {
  const compact = value.toLowerCase().replaceAll('-', '').replaceAll('_', '');
  return NAMED_KEY_ALIASES[compact] ?? (value.length === 1 ? value : null);
}

/**
 * Parse one shortcut or a short sequence. Examples:
 * `ctrl+r`, `option+,`, `shift+tab`, `ctrl+c then ctrl+c`.
 */
export function parseAgentHotkey(value: string): AgentHotkeyStep[] | string {
  const chords = value
    .trim()
    .split(/\s+(?:then|→)\s+/iu)
    .map((item) => item.trim())
    .filter(Boolean);
  if (chords.length === 0) return 'Enter a hotkey such as Ctrl+R.';
  if (chords.length > 4) return 'A hotkey sequence can contain at most four key presses.';

  const steps: AgentHotkeyStep[] = [];
  for (const chord of chords) {
    const parts = chord.split('+').map((part) => part.trim());
    if (parts.some((part) => part.length === 0)) return `Invalid hotkey: ${chord}`;

    const mods: KeyModifiers = {};
    let key: TerminalKey | null = null;
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === 'ctrl' || lower === 'control' || lower === '^') {
        mods.ctrl = true;
      } else if (lower === 'alt' || lower === 'option' || lower === 'opt' || part === '⌥') {
        mods.alt = true;
      } else if (lower === 'shift' || part === '⇧') {
        mods.shift = true;
      } else if (key === null) {
        key = normalizeNamedKey(part);
      } else {
        return `Hotkey "${chord}" contains more than one key.`;
      }
    }
    if (key === null) return `Hotkey "${chord}" is missing its key.`;
    if (!mods.ctrl && !mods.alt && !mods.shift) {
      return `Hotkey "${chord}" needs Ctrl, Option, or Shift.`;
    }
    steps.push({ key, mods });
  }
  return steps;
}

function displayKey(key: TerminalKey): string {
  const named = NAMED_KEYS.find((candidate) => candidate === key);
  if (named === 'pageUp') return 'PageUp';
  if (named === 'pageDown') return 'PageDown';
  if (named !== undefined) return named.length <= 3 ? named.toUpperCase() : named;
  return key.toUpperCase();
}

export function formatAgentHotkeySteps(steps: AgentHotkeyStep[]): string {
  return steps
    .map(({ key, mods }) => {
      const parts: string[] = [];
      if (mods.ctrl) parts.push('Ctrl');
      if (mods.alt) parts.push('Option');
      if (mods.shift) parts.push('Shift');
      parts.push(displayKey(key));
      return parts.join('+');
    })
    .join(' then ');
}

type AgentHotkeysState = {
  hydrated: boolean;
  profiles: AgentHotkeyProfiles;
  hydrate: () => Promise<void>;
  saveProfile: (agentId: ConfigurableAgentId, hotkeys: AgentHotkey[]) => string | null;
  resetAgent: (agentId: ConfigurableAgentId) => void;
};

export const useAgentHotkeysStore = create<AgentHotkeysState>()((set, get) => ({
  hydrated: false,
  profiles: defaultAgentHotkeys(),

  hydrate: async () => {
    if (get().hydrated) return;
    let profiles = defaultAgentHotkeys();
    try {
      const raw = await AsyncStorage.getItem(AGENT_HOTKEYS_STORAGE_KEY);
      if (raw !== null) {
        profiles = sanitizeProfiles(JSON.parse(raw)) ?? profiles;
      }
    } catch {
      // Corrupt persisted profiles restore the built-in shortcuts.
    }
    set({ hydrated: true, profiles });
  },

  saveProfile: (agentId, hotkeys) => {
    if (!isAgentId(agentId)) return 'Unsupported agent.';
    if (hotkeys.length > AGENT_HOTKEYS_MAX_PER_AGENT) {
      return `An agent can have at most ${AGENT_HOTKEYS_MAX_PER_AGENT} hotkeys.`;
    }
    const sanitized = hotkeys.map(sanitizeHotkey);
    if (sanitized.some((item) => item === null)) return 'One or more hotkeys are invalid.';
    const profiles = cloneProfiles(get().profiles);
    profiles[agentId] = sanitized as AgentHotkey[];
    set({ profiles });
    void AsyncStorage.setItem(AGENT_HOTKEYS_STORAGE_KEY, JSON.stringify(profiles));
    return null;
  },

  resetAgent: (agentId) => {
    const profiles = cloneProfiles(get().profiles);
    profiles[agentId] = defaultAgentHotkeys()[agentId];
    set({ profiles });
    void AsyncStorage.setItem(AGENT_HOTKEYS_STORAGE_KEY, JSON.stringify(profiles));
  },
}));
