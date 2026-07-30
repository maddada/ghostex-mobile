/**
 * Add Project clone branch, step 2 (t3code spec §5.7): repository card → path
 * input → "Clone project" → the same folder browser.
 *
 * gxserver refuses a destination that already exists and is not empty, so a
 * browsed directory alone is never a valid destination. When the path still
 * ends with a separator the repository's own folder name is appended, and the
 * effective destination is shown under the input so nothing is hidden.
 */

import { useCallback, useState, type ReactElement } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { cloneRepository } from '../addProject/client';
import FolderBrowser from '../addProject/FolderBrowser';
import { cloneFolderName, hasTrailingPathSeparator, joinPathSegment } from '../addProject/paths';
import {
  AddProjectShell,
  ErrorBanner,
  MutedText,
  PrimaryActionButton,
  ProjectPathInput,
  RepositoryCard,
  SectionTitle,
} from '../addProject/primitives';
import { ADD_PROJECT_DEFAULT_PATH, resolveSubmittedPath } from '../addProject/submit';
import { useDirectoryBrowse } from '../addProject/useDirectoryBrowse';
import { AddProjectCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AddProjectDestination'>;

export default function AddProjectDestinationScreen({ navigation, route }: Props): ReactElement {
  const { machineId, remoteUrl, repositoryTitle, repositoryUrl } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);
  const folderName = cloneFolderName(repositoryTitle, remoteUrl);

  const [path, setPath] = useState(
    folderName.length > 0 ? `${ADD_PROJECT_DEFAULT_PATH}${folderName}` : ADD_PROJECT_DEFAULT_PATH,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const browse = useDirectoryBrowse(machine, path);

  const changePath = useCallback((next: string) => {
    setPath(next);
    setError(null);
  }, []);

  const trimmed = path.trim();
  const destination =
    trimmed.length === 0
      ? ''
      : hasTrailingPathSeparator(trimmed) && folderName.length > 0
        ? joinPathSegment(resolveSubmittedPath(trimmed, browse), folderName)
        : resolveSubmittedPath(trimmed, browse);

  const submit = useCallback(async (): Promise<void> => {
    if (machine === null || pending) return;
    if (destination.length === 0) {
      setError(AddProjectCopy.emptyPathError);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await cloneRepository(machine, remoteUrl, destination);
      await useInventoryStore.getState().refreshMachineFresh(machine);
      navigation.navigate('Sessions');
    } catch (failure) {
      setPending(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [destination, machine, navigation, pending, remoteUrl]);

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
      {browse.error === null ? null : <ErrorBanner message={browse.error} />}
      <SectionTitle>{AddProjectCopy.repositorySection}</SectionTitle>
      <RepositoryCard title={repositoryTitle} subtitle={repositoryUrl} />
      <SectionTitle>{AddProjectCopy.destinationSection}</SectionTitle>
      <ProjectPathInput
        testID="add-project-destination-input"
        value={path}
        onChangeText={changePath}
        onSubmitEditing={() => void submit()}
        placeholder={AddProjectCopy.pathPlaceholder}
      />
      {destination.length === 0 ? null : (
        <MutedText>{AddProjectCopy.destinationPreview(destination)}</MutedText>
      )}
      <PrimaryActionButton
        testID="add-project-clone"
        label={pending ? AddProjectCopy.cloningButton : AddProjectCopy.cloneButton}
        loading={pending}
        disabled={destination.length === 0}
        onPress={() => void submit()}
      />
      <FolderBrowser browse={browse} path={path} onChangePath={changePath} />
    </AddProjectShell>
  );
}
