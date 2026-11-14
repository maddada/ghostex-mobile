/**
 * A sidebar extension's own icons (its mode button's, a block's `*.svg`), read from the computer it is installed on:
 * gxserver serves them at `/ext/<id>/<file>` (server/src/extensions/serve.rs), reached through the chat link's forward
 * and token, the way the computer icons are read (machines/computerIcons.ts). They are drawn with react-native-svg,
 * which the app already ships, in one colour: `currentColor` takes the ink of the place, as the desktop draws them in
 * its icon grey (native_sidebar/extension_panel/icons.rs). Until a file arrives, and when it can't (a computer
 * without a socket route, a missing or oversized file), Tabler's puzzle stands in, as on the desktop.
 *
 * CDXC:Extensions 2026-11-14 WHY:
 * The coordinator relayed the user: no letter-in-a-square icons where the desktop shows a real one. So the phone
 * fetches the extension's own SVG instead of drawing its first letter.
 */

import { useEffect, type ReactElement } from 'react';
import { SvgXml } from 'react-native-svg';
import { create } from 'zustand';

import { TAG_ICONS } from '../assets/tablerIcons.generated';
import { chatMachineLink } from '../chat/rust/machine-link';
import { useMachinesStore, type MachineRecord } from '../machines/store';

/** The desktop's cap on an extension icon (icons.rs). */
const MAX_BYTES = 256 * 1024;
const READ_TIMEOUT_MS = 8000;

/** By `<machineId>|<path>`: the SVG text, or `false` when the computer had none to give. */
const useExtensionIconsStore = create<{ icons: Readonly<Record<string, string | false>> }>()(() => ({ icons: {} }));

/** The reads started in this run (dropped again when the computer was unreachable, so it is asked once it's back). */
const asked = new Set<string>();

/** The served path of an extension icon: its `/ext/<id>/…` url, or a file in its folder. Null for a Tabler name. */
export function extensionIconPath(extensionId: string, icon: string | undefined): string | null {
  const trimmed = icon?.trim() ?? '';
  if (!trimmed.toLowerCase().endsWith('.svg')) return null;
  if (trimmed.startsWith('/ext/')) return trimmed.startsWith(`/ext/${extensionId}/`) ? trimmed : null;
  // A path inside the extension's own folder; gxserver refuses anything that climbs out of it.
  if (trimmed.startsWith('/') || trimmed.split('/').includes('..')) return null;
  return `/ext/${extensionId}/${trimmed.split('/').map(encodeURIComponent).join('/')}`;
}

async function readExtensionIcon(machine: MachineRecord, path: string): Promise<void> {
  const key = `${machine.id}|${path}`;
  if (asked.has(key)) return;
  asked.add(key);
  const settle = (value: string | false) =>
    useExtensionIconsStore.setState((state) => ({ icons: { ...state.icons, [key]: value } }));
  try {
    const link = await chatMachineLink(machine).gxserverLink();
    if (link === null) {
      // No socket route (an older computer, the SSH-only route): the puzzle stays.
      settle(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
      const response = await fetch(`http://127.0.0.1:${link.localPort}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${link.authToken}` },
        signal: controller.signal,
      });
      const svg = response.ok ? await response.text() : '';
      settle(svg.length > 0 && svg.length <= MAX_BYTES && svg.includes('<svg') ? svg : false);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Unreachable for now: the next draw asks again.
    asked.delete(key);
  }
}

/**
 * An extension's own SVG icon in `color` (its `currentColor`), or the puzzle while it loads or when it can't. A Tabler
 * name is not this component's: PanelIcon draws those.
 */
export function ExtensionIcon({
  machineId,
  path,
  size,
  color,
}: {
  machineId: string;
  path: string;
  size: number;
  color: string;
}): ReactElement {
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);
  const svg = useExtensionIconsStore((state) => state.icons[`${machineId}|${path}`]);
  useEffect(() => {
    if (svg === undefined && machine !== null) void readExtensionIcon(machine, path);
  }, [machine, path, svg]);
  const Puzzle = TAG_ICONS.feature;
  if (typeof svg !== 'string') return <Puzzle size={size} color={color} />;
  return (
    <SvgXml
      xml={svg}
      width={size}
      height={size}
      color={color}
      onError={() =>
        useExtensionIconsStore.setState((state) => ({ icons: { ...state.icons, [`${machineId}|${path}`]: false } }))
      }
    />
  );
}
