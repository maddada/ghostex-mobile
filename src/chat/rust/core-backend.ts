/**
 * The chat core as the host drives it: the Rust core as WebAssembly in the hidden WebView
 * (`wasm-core/`). Every call answers through a promise.
 * SEE-ALSO: wasm-core/bridge.ts (CDXC:SessionChat 2026-10-28 DECISION).
 */

import type { ChatCoreEffect, ChatCoreError, ChatCoreQuery } from './core-types';
import type { ChatFrame } from './document';
import { createWasmChatCore } from './wasm-core/wasmChatCore';

/** One event's effects, or why the core refused it. */
export type HandledEvent = { ok: true; effects: ChatCoreEffect[] } | { ok: false; error: ChatCoreError };

export interface ChatCoreBackend {
  /** Applies events in order; one answer per event. */
  handleBatch(events: readonly { eventJson: string; contextJson: string }[]): Promise<HandledEvent[]>;
  /** Drains the frame envelope (`frame` in `core-types.ts`). */
  frame(lastRevision: number | null, nowMs: number): Promise<ChatFrame>;
  /** One of the core's pure helpers, parsed. */
  query(name: ChatCoreQuery, args: readonly unknown[]): Promise<unknown>;
  /** Every core in the WebView is gone (a crash or a reload): rebuild the chat. */
  onLost(listener: () => void): () => void;
  /**
   * The core owes an answer for too long: its page counts as stopped, as when it crashed, so
   * every core in it is lost (`onLost`) and the page starts again.
   */
  stalled(): void;
  dispose(): void;
}

/** A fresh core for one chat. Throws a `ChatCoreError` `unavailable` when it cannot run. */
export function createChatCoreBackend(): ChatCoreBackend {
  return createWasmChatCore();
}
