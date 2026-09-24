/**
 * Everything the Rust chat core asks the phone host to do (`Effect` in
 * `packages/gx-chat-core/src/effect.rs`), and the view requests the host hands the screen.
 *
 * The effect JSON is owned by the binding (`modules/gx-chat-core/src/index.ts`) and re-exported
 * here. How the phone performs each one (`host.ts`, `performEffect`):
 *
 * | effect | phone |
 * | --- | --- |
 * | `sendRpc` | `ghostex session-chat-rpc <method>` over SSH; `readNativeComposer` and `importNativeAttachments` answered locally |
 * | `subscribe` / `unsubscribe` / `reconnect` | start, stop, restart the `readSessionChat` long poll |
 * | `readStorage*` / `writeStorage*` / `flushStorage` | AsyncStorage (`storage.ts`) plus the host-owned draft operations (`host-records.ts`) |
 * | `readComposerBoot` | the boot read (`boot.ts`) |
 * | `readRetainedSnapshot` / `writeRetainedSnapshot` | the retained transcript files (`storage.ts`) |
 * | `updatePresentation` | kept in memory and handed to the next `start` as `initialPresentation` |
 * | `recordDeliveries` | the sent history and delivery receipts (`host-records.ts`) |
 * | `setTimer` | one `setTimeout` per chat, replaced on each effect |
 * | `setComposerText` / `clearComposerIfUnchanged` / `restoreReturnedPrompt` | the host's composer model (`composer.ts`) |
 * | `hostAction` | `selectOption` fed back to the core, `suggestionSend` ignored (desktop ignores it too), the composer-owned ones (`draftSubmitted`, `submissionFailed`, `draftReceived`, `attachmentReferences`, `chatImage`) handled in the host, the rest handed to the screen |
 * | `open` / `copy` / `toast` / `markdownSaved` | handed to the screen as a {@link ChatViewRequest} |
 *
 * Nothing is dropped silently: an effect the host does not know is counted and logged once.
 */

import type { ChatCoreEffect } from '../../../modules/gx-chat-core/src';

export type { ChatCoreEffect } from '../../../modules/gx-chat-core/src';

/** The `type` of every effect variant, for the counters. */
export type EffectType = ChatCoreEffect['type'];

/**
 * Something only the screen or the app shell can do, published by the host in order.
 *
 * Desktop performs the same set in `apps/desktop/src/app/native_chat/state.rs` (`apply_output`,
 * the `requests` loop) and the app shell (`receive_session_chat_host_action`).
 */
export type ChatViewRequest =
  /** Put text on the clipboard (expo-clipboard). */
  | { kind: 'copy'; text: string }
  /** Show a toast. `level` is `error` or anything else for success/info. `title` is set for the
   * send-blocked toast (the core's `sendBlockedToast` answer: title "can't send", `message` the
   * reason). */
  | { kind: 'toast'; level: string; message: string; title?: string }
  /** Open a URL, or a machine file at an optional position. */
  | { kind: 'open'; target: { kind: 'url'; url: string } | { kind: 'file'; path: string; line?: number; column?: number } }
  /** A Save to Markdown finished on the machine: copy `path` and say "Saved to Markdown". */
  | { kind: 'markdownSaved'; path: string }
  /**
   * An app-shell action (`switchToTerminal`, `composerReady`, `selectModel`, `handoffToModel`,
   * `selectForkBranch`, `draftHandoffToTerminalComplete`, ...). `action` is the core's name and
   * `params` its payload, the same pair desktop turns into a `sessionChatHostAction` message.
   */
  | { kind: 'hostAction'; action: string; params: unknown }
  /** Move keyboard focus into the composer (desktop's `focus_requested`). */
  | { kind: 'focusComposer' };
