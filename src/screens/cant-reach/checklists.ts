/**
 * The "Can't reach" checklists (docs/2026-09-03/mobile-setup/
 * mobile-09-cant-reach.html), one per transport, ordered by how often each
 * cause is the real one; a plain SSH computer gets its own, without Tailscale. A step the phone can verify itself carries a `verify`
 * key and is ticked from live state; a step with a fix inside the app carries
 * an `action` the screen turns into a button.
 */

import { CantReachCopy } from '../../copy/machines';
import { isTailscaleSshMachine, type MachineRecord } from '../../machines/store';

export type ChecklistVerify = 'tailscaleOnPhone';
export type ChecklistAction = 'scanNewCode' | 'editAddress';

export type ChecklistStep = {
  id: string;
  title: string;
  detail: string;
  verify?: ChecklistVerify;
  action?: { kind: ChecklistAction; label: string };
};

const easyConnect = CantReachCopy.easyConnect;
const tailscale = CantReachCopy.tailscale;

export const EASY_CONNECT_CHECKLIST: readonly ChecklistStep[] = [
  { id: 'awake', title: easyConnect.awake.title, detail: easyConnect.awake.detail },
  { id: 'ghostexOpen', title: easyConnect.ghostexOpen.title, detail: easyConnect.ghostexOpen.detail },
  { id: 'easyConnectOn', title: easyConnect.easyConnectOn.title, detail: easyConnect.easyConnectOn.detail },
  {
    id: 'unpaired',
    title: easyConnect.unpaired.title,
    detail: easyConnect.unpaired.detail,
    action: { kind: 'scanNewCode', label: easyConnect.unpaired.button },
  },
];

export const TAILSCALE_CHECKLIST: readonly ChecklistStep[] = [
  {
    id: 'tailscaleOnPhone',
    title: tailscale.tailscaleOnPhone.title,
    detail: tailscale.tailscaleOnPhone.detailChecking,
    verify: 'tailscaleOnPhone',
  },
  {
    id: 'tailscaleOnComputer',
    title: tailscale.tailscaleOnComputer.title,
    detail: tailscale.tailscaleOnComputer.detail,
  },
  { id: 'awake', title: tailscale.awake.title, detail: tailscale.awake.detail },
  {
    id: 'address',
    title: tailscale.address.title,
    detail: tailscale.address.detail,
    action: { kind: 'editAddress', label: tailscale.address.button },
  },
];

/** A computer reached by plain SSH, not through a tailnet: no Tailscale steps, and awake and address in plain words. */
export const PLAIN_SSH_CHECKLIST: readonly ChecklistStep[] = [
  { id: 'awake', title: tailscale.plainSsh.awake.title, detail: tailscale.plainSsh.awake.detail },
  {
    id: 'address',
    title: tailscale.plainSsh.address.title,
    detail: tailscale.plainSsh.address.detail,
    action: { kind: 'editAddress', label: tailscale.plainSsh.address.button },
  },
];

/**
 * CDXC:RemotePairing 2026-11-16 DECISION:
 * User (yes to the suggestions after "SSH · <address>" labels landed): a computer reached by plain SSH, not through
 * a tailnet (`isTailscaleSshMachine`), gets no Tailscale steps (neither on this phone nor on the computer), and its
 * awake and address lines say nothing of the tailnet or Tailscale IPs; Tailscale computers keep their checklist.
 */
export function checklistFor(
  machine: Pick<MachineRecord, 'transport' | 'host' | 'tailscaleSsh'>,
): readonly ChecklistStep[] {
  if (machine.transport === 'tailcat') return EASY_CONNECT_CHECKLIST;
  return isTailscaleSshMachine(machine) ? TAILSCALE_CHECKLIST : PLAIN_SSH_CHECKLIST;
}
