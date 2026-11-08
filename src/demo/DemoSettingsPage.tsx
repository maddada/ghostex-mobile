/**
 * Settings › Demo computer: what the sample machine is, and the way to remove it.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';

import ConfirmDialog from '../components/common/ConfirmDialog';
import { SetupButton } from '../components/onboarding/SetupPrimitives';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useSpacesStore } from '../spaces/store';
import { useWorkspacesStore } from '../workspaces/store';
import { Caption, SettingsScreenLayout } from '../screens/settings/SettingsControls';
import { DemoCopy } from './copy';
import { DEMO_MACHINE_ID } from './identity';

export default function DemoSettingsPage() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const removeMachine = useMachinesStore((state) => state.removeMachine);
  const [confirming, setConfirming] = useState(false);

  const remove = async (): Promise<void> => {
    setConfirming(false);
    useInventoryStore.getState().clearMachine(DEMO_MACHINE_ID);
    useSpacesStore.getState().clearMachine(DEMO_MACHINE_ID);
    useWorkspacesStore.getState().clearMachine(DEMO_MACHINE_ID);
    await removeMachine(DEMO_MACHINE_ID);
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <SettingsScreenLayout intro={DemoCopy.settingsIntro}>
      <Caption>{DemoCopy.banner}</Caption>
      <SetupButton label={DemoCopy.remove} variant="secondary" onPress={() => setConfirming(true)} />
      {confirming ? (
        <ConfirmDialog
          visible
          title="Remove the demo computer?"
          body="The sample projects leave this phone. A computer you paired is not affected."
          targetLine="Demo computer"
          confirmLabel="Remove"
          destructive
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </SettingsScreenLayout>
  );
}
