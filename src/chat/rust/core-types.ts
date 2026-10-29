/**
 * The JSON the phone and the Rust chat brain (`packages/gx-chat-core` in the Ghostex main repo)
 * exchange. The brain runs as WebAssembly in the app's hidden WebView (`wasm-core/`); everything
 * crosses as JSON strings, through the same layer the desktop's shapes come from
 * (`packages/gx-chat-json`).
 *
 * One core per chat session. The core does no I/O, reads no clock and draws nothing: the host feeds
 * it events, performs the effects it returns, and hands the frame to the screen.
 *
 * Shapes (all JSON, camelCase):
 *
 * - `eventJson`: one {@link ChatCoreEvent}.
 * - `contextJson`: one {@link ChatCoreContext} (`nowMs` is required; random draws are filled by the
 *   core when omitted).
 * - `handle` answers a JSON array of {@link ChatCoreEffect}, in the order to perform them.
 * - `frame` answers the drained envelope `nativeChat.take(lastRevision)` returns on desktop:
 *   `{itemsSplice?, minimap?, subagentSplice?, rowDetails?, revision, snapshot?, requests: [],
 *   nextWakeMs}`. `snapshot` is the "what to draw" document (typed in `document.ts`); it is present
 *   only when the revision moved past `lastRevision`. `requests` is always `[]` here: effects come
 *   back from `handle` instead.
 * - A call that fails throws a {@link ChatCoreError}. Codes: `badEvent`, `badContext`,
 *   `badArguments`, `unknownQuery`, `disposed`, `panic`, and from the WebView `unavailable` and
 *   `lost` (`wasm-core/bridge.ts`).
 */

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
  | {
      type: 'settingsChanged';
      /** `toolCards`: Settings > Chat > Tool call cards; left out, the core keeps what it has. */
      settings: { hideAccountEmails: boolean; title: string | null; toolCards?: boolean };
    }
  | { type: 'contextPreferencesChanged'; provider: string; preferences: unknown }
  | { type: 'modelCatalogChanged'; catalog: unknown }
  | { type: 'measured'; measurement: ChatMeasurement }
  /** The composer text the host owns changed outside the core. */
  | { type: 'draftChanged'; text: string }
  /** Every session the phone's inventory knows, which names the other session on a message
   * between agents. */
  | { type: 'sessionDirectoryChanged'; sessions: ChatKnownSession[] }
  /** What only the app knows about Read aloud, and the speech engine's answers
   * (docs/2026-10-20/voice-mode/read-aloud-client-contract.md in the main repo). */
  | { type: 'readAloud'; event: ChatReadAloudEvent }
  /** Whether anything shows the chat: while it is not, its clocks and accounts poll wait, and
   * showing it again catches them up. A core older than this event refuses it (`badEvent`) and
   * keeps every timer running, as before. */
  | { type: 'visibility'; shown: boolean };

/** One Read aloud input (`ReadAloudEvent` in `packages/gx-chat-core/src/read_aloud/events.rs`). */
export type ChatReadAloudEvent =
  /** The computer lists `readAloud` in `builtInFeatures` AND this phone has a working voice. */
  | { kind: 'setAvailable'; on: boolean }
  /** Auto-read for this run of the app; every chat hears the same value. */
  | { kind: 'setAuto'; on: boolean }
  /** This chat is the one on screen. */
  | { kind: 'setOnScreen'; on: boolean }
  /** A voice agent conversation is open. */
  | { kind: 'setVoiceConversation'; open: boolean }
  /** The microphone is recording (Dictate). */
  | { kind: 'setDictating'; on: boolean }
  /** The engine finished utterance `id` (from `speak`), or cut it off. */
  | { kind: 'speechEnded'; id: string; interrupted?: boolean };

/** One utterance of a `speak` effect. */
export type ChatSpeechSegment = { text: string; kind: 'prose' | 'note' };

/** `KnownSession`: one session of the host's session list. */
export type ChatKnownSession = {
  globalRef: string;
  projectId: string;
  sessionId: string;
  title: string;
  agentId: string;
  agentName: string;
  /** A coordinator (orchestrator): its message cards draw the crown, as its row does. */
  coordinator: boolean;
  /** `working`, `idle` or `attention`, for the composer's `+` picker. */
  activity?: string;
  /** `running`, `sleeping` or `stopped`, for the `+` picker. */
  lifecycleState?: string;
  /** When the session last did something (ISO time), the `+` picker's newest-first order. */
  activeAt?: string;
};

export type ChatMeasurement =
  | { kind: 'composerOverflow'; overflowed: string[]; optionsOverflowed: boolean }
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
  /** Two uniform draws in [0, 1). Omit to let the core draw them (its page seeds it from `crypto.getRandomValues`). */
  randomUnits?: [number, number];
  /** Two UUID strings (or 32-hex-digit strings). Omit to let the core draw them. */
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
  /** Read aloud: speak `segments` in order with this phone's Voice and Speed, replacing anything
   * speaking; answer with `readAloud` `speechEnded` carrying `id`. `messageId` is null for a
   * question line. */
  | { type: 'speak'; id: string; messageId: string | null; segments: ChatSpeechSegment[] }
  /** Read aloud: stop utterance `id` if it is still speaking. */
  | { type: 'stopSpeaking'; id: string }
  /** Read aloud: Auto-read was switched in this chat's ⋯ menu; keep it for this run and send
   * `readAloud` `setAuto` to every chat. */
  | { type: 'setReadAloudAuto'; on: boolean }
  /** An effect newer than this binding; `name` is the Rust variant name. */
  | { type: 'unknown'; name: string };

/**
 * The pure helpers `query()` answers (same arguments as desktop's `nativeChat.<name>`).
 * `renderVisual(source, width, theme, fontFamily)` lays out one ```visual block and answers its SVG.
 * `speakableSegments(messageId)` answers what Read aloud says for one agent message (or `null`), and
 * `speakableMarkdown(markdown)` the same for any Markdown, as {@link ChatSpeechSegment}s.
 * `transcriptPictures(picture)` answers `{images, index}`: every picture the transcript shows, opened
 * on that one, for the image viewer's next and previous.
 */
export type ChatCoreQuery =
  | 'composerReferences'
  | 'composerKeyIntent'
  | 'referenceMenu'
  | 'transcriptMenu'
  /** `transcriptReply({draft, quote, reply})`: the chat box after the transcript menu's Reply adds a reply. */
  | 'transcriptReply'
  | 'sendBlockedToast'
  | 'renderVisual'
  | 'speakableSegments'
  | 'speakableMarkdown'
  | 'transcriptPictures'
  /** `toolAppLogo(key)`: an MCP app's logo SVG for a tool-call card (gx-chat-core `transcript/tool_apps.rs`). */
  | 'toolAppLogo';

export class ChatCoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ChatCoreError';
    this.code = code;
  }
}
