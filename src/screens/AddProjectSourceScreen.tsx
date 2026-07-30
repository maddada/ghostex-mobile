/**
 * Add Project step 1 — source picker (t3code spec §5.3).
 *
 * The machine is already chosen by the Projects context menu that opened this
 * flow, so there is no environment list here. Local folder is offered first,
 * then Git URL, then the hosting providers ordered by readiness. Unready
 * providers render disabled with the machine's own readiness hint; mobile has
 * no source-control settings screen to deep-link into, so there is no action
 * behind the "Setup required" badge.
 */

import { useEffect, useState, type ReactElement } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  discoverSourceControl,
  type AddProjectSourceControlDiscovery,
  type AddProjectSourceId,
} from '../addProject/client';
import {
  AddProjectShell,
  ErrorBanner,
  ListRow,
  ListSection,
  MutedText,
  PendingRow,
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
import { FolderOpenGlyph, GitForkGlyph, WorldGlyph } from '../components/sessions/icons';
import { AddProjectCopy } from '../copy';
import { machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'AddProjectSource'>;

function sourceIcon(source: AddProjectSourceId): ReactElement {
  return source === 'url' ? (
    <WorldGlyph size={16} color={GhostexPalette.MUTED} />
  ) : (
    <GitForkGlyph size={16} color={GhostexPalette.MUTED} />
  );
}

export default function AddProjectSourceScreen({ navigation, route }: Props): ReactElement {
  const { machineId } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);

  const [discovery, setDiscovery] = useState<AddProjectSourceControlDiscovery | null>(null);
  const [discoveryPending, setDiscoveryPending] = useState(true);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

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

  if (machine === null) {
    return (
      <AddProjectShell>
        <ErrorBanner message={AddProjectCopy.machineMissing} />
      </AddProjectShell>
    );
  }

  const readiness = buildAddProjectSourceReadiness(discovery);
  const sources = orderedAddProjectSources(readiness);

  return (
    <AddProjectShell>
      <MutedText>{AddProjectCopy.machineLine(machineDisplayLabel(machine))}</MutedText>
      {discoveryError === null ? null : <ErrorBanner message={discoveryError} />}
      <SectionTitle>{AddProjectCopy.sourcesSection}</SectionTitle>
      <ListSection>
        <ListRow
          first
          testID="add-project-source-local"
          title={AddProjectCopy.localRowTitle}
          description={AddProjectCopy.localRowDescription}
          icon={<FolderOpenGlyph size={16} color={GhostexPalette.MUTED} />}
          onPress={() => navigation.navigate('AddProjectLocal', { machineId })}
        />
        {sources.map((source) => {
          const state = readiness[source];
          // gxserver can only resolve GitHub and GitLab repositories; the other
          // provider rows exist so the machine's readiness is visible, and they
          // are never enabled.
          const enabled = state.ready && (source === 'url' || isLookupProvider(source));
          return (
            <ListRow
              key={source}
              testID={`add-project-source-${source}`}
              title={addProjectSourceRowTitle(source)}
              description={enabled ? addProjectSourceRowDescription(source) : state.hint}
              icon={sourceIcon(source)}
              disabled={!enabled}
              trailing={enabled ? undefined : <SetupRequiredBadge label={AddProjectCopy.setupRequired} />}
              onPress={() => navigation.navigate('AddProjectRepository', { machineId, source })}
            />
          );
        })}
      </ListSection>
      {discoveryPending ? <PendingRow label={AddProjectCopy.discoveryPending} /> : null}
    </AddProjectShell>
  );
}
