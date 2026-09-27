/**
 * `useGpuiChat(target)`: the same {@link RustChat} surface as `useRustChat`, for a chat whose
 * transcript GPUI draws (`GpuiChatHost`). The screen picks one of the two per the
 * `sessionChatGpuiTranscript` setting; the composer, cards and overlays cannot tell them apart.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { RustChatTarget } from '../rust/host';
import type { RustChat } from '../rust/useRustChat';
import { GpuiChatHost } from './GpuiChatHost';

const noop = (): void => undefined;
const noSubscription = (): (() => void) => noop;
const emptySnapshot = (): null => null;

export function useGpuiChat(target: RustChatTarget | null): RustChat {
  const machineId = target?.machine.id ?? '';
  const projectId = target?.projectId ?? '';
  const sessionId = target?.sessionId ?? '';
  const [host, setHost] = useState<GpuiChatHost | null>(null);

  // The machine object changes identity on every store update; only the chat's identity matters.
  const latestTarget = useMemo(() => target, [machineId, projectId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (latestTarget === null) {
      setHost(null);
      return undefined;
    }
    const opened = new GpuiChatHost(latestTarget);
    opened.open();
    setHost(opened);
    return () => {
      setHost(null);
      opened.dispose();
    };
  }, [latestTarget]);

  const subscribe = useCallback((listener: () => void) => (host ? host.subscribe(listener) : noop), [host]);
  const snapshot = useCallback(() => (host ? host.getState() : null), [host]);
  const state = useSyncExternalStore(host ? subscribe : noSubscription, host ? snapshot : emptySnapshot);

  // Stable per chat, like `useRustChat`'s: the screen resubscribes when these change identity.
  const actions = useMemo(
    () => ({
      dispatch: (action: Parameters<RustChat['dispatch']>[0]) => host?.dispatch(action),
      // The Rust host lays the composer's controls out from its own measurements for now.
      measure: noop,
      setTitle: noop,
      composer: host ? host.composerInput : null,
      attachFiles: (files: Parameters<RustChat['attachFiles']>[0]) => host?.attachFiles(files) ?? Promise.resolve(),
      query: (name: Parameters<RustChat['query']>[0], args: readonly unknown[]) => (host ? host.query(name, args) : null),
      onViewRequest: (listener: Parameters<RustChat['onViewRequest']>[0]) =>
        host ? host.onViewRequest(listener) : noop,
    }),
    [host]
  );
  return useMemo<RustChat>(() => ({ state, ...actions }), [state, actions]);
}
