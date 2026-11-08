/**
 * CDXC:RemotePairing 2026-11-08 DECISION:
 * User (GitHub #495, Q1721): a new phone shows as Pending on the computer and on the phones already
 * paired, and revoking a device is one tap on any trusted device. Edit machine of an Easy Connect
 * computer lists what that computer has paired (`/api/pairedDevices` over the chat link, with this
 * phone's device token): phones waiting for approval with their three words and Deny, and paired
 * devices with Remove, which takes away the device's SSH key, token and approver key at once.
 * Approve on a Pending row signs its approval request after Face ID / the fingerprint / the screen
 * lock (`security/approvals.ts`), so it is never a plain button an agent could press.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { EditMachineCopy } from '../../copy';
import { chatMachineLink } from '../../chat/rust/machine-link';
import type { ApprovalRequest } from '../../security/approvalPayload';
import { approveRequest } from '../../security/approvals';
import { hasApproverKey } from '../../security/approverKey';
import type { MachineRecord } from '../../machines/store';
import { useFormStyles } from './styles';

const REFRESH_MS = 5000;
const RPC_TIMEOUT_MS = 15_000;
/** Removing can wait on a Windows administrator prompt on the computer. */
const REMOVE_TIMEOUT_MS = 180_000;

type ListedDevice = { id: string; name: string; legacy: boolean };
type PendingDevice = { id: string; name: string; words: string[]; approvalId: string };
export type PairedDevicesList = { devices: ListedDevice[]; pending: PendingDevice[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `/api/pairedDevices`'s answer; `pending` is empty from a computer older than pairing v2. */
export function readPairedDevicesList(result: unknown): PairedDevicesList | null {
  if (!isRecord(result) || !Array.isArray(result.devices)) return null;
  const devices = result.devices.filter(isRecord).flatMap((device) =>
    typeof device.id === 'string' && typeof device.name === 'string'
      ? [{ id: device.id, name: device.name, legacy: device.status === 'legacy' }]
      : [],
  );
  const pending = (Array.isArray(result.pending) ? result.pending : []).filter(isRecord).flatMap((device) => {
    const words = Array.isArray(device.words) ? device.words.filter((word) => typeof word === 'string') : [];
    return typeof device.id === 'string' && typeof device.name === 'string' && words.length > 0
      ? [{ id: device.id, name: device.name, words, approvalId: typeof device.approvalId === 'string' ? device.approvalId : '' }]
      : [];
  });
  return { devices, pending };
}

export default function PairedDevicesSection({ machine, reachable }: { machine: MachineRecord; reachable: boolean }) {
  const formStyles = useFormStyles();
  const copy = EditMachineCopy.pairedDevices;
  const [list, setList] = useState<PairedDevicesList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const answer = await chatMachineLink(machine).rpc('pairedDevices', {}, RPC_TIMEOUT_MS);
    if (answer.error === null) setList(readPairedDevicesList(answer.result));
  }, [machine]);

  useEffect(() => {
    if (!reachable || machine.transport !== 'tailcat') return;
    let stopped = false;
    const tick = (): void => {
      if (!stopped) void refresh().catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [machine.transport, reachable, refresh]);

  const remove = useCallback(
    async (deviceId: string): Promise<void> => {
      setBusy(deviceId);
      try {
        const answer = await chatMachineLink(machine).rpc('removePairedDevice', { deviceId }, REMOVE_TIMEOUT_MS);
        if (answer.error !== null) Alert.alert(copy.removeFailed, answer.error.message);
        else setList(readPairedDevicesList(answer.result));
      } finally {
        setBusy(null);
      }
    },
    [copy.removeFailed, machine],
  );

  /** Face ID / the fingerprint, then the signed approval (`security/approvals.ts`). */
  const approve = useCallback(
    async (device: PendingDevice): Promise<void> => {
      setBusy(device.id);
      try {
        const answer = await chatMachineLink(machine).rpc('readApprovalRequest', { id: device.approvalId }, RPC_TIMEOUT_MS);
        const request = (answer.result as { request?: ApprovalRequest } | null)?.request;
        if (answer.error !== null || request === undefined) {
          Alert.alert(copy.approveFailed, answer.error?.message ?? copy.noLongerWaiting);
          return;
        }
        await approveRequest(machine, request);
        await refresh();
      } catch (error) {
        Alert.alert(copy.approveFailed, error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [copy.approveFailed, copy.noLongerWaiting, machine, refresh],
  );

  const confirmRemove = (device: ListedDevice): void => {
    const self = device.id === machine.deviceId;
    Alert.alert(copy.removeTitle(device.name), self ? copy.removeSelfDetail : copy.removeDetail, [
      { text: copy.cancel, style: 'cancel' },
      { text: copy.remove, style: 'destructive', onPress: () => void remove(device.id) },
    ]);
  };

  if (machine.transport !== 'tailcat' || list === null) return null;
  return (
    <>
      <Text style={formStyles.sectionLabel}>{copy.title}</Text>
      <View style={formStyles.rowsCard}>
        {list.pending.map((device, index) => (
          <View key={device.id} style={[formStyles.row, index === 0 ? formStyles.rowFirst : null]}>
            <View style={formStyles.rowMain}>
              <Text style={formStyles.rowLabel}>{copy.waiting(device.name)}</Text>
              <Text style={formStyles.rowLabel}>{device.words.join(' · ')}</Text>
              <Text style={formStyles.rowDetail}>{copy.waitingDetail}</Text>
            </View>
            <View style={{ gap: 6 }}>
              {hasApproverKey() && device.approvalId ? (
                <SetupButton small label={copy.approve} disabled={busy !== null} onPress={() => void approve(device)} />
              ) : null}
              <SetupButton small label={copy.deny} disabled={busy !== null} onPress={() => void remove(device.id)} />
            </View>
          </View>
        ))}
        {list.devices.map((device, index) => (
          <View
            key={device.id}
            style={[formStyles.row, index === 0 && list.pending.length === 0 ? formStyles.rowFirst : null]}
          >
            <View style={formStyles.rowMain}>
              <Text style={formStyles.rowLabel}>
                {device.id === machine.deviceId ? copy.thisPhone(device.name) : device.name}
              </Text>
              {device.legacy ? <Text style={formStyles.rowDetail}>{copy.legacy}</Text> : null}
            </View>
            <SetupButton
              small
              label={copy.remove}
              disabled={busy !== null}
              onPress={() => confirmRemove(device)}
            />
          </View>
        ))}
      </View>
    </>
  );
}
