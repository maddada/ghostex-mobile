/**
 * CDXC:ServerLinks 2026-11-19 DECISION:
 * User (Q4194, 5A on the server link work, GitHub #674): the phone gets the computer's Paired
 * computers like the desktop's Settings > Remote: each server link the computer keeps with another
 * computer (two headless servers linked with `ghostex computers add`), where it stands, a row-wide
 * Agent access switch and Remove, which ends the link on both computers. It asks that computer's
 * own gxserver (`serverLinks` over the chat link, with this phone's own token). A gxserver without
 * server links answers the call as unknown, and the section doesn't show, so nothing changes for a
 * computer that hasn't updated.
 * SEE-ALSO: Ghostex server/src/remote_access/server_link_dialer.rs (`answer_local`),
 * apps/desktop/src/app/window/settings_modal/tabs/remote/server_links.rs (the desktop's list).
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';

import { SwitchRow } from '../../components/common/SwitchRow';
import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { EditMachineCopy } from '../../copy/machines';
import { chatMachineLink } from '../../chat/rust/machine-link';
import { machineDisplayLabel, machineName, type MachineRecord } from '../../machines/store';
import { useAppearance } from '../../theme/useAppearance';
import { useFormStyles } from './styles';

const REFRESH_MS = 10_000;
const RPC_TIMEOUT_MS = 15_000;
/** Removing tells the other computer first, through its tunnel. */
const REMOVE_TIMEOUT_MS = 60_000;

export type ServerLinkRow = {
  serverId: string;
  name: string;
  state: string;
  outgoing: boolean;
  incoming: boolean;
  agentAccess: boolean;
  error: string | null;
  words: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `serverLinks` `list`'s answer; `null` for anything else. */
export function readServerLinks(result: unknown): ServerLinkRow[] | null {
  if (!isRecord(result) || !Array.isArray(result.links)) return null;
  return result.links.filter(isRecord).flatMap((row) =>
    typeof row.serverId === 'string' && row.serverId !== '' && typeof row.name === 'string'
      ? [
          {
            serverId: row.serverId,
            name: row.name,
            state: typeof row.state === 'string' ? row.state : '',
            outgoing: row.outgoing === true,
            incoming: row.incoming === true,
            agentAccess: row.agentAccess !== false,
            error: typeof row.error === 'string' && row.error !== '' ? row.error : null,
            words: Array.isArray(row.words) ? row.words.filter((word): word is string => typeof word === 'string') : [],
          },
        ]
      : [],
  );
}

/** Where a link stands, in a line (the desktop's `row_detail`). */
export function serverLinkLine(row: ServerLinkRow, computer: string): string {
  const copy = EditMachineCopy.serverLinks;
  if (row.state === 'pairing') return copy.waiting(row.name, row.words.join(' · '));
  if (row.state === 'ended') return copy.ended(row.error);
  if (!row.agentAccess) return copy.accessOff;
  if (row.outgoing && row.incoming) return copy.bothWays;
  if (row.outgoing) return copy.oneWay;
  if (row.incoming) return copy.incomingOnly(computer);
  return copy.notLinked;
}

export default function ServerLinksSection({ machine, reachable }: { machine: MachineRecord; reachable: boolean }) {
  const formStyles = useFormStyles();
  const appearance = useAppearance();
  const copy = EditMachineCopy.serverLinks;
  const [rows, setRows] = useState<ServerLinkRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const answer = await chatMachineLink(machine).rpc('serverLinks', { op: 'list' }, RPC_TIMEOUT_MS);
    // An older gxserver has no such route: no section.
    setRows(answer.error === null ? readServerLinks(answer.result) : null);
  }, [machine]);

  useEffect(() => {
    if (!reachable) return;
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
  }, [reachable, refresh]);

  const send = useCallback(
    async (serverId: string, params: Record<string, unknown>, timeoutMs: number, failed: string): Promise<void> => {
      setBusy(serverId);
      try {
        const answer = await chatMachineLink(machine).rpc('serverLinks', params, timeoutMs);
        if (answer.error !== null) Alert.alert(failed, answer.error.message);
        else setRows(readServerLinks(answer.result));
      } finally {
        setBusy(null);
      }
    },
    [machine],
  );

  const confirmRemove = (row: ServerLinkRow): void => {
    Alert.alert(copy.removeTitle(row.name), copy.removeDetail(row.name, machineDisplayLabel(machine)), [
      { text: copy.cancel, style: 'cancel' },
      {
        text: copy.remove,
        style: 'destructive',
        onPress: () =>
          void send(row.serverId, { op: 'remove', serverId: row.serverId }, REMOVE_TIMEOUT_MS, copy.removeFailed),
      },
    ]);
  };

  if (rows === null || rows.length === 0) return null;
  return (
    <>
      <Text style={formStyles.sectionLabel}>{copy.title}</Text>
      <View style={formStyles.rowsCard}>
        {rows.map((row, index) => {
          const settled = row.state === 'linked' || row.state === 'incomingOnly';
          const toggle = (on: boolean): void =>
            void send(
              row.serverId,
              { op: 'setAgentAccess', serverId: row.serverId, on },
              RPC_TIMEOUT_MS,
              copy.accessFailed,
            );
          const main = (
            <View style={formStyles.rowMain}>
              <Text style={formStyles.rowLabel}>{row.name}</Text>
              <Text style={formStyles.rowDetail}>{serverLinkLine(row, machineName(machine))}</Text>
            </View>
          );
          return (
            <View key={row.serverId} style={index === 0 ? formStyles.rowFirst : null}>
              {settled ? (
                <SwitchRow
                  value={row.agentAccess}
                  onValueChange={toggle}
                  disabled={busy !== null}
                  label={copy.accessLabel(row.name)}
                  style={formStyles.row}
                >
                  {main}
                  <Switch
                    value={row.agentAccess}
                    onValueChange={toggle}
                    disabled={busy !== null}
                    trackColor={{ false: appearance.cardActive, true: appearance.accent }}
                    thumbColor={appearance.foreground}
                  />
                </SwitchRow>
              ) : (
                <View style={formStyles.row}>{main}</View>
              )}
              <View style={[formStyles.row, { justifyContent: 'flex-end' }]}>
                <SetupButton small label={copy.remove} disabled={busy !== null} onPress={() => confirmRemove(row)} />
              </View>
            </View>
          );
        })}
      </View>
      <Text style={formStyles.rowDetail}>{copy.footer(machineDisplayLabel(machine))}</Text>
    </>
  );
}
