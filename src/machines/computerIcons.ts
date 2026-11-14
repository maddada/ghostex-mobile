/**
 * Each computer's icon, as its own gxserver keeps it (`/api/computerIcon`, the desktop's server/src/computer_icon.rs).
 *
 * CDXC:RemoteMachines 2026-11-12 DECISION:
 * User: "i want each machine to please have a different icon ... that i can pick per machine in settings", then
 * "Yes, both" to the phone following the desktop. The phone draws each computer's picked icon on its computer tab and,
 * while more than one computer is connected, at the end of every session row, as the desktop's sidebar does
 * (native_sidebar/computer_mark.rs). The icon is read from the computer itself, so the phone shows what was picked on
 * any device. A computer whose Ghostex predates the icon (or that has no socket route) keeps today's look: the cloud
 * on its tab and nothing on its rows.
 *
 * CDXC:RemoteMachines 2026-11-14 DECISION:
 * User: "we need to show all the logos in the picker for machine icons pls. And we need to be smarter about the icon
 * shown". The icons include the systems' logos (Apple, Windows, Tux and Linux distributions), and an unpicked icon is
 * gx-core's `computer_icon_asset`: the logo the computer's gxserver names (`logo`, its Linux distribution's where
 * known), else its system's logo, else its kind (laptop or desktop), else the desktop.
 */

import { create } from 'zustand';

import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from './credentials';

/** What one computer's gxserver answered. */
export type ComputerIconFacts = {
  /** The picked icon's id, null when none was picked. */
  icon: string | null;
  /** `laptop` or `desktop`, null when that computer can't tell. */
  kind: string | null;
  /** `macos`, `windows` or `linux`. */
  platform: string | null;
  /** The logo it wears unpicked (an icon id); null from a gxserver older than the logos. */
  logo?: string | null;
};

/** The icons a computer can wear: gx-core `COMPUTER_ICONS`' ids, which name `COMPUTER_ICON_DRAWINGS`. */
export const COMPUTER_ICON_IDS = [
  'apple',
  'windows',
  'linux',
  'ubuntu',
  'debian',
  'fedora',
  'arch',
  'redhat',
  'laptop',
  'desktop',
  'server',
  'cloud',
  'terminal',
  'cpu',
  'database',
  'home',
  'building',
  'briefcase',
  'world',
  'bolt',
  'star',
  'moon',
  'leaf',
  'rocket',
  'flask',
  'coffee',
] as const;

/** The logo icons' drawings; every other icon's drawing has its id's name. */
const LOGO_DRAWINGS: Readonly<Record<string, string>> = {
  apple: 'brandApple',
  windows: 'brandWindows',
  linux: 'brandLinux',
  ubuntu: 'brandUbuntu',
  debian: 'brandDebian',
  fedora: 'brandFedora',
  arch: 'brandArch',
  redhat: 'brandRedhat',
};

/** A system's logo icon, for a computer whose gxserver doesn't name its own. */
const SYSTEM_LOGOS: Readonly<Record<string, string>> = {
  windows: 'windows',
  macos: 'apple',
  linux: 'linux',
};

function offered(id: string | null | undefined): string | null {
  return id != null && (COMPUTER_ICON_IDS as readonly string[]).includes(id) ? id : null;
}

/** The drawing a computer wears (a key of `COMPUTER_ICON_DRAWINGS`): gx-core `computer_icon_asset`. */
export function computerIconDrawing(facts: ComputerIconFacts): string {
  const id =
    offered(facts.icon) ??
    offered(facts.logo) ??
    offered(SYSTEM_LOGOS[facts.platform ?? '']) ??
    offered(facts.kind) ??
    'desktop';
  return LOGO_DRAWINGS[id] ?? id;
}

type ComputerIconsState = {
  /** By machine id: the computer's answer. Absent while unknown or when its Ghostex predates the icon. */
  facts: Readonly<Record<string, ComputerIconFacts>>;
  /** The computers connected now, sorted. */
  connected: readonly string[];
};

export const useComputerIconsStore = create<ComputerIconsState>()(() => ({ facts: {}, connected: [] }));

/** The computers asked in this run (asked again after `forgetComputerIcon`). */
const asked = new Set<string>();

const PROTOCOL_VERSION = 1;
const READ_TIMEOUT_MS = 8000;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Asks that computer for its icon once a run; a computer that can't answer keeps today's look. */
export async function readComputerIcon(machine: MachineConnectionTarget): Promise<void> {
  if (asked.has(machine.id)) return;
  asked.add(machine.id);
  try {
    const link = await chatMachineLink(machine).gxserverLink();
    if (link === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    let body: unknown;
    try {
      const response = await fetch(`http://127.0.0.1:${link.localPort}/api/computerIcon`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${link.authToken}`,
          'x-gxserver-protocol-version': String(PROTOCOL_VERSION),
        },
        body: JSON.stringify({
          requestId: `computer-icon-${Date.now().toString(36)}`,
          protocolVersion: PROTOCOL_VERSION,
          params: {},
        }),
        signal: controller.signal,
      });
      // An older gxserver has no such endpoint: today's look.
      if (!response.ok) return;
      body = await response.json();
    } finally {
      clearTimeout(timer);
    }
    const result =
      typeof body === 'object' && body !== null && 'result' in body ? (body as { result: unknown }).result : null;
    if (typeof result !== 'object' || result === null) return;
    const record = result as Record<string, unknown>;
    const next: ComputerIconFacts = {
      icon: text(record.icon),
      kind: text(record.kind),
      platform: text(record.platform),
      logo: text(record.logo),
    };
    useComputerIconsStore.setState((state) => ({ facts: { ...state.facts, [machine.id]: next } }));
  } catch {
    // Unreachable for now: asked again once it connects again (`forgetComputerIcon`).
    asked.delete(machine.id);
  }
}

/** A computer that dropped its connection is asked again when it is back (its icon may have changed meanwhile). */
export function forgetComputerIcon(machineId: string): void {
  asked.delete(machineId);
}

/** Tells the store which computers are connected now (the sessions screen does, from their inventories). */
export function setConnectedComputers(machineIds: readonly string[]): void {
  const next = [...machineIds].sort();
  const current = useComputerIconsStore.getState().connected;
  if (current.length === next.length && current.every((id, index) => id === next[index])) return;
  useComputerIconsStore.setState({ connected: next });
}

/** The drawing of a computer's tab, while its icon is known. */
export function useComputerTabIcon(machineId: string): string | undefined {
  return useComputerIconsStore((state) => {
    const facts = state.facts[machineId];
    return facts === undefined ? undefined : computerIconDrawing(facts);
  });
}

/** The drawing at the end of a session row on that computer: only while more than one computer is connected. */
export function useSessionComputerIcon(machineId: string | undefined): string | null {
  return useComputerIconsStore((state) => {
    if (machineId === undefined || state.connected.length < 2) return null;
    const facts = state.facts[machineId];
    return facts === undefined ? null : computerIconDrawing(facts);
  });
}
