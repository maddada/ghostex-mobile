/**
 * Machines list (docs/2026-09-03/mobile-setup/mobile-07-machines.html): one
 * card per saved computer with a status badge and a one-line "how / what's
 * wrong" detail, tap → the computer's page, swipe left → Remove (it confirms
 * with the computer's name), and "Add a computer" with one compact card per
 * way (scan, Tailscale, the demo). Hidden computers stay here with a Hidden
 * badge; the Sessions strip shows only visible ones.
 *
 * CDXC:RemotePairing 2026-11-10 DECISION:
 * On the pairing page the user kept this screen (Q2192), "but please improve it a bit and clean it up": same
 * structure (still "Machines", the name of the Sessions button that opens it), state coloured once (the badge), no line explaining the swipe, the
 * swipe's Edit gone (a tap opens the page that edits), and the add cards one row each without a coloured border.
 */

import { useMemo, useCallback, useState } from 'react';
import { useAppearance, type Appearance } from '../theme/useAppearance';

import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import ConfirmDialog from '../components/common/ConfirmDialog';
import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import PathCard from '../components/onboarding/PathCard';
import { CameraGlyph, QrcodeGlyph, ShieldGlyph, SparklesGlyph } from '../components/onboarding/SetupIcons';
import { MachinesCopy } from '../copy';
import { DemoCopy } from '../demo/copy';
import { useInventoryStore } from '../inventory/store';
import { removeComputerFromPhone } from '../machines/removeComputer';
import {
  APP_UPDATE_FRESH_MS,
  appUpdateCardLine,
  appUpdateView,
  refreshAppUpdate,
  runAppUpdateOp,
  useAppUpdateStore,
} from '../machines/appUpdate';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useRemovalAsksComputer } from '../notifications/pushStore';

import MachineCard from './machines-screen/MachineCard';
import { machineCardDetail, machineCardStatus, machineCardTitle } from './machines-screen/machineCardModel';

type Props = NativeStackScreenProps<RootStackParamList, 'Machines'>;

type Overlay = { kind: 'none' } | { kind: 'remove'; machine: MachineRecord };

const NONE: Overlay = { kind: 'none' };

export default function MachinesScreen({ navigation }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const machines = useMachinesStore((state) => state.machines);
  // The list reaches under the iPhone Duo's side bar, its content keeps clear of it.
  const edges = useScrollToBarEdges(styles.content);
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);

  const appUpdates = useAppUpdateStore((state) => state.byMachineId);
  const removalAsksComputer = useRemovalAsksComputer();

  const [overlay, setOverlay] = useState<Overlay>(NONE);

  // Every computer the phone reaches is read again when the list opens, if its answer is old.
  useFocusEffect(
    useCallback(() => {
      const inventories = useInventoryStore.getState().inventoriesByMachineId;
      for (const machine of useMachinesStore.getState().machines) {
        if (machineCardStatus(machine, inventories[machine.id]) === 'connected') {
          refreshAppUpdate(machine, { ifOlderThanMs: APP_UPDATE_FRESH_MS });
        }
      }
    }, []),
  );

  const editMachine = useCallback(
    (machine: MachineRecord): void => navigation.navigate('MachineForm', { machineId: machine.id }),
    [navigation],
  );

  const deleteMachine = useCallback(async (machine: MachineRecord): Promise<void> => {
    setOverlay(NONE);
    await removeComputerFromPhone(machine.id);
  }, []);

  const now = new Date();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={edges.scroll} contentContainerStyle={[styles.content, edges.content]}>
        {machines.length > 0 ? (
          <View style={styles.cards}>
              {machines.map((machine) => {
                const inventory = inventoriesByMachineId[machine.id];
                const status = machineCardStatus(machine, inventory);
                const appUpdate = appUpdates[machine.id];
                const view = appUpdate === undefined ? null : appUpdateView(appUpdate);
                const line = view === null ? null : appUpdateCardLine(view);
                return (
                  <MachineCard
                    key={machine.id}
                    title={machineCardTitle(machine)}
                    detail={machineCardDetail(machine, status, inventory, now)}
                    status={status}
                    update={
                      view !== null && line !== null
                        ? { line, view, onUpdate: () => runAppUpdateOp(machine, 'install') }
                        : null
                    }
                    onPress={() => editMachine(machine)}
                    onRemove={() => setOverlay({ kind: 'remove', machine })}
                  />
                );
              })}
            </View>
        ) : null}

        <Text style={[styles.sectionLabel, machines.length > 0 ? styles.sectionLabelSpaced : null]}>
          {MachinesCopy.add.sectionLabel}
        </Text>
        <View style={styles.cards}>
          <PathCard
            primary
            icon={<QrcodeGlyph size={18} color={appearance.accent} />}
            title={MachinesCopy.add.easyConnect.title}
            subtitle={MachinesCopy.add.easyConnect.subtitle}
            button={{
              label: MachinesCopy.add.easyConnect.button,
              icon: <CameraGlyph size={14} color={appearance.accentForeground} />,
              onPress: () => navigation.navigate('ScanCode'),
            }}
          />
          <PathCard
            icon={<ShieldGlyph size={18} color={appearance.accent} />}
            title={MachinesCopy.add.tailscale.title}
            subtitle={MachinesCopy.add.tailscale.subtitle}
            button={{
              label: MachinesCopy.add.tailscale.button,
              onPress: () => navigation.navigate('TailscaleForm'),
            }}
          />
          <PathCard
            icon={<SparklesGlyph size={18} color={appearance.accent} />}
            title={DemoCopy.entryTitle}
            subtitle={DemoCopy.cardDetail}
            button={{
              label: DemoCopy.entryButton,
              onPress: () => {
                useMachinesStore.getState().addDemoComputer();
                navigation.navigate('Sessions');
              },
            }}
          />
        </View>
      </ScrollView>

      {overlay.kind === 'remove' ? (
        <ConfirmDialog
          visible
          title={MachinesCopy.remove.title}
          body={MachinesCopy.remove.body(machineCardTitle(overlay.machine), removalAsksComputer)}
          targetLine={machineCardTitle(overlay.machine)}
          confirmLabel={MachinesCopy.remove.confirm}
          destructive
          onConfirm={() => void deleteMachine(overlay.machine)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appearance.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  cards: {
    gap: 10,
  },
  sectionLabel: {
    color: appearance.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionLabelSpaced: {
    marginTop: 24,
  },
});
