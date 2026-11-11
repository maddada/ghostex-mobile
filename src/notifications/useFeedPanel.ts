/**
 * The Notifications list's rows from the app's stores (`buildFeedPanel`), for the list and the bell's number, so the
 * two never count differently: every enabled computer's feed, an offline one's rows held back until it is back.
 */

import { useMemo } from 'react';

import { enabledMachines, machineDisplayLabel, useMachinesStore, type MachineRecord } from '../machines/store';
import { buildFeedPanel, type FeedPanel } from './feedPanel';
import { useAttentionFeedStore, type MachineFeedState } from './feedStore';

function panelOf(feeds: Readonly<Record<string, MachineFeedState>>, machines: MachineRecord[]): FeedPanel {
  return buildFeedPanel(
    enabledMachines({ machines }).map((machine) => {
      const feed = feeds[machine.id];
      return {
        machineId: machine.id,
        machineLabel: machineDisplayLabel(machine),
        online: feed?.status === 'ready',
        rows: feed?.rows ?? [],
        ...(feed?.nextUnreadId !== undefined ? { nextUnreadId: feed.nextUnreadId } : {}),
        ...(feed?.nextUnreadDeferredAt !== undefined ? { nextUnreadDeferredAt: feed.nextUnreadDeferredAt } : {}),
      };
    }),
  );
}

export function useFeedPanel(): FeedPanel {
  const feeds = useAttentionFeedStore((state) => state.feeds);
  const machines = useMachinesStore((state) => state.machines);
  return useMemo(() => panelOf(feeds, machines), [feeds, machines]);
}

/** The list's rows as the stores hold them now (for code outside React, such as Next unread after its reads). */
export function currentFeedPanel(): FeedPanel {
  return panelOf(useAttentionFeedStore.getState().feeds, useMachinesStore.getState().machines);
}
