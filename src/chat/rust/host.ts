/**
 * The phone host for the Rust chat core: one {@link RustChatHost} per open chat.
 *
 * It does on the phone what `apps/desktop/src/app/gx_chat/` plus the view half of
 * `apps/desktop/src/app/native_chat/state.rs` do on desktop: it owns the core, feeds it events
 * (boot read, long-poll frames, RPC answers, storage answers, timers, the screen's actions),
 * performs every effect the core returns, and publishes each drained frame as one immutable
 * {@link RustChatState} with the transcript splices already applied, so a screen draws from plain
 * arrays.
 *
 * Event order follows the desktop worker (`gx_chat/worker.rs`, `drive`): a burst of events is
 * handled in rounds, the answers the host can give at once (storage, the boot read, the composer
 * read) join the next round, and one frame is drained and published after the last round. RPCs
 * and timers answer later, each as a burst of its own. Bursts never interleave.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import {
  ChatCoreError,
  type ChatCoreEffect,
  type ChatCoreEvent,
  type ChatCoreQuery,
  type ChatMeasurement,
} from './core-types';

import type { MachineConnectionTarget } from '../../machines/credentials';
import { uploadSessionChatLocalFile } from '../session-chat-helpers';
import type { UserAction } from './actions';
import { useSettingsStore } from '../../settings/store';
import { readComposerBoot } from './boot';
import { ComposerModel, type ComposerModelState, type SubmitMode } from './composer';
import { createChatCoreBackend, type ChatCoreBackend } from './core-backend';
import {
  applyItemsSplice,
  type ChatDocument,
  type ChatFrame,
  type MinimapMarker,
  type RowDetails,
  type TranscriptItem,
} from './document';
import type { ChatViewRequest, EffectType } from './effects';
import type { ChatStorageKey } from './events';
import {
  acknowledgeDraftSaves,
  composerHistory,
  draftPark,
  draftRetryDelayMs,
  draftSubmitted,
  nextDraftVersion,
  pendingDraftSaves,
  queueDraftSave,
  recordDeliveries,
  type ParkResult,
} from './host-records';
import { currentSessionDirectory, subscribeSessionDirectory } from './sessionDirectory';
import { projectOrigin, subscribeProjectOrigin } from './projectOrigin';
import { readRecord, readRetainedSnapshot, writeRecord, writeRetainedSnapshot } from './storage';
import { chatMachineLink, TOOL_OUTPUT_CUT_CAPABILITY } from './machine-link';
import { checkComputer, HELD_SEND_METHODS, heldSendRpc, sessionComputer, subscribeSessionComputer } from './computer';
import { coreUnavailableMessage } from './wasm-core/pageLoad';
import { AttachmentCarrier } from './carryAttachments';
import { SessionChatStream, sessionChatRpc, type RpcAnswer } from './transport';
import { markSessionOpen } from '../../terminal/openTiming';
import { dictationInserted } from '../native/composer/dictationTarget';
import { receivePageThumbnail } from '../native/transcript/pageThumbnails';
import { forgetRecording, requestEnded, wordsAsked, wordsAwaited } from '../../voice/dictation';
import { readAloudSetAuto, readAloudSpeak, readAloudStopSpeaking, registerReadAloudChat } from '../../voice/readAloud';

/** Which chat a host serves. */
export type RustChatTarget = { machine: MachineConnectionTarget; projectId: string; sessionId: string };

/** One image the transcript asked for (`loadImage`), as the viewer and thumbnails read it. */
export type ChatImageState =
  { status: 'loaded'; base64Data: string; mediaType: string } | { status: 'failed'; error: string; reason: string };

/** Counters for the dev log and the tester. Names only, never chat content. */
export type RustChatStats = {
  eventsHandled: number;
  framesPublished: number;
  rpcsSent: number;
  rpcsRefused: number;
  effects: Partial<Record<EffectType | string, number>>;
  /** Effects this host has no arm for; logged once each. */
  unknownEffects: number;
  /** A chain of immediate answers deeper than the cap: a core rule this host did not expect. */
  settleRoundsExhausted: number;
  storageRefused: number;
};

/** Everything a chat screen draws, republished as a new object on every change. */
export type RustChatState = {
  /** `starting` until the first document arrives, `failed` when the core cannot run. */
  status: 'starting' | 'running' | 'failed';
  revision: number;
  /** The view document, or null before the first publish. */
  document: ChatDocument | null;
  /** The main transcript, with every splice applied. */
  items: TranscriptItem[];
  /** The open subagent viewer's transcript. */
  subagentItems: TranscriptItem[];
  minimap: MinimapMarker[];
  rowDetails: RowDetails;
  /** The composer model the screen's text field binds to. */
  composer: ComposerModelState;
  /** Image bytes by machine path, filled by `loadImage`. */
  images: { [path: string]: ChatImageState };
  /** A host-level failure drawn instead of the chat (the core is missing or disabled). */
  error: string | null;
  stats: RustChatStats;
  /**
   * Moves when an answer the core computes after the call (a `query`) arrives, so a paint that
   * asked for it draws again.
   */
  queryRevision: number;
};

/** What a chat whose core failed draws. A constant sentence: a panic payload can hold chat text. */
const CORE_FAILURE_MESSAGE = 'Chat could not be shown. Close it and open it again.';
/** Helpers whose answer depends only on their arguments; the host keeps those. */
const PURE_QUERIES: ReadonlySet<ChatCoreQuery> = new Set(['composerReferences', 'renderVisual', 'speakableMarkdown']);
/** Answers the host keeps for paint-time callers (drafts, chart layouts). */
const MAX_CACHED_QUERIES = 64;
/** What a chat whose storage answered none of its boot read draws (desktop's sentence). */
const BOOT_READ_FAILURE = 'Chat could not read its saved drafts and settings on this phone.';
/** How deep an immediate answer may feed back into the core in one burst (desktop's cap). */
const MAX_SETTLE_ROUNDS = 12;
/** View requests kept for a screen that has not subscribed yet. */
const MAX_HELD_VIEW_REQUESTS = 128;
/**
 * How long a chat's request for a recording's words may stay open, with the app in front, before
 * the chat core's page counts as stopped (`RustChatHost.watchDictations`). An answer takes
 * milliseconds.
 */
const DICTATION_ANSWER_MS = 10_000;
/**
 * The time that wait is measured in: milliseconds that only go forward, at the pace time passes.
 *
 * CDXC:Dictate 2026-11-10 WHY: The wait was measured with `Date.now()` at first. The phone corrects that clock, and each request that joins makes the timer anew from the oldest one's start: after a correction backwards the page got that much longer than its ten seconds, with every waiting recording kept out of the row meanwhile, and after one forwards a page that was well counted as stopped early. A request's start, the time left and the new start in front are all read from this one clock; the times that are stored or sent stay `Date.now()`.
 */
const elapsedMs = (): number => performance.now();
/**
 * The effects that only store what the core decided. A round's are still performed when its core
 * was replaced under the same chat (`drive`): the new core waits for that round, so it reads
 * after them.
 *
 * CDXC:Dictate 2026-11-10 WHY: A chat that ended performed them too at first, so that a dictation its last round had taken was still saved. The same chat opened again is another host, which neither waits for that round nor reads behind it, and a form's draft is stored whole: the old round's later write put an older draft over what the reopened chat had saved since. A chat that ended therefore stores nothing further, as it never stored what was still queued.
 */
const STORING_EFFECTS: ReadonlySet<ChatCoreEffect['type']> = new Set([
  'writeStorage',
  'writeStorageBatch',
  'writeRetainedSnapshot',
  'recordDeliveries',
]);

/**
 * The presentation cache the core writes (`updatePresentation`) and reads back at the next start
 * (`initialPresentation`), which is what makes a return to a chat show its account and status line
 * at once. In memory, like the desktop sidebar's cache.
 */
const presentationCache = new Map<string, unknown>();

function emptyStats(): RustChatStats {
  return {
    eventsHandled: 0,
    framesPublished: 0,
    rpcsSent: 0,
    rpcsRefused: 0,
    effects: {},
    unknownEffects: 0,
    settleRoundsExhausted: 0,
    storageRefused: 0,
  };
}

function isImagePath(path: string): boolean {
  return /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/iu.test(path);
}

/** The recording whose words `event` asks the core to type, when it is such a request (`insertDictation` with an `id`). */
function dictationRequest(event: ChatCoreEvent | undefined): string | undefined {
  if (event?.type !== 'action' || event.action.type !== 'insertDictation') return undefined;
  const { id } = event.action;
  return typeof id === 'string' ? id : undefined;
}

function fileName(uri: string): string {
  const withoutQuery = uri.split(/[?#]/u)[0] ?? uri;
  const segment = withoutQuery.split('/').pop() ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export class RustChatHost {
  /** `JSON.stringify([machineId, projectId, sessionId])`, the retained transcript's key. */
  readonly retainedKey: string;
  /** `remote-<machineId>:<projectId>:<sessionId>`: every per-session storage suffix. */
  readonly sessionKey: string;

  private core: ChatCoreBackend | null = null;
  private unsubscribeCoreLost: (() => void) | null = null;
  /** The core's answers to paint-time queries, by name and arguments (LRU). */
  private readonly queryCache = new Map<string, unknown>();
  private readonly queryInflight = new Set<string>();
  private readonly poll: SessionChatStream;
  private readonly composer: ComposerModel;
  private state: RustChatState;
  private lastRevision: number | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly viewListeners = new Set<(request: ChatViewRequest) => void>();
  private heldViewRequests: ChatViewRequest[] = [];
  private queue: ChatCoreEvent[] = [];
  private driving = false;
  private disposed = false;
  /** Pictures a send references on another computer, copied to the session's (`carryAttachments.ts`). */
  private readonly carrier: AttachmentCarrier;
  /** A send waiting for those copies. */
  private carryingSend = false;
  /**
   * The recordings this chat's core is asked to type and has not answered for (`dictate`): this
   * chat owns their requests (`voice/dictation.ts`, `wordsAsked`) and ends each one, with the
   * words in a draft or without. They are the requests of the core this chat has now: with the
   * core they all end (`teardownCore`), so nothing an earlier core still answers finds one. Oldest
   * first, each with the moment its wait for an answer began (`watchDictations`), in `elapsedMs`.
   */
  private readonly dictating = new Map<string, number>();
  /**
   * The chat box as it was when the running recording started (`dictationAnchor`): its words go
   * over that selection, or at that caret, while the text is unchanged when they arrive.
   *
   * CDXC:Dictate 2026-11-13 DECISION: User: "when we dictate with the caret in the middle or some text selected, we should enter the text to replace what's selected or insert it at the caret." The place is the one the recording started with: moving the caret while it records or transcribes does not move the words, but typing in the box meanwhile does (they then go where the caret is when they arrive, as the text they were aimed into is gone). Same rule on the desktop (`aim_dictation` in native_chat/dictation.rs) and for question form boxes (`dictationTarget.ts`).
   */
  private dictationAnchor: { text: string; start: number; end: number } | null = null;
  /** Runs until the oldest request in `dictating` has waited long enough (`watchDictations`). */
  private dictationDeadline: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private parked: ParkResult | null = null;
  private readonly unknownEffectNames = new Set<string>();
  /** Draft saves in flight by the core's request id, so the outbox row clears on success. */
  private readonly draftSaves = new Map<number, { draftId: string; revision: number }>();
  private draftRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private draftRetryFailures = 0;
  private draftRetryBusy = false;
  private appStateSubscription: NativeEventSubscription | null = null;
  private unsubscribeSessionDirectory: (() => void) | null = null;
  private unsubscribeComputer: (() => void) | null = null;
  private unsubscribeProjectOrigin: (() => void) | null = null;
  private unsubscribeModelCatalog: (() => void) | null = null;
  private unsubscribeToolCards: (() => void) | null = null;
  private unregisterReadAloud: (() => void) | null = null;
  /** Session-open timing (`terminal/openTiming.ts`): the phone tab's `${machineId}:${sessionId}`. */
  private readonly openTraceKey: string;
  private retainedTranscriptLoaded = false;
  private liveReadArrived = false;

  constructor(private readonly target: RustChatTarget) {
    this.carrier = new AttachmentCarrier(target, (name, args) => this.queryAsync(name, args));
    const { machine, projectId, sessionId } = target;
    this.retainedKey = JSON.stringify([machine.id, projectId, sessionId]);
    this.sessionKey = `remote-${machine.id}:${projectId}:${sessionId}`;
    this.openTraceKey = `${machine.id}:${sessionId}`;
    this.composer = new ComposerModel({
      dispatch: (action) => this.dispatch(action),
      document: () => this.state.document,
      onChange: () => this.update({ composer: this.composer.state }),
      onSendBlocked: (reason) => void this.sendBlockedToast(reason).then((request) => this.view(request)),
      onFocusRequested: () => this.view({ kind: 'focusComposer' }),
    });
    this.state = {
      status: 'starting',
      revision: 0,
      document: null,
      items: [],
      subagentItems: [],
      minimap: [],
      rowDetails: {},
      composer: this.composer.state,
      images: {},
      error: null,
      stats: emptyStats(),
      queryRevision: 0,
    };
    this.poll = new SessionChatStream(machine, projectId, sessionId, {
      onFrame: (frame) => {
        // Not a frame: the chat's view pick, which another device changed (`machine-link.ts`).
        if (frame.type === 'sessionChatViewChanged') {
          if (typeof frame.chatView === 'object' && frame.chatView !== null) {
            this.enqueue({ type: 'chatViewChanged', chatView: frame.chatView as Record<string, unknown> });
          }
          return;
        }
        this.liveReadArrived = true;
        this.enqueue({ type: 'frame', frame });
      },
      onConnection: (update) => this.enqueue({ type: 'connection', update }),
    });
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  /** Creates the core and opens the chat. Safe to call once; later calls do nothing. */
  start(): void {
    if (this.core !== null || this.disposed || this.state.status === 'failed') return;
    const core = createChatCoreBackend();
    this.core = core;
    this.unsubscribeCoreLost = core.onLost(() => this.restartCore(core));
    const initialPresentation = presentationCache.get(this.retainedKey);
    this.enqueue({
      type: 'start',
      config: {
        projectId: this.target.projectId,
        sessionId: this.target.sessionId,
        retainedKey: this.retainedKey,
        // The phone's field has no Enter-to-send; the core then names the tap and hold gestures.
        touchComposer: true,
        // The warm socket is up, so its snapshot brings the transcript at once and the core's seed
        // read asks for one row (gx-chat-core `issue_light_seed`); a cold open keeps the full seed.
        ...(chatMachineLink(this.target.machine).socketUp() ? { lightSeed: true } : {}),
        // Long tool outputs come cut on this computer's socket; the chat's reads ask for the same cut.
        ...(chatMachineLink(this.target.machine).capabilities()?.includes(TOOL_OUTPUT_CUT_CAPABILITY) === true
          ? { cutToolOutputs: true }
          : {}),
        ...(initialPresentation !== undefined ? { initialPresentation } : {}),
      },
    });
    // The computer the session runs on: the offline card and the held messages (`computer.ts`).
    const { id: machineId } = this.target.machine;
    this.enqueue({
      type: 'computerChanged',
      computer: sessionComputer(machineId, this.target.projectId, this.target.sessionId),
    });
    this.unsubscribeComputer = subscribeSessionComputer(
      machineId,
      this.target.projectId,
      this.target.sessionId,
      (computer) => this.enqueue({ type: 'computerChanged', computer }),
    );
    // Where the transcript's `#123` links go: the project's GitHub repository (`projectOrigin.ts`).
    this.enqueue({ type: 'projectOriginChanged', origin: projectOrigin(machineId, this.target.projectId) });
    this.unsubscribeProjectOrigin = subscribeProjectOrigin(machineId, this.target.projectId, (origin) =>
      this.enqueue({ type: 'projectOriginChanged', origin }),
    );
    // The other session on a message between agents is named from the inventory's session list.
    this.enqueue({ type: 'sessionDirectoryChanged', sessions: currentSessionDirectory() });
    this.unsubscribeSessionDirectory = subscribeSessionDirectory((sessions) =>
      this.enqueue({ type: 'sessionDirectoryChanged', sessions }),
    );
    // Tool call lines is a phone setting: the boot read carries it in (`boot.ts`), and a change
    // while the chat is open goes in here (gx-chat-core `tool_card.rs`). Default to Detailed view
    // rides along: the level a chat with no level of its own opens in.
    const wantsCards = (settings: { chatToolCallLines: boolean }) => settings.chatToolCallLines;
    let toolCards = wantsCards(useSettingsStore.getState().settings);
    let detailedDefault = useSettingsStore.getState().settings.sessionChatDetailedView;
    this.unsubscribeToolCards = useSettingsStore.subscribe((store) => {
      const next = wantsCards(store.settings);
      const nextDetailed = store.settings.sessionChatDetailedView;
      if (next === toolCards && nextDetailed === detailedDefault) return;
      toolCards = next;
      detailedDefault = nextDetailed;
      this.enqueue({
        type: 'settingsChanged',
        settings: { hideAccountEmails: false, title: this.title, toolCards: next, detailedDefault: nextDetailed },
      });
    });
    // This computer's model lineup, pushed on its chat socket; the `subscribe` effect hands over
    // the one already known.
    this.unsubscribeModelCatalog = chatMachineLink(this.target.machine).onModelCatalog((catalog) =>
      this.enqueue({ type: 'modelCatalogChanged', catalog }),
    );
    // Read aloud: what only the app knows (Auto-read, the chat on screen, the voice call), and
    // the one speaker every chat shares (`src/voice/readAloud.ts`).
    this.unregisterReadAloud = registerReadAloudChat({
      key: this.retainedKey,
      machine: this.target.machine,
      send: (event) => this.enqueue({ type: 'readAloud', event }),
      toast: (message) => this.view({ kind: 'toast', level: 'info', message }),
    });
    // `replayDraftSaves`: a save an earlier run could not deliver is still in the outbox.
    this.scheduleDraftRetry(0);
    // Only `background` pauses: `inactive` is a pulled-down notification centre or an app switcher
    // glance, and dropping the poll for those would cost a full re-read on every glance.
    // CDXC:SessionChat 2026-10-23 WHY:
    // The core also holds the chat's clocks, context meter and accounts poll while nothing shows
    // the chat, as the desktop does for a chat off screen; Android keeps running them in the
    // background otherwise.
    // A fresh core counts itself shown; it hears otherwise when the app or the screen hides it.
    this.coreHidden = false;
    this.appHidden = AppState.currentState === 'background';
    if (this.appHidden) this.poll.pause();
    this.syncVisibility();
    this.appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') {
        this.poll.pause();
        this.appHidden = true;
        this.syncVisibility();
      } else if (next === 'active') {
        this.poll.resume();
        this.appHidden = false;
        this.syncVisibility();
      }
      // The page is held back with the app, so its silence in the background says nothing: the
      // open requests' wait stops there and begins again in front.
      if (next === 'active' && this.dictationDeadline === null) this.resumeDictationWatch();
      else this.watchDictations();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardownCore();
    if (this.draftRetryTimer !== null) clearTimeout(this.draftRetryTimer);
    this.listeners.clear();
    this.viewListeners.clear();
  }

  /** Stops everything `start` began and frees the core; the host can `start` again. */
  private teardownCore(): void {
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.unsubscribeSessionDirectory?.();
    this.unsubscribeSessionDirectory = null;
    this.unsubscribeComputer?.();
    this.unsubscribeComputer = null;
    this.unsubscribeProjectOrigin?.();
    this.unsubscribeProjectOrigin = null;
    this.unsubscribeModelCatalog?.();
    this.unsubscribeModelCatalog = null;
    this.unsubscribeToolCards?.();
    this.unsubscribeToolCards = null;
    this.unregisterReadAloud?.();
    this.unregisterReadAloud = null;
    this.poll.stop();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.unsubscribeCoreLost?.();
    this.unsubscribeCoreLost = null;
    try {
      this.core?.dispose();
    } catch {
      // Already gone.
    }
    this.core = null;
    this.queryCache.clear();
    this.queryInflight.clear();
    // Last: what this core still answers is applied by nobody now (`drive`), so its recordings
    // can be asked for again.
    this.endDictationRequests();
  }

  /**
   * The chat core's page lost its cores (it crashed or reloaded):
   * this chat starts over on a fresh core, the way it does when it opens, keeping the screen and
   * its subscribers. The retained transcript and a resnapshot from the computer refill it.
   */
  private restartCore(lost: ChatCoreBackend): void {
    if (this.disposed || this.core !== lost) return;
    this.teardownCore();
    this.lastRevision = null;
    this.retainedTranscriptLoaded = false;
    this.liveReadArrived = false;
    this.update({ status: 'starting', items: [], subagentItems: [], minimap: [], rowDetails: {} });
    this.start();
  }

  // ---- what the screen calls ---------------------------------------------------------------------

  getState(): RustChatState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** View requests (copy, toast, open, app-shell actions) in order. Held ones flush at once. */
  onViewRequest(listener: (request: ChatViewRequest) => void): () => void {
    this.viewListeners.add(listener);
    const held = this.heldViewRequests;
    this.heldViewRequests = [];
    for (const request of held) listener(request);
    return () => {
      this.viewListeners.delete(listener);
    };
  }

  /** One user gesture, as desktop's view sends it. */
  dispatch(action: UserAction): void {
    if (action.type === 'insertDictation') this.dictate(action);
    else if (action.type === 'dictationAnchor')
      this.dictationAnchor = action.clear === true ? null : this.composer.dictationPoint();
    else this.enqueue({ type: 'action', action });
  }

  /** A size or position only the screen knows (toolbar overflow, status rows, open rows). */
  measure(measurement: ChatMeasurement): void {
    this.enqueue({ type: 'measured', measurement });
  }

  /**
   * The session's display title, which the boot read leaves null on the phone (`boot.ts`): the
   * screen pushes it from the inventory once it knows it, and again on a rename, the way desktop's
   * host pushes `chatSettings`. Save to Markdown suggests its file name from it and the context
   * meter shows it.
   */
  setTitle(title: string | null): void {
    if (title === this.title) return;
    this.title = title;
    this.enqueue({ type: 'settingsChanged', settings: { hideAccountEmails: false, title } });
  }

  private title: string | null = null;

  /**
   * Whether a screen shows this chat. A chat kept mounted for a tab that is not the selected one
   * (`WarmChats.tsx`) is hidden: the core holds its redraw clocks and its accounts poll and
   * assembles its document at most once a second (gx-chat-core `Event::Visibility`), while its
   * events keep arriving and applying, so showing it again needs no reload. Shown by default.
   */
  setShown(shown: boolean): void {
    if (this.viewHidden === !shown) return;
    this.viewHidden = !shown;
    this.syncVisibility();
  }

  /** The app is in the background (`start`'s AppState listener). */
  private appHidden = false;
  /** The screen holding this chat keeps it out of sight (`setShown`). */
  private viewHidden = false;
  /** What the core was last told; a fresh core starts shown. */
  private coreHidden = false;

  private syncVisibility(): void {
    const hidden = this.appHidden || this.viewHidden;
    if (hidden === this.coreHidden || this.core === null) return;
    this.coreHidden = hidden;
    this.enqueue({ type: 'visibility', shown: !hidden });
  }

  /**
   * One of the core's pure helpers (`composerReferences`, `referenceMenu`, `composerKeyIntent`,
   * `transcriptMenu`, `sendBlockedToast`), answered synchronously the way desktop's paint calls
   * `nativeChat.<name>`. Returns the parsed answer, or null when the core is not running.
   */
  query(name: ChatCoreQuery, args: readonly unknown[]): unknown {
    const core = this.core;
    if (core === null) return null;
    // The core answers on a later turn: hand back the answer kept for these arguments, or ask now
    // and paint again (`queryRevision`) once it arrives.
    const key = `${name}\u0000${JSON.stringify(args)}`;
    if (this.queryCache.has(key)) {
      const answer = this.queryCache.get(key);
      this.queryCache.delete(key);
      this.queryCache.set(key, answer);
      return answer;
    }
    if (!this.queryInflight.has(key)) {
      this.queryInflight.add(key);
      core
        .query(name, args)
        .catch(() => null)
        .then((answer) => {
          if (this.core !== core) return;
          this.queryInflight.delete(key);
          this.queryCache.set(key, answer);
          while (this.queryCache.size > MAX_CACHED_QUERIES) {
            const oldest = this.queryCache.keys().next().value;
            if (oldest === undefined) break;
            this.queryCache.delete(oldest);
          }
          this.update({ queryRevision: this.state.queryRevision + 1 });
        });
    }
    return null;
  }

  /** The same helpers, answered once the core has (an action that needs the answer to proceed). */
  async queryAsync(name: ChatCoreQuery, args: readonly unknown[]): Promise<unknown> {
    const core = this.core;
    if (core === null) return null;
    try {
      return await core.query(name, args);
    } catch {
      return null;
    }
  }

  /** The composer text field's own events. */
  readonly composerInput = {
    edited: (text: string, selection?: { start: number; end: number }) => this.composer.edited(text, selection),
    selected: (selection: { start: number; end: number }) => this.composer.selected(selection),
    focused: () => this.composer.focused(),
    blurred: () => this.composer.blurred(),
    submit: (mode: SubmitMode) => this.submitCarrying(mode),
    /** Replaces the whole draft (a picked saved prompt), desktop's `insert_prompt`; `caret` when the caller knows where it belongs (a dictation), the end otherwise. */
    replace: (text: string, caret: number | null = null) => this.composer.replace(text, caret, false),
  };

  /**
   * A send whose picture references point at another computer than the session's waits for their
   * copies (`carryAttachments.ts`), then goes with the references rewritten; one with no attachment
   * reference goes at once. A copy that failed keeps the text in the box and says why.
   */
  private submitCarrying(mode: SubmitMode): boolean {
    if (this.carryingSend) return false;
    const text = this.composer.state.text;
    if (!this.composer.state.ready || !this.carrier.mayCarry(text)) return this.composer.submit(mode);
    this.carryingSend = true;
    void this.carrier
      .carry(text)
      .then(async ({ text: carried, error }) => {
        if (this.disposed) return;
        // Words typed while the copies ran keep their place; the references still move.
        const current = this.composer.state.text;
        const next = current === text ? carried : await this.carrier.retarget(current);
        if (next !== current) this.composer.replace(next, null, false);
        if (error !== null) {
          this.view({ kind: 'toast', level: 'error', title: "Picture wasn't copied", message: error });
          return;
        }
        this.composer.submit(mode);
      })
      // A look that broke on its own still sends the message as it was.
      .catch(() => {
        if (!this.disposed) this.composer.submit(mode);
      })
      .finally(() => {
        this.carryingSend = false;
      });
    return false;
  }

  /**
   * Files the phone picked (image picker, document picker, camera), uploaded to the machine and
   * inserted as reference pills: `attachmentsStarted`, the SFTP uploads, then
   * `attachmentsFinished` with the machine paths.
   */
  async attachFiles(files: readonly { uri: string; name?: string }[]): Promise<void> {
    if (files.length === 0) return;
    // A send made before the upload lands takes it by this id (core `composer/attaching.rs`).
    const id = this.composer.uploadStarted();
    this.dispatch({ type: 'attachmentsStarted', id });
    try {
      const paths = await this.uploadLocalFiles(files);
      this.composer.uploadFinished(id, paths.length > 0);
      this.dispatch({ type: 'attachmentsFinished', id, paths });
    } catch (error) {
      this.composer.uploadFinished(id, false);
      this.dispatch({
        type: 'attachmentsFinished',
        id,
        error: error instanceof Error ? error.message : 'The attachment could not be uploaded.',
      });
    }
  }

  /**
   * Files uploaded to the machine with their paths returned, inserted nowhere: a question form's
   * note box writes the references itself (`QuestionForm.tsx`).
   */
  uploadFiles(files: readonly { uri: string; name?: string }[]): Promise<string[]> {
    return this.uploadLocalFiles(files);
  }

  // ---- the drive loop ----------------------------------------------------------------------------

  private enqueue(event: ChatCoreEvent): void {
    if (this.disposed || this.state.status === 'failed') return;
    this.queue.push(event);
    void this.drive();
  }

  private async drive(): Promise<void> {
    if (this.driving || this.core === null) return;
    this.driving = true;
    try {
      while (this.queue.length > 0 && !this.disposed && this.core !== null) {
        const core: ChatCoreBackend = this.core;
        let pending = this.queue.splice(0);
        let rounds = 0;
        while (pending.length > 0 && rounds < MAX_SETTLE_ROUNDS && this.core === core) {
          rounds += 1;
          const answers: ChatCoreEvent[] = [];
          // A round's events go to the core together (one message to the page); the
          // events are already built, so the effects are performed in the same order as before.
          const handled = await this.handleRound(core, pending);
          if (handled === null) return;
          if (this.core !== core) break;
          // Every request the round answered is settled now, before any effect is performed: a
          // stored write can take its time, and a chat that ends meanwhile ends the requests it
          // still has open.
          for (const [index, effects] of handled.entries()) this.dictationAnswered(pending[index], effects);
          performing: for (const effects of handled) {
            for (const effect of effects) {
              // The chat ended while an earlier effect was performed: nothing further of the
              // round is applied or stored. Its core was replaced under this chat: nothing the
              // round still says reaches the chat, and what it decided to store is stored
              // (`STORING_EFFECTS`).
              if (this.disposed) break performing;
              if (this.core !== core && !STORING_EFFECTS.has(effect.type)) continue;
              await this.perform(effect, answers);
            }
          }
          pending = answers;
        }
        if (this.core !== core) continue;
        if (pending.length > 0) {
          this.state.stats.settleRoundsExhausted += 1;
          // Left unsettled: a chat box that kept changing never took these words.
          for (const event of pending) this.endDictationRequest(dictationRequest(event));
        }
        await this.publish(core);
      }
    } finally {
      this.driving = false;
      // A rebuilt core (`restartCore`) queued its start while this loop was finishing the old one.
      if (this.queue.length > 0 && this.core !== null && !this.disposed) void this.drive();
    }
  }

  /** One settle round through the core; null when the chat stopped (failed, or rebuilt meanwhile). */
  private async handleRound(
    core: ChatCoreBackend,
    events: readonly ChatCoreEvent[],
  ): Promise<ChatCoreEffect[][] | null> {
    let handled;
    try {
      handled = await core.handleBatch(
        events.map((event) => ({ eventJson: JSON.stringify(event), contextJson: JSON.stringify(this.context()) })),
      );
    } catch (error) {
      if (this.core !== core) return null;
      this.coreFailed(error);
      return null;
    }
    if (this.core !== core) return null;
    const out: ChatCoreEffect[][] = [];
    for (const answer of handled) {
      if (answer.ok) {
        this.state.stats.eventsHandled += 1;
        out.push(answer.effects);
        continue;
      }
      // A malformed event is the host's own bug; the chat keeps running. Anything else (a panic
      // inside the core) disables this one chat, as desktop's worker does.
      if (answer.error.code === 'badEvent' || answer.error.code === 'badContext') {
        console.warn(`[rust-chat] the core refused an event (${answer.error.code})`);
        out.push([]);
        continue;
      }
      // The chat core's page went away: `restartCore` rebuilds this chat.
      if (answer.error.code === 'lost') return null;
      this.coreFailed(answer.error);
      return null;
    }
    return out;
  }

  private coreFailed(error: unknown): void {
    const code = error instanceof ChatCoreError ? error.code : 'unknown';
    if (code === 'lost') return;
    console.warn(`[rust-chat] the core failed (${code})`);
    // CDXC:SessionChat 2026-11-02 WHY: issue #393. The chat named no reason, so a page that could
    // never load looked like any slow start; the bridge's reason (the WebView's error, the path it
    // tried) now shows in the chat itself.
    this.fail(
      code === 'unavailable'
        ? coreUnavailableMessage(error instanceof ChatCoreError ? error.message : null)
        : CORE_FAILURE_MESSAGE,
    );
  }

  /**
   * The host's clock and locale for this turn. The two random draws and ids are left to the
   * core, which the page seeds from `crypto.getRandomValues`.
   */
  private context(): { nowMs: number; utcOffsetMinutes: number } {
    return { nowMs: Date.now(), utcOffsetMinutes: -new Date().getTimezoneOffset() };
  }

  // ---- effects -----------------------------------------------------------------------------------

  private async perform(effect: ChatCoreEffect, answers: ChatCoreEvent[]): Promise<void> {
    const stats = this.state.stats;
    stats.effects[effect.type] = (stats.effects[effect.type] ?? 0) + 1;
    const nowMs = Date.now();
    switch (effect.type) {
      case 'sendRpc':
        this.sendRpc(effect.requestId, effect.method, effect.params, answers);
        return;
      case 'subscribe': {
        this.poll.start(effect.limit);
        const catalog = chatMachineLink(this.target.machine).currentModelCatalog();
        if (effect.catalog && catalog !== null) answers.push({ type: 'modelCatalogChanged', catalog });
        return;
      }
      case 'unsubscribe':
        this.poll.stop();
        return;
      case 'reconnect':
        this.poll.restart();
        return;
      case 'readStorage':
        answers.push({ type: 'storageLoaded', key: effect.key, value: await this.read(effect.key, nowMs) });
        return;
      case 'readStorageBatch': {
        const records: { key: ChatStorageKey; value: string | null }[] = [];
        for (const key of effect.keys) records.push({ key, value: await this.read(key, nowMs) });
        answers.push({ type: 'storageBatchLoaded', records });
        return;
      }
      case 'writeStorage':
        answers.push({
          type: 'storageWritten',
          key: effect.key,
          error: await this.write(effect.key, effect.value, nowMs),
        });
        return;
      case 'writeStorageBatch': {
        let error: string | null = null;
        for (const write of effect.writes) {
          const refused = await this.write(write.key, write.value, nowMs);
          error ??= refused;
        }
        answers.push({ type: 'storageBatchWritten', keys: effect.writes.map((write) => write.key), error });
        return;
      }
      case 'flushStorage':
        // Every AsyncStorage write has already landed when it resolves; what is left to wait for
        // is the draft outbox, which the retry ladder drains without holding the send.
        this.scheduleDraftRetry(0);
        answers.push({ type: 'storageWritten', key: { store: effect.store, suffix: '' }, error: null });
        return;
      case 'readComposerBoot': {
        const read = await readComposerBoot(this.sessionKey, nowMs);
        if (read === null) {
          answers.push({ type: 'composerBootFailed', error: BOOT_READ_FAILURE });
          return;
        }
        this.composer.init(read, this.target.sessionId);
        answers.push({ type: 'composerBootRead', read });
        markSessionOpen(this.openTraceKey, 'bootRead');
        // The boot read clears the core's title, and a retried read comes after `setTitle` already
        // pushed it, so the known title goes back in behind every read.
        if (this.title !== null) {
          answers.push({ type: 'settingsChanged', settings: { hideAccountEmails: false, title: this.title } });
        }
        return;
      }
      case 'readRetainedSnapshot': {
        const value = await readRetainedSnapshot(this.retainedKey, nowMs).catch(() => null);
        this.retainedTranscriptLoaded = value !== null;
        answers.push({ type: 'retainedSnapshotLoaded', value });
        return;
      }
      case 'writeRetainedSnapshot':
        await writeRetainedSnapshot(this.retainedKey, effect.value, nowMs).catch(() => {
          stats.storageRefused += 1;
        });
        return;
      case 'updatePresentation':
        presentationCache.set(this.retainedKey, effect.state);
        return;
      case 'recordDeliveries':
        await recordDeliveries(effect.deliveries, nowMs).catch(() => {
          stats.storageRefused += 1;
        });
        return;
      case 'setTimer':
        this.arm(effect.delayMs);
        return;
      case 'setComposerText':
        this.composer.replace(effect.content, effect.caret, effect.fromHistory);
        return;
      case 'clearComposerIfUnchanged':
        this.composer.clearIfUnchanged(effect.text);
        return;
      case 'restoreReturnedPrompt':
        this.composer.returnedPrompt(effect.text);
        return;
      case 'open':
        this.view({ kind: 'open', target: effect.target });
        return;
      case 'copy':
        this.view({ kind: 'copy', text: effect.text });
        return;
      case 'toast':
        this.view({ kind: 'toast', level: effect.level, message: effect.message });
        return;
      case 'markdownSaved':
        this.view({ kind: 'markdownSaved', path: effect.path });
        return;
      case 'hostAction':
        this.hostAction(effect.action, effect.params, answers);
        return;
      case 'speak':
        readAloudSpeak(this.retainedKey, effect.id, effect.segments);
        return;
      case 'stopSpeaking':
        readAloudStopSpeaking(this.retainedKey, effect.id);
        return;
      case 'setReadAloudAuto':
        readAloudSetAuto(this.retainedKey, effect.on);
        return;
      case 'unknown':
        this.unknownEffect(effect.name);
        return;
      default:
        this.unknownEffect((effect as { type?: unknown }).type);
    }
  }

  private unknownEffect(name: unknown): void {
    this.state.stats.unknownEffects += 1;
    const label = typeof name === 'string' ? name : 'unnamed';
    if (this.unknownEffectNames.has(label)) return;
    this.unknownEffectNames.add(label);
    console.warn(`[rust-chat] effect with no phone arm: ${label}`);
  }

  /**
   * Where one `hostAction` goes, mirroring `gx_chat/effects.rs` (`host_action`, `dispatched`) and
   * the view arms of `native_chat/state.rs`.
   */
  private hostAction(action: string, params: unknown, answers: ChatCoreEvent[]): void {
    const fields = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>;
    switch (action) {
      // A gesture the core asked to have replayed at itself.
      case 'selectOption':
        answers.push({ type: 'action', action: fields as UserAction });
        return;
      // Deliberately nothing: desktop's view already sends instead (`SWALLOWED_HOST_ACTIONS`).
      case 'suggestionSend':
        return;
      // The offline-computer card: a message got no answer for 10 s, or its Retry (`computer.ts`).
      case 'checkComputer':
        void checkComputer(this.target.machine);
        return;
      case 'reconnectComputer': {
        this.poll.restart();
        // The card's Retry rebuilds the link (forward, connection check, handshake) before it checks again, so a
        // forward that died under the chat is not what the check finds.
        const machine = this.target.machine;
        void chatMachineLink(machine)
          .gxserverLink({ repair: true })
          .catch(() => null)
          .then(() => checkComputer(machine));
        return;
      }
      case 'attachmentReferences':
        this.composer.insertAttachments(fields.paths);
        return;
      // A page card's picture; the card reads it from its own store (`pageThumbnails.ts`).
      case 'pageThumbnail':
        receivePageThumbnail(fields);
        return;
      case 'chatImage': {
        const path = typeof fields.path === 'string' ? fields.path : '';
        const image = fields.image as { base64Data?: unknown; mediaType?: unknown } | undefined;
        const loaded =
          image !== undefined && typeof image.base64Data === 'string'
            ? ({
                status: 'loaded',
                base64Data: image.base64Data,
                mediaType: typeof image.mediaType === 'string' ? image.mediaType : 'image/png',
              } as const)
            : ({
                status: 'failed',
                error: typeof fields.error === 'string' ? fields.error : '',
                reason: typeof fields.reason === 'string' && fields.reason.length > 0 ? fields.reason : 'unreadable',
              } as const);
        this.update({ images: { ...this.state.images, [path]: loaded } });
        return;
      }
      case 'draftSubmitted': {
        // `adopt_park_answer`: every send adopts a fresh revision; a handoff carries what the park
        // minted, which is the host's.
        const method = typeof fields.method === 'string' ? fields.method : 'send';
        const adopted: Record<string, unknown> = { ...fields, nextVersion: nextDraftVersion() };
        if (method === 'handoff' && this.parked !== null) {
          adopted.handoffId = this.parked.handoffId;
          adopted.content = this.parked.content;
          adopted.draftVersion = this.parked.draftVersion;
          this.parked = null;
        }
        this.composer.submitted(method, adopted);
        return;
      }
      case 'submissionFailed':
        this.composer.failed(typeof fields.text === 'string' ? fields.text : '');
        return;
      case 'draftReceived':
        this.composer.received(fields);
        return;
      case 'dictationInserted':
        this.dictationInserted(params, answers);
        return;
      default:
        this.view({ kind: 'hostAction', action, params });
    }
  }

  /**
   * `insertDictation` from the screen (`useDictation.ts`): the request for the core to type a
   * recording's words. The chat box's text is this host's, so the request carries the field as it
   * is now. A recording has one request at a time, on the whole phone (`wordsAsked`), and this
   * chat ends the ones it makes: with the words in a draft (`dictationAnswered`,
   * `dictationInserted`), or without (`endDictationRequest`).
   */
  private dictate(action: UserAction & { type: 'insertDictation' }): void {
    const { id } = action;
    if (id !== undefined) {
      if (this.disposed || this.state.status === 'failed' || !wordsAsked(id)) return;
      this.dictating.set(id, elapsedMs());
      this.watchDictations();
    }
    const now = this.composer.dictationPoint();
    const anchor = this.dictationAnchor;
    this.dictationAnchor = null;
    // The caret or selection the recording started with, while the text is still what it was then;
    // after an edit, where the reader is now.
    const at = anchor !== null && anchor.text === now.text ? anchor : now;
    this.enqueue({ type: 'action', action: { ...action, draft: now.text, start: at.start, end: at.end } });
  }

  /**
   * The core's effects for `event` are back, and none is performed yet. If `event` asked for a
   * recording's words and a form box took them, they are in the box's draft now: the recording is
   * retired here, as the chat box's is when the field shows its words (`dictationInserted`), and
   * not behind the draft's stored write, which comes first among the effects. A request the core
   * did not answer is over.
   */
  private dictationAnswered(event: ChatCoreEvent | undefined, effects: readonly ChatCoreEffect[]): void {
    const id = dictationRequest(event);
    if (id === undefined) return;
    const answer = effects
      .map((effect) =>
        effect.type === 'hostAction' && effect.action === 'dictationInserted' ? dictationInserted(effect.params) : null,
      )
      .find((result) => result?.id === id);
    if (answer === undefined || answer === null) this.endDictationRequest(id);
    else if (answer.box !== null) this.dictationAccepted(id);
  }

  /** Recording `id`'s words are in a draft: this chat's request is over, and the recording is retired. */
  private dictationAccepted(id: string): void {
    if (!this.dictating.delete(id)) return;
    this.watchDictations();
    void forgetRecording(id);
  }

  /** This chat's request for recording `id` is over without its words in a draft: the recording waits again. */
  private endDictationRequest(id: string | undefined): void {
    if (id === undefined || !this.dictating.delete(id)) return;
    this.watchDictations();
    requestEnded(id);
  }

  /** This chat's core is gone (the chat ended, or the core was lost or failed): no request of its can be answered. */
  private endDictationRequests(): void {
    for (const id of [...this.dictating.keys()]) this.endDictationRequest(id);
  }

  /**
   * Gives the requests this chat has open a certain end: with the app in front, the core has
   * `DICTATION_ANSWER_MS` to end the oldest of them, and then its page counts as stopped. A
   * request that joins does not move that moment (it is no sign of the page answering); when the
   * oldest ends, the next one's own time runs. The time stops in the background, where the page
   * is held back with the app, and begins again in front (`resumeDictationWatch`).
   *
   * CDXC:Dictate 2026-11-10 WHY: A page that is up but no longer answers gives no sign, neither an answer nor a loss. A request waited on it for good, its words nowhere and its recording kept out of the row, where the released phone wrote the words into the chat box without the core. Offering the recording again after a wait, as an earlier version did, let a second request type words the first could still commit. So the wait ends the first attempt for certain before anything is offered: the page is declared stopped (`stalled`, the path a crashed page takes), which rejects what it still owes and replaces every chat's core, so that an answer that still came would find no core of this chat to apply to (`drive`), and only then are the requests ended (`teardownCore`) and the recordings offered. The page starts again, so the retry has a core to ask.
   */
  private watchDictations(): void {
    if (this.dictationDeadline !== null) clearTimeout(this.dictationDeadline);
    this.dictationDeadline = null;
    const [oldest] = this.dictating.values();
    if (oldest === undefined || AppState.currentState === 'background') return;
    this.dictationDeadline = setTimeout(
      () => {
        this.dictationDeadline = null;
        this.core?.stalled();
        // Still open when the page was only starting (it has its own wait): they wait anew.
        this.resumeDictationWatch();
      },
      Math.max(0, oldest + DICTATION_ANSWER_MS - elapsedMs()),
    );
  }

  /** The open requests' wait begins now: the app is in front again, or the page is only starting. */
  private resumeDictationWatch(): void {
    const now = elapsedMs();
    for (const id of this.dictating.keys()) this.dictating.set(id, now);
    this.watchDictations();
  }

  /**
   * The core's `dictationInserted`, taken here whether or not a chat box is on screen.
   *
   * A form box's draft has the words when the answer comes (its recording went with
   * `dictationAnswered`), and the box's drawn copies are told (`dictationTarget.ts`). The chat
   * box's text is this host's (`composer`, as the desktop view holds its draft,
   * `dictation_inserted` in native_chat/dictation.rs): it takes the core's text if it still holds
   * what the words were put into, and the recording is retired with that, as the released phone
   * retires it when it writes the words into the chat box; a field that changed meanwhile asks
   * again, as it is now.
   *
   * CDXC:Dictate 2026-11-10 WHY: The chat box's screen took the answer first. Its copy of the draft changes with the next render, so two recordings answered in one moment were both put into the same text, the second over the first, and both were forgotten; and a chat that was closed before the answer never heard that a form's draft had the words, so the recording was offered and typed again. The field's text lives here and changes in this step, and the recording is retired here, so neither depends on what is drawn.
   */
  private dictationInserted(params: unknown, answers: ChatCoreEvent[]): void {
    const result = dictationInserted(params);
    if (result === null) return;
    const { id } = result;
    if (result.box !== null) {
      this.view({ kind: 'hostAction', action: 'dictationInserted', params });
      return;
    }
    // Not this chat's request any more (the recording was dismissed meanwhile): types nothing.
    if (id !== null && !(this.dictating.has(id) && wordsAwaited(id))) {
      this.endDictationRequest(id);
      return;
    }
    const { text, start, end } = this.composer.dictationPoint();
    if (result.supersedes.includes(text)) {
      this.composer.replace(result.content, result.caret, false);
      if (id !== null) this.dictationAccepted(id);
    } else if (result.text !== null) {
      answers.push({
        type: 'action',
        action: {
          type: 'insertDictation',
          text: result.text,
          spacing: result.spacing,
          ...(id === null ? {} : { id }),
          draft: text,
          start,
          end,
        },
      });
    } else if (id !== null) {
      this.endDictationRequest(id);
    }
  }

  // ---- RPC ---------------------------------------------------------------------------------------

  private sendRpc(requestId: number, method: string, params: unknown, answers: ChatCoreEvent[]): void {
    const fields = { ...((typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>) };
    // The composer's text is the HOST's to answer, not gxserver's (`native_chat/state.rs`, `rpc`).
    if (method === 'readNativeComposer') {
      answers.push({ type: 'rpcSettled', requestId, result: this.composer.state.text, error: null });
      return;
    }
    this.state.stats.rpcsSent += 1;
    if (method === 'importNativeAttachments') {
      const paths = Array.isArray(fields.paths)
        ? fields.paths.filter((path): path is string => typeof path === 'string')
        : [];
      void this.uploadLocalFiles(paths.map((uri) => ({ uri })))
        .then((uploaded): RpcAnswer => ({ result: uploaded, error: null }))
        .catch((error: unknown): RpcAnswer => ({
          error: {
            message: error instanceof Error ? error.message : 'The attachment could not be uploaded.',
            endpoint: '/api/importNativeAttachments',
          },
        }))
        .then((answer) => this.settle(requestId, answer));
      return;
    }
    // Desktop adds the session to every call (`native_chat/state.rs`, `rpc`).
    fields.projectId = this.target.projectId;
    fields.sessionId = this.target.sessionId;
    if (method === 'readSessionChat' && fields.beforeOffset === undefined && fields.subagent === undefined) {
      // The core's own tail reads carry its window; the live poll must never answer smaller.
      if (typeof fields.limit === 'number') this.poll.widen(fields.limit);
    }
    if (method === 'setSessionChatDraft') void this.noteDraftSave(requestId, fields);
    // A message held while the computer is offline waits on another computer (`computer.ts`).
    if (HELD_SEND_METHODS.has(method)) {
      void heldSendRpc(this.target.machine.id, this.retainedKey, method, fields).then((answer) =>
        this.settle(requestId, answer),
      );
      return;
    }
    const liveRead = method === 'readSessionChat' && fields.beforeOffset === undefined && fields.subagent === undefined;
    const pending = sessionChatRpc(this.target.machine, method, fields);
    // An exec long poll starts from this read's fingerprint instead of reading it all again.
    if (liveRead) this.poll.seed(pending);
    void pending.then((answer) => {
      if (liveRead && answer.error === null) this.liveReadArrived = true;
      if (method === 'setSessionChatDraft') this.settleDraftSave(requestId, answer);
      this.settle(requestId, answer);
    });
  }

  private settle(requestId: number, answer: RpcAnswer): void {
    if (answer.error !== null) this.state.stats.rpcsRefused += 1;
    this.enqueue(
      answer.error === null
        ? { type: 'rpcSettled', requestId, result: answer.result, error: null }
        : { type: 'rpcSettled', requestId, error: answer.error },
    );
  }

  private async uploadLocalFiles(files: readonly { uri: string; name?: string }[]): Promise<string[]> {
    const uploaded: string[] = [];
    for (const file of files) {
      const name = file.name ?? fileName(file.uri);
      uploaded.push(
        await uploadSessionChatLocalFile(this.target.machine, file.uri, name, isImagePath(name) ? 'image' : 'file'),
      );
    }
    this.carrier.noteOnSessionComputer(uploaded);
    return uploaded;
  }

  // ---- the draft save outbox ---------------------------------------------------------------------

  /** The outbox row goes in BEFORE the call, so a crash in between leaves it to be retried. */
  private async noteDraftSave(requestId: number, params: Record<string, unknown>): Promise<void> {
    const version = (params.draftVersion ?? params.version) as { draftId?: unknown; revision?: unknown } | undefined;
    if (typeof version?.draftId !== 'string' || typeof version.revision !== 'number') return;
    const content =
      typeof params.content === 'string' ? params.content : typeof params.text === 'string' ? params.text : '';
    this.draftSaves.set(requestId, { draftId: version.draftId, revision: version.revision });
    await queueDraftSave(
      {
        ...(typeof params.clientId === 'string' ? { clientId: params.clientId } : {}),
        sessionKey: this.sessionKey,
        content,
        version: { draftId: version.draftId, revision: version.revision },
        updatedAt: Date.now(),
      },
      Date.now(),
    ).catch(() => {
      this.state.stats.storageRefused += 1;
    });
  }

  private settleDraftSave(requestId: number, answer: RpcAnswer): void {
    const version = this.draftSaves.get(requestId);
    this.draftSaves.delete(requestId);
    if (version === undefined) return;
    if (answer.error !== null) {
      this.draftRetryFailures += 1;
      this.scheduleDraftRetry(draftRetryDelayMs(this.draftRetryFailures));
      return;
    }
    this.draftRetryFailures = 0;
    void acknowledgeDraftSaves(this.sessionKey, version, Date.now()).catch(() => {
      this.state.stats.storageRefused += 1;
    });
  }

  private scheduleDraftRetry(delayMs: number): void {
    if (this.disposed) return;
    if (this.draftRetryTimer !== null) clearTimeout(this.draftRetryTimer);
    this.draftRetryTimer = setTimeout(() => {
      this.draftRetryTimer = null;
      void this.drainDraftOutbox();
    }, delayMs);
  }

  /** Delivers the oldest pending save, one at a time, in the order the revisions were typed. */
  private async drainDraftOutbox(): Promise<void> {
    if (this.draftRetryBusy || this.disposed) return;
    this.draftRetryBusy = true;
    try {
      const [draft] = await pendingDraftSaves(this.sessionKey, Date.now());
      if (draft === undefined) return;
      const answer = await sessionChatRpc(this.target.machine, 'setSessionChatDraft', {
        projectId: this.target.projectId,
        sessionId: this.target.sessionId,
        content: draft.content,
        draftVersion: draft.version,
        ...(draft.clientId !== undefined ? { clientId: draft.clientId } : {}),
      });
      if (answer.error !== null) {
        this.draftRetryFailures += 1;
        this.scheduleDraftRetry(draftRetryDelayMs(this.draftRetryFailures));
        return;
      }
      this.draftRetryFailures = 0;
      await acknowledgeDraftSaves(this.sessionKey, draft.version, Date.now());
      this.scheduleDraftRetry(0);
    } catch {
      this.state.stats.storageRefused += 1;
    } finally {
      this.draftRetryBusy = false;
    }
  }

  // ---- storage -----------------------------------------------------------------------------------

  /** One stored read, or the one store that is a query (`composerHistory`). Refusals read as absent. */
  private async read(key: ChatStorageKey, nowMs: number): Promise<string | null> {
    try {
      if (key.store === 'composerHistory') return await composerHistory(nowMs);
      return await readRecord(key, nowMs);
    } catch {
      this.state.stats.storageRefused += 1;
      return null;
    }
  }

  /** One stored write, or one of the three draft operations the core names as a store. */
  private async write(key: ChatStorageKey, value: string | null, nowMs: number): Promise<string | null> {
    try {
      switch (key.store) {
        case 'draftSubmitted':
          await draftSubmitted(this.sessionKey, value, nowMs);
          return null;
        case 'draftPark':
          this.parked = await draftPark(this.sessionKey, value, nowMs);
          return null;
        case 'draftReceive':
          // Desktop's arm only writes a recovery checkpoint, which the phone does not keep.
          return null;
        default:
          await writeRecord(key, value, nowMs);
          return null;
      }
    } catch (error) {
      this.state.stats.storageRefused += 1;
      return error instanceof Error ? error.message : 'Chat storage refused the record.';
    }
  }

  // ---- timers, frames, view requests -------------------------------------------------------------

  private arm(delayMs: number | null): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (delayMs === null) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.enqueue({ type: 'tick' });
      },
      Math.max(1, delayMs),
    );
  }

  /** Drains one frame and publishes whatever it changed. */
  private async publish(core: ChatCoreBackend): Promise<void> {
    let frame: ChatFrame;
    try {
      frame = await core.frame(this.lastRevision, Date.now());
    } catch (error) {
      if (this.core === core) this.coreFailed(error);
      return;
    }
    if (this.core !== core) return;
    this.lastRevision = frame.revision;
    // Answers that read the core's state may have changed with it; argument-only ones stay.
    for (const key of [...this.queryCache.keys()]) {
      if (!PURE_QUERIES.has(key.slice(0, key.indexOf('\u0000')) as ChatCoreQuery)) this.queryCache.delete(key);
    }
    const next: Partial<RustChatState> = {};
    if (frame.itemsSplice) next.items = applyItemsSplice(this.state.items, frame.itemsSplice);
    if (frame.subagentSplice) next.subagentItems = applyItemsSplice(this.state.subagentItems, frame.subagentSplice);
    if (frame.minimap) next.minimap = frame.minimap;
    if (frame.rowDetails) next.rowDetails = frame.rowDetails;
    if (frame.snapshot) {
      next.document = frame.snapshot;
      next.status = 'running';
    }
    if (Object.keys(next).length === 0) return;
    if (this.liveReadArrived) markSessionOpen(this.openTraceKey, 'livePaint');
    else if (this.retainedTranscriptLoaded && (next.items?.length ?? 0) > 0)
      markSessionOpen(this.openTraceKey, 'cachedPaint');
    this.state.stats.framesPublished += 1;
    this.update({ ...next, revision: frame.revision });
  }

  private update(next: Partial<RustChatState>): void {
    this.state = { ...this.state, ...next, stats: { ...this.state.stats } };
    for (const listener of this.listeners) listener();
  }

  private view(request: ChatViewRequest): void {
    if (this.viewListeners.size === 0) {
      if (this.heldViewRequests.length < MAX_HELD_VIEW_REQUESTS) this.heldViewRequests.push(request);
      return;
    }
    for (const listener of this.viewListeners) listener(request);
  }

  /** `report_send_blocked` in `native_chat/send_control.rs`: the core's toast for the reason. */
  private async sendBlockedToast(reason: string): Promise<ChatViewRequest> {
    try {
      const answer = (await this.queryAsync('sendBlockedToast', [reason])) as {
        title?: unknown;
        description?: unknown;
        level?: unknown;
      } | null;
      if (answer !== null && typeof answer.title === 'string') {
        return {
          kind: 'toast',
          level: typeof answer.level === 'string' ? answer.level : 'error',
          title: answer.title,
          message: typeof answer.description === 'string' ? answer.description : '',
        };
      }
    } catch {
      // The reason itself is still worth showing.
    }
    return { kind: 'toast', level: 'error', message: reason };
  }

  private fail(message: string): void {
    this.poll.stop();
    if (this.timer !== null) clearTimeout(this.timer);
    this.queue = [];
    this.unsubscribeCoreLost?.();
    this.unsubscribeCoreLost = null;
    try {
      this.core?.dispose();
    } catch {
      // Already gone.
    }
    this.core = null;
    this.endDictationRequests();
    this.update({ status: 'failed', error: message });
  }
}

// ---- one host per chat ---------------------------------------------------------------------------

const hosts = new Map<string, { host: RustChatHost; references: number }>();

function hostKey(machineId: string, projectId: string, sessionId: string): string {
  return JSON.stringify([machineId, projectId, sessionId]);
}

/**
 * The host for a chat, created and started on first use and shared by every caller until the last
 * one releases it (a dev shadow and the future native screen can hold the same chat at once). The last
 * release disposes it a microtask later, unless it was taken again by then: a chat screen that moves to
 * another place in one React commit (the terminal screen's chat into one of the iPhone Duo's panes and
 * back, `src/panes/`) releases its host and takes it again in the same effects pass, and keeps its
 * transcript, its composer and its live read rather than starting over.
 */
export function acquireRustChatHost(target: RustChatTarget): { host: RustChatHost; release: () => void } {
  const key = hostKey(target.machine.id, target.projectId, target.sessionId);
  let entry = hosts.get(key);
  if (entry === undefined) {
    entry = { host: new RustChatHost(target), references: 0 };
    hosts.set(key, entry);
    entry.host.start();
  }
  entry.references += 1;
  const held = entry;
  let released = false;
  return {
    host: held.host,
    release: () => {
      if (released) return;
      released = true;
      held.references -= 1;
      if (held.references > 0) return;
      queueMicrotask(() => {
        if (held.references === 0 && hosts.get(key) === held) {
          hosts.delete(key);
          held.host.dispose();
        }
      });
    },
  };
}

/**
 * The host of a chat that is open now (a mounted chat screen holds it), or null; unlike
 * {@link acquireRustChatHost} it never starts one. For text another screen adds to that chat's draft (Files'
 * Add to Session Context): a host started for that alone would close again before the draft reached the computer.
 */
export function openRustChatHost(machineId: string, projectId: string, sessionId: string): RustChatHost | null {
  return hosts.get(hostKey(machineId, projectId, sessionId))?.host ?? null;
}
