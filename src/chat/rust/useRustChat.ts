/**
 * `useRustChat(target)`: the Rust chat core for one open chat, as React state.
 *
 * Returns the latest {@link RustChatState} (document, transcript items with splices applied,
 * composer model, images) plus the host's inputs. The host is shared per chat, so two components
 * that open the same chat (the dev shadow and a native screen) drive one core.
 *
 * ```tsx
 * const chat = useRustChat({ machine, projectId, sessionId });
 * chat.state?.items.map(...)                       // draw the transcript
 * chat.dispatch({ type: 'toggleSummary' })         // any UserAction
 * chat.composer.edited(text, selection)            // bind the TextInput
 * chat.composer.submit('send')
 * useEffect(() => chat.onViewRequest(perform), [chat.onViewRequest])  // copy, toast, open, ...
 * ```
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { UserAction } from './actions';
import type { ChatViewRequest } from './effects';
import type { ChatMeasurement } from './events';
import type { ChatCoreQuery } from './core-types';
import { acquireRustChatHost, type RustChatHost, type RustChatState, type RustChatTarget } from './host';

export type RustChat = {
  /** Null while no target is set. */
  state: RustChatState | null;
  dispatch(action: UserAction): void;
  measure(measurement: ChatMeasurement): void;
  /** Pushes the session's display title into the core (see `RustChatHost.setTitle`). */
  setTitle(title: string | null): void;
  /** Whether a screen shows this chat; a parked one tells the core it is hidden (`RustChatHost.setShown`). */
  setShown(shown: boolean): void;
  composer: RustChatHost['composerInput'] | null;
  attachFiles(files: readonly { uri: string; name?: string }[]): Promise<void>;
  /** Uploads files to the machine and answers their paths (see `RustChatHost.uploadFiles`). */
  uploadFiles(files: readonly { uri: string; name?: string }[]): Promise<string[]>;
  /**
   * One of the core's pure helpers (see `RustChatHost.query`); null while no core runs. The answer
   * can arrive a moment later: the function changes identity when it does, so a memo that depends
   * on it computes again.
   */
  query(name: ChatCoreQuery, args: readonly unknown[]): unknown;
  /** The same helper, awaited (for an action that needs the answer to go on). */
  queryAsync(name: ChatCoreQuery, args: readonly unknown[]): Promise<unknown>;
  /** Subscribe to view requests; returns the unsubscribe. Stable per chat. */
  onViewRequest(listener: (request: ChatViewRequest) => void): () => void;
  /** The computer this chat lives on (stable per chat), or null while no target is set. */
  machine: RustChatTarget['machine'] | null;
};

const noop = (): void => undefined;
const noSubscription = (): (() => void) => noop;
const emptySnapshot = (): null => null;

export function useRustChat(target: RustChatTarget | null): RustChat {
  const machineId = target?.machine.id ?? '';
  const projectId = target?.projectId ?? '';
  const sessionId = target?.sessionId ?? '';
  const [host, setHost] = useState<RustChatHost | null>(null);

  // The machine object changes identity on every store update; only the chat's identity matters.
  const latestTarget = useMemo(() => target, [machineId, projectId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (latestTarget === null) {
      setHost(null);
      return undefined;
    }
    const held = acquireRustChatHost(latestTarget);
    setHost(held.host);
    return () => {
      setHost(null);
      held.release();
    };
  }, [latestTarget]);

  const subscribe = useCallback((listener: () => void) => (host ? host.subscribe(listener) : noop), [host]);
  const snapshot = useCallback(() => (host ? host.getState() : null), [host]);
  const state = useSyncExternalStore(host ? subscribe : noSubscription, host ? snapshot : emptySnapshot);

  const dispatch = useCallback((action: UserAction) => host?.dispatch(action), [host]);
  const measure = useCallback((measurement: ChatMeasurement) => host?.measure(measurement), [host]);
  const setTitle = useCallback((title: string | null) => host?.setTitle(title), [host]);
  const setShown = useCallback((shown: boolean) => host?.setShown(shown), [host]);
  const attachFiles = useCallback(
    (files: readonly { uri: string; name?: string }[]) => host?.attachFiles(files) ?? Promise.resolve(),
    [host],
  );
  const uploadFiles = useCallback(
    (files: readonly { uri: string; name?: string }[]) => host?.uploadFiles(files) ?? Promise.resolve([]),
    [host],
  );
  const onViewRequest = useCallback(
    (listener: (request: ChatViewRequest) => void) => (host ? host.onViewRequest(listener) : noop),
    [host],
  );
  const queryRevision = state?.queryRevision ?? 0;
  const query = useCallback(
    (name: ChatCoreQuery, args: readonly unknown[]) => (host ? host.query(name, args) : null),
    // `queryRevision` moves when a late answer arrives, so callers memoizing on `query` ask again.
    [host, queryRevision], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const queryAsync = useCallback(
    (name: ChatCoreQuery, args: readonly unknown[]) => (host ? host.queryAsync(name, args) : Promise.resolve(null)),
    [host],
  );
  const machine = latestTarget?.machine ?? null;
  return useMemo<RustChat>(
    () => ({
      state,
      dispatch,
      measure,
      setTitle,
      setShown,
      composer: host?.composerInput ?? null,
      attachFiles,
      uploadFiles,
      query,
      queryAsync,
      onViewRequest,
      machine,
    }),
    [
      host,
      state,
      dispatch,
      measure,
      setTitle,
      setShown,
      attachFiles,
      uploadFiles,
      query,
      queryAsync,
      onViewRequest,
      machine,
    ],
  );
}
