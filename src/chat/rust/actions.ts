/**
 * Everything the user can do in the chat, as the screen reports it to the Rust core.
 *
 * Source of truth: `ActionKind` in `packages/gx-chat-core/src/action.rs` (the wire spelling of each
 * kind) and the per-family `actions.rs` handlers under `packages/gx-chat-core/src/` (the fields each reads).
 * The fields below are the ones desktop sends (`json!({"type": ...})` sites under
 * `apps/desktop/src/app/native_chat/`), which is the reference for what to send and when.
 *
 * Shape on the wire: `{type: '<kind>', ...fields}`, flat. Dispatch it with the host's `dispatch`,
 * which wraps it as `{type: 'action', action}`. Extra fields survive the trip (the core keeps an
 * unmodelled field), and a kind the core does not know is kept verbatim and ignored.
 *
 * UTF-16: every text offset (`caret`, `start`, `end`) is a JavaScript string index.
 */

import type { Json } from './document';

/** `{draftId, revision}`: the composer revision a send, save or edit is claimed under. */
export type DraftVersion = { draftId: string; revision: number };

/** The fields each action kind carries. `{}` means the kind carries none. */
export type ActionFields = {
  // ---- view state the sub-controllers answer first ----------------------------------------
  /** Rows drawn open, so only they ship details. Desktop sends this action too (`row_details.rs`);
   * the `openRowDetails` measurement is an unused alternative. */
  rowDetails: { open: Json };
  /** The composer box scrolled (short panes). Desktop: `composer_scroll.rs`. */
  composerScroll: { canScroll: boolean; delta: number; distanceToEnd: number; eligible: boolean };
  /** Expand a collapsed composer; `editor: true` when the field itself took focus or text. */
  composerExpand: { editor?: boolean };
  toggleAgentFleet: { open: boolean };
  toggleAgentTasks: { open: boolean };
  /** The Tasks pill's done list: how many "Show more" presses it has had (0 is the short form). Desktop: `agent_tasks.rs`. */
  toggleAgentTasksCompleted: { step: number };
  /** A coordinator's Threads panel fold, and the step its list is at (0 in flight, 1 recent, 2+ 30 more each). Desktop: `coordinator_threads.rs`. */
  toggleCoordinatorThreadsMore: { step: number };
  /** The grouped background-task row's fold. Desktop: `background_tasks.rs`. */
  toggleBackgroundTasks: { open: boolean };
  /** Open one of the coordinator's threads: gxserver resumes it if closed, then the host opens its tab. */
  openCoordinatorThread: { projectId: string; sessionId: string };
  searchOpen: {};
  searchClose: {};
  searchQuery: { query: string };
  searchNext: {};
  searchPrevious: {};
  /** The open and closed folds, so find searches only what the reader can see (core `transcript_search.rs`). */
  searchFolds: { expanded: string[]; collapsed: string[]; simple: boolean; workOpen: boolean };
  terminalTailHover: {};
  terminalTailToggle: {};
  /** Copy Report (gx-chat-core `extras/report.rs`). */
  copyReport: {};
  /** Open a subagent's transcript from its tool row or fleet chip. Desktop: `subagent_view.rs`. */
  openSubagent: { selector: Json; name?: string; task?: string; agentType?: string; model?: string; effort?: string };
  subagentBack: {};
  subagentClose: {};
  subagentRetry: {};
  subagentLoadEarlier: {};

  // ---- composer text, suggestions and references ------------------------------------------
  completeComposerCommand: {};
  /** The caret moved inside the text (drives the `@` / `$` / `/` popup). */
  composerSelection: { text: string; caret: number };
  /** A popup key: `up`, `down`, `enter`, `tab`, `escape`. */
  suggestionKey: { key: string };
  suggestionPick: { index: number };
  suggestionHighlight: { index: number };
  suggestionRetry: {};
  suggestionDismiss: {};
  measureComposer: { measurements: Json };
  /** Transcript selection menu: append the selection to the draft. */
  appendToDraft: { text: string; draft: string };
  /** The composer text changed (every keystroke). `history`/`preserveError` only from a replace. */
  editDraft: { text: string; draftVersion: DraftVersion; history?: boolean; preserveError?: boolean };
  /** Push the draft to gxserver (blur, replace). */
  saveDraft: { content: string; draftVersion: DraftVersion; preserveError?: boolean };
  /** Up / Down history recall (`keyboard.rs`): `up` walks back, anything else forward. */
  recallHistory: { direction: 'up' | 'down' };
  openComposerReference: { href: string };
  /** A link in the transcript; `external` for http(s). A Q-tag link (`#gx-question=Q80`) jumps to its question. */
  openMarkdownLink: { href: string; external?: boolean };
  /** The Previous question pill: the next older unanswered question, wrapping to the newest. */
  previousQuestion: {};
  /** A row of the ? pill's list: scroll to that form or page and flash it, answered or not. */
  jumpToQuestion: { id: string };
  /** "For later" (`later: true`) or "Back to unanswered" on a question form or page (gx-chat-core `questions/later.rs`). */
  questionForLater: { id: string; later: boolean };
  /** The X on a For later row: removes a form or page without answering it; it reads Canceled (gx-chat-core `questions/later.rs`). */
  questionRemove: { id: string };
  /** A form or chart of the Resources list opens in the sheet and the chat stays where it is (gx-chat-core `questions/resource_modal.rs`). */
  openResource: { id: string };
  closeResource: {};
  /** The sheet's Go to chat: scrolls to the item, loading earlier messages first when it is older than the loaded rows. */
  goToResource: { id: string };
  /** The ? pill's list shows what the filter picks: `all`, `html`, `qa` or `charts`. */
  questionListFilter: { filter: string };
  /** The list's "Show more" (and scrolling to its end after one): one more page of rows (gx-chat-core `questions/open_questions.rs`). */
  questionListMore: {};
  /** The list closed: back to its first page. */
  questionListReset: {};
  /** An agent message card's Go to session: the other session, focused. Desktop: `inter_agent_message.rs`. */
  openAgentSession: { projectId: string; sessionId: string };
  /** A command in a reply, run in the project's Commands panel terminal (gx-chat-core `run_command.rs`). */
  runInTerminal: { command: string };
  /** The same, typed into that terminal without pressing Enter. */
  pasteInTerminal: { command: string };
  /** Re-read the stash badge and note dot. The host sends it once the composer is ready. */
  refreshComposerChrome: { sessionId: string };
  /** Stash the draft into Saved Prompts. */
  stash: { text: string; draftVersion: DraftVersion };
  restoreReturned: { text?: string };
  /** The host's answer to a `returnedPrompt` request: the prompt plus the current field text. */
  applyReturned: { text: string; current: string };
  /** A failed send's text back into the field, merged with what was typed since. */
  restoreSubmission: { text: string; current: string };

  // ---- attachments --------------------------------------------------------------------------
  /** Uploads began (the send button waits). Pair with `attachmentsFinished`. */
  attachmentsStarted: {};
  attachmentsFinished: { paths?: string[]; error?: string };
  /** Local files picked on the phone; the host uploads them (`importNativeAttachments`). */
  attachPaths: { paths: string[] };
  /** Insert reference pills for machine paths at the selection. */
  insertAttachments: { paths: string[]; text: string; start: number; end: number };
  removeAttachment: { text: string; start: number; end: number };
  /** Side chat on or off: adds or removes the `/btw ` prefix on `text` (core `side_chat.rs`). */
  toggleSideChat: { text: string };
  /** More actions > Skills: the Ghostex skill's pill at the selection, not sent (core `ghostex_skills.rs`). */
  insertSkill: { name: string; text: string; start: number; end: number };
  /** Read an image's bytes for a thumbnail or the viewer; answered as a `chatImage` request. */
  loadImage: { path: string };
  /** A published page's picture for its card; answered as a `pageThumbnail` host action. */
  loadPageThumbnail: { pageId: string };

  // ---- sending ------------------------------------------------------------------------------
  /** `interrupt`: interrupt and send, which stops the agent's running turn first (the core's `interrupts_turn`). */
  send: { text: string; draftVersion: DraftVersion; imagePaths?: string[]; interrupt?: boolean };
  queue: { text: string; draftVersion: DraftVersion };
  compact: { text: string; draftVersion: DraftVersion };
  /** A terminal key: `enter`, `shift-tab`, `shift-up`, `shift-down`. */
  sendKey: { key: string; marker?: string };
  interrupt: {};
  /** Hand the draft to the agent's terminal composer. */
  handoff: { text: string; draftVersion: DraftVersion };
  receiveHandoff: { handoffId: string; content: string; current: string; draftVersion?: DraftVersion };
  dismissIncomingDraft: {};
  useIncomingDraft: {};

  // ---- the queue ----------------------------------------------------------------------------
  retryQueue: { promptId: string };
  /** `edit: true` moves the row's text back into the composer. */
  removeQueue: { promptId: string; edit?: boolean };
  sendQueue: { promptId: string };
  reorderQueue: { promptIds: string[] };
  moveQueue: { promptId: string; targetId: string };
  /** Back to composer: takes a message the agent itself queued back into the composer. */
  takeBackQueued: { messageId?: string };

  // ---- questions, approvals and notices -----------------------------------------------------
  /** Answer the blocking prompt or a terminal dialog. Desktop: `approval.rs`, `notice.rs`,
   * `terminal_dialog.rs`. */
  answer: {
    answer?: Json;
    kind?: string;
    text?: string;
    dialogId?: string;
    dialogAction?: string;
    approvalSend?: boolean;
    keyModifiers?: Json;
  };
  questionText: { text: string };
  questionBack: {};
  questionOption: { index: number };
  questionNext: {};
  questionCancel: {};
  formChoice: { form: string; question: number; choice: number };
  formText: { form: string; question: number; text: string };
  formNotes: { form: string; text: string };
  formSend: { form: string };
  formSkipAll: { form: string };
  formToggle: { form: string };
  asyncQuestionToggle: {};
  asyncQuestionNavigate: { direction: string };
  asyncQuestionText: { key: string; text: string };
  asyncQuestionOption: { key: string; index: number };
  asyncQuestionSend: {};
  asyncQuestionSkip: {};
  dismissNotice: {};
  noticePrimary: { kind?: string; choiceIndex?: number };
  noticeSecondary: { kind?: string; choiceIndex?: number };

  // ---- options, models and accounts ---------------------------------------------------------
  /** Pick an option row (`optionMenus` rows carry the exact payload to send). */
  selectOption: { descriptorId?: string; value?: Json; [field: string]: unknown };
  /** `tab: null` is the picker opening, which also re-reads the stars (`model_menu_view`); `legacyOpen` opens or closes the tab's Legacy models. */
  modelMenuView: { tab?: string | null; query?: string; legacyOpen?: boolean };
  modelMenuFavorite: { key: string };
  /** `effort` is the reasoning level the pick carries (desktop's Left and Right); left out, the model keeps its own. */
  modelMenuPick: { key: string; secondary?: boolean; effort?: string };
  modelMenuTrait: { id: string; value: Json; exitPlan?: boolean; secondary?: boolean };
  /** Accounts panel operations: `{operation, request?, accountId?, policy?, refresh?}`. */
  accounts: { operation?: string; request?: Json; accountId?: string; policy?: Json; refresh?: boolean };
  switchDraftAgent: { agentId: string };
  /** The Run on row: move a draft to this computer (`local`) or a box (`agentbox:<provider>`). */
  switchDraftRunLocation: { runLocation: string };
  selectForkBranch: { [field: string]: unknown };

  // ---- context ------------------------------------------------------------------------------
  contextEdit: { id?: string };
  contextCancel: {};
  contextQuery: { query: string };
  contextShown: { id: string; shown: boolean };
  contextStar: { id: string };
  /** Move row `from` onto row `to` (both row ids) in `group`, or `starred` for the status line order. */
  contextReorder: { group: string; from: string; to: string };
  contextReset: {};
  contextSave: {};
  contextCompact: {};

  // ---- the session note and Save to Markdown ------------------------------------------------
  toggleNote: {};
  editNote: { text: string };
  clearNote: {};
  saveNote: {};
  /** Catch me up: the composer's button (opens and asks, or closes), the card's Refresh and Close. */
  catchUp: {};
  catchUpRefresh: {};
  catchUpClose: {};
  /** Files and links: the toolbar button (opens and reads, or closes), Refresh, Close, the filter, a section's
   * "Show all", and a row's jump to the message that mentioned it. */
  filesLinks: {};
  filesLinksRefresh: {};
  filesLinksClose: {};
  filesLinksFilter: { text: string };
  filesLinksShowAll: { section: string };
  filesLinksJump: { messageId: string; timestamp?: number | null; projectId?: string; sessionId?: string };
  markdownSaveOpen: { markdown: string };
  markdownSaveFolder: { [field: string]: unknown };
  markdownSaveName: { [field: string]: unknown };
  markdownSaveCancel: {};
  markdownSaveSubmit: {};

  // ---- per-message actions ------------------------------------------------------------------
  rewindOpen: { messageId: string; prompt: string };
  rewindCancel: {};
  rewindSubmit: {};
  savePrompt: { messageId: string; prompt: string };

  // ---- Read aloud (core `read_aloud/actions.rs`) ---------------------------------------------
  /** A reply's Read aloud row; on the reply already speaking it stops instead. */
  readAloudMessage: { messageId: string };
  /** The ⋯ menu's Auto-read row; `on` left out toggles. */
  readAloudAuto: { on?: boolean };
  /** The ⋯ menu's Stop reading row. */
  readAloudStop: {};
  /** Reads the newest final reply from the start (the desktop's hotkey). */
  readAloudLastReply: {};

  // ---- modes and loading --------------------------------------------------------------------
  toggleSummary: {};
  setVerbose: { enabled: boolean };
  retry: {};
  refresh: {};
  loadEarlier: {};
  /** Read a completed turn's off-screen work: `work` is the item's `deferred` value. */
  loadWork: { id: string; work: Json };
};

/** Every action kind the core knows, as the wire spells it. */
export type ActionKind = keyof ActionFields;

/** One user action as the screen sends it. */
export type UserAction = {
  [Kind in ActionKind]: { type: Kind } & ActionFields[Kind] & { [extra: string]: unknown };
}[ActionKind];

/** Builds a typed action. */
export function action<Kind extends ActionKind>(type: Kind, fields: ActionFields[Kind]): UserAction {
  return { type, ...fields } as UserAction;
}
