/**
 * Machines page (docs/specs/sessions-drawer.md §4): machine cards with
 * Edit/Remove/Password/More pills, footer rows [Retry | Add] and
 * [Tailscale | Setup], machine actions sheet, password prompt, host-key
 * reset/delete/forget-password confirms, and android-check health check.
 */

import { useCallback, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative } from '../../modules/ghostex-native/src';
import ActionSheet, { type ActionSheetItem } from '../components/common/ActionSheet';
import ConfirmDialog from '../components/common/ConfirmDialog';
import DetailsSheet from '../components/common/DetailsSheet';
import ProgressOverlay from '../components/common/ProgressOverlay';
import PromptDialog from '../components/common/PromptDialog';
import { runGhostexCli } from '../components/sessions/cli';
import { drawerStatusLine } from '../components/sessions/drawerModel';
import { androidCheckCommand } from '../commands/ghostexCli';
import { formatLastActive } from '../contract/mobileSummary';
import { MachineCopy, StateCardCopy } from '../copy';
import { ensureConnected, summarizeFailure } from '../inventory/client';
import { useInventoryStore } from '../inventory/store';
import {
  clearSessionPassword,
  deleteSavedPassword,
  hasPassword,
  setSavedPassword,
  setSessionPassword,
} from '../machines/credentials';
import {
  machineDisplayLabel,
  selectedMachine,
  useMachinesStore,
  type MachineRecord,
} from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Machines'>;

const CHECK_CONNECTION_DETAIL = 'Verify SSH reachability, credentials, Ghostex CLI, and zmx.';

type Overlay =
  | { kind: 'none' }
  | { kind: 'menu'; machine: MachineRecord }
  | { kind: 'password'; machine: MachineRecord; error: string | null }
  | { kind: 'forgetPassword'; machine: MachineRecord }
  | { kind: 'resetHostKey'; machine: MachineRecord }
  | { kind: 'delete'; machine: MachineRecord }
  | { kind: 'details'; machine: MachineRecord }
  | { kind: 'copyTarget'; machine: MachineRecord }
  | { kind: 'message'; title: string; message: string };

const NONE: Overlay = { kind: 'none' };

function sshTarget(machine: MachineRecord): string {
  return `${machine.username}@${machine.host}:${machine.port}`;
}

export default function MachinesScreen({ navigation }: Props) {
  const machines = useMachinesStore((state) => state.machines);
  const selectedMachineId = useMachinesStore((state) => state.selectedMachineId);
  const selected = useMachinesStore((state) => selectedMachine(state));
  const selectMachine = useMachinesStore((state) => state.selectMachine);
  const removeMachine = useMachinesStore((state) => state.removeMachine);
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
  const refreshMachine = useInventoryStore((state) => state.refreshMachine);
  const clearMachineInventory = useInventoryStore((state) => state.clearMachine);

  const [overlay, setOverlay] = useState<Overlay>(NONE);
  const [progress, setProgress] = useState<string | null>(null);

  const statusLine = drawerStatusLine(
    selected,
    selected === null ? undefined : inventoriesByMachineId[selected.id],
  );

  const openTailscale = useCallback((): void => {
    Linking.openURL('tailscale://').catch(() => {
      void Linking.openURL('https://tailscale.com/download').catch(() => {
        // No handler available; nothing else to do.
      });
    });
  }, []);

  const switchToMachine = useCallback(
    (machine: MachineRecord): void => {
      selectMachine(machine.id);
      void refreshMachine(machine);
    },
    [refreshMachine, selectMachine],
  );

  const connectMachine = useCallback(
    async (machine: MachineRecord): Promise<void> => {
      setOverlay(NONE);
      selectMachine(machine.id);
      try {
        await ensureConnected(machine);
        await refreshMachine(machine);
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const machineHasPassword = await hasPassword(machine.id);
        setOverlay({
          kind: 'message',
          title: machineDisplayLabel(machine),
          message: summarizeFailure(raw, machineHasPassword),
        });
      }
    },
    [refreshMachine, selectMachine],
  );

  const checkConnection = useCallback(async (machine: MachineRecord): Promise<void> => {
    setOverlay(NONE);
    setProgress(CHECK_CONNECTION_DETAIL);
    try {
      await runGhostexCli(machine, androidCheckCommand());
      setProgress(null);
      setOverlay({
        kind: 'message',
        title: machineDisplayLabel(machine),
        message: StateCardCopy.success.status(machineDisplayLabel(machine)),
      });
    } catch (error) {
      setProgress(null);
      setOverlay({
        kind: 'message',
        title: machineDisplayLabel(machine),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const submitPassword = useCallback(
    async (machine: MachineRecord, password: string, save: boolean): Promise<void> => {
      if (password.trim().length === 0) {
        setOverlay({ kind: 'password', machine, error: MachineCopy.validation.emptyPassword });
        return;
      }
      if (save) {
        await setSavedPassword(machine.id, password);
        clearSessionPassword(machine.id);
      } else {
        setSessionPassword(machine.id, password);
      }
      setOverlay(NONE);
      // New credentials should immediately be retried against the machine.
      try {
        await GhostexNative.disconnect(machine.id);
      } catch {
        // Not connected is fine.
      }
      void refreshMachine(machine);
    },
    [refreshMachine],
  );

  const forgetPassword = useCallback(async (machine: MachineRecord): Promise<void> => {
    await deleteSavedPassword(machine.id);
    clearSessionPassword(machine.id);
    setOverlay(NONE);
  }, []);

  const resetHostKey = useCallback(
    async (machine: MachineRecord): Promise<void> => {
      setOverlay(NONE);
      try {
        await GhostexNative.resetHostKey(machine.host, machine.port);
        void refreshMachine(machine);
      } catch (error) {
        setOverlay({
          kind: 'message',
          title: machineDisplayLabel(machine),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [refreshMachine],
  );

  const deleteMachine = useCallback(
    async (machine: MachineRecord): Promise<void> => {
      setOverlay(NONE);
      clearMachineInventory(machine.id);
      try {
        await GhostexNative.disconnect(machine.id);
      } catch {
        // Not connected is fine.
      }
      await removeMachine(machine.id);
    },
    [clearMachineInventory, removeMachine],
  );

  const menuItems = (machine: MachineRecord): ActionSheetItem[] => [
    { key: 'connect', label: 'Connect', onPress: () => void connectMachine(machine) },
    {
      key: 'check',
      label: 'Check connection',
      detail: CHECK_CONNECTION_DETAIL,
      onPress: () => void checkConnection(machine),
    },
    {
      key: 'password',
      label: 'Enter password',
      onPress: () => setOverlay({ kind: 'password', machine, error: null }),
    },
    {
      key: 'edit',
      label: 'Edit',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('MachineForm', { machineId: machine.id });
      },
    },
    { key: 'details', label: 'Details', onPress: () => setOverlay({ kind: 'details', machine }) },
    {
      key: 'copy-target',
      label: 'Copy SSH target',
      onPress: () => setOverlay({ kind: 'copyTarget', machine }),
    },
    {
      key: 'forget-password',
      label: 'Forget saved password',
      destructive: true,
      onPress: () => setOverlay({ kind: 'forgetPassword', machine }),
    },
    {
      key: 'reset-host-key',
      label: 'Reset SSH host key',
      destructive: true,
      onPress: () => setOverlay({ kind: 'resetHostKey', machine }),
    },
    {
      key: 'delete',
      label: 'Delete',
      destructive: true,
      onPress: () => setOverlay({ kind: 'delete', machine }),
    },
    {
      key: 'tailscale',
      label: 'Open Tailscale',
      onPress: () => {
        setOverlay(NONE);
        openTailscale();
      },
    },
  ];

  const renderMachine = ({ item }: { item: MachineRecord }) => {
    const isSelected = item.id === selectedMachineId;
    const lastConnected =
      item.lastConnectedAt === null
        ? MachineCopy.card.neverConnected
        : MachineCopy.card.lastConnected(formatLastActive(item.lastConnectedAt, new Date()));
    return (
      <Pressable style={styles.machineCard} onPress={() => switchToMachine(item)}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {machineDisplayLabel(item)}
          {isSelected ? MachineCopy.card.selectedSuffix : ''}
        </Text>
        <Text style={styles.cardBody} numberOfLines={1}>
          {sshTarget(item)}
        </Text>
        <Text style={styles.cardBody}>{lastConnected}</Text>
        <Text style={styles.cardBody}>{MachineCopy.card.switchHint}</Text>
        <View style={styles.pillRow}>
          <Pressable
            accessibilityRole="button"
            style={styles.pill}
            onPress={() => navigation.navigate('MachineForm', { machineId: item.id })}
          >
            <Text style={styles.pillLabel}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.pill}
            onPress={() => setOverlay({ kind: 'delete', machine: item })}
          >
            <Text style={styles.pillLabel}>Remove</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.pill}
            onPress={() => setOverlay({ kind: 'password', machine: item, error: null })}
          >
            <Text style={styles.pillLabel}>Password</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.pill}
            onPress={() => setOverlay({ kind: 'menu', machine: item })}
          >
            <Text style={styles.pillLabel}>More</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Text style={styles.statusLine} numberOfLines={2}>
        {statusLine}
      </Text>
      {machines.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.cardTitle}>{MachineCopy.emptyCard.title}</Text>
          <Text style={styles.cardBody}>{MachineCopy.emptyCard.body}</Text>
          <View style={styles.pillRow}>
            <Pressable
              accessibilityRole="button"
              style={styles.pill}
              onPress={() => navigation.navigate('MachineForm')}
            >
              <Text style={styles.pillLabel}>Add</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.pill}
              onPress={() => navigation.navigate('MachineForm')}
            >
              <Text style={styles.pillLabel}>Setup</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={machines}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={renderMachine}
          style={styles.listContainer}
        />
      )}
      <View style={styles.footerRow}>
        <Pressable
          accessibilityRole="button"
          style={[styles.footerButton, styles.footerButtonAccent]}
          onPress={() => {
            if (selected !== null) void refreshMachine(selected);
          }}
        >
          <Text style={styles.footerAccentLabel}>Retry</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.footerButton}
          onPress={() => navigation.navigate('MachineForm')}
        >
          <Text style={styles.footerLabel}>Add</Text>
        </Pressable>
      </View>
      <View style={styles.footerRow}>
        <Pressable accessibilityRole="button" style={styles.footerButton} onPress={openTailscale}>
          <Text style={styles.footerLabel}>Tailscale</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.footerButton}
          onPress={() => {
            if (selected !== null) setOverlay({ kind: 'menu', machine: selected });
            else navigation.navigate('MachineForm');
          }}
        >
          <Text style={styles.footerLabel}>Setup</Text>
        </Pressable>
      </View>

      <ProgressOverlay visible={progress !== null} message={progress ?? ''} />

      {overlay.kind === 'menu' ? (
        <ActionSheet
          visible
          title={machineDisplayLabel(overlay.machine)}
          subtitle={sshTarget(overlay.machine)}
          items={menuItems(overlay.machine)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'password' ? (
        <PromptDialog
          visible
          title="Enter password"
          body="Saved passwords use Android Keystore. Unchecked passwords are used only until Ghostex Android is closed."
          placeholder="SSH password"
          secureTextEntry
          checkboxLabel={MachineCopy.editor.savePasswordCheckbox}
          initialCheckboxValue={overlay.machine.savePassword}
          error={overlay.error}
          confirmLabel="Save"
          onSubmit={(value, save) => void submitPassword(overlay.machine, value, save)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'forgetPassword' ? (
        <ConfirmDialog
          visible
          title="Forget saved password?"
          targetLine={machineDisplayLabel(overlay.machine)}
          confirmLabel="Forget"
          destructive
          onConfirm={() => void forgetPassword(overlay.machine)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'resetHostKey' ? (
        <ConfirmDialog
          visible
          title="Reset SSH host key?"
          body="This removes only this phone's saved SSH host key for the selected machine."
          targetLine={machineDisplayLabel(overlay.machine)}
          confirmLabel="Reset"
          destructive
          onConfirm={() => void resetHostKey(overlay.machine)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'delete' ? (
        <ConfirmDialog
          visible
          title="Delete SSH machine?"
          body="This removes the machine from Ghostex Android on this device. Remote Ghostex sessions on the Mac are not changed."
          targetLine={machineDisplayLabel(overlay.machine)}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void deleteMachine(overlay.machine)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'details' ? (
        <DetailsSheet
          visible
          title={machineDisplayLabel(overlay.machine)}
          entries={[
            { label: 'Name', value: overlay.machine.name },
            { label: 'Host', value: overlay.machine.host },
            { label: 'Username', value: overlay.machine.username },
            { label: 'Port', value: String(overlay.machine.port) },
            { label: 'Save password', value: overlay.machine.savePassword ? 'Yes' : 'No' },
            {
              label: 'Last connected',
              value:
                overlay.machine.lastConnectedAt === null
                  ? MachineCopy.card.neverConnected
                  : formatLastActive(overlay.machine.lastConnectedAt, new Date()),
            },
          ]}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'copyTarget' ? (
        <ConfirmDialog
          visible
          title="Copy SSH target"
          body={sshTarget(overlay.machine)}
          selectableBody
          confirmLabel="Close"
          cancelLabel={null}
          onConfirm={() => setOverlay(NONE)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'message' ? (
        <ConfirmDialog
          visible
          title={overlay.title}
          body={overlay.message}
          confirmLabel="Close"
          cancelLabel={null}
          onConfirm={() => setOverlay(NONE)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
    padding: 12,
  },
  statusLine: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginBottom: 8,
  },
  listContainer: {
    flex: 1,
  },
  list: {
    gap: 8,
    paddingBottom: 12,
  },
  emptyCard: {
    padding: 12,
    minHeight: 104,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    marginBottom: 8,
    flexGrow: 0,
  },
  machineCard: {
    padding: 12,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  cardTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
  },
  cardBody: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 6,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  pill: {
    paddingHorizontal: 14,
    minHeight: 32,
    borderRadius: GhostexRadii.pill,
    backgroundColor: GhostexPalette.BACKGROUND,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 12,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  footerButton: {
    flex: 1,
    height: 44,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonAccent: {
    backgroundColor: GhostexPalette.ACCENT,
    borderColor: GhostexPalette.ACCENT,
  },
  footerLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  footerAccentLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
});
