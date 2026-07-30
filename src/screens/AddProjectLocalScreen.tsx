/**
 * Add Project local branch (t3code spec §5.5): error banner → path input →
 * "Add project" button → folder browser. Nothing is added optimistically; the
 * machine's inventory is refreshed after gxserver confirms the project.
 */

import { useCallback, useState, type ReactElement } from 'react';
import { Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { addProjectPath } from '../addProject/client';
import FolderBrowser from '../addProject/FolderBrowser';
import {
  ADD_PROJECT_DEFAULT_PATH,
  duplicateProjectFor,
  resolveSubmittedPath,
  willCreateSubmittedPath,
} from '../addProject/submit';
import {
  AddProjectShell,
  ErrorBanner,
  MutedText,
  PrimaryActionButton,
  ProjectPathInput,
  SectionTitle,
} from '../addProject/primitives';
import { useDirectoryBrowse } from '../addProject/useDirectoryBrowse';
import { AddProjectCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AddProjectLocal'>;

export default function AddProjectLocalScreen({ navigation, route }: Props): ReactElement {
  const { machineId } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);

  const [path, setPath] = useState(ADD_PROJECT_DEFAULT_PATH);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const browse = useDirectoryBrowse(machine, path);

  const changePath = useCallback((next: string) => {
    setPath(next);
    setError(null);
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    if (machine === null || pending) return;
    const trimmed = path.trim();
    if (trimmed.length === 0) {
      setError(AddProjectCopy.emptyPathError);
      return;
    }
    const resolved = resolveSubmittedPath(trimmed, browse);
    const duplicate = duplicateProjectFor(machineId, resolved);
    if (duplicate !== null) {
      Alert.alert(
        AddProjectCopy.duplicateTitle,
        AddProjectCopy.duplicateBody(duplicate.name ?? duplicate.path ?? resolved),
      );
      navigation.navigate('Sessions');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await addProjectPath(machine, resolved, { createIfMissing: true });
      await useInventoryStore.getState().refreshMachineFresh(machine);
      navigation.navigate('Sessions');
    } catch (failure) {
      setPending(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [browse, machine, machineId, navigation, path, pending]);

  if (machine === null) {
    return (
      <AddProjectShell>
        <ErrorBanner message={AddProjectCopy.machineMissing} />
      </AddProjectShell>
    );
  }

  const willCreate = willCreateSubmittedPath(path, browse);

  return (
    <AddProjectShell>
      {error === null ? null : <ErrorBanner message={error} />}
      {browse.error === null ? null : <ErrorBanner message={browse.error} />}
      <SectionTitle>{AddProjectCopy.pathLabel}</SectionTitle>
      <ProjectPathInput
        testID="add-project-path-input"
        value={path}
        onChangeText={changePath}
        onSubmitEditing={() => void submit()}
        placeholder={AddProjectCopy.pathPlaceholder}
      />
      {willCreate ? <MutedText>{AddProjectCopy.createHint}</MutedText> : null}
      <PrimaryActionButton
        testID="add-project-submit"
        label={willCreate ? AddProjectCopy.createAndAddButton : AddProjectCopy.addButton}
        loading={pending}
        onPress={() => void submit()}
      />
      <FolderBrowser browse={browse} path={path} onChangePath={changePath} />
    </AddProjectShell>
  );
}
