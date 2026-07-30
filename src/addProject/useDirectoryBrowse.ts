/**
 * Directory-suggestion state for an Add Project path input.
 *
 * The fetch is keyed on the DIRECTORY portion of the query only (t3code spec
 * §2.4), so typing a leaf name never refetches and no debounce is needed;
 * crossing a `/` issues exactly one new request. Leaf filtering is client-side
 * and hidden folders are always excluded on mobile (spec §5.6).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { MachineConnectionTarget } from '../machines/credentials';
import {
  browseDirectories,
  type AddProjectBrowseEntry,
  type AddProjectBrowseResult,
} from './client';
import { getBrowseDirectoryPath, getBrowseLeafPathSegment, hasTrailingPathSeparator } from './paths';

export type DirectoryBrowseState = {
  /** Entries for the query's directory, filtered by the typed leaf segment. */
  entries: AddProjectBrowseEntry[];
  /** Raw result for the directory currently shown, null before the first load. */
  result: AddProjectBrowseResult | null;
  /** True while a request for the current directory is in flight. */
  pending: boolean;
  /** True only for the first load of a directory (spinner, not revalidation). */
  firstLoad: boolean;
  error: string | null;
  /** Entry whose name matches the typed leaf exactly (case-sensitive). */
  exactEntry: AddProjectBrowseEntry | null;
};

export function useDirectoryBrowse(
  machine: MachineConnectionTarget | null,
  query: string,
): DirectoryBrowseState {
  const directory = getBrowseDirectoryPath(query);
  const machineId = machine?.id ?? null;
  const [result, setResult] = useState<AddProjectBrowseResult | null>(null);
  const [loadedDirectory, setLoadedDirectory] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (machine === null || directory.length === 0) {
      setResult(null);
      setLoadedDirectory(null);
      setPending(false);
      setError(null);
      return;
    }
    const requestId = ++requestRef.current;
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const next = await browseDirectories(machine, directory);
        if (requestRef.current !== requestId) return;
        setResult(next);
        setLoadedDirectory(directory);
        setPending(false);
      } catch (failure) {
        if (requestRef.current !== requestId) return;
        setResult(null);
        setLoadedDirectory(directory);
        setPending(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    })();
    // Keyed on the machine ID rather than the record: the record is looked up
    // fresh on every render, so depending on it would refetch on every keystroke.
  }, [directory, machineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCurrent = loadedDirectory === directory;
  const currentResult = isCurrent ? result : null;

  const filter = hasTrailingPathSeparator(query) ? '' : getBrowseLeafPathSegment(query);

  const entries = useMemo(() => {
    const source = currentResult?.entries ?? [];
    const lower = filter.toLowerCase();
    return source.filter(
      (entry) => !entry.name.startsWith('.') && entry.name.toLowerCase().startsWith(lower),
    );
  }, [currentResult, filter]);

  const exactEntry = useMemo(() => {
    if (filter.length === 0) return null;
    return entries.find((entry) => entry.name === filter) ?? null;
  }, [entries, filter]);

  return {
    entries,
    result: currentResult,
    pending,
    firstLoad: pending && !isCurrent,
    error: isCurrent ? error : null,
    exactEntry,
  };
}
