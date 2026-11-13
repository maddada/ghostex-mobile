/**
 * Edit machine for the demo experience: an explanation and Remove, never SSH fields.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ConfirmDialog from '../components/common/ConfirmDialog';
import { SetupButton, useSetupText } from '../components/onboarding/SetupPrimitives';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore } from '../machines/store';
import { useSpacesStore } from '../spaces/store';
import { useAppearance } from '../theme/useAppearance';
import { useWorkspacesStore } from '../workspaces/store';
import { DemoCopy } from './copy';
import { DEMO_MACHINE_ID, DEMO_MACHINE_NAME } from './identity';

export default function DemoMachineForm({ onRemoved }: { onRemoved: () => void }) {
  const appearance = useAppearance();
  const setupText = useSetupText();
  const removeMachine = useMachinesStore((state) => state.removeMachine);
  const [confirming, setConfirming] = useState(false);

  const remove = async (): Promise<void> => {
    setConfirming(false);
    useInventoryStore.getState().clearMachine(DEMO_MACHINE_ID);
    useSpacesStore.getState().clearMachine(DEMO_MACHINE_ID);
    useWorkspacesStore.getState().clearMachine(DEMO_MACHINE_ID);
    await removeMachine(DEMO_MACHINE_ID);
    onRemoved();
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: appearance.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={setupText.titleLg}>{DemoCopy.formTitle}</Text>
        <Text style={setupText.lede}>{DemoCopy.formBody}</Text>
        <View style={styles.actions}>
          <SetupButton label={DemoCopy.remove} variant="secondary" onPress={() => setConfirming(true)} />
        </View>
      </ScrollView>
      {confirming ? (
        <ConfirmDialog
          visible
          title="Remove the demo experience?"
          body="The sample projects leave this phone. A computer you paired is not affected."
          targetLine={DEMO_MACHINE_NAME}
          confirmLabel="Remove"
          destructive
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 12 },
  actions: { marginTop: 8 },
});
