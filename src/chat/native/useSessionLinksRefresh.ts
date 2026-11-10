/**
 * Keeps an open chat's session links current: re-reads the computer's summary now and once a minute
 * while the chat shows, since the Sessions list polls only while it is on screen and gxserver re-reads
 * a link's state once a minute. The Links pill on the chat's working card (`cards/WorkingCard.tsx`)
 * and its sheet (`SessionLinksSheet.tsx`) read the result. Moved from the links strip under the chat's
 * header, which the Links pill replaced (CDXC:SessionLinks 2026-10-28 in gx-core
 * `sidebar_view/links.rs`).
 */

import { useEffect, useEffectEvent } from 'react';

import { useInventoryStore } from '../../inventory/store';
import type { MachineRecord } from '../../machines/store';

const LINKS_REFRESH_MS = 60_000;

export function useSessionLinksRefresh(machine: MachineRecord | null, sessionId: string | undefined, active: boolean): void {
  /*
   * CDXC:SessionLinks 2026-11-10 WHY: the effect is keyed on the computer's id, not its record. Every
   * successful read calls `markConnected`, which replaces the record, so keying on the object made each
   * finished read start the next one: a phone with a chat open ran `ghostex sessions --json
   * --mobile-summary` about 3.5 times a second (70 runs in 20 s) instead of once a minute, about half of
   * gxserver's CPU. The refresh still reads the latest record (host or port edits) through an effect event.
   */
  const machineId = machine?.id;
  const refresh = useEffectEvent(() => {
    if (machine !== null) void useInventoryStore.getState().refreshMachineFresh(machine);
  });
  useEffect(() => {
    if (!active || machineId === undefined || sessionId === undefined) return;
    refresh();
    const timer = setInterval(refresh, LINKS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, machineId, sessionId]);
}
