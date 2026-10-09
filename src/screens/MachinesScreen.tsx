/**
 * Machines list (docs/2026-09-03/mobile-setup/mobile-07-machines.html): one
 * card per saved computer with a status badge and a one-line "how / what's
 * wrong" detail, tap → Edit machine, swipe left → Edit / Remove (Remove
 * confirms with the computer's name), and "Add a computer" with the two
 * onboarding path cards. Hidden machines stay here with a Hidden badge; the
 * Sessions strip shows only visible ones. Passwords, host keys, details and
 * diagnostics moved to Edit machine, so this page has no per-card menu.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { markManualDisconnect } from '../app/autoReconnect';
import ConfirmDialog from '../components/common/ConfirmDialog';
import PathCard from '../components/onboarding/PathCard';
import { CameraGlyph, QrcodeGlyph, ShieldGlyph } from '../components/onboarding/SetupIcons';
import { setupText } from '../components/onboarding/SetupPrimitives';
import { MachinesCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useSpacesStore } from '../spaces/store';
import { useWorkspacesStore } from '../workspaces/store';
import { SetupPalette } from '../theme/palette';
import MachineCard from './machines-screen/MachineCard';
import {
  machineCardDetail,
  machineCardStatus,
  machineCardTitle,
} from './machines-screen/machineCardModel';

type Props = NativeStackScreenProps<RootStackParamList, 'Machines'>;

type Overlay = { kind: 'none' } | { kind: 'remove'; machine: MachineRecord };

const NONE: Overlay = { kind: 'none' };

export default function MachinesScreen({ navigation }: Props) {
  const machines = useMachinesStore((state) => state.machines);
  const removeMachine = useMachinesStore((state) => state.removeMachine);
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
  const clearMachineInventory = useInventoryStore((state) => state.clearMachine);
  const clearMachineSpace = useSpacesStore((state) => state.clearMachine);

  const [overlay, setOverlay] = useState<Overlay>(NONE);

  const editMachine = useCallback(
    (machine: MachineRecord): void => navigation.navigate('MachineForm', { machineId: machine.id }),
    [navigation],
  );

  const deleteMachine = useCallback(
    async (machine: MachineRecord): Promise<void> => {
      setOverlay(NONE);
      clearMachineInventory(machine.id);
      clearMachineSpace(machine.id);
      useWorkspacesStore.getState().clearMachine(machine.id);
      try {
        markManualDisconnect(machine.id);
        await GhostexNative.disconnect(machine.id);
      } catch {
        // Not connected is fine.
      }
      await removeMachine(machine.id);
    },
    [clearMachineInventory, clearMachineSpace, removeMachine],
  );

  const now = new Date();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {machines.length > 0 ? (
          <>
            <View style={styles.cards}>
              {machines.map((machine) => {
                const inventory = inventoriesByMachineId[machine.id];
                const status = machineCardStatus(machine, inventory);
                return (
                  <MachineCard
                    key={machine.id}
                    title={machineCardTitle(machine)}
                    detail={machineCardDetail(machine, status, inventory, now)}
                    status={status}
                    onPress={() => editMachine(machine)}
                    onEdit={() => editMachine(machine)}
                    onRemove={() => setOverlay({ kind: 'remove', machine })}
                  />
                );
              })}
            </View>
            <Text style={[setupText.small, setupText.dim, styles.swipeHint]}>
              {MachinesCopy.swipe.hint}
            </Text>
          </>
        ) : null}

        <Text style={[styles.sectionLabel, machines.length > 0 ? styles.sectionLabelSpaced : null]}>
          {MachinesCopy.add.sectionLabel}
        </Text>
        <View style={styles.cards}>
          <PathCard
            recommended
            icon={<QrcodeGlyph size={20} color={SetupPalette.ACCENT} />}
            title={MachinesCopy.add.easyConnect.title}
            subtitle={MachinesCopy.add.easyConnect.subtitle}
            button={{
              label: MachinesCopy.add.easyConnect.button,
              icon: <CameraGlyph size={14} color={SetupPalette.PRIMARY_BUTTON_FOREGROUND} />,
              onPress: () => navigation.navigate('ScanCode'),
            }}
          />
          <PathCard
            icon={<ShieldGlyph size={20} color={SetupPalette.FOREGROUND} />}
            title={MachinesCopy.add.tailscale.title}
            subtitle={MachinesCopy.add.tailscale.subtitle}
            button={{
              label: MachinesCopy.add.tailscale.button,
              onPress: () => navigation.navigate('TailscaleForm'),
            }}
          />
        </View>
      </ScrollView>

      {overlay.kind === 'remove' ? (
        <ConfirmDialog
          visible
          title={MachinesCopy.remove.title}
          body={MachinesCopy.remove.body(machineCardTitle(overlay.machine))}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SetupPalette.PAGE,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  cards: {
    gap: 10,
  },
  swipeHint: {
    marginTop: 12,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    color: SetupPalette.MUTED,
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
