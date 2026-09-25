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
  createChatCore,
  isChatCoreAvailable,
  type ChatCoreEffect,
  type ChatCoreEvent,
  type ChatCoreHandle,
  type ChatCoreQuery,
  type ChatMeasurement,
} from '../../../modules/gx-chat-core/src';

import type { MachineConnectionTarget } from '../../machines/credentials';
import { uploadSessionChatLocalFile } from '../session-chat-bridge';
import type { UserAction } from './actions';
import { readComposerBoot } from './boot';
import { ComposerModel, type ComposerModelState } from './composer';
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
import { readRecord, readRetainedSnapshot, writeRecord, writeRetainedSnapshot } from './storage';
import { SessionChatLongPoll, sessionChatRpc, type RpcAnswer } from './transport';

/** Which chat a host serves. */
export type RustChatTarget = { machine: MachineConnectionTarget; projectId: string; sessionId: string };

/** One image the transcript asked for (`loadImage`), as the viewer and thumbnails read it. */
export type ChatImageState =
  | { status: 'loaded'; base64Data: string; mediaType: string }
  | { status: 'failed'; error: string };

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
};

/** What a chat whose core failed draws. A constant sentence: a panic payload can hold chat text. */
const CORE_FAILURE_MESSAGE = 'Chat could not be shown with the new chat engine. Turn it off in Settings.';
const CORE_UNAVAILABLE_MESSAGE = 'This build does not include the new chat engine.';
/** What a chat whose storage answered none of its boot read draws (desktop's sentence). */
const BOOT_READ_FAILURE = 'Chat could not read its saved drafts and settings on this phone.';
/** How deep an immediate answer may feed back into the core in one burst (desktop's cap). */
const MAX_SETTLE_ROUNDS = 12;
/** View requests kept for a screen that has not subscribed yet. */
const MAX_HELD_VIEW_REQUESTS = 128;

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

  private core: ChatCoreHandle | null = null;
  private readonly poll: SessionChatLongPoll;
  private readonly composer: ComposerModel;
  private state: RustChatState;
  private lastRevision: number | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly viewListeners = new Set<(request: ChatViewRequest) => void>();
  private heldViewRequests: ChatViewRequest[] = [];
  private queue: ChatCoreEvent[] = [];
  private driving = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private parked: ParkResult | null = null;
  private readonly unknownEffectNames = new Set<string>();
  /** Draft saves in flight by the core's request id, so the outbox row clears on success. */
  private readonly draftSaves = new Map<number, { draftId: string; revision: number }>();
  private draftRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private draftRetryFailures = 0;
  private draftRetryBusy = false;
  private appStateSubscription: NativeEventSubscription | null = null;

  constructor(private readonly target: RustChatTarget) {
    const { machine, projectId, sessionId } = target;
    this.retainedKey = JSON.stringify([machine.id, projectId, sessionId]);
    this.sessionKey = `remote-${machine.id}:${projectId}:${sessionId}`;
    this.composer = new ComposerModel({
      dispatch: (action) => this.dispatch(action),
      document: () => this.state.document,
      onChange: () => this.update({ composer: this.composer.state }),
      onSendBlocked: (reason) => this.view(this.sendBlockedToast(reason)),
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
    };
    this.poll = new SessionChatLongPoll(machine, projectId, sessionId, {
      onFrame: (frame) => this.enqueue({ type: 'frame', frame }),
      onConnection: (update) => this.enqueue({ type: 'connection', update }),
    });
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  /** Creates the core and opens the chat. Safe to call once; later calls do nothing. */
  start(): void {
    if (this.core !== null || this.disposed || this.state.status === 'failed') return;
    if (!isChatCoreAvailable()) {
      this.fail(CORE_UNAVAILABLE_MESSAGE);
      return;
    }
    try {
      this.core = createChatCore();
    } catch {
      this.fail(CORE_FAILURE_MESSAGE);
      return;
    }
    const initialPresentation = presentationCache.get(this.retainedKey);
    this.enqueue({
      type: 'start',
      config: {
        projectId: this.target.projectId,
        sessionId: this.target.sessionId,
        retainedKey: this.retainedKey,
        // The phone's field has no Enter-to-send; the core then names the tap and hold gestures.
        touchComposer: true,
        ...(initialPresentation !== undefined ? { initialPresentation } : {}),
      },
    });
    // `replayDraftSaves`: a save an earlier run could not deliver is still in the outbox.
    this.scheduleDraftRetry(0);
    // Only `background` pauses: `inactive` is a pulled-down notification centre or an app switcher
    // glance, and dropping the poll for those would cost a full re-read on every glance.
    if (AppState.currentState === 'background') this.poll.pause();
    this.appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') this.poll.pause();
      else if (next === 'active') this.poll.resume();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.poll.stop();
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.draftRetryTimer !== null) clearTimeout(this.draftRetryTimer);
    this.queue = [];
    this.core?.dispose();
    this.core = null;
    this.listeners.clear();
    this.viewListeners.clear();
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
    this.enqueue({ type: 'action', action });
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
   * One of the core's pure helpers (`composerReferences`, `referenceMenu`, `composerKeyIntent`,
   * `transcriptMenu`, `sendBlockedToast`), answered synchronously the way desktop's paint calls
   * `nativeChat.<name>`. Returns the parsed answer, or null when the core is not running.
   */
  query(name: ChatCoreQuery, args: readonly unknown[]): unknown {
    const core = this.core;
    if (core === null) return null;
    try {
      return JSON.parse(core.query(name, JSON.stringify(args))) as unknown;
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
    submit: (mode: 'send' | 'queue' | 'compact' | 'handoff') => this.composer.submit(mode),
  };

  /**
   * Files the phone picked (image picker, document picker, camera), uploaded to the machine and
   * inserted as reference pills: `attachmentsStarted`, the SFTP uploads, then
   * `attachmentsFinished` with the machine paths.
   */
  async attachFiles(files: readonly { uri: string; name?: string }[]): Promise<void> {
    if (files.length === 0) return;
    this.dispatch({ type: 'attachmentsStarted' });
    try {
      const paths = await this.uploadLocalFiles(files);
      this.dispatch({ type: 'attachmentsFinished', paths });
    } catch (error) {
      this.dispatch({
        type: 'attachmentsFinished',
        error: error instanceof Error ? error.message : 'The attachment could not be uploaded.',
      });
    }
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
        let pending = this.queue.splice(0);
        let rounds = 0;
        while (pending.length > 0 && rounds < MAX_SETTLE_ROUNDS && this.core !== null) {
          rounds += 1;
          const answers: ChatCoreEvent[] = [];
          for (const event of pending) {
            const effects = this.handle(event);
            if (effects === null) return;
            for (const effect of effects) {
              await this.perform(effect, answers);
            }
          }
          pending = answers;
        }
        if (pending.length > 0) this.state.stats.settleRoundsExhausted += 1;
        this.publish();
      }
    } finally {
      this.driving = false;
    }
  }

  private handle(event: ChatCoreEvent): ChatCoreEffect[] | null {
    const core = this.core;
    if (core === null) return null;
    try {
      const raw = core.handle(JSON.stringify(event), JSON.stringify(this.context()));
      this.state.stats.eventsHandled += 1;
      return JSON.parse(raw) as ChatCoreEffect[];
    } catch (error) {
      // A malformed event is the host's own bug; the chat keeps running. Anything else (a panic
      // inside the core) disables this one chat, as desktop's worker does.
      if (error instanceof ChatCoreError && (error.code === 'badEvent' || error.code === 'badContext')) {
        console.warn(`[rust-chat] the core refused an event (${error.code})`);
        return [];
      }
      console.warn(`[rust-chat] the core failed (${error instanceof ChatCoreError ? error.code : 'unknown'})`);
      this.fail(CORE_FAILURE_MESSAGE);
      return null;
    }
  }

  /**
   * The host's clock and locale for this turn. The two random draws and ids are left to the
   * native side, which fills them from the OS source a v4 UUID uses.
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
      case 'subscribe':
        this.poll.start(effect.limit);
        return;
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
        answers.push({ type: 'storageWritten', key: effect.key, error: await this.write(effect.key, effect.value, nowMs) });
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
        // The boot read clears the core's title, and a retried read comes after `setTitle` already
        // pushed it, so the known title goes back in behind every read.
        if (this.title !== null) {
          answers.push({ type: 'settingsChanged', settings: { hideAccountEmails: false, title: this.title } });
        }
        return;
      }
      case 'readRetainedSnapshot':
        answers.push({
          type: 'retainedSnapshotLoaded',
          value: await readRetainedSnapshot(this.retainedKey, nowMs).catch(() => null),
        });
        return;
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
      case 'attachmentReferences':
        this.composer.insertAttachments(fields.paths);
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
            : ({ status: 'failed', error: typeof fields.error === 'string' ? fields.error : '' } as const);
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
      default:
        this.view({ kind: 'hostAction', action, params });
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
      const paths = Array.isArray(fields.paths) ? fields.paths.filter((path): path is string => typeof path === 'string') : [];
      void this.uploadLocalFiles(paths.map((uri) => ({ uri })))
        .then((uploaded): RpcAnswer => ({ result: uploaded, error: null }))
        .catch(
          (error: unknown): RpcAnswer => ({
            error: {
              message: error instanceof Error ? error.message : 'The attachment could not be uploaded.',
              endpoint: '/api/importNativeAttachments',
            },
          })
        )
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
    void sessionChatRpc(this.target.machine, method, fields).then((answer) => {
      if (method === 'setSessionChatDraft') this.settleDraftSave(requestId, answer);
      this.settle(requestId, answer);
    });
  }

  private settle(requestId: number, answer: RpcAnswer): void {
    if (answer.error !== null) this.state.stats.rpcsRefused += 1;
    this.enqueue(
      answer.error === null
        ? { type: 'rpcSettled', requestId, result: answer.result, error: null }
        : { type: 'rpcSettled', requestId, error: answer.error }
    );
  }

  private async uploadLocalFiles(files: readonly { uri: string; name?: string }[]): Promise<string[]> {
    const uploaded: string[] = [];
    for (const file of files) {
      const name = file.name ?? fileName(file.uri);
      uploaded.push(
        await uploadSessionChatLocalFile(this.target.machine, file.uri, name, isImagePath(name) ? 'image' : 'file')
      );
    }
    return uploaded;
  }

  // ---- the draft save outbox ---------------------------------------------------------------------

  /** The outbox row goes in BEFORE the call, so a crash in between leaves it to be retried. */
  private async noteDraftSave(requestId: number, params: Record<string, unknown>): Promise<void> {
    const version = (params.draftVersion ?? params.version) as { draftId?: unknown; revision?: unknown } | undefined;
    if (typeof version?.draftId !== 'string' || typeof version.revision !== 'number') return;
    const content = typeof params.content === 'string' ? params.content : typeof params.text === 'string' ? params.text : '';
    this.draftSaves.set(requestId, { draftId: version.draftId, revision: version.revision });
    await queueDraftSave(
      {
        ...(typeof params.clientId === 'string' ? { clientId: params.clientId } : {}),
        sessionKey: this.sessionKey,
        content,
        version: { draftId: version.draftId, revision: version.revision },
        updatedAt: Date.now(),
      },
      Date.now()
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
    this.timer = setTimeout(() => {
      this.timer = null;
      this.enqueue({ type: 'tick' });
    }, Math.max(1, delayMs));
  }

  /** Drains one frame and publishes whatever it changed. */
  private publish(): void {
    const core = this.core;
    if (core === null) return;
    let frame: ChatFrame;
    try {
      frame = JSON.parse(core.frame(this.lastRevision, Date.now())) as ChatFrame;
    } catch {
      this.fail(CORE_FAILURE_MESSAGE);
      return;
    }
    this.lastRevision = frame.revision;
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
  private sendBlockedToast(reason: string): ChatViewRequest {
    try {
      const answer = JSON.parse(this.core?.query('sendBlockedToast', JSON.stringify([reason])) ?? 'null') as {
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
    try {
      this.core?.dispose();
    } catch {
      // Already gone.
    }
    this.core = null;
    this.update({ status: 'failed', error: message });
  }
}

// ---- one host per chat ---------------------------------------------------------------------------

const hosts = new Map<string, { host: RustChatHost; references: number }>();

function hostKey(target: RustChatTarget): string {
  return JSON.stringify([target.machine.id, target.projectId, target.sessionId]);
}

/**
 * The host for a chat, created and started on first use and shared by every caller until the last
 * one releases it (a dev shadow and the future native screen can hold the same chat at once).
 */
export function acquireRustChatHost(target: RustChatTarget): { host: RustChatHost; release: () => void } {
  const key = hostKey(target);
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
      if (held.references === 0 && hosts.get(key) === held) {
        hosts.delete(key);
        held.host.dispose();
      }
    },
  };
}
