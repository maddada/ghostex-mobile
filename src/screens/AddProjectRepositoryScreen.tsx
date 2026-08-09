/**
 * Add Project clone branch, step 1: one input plus a
 * "Continue" (Git URL) or "Lookup repository" (provider) button. A lookup
 * failure stays on this screen with an inline banner and the typed value
 * preserved.
 */

import { useCallback, useState, type ReactElement } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { lookupRepository } from '../addProject/client';
import {
  AddProjectShell,
  ErrorBanner,
  PrimaryActionButton,
  ProjectPathInput,
  SectionTitle,
} from '../addProject/primitives';
import {
  addProjectRepositoryActionLabel,
  addProjectRepositoryPlaceholder,
  isLookupProvider,
} from '../addProject/sources';
import { AddProjectCopy } from '../copy';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AddProjectRepository'>;

export default function AddProjectRepositoryScreen({ navigation, route }: Props): ReactElement {
  const { machineId, source } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    if (machine === null || pending) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError(source === 'url' ? AddProjectCopy.emptyUrlError : AddProjectCopy.emptyRepositoryError);
      return;
    }
    if (source === 'url') {
      navigation.navigate('AddProjectDestination', {
        machineId,
        remoteUrl: trimmed,
        repositoryTitle: trimmed,
        repositoryUrl: trimmed,
      });
      return;
    }
    if (!isLookupProvider(source)) {
      // The source picker never enables these rows; guard the route anyway.
      setError(AddProjectCopy.providerUnavailableHint);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const repository = await lookupRepository(machine, source, trimmed);
      setPending(false);
      navigation.navigate('AddProjectDestination', {
        machineId,
        remoteUrl: repository.sshUrl.length > 0 ? repository.sshUrl : repository.url,
        repositoryTitle: repository.nameWithOwner.length > 0 ? repository.nameWithOwner : trimmed,
        repositoryUrl: repository.url,
      });
    } catch (failure) {
      setPending(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [machine, machineId, navigation, pending, source, value]);

  if (machine === null) {
    return (
      <AddProjectShell>
        <ErrorBanner message={AddProjectCopy.machineMissing} />
      </AddProjectShell>
    );
  }

  return (
    <AddProjectShell>
      {error === null ? null : <ErrorBanner message={error} />}
      <SectionTitle>{AddProjectCopy.repositorySection}</SectionTitle>
      <ProjectPathInput
        testID="add-project-repository-input"
        value={value}
        onChangeText={(next) => {
          setValue(next);
          setError(null);
        }}
        onSubmitEditing={() => void submit()}
        placeholder={addProjectRepositoryPlaceholder(source)}
      />
      <PrimaryActionButton
        testID="add-project-repository-action"
        label={addProjectRepositoryActionLabel(source)}
        loading={pending}
        disabled={value.trim().length === 0}
        onPress={() => void submit()}
      />
    </AddProjectShell>
  );
}
