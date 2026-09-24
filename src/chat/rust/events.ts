/**
 * Everything that can reach the Rust chat core, as JSON (`Event` in
 * `packages/gx-chat-core/src/event.rs`).
 *
 * The JSON spelling is owned by the binding (`modules/gx-chat-core/src/index.ts`, which mirrors the
 * Rust enum in `packages/gx-chat-mobile`), so it is re-exported here rather than written twice. The
 * host (`host.ts`) is the only producer; the screen never builds events itself. It calls
 * `dispatch(action)` (an `action` event), `measure(...)` (a `measured` event) and the composer
 * helpers, and the host turns frames, RPC answers, storage answers and timers into the rest.
 *
 * Where each event comes from on the phone:
 *
 * | event | phone source |
 * | --- | --- |
 * | `start` | `RustChatHost.start()`, once per open chat |
 * | `composerBootRead` / `composerBootFailed` | the `readComposerBoot` effect, answered from AsyncStorage (`boot.ts`) |
 * | `retainedSnapshotLoaded` | the `readRetainedSnapshot` effect, answered from the snapshot files (`storage.ts`) |
 * | `frame` | each changed `readSessionChat` long-poll answer, as a synthesized `sessionChatSnapshot` (`transport.ts`) |
 * | `connection` | the long-poll loop: `subscribed` on its first answer, `lost` on its first failure, `resubscribed` when it recovers |
 * | `rpcSettled` | every `sendRpc`, answered by `ghostex session-chat-rpc` over SSH |
 * | `action` | the screen, through `dispatch` |
 * | `tick` | the `setTimer` effect's `setTimeout` |
 * | `storageLoaded` / `storageWritten` / `storageBatch*` | AsyncStorage answers (`storage.ts`, `host-records.ts`) |
 * | `measured` | the screen, through `measure` |
 * | `draftChanged` | not sent: the host reports text through `editDraft` actions, as desktop does |
 */

export type {
  ChatCoreContext,
  ChatCoreEvent,
  ChatMeasurement,
  ChatRpcError,
  ChatStorageKey,
} from '../../../modules/gx-chat-core/src';

import type { ChatStorageKey } from '../../../modules/gx-chat-core/src';

/** Two storage keys name the same record. */
export function sameStorageKey(left: ChatStorageKey, right: ChatStorageKey): boolean {
  return left.store === right.store && left.suffix === right.suffix;
}
