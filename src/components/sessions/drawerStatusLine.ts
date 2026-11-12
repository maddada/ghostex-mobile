/**
 * The one-line status under the Sessions machine tabs. Kept apart from drawerModel.ts so the rule
 * loads in a plain `bun test` (that file pulls in React Native through the machine store).
 */

import { StateCardCopy } from '../../copy';

/**
 * The status row's own words under the Sessions machine tabs: only the hint while there are no computers.
 *
 * CDXC:RemoteMachines 2026-11-12 DECISION:
 * User: "lets remove the log thing (connected to xyz)", then (Q2732 note) "we don't need to show this in the sessions
 * list except when ... user isn't able to connect. so we show this only when error. not always". The row says nothing
 * while everything works: no "Connected to <name>", no "Refreshing…" and no route label. A connecting or failing
 * computer is the machine notice's line (machineNotice.ts), each computer's link its icon (ComputerStatusIcons.tsx),
 * and Logs sit in the ☰ menu, the Connections sheet and Settings › Connection. Supersedes the 2026-10-28 line that kept
 * "Connected to <name>" and opened Logs.
 */
export function drawerStatusLine(
  /** `machineDisplayLabel` of the selected machine; null when there are no machines. */
  label: string | null,
): string {
  return label === null ? StateCardCopy.noMachines.status : '';
}
