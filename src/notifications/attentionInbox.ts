/**
 * The attention list's inbox from the app's stores, in one place for every surface that shows it: the bell's list
 * (`AttentionList`, through `useAttentionInbox`) and the Android persistent notification
 * (`app/persistentNotification.ts`), so the two never sort or clear a session differently.
 *
 * CDXC:Notifications 2026-11-08 DECISION: User, on merging the iPhone bell (ghostex-mobile#29): "make android match
 * please, i dont want android and ios experience to diverge in terms of behavior". The bell is shared React Native
 * code; the Android notification, its one Android-only attention surface, reads the same inbox.
 */

import { enabledMachines, machineDisplayLabel, useMachinesStore, type MachineRecord } from '../machines/store';
import { useInventoryStore, type MachineInventory } from '../inventory/store';
import { useSettingsStore } from '../settings/store';
import type { ClosedSession } from '../sessions/sessionSearch';

import { buildAttentionList, machineFeed, type AttentionInbox, type MachineFeed } from './attentionRows';
import { useAttentionFeedStore, type MachineFeedState } from './feedStore';

export type Notice = { key: string; text: string };

export type AttentionInboxInputs = {
  feeds: Readonly<Record<string, MachineFeedState>>;
  closed: Readonly<Record<string, readonly ClosedSession[]>>;
  machines: readonly MachineRecord[];
  inventories: Readonly<Record<string, Pick<MachineInventory, 'summary' | 'lastError'>>>;
  settingsLoaded: boolean;
  removedKeys: readonly string[];
};

export type AttentionInboxState = {
  inbox: AttentionInbox;
  /** The enabled computers whose feed is still loading, too old, or cannot be reached now. */
  loadingIds: string[];
  legacyIds: string[];
  unreachableIds: string[];
};

/**
 * Every enabled computer's inbox. Until the removed sessions are loaded no Done or Failed row shows, whether its
 * computer answers or not, so a removed one never flashes up there (`buildAttentionList`).
 */
export function attentionInboxOf(inputs: AttentionInboxInputs): AttentionInboxState {
  const enabled = enabledMachines({ machines: [...inputs.machines] });
  const shown: MachineFeed[] = [];
  const loadingIds: string[] = [];
  const legacyIds: string[] = [];
  const unreachableIds: string[] = [];
  for (const machine of enabled) {
    const feed = inputs.feeds[machine.id];
    if (feed === undefined || feed.status === 'loading') loadingIds.push(machine.id);
    else if (feed.status === 'legacy') legacyIds.push(machine.id);
    else if (feed.status === 'unreachable') unreachableIds.push(machine.id);
    shown.push(
      machineFeed(
        { id: machine.id, label: machineDisplayLabel(machine) },
        feed,
        inputs.inventories[machine.id],
        inputs.closed[machine.id] ?? [],
      ),
    );
  }
  const inbox = buildAttentionList(shown, inputs.settingsLoaded ? new Set(inputs.removedKeys) : null);
  return { inbox, loadingIds, legacyIds, unreachableIds };
}

/** The inbox as the stores hold it now (for code outside React). */
export function currentAttentionInbox(): AttentionInbox {
  const feedState = useAttentionFeedStore.getState();
  const settings = useSettingsStore.getState();
  return attentionInboxOf({
    feeds: feedState.feeds,
    closed: feedState.closed,
    machines: useMachinesStore.getState().machines,
    inventories: useInventoryStore.getState().inventoriesByMachineId,
    settingsLoaded: settings.hydrated,
    removedKeys: settings.settings.attentionRemovedSessions,
  }).inbox;
}
