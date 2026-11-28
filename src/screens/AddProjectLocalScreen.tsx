/**
 * Add Project local branch: optional Places bar -> path input -> "Add project"
 * button -> folder browser (with Git/language/"In Ghostex" badges on newer
 * computers and inline New folder). Nothing is added optimistically; the
 * machine's inventory is refreshed after gxserver confirms the project.
 */

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { addProjectPath, createProjectDirectory } from '../addProject/client';
import FolderBrowser from '../addProject/FolderBrowser';
import {
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
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
  SectionHeaderRow,
} from '../addProject/primitives';
import {
  ADD_PROJECT_DEFAULT_PATH,
  duplicateProjectFor,
  resolveSubmittedPath,
  willCreateSubmittedPath,
} from '../addProject/submit';
import { useDirectoryBrowse } from '../addProject/useDirectoryBrowse';
import {
  invalidateProjectPickerPlacesCache,
  useProjectPickerPlaces,
} from '../addProject/useProjectPickerPlaces';
import { PinGlyph, PinnedGlyph, PlusGlyph } from '../components/sessions/icons';
import { AddProjectCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexRadii, GhostexStrokeWidth } from '../theme/palette';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import { showAlert } from '../components/common/dialog/alert';

type Props = NativeStackScreenProps<RootStackParamList, 'AddProjectLocal'>;

export default function AddProjectLocalScreen({ navigation, route }: Props): ReactElement {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const { machineId, initialPath } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);

  const [path, setPath] = useState(() =>
    initialPath !== undefined && initialPath.trim().length > 0
      ? ensureBrowseDirectoryPath(initialPath)
      : ADD_PROJECT_DEFAULT_PATH,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

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
      showAlert(
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
      invalidateProjectPickerPlacesCache(machineId);
      await useInventoryStore.getState().refreshMachineFresh(machine);
      navigation.navigate('Sessions');
    } catch (failure) {
      setPending(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [browse, machine, machineId, navigation, path, pending]);

  const submitNewFolder = useCallback(async (): Promise<void> => {
    if (machine === null || creatingFolder) return;
    const trimmedName = newFolderName.trim();
    if (trimmedName.length === 0) {
      setError(AddProjectCopy.newFolderEmptyError);
      return;
    }
    const parentDir = browse.result?.parentPath ?? getBrowseDirectoryPath(path);
    if (parentDir.length === 0) {
      setError(AddProjectCopy.emptyPathError);
      return;
    }
    setCreatingFolder(true);
    setError(null);
    try {
      const created = await createProjectDirectory(machine, parentDir, trimmedName);
      setCreatingFolder(false);
      setNewFolderName('');
      setNewFolderOpen(false);
      if (created !== null) {
        setPath(ensureBrowseDirectoryPath(created.path));
        browse.reload();
      } else {
        // Older computer or legacy SSH-only link: stage the new path without a trailing separator
        // so browsing stays on the existing parent folder and "Create & add project" creates it.
        setPath(joinPathSegment(parentDir, trimmedName));
      }
    } catch (failure) {
      setCreatingFolder(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [browse, creatingFolder, machine, newFolderName, path]);

  if (machine === null) {
    return (
      <AddProjectShell>
        <ErrorBanner message={AddProjectCopy.machineMissing} />
      </AddProjectShell>
    );
  }

  const willCreate = willCreateSubmittedPath(path, browse);
  const currentDirPath =
    hasTrailingPathSeparator(path) &&
    browse.result !== null &&
    browse.result.isDriveList !== true &&
    browse.result.parentPath.length > 0
      ? browse.result.parentPath
      : null;
  const currentPinned = currentDirPath !== null && pickerPlaces.isPinned(currentDirPath);
  const canCreateFolder = browse.result?.isDriveList !== true;

  return (
    <AddProjectShell>
      {error === null ? null : <ErrorBanner message={error} />}
      {pickerPlaces.pinError === null ? null : <ErrorBanner message={pickerPlaces.pinError} />}
      {browse.error === null ? null : <ErrorBanner message={browse.error} />}

      {places !== null ? (
        <>
          <SectionHeaderRow
            title={AddProjectCopy.placesSection}
            action={
              <InlineActionButton
                testID="add-project-local-all-places"
                label={showAllPlaces ? AddProjectCopy.hidePlacesButton : AddProjectCopy.allPlacesButton}
                active={showAllPlaces}
                onPress={() => setShowAllPlaces((prev) => !prev)}
              />
            }
          />
          <QuickPlacesStrip
            places={places}
            currentPath={currentDirPath ?? path}
            onSelectPlace={selectPlace}
          />
          {showAllPlaces ? (
            <AllPlacesPanel
              places={places}
              pinningPath={pickerPlaces.pinningPath}
              onUnpin={(placePath) => void pickerPlaces.togglePin(placePath)}
              onSelectPlace={selectPlace}
            />
          ) : null}
        </>
      ) : null}

      <SectionHeaderRow
        title={AddProjectCopy.pathLabel}
        action={
          places !== null && currentDirPath !== null ? (
            <InlineActionButton
              testID="add-project-pin-current"
              label={currentPinned ? AddProjectCopy.pinnedFolderButton : AddProjectCopy.pinFolderButton}
              active={currentPinned}
              loading={pickerPlaces.pinningPath !== null}
              icon={
                currentPinned ? (
                  <PinnedGlyph size={12} color={appearance.accent} />
                ) : (
                  <PinGlyph size={12} color={appearance.muted} />
                )
              }
              onPress={() => void pickerPlaces.togglePin(currentDirPath)}
            />
          ) : undefined
        }
      />
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
      <FolderBrowser
        browse={browse}
        path={path}
        onChangePath={changePath}
        headerAction={
          canCreateFolder ? (
            <InlineActionButton
              testID="add-project-new-folder-toggle"
              label={AddProjectCopy.newFolderButton}
              active={newFolderOpen}
              icon={<PlusGlyph size={12} color={newFolderOpen ? appearance.accent : appearance.muted} />}
              onPress={() => {
                setNewFolderOpen((prev) => !prev);
                setError(null);
              }}
            />
          ) : undefined
        }
        headerContent={
          canCreateFolder && newFolderOpen ? (
            <View style={styles.newFolderBox}>
              <ProjectPathInput
                testID="add-project-new-folder-input"
                value={newFolderName}
                onChangeText={(next) => {
                  setNewFolderName(next);
                  setError(null);
                }}
                onSubmitEditing={() => void submitNewFolder()}
                placeholder={AddProjectCopy.newFolderPlaceholder}
              />
              <View style={styles.newFolderActions}>
                <InlineActionButton
                  label={AddProjectCopy.newFolderCancelButton}
                  disabled={creatingFolder}
                  onPress={() => {
                    setNewFolderOpen(false);
                    setNewFolderName('');
                  }}
                />
                <InlineActionButton
                  primary
                  testID="add-project-new-folder-create"
                  label={AddProjectCopy.newFolderCreateButton}
                  loading={creatingFolder}
                  disabled={newFolderName.trim().length === 0}
                  onPress={() => void submitNewFolder()}
                />
              </View>
            </View>
          ) : undefined
        }
      />
    </AddProjectShell>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    newFolderBox: {
      borderRadius: GhostexRadii.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.card,
      padding: 10,
      gap: 8,
    },
    newFolderActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
    },
  });
