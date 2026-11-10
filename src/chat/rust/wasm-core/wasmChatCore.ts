/**
 * One chat's core in the hidden WebView: a handle the page answered `new` with, and the calls the
 * host makes on it, all through {@link wasmCoreBridge}. The answers are the core's own JSON, parsed
 * once by the bridge.
 */

import type { ChatCoreBackend, HandledEvent } from '../core-backend';
import { ChatCoreError, type ChatCoreEffect } from '../core-types';
import type { ChatFrame } from '../document';
import { wasmCoreBridge } from './bridge';

export function createWasmChatCore(): ChatCoreBackend {
  let disposed = false;
  let lost = false;
  const handle: Promise<number> = wasmCoreBridge.call({ op: 'new' }).then((value) => {
    if (typeof value !== 'number') throw new ChatCoreError('unknown', 'The chat core answered no handle.');
    wasmCoreBridge.coreCreated();
    return value;
  });
  // Keeps an unawaited rejection from surfacing; every caller awaits `handle` itself.
  handle.catch(() => undefined);
  const lostListeners = new Set<() => void>();
  const unsubscribe = wasmCoreBridge.onLost(() => {
    lost = true;
    for (const listener of [...lostListeners]) listener();
  });

  const live = async (): Promise<number> => {
    if (disposed) throw new ChatCoreError('disposed', 'This chat core was disposed.');
    if (lost) throw new ChatCoreError('lost', 'The chat core page was reloaded.');
    return handle;
  };

  return {
    async handleBatch(events) {
      const id = await live();
      const answers = await wasmCoreBridge.batch(
        events.map((event) => ({ op: 'handle', handle: id, args: [event.eventJson, event.contextJson] })),
      );
      return answers.map((answer): HandledEvent =>
        answer.ok ? { ok: true, effects: answer.value as ChatCoreEffect[] } : { ok: false, error: answer.error },
      );
    },
    async frame(lastRevision, nowMs) {
      const id = await live();
      return (await wasmCoreBridge.call({ op: 'frameAt', handle: id, args: [lastRevision, nowMs] })) as ChatFrame;
    },
    async query(name, args) {
      const id = await live();
      return wasmCoreBridge.call({ op: 'query', handle: id, args: [name, JSON.stringify(args)] });
    },
    onLost(listener) {
      lostListeners.add(listener);
      return () => {
        lostListeners.delete(listener);
      };
    },
    stalled() {
      if (!disposed && !lost) wasmCoreBridge.stalled();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      lostListeners.clear();
      if (lost) return;
      void handle
        .then((id) => wasmCoreBridge.call({ op: 'dispose', handle: id }))
        .then(() => wasmCoreBridge.coreDisposed())
        .catch(() => undefined);
    },
  };
}
