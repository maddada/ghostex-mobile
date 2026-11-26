/**
 * Add Project step 1: source picker, plus Suggested repositories and quick
 * Places jumps on computers that expose `/api/projectPickerPlaces`.
 *
 * The machine is already chosen by the Projects context menu that opened this
 * flow, so there is no environment list here. On newer computers, unadded
 * Git repositories appear at the top for one-tap adding, followed by quick
 * Place jumps (Home, Default projects folder, Pinned, Project folders, Recent,
 * Volumes) and the standard source list. Older computers return `null` for
 * places and render the existing source list unchanged with zero errors.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  addProjectPath,
  discoverSourceControl,
  type AddProjectSourceControlDiscovery,
  type AddProjectSourceId,
  type AddProjectSuggestion,
} from '../addProject/client';
import { ensureBrowseDirectoryPath, tildifyRemotePath } from '../addProject/paths';
import { AllPlacesPanel, QuickPlacesStrip } from '../addProject/PlacesPicker';
import {
  AddProjectShell,
  ErrorBanner,
  InlineActionButton,
  ListRow,
  ListSection,
  MetadataBadge,
  MutedText,
  PendingRow,
  SectionHeaderRow,
  SectionTitle,
  SetupRequiredBadge,
} from '../addProject/primitives';
import {
  addProjectSourceRowDescription,
  addProjectSourceRowTitle,
  buildAddProjectSourceReadiness,
  isLookupProvider,
  orderedAddProjectSources,
} from '../addProject/sources';
import { duplicateProjectFor } from '../addProject/submit';
import {
  invalidateProjectPickerPlacesCache,
  useProjectPickerPlaces,
} from '../addProject/useProjectPickerPlaces';
import {
  FolderOpenGlyph,
  GitBranchGlyph,
  GitForkGlyph,
  WorldGlyph,
} from '../components/sessions/icons';
import { AddProjectCopy } from '../copy';
import { EditMachineCopy } from '../copy/machines';
import { useInventoryStore } from '../inventory/store';
import { openShownCommandTerminal } from '../machines/appUpdate';
import { machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useAppearance } from '../theme/useAppearance';

type Props = NativeStackScreenProps<RootStackParamList, 'AddProjectSource'>;

const INITIAL_SUGGESTIONS_LIMIT = 6;

function sourceIcon(source: AddProjectSourceId, color: string): ReactElement {
  return source === 'url' ? (
    <WorldGlyph size={16} color={color} />
  ) : (
    <GitForkGlyph size={16} color={color} />
  );
}

function suggestionSourceLabel(suggestion: AddProjectSuggestion): string | null {
  if (suggestion.source === 'otherApps') return AddProjectCopy.suggestedFromOtherApps;
  if (suggestion.from !== undefined && suggestion.from.length > 0) {
    return AddProjectCopy.suggestedFromFolder(suggestion.from);
  }
  return null;
}

/** GitHub's CLI is on the computer but signed out. */
function githubSignedOut(discovery: AddProjectSourceControlDiscovery | null): boolean {
  const github = discovery?.providers.find((provider) => provider.provider === 'github');
  return github !== undefined && github.status === 'available' && github.auth.status === 'unauthenticated';
}

export default function AddProjectSourceScreen({ navigation, route }: Props): ReactElement {
  const appearance = useAppearance();
  const { machineId } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);

  const [discovery, setDiscovery] = useState<AddProjectSourceControlDiscovery | null>(null);
  const [discoveryPending, setDiscoveryPending] = useState(true);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [addingPath, setAddingPath] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const mountedRef = useRef(true);
  const addingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Run in terminal beside a signed-out provider (GitLab's `glab auth login`): the computer opens a Main Hub
   * terminal with the sign-in typed in, and the phone shows it so the user presses Enter there.
   */
  const runInTerminal = useCallback(
    (commandId: string) => {
      if (machine === null || openingTerminal) return;
      setOpeningTerminal(true);
      void openShownCommandTerminal(machine, commandId)
        .then(({ sessionKey, title }) => navigation.navigate('Terminal', { sessionKey, machineId, title }))
        .catch((error: unknown) =>
          Alert.alert(EditMachineCopy.appUpdate.runInTerminalFailed, error instanceof Error ? error.message : String(error)),
        )
        .finally(() => {
          if (mountedRef.current) setOpeningTerminal(false);
        });
    },
    [machine, machineId, navigation, openingTerminal],
  );

  const pickerPlaces = useProjectPickerPlaces(machine);
  const { places } = pickerPlaces;

  useEffect(() => {
    if (machine === null) {
      setDiscoveryPending(false);
      return;
    }
    let cancelled = false;
    setDiscoveryPending(true);
    setDiscoveryError(null);
    void (async () => {
      try {
        const result = await discoverSourceControl(machine);
        if (cancelled) return;
        setDiscovery(result);
        setDiscoveryPending(false);
      } catch (error) {
        if (cancelled) return;
        setDiscovery(null);
        setDiscoveryPending(false);
        setDiscoveryError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
    // The machine record is looked up per render; its id is the stable key.
  }, [machineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFolder = useCallback(
    (folderPath?: string): void => {
      navigation.navigate('AddProjectLocal', {
        machineId,
        ...(folderPath !== undefined && folderPath.trim().length > 0
          ? { initialPath: ensureBrowseDirectoryPath(folderPath) }
          : {}),
      });
    },
    [machineId, navigation],
  );

  const addSuggested = useCallback(
    async (suggestion: AddProjectSuggestion): Promise<void> => {
      if (machine === null || addingRef.current) return;
      const duplicate = duplicateProjectFor(machineId, suggestion.path);
      if (duplicate !== null) {
        Alert.alert(
          AddProjectCopy.duplicateTitle,
          AddProjectCopy.duplicateBody(duplicate.name ?? duplicate.path ?? suggestion.path),
        );
        navigation.navigate('Sessions');
        return;
      }
      addingRef.current = true;
      setAddingPath(suggestion.path);
      setAddError(null);
      try {
        await addProjectPath(machine, suggestion.path, { createIfMissing: false });
        invalidateProjectPickerPlacesCache(machineId);
        await useInventoryStore.getState().refreshMachineFresh(machine);
        if (!mountedRef.current) return;
        navigation.navigate('Sessions');
      } catch (failure) {
        if (!mountedRef.current) return;
        setAddingPath(null);
        setAddError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        addingRef.current = false;
      }
    },
    [machine, machineId, navigation],
  );

  if (machine === null) {
    return (
      <AddProjectShell>
        <ErrorBanner message={AddProjectCopy.machineMissing} />
      </AddProjectShell>
    );
  }

  const readiness = buildAddProjectSourceReadiness(discovery);
  const sources = orderedAddProjectSources(readiness);
  const suggestions = places?.suggested ?? [];
  const visibleSuggestions = showAllSuggestions ? suggestions : suggestions.slice(0, INITIAL_SUGGESTIONS_LIMIT);
  const hasHiddenSuggestions = suggestions.length > INITIAL_SUGGESTIONS_LIMIT;
  const defaultLocalPath = places?.defaultProjectsFolder;

  return (
    <AddProjectShell>
      <MutedText>{AddProjectCopy.machineLine(machineDisplayLabel(machine))}</MutedText>
      {addError === null ? null : <ErrorBanner message={addError} />}
      {pickerPlaces.pinError === null ? null : <ErrorBanner message={pickerPlaces.pinError} />}
      {discoveryError === null ? null : <ErrorBanner message={discoveryError} />}

      {suggestions.length > 0 ? (
        <>
          <SectionHeaderRow
            title={AddProjectCopy.suggestedSection}
            action={
              hasHiddenSuggestions ? (
                <InlineActionButton
                  label={showAllSuggestions ? AddProjectCopy.suggestedShowLess : AddProjectCopy.suggestedShowAll}
                  count={showAllSuggestions ? undefined : suggestions.length}
                  onPress={() => setShowAllSuggestions((prev) => !prev)}
                />
              ) : undefined
            }
          />
          <ListSection>
            {visibleSuggestions.map((suggestion, index) => {
              const sourceLabel = suggestionSourceLabel(suggestion);
              const hasBadges =
                sourceLabel !== null || suggestion.branch !== undefined || suggestion.language !== undefined;
              const isAddingThis = addingPath === suggestion.path;
              const isBusy = addingPath !== null;
              return (
                <ListRow
                  key={suggestion.path}
                  first={index === 0}
                  testID={`add-project-suggested-${suggestion.name}`}
                  title={suggestion.name}
                  description={tildifyRemotePath(suggestion.path, places?.home)}
                  icon={<GitBranchGlyph size={16} color={appearance.accent} />}
                  disabled={isBusy}
                  badges={
                    hasBadges ? (
                      <>
                        {sourceLabel === null ? null : <MetadataBadge label={sourceLabel} tone="muted" />}
                        {suggestion.branch === undefined ? null : (
                          <MetadataBadge
                            label={suggestion.branch}
                            tone="accent"
                            icon={<GitBranchGlyph size={11} color={appearance.accent} />}
                          />
                        )}
                        {suggestion.language === undefined ? null : (
                          <MetadataBadge label={suggestion.language} tone="muted" />
                        )}
                      </>
                    ) : undefined
                  }
                  trailing={
                    <InlineActionButton
                      primary
                      testID={`add-project-suggested-add-${suggestion.name}`}
                      label={AddProjectCopy.quickAddButton}
                      loading={isAddingThis}
                      disabled={isBusy}
                      onPress={() => void addSuggested(suggestion)}
                    />
                  }
                  onPress={() => openFolder(suggestion.path)}
                />
              );
            })}
          </ListSection>
        </>
      ) : null}

      {places !== null ? (
        <>
          <SectionHeaderRow
            title={AddProjectCopy.placesSection}
            action={
              <InlineActionButton
                testID="add-project-source-all-places"
                label={showAllPlaces ? AddProjectCopy.hidePlacesButton : AddProjectCopy.allPlacesButton}
                active={showAllPlaces}
                onPress={() => setShowAllPlaces((prev) => !prev)}
              />
            }
          />
          <QuickPlacesStrip places={places} onSelectPlace={(placePath) => openFolder(placePath)} />
          {showAllPlaces ? (
            <AllPlacesPanel
              places={places}
              pinningPath={pickerPlaces.pinningPath}
              onUnpin={(placePath) => void pickerPlaces.togglePin(placePath)}
              onSelectPlace={(placePath) => openFolder(placePath)}
            />
          ) : null}
        </>
      ) : null}

      <SectionTitle>{AddProjectCopy.sourcesSection}</SectionTitle>
      <ListSection>
        <ListRow
          first
          testID="add-project-source-local"
          title={AddProjectCopy.localRowTitle}
          description={AddProjectCopy.localRowDescription}
          icon={<FolderOpenGlyph size={16} color={appearance.muted} />}
          onPress={() => openFolder(defaultLocalPath)}
        />
        {sources.map((source) => {
          const state = readiness[source];
          // gxserver can only resolve GitHub and GitLab repositories; the other
          // provider rows exist so the machine's readiness is visible, and they
          // are never enabled.
          // A computer whose GitHub CLI is installed but signed out is signed in from
          // the repository list on the next step (its `gh auth login`, one-time code).
          const signsInFromList = source === 'github' && githubSignedOut(discovery);
          const enabled = (state.ready || signsInFromList) && (source === 'url' || isLookupProvider(source));
          return (
            <ListRow
              key={source}
              testID={`add-project-source-${source}`}
              title={addProjectSourceRowTitle(source)}
              description={
                signsInFromList
                  ? AddProjectCopy.githubSignInNextStep
                  : enabled
                    ? addProjectSourceRowDescription(source)
                    : state.hint
              }
              icon={sourceIcon(source, appearance.muted)}
              disabled={!enabled}
              trailing={
                enabled ? undefined : !signsInFromList && state.runInTerminal !== undefined ? (
                  <InlineActionButton
                    primary
                    testID={`add-project-source-${source}-run-in-terminal`}
                    label={EditMachineCopy.appUpdate.runInTerminal}
                    loading={openingTerminal}
                    onPress={() => {
                      if (state.runInTerminal !== undefined) runInTerminal(state.runInTerminal);
                    }}
                  />
                ) : (
                  <SetupRequiredBadge label={AddProjectCopy.setupRequired} />
                )
              }
              onPress={() => navigation.navigate('AddProjectRepository', { machineId, source })}
            />
          );
        })}
      </ListSection>
      {discoveryPending ? <PendingRow label={AddProjectCopy.discoveryPending} /> : null}
    </AddProjectShell>
  );
}
