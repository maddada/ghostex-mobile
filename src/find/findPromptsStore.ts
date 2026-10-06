/**
 * Find state for one machine, shared by the results screen and the prompt
 * screen it pushes, so a star or a full prompt fetched on one shows on the other.
 *
 * Results are pages, not the whole list: gxserver holds tens of thousands of
 * prompts and ranks them per keystroke, so the phone asks for the first page
 * and appends the next one as the list scrolls toward its end.
 */

import { create } from 'zustand';

import type { MachineConnectionTarget } from '../machines/credentials';
import {
  readFindPromptText,
  searchFindPrompts,
  setFindPromptFavorite,
  type FindPromptAgent,
  type FindPromptAgentFacet,
  type FindPromptProjectFacet,
  type FindPromptRow,
  type FindPromptsSearchParams,
} from './promptSearch';

/** Rows fetched per page. */
export const FIND_PROMPTS_PAGE_SIZE = 120;

export type FindPromptsNotice = {
  detail?: string;
  kind: 'error' | 'info';
  message: string;
};

type FindPromptsState = {
  machineId: string | null;
  query: string;
  /** Agent filter; empty means every agent. */
  agents: readonly FindPromptAgent[];
  /** Project path filter; null means every project. */
  project: string | null;
  groupByDay: boolean;
  rows: readonly FindPromptRow[];
  matched: number;
  total: number;
  agentFacets: readonly FindPromptAgentFacet[];
  projectFacets: readonly FindPromptProjectFacet[];
  /** A first page is on its way (typing, a filter change, opening Find). */
  loading: boolean;
  /** The next page is on its way. */
  loadingMore: boolean;
  /** Pull to refresh is rebuilding the index. */
  refreshing: boolean;
  notice: FindPromptsNotice | null;
  /** Whole prompts fetched for the prompt screen, by key. */
  fullText: Readonly<Record<string, string>>;

  open: (machineId: string) => void;
  setQuery: (query: string) => void;
  toggleAgent: (agent: FindPromptAgent) => void;
  clearAgents: () => void;
  setProject: (project: string | null) => void;
  setGroupByDay: (groupByDay: boolean) => void;
  setNotice: (notice: FindPromptsNotice | null) => void;
  search: (machine: MachineConnectionTarget, options?: { refresh?: boolean }) => Promise<void>;
  loadMore: (machine: MachineConnectionTarget) => Promise<void>;
  toggleFavorite: (machine: MachineConnectionTarget, key: string) => Promise<void>;
  loadFullText: (machine: MachineConnectionTarget, row: FindPromptRow) => Promise<void>;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'Unknown error';
}

/** One notice for the agent histories gxserver found but could not read; null when both read fine. */
function unreadableHistoryNotice(opencodeError?: string, empryoError?: string): FindPromptsNotice | null {
  if (opencodeError && empryoError) {
    return { detail: `${opencodeError}\n${empryoError}`, kind: 'info', message: 'opencode and Empryo history could not be read.' };
  }
  if (opencodeError) return { detail: opencodeError, kind: 'info', message: 'opencode history could not be read.' };
  if (empryoError) return { detail: empryoError, kind: 'info', message: 'Empryo history could not be read.' };
  return null;
}

const FRESH = {
  query: '',
  agents: [] as readonly FindPromptAgent[],
  project: null,
  groupByDay: true,
  rows: [] as readonly FindPromptRow[],
  matched: 0,
  total: 0,
  agentFacets: [] as readonly FindPromptAgentFacet[],
  projectFacets: [] as readonly FindPromptProjectFacet[],
  loading: true,
  loadingMore: false,
  refreshing: false,
  notice: null,
  fullText: {},
};

/** Bumped by every first-page search, so a slower earlier answer never overwrites a newer one. */
let searchSequence = 0;

export const useFindPromptsStore = create<FindPromptsState>()((set, get) => {
  const searchParams = (offset: number, refresh: boolean): FindPromptsSearchParams => {
    const { agents, groupByDay, project, query } = get();
    return {
      agents,
      groupByDay,
      // The filter sheets need the facets once per result set, not once per page.
      includeFacets: offset === 0,
      limit: FIND_PROMPTS_PAGE_SIZE,
      offset,
      project,
      query,
      refresh,
    };
  };

  return {
    machineId: null,
    ...FRESH,

    open: (machineId) => {
      if (get().machineId === machineId) return;
      searchSequence += 1;
      set({ machineId, ...FRESH });
    },
    setQuery: (query) => set({ query }),
    toggleAgent: (agent) =>
      set(({ agents }) => ({
        agents: agents.includes(agent) ? agents.filter((entry) => entry !== agent) : [...agents, agent],
      })),
    clearAgents: () => set({ agents: [] }),
    setProject: (project) => set({ project }),
    setGroupByDay: (groupByDay) => set({ groupByDay }),
    setNotice: (notice) => set({ notice }),

    search: async (machine, options) => {
      const refresh = options?.refresh === true;
      const sequence = ++searchSequence;
      set(refresh ? { refreshing: true } : { loading: true });
      try {
        const result = await searchFindPrompts(machine, searchParams(0, refresh));
        if (sequence !== searchSequence) return;
        set({
          rows: result.rows,
          matched: result.matched,
          total: result.total,
          ...(result.agents ? { agentFacets: result.agents } : {}),
          ...(result.projects ? { projectFacets: result.projects } : {}),
          notice: unreadableHistoryNotice(result.opencodeError, result.empryoError),
        });
      } catch (error) {
        if (sequence !== searchSequence) return;
        set({ notice: { detail: errorMessage(error), kind: 'error', message: 'Search failed.' } });
      } finally {
        if (sequence === searchSequence) set({ loading: false, refreshing: false });
      }
    },

    loadMore: async (machine) => {
      const { loading, loadingMore, matched, rows } = get();
      if (loading || loadingMore || rows.length >= matched) return;
      const sequence = searchSequence;
      set({ loadingMore: true });
      try {
        const result = await searchFindPrompts(machine, searchParams(rows.length, false));
        if (sequence !== searchSequence) return;
        set((state) => {
          const seen = new Set(state.rows.map((row) => row.key));
          return {
            rows: [...state.rows, ...result.rows.filter((row) => !seen.has(row.key))],
            matched: result.matched,
            total: result.total,
          };
        });
      } catch (error) {
        if (sequence === searchSequence) {
          set({ notice: { detail: errorMessage(error), kind: 'error', message: 'Could not load more prompts.' } });
        }
      } finally {
        if (sequence === searchSequence) set({ loadingMore: false });
      }
    },

    toggleFavorite: async (machine, key) => {
      const row = get().rows.find((candidate) => candidate.key === key);
      if (row === undefined) return;
      const next = !row.favorite;
      const paint = (favorite: boolean) =>
        set((state) => ({
          rows: state.rows.map((candidate) => (candidate.key === key ? { ...candidate, favorite } : candidate)),
        }));
      // Paint at once; the list re-ranks on the next search because favorites form a tier above every score.
      paint(next);
      try {
        paint(await setFindPromptFavorite(machine, key, next));
      } catch (error) {
        paint(!next);
        set({ notice: { detail: errorMessage(error), kind: 'error', message: 'Could not update the favorite.' } });
      }
    },

    loadFullText: async (machine, row) => {
      if (!row.truncated || get().fullText[row.key] !== undefined) return;
      try {
        const text = await readFindPromptText(machine, row.key);
        if (text.length > 0) set((state) => ({ fullText: { ...state.fullText, [row.key]: text } }));
      } catch {
        // The capped row text is already showing; a failed top-up is not worth replacing it with an error.
      }
    },
  };
});
