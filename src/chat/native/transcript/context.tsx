/**
 * What every transcript row reads besides its own item.
 *
 * `NativeChatUiProvider` (mounted once per chat screen) owns the drawing state that outlives one
 * list: open rows, the row-detail demand and the loaded-image requests. The subagent viewer's rows
 * share all of it with the main transcript, as desktop's one `NativeChatView` does. The image
 * viewer and the table preview are `NativeChatOverlays`' (`../cards/overlayStore.ts`).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import type { RustChat } from '../../rust/useRustChat';
import type { ChatDocument, ChatLook, Json } from '../../rust/document';
import { arr, obj, str, type JsonRecord } from './json';
import { relayedByReport } from '../cards/relayedApprovals';
import { workCardIndex, type WorkCardIndex } from '../cards/WorkCards';
import { openChatImageViewer } from '../cards/overlayStore';
import { DisclosureStore, RowDetailDemand } from './state';
import type { TranscriptTheme } from './theme';

/** A picture as the document projects it (`transport`, `path`, `url`, `label`, `alt`). */
export type ChatImageSource = JsonRecord;

export type NativeChatUi = {
  disclosures: DisclosureStore;
  demand: RowDetailDemand;
  /** Asks the core for a machine image's bytes once (`loadImage`); the answer lands in `state.images`. */
  requestImage(path: string): void;
  /**
   * Lays out one ```visual block at `width` through the core (`renderVisual`): its scene as SVG with
   * tooltip regions, a page card, or an error; null when the core could not answer.
   */
  renderVisual(source: string, width: number, theme: JsonRecord, progress?: number): JsonRecord | null;
  /** The same layout, awaited: the core answers a moment later (draw-in frames). */
  renderVisualAsync(source: string, width: number, theme: JsonRecord, progress?: number): Promise<JsonRecord | null>;
  /**
   * Opens the image viewer on a picture the transcript shows, with every picture the transcript
   * shows to step through (the core's `transcriptPictures`, CDXC:SessionChat 2026-10-24 in
   * gx-chat-core `transcript/pictures.rs`); `fallback` is the list it opens on when the core cannot answer.
   */
  openPicture(image: ChatImageSource, fallback: readonly ChatImageSource[], index: number): void;
  /**
   * An MCP app's logo for a tool-call card (the core's `toolAppLogo`, gx-chat-core
   * `transcript/tool_apps.rs`), as SVG text; null until the core answers or for an unknown app.
   */
  toolAppLogo(key: string): string | null;
};

const UiContext = createContext<NativeChatUi | null>(null);

export function NativeChatUiProvider({ chat, children }: { chat: RustChat; children: ReactNode }) {
  const disclosures = useMemo(() => new DisclosureStore(), []);
  const dispatchRef = useRef(chat.dispatch);
  dispatchRef.current = chat.dispatch;
  const queryAsyncRef = useRef(chat.queryAsync);
  queryAsyncRef.current = chat.queryAsync;
  const demand = useMemo(() => new RowDetailDemand((action) => dispatchRef.current(action)), []);
  useEffect(() => () => demand.dispose(), [demand]);
  // A new core (the host changed) has forgotten which rows are open and which images it read.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    demand.reset();
    requested.current = new Set();
  }, [chat.dispatch, demand]);
  const requestImage = useCallback((path: string) => {
    if (path.length === 0 || requested.current.has(path)) return;
    requested.current.add(path);
    dispatchRef.current({ type: 'loadImage', path });
  }, []);
  // Keyed on `chat.query`, which changes when a late core answer arrives, so a chart drawn before
  // its layout came back draws again.
  const { query } = chat;
  const renderVisual = useCallback(
    (source: string, width: number, theme: JsonRecord, progress?: number): JsonRecord | null =>
      obj(
        query(
          'renderVisual',
          progress === undefined ? [source, width, theme, 'System'] : [source, width, theme, 'System', progress],
        ),
      ),
    [query],
  );
  const renderVisualAsync = useCallback(
    async (source: string, width: number, theme: JsonRecord, progress?: number): Promise<JsonRecord | null> =>
      obj(
        await queryAsyncRef.current(
          'renderVisual',
          progress === undefined ? [source, width, theme, 'System'] : [source, width, theme, 'System', progress],
        ),
      ),
    [],
  );
  const toolAppLogo = useCallback(
    (key: string): string | null => {
      const svg = query('toolAppLogo', [key]);
      return typeof svg === 'string' ? svg : null;
    },
    [query],
  );
  const openPicture = useCallback((image: ChatImageSource, fallback: readonly ChatImageSource[], index: number) => {
    void queryAsyncRef
      .current('transcriptPictures', [image])
      .catch(() => null)
      .then((answer) => {
        const gallery = obj(answer);
        const images = arr(gallery?.images)
          .map((entry) => obj(entry))
          .filter((entry): entry is ChatImageSource => entry !== null);
        const at = typeof gallery?.index === 'number' ? gallery.index : -1;
        if (images.length > 0 && at >= 0) openChatImageViewer(images, at);
        else openChatImageViewer(fallback, index);
      });
  }, []);
  const value = useMemo<NativeChatUi>(
    () => ({ disclosures, demand, requestImage, renderVisual, renderVisualAsync, openPicture, toolAppLogo }),
    [demand, disclosures, requestImage, renderVisual, renderVisualAsync, openPicture, toolAppLogo],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

/** The chat screen's shared drawing state, or null outside `NativeChatScreen` (Markdown in a card). */
export function useOptionalNativeChatUi(): NativeChatUi | null {
  return useContext(UiContext);
}

/** The chat screen's shared drawing state. Throws outside `NativeChatScreen`. */
export function useNativeChatUi(): NativeChatUi {
  const value = useContext(UiContext);
  if (value === null) throw new Error('useNativeChatUi outside NativeChatUiProvider');
  return value;
}

/** How one list draws (`ChatAppearance` plus the list it belongs to). */
export type TranscriptEnv = {
  /** The chat's `dispatch`, stable per chat (the `RustChat` object itself changes every frame). */
  dispatch: RustChat['dispatch'];
  theme: TranscriptTheme;
  /**
   * The Normal look (Normal or Summary view, `viewLevel`): tool runs and a message's file edits
   * fold behind a count, and tool rows hide their command preview (desktop `ChatAppearance::simple`).
   */
  simple: boolean;
  /**
   * The folds under each agent message (its tool calls, a thought's tools, a finished turn's
   * "Worked" log) start open: in Detailed view (desktop
   * `ChatAppearance::work_open`, CDXC:SessionChat 2026-10-14 DECISION).
   */
  workOpen: boolean;
  /** The session is working: a call still running sweeps its shimmer (desktop `snapshot["working"]`). */
  working?: boolean;
  /** Tool call lines (`chatToolCallLines`): a tool card draws as one quiet line with its calls as rows under it (desktop `ChatAppearance::tool_lines`). */
  toolLines?: boolean;
  /** File edit previews: file cards show their first lines without a tap. */
  filePreviews: boolean;
  /** Grey thinking (`sessionChatMutedThinking`): thinking muted, replies in the foreground (desktop `ChatAppearance::thinking_lane`). */
  mutedThinking: boolean;
  /** This session's own transcript (not the subagent viewer): only it offers rewind. */
  main: boolean;
  /** Uploads files and answers their paths, for images pasted into a question form's boxes. */
  uploadFiles?: RustChat['uploadFiles'];
  /** The core's pure helpers, for the reference a pasted image writes into a form's box. */
  queryAsync?: RustChat['queryAsync'];
};

const EnvContext = createContext<TranscriptEnv | null>(null);
export const TranscriptEnvProvider = EnvContext.Provider;

export function useTranscriptEnv(): TranscriptEnv {
  const value = useContext(EnvContext);
  if (value === null) throw new Error('useTranscriptEnv outside a transcript');
  return value;
}

/** The document fields rows read, gathered once per document so rows compare cheaply. */
export type TranscriptFlags = {
  finalIds: ReadonlySet<string>;
  /** Pages whose answers arrived, so their cards read Answered (desktop `visual.rs`). */
  answeredPages: ReadonlySet<string>;
  /** Question pages whose questions were withdrawn, some or all (desktop `page_card.rs`). */
  withdrawnPages: { [pageId: string]: { tags: string[]; total: number } };
  /** Question pages and forms still unanswered, which offer For later (gx-chat-core `questions/later.rs`). */
  unansweredQuestions: ReadonlySet<string>;
  /** Question pages and forms put off For later, which offer Back to unanswered. */
  laterQuestions: ReadonlySet<string>;
  /** Question pages and forms the reader removed without answering: their cards read Canceled. */
  canceledQuestions: ReadonlySet<string>;
  savedPrompts: { [messageId: string]: Json };
  rewindAvailable: boolean;
  rewindEnabled: boolean;
  /** The host can stash (Save prompt on a user row). */
  canSavePrompt: boolean;
  /** The queue's Edit and Delete, which a user row still waiting for the agent offers too. */
  canEditQueued: boolean;
  canRemoveQueued: boolean;
  /** The failed row whose card is showing, so its own line only says it was not sent. */
  sendFailureCardPromptId: string | null;
  /** Messages the agent itself queued, which Back to composer takes back into the composer. */
  takeBackIds: ReadonlySet<string>;
  /** The message a Back to composer is taking back right now. */
  takeBackBusy: string | null;
  /** Your messages still waiting for their pictures (core `composer/attaching.rs`), by id. */
  attaching: ReadonlyMap<string, { pictures: number; status: boolean }>;
  deferredWork: { [itemId: string]: { loading: boolean; error?: string | null } };
  /** The open API error card (`apiErrorCard`); the row whose id it names draws it, other failed-call rows a quiet line. */
  apiErrorCard: Json;
  /** Handover heading color strength, 0 to 1 (`markedHeadingStrength`; absent is 60%). */
  markedHeadingStrength: number;
  /** Text strength, 0 to 100 (`chatTextStrength`; absent is 0, today's colour). */
  chatTextStrength: number;
  /** Claude Code workflow runs drawn as cards, by Workflow call id (`workflowCards`). */
  workflowCards: { [callId: string]: Json };
  /** What can change on each "GBot added" card, by change id (`gbotCardStates`). */
  gbotCardStates: { [changeId: string]: Json };
  /** Read aloud's reply row shows (`readAloud.available`). */
  readAloudAvailable: boolean;
  /** The reply being read, whose row reads Stop reading (`readAloud.speakingId`). */
  readAloudSpeakingId: string | null;
  /** A coordinator's relayed thread approval cards, by the report row each is drawn under (`anchorId`). */
  relayedApprovals: { [messageId: string]: JsonRecord };
  /** A coordinator's work item cards, by the reply each sits under and by summary-mode turn (`workCards`). */
  workCards: WorkCardIndex;
  /**
   * Every card on the chat's board by ref (`B4`) with its title now (`coordinatorBoard.itemTitles`,
   * gx-chat-core `board_reference`): a board mention reads its label from it and draws dimmed when
   * its ref is not in it. Null on a chat without a board, or a gxserver that sends no index.
   */
  boardItemTitles: { [ref: string]: string } | null;
  /** The chat look (`chatLook`; absent is all Default, today's chat). Every path it opens is gated on a non-Default value. */
  chatLook: ChatLook;
};

/** Every chat look setting at Default: today's chat. */
export const DEFAULT_CHAT_LOOK: ChatLook = {
  messageLayout: 'default',
  userStyle: 'default',
  agentWork: 'default',
  statusInTranscript: false,
  spacing: 'default',
};

/** The document's chat look; a missing look or an unknown value reads as Default (gx-chat-core `transcript/chat_look.rs`). */
export function chatLookOf(document: ChatDocument | null): ChatLook {
  const look = obj(document?.chatLook);
  if (look === null) return DEFAULT_CHAT_LOOK;
  const userStyle = look.userStyle === 'band' ? 'band' : 'default';
  return {
    // `effective_layout`: Your messages Band draws on the left.
    messageLayout: look.messageLayout === 'left' || userStyle !== 'default' ? 'left' : 'default',
    userStyle,
    agentWork: look.agentWork === 'reduced' || look.agentWork === 'quiet' ? look.agentWork : 'default',
    statusInTranscript: look.statusInTranscript === true,
    spacing: look.spacing === 'compact' ? 'compact' : 'default',
  };
}

/** Agent work is Reduced or Quiet: the work draws in the quiet style (desktop `ChatAppearance::quiet_style`). */
export function quietStyle(look: ChatLook): boolean {
  return look.agentWork !== 'default';
}

/** Agent work is Quiet: no line before a reply, the work in its footer (`hiddenWork.tsx`, desktop `ChatAppearance::hidden_work`). */
export function hiddenWork(look: ChatLook): boolean {
  return look.agentWork === 'quiet';
}

const EMPTY_FLAGS: TranscriptFlags = {
  finalIds: new Set(),
  answeredPages: new Set(),
  withdrawnPages: {},
  unansweredQuestions: new Set(),
  laterQuestions: new Set(),
  canceledQuestions: new Set(),
  savedPrompts: {},
  rewindAvailable: false,
  rewindEnabled: false,
  canSavePrompt: false,
  canEditQueued: false,
  canRemoveQueued: false,
  sendFailureCardPromptId: null,
  takeBackIds: new Set(),
  takeBackBusy: null,
  attaching: new Map(),
  deferredWork: {},
  apiErrorCard: null,
  markedHeadingStrength: 0.6,
  chatTextStrength: 0,
  workflowCards: {},
  gbotCardStates: {},
  readAloudAvailable: false,
  readAloudSpeakingId: null,
  relayedApprovals: {},
  workCards: { byAnchor: {}, byTurn: {} },
  boardItemTitles: null,
  chatLook: DEFAULT_CHAT_LOOK,
};

const FlagsContext = createContext<TranscriptFlags>(EMPTY_FLAGS);

/**
 * True inside a summary-mode turn: its work item cards are drawn under the whole turn
 * (`TranscriptItemRow.tsx`), not under the reply inside its fold (desktop `in_summary_turn`).
 */
const SummaryTurnContext = createContext(false);
export const SummaryTurnProvider = SummaryTurnContext.Provider;
export function useInSummaryTurn(): boolean {
  return useContext(SummaryTurnContext);
}
export const TranscriptFlagsProvider = FlagsContext.Provider;
export function useTranscriptFlags(): TranscriptFlags {
  return useContext(FlagsContext);
}

/**
 * The chat look on its own (the flags' `chatLook`), for the rows that read nothing else from the
 * flags: reading it through `useTranscriptFlags` redrew every row whenever any flag moved (a turn's
 * `finalIds`, Read aloud), with every look at Default too.
 */
const ChatLookContext = createContext<ChatLook>(DEFAULT_CHAT_LOOK);
export const ChatLookProvider = ChatLookContext.Provider;
export function useChatLook(): ChatLook {
  return useContext(ChatLookContext);
}

export function transcriptFlags(document: ChatDocument | null): TranscriptFlags {
  if (document === null) return EMPTY_FLAGS;
  return {
    finalIds: new Set(arr(document.finalIds).filter((id): id is string => typeof id === 'string')),
    answeredPages: new Set(arr(document.answeredPages).filter((id): id is string => typeof id === 'string')),
    withdrawnPages: obj(document.withdrawnPages) === null ? {} : (document.withdrawnPages ?? {}),
    unansweredQuestions: new Set(
      (document.openQuestions?.sections ?? [])
        .filter((section) => section.id === 'unanswered')
        // The Unanswered group also lists the For later ones (marked `later`); only the waiting offer For later.
        .flatMap((section) => section.rows.filter((row) => row.status !== 'later').map((row) => row.id)),
    ),
    laterQuestions: new Set(arr(document.laterQuestions).filter((id): id is string => typeof id === 'string')),
    canceledQuestions: new Set(
      (document.openQuestions?.sections ?? []).flatMap((section) =>
        section.rows.filter((row) => row.status === 'canceled').map((row) => row.id),
      ),
    ),
    savedPrompts: obj(document.savedPrompts) === null ? {} : document.savedPrompts,
    rewindAvailable: document.rewindAvailable === true,
    rewindEnabled: document.rewindEnabled === true,
    canSavePrompt: obj(document.composerActions)?.stash === true,
    canEditQueued: obj(obj(document.queue)?.capabilities)?.canEdit === true,
    canRemoveQueued: obj(obj(document.queue)?.capabilities)?.canRemove === true,
    sendFailureCardPromptId:
      typeof document.sendFailureCardPromptId === 'string' ? document.sendFailureCardPromptId : null,
    takeBackIds: new Set(arr(document.queueTakeBackIds).filter((id): id is string => typeof id === 'string')),
    takeBackBusy: typeof document.queueTakeBackBusy === 'string' ? document.queueTakeBackBusy : null,
    attaching: new Map(
      arr(document.attachingMessages)
        .map((entry) => obj(entry))
        .filter((entry): entry is { id: string; pictures: number; status: boolean } => typeof entry?.id === 'string')
        .map((entry) => [entry.id, { pictures: Number(entry.pictures) || 0, status: entry.status === true }]),
    ),
    deferredWork: obj(document.deferredWork) === null ? {} : document.deferredWork,
    apiErrorCard: document.apiErrorCard ?? null,
    markedHeadingStrength:
      typeof document.markedHeadingStrength === 'number'
        ? Math.min(Math.max(document.markedHeadingStrength / 100, 0), 1)
        : 0.6,
    chatTextStrength: typeof document.chatTextStrength === 'number' ? document.chatTextStrength : 0,
    workflowCards: obj(document.workflowCards) === null ? {} : (document.workflowCards ?? {}),
    gbotCardStates: obj(document.gbotCardStates) === null ? {} : (document.gbotCardStates ?? {}),
    readAloudAvailable: document.readAloud?.available === true,
    readAloudSpeakingId: typeof document.readAloud?.speakingId === 'string' ? document.readAloud.speakingId : null,
    relayedApprovals: relayedByReport(document),
    workCards: workCardIndex(document),
    boardItemTitles: boardItemTitles(document),
    chatLook: chatLookOf(document),
  };
}

function boardItemTitles(document: ChatDocument): { [ref: string]: string } | null {
  const titles = obj(obj(document.coordinatorBoard)?.itemTitles);
  if (titles === null) return null;
  return Object.fromEntries(
    Object.entries(titles).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** Row details by row key; changes only when the core ships new ones. */
const DetailsContext = createContext<{ [key: string]: Json }>({});
export const RowDetailsProvider = DetailsContext.Provider;
export function useRowDetails(): { [key: string]: Json } {
  return useContext(DetailsContext);
}

/** Loaded image bytes by machine path. */
const ImagesContext = createContext<RustChatImages>({});
export type RustChatImages = NonNullable<RustChat['state']>['images'];
export const ChatImagesProvider = ImagesContext.Provider;
export function useChatImages(): RustChatImages {
  return useContext(ImagesContext);
}

/** Registers an open row's demand for its detail while mounted, and returns the detail (or null). */
export function useRowDetail(
  key: string,
  kind: 'tool' | 'file',
  messageId: string,
  index: number,
  active: boolean,
): Json {
  const { demand } = useNativeChatUi();
  const details = useRowDetails();
  useEffect(() => {
    if (!active) return undefined;
    return demand.add({ key, kind, messageId, index });
  }, [active, demand, index, key, kind, messageId]);
  return active ? (details[key] ?? null) : null;
}

/** What an image tile shows: a URI React Native can load, a spinner, or the picture's own words. */
export type ImageDisplay =
  { state: 'ready'; uri: string } | { state: 'loading' } | { state: 'unavailable'; reason: string };

/** Resolves one projected image source, asking the core for machine bytes the first time (`images.rs`). */
export function useImageDisplay(image: ChatImageSource): ImageDisplay {
  const images = useChatImages();
  const { requestImage } = useNativeChatUi();
  const transport = str(image, 'transport');
  const path = str(image, 'path');
  const url = str(image, 'url');
  useEffect(() => {
    if (transport === 'read' && path.length > 0 && images[path] === undefined) requestImage(path);
  }, [images, path, requestImage, transport]);
  if (transport === 'url' || transport === 'data')
    return url.length > 0 ? { state: 'ready', uri: url } : { state: 'unavailable', reason: 'unavailable' };
  if (transport !== 'read' || path.length === 0) return { state: 'unavailable', reason: 'unavailable' };
  const loaded = images[path];
  if (loaded === undefined) return { state: 'loading' };
  if (loaded.status === 'failed') return { state: 'unavailable', reason: loaded.reason };
  return { state: 'ready', uri: `data:${loaded.mediaType};base64,${loaded.base64Data}` };
}
