/**
 * The Rust chat brain (`packages/gx-chat-core` in the Ghostex main repo), callable from JS.
 *
 * The native half is `packages/gx-chat-mobile` (UniFFI) wrapped by this Expo module; every call is
 * a SYNCHRONOUS JSI function, so a handle/frame round trip never waits for the bridge. Everything
 * crosses as JSON strings. Build the native library first:
 * `packages/gx-chat-mobile/build.sh` in the main repo (see its header).
 *
 * One core per chat session. The core does no I/O, reads no clock and draws nothing: the host feeds
 * it events, performs the effects it returns, and hands `frame()` to the screen.
 *
 * Shapes (all JSON, camelCase):
 *
 * - `eventJson`: one {@link ChatCoreEvent}.
 * - `contextJson`: one {@link ChatCoreContext} (`nowMs` is required; random draws are filled from
 *   the OS when omitted).
 * - `handle()` returns a JSON array of {@link ChatCoreEffect}, in the order to perform them.
 * - `frame()` returns the drained envelope `nativeChat.take(lastRevision)` returns on desktop:
 *   `{itemsSplice?, minimap?, subagentSplice?, rowDetails?, revision, snapshot?, requests: [],
 *   nextWakeMs}`. `snapshot` is the "what to draw" document (typed by the host in
 *   `src/chat/rust/document.ts`); it is present only when the revision moved past `lastRevision`.
 *   `requests` is always `[]` here: effects come back from `handle()` instead.
 * - Any call that fails comes back as `{"error": {"code": string, "message": string}}` natively;
 *   the wrappers below throw it as a {@link ChatCoreError} instead of returning it.
 *   Codes: `badEvent`, `badContext`, `badArguments`, `unknownQuery`, `disposed`, `panic`.
 */
import { requireOptionalNativeModule } from 'expo';

// ---------------------------------------------------------------------------------------------
// JSON shapes at the boundary
// ---------------------------------------------------------------------------------------------

/** A client-storage record the chat owns: the catalog store id plus the per-session suffix. */
export type ChatStorageKey = { store: string; suffix: string };

/** How a request the core asked for (`sendRpc`) ended. */
export type ChatRpcError = { code?: string | null; message: string; endpoint?: string | null };

/** Everything that can reach the core. `type` picks the variant. */
export type ChatCoreEvent =
  /**
   * Opening this chat. `config` is `StartConfig`: `{clientId?, projectId?, sessionId?,
   * initialSnapshot?, initialPresentation?, preview?, retainedKey?}` (`retainedKey` from
   * {@link retainedSnapshotKey}).
   */
  | { type: 'start'; config: Record<string, unknown> }
  /** An accepted gxserver chat frame, whose own `type` is `sessionChatSnapshot`,
   * `sessionChatReplaced`, `sessionChatAppended` or `sessionChatState`. */
  | { type: 'frame'; frame: Record<string, unknown> }
  | { type: 'connection'; update: 'subscribed' | 'lost' | 'resubscribed' }
  /** A `sendRpc` settled. `error` non-null means refused; otherwise `result` is the answer. */
  | { type: 'rpcSettled'; requestId: number; result?: unknown; error?: ChatRpcError | null }
  /** A user gesture from the screen: `{type: '<actionKind>', ...fields}` as desktop sends it. */
  | { type: 'action'; action: { type: string; [field: string]: unknown } }
  /** A `setTimer` fired, or the host is driving the clock. */
  | { type: 'tick' }
  | { type: 'storageLoaded'; key: ChatStorageKey; value: string | null }
  | { type: 'storageWritten'; key: ChatStorageKey; error?: string | null }
  | { type: 'storageBatchLoaded'; records: { key: ChatStorageKey; value: string | null }[] }
  | { type: 'storageBatchWritten'; keys: ChatStorageKey[]; error?: string | null }
  | { type: 'retainedSnapshotLoaded'; value: string | null }
  /** The answer to `readComposerBoot` (`ComposerBootRead`: `{sessionKey, clientId, entry,
   * nextVersion, optionStates, modelOutboxes, modelCatalog, chatSettings, contextPreferences,
   * dismissedNotice, summaryMode, verboseOverride}`). */
  | { type: 'composerBootRead'; read: Record<string, unknown> }
  | { type: 'composerBootFailed'; error: string }
  | { type: 'settingsChanged'; settings: { hideAccountEmails: boolean; title: string | null } }
  | { type: 'contextPreferencesChanged'; provider: string; preferences: unknown }
  | { type: 'modelCatalogChanged'; catalog: unknown }
  | { type: 'measured'; measurement: ChatMeasurement }
  /** The composer text the host owns changed outside the core. */
  | { type: 'draftChanged'; text: string };

export type ChatMeasurement =
  | { kind: 'composerOverflow'; overflowed: string[]; optionsOverflowed: boolean }
  | { kind: 'contextStatusRows'; rows: number[] }
  | {
      kind: 'openRowDetails';
      rows: { key: string; kind: string; messageId: string; index: number }[];
    };

/** The host's clock and locale for one `handle()` turn. */
export type ChatCoreContext = {
  /** `Date.now()`. */
  nowMs: number;
  /** Minutes east of UTC: `-new Date().getTimezoneOffset()`. Defaults to 0. */
  utcOffsetMinutes?: number;
  /** Two uniform draws in [0, 1). Omit to let the native side draw them from the OS. */
  randomUnits?: [number, number];
  /** Two UUID strings (or 32-hex-digit strings). Omit to let the native side draw them. */
  randomIds?: [string, string];
  /** Stamps already rendered in the user's locale; omit for the core's own en-US rendering. */
  formattedTimes?: {
    style: 'contextStartedAt' | 'accountDateTime';
    stampMs: number;
    text: string;
  }[];
  /** Replays only: every clock value the brain read this turn, `nowMs` first. */
  clockReads?: number[];
};

/**
 * One thing the host must do. `type` picks the variant.
 *
 * Routing notes from the desktop host (`apps/desktop/src/app/gx_chat/effects.rs`): `hostAction`
 * with `action: 'selectOption'` is a gesture to feed straight back as `{type: 'action', action:
 * params}`; `hostAction` `suggestionSend` is deliberately ignored; `readNativeComposer` arrives as a
 * `sendRpc` the HOST answers with its composer text, not gxserver.
 */
export type ChatCoreEffect =
  /** Call gxserver `method` with `params`; answer with `rpcSettled` carrying `requestId`. */
  | { type: 'sendRpc'; requestId: number; method: string; params: unknown }
  | { type: 'subscribe'; limit: number; catalog: boolean }
  | { type: 'unsubscribe' }
  | { type: 'reconnect' }
  | { type: 'readStorage'; key: ChatStorageKey }
  | { type: 'readStorageBatch'; keys: ChatStorageKey[] }
  | { type: 'readRetainedSnapshot' }
  /** `value: null` deletes. Keep the stored record when ITS `savedAt` is newer. */
  | { type: 'writeRetainedSnapshot'; value: string | null }
  | { type: 'updatePresentation'; state: unknown }
  /** Answer with `composerBootRead` (or `composerBootFailed`). */
  | { type: 'readComposerBoot'; requestId: number }
  /** `value: null` deletes. */
  | { type: 'writeStorage'; key: ChatStorageKey; value: string | null; durable: boolean }
  | {
      type: 'writeStorageBatch';
      writes: { key: ChatStorageKey; value: string | null; durable: boolean }[];
    }
  /** Answer with `storageWritten` for `{store, suffix: ''}`. */
  | { type: 'flushStorage'; store: string }
  | { type: 'recordDeliveries'; deliveries: unknown[] }
  /** Call `tick` in `delayMs`; `null` cancels the pending wake. */
  | { type: 'setTimer'; delayMs: number | null }
  /** `caret` is a UTF-16 offset (a JS string index). */
  | { type: 'setComposerText'; content: string; caret: number | null; fromHistory: boolean }
  | { type: 'clearComposerIfUnchanged'; text: string }
  | {
      type: 'open';
      target: { kind: 'url'; url: string } | { kind: 'file'; path: string; line?: number; column?: number };
    }
  | { type: 'copy'; text: string }
  | { type: 'toast'; level: string; message: string }
  | { type: 'restoreReturnedPrompt'; text: string }
  | { type: 'markdownSaved'; path: string }
  | { type: 'hostAction'; action: string; params: unknown }
  /** An effect newer than this binding; `name` is the Rust variant name. */
  | { type: 'unknown'; name: string };

/** The five pure helpers `query()` answers (same arguments as desktop's `nativeChat.<name>`). */
export type ChatCoreQuery =
  | 'composerReferences'
  | 'composerKeyIntent'
  | 'referenceMenu'
  | 'transcriptMenu'
  | 'sendBlockedToast';

// ---------------------------------------------------------------------------------------------
// The handle
// ---------------------------------------------------------------------------------------------

export type ChatCoreHandle = {
  /** Applies one event; returns the effects as a JSON array of {@link ChatCoreEffect}. */
  handle(eventJson: string, contextJson: string): string;
  /**
   * Drains the frame envelope (JSON). `lastRevision` is the `revision` of the last frame the
   * screen applied; `null` means "I hold no document", which always ships the snapshot.
   * `nowMs` (default `Date.now()`) is the clock `nextWakeMs` is measured at.
   */
  frame(lastRevision: number | null, nowMs?: number): string;
  /** Milliseconds until the earliest armed deadline at the last handled clock, or null. */
  nextWakeMs(): number | null;
  /** The current publish revision. */
  revision(): number;
  /** Makes the next frame ship every channel whole (a new screen attaching to a kept core). */
  forgetSent(): void;
  /** A fresh request id from the core's own counter (the same counter `sendRpc` ids use). */
  allocateRequestId(): number;
  /** One of the five pure helpers; `argumentsJson` is the JSON argument array. Returns JSON. */
  query(name: ChatCoreQuery, argumentsJson: string): string;
  /** Frees the native core. Every later call throws `disposed`. */
  dispose(): void;
};

export class ChatCoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ChatCoreError';
    this.code = code;
  }
}

type NativeGxChatCore = {
  coreVersion(): string;
  create(): number;
  handle(id: number, eventJson: string, contextJson: string): string;
  frameAt(id: number, lastRevision: number, nowMs: number): string;
  nextWakeMs(id: number): number | null;
  revision(id: number): number;
  forgetSent(id: number): string;
  allocateRequestId(id: number): number;
  query(id: number, name: string, argumentsJson: string): string;
  dispose(id: number): void;
  retainedSnapshotKey(machineId: string, projectId: string, sessionId: string): string;
};

const native = requireOptionalNativeModule<NativeGxChatCore>('GxChatCore');

let available: boolean | undefined;

/**
 * Whether this build carries a loadable native chat core. False when the module is not linked or
 * the Rust library is missing for this CPU (for example an Android ABI `build.sh` did not build).
 */
export function isChatCoreAvailable(): boolean {
  if (available === undefined) {
    try {
      available = native != null && native.coreVersion().length > 0;
    } catch {
      available = false;
    }
  }
  return available;
}

function requireNative(): NativeGxChatCore {
  if (native == null) {
    throw new ChatCoreError(
      'unavailable',
      'The native chat core is not in this build. Run packages/gx-chat-mobile/build.sh and rebuild the app.',
    );
  }
  return native;
}

/** Native results that start with this are errors; no success value ever does. */
const ERROR_PREFIX = '{"error":';

function checked(json: string): string {
  if (json.startsWith(ERROR_PREFIX)) {
    let code = 'unknown';
    let message = json;
    try {
      const parsed = JSON.parse(json) as { error?: { code?: string; message?: string } };
      code = parsed.error?.code ?? code;
      message = parsed.error?.message ?? message;
    } catch {
      // Keep the raw text as the message.
    }
    throw new ChatCoreError(code, message);
  }
  return json;
}

/** The crate version plus the core's build identity, for diagnostics. */
export function chatCoreVersion(): string {
  return requireNative().coreVersion();
}

/**
 * The retained-transcript record key, `JSON.stringify([machineId, projectId, sessionId])`, which
 * goes into `start`'s `config.retainedKey`.
 */
export function retainedSnapshotKey(machineId: string, projectId: string, sessionId: string): string {
  return requireNative().retainedSnapshotKey(machineId, projectId, sessionId);
}

/** A fresh core for one chat session. */
export function createChatCore(): ChatCoreHandle {
  const module = requireNative();
  const id = module.create();
  let disposed = false;
  const live = (): number => {
    if (disposed) {
      throw new ChatCoreError('disposed', 'This chat core was disposed.');
    }
    return id;
  };
  return {
    handle: (eventJson, contextJson) => checked(module.handle(live(), eventJson, contextJson)),
    // -1 crosses as "no revision held": the native side maps it to a revision the core never
    // reaches, so the snapshot always ships.
    frame: (lastRevision, nowMs) =>
      checked(module.frameAt(live(), lastRevision ?? -1, nowMs ?? Date.now())),
    nextWakeMs: () => module.nextWakeMs(live()),
    revision: () => module.revision(live()),
    forgetSent: () => {
      checked(module.forgetSent(live()));
    },
    allocateRequestId: () => module.allocateRequestId(live()),
    query: (name, argumentsJson) => checked(module.query(live(), name, argumentsJson)),
    dispose: () => {
      if (!disposed) {
        disposed = true;
        module.dispose(id);
      }
    },
  };
}
