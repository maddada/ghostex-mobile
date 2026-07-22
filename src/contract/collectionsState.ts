/**
 * Full-state read-modify-write helpers for the durable sidebar project
 * collections ({order, collections, nextCollectionNumber}), mirroring the
 * desktop's project-collections.ts semantics: one project per collection,
 * "Group N" default titles, and the 9-color palette cycled by (N-1) % 9.
 * The modified state is sent whole via
 * `ghostex update-sidebar-project-collections --state-json`; gxserver owns
 * normalization.
 */

export type CollectionColorOption = { label: string; value: string };

/** Desktop palette (sidebar/project-collections.ts), order preserved. */
export const COLLECTION_COLOR_OPTIONS: readonly CollectionColorOption[] = [
  { label: 'Transparent', value: 'transparent' },
  { label: 'Gray', value: '#808080' },
  { label: 'Violet', value: '#7c6df2' },
  { label: 'Green', value: '#3aa675' },
  { label: 'Orange', value: '#d6873f' },
  { label: 'Pink', value: '#d75b72' },
  { label: 'Blue', value: '#3f8fc7' },
  { label: 'Purple', value: '#b36ad4' },
  { label: 'Lime', value: '#8c9b45' },
];

export type CollectionsState = {
  order: string[];
  collections: Record<
    string,
    {
      collectionId: string;
      title: string;
      color: string;
      collapsed: boolean;
      projectIds: string[];
      [extra: string]: unknown;
    }
  >;
  nextCollectionNumber: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-clone the wire state into a normalized, safely mutable shape. */
export function cloneCollectionsState(raw: unknown): CollectionsState {
  const state: CollectionsState = { order: [], collections: {}, nextCollectionNumber: 1 };
  if (!isObject(raw)) return state;
  if (Array.isArray(raw.order)) {
    state.order = raw.order.filter((entry): entry is string => typeof entry === 'string');
  }
  if (isObject(raw.collections)) {
    for (const [id, entry] of Object.entries(raw.collections)) {
      if (!isObject(entry)) continue;
      state.collections[id] = {
        ...entry,
        collectionId: typeof entry.collectionId === 'string' ? entry.collectionId : id,
        title: typeof entry.title === 'string' ? entry.title : '',
        color: typeof entry.color === 'string' ? entry.color : 'transparent',
        collapsed: entry.collapsed === true,
        projectIds: Array.isArray(entry.projectIds)
          ? entry.projectIds.filter((value): value is string => typeof value === 'string')
          : [],
      };
    }
  }
  if (typeof raw.nextCollectionNumber === 'number' && Number.isFinite(raw.nextCollectionNumber)) {
    state.nextCollectionNumber = Math.max(1, Math.floor(raw.nextCollectionNumber));
  }
  return state;
}

function removeProjectEverywhere(state: CollectionsState, projectId: string): void {
  for (const collection of Object.values(state.collections)) {
    collection.projectIds = collection.projectIds.filter((id) => id !== projectId);
  }
}

/** Move `projectId` into `collectionId` (a project lives in one collection). */
export function stateWithProjectInCollection(
  raw: unknown,
  collectionId: string,
  projectId: string,
): CollectionsState {
  const state = cloneCollectionsState(raw);
  removeProjectEverywhere(state, projectId);
  const target = state.collections[collectionId];
  if (target !== undefined && !target.projectIds.includes(projectId)) {
    target.projectIds.push(projectId);
  }
  return state;
}

/** Remove `projectId` from whichever collection holds it. */
export function stateWithoutProject(raw: unknown, projectId: string): CollectionsState {
  const state = cloneCollectionsState(raw);
  removeProjectEverywhere(state, projectId);
  return state;
}

/** Create "Group N" with the palette-cycled color, containing `projectId`. */
export function stateWithNewCollection(raw: unknown, projectId: string): CollectionsState {
  const state = cloneCollectionsState(raw);
  removeProjectEverywhere(state, projectId);
  const number = state.nextCollectionNumber;
  const collectionId = `collection-${Date.now()}-${number}`;
  state.collections[collectionId] = {
    collectionId,
    title: `Group ${number}`,
    color: COLLECTION_COLOR_OPTIONS[(number - 1) % COLLECTION_COLOR_OPTIONS.length].value,
    collapsed: false,
    projectIds: [projectId],
  };
  state.order.push(collectionId);
  state.nextCollectionNumber = number + 1;
  return state;
}

export function stateWithCollectionTitle(
  raw: unknown,
  collectionId: string,
  title: string,
): CollectionsState {
  const state = cloneCollectionsState(raw);
  const target = state.collections[collectionId];
  if (target !== undefined) target.title = title;
  return state;
}

export function stateWithCollectionColor(
  raw: unknown,
  collectionId: string,
  color: string,
): CollectionsState {
  const state = cloneCollectionsState(raw);
  const target = state.collections[collectionId];
  if (target !== undefined) target.color = color;
  return state;
}

/** Delete the collection; member projects simply become ungrouped. */
export function stateWithoutCollection(raw: unknown, collectionId: string): CollectionsState {
  const state = cloneCollectionsState(raw);
  delete state.collections[collectionId];
  state.order = state.order.filter((id) => id !== collectionId);
  return state;
}

/** Id of the collection currently holding `projectId`, or null. */
export function collectionIdForProject(raw: unknown, projectId: string): string | null {
  const state = cloneCollectionsState(raw);
  for (const collection of Object.values(state.collections)) {
    if (collection.projectIds.includes(projectId)) return collection.collectionId;
  }
  return null;
}
