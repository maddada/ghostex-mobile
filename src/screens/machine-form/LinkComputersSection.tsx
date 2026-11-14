/**
 * Connect to another computer, on a computer's page: one row for each other computer on this phone, with Connect,
 * behind an "are you sure?" (CDXC:RemotePairing 2026-11-14 DECISION in machines/linkComputers.ts).
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import ConfirmDialog from '../../components/common/ConfirmDialog';
import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { LinkComputersCopy } from '../../copy';
import { isDemoMachine } from '../../demo/identity';
import { linkComputers, type LinkProgress } from '../../machines/linkComputers';
import { isMachineEnabled, useMachinesStore, type MachineRecord } from '../../machines/store';
import { machineCardTitle } from '../machines-screen/machineCardModel';
import { useFormStyles } from './styles';

type RowState =
  { kind: 'running'; progress: LinkProgress | null } | { kind: 'done' } | { kind: 'failed'; message: string };

function progressLine(progress: LinkProgress | null, fallback: string): string {
  if (progress === null) return fallback;
  if (progress.step === 'asking') return LinkComputersCopy.asking(progress.added, progress.to);
  if (progress.step === 'approving') return LinkComputersCopy.approving(progress.added, progress.to);
  return LinkComputersCopy.adding(progress.added, progress.to);
}

export default function LinkComputersSection({ machine, name }: { machine: MachineRecord; name: string }) {
  const formStyles = useFormStyles();
  const machines = useMachinesStore((state) => state.machines);
  const others = machines.filter(
    (other) => other.id !== machine.id && !isDemoMachine(other) && isMachineEnabled(other),
  );
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [asking, setAsking] = useState<MachineRecord | null>(null);
  if (others.length === 0 || isDemoMachine(machine)) return null;
  const running = Object.values(states).some((state) => state.kind === 'running');

  const start = (other: MachineRecord) => {
    const otherName = machineCardTitle(other);
    const set = (state: RowState) => setStates((current) => ({ ...current, [other.id]: state }));
    set({ kind: 'running', progress: null });
    linkComputers({ ...machine, name }, { ...other, name: otherName }, (progress) => set({ kind: 'running', progress }))
      .then(() => set({ kind: 'done' }))
      .catch((error: unknown) =>
        set({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
      );
  };

  return (
    <>
      <Text style={formStyles.sectionLabel}>{LinkComputersCopy.sectionLabel}</Text>
      <View style={formStyles.rowsCard}>
        {others.map((other, index) => {
          const otherName = machineCardTitle(other);
          const state = states[other.id];
          const detail =
            state === undefined
              ? LinkComputersCopy.idle(otherName)
              : state.kind === 'running'
                ? progressLine(state.progress, LinkComputersCopy.idle(otherName))
                : state.kind === 'done'
                  ? LinkComputersCopy.done
                  : state.message;
          return (
            <View key={other.id} style={[formStyles.row, index === 0 ? formStyles.rowFirst : null]}>
              <View style={formStyles.rowMain}>
                <Text style={formStyles.rowLabel}>{otherName}</Text>
                <Text style={[formStyles.rowDetail, state?.kind === 'failed' ? formStyles.danger : null]}>
                  {detail}
                </Text>
              </View>
              {state?.kind === 'done' ? null : (
                <SetupButton
                  small
                  label={LinkComputersCopy.connect}
                  busy={state?.kind === 'running'}
                  disabled={running}
                  onPress={() => setAsking(other)}
                />
              )}
            </View>
          );
        })}
      </View>
      <ConfirmDialog
        visible={asking !== null}
        title={asking === null ? '' : LinkComputersCopy.confirmTitle(name, machineCardTitle(asking))}
        body={asking === null ? '' : LinkComputersCopy.confirmBody(name, machineCardTitle(asking))}
        confirmLabel={LinkComputersCopy.confirmLabel}
        onConfirm={() => {
          const other = asking;
          setAsking(null);
          if (other !== null) start(other);
        }}
        onCancel={() => setAsking(null)}
      />
    </>
  );
}
