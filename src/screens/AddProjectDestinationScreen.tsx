/**
 * Add Project clone branch, step 2: repository card -> optional Places bar ->
 * path input -> "Clone project" -> folder browser.
 *
 * gxserver refuses a destination that already exists and is not empty, so a
 * browsed directory alone is never a valid destination. When the path still
 * ends with a separator the repository's own folder name is appended, and the
 * effective destination is shown under the input so nothing is hidden.
 */

import { useCallback, useState, type ReactElement } from 'react';
import { Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { CloneFailedError, cloneRepository } from '../addProject/client';
import FolderBrowser from '../addProject/FolderBrowser';
import {
  cloneFolderName,
  ensureBrowseDirectoryPath,
  hasTrailingPathSeparator,
  joinPathSegment,
} from '../addProject/paths';
import { AllPlacesPanel, QuickPlacesStrip } from '../addProject/PlacesPicker';
import {
  AddProjectShell,
  ErrorBanner,
  InlineActionButton,
  MutedText,
  PrimaryActionButton,
  ProjectPathInput,
  RepositoryCard,
  SectionHeaderRow,
  SectionTitle,
} from '../addProject/primitives';
import { ADD_PROJECT_DEFAULT_PATH, resolveSubmittedPath } from '../addProject/submit';
import { useDirectoryBrowse } from '../addProject/useDirectoryBrowse';
import {
  invalidateProjectPickerPlacesCache,
  useProjectPickerPlaces,
} from '../addProject/useProjectPickerPlaces';
import { AddProjectCopy } from '../copy';
import { EditMachineCopy } from '../copy/machines';
import { useInventoryStore } from '../inventory/store';
import { openShownCommandTerminal } from '../machines/appUpdate';
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
  /** Run in terminal's id for the failed clone's next step (`gh auth login`), when the computer offers it. */
  const [errorCommand, setErrorCommand] = useState<string | null>(null);
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const [pending, setPending] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);

  const browse = useDirectoryBrowse(machine, path);
  const pickerPlaces = useProjectPickerPlaces(machine);
  const { places } = pickerPlaces;

  const changePath = useCallback((next: string) => {
    setPath(next);
    setError(null);
  }, []);

  const selectPlace = useCallback((placePath: string) => {
    setPath(ensureBrowseDirectoryPath(placePath));
    setError(null);
    setShowAllPlaces(false);
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
    setErrorCommand(null);
    try {
      await cloneRepository(machine, remoteUrl, destination);
      invalidateProjectPickerPlacesCache(machineId);
      await useInventoryStore.getState().refreshMachineFresh(machine);
      navigation.navigate('Sessions');
    } catch (failure) {
      setPending(false);
      setError(failure instanceof Error ? failure.message : String(failure));
      setErrorCommand(failure instanceof CloneFailedError ? failure.runInTerminal : null);
    }
  }, [destination, machine, machineId, navigation, pending, remoteUrl]);

  const runInTerminal = useCallback(() => {
    if (machine === null || errorCommand === null || openingTerminal) return;
    setOpeningTerminal(true);
    void openShownCommandTerminal(machine, errorCommand)
      .then(({ sessionKey, title }) => navigation.navigate('Terminal', { sessionKey, machineId, title }))
      .catch((failure: unknown) =>
        Alert.alert(EditMachineCopy.appUpdate.runInTerminalFailed, failure instanceof Error ? failure.message : String(failure)),
      )
      .finally(() => setOpeningTerminal(false));
  }, [errorCommand, machine, machineId, navigation, openingTerminal]);

  if (machine === null) {
    return (
      <AddProjectShell>
        <ErrorBanner message={AddProjectCopy.machineMissing} />
      </AddProjectShell>
    );
  }

  return (
    <AddProjectShell>
      {error === null ? null : (
        <ErrorBanner
          message={error}
          action={
            errorCommand === null ? undefined : (
              <InlineActionButton
                primary
                testID="add-project-clone-run-in-terminal"
                label={EditMachineCopy.appUpdate.runInTerminal}
                loading={openingTerminal}
                onPress={runInTerminal}
              />
            )
          }
        />
      )}
      {browse.error === null ? null : <ErrorBanner message={browse.error} />}
      <SectionTitle>{AddProjectCopy.repositorySection}</SectionTitle>
      <RepositoryCard title={repositoryTitle} subtitle={repositoryUrl} />

      {places !== null ? (
        <>
          <SectionHeaderRow
            title={AddProjectCopy.placesSection}
            action={
              <InlineActionButton
                testID="add-project-destination-all-places"
                label={showAllPlaces ? AddProjectCopy.hidePlacesButton : AddProjectCopy.allPlacesButton}
                active={showAllPlaces}
                onPress={() => setShowAllPlaces((prev) => !prev)}
              />
            }
          />
          <QuickPlacesStrip
            places={places}
            currentPath={browse.result?.parentPath ?? path}
            onSelectPlace={selectPlace}
          />
          {showAllPlaces ? (
            <AllPlacesPanel places={places} onSelectPlace={selectPlace} />
          ) : null}
        </>
      ) : null}

      <SectionTitle>{AddProjectCopy.destinationSection}</SectionTitle>
      <ProjectPathInput
        testID="add-project-destination-input"
        value={path}
        onChangeText={changePath}
        onSubmitEditing={() => void submit()}
        placeholder={AddProjectCopy.pathPlaceholder}
      />
      {destination.length === 0 ? null : <MutedText>{AddProjectCopy.destinationPreview(destination)}</MutedText>}
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
