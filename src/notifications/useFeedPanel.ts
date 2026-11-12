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
      };
    }),
  );
}

export function useFeedPanel(): FeedPanel {
  const feeds = useAttentionFeedStore((state) => state.feeds);
  const machines = useMachinesStore((state) => state.machines);
  return useMemo(() => panelOf(feeds, machines), [feeds, machines]);
}
