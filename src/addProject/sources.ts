/**
 * Add Project source labels, readiness, and ordering — the mobile port of
 * plans/014-add-project-dialog.t3code-spec.md §§3.2-3.4. Ghostex's discovery
 * payload keys providers by `provider` and adds a `unsupported` status for
 * providers gxserver has no implementation for (Part A handoff).
 */

import { AddProjectCopy } from '../copy';
import type {
  AddProjectProviderDiscovery,
  AddProjectProviderId,
  AddProjectSourceControlDiscovery,
  AddProjectSourceId,
} from './client';

export const ADD_PROJECT_PROVIDER_SOURCES: readonly AddProjectProviderId[] = [
  'github',
  'gitlab',
  'bitbucket',
  'azure-devops',
];

/** Providers gxserver can resolve a repository through (Part A). */
export function isLookupProvider(source: AddProjectSourceId): source is 'github' | 'gitlab' {
  return source === 'github' || source === 'gitlab';
}

export function addProjectSourceLabel(source: AddProjectSourceId): string {
  switch (source) {
    case 'url':
      return 'Git URL';
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'bitbucket':
      return 'Bitbucket';
    case 'azure-devops':
      return 'Azure DevOps';
  }
}

export function addProjectSourcePathHint(source: AddProjectSourceId): string {
  switch (source) {
    case 'url':
      return 'URL';
    case 'github':
      return 'owner/repo';
    case 'gitlab':
      return 'group/project';
    case 'bitbucket':
      return 'workspace/repository';
    case 'azure-devops':
      return 'project/repository';
  }
}

export function addProjectSourceRowTitle(source: AddProjectSourceId): string {
  return source === 'url' ? 'Git URL' : `${addProjectSourceLabel(source)} repository`;
}

export function addProjectSourceRowDescription(source: AddProjectSourceId): string {
  return source === 'url'
    ? 'Clone from a remote URL'
    : `Clone ${addProjectSourceLabel(source)} ${addProjectSourcePathHint(source)}`;
}

/** Repository-step input placeholder (spec §5.4). */
export function addProjectRepositoryPlaceholder(source: AddProjectSourceId): string {
  return source === 'url'
    ? AddProjectCopy.urlPlaceholder
    : AddProjectCopy.repositoryPlaceholder(
        addProjectSourceLabel(source),
        addProjectSourcePathHint(source),
      );
}

/** Repository-step action label (spec §5.4). */
export function addProjectRepositoryActionLabel(source: AddProjectSourceId): string {
  return source === 'url' ? AddProjectCopy.continueButton : AddProjectCopy.lookupButton;
}

export type AddProjectSourceReadiness = { ready: boolean; hint: string | null };

function unavailableReadiness(): AddProjectSourceReadiness {
  return { ready: false, hint: AddProjectCopy.providerUnavailableHint };
}

function readinessForProvider(
  provider: AddProjectProviderDiscovery,
): AddProjectSourceReadiness {
  const label = provider.label.length > 0 ? provider.label : addProjectSourceLabel(provider.provider);
  if (provider.status !== 'available') {
    const hint = provider.installHint.trim();
    return { ready: false, hint: hint.length > 0 ? hint : AddProjectCopy.providerUnavailableHint };
  }
  if (provider.auth.status === 'unauthenticated') {
    const detail = provider.auth.detail?.trim() ?? '';
    return {
      ready: false,
      hint: detail.length > 0 ? detail : AddProjectCopy.providerUnauthenticatedHint(label),
    };
  }
  // `unknown` auth counts as ready — spec §3.3.
  return { ready: true, hint: null };
}

/**
 * Readiness per source. A missing discovery (not fetched yet, or the probe
 * failed) leaves every provider unavailable; Git URL never depends on a
 * hosting CLI, so it stays ready.
 */
export function buildAddProjectSourceReadiness(
  discovery: AddProjectSourceControlDiscovery | null,
): Record<AddProjectSourceId, AddProjectSourceReadiness> {
  const readiness: Record<AddProjectSourceId, AddProjectSourceReadiness> = {
    url: { ready: true, hint: null },
    github: unavailableReadiness(),
    gitlab: unavailableReadiness(),
    bitbucket: unavailableReadiness(),
    'azure-devops': unavailableReadiness(),
  };
  if (discovery === null) return readiness;
  for (const source of ADD_PROJECT_PROVIDER_SOURCES) {
    const provider = discovery.providers.find((entry) => entry.provider === source);
    readiness[source] = provider === undefined ? unavailableReadiness() : readinessForProvider(provider);
  }
  return readiness;
}

/** Ready providers first, then alphabetical by label (spec §3.4). */
export function sortAddProjectProviderSources(
  readiness: Record<AddProjectSourceId, AddProjectSourceReadiness>,
): AddProjectProviderId[] {
  return [...ADD_PROJECT_PROVIDER_SOURCES].sort((left, right) => {
    const leftReady = readiness[left].ready;
    const rightReady = readiness[right].ready;
    if (leftReady !== rightReady) return leftReady ? -1 : 1;
    return addProjectSourceLabel(left).localeCompare(addProjectSourceLabel(right));
  });
}

/** Git URL first, then providers in readiness order (spec §3.4). */
export function orderedAddProjectSources(
  readiness: Record<AddProjectSourceId, AddProjectSourceReadiness>,
): AddProjectSourceId[] {
  return ['url', ...sortAddProjectProviderSources(readiness)];
}
