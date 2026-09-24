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
import { acquireRustChatHost, type RustChatHost, type RustChatState, type RustChatTarget } from './host';

export type RustChat = {
  /** Null while no target is set. */
  state: RustChatState | null;
  dispatch(action: UserAction): void;
  measure(measurement: ChatMeasurement): void;
  composer: RustChatHost['composerInput'] | null;
  attachFiles(files: readonly { uri: string; name?: string }[]): Promise<void>;
  /** Subscribe to view requests; returns the unsubscribe. Stable per chat. */
  onViewRequest(listener: (request: ChatViewRequest) => void): () => void;
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
  const attachFiles = useCallback(
    (files: readonly { uri: string; name?: string }[]) => host?.attachFiles(files) ?? Promise.resolve(),
    [host]
  );
  const onViewRequest = useCallback(
    (listener: (request: ChatViewRequest) => void) => (host ? host.onViewRequest(listener) : noop),
    [host]
  );
  return useMemo<RustChat>(
    () => ({ state, dispatch, measure, composer: host?.composerInput ?? null, attachFiles, onViewRequest }),
    [host, state, dispatch, measure, attachFiles, onViewRequest]
  );
}
