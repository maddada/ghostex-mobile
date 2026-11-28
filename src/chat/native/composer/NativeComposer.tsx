/**
 * The native chat composer: everything below the transcript that the user types into or presses.
 *
 * It draws the Rust core's document (`src/chat/rust/document.ts`) and reports gestures with the
 * actions desktop sends (`apps/desktop/src/app/native_chat/composer.rs` and its siblings), so every
 * rule (what Send does, what the queue allows, which suggestions show, what a pill is) stays in
 * `gx-chat-core`. The text itself lives in the host's composer model (`src/chat/rust/composer.ts`).
 *
 * Top to bottom, as desktop's `render_composer` stacks them: the incoming draft offer, the
 * operation error, the session note, the suggestions popup, then the card (a new coordinator's
 * first message, image tiles, queue, input, option pills + toolbar + Send), then the status line.
 *
 * In one of the iPhone Duo's pane slots (`chatPlacement`) the card takes the approved panes mockup's compact form,
 * with Dictate kept right before Send: under the field one row of the model pill, More actions, Dictate and Send.
 * The pill strip, the other option pills (options, permission mode, context ring), the toolbar controls, Copy Report
 * and the status line are drawn by the full chat view only; More actions carries the controls and the option
 * settings as it does when they overflow (`moreActionsRows`' `allFolded`).
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import type { UserAction } from '../../rust/actions';
import type { ChatDocument } from '../../rust/document';
import type { SubmitMode } from '../../rust/composer';
import type { RustChat } from '../../rust/useRustChat';
import { AttachmentPreviews } from './AttachmentPreviews';
import { FirstMessageCard } from './FirstMessageCard';
import { clipboardHasImage, pickAttachments, savePastedImage, type AttachSource } from './attachments';
import { COLLAPSED_INPUT_HEIGHT, ComposerInput, type ComposerInputHandle } from './ComposerInput';
import { ContextEditorSheet } from './ContextEditorSheet';
import { PasteImageRow, pasteControlAvailable } from './PasteImageRow';
import { Glyph, type GlyphName } from './icons';
import { Glyph as CardGlyph } from '../cards/icons';
import { attachIntakeImages } from './imageIntake';
import { isTrue, obj, str, type JsonRecord } from './json';
import { useInventoryStore } from '../../../inventory/store';
import { sessionMenuLayoutNow } from '../../../session-menu/layout';
import { sessionMenuInputFromSummary, sessionMenuPlaces } from '../../../screens/sessions-screen/sidebar-menus';
import { delayedSendOnIn } from '../../../sessions/delayedActionsSwitch';
import {
  COMPOSER_CONTROLS,
  moreActionsRows,
  sessionMenuRows,
  optionMenuRows,
  overflowed,
  rowFolded,
  terminalIssue,
  sendMenuRows,
  type ComposerActionId,
  type ComposerControlId,
} from './menus';
import { MenuSheet, type MenuRow, type MenuSearch } from './MenuSheet';
import { ModelMenuSheet, type ModelSheetMode } from './ModelMenuSheet';
import { NotePanel } from './NotePanel';
import { phonePlaceholder } from './placeholder';
import { BoostHintChip } from '../cards/Boosts';
import { BoxNotes } from './BoxNotes';
import { CatchUpCard } from '../cards/CatchUpCard';
import { CompactPromptCard } from '../cards/CompactPromptCard';
import type { DraftStripToggles } from '../cards/PillsStrip';
import { sessionDetailsRingOf } from '../cards/SessionDetailsSheet';
import { FilesLinksCard } from '../cards/FilesLinksCard';
import { secretRequestOpen } from '../cards/SecretRequestCard';
import { SecretSendWarning } from './SecretSendWarning';
import { OptionPills, modeInModelPill, modeLook, optionPillsLeadIn, type PillKind } from './OptionPills';
import { RunLocationRow } from './RunLocationRow';
import { ProjectPickerSheet } from './ProjectPickerSheet';
import {
  commitPendingDraftSend,
  draftProjectChoices,
  homeProjectIdForMachine,
  isHomeProject,
  mainHubMachineChoice,
  NO_PROJECT_NAME,
  NO_PROJECT_REPO_KEY,
  setCarryCoordinatorDraft,
  takeCarryCoordinatorDraft,
  type PendingDraftTarget,
} from './draftProjectChoices';
import { FIRST_LINE, NEW_ORCHESTRATOR_BENEFITS } from '../../../screens/sessions-screen/NewCoordinatorSheet';
import { attachSessionKey } from '../../../terminal/sessions';
import { sessionChatRpc } from '../../rust/transport';
import { markDraftTouched } from '../untouchedDrafts';
import { reportMissingAgentError } from '../../../agents/missingAgent';
import { MachinePickerSheet } from './MachinePickerSheet';
import { repoKeyOfProject } from '../../../screens/sessions-screen/new-session-place';
import { machineTargetFor } from '../../../screens/terminal-screen/session-lookups';
import type { UnifiedProjectChoice } from '../../../contract/unified/choices';
import { enabledMachines, machineDisplayLabel, useMachinesStore } from '../../../machines/store';
import { WorktreeTray } from './WorktreeTray';
import { useOptionalNativeChatUi } from '../transcript/context';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { QueueList } from './QueueList';
import { createDraftReferenceParser } from './references';
import { SendControl } from './SendControl';
import { StatusLine, statusLineReserved } from './StatusLine';
import { Suggestions } from './Suggestions';
import { useComposerMotion } from './useComposerMotion';
import { DictationBar, DictationCard, unavailableProblem } from './DictationBar';
import { toneLook } from '../cards/ToneCard';
import { dictationClock, useDictation } from './useDictation';
import { engineStatusLine, type DictateEngine } from '../../../voice/dictateModel';
import { computerName } from '../../../screens/settings/voiceComputer';
import { KeyboardLiftedView } from './KeyboardLiftedView';
import { useChatPlacement } from '../chatPlacement';
import { useVoiceStore, voiceActive } from '../../../voice/conversation';
import { showAlert } from '../../../components/common/dialog/alert';

export type NativeComposerProps = {
  /** The draft's own place, which the tray's project chip moves it from. */
  projectId: string;
  sessionId: string;
  chat: RustChat;
  /**
   * Runs an app-shell action the composer cannot do itself (desktop's `NativeChatEvent::Host`):
   * `terminalView`, `stashedPrompts`, `openAccountsSettings`, and the More actions rows such as
   * `rename`, `sleep`, `fork`. Controls and rows that need it are hidden while it is absent.
   */
  onHostAction?: (action: string, params: JsonRecord) => void;
  /**
   * The app-shell actions `onHostAction` actually performs. Only those get a control or a More
   * actions row, so nothing on screen does nothing. Defaults to Terminal View alone.
   */
  hostActions?: readonly string[];
  /**
   * Bumped by the screen when something outside the composer asks for the Accounts & limits panel
   * (the notice card's Switch account). Each new value opens it; 0 opens nothing.
   */
  openAccountsRequestId?: number;
  /** Bumped by the screen when the field is to take the keyboard (its pane became the active one); 0 asks nothing. */
  focusRequestId?: number;
  /** Called when the chat box takes or loses the caret (the dock folds while it has it, `WorkDock`). */
  onFocusChange?: (focused: boolean) => void;
  /**
   * Bumped by the screen when something outside the composer asks for the model sheet (the
   * held-messages card's Pick model). Each new value opens what a tap on the model pill opens; 0 opens nothing.
   */
  openModelRequestId?: number;
  /** The session's title, for the More actions row Voice Call's hint (shown when `voiceCall` is served). */
  voiceCallTitle?: string;
  /** A GBot's chat: the GBot's name, that row then being "Call <GBot>". */
  voiceCallGbotName?: string;
  /**
   * The most height the composer may take, measured by the screen (`NativeChatScreen`). The field
   * gives up lines to stay inside it, so the footer row with Send never ends up under the keyboard;
   * absent, the field grows to `INPUT_MAX_HEIGHT`.
   */
  room?: number;
  /** The chat's pill strip (`PillsStrip.tsx`), drawn along the box's top edge inside its border; not in a pane. */
  strip?: ReactNode;
  /** Renders the chat's pill strip with the draft's "No project" and "Coordinator" toggles when active. */
  renderStrip?: (draftToggles: DraftStripToggles | null) => ReactNode;
  /** The session sleeps: More actions' Sleep row reads Wake. */
  sleeping?: boolean;
  /**
   * The chat's computer runs the voice agent: the headset button stands in the bottom row (the host's `voiceAgent`
   * action starts a conversation or opens the running one, which keeps the button lit wherever it was started).
   */
  voiceAgent?: boolean;
  /**
   * The agent is reopening in another mode (`switchingHostMode`): Send waits, dimmed, and the draft stays until it
   * is done.
   */
  holdSend?: boolean;
  /**
   * The box is expanded (More actions' Expand): the field takes all of `room`, so the box covers the transcript, as
   * desktop's Maximize does. Absent, the box has no Expand row. The screen holds it (its `room` then keeps no strip of
   * transcript); a message leaving the box collapses it, as desktop's send closes the maximized box.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

const DEFAULT_HOST_ACTIONS: readonly string[] = ['terminalView'];

/** Toolbar geometry the overflow fit is computed from (`toolbar.rs`, `composer_measurement`). */
const CONTROL_WIDTH = 32;
const ACTION_GAP = 4;
/** The Copy Report pill's width (icon, gap, label and padding), reserved while it shows. */
const COPY_REPORT_PILL_WIDTH = 104;
/** The not-ready readiness colour, which the Copy Report pill shares with the Terminal View glyph. */
const NOT_READY_TINT = '#f0a3a3';
const SEND_WIDTH = 30;
const FOOTER_GAP = 8;
const CLEARANCE = 8;
const INPUT_MAX_HEIGHT = 168;
/** The fewest the field shrinks to when the room is short: two lines, which scroll inside it. */
const INPUT_MIN_HEIGHT = 44;
/** The box's one border: a hairline along its top edge (`styles.dock`). */
const CARD_BORDER = StyleSheet.hairlineWidth;
/** The collapsed inner body before its first collapse is measured: under `styles.dock`'s top border. */
const COLLAPSED_CARD_ESTIMATE = 6 + Math.max(COLLAPSED_INPUT_HEIGHT, CONTROL_WIDTH, SEND_WIDTH) + 6;

/** How often a composer focus may re-read the agent's screen for the readiness light. */
const TAIL_READ_INTERVAL_MS = 15_000;

/**
 * Only a measured verdict tints the Terminal View glyph (`terminal_ready.rs`): `unknown`, an
 * unreadable screen and the time before the first read keep the footer colour.
 */
function terminalReadinessTint(document: ChatDocument): string | null {
  const readiness = document.terminalTail?.readiness;
  if (readiness === 'ready') return '#a6e3b1';
  if (readiness === 'notReady') return NOT_READY_TINT;
  return null;
}

/**
 * The mic's hold menu (Dictate): the voice agent's row where the mic carries it, the engine as the section's heading,
 * Transcribe previous (the newest recording that has no text yet) and the computer's Voice settings.
 */
export function dictationMenuRows({
  voiceInMic,
  voiceLit,
  engine,
  previous,
  machineLabel,
}: {
  voiceInMic: boolean;
  voiceLit: boolean;
  engine: DictateEngine | null;
  previous: { durationMs: number; createdAt: number } | null;
  /** The chat's computer by name ("your computer" when unknown). */
  machineLabel: string;
}): MenuRow[] {
  const rows: MenuRow[] = [];
  if (voiceInMic) {
    rows.push({
      label: voiceLit ? 'Open the voice agent' : 'Talk to the voice agent',
      iconPath: 'titlebar/headset.svg',
      command: { type: 'host', action: 'voiceAgent' },
    });
  }
  /*
   * CDXC:SessionChat 2026-11-28 DECISION:
   * User, of this sheet: "clean up this so the extra subtitle text is hidden under an info icon that I need to
   * click on to read more". Where Dictate transcribes and what Voice settings holds are each an (i) at the end of
   * their row, shown on a tap (`InfoHint`); a tap on the row still runs it. An engine that is not ready keeps its
   * line in view: it says why the mic is dimmed and what to do.
   */
  if (engine !== null) {
    const status = engineStatusLine(engine, machineLabel);
    rows.push({
      heading: true,
      label: engine.label,
      ...(engine.ready ? { info: status } : { description: status }),
    });
  }
  if (previous !== null) {
    const minutes = Math.floor((Date.now() - previous.createdAt) / 60_000);
    const when =
      minutes < 1
        ? 'just now'
        : minutes < 60
          ? `${minutes} min ago`
          : minutes < 2880
            ? `${Math.floor(minutes / 60)} h ago`
            : `${Math.floor(minutes / 1440)} days ago`;
    rows.push({
      label: `Transcribe previous (${dictationClock(previous.durationMs)}, ${when})`,
      iconPath: 'titlebar/microphone.svg',
      command: { type: 'composerHost', action: 'transcribePreviousDictation' },
    });
  }
  rows.push({
    label: 'Voice settings',
    info: `Dictate's engine and language on ${machineLabel}.`,
    iconPath: 'titlebar/settings.svg',
    command: { type: 'composerHost', action: 'voiceSettings' },
  });
  return rows;
}

const CONTROL_GLYPHS: Record<ComposerControlId, GlyphName> = {
  note: 'note',
  attach: 'paperclip',
  terminal: 'terminal-2',
};

type OpenMenu =
  | { kind: 'rows'; title?: string; rows: MenuRow[]; pasteImage?: boolean; search?: MenuSearch | null }
  | { kind: 'model' }
  | null;

export function NativeComposer({
  projectId,
  sessionId,
  chat,
  onHostAction,
  hostActions = DEFAULT_HOST_ACTIONS,
  openAccountsRequestId = 0,
  focusRequestId = 0,
  onFocusChange,
  openModelRequestId = 0,
  voiceCallTitle = '',
  voiceCallGbotName = '',
  room,
  strip,
  renderStrip,
  sleeping = false,
  voiceAgent = false,
  holdSend = false,
  expanded,
  onExpandedChange,
}: NativeComposerProps) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  // A chat in a pane slot: the compact form (see the head of this file).
  const compact = useChatPlacement().inPane;
  const serves = useCallback(
    (action: string) => onHostAction !== undefined && hostActions.includes(action),
    [hostActions, onHostAction],
  );
  const state = chat.state;
  const document = state?.document ?? null;
  const input = chat.composer;
  const model = state?.composer ?? null;
  const dispatch = chat.dispatch;
  const [projectChoices, setProjectChoices] = useState<UnifiedProjectChoice[] | null>(null);
  const [draftCoordinatorMode, setDraftCoordinatorMode] = useState<boolean>(() => takeCarryCoordinatorDraft());
  const [pendingTarget, setPendingTarget] = useState<PendingDraftTarget | null>(null);
  const [pendingTrayAnswer, setPendingTrayAnswer] = useState<{ projectId: string; currentBranch: string | null } | null>(null);
  const [pendingMoveInFlight, setPendingMoveInFlight] = useState(false);
  const pendingTrayGen = useRef(0);
  const rememberedProject = useRef<PendingDraftTarget | null>(null);
  const effectiveMachineId = pendingTarget?.machineId ?? chat.machine?.id ?? '';
  const effectiveProjectId = pendingTarget?.projectId ?? projectId;
  const isHome = pendingTarget !== null ? pendingTarget.isMainHub : chat.machine !== null && isHomeProject(chat.machine.id, projectId);
  const previousSessionId = useRef(sessionId);
  useEffect(() => {
    if (previousSessionId.current !== sessionId) {
      previousSessionId.current = sessionId;
      setDraftCoordinatorMode(takeCarryCoordinatorDraft());
      setPendingTarget(null);
      setPendingTrayAnswer(null);
      setPendingMoveInFlight(false);
      pendingTrayGen.current += 1;
    }
  }, [sessionId]);
  const homeProjectId = effectiveMachineId.length > 0 ? homeProjectIdForMachine(effectiveMachineId) : null;
  const noProjectOn = isHome && (pendingTarget?.isMainHub === true || homeProjectId !== null);
  const setPendingTargetHere = useCallback(
    (target: PendingDraftTarget): void => {
      if (pendingMoveInFlight) return;
      const from = chat.machine;
      if (from === null) return;
      markDraftTouched(attachSessionKey(from.id, sessionId));
      pendingTrayGen.current += 1;
      const gen = pendingTrayGen.current;
      setPendingTrayAnswer(null);
      if (target.machineId === from.id && target.projectId === projectId) {
        setPendingTarget(null);
        return;
      }
      setPendingTarget(target);
      if (!target.isMainHub && target.machineId === from.id) {
        void sessionChatRpc(from, 'draftWorktree', {
          projectId,
          sessionId,
          targetProjectId: target.projectId,
        })
          .then((answer) => {
            if (pendingTrayGen.current !== gen || answer.error !== null) return;
            const payload = obj(answer.result);
            if (payload === null) return;
            const returnedName = str(payload, 'projectName').trim();
            if (returnedName.length > 0 && target.label.length > 0 && returnedName !== target.label) return;
            const branch = str(payload, 'currentBranch').trim();
            setPendingTrayAnswer({ projectId: target.projectId, currentBranch: branch.length > 0 ? branch : null });
          })
          .catch(() => undefined);
      }
    },
    [chat.machine, pendingMoveInFlight, projectId, sessionId],
  );
  const toggleNoProject = (): void => {
    if (pendingMoveInFlight) return;
    const from = chat.machine;
    if (from === null) return;
    markDraftTouched(attachSessionKey(from.id, sessionId));
    if (!noProjectOn) {
      const currentRepoKey = pendingTarget?.repoKey ?? repoKeyOfProject(effectiveMachineId, effectiveProjectId) ?? '';
      const currentLabel = pendingTarget?.label ?? document?.worktreeTray?.projectName ?? '';
      if (effectiveMachineId.length > 0 && effectiveProjectId.length > 0) {
        rememberedProject.current = {
          repoKey: currentRepoKey,
          machineId: effectiveMachineId,
          projectId: effectiveProjectId,
          label: currentLabel,
          isMainHub: false,
        };
      }
      const targetHome = homeProjectId ?? mainHubMachineChoice()?.machines.find((entry) => entry.connected)?.projectId ?? null;
      const targetMachine =
        homeProjectId !== null
          ? effectiveMachineId
          : mainHubMachineChoice()?.machines.find((entry) => entry.connected)?.machineId ?? null;
      if (targetHome !== null && targetMachine !== null) {
        setPendingTargetHere({
          repoKey: NO_PROJECT_REPO_KEY,
          machineId: targetMachine,
          projectId: targetHome,
          label: NO_PROJECT_NAME,
          isMainHub: true,
        });
      }
      return;
    }
    const remembered = rememberedProject.current;
    if (remembered !== null && !isHomeProject(remembered.machineId, remembered.projectId)) {
      setPendingTargetHere(remembered);
      return;
    }
    const choices = draftProjectChoices(effectiveMachineId || from.id);
    for (const choice of choices) {
      const picked = choice.machines[choice.selected] ?? choice.machines.find((entry) => entry.connected);
      if (picked !== undefined && picked.connected && !isHomeProject(picked.machineId, picked.projectId)) {
        setPendingTargetHere({
          repoKey: choice.repoKey,
          machineId: picked.machineId,
          projectId: picked.projectId,
          label: choice.label,
          isMainHub: false,
        });
        return;
      }
    }
    setProjectChoices(choices);
  };
  const toggleCoordinator = (): void => {
    if (chat.machine !== null) markDraftTouched(attachSessionKey(chat.machine.id, sessionId));
    const next = !draftCoordinatorMode;
    setDraftCoordinatorMode(next);
    if (next) {
      onHostAction?.('toast', { message: 'Pick a model and effort, then click Send to start this coordinator.' });
    }
  };
  const projectChipLabel = pendingTarget !== null ? pendingTarget.label : (document?.worktreeTray?.projectName ?? null);
  /** The machine chip, beside the project chip while the phone knows more than one computer. */
  const machineChipLabel = ((): string | null => {
    if (projectChipLabel === null && !noProjectOn) return null;
    const machines = enabledMachines(useMachinesStore.getState());
    const record = machines.length > 1 ? machines.find((entry) => entry.id === effectiveMachineId) : undefined;
    return record === undefined ? null : machineDisplayLabel(record);
  })();
  const [machineChoice, setMachineChoice] = useState<UnifiedProjectChoice | null>(null);
  const openMachines = (): void => {
    const from = chat.machine;
    if (from === null) return;
    if (noProjectOn) {
      setMachineChoice(mainHubMachineChoice());
      return;
    }
    const repoKey = pendingTarget?.repoKey || repoKeyOfProject(effectiveMachineId, effectiveProjectId);
    setMachineChoice(draftProjectChoices(effectiveMachineId || from.id).find((choice) => choice.repoKey === repoKey) ?? null);
  };
  /**
   * What the expanded composer measures around its field: the card's top inside the composer, the
   * card's content at its natural height and the field's own height. The room left for the field is
   * `room` minus everything else (`inputMaxHeight` below).
   */
  const [frame, setFrame] = useState({ cardTop: -1, content: -1, field: -1 });
  /** The pill strip's height at the box's top, which the field gives up too. */
  const [stripHeight, setStripHeight] = useState(0);
  /** The status line's height under the box, inside its background, which the field gives up too. */
  const [statusLineHeight, setStatusLineHeight] = useState(0);
  const measureFrame = useCallback((part: 'cardTop' | 'content' | 'field', value: number) => {
    const next = Math.round(value);
    setFrame((now) => (now[part] === next ? now : { ...now, [part]: next }));
  }, []);
  const requestedCollapsed = document?.composerCollapsed === true;
  // `styles.cardInner` sits inside `styles.card`'s border, so the animated container has no border.
  const motion = useComposerMotion(requestedCollapsed, 0, COLLAPSED_CARD_ESTIMATE);
  const field = useRef<ComposerInputHandle>(null);
  const [text, setText] = useState(model?.text ?? '');
  const [caret, setCaret] = useState(0);
  const [menu, setMenu] = useState<OpenMenu>(null);
  /**
   * A picture or file that could not be added, said on a card above the chat box until dismissed.
   *
   * CDXC:SessionChat 2026-11-13 DECISION: Q2947, the user chose to move the phone's attachment and paste failures from system
   * pop-ups ("Attachment failed") and toasts to the card above the chat box, in the Dictate card's shape, like every other error
   * in the chat.
   */
  const [attachError, setAttachError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const pendingPick = useRef<AttachSource | null>(null);
  /** A `/`, `@` or `+` the send menu chose, typed into the draft when the menu has closed. */
  const pendingTrigger = useRef<string | null>(null);
  // The draft as it is drawn now, for a press that acts on it later (moving it to another project).
  const draftAt = useRef({ text, caret });
  draftAt.current = { text, caret };
  // A dictation is typed into the question form box its recording started from
  // (`dictationTarget.ts`), else into this field as the chat's host holds it (`dictate` in host.ts).
  const dictationTargets = useOptionalNativeChatUi()?.dictationTargets ?? null;
  const dictationChat = useMemo(() => ({ dispatch, targets: dictationTargets }), [dispatch, dictationTargets]);
  const dictation = useDictation(
    chat.machine,
    (message) => onHostAction?.('toast', { message, level: 'error' }),
    dictationChat,
  );

  // An open secret request card keeps the keyboard: the composer is not focused for it (`secretRequestOpen`).
  const secretOpen = useRef(false);
  secretOpen.current = secretRequestOpen(document);
  useEffect(
    () =>
      chat.onViewRequest((request) => {
        if (request.kind === 'focusComposer' && !secretOpen.current) field.current?.focus();
      }),
    [chat.onViewRequest],
  );
  const handledFocusRequest = useRef(focusRequestId);
  /*
   * CDXC:Secrets 2026-11-19 WHY:
   * The chat box kept the keyboard through a Send and a trip to another app while a secret card was open, so a key
   * copied from a password manager was pasted into the chat box on return (a hardware keyboard's Cmd+V needs no menu).
   * While a card is open the chat box lets go of the keyboard once a message leaves it (its draft id changes) and when
   * the app comes back; a tap on it or on the card's field picks where typing goes. Desktop: `return_keyboard_to_card`
   * in `apps/desktop/src/app/native_chat/secret_request.rs`.
   */
  useEffect(() => {
    if (secretOpen.current) field.current?.blur();
  }, [model?.draftId]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && secretOpen.current) field.current?.blur();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (focusRequestId === handledFocusRequest.current) return;
    handledFocusRequest.current = focusRequestId;
    if (focusRequestId > 0 && !secretOpen.current) field.current?.focus();
  }, [focusRequestId]);

  // Pills: the core parses the draft (`composerReferences`) and answers a moment after the text
  // changes; until it does, the last pills carry over the edit (`rebaseReferences`), so typing never
  // unfolds them.
  const [draftParser] = useState(createDraftReferenceParser);
  const parseDraftReferences = useCallback(
    (draft: string) => draftParser(draft, chat.query('composerReferences', [draft])),
    [chat.query, draftParser],
  );
  const references = useMemo(() => parseDraftReferences(text), [text, parseDraftReferences]);
  const activeImage = useMemo(() => {
    const reference = references.find((entry) => entry.kind === 'image' && caret >= entry.start && caret <= entry.end);
    return reference?.path ?? null;
  }, [references, caret]);

  // ---- the toolbar's overflow fit, measured like desktop's `composer_measurement` ----------------

  const available = useCallback(
    (id: ComposerActionId): boolean => {
      if (document === null) return false;
      // Dictation is the phone's own (Grok through the computer's gxserver), so the core does not gate it.
      if (id === 'dictate') return dictation.available;
      const gate = document.composerActions?.[id];
      if (gate === false) return false;
      if (id === 'terminal') return serves('terminalView');
      return true;
    },
    [dictation.available, document, serves],
  );
  /*
   * CDXC:SessionChat 2026-11-12 DECISION:
   * User: "move the terminal switch and voice agent buttons to the composer". The full chat box's bottom row keeps
   * Terminal View and the voice agent's headset beside More actions, Dictate and Send: neither folds into More actions
   * (they count with Send as fixed width, so the option pills and the other controls fold first); a pane's compact box
   * still carries Terminal View as a More actions row.
   */
  const voicePhase = useVoiceStore((voice) => voice.phase);
  const voiceLit = voiceActive(voicePhase);
  /*
   * CDXC:SessionChat 2026-11-12 DECISION:
   * User picked layout A of the "Phone chat box: a cleaner bottom bar" page (Q2727): the voice agent joins the mic.
   * "Talk to the voice agent" is the first row of the mic's hold menu (`openDictationMenu`), and the headset button
   * shows only while a voice conversation runs (lit, so it opens the running one), or where there is no mic to hold.
   * Supersedes the headset always standing in the bottom row (the decision above it, same day).
   */
  const voiceInMic = !compact && voiceAgent && dictation.available;
  const voiceShown = !compact && (voiceLit || (voiceAgent && !dictation.available));
  const terminalFixed = !compact && available('terminal') && !(document !== null && rowFolded(document, 'terminal'));
  const [footerWidth, setFooterWidth] = useState(0);
  const [optionsWidth, setOptionsWidth] = useState(0);
  const sentMeasurement = useRef('');
  const composerReady = model?.ready === true;
  useEffect(() => {
    // The compact form draws no control and no option pill but the model's: nothing to fit.
    if (compact || document === null || !composerReady || footerWidth <= 0) return;
    const controls = COMPOSER_CONTROLS.filter((control) => available(control.id) && control.id !== 'terminal').map(
      (control) => ({
        id: control.id,
        width: CONTROL_WIDTH,
      }),
    );
    // More actions, Terminal View, the headset and Dictate never fold, so they are part of the fixed width with Send.
    const fixed = 1 + (terminalFixed ? 1 : 0) + (voiceShown ? 1 : 0) + (available('dictate') ? 1 : 0);
    const labels = obj(document.optionLabels);
    const measurements = {
      available: footerWidth,
      options: optionsWidth,
      actions:
        (fixed + controls.length) * (CONTROL_WIDTH + ACTION_GAP) +
        SEND_WIDTH +
        (terminalFixed && document.terminalTail?.readiness === 'notReady' ? COPY_REPORT_PILL_WIDTH + ACTION_GAP : 0),
      footerGap: FOOTER_GAP,
      actionGap: ACTION_GAP,
      clearance: CLEARANCE,
      // The context meter folds into More actions only where Session details does not carry it (`menus.ts`).
      hasOverflowOptions:
        (isTrue(labels, 'showOptions') && obj(document.modelMenu) === null) ||
        (obj(document.contextMeter) !== null && sessionDetailsRingOf(document) === null),
      controls,
    };
    const key = JSON.stringify(measurements);
    if (key === sentMeasurement.current) return;
    sentMeasurement.current = key;
    dispatch({ type: 'measureComposer', measurements });
  }, [compact, document, composerReady, footerWidth, optionsWidth, available, dispatch, terminalFixed, voiceShown]);

  // ---- menus and host actions --------------------------------------------------------------------

  const host = useCallback(
    (action: string, params: JsonRecord = {}) => {
      onHostAction?.(action, params);
    },
    [onHostAction],
  );

  const openAttach = useCallback(async () => {
    // A copied screenshot leads the sheet: iOS's long-press Paste offers none for a text field.
    // iOS 16 and later show Apple's Paste control above the rows (`PasteImageRow`) instead.
    const hasImage = await clipboardHasImage();
    const pasteRows =
      hasImage && !pasteControlAvailable
        ? [
            {
              label: 'Paste image',
              iconPath: 'titlebar/copy.svg',
              command: { type: 'pickAttachments', source: 'clipboard' },
            },
          ]
        : [];
    setMenu({
      kind: 'rows',
      title: 'Attach',
      pasteImage: hasImage && pasteControlAvailable,
      rows: [
        ...pasteRows,
        {
          label: 'Photo library',
          iconPath: 'titlebar/photo.svg',
          command: { type: 'pickAttachments', source: 'library' },
        },
        {
          label: 'Take photo',
          iconPath: 'titlebar/camera.svg',
          command: { type: 'pickAttachments', source: 'camera' },
        },
        { label: 'Files', iconPath: 'titlebar/folder.svg', command: { type: 'pickAttachments', source: 'files' } },
      ],
    });
  }, []);

  const performComposerAction = useCallback(
    (action: string) => {
      switch (action) {
        case 'summaryMode':
          dispatch({ type: 'toggleSummary' });
          return;
        case 'sessionNote':
          dispatch({ type: 'toggleNote' });
          return;
        case 'filesLinks':
          dispatch({ type: 'filesLinks' });
          return;
        case 'attachPath':
          void openAttach();
          return;
        case 'dictate':
          void dictation.toggle();
          return;
        case 'transcribePreviousDictation':
          void dictation.transcribePrevious();
          return;
        case 'voiceSettings':
          // Settings › Voice, on this chat's computer (NativeChatScreen opens it).
          if (chat.machine !== null) host('voiceSettings', { machineId: chat.machine.id });
          return;
        case 'toggleExpanded':
          if (expanded === true) {
            onExpandedChange?.(false);
            return;
          }
          // A box closed to one line by a scroll opens first, then takes the room.
          if (document?.composerCollapsed === true) dispatch({ type: 'composerExpand', editor: true });
          onExpandedChange?.(true);
          field.current?.focus();
          return;
        case 'terminalView':
          // On a Native chat the Terminal View button really switches, after the chat screen's sheet asks.
          host(document?.nonCliMode === true ? 'switchToTerminalBased' : 'terminalView', { source: 'button' });
          return;
        case 'stashPrompt':
          if (model !== null && model.text.trim().length > 0) {
            dispatch({
              type: 'stash',
              text: model.text,
              draftVersion: { draftId: model.draftId, revision: model.revision },
            });
          } else if (serves('stashedPrompts')) {
            host('stashedPrompts');
          }
          return;
        default:
          host(action);
      }
    },
    [
      dictation,
      dispatch,
      document?.composerCollapsed,
      document?.nonCliMode,
      expanded,
      host,
      model,
      onExpandedChange,
      openAttach,
      serves,
    ],
  );

  // A message leaving the box (its draft id changes) collapses an expanded box, as desktop's send closes Maximize.
  const expandedDraftId = useRef(model?.draftId);
  useEffect(() => {
    if (expandedDraftId.current === model?.draftId) return;
    expandedDraftId.current = model?.draftId;
    if (expanded === true) onExpandedChange?.(false);
  }, [expanded, model?.draftId, onExpandedChange]);

  /** A menu row's command, routed the way desktop's `handle_action` routes it. */
  const runCommand = useCallback(
    (command: MenuRow): boolean => {
      if (chat.machine !== null) markDraftTouched(attachSessionKey(chat.machine.id, sessionId));
      const type = str(command, 'type');
      switch (type) {
        case 'pickAttachments': {
          pendingPick.current = str(command, 'source') as AttachSource;
          return false;
        }
        case 'submit':
          if (!holdSend) input?.submit((str(command, 'mode') || 'send') as SubmitMode);
          return false;
        case 'composerHost':
          // Attach swaps this sheet's rows for the Attach rows; closing it would close those too.
          if (str(command, 'action') === 'attachPath') {
            void openAttach();
            return true;
          }
          performComposerAction(str(command, 'action'));
          return false;
        case 'openAccountsSettings':
          if (serves('openAccountsSettings')) host('openAccountsSettings', { accountId: str(command, 'accountId') });
          // Signing in to an account runs the agent's login on the computer, where desktop's Add
          // account leads (Settings > Accounts); the phone says where instead of doing nothing.
          else
            showAlert(
              'Add accounts on your computer',
              'Open Ghostex on your computer and go to Settings > Accounts to sign in to another account.',
            );
          return false;
        case 'insertTrigger':
          // Typed into the draft once the sheet is gone (`closeMenu`), where the keyboard can take the focus.
          pendingTrigger.current = str(command, 'character');
          return false;
        case 'insertSkill':
          if (model !== null) {
            dispatch({
              type: 'insertSkill',
              name: str(command, 'name'),
              text: model.text,
              start: model.selection.start,
              end: model.selection.end,
            });
          }
          return false;
        case 'openSkillsSettings':
          // Skills install on the computer the agents run on, where desktop's row leads
          // (Settings > Integrations > Agent skills); the phone says where, like Add account.
          showAlert(
            'Install skills on your computer',
            'Open Ghostex on your computer and go to Settings > Integrations > Agent skills to install or remove Ghostex skills.',
          );
          return false;
        case 'copyText':
          void Clipboard.setStringAsync(str(command, 'text'));
          return false;
        case 'host':
          host(str(command, 'action'), command);
          return false;
        default:
          dispatch(command as UserAction);
          return false;
      }
    },
    [dispatch, holdSend, host, input, model, openAttach, performComposerAction, serves],
  );

  const launchPick = useCallback(
    (source: AttachSource) => {
      pickAttachments(source)
        .then((files) => chat.attachFiles(files))
        .catch((error: unknown) => {
          setAttachError(error instanceof Error ? error.message : 'The attachment could not be added.');
        });
    },
    [chat],
  );
  // The keyboard's images and Paste's join the draft the way a picked photo does.
  const receiveImages = useCallback(
    (event: { nativeEvent: unknown }) => attachIntakeImages(chat, event.nativeEvent, setAttachError),
    [chat],
  );
  /** The sheet's modal was still sliding away when the host asked for the keyboard (iOS cannot focus the field then). */
  const focusOnDismiss = useRef(false);
  /** An image pasted with the Attach sheet's Paste control joins the draft like a picked photo. */
  const attachPastedImage = useCallback(
    (dataUri: string) => {
      // The chip's caret is placed at once; the keyboard comes when the sheet is gone (`onMenuDismissed`).
      if (Platform.OS === 'ios') focusOnDismiss.current = true;
      setMenu(null);
      savePastedImage(dataUri)
        .then((file) => chat.attachFiles([file]))
        .catch((error: unknown) => {
          setAttachError(error instanceof Error ? error.message : 'The image could not be added.');
        });
    },
    [chat],
  );
  /** A source picked in the sheet, launched once the sheet's modal is gone (iOS). */
  const pickAfterDismiss = useRef<AttachSource | null>(null);
  const typeTrigger = useCallback(() => {
    const character = pendingTrigger.current;
    pendingTrigger.current = null;
    if (character !== null) field.current?.insertAtCaret(character);
  }, []);
  const closeMenu = useCallback(() => {
    setMenu(null);
    const source = pendingPick.current;
    pendingPick.current = null;
    if (source === null) {
      // iOS cannot focus the field while the sheet's modal is still sliding away: `onMenuDismissed` types it then.
      if (Platform.OS !== 'ios') typeTrigger();
      return;
    }
    // iOS cannot present the picker while the sheet's modal is still sliding away; a fixed delay
    // raced that animation and the picker silently never showed. Android's modal is a dialog.
    if (Platform.OS === 'ios') pickAfterDismiss.current = source;
    else launchPick(source);
  }, [launchPick]);
  const onMenuDismissed = useCallback(() => {
    typeTrigger();
    if (focusOnDismiss.current) {
      focusOnDismiss.current = false;
      field.current?.focus();
    }
    const source = pickAfterDismiss.current;
    pickAfterDismiss.current = null;
    if (source !== null) launchPick(source);
  }, [launchPick, typeTrigger]);

  const openPill = useCallback(
    (kind: PillKind) => {
      if (document === null) return;
      if (kind === 'model' && obj(document.modelMenu) !== null) {
        setMenu({ kind: 'model' });
        return;
      }
      if (kind === 'context') {
        setMenu({ kind: 'rows', rows: [{ context: document.contextMeter }] });
        return;
      }
      const rows = optionMenuRows(document, kind);
      // Layout A: the model pill carries the permission mode, so its sheet leads with a Mode submenu.
      if (kind === 'model' && modeInModelPill(document, compact)) {
        const labels = obj(document.optionLabels);
        const glyph = modeLook(str(labels, 'modeValue'), false).mode;
        rows.unshift(
          {
            label: 'Mode',
            detail: str(labels, 'mode'),
            iconPath: glyph === 'advance' ? 'titlebar/mode-advance.svg' : 'titlebar/mode-pause.svg',
            children: optionMenuRows(document, 'mode'),
          },
          { separator: true },
        );
      }
      if (rows.length > 0) setMenu({ kind: 'rows', rows });
    },
    [compact, document],
  );

  const handledAccountsRequest = useRef(openAccountsRequestId);
  useEffect(() => {
    if (openAccountsRequestId === handledAccountsRequest.current) return;
    handledAccountsRequest.current = openAccountsRequestId;
    if (openAccountsRequestId > 0 && document !== null && obj(document.accountPanel) !== null) {
      setMenu({ kind: 'rows', rows: [{ accounts: document.accountPanel }] });
    }
  }, [document, openAccountsRequestId]);

  const handledModelRequest = useRef(openModelRequestId);
  useEffect(() => {
    if (openModelRequestId === handledModelRequest.current) return;
    handledModelRequest.current = openModelRequestId;
    if (openModelRequestId > 0) openPill('model');
  }, [openModelRequestId, openPill]);

  // The chat's computer by name, for the Dictate menu ("Transcribes on MacBook Pro").
  const machineLabel = useMachinesStore((state) => {
    const record = state.machines.find((entry) => entry.id === chat.machine?.id);
    return record === undefined ? null : computerName(record);
  });

  // A long press on the microphone says what transcribes on this computer, and offers Transcribe
  // previous (the newest recording that has no text yet) and the computer's Voice settings.
  const openDictationMenu = useCallback(() => {
    void dictation.previous().then((previous) => {
      const rows = dictationMenuRows({
        voiceInMic,
        voiceLit,
        engine: dictation.engine,
        previous,
        machineLabel: machineLabel ?? 'your computer',
      });
      setMenu({ kind: 'rows', title: 'Dictate', rows });
    });
  }, [dictation, machineLabel, voiceInMic, voiceLit]);

  /**
   * More actions: the `phoneChat` spot of the one session menu (session-menu/layout.ts: the core's, else the bundled
   * copy). Its shared places are the long-press menu's rows for this chat's session, run by the screen (`sessionMenu`).
   */
  const openMore = useCallback(() => {
    if (document === null) return;
    const layout = sessionMenuLayoutNow();
    const machineId = chat.machine?.id ?? null;
    const summary = machineId === null ? null : useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary;
    const session = summary?.sessions.find((entry) => entry.sessionId === sessionId) ?? null;
    const places =
      machineId !== null && session !== null && serves('sessionMenu')
        ? sessionMenuPlaces(sessionMenuInputFromSummary(summary, session), layout)
        : null;
    const target = { machineId: machineId ?? '', sessionId };
    setMenu({
      kind: 'rows',
      rows: moreActionsRows({
        document,
        layout,
        available,
        serves,
        ...(places !== null ? { sessionRows: (id: string) => sessionMenuRows(places(id), target) } : {}),
        draft: model?.text ?? '',
        voiceCallTitle,
        voiceCallGbotName,
        allFolded: compact,
        sleeping,
        delayedSend: delayedSendOnIn(summary),
        ...(onExpandedChange !== undefined ? { expanded: expanded === true } : {}),
      }),
    });
  }, [
    available,
    chat.machine,
    compact,
    document,
    expanded,
    onExpandedChange,
    model,
    serves,
    sessionId,
    sleeping,
    voiceCallGbotName,
    voiceCallTitle,
  ]);

  /**
   * Send held: the `/` `@` `+` pickers, then Queue (Interrupt & Send while the agent works, Compact & Send while
   * the draft has text) once there is a draft. Desktop has both send rows in Send's right-click menu.
   */
  const openSendMenu = useCallback(() => {
    if (document === null || model === null) return;
    setMenu({
      kind: 'rows',
      rows: sendMenuRows({
        ready: model.ready,
        canQueue: document.queue.capabilities.canQueue === true,
        hasDraft:
          model.text.trim().length > 0 || (document.pendingAttachments ?? 0) > 0 || model.failedPictures.length > 0,
        hasText: model.text.trim().length > 0,
        working: document.working === true,
      }),
    });
  }, [document, model]);

  /**
   * The Terminal View button's readiness light reads the agent's screen on hover or focus on
   * desktop (`terminal_ready.rs`), never on a timer. A phone has no hover, so the composer taking
   * focus reads it, at most once per `TAIL_READ_INTERVAL_MS`.
   */
  const lastTailRead = useRef(0);
  const readTerminalTail = useCallback(() => {
    if (!available('terminal') || document?.nonCliMode === true) return;
    const now = Date.now();
    if (now - lastTailRead.current < TAIL_READ_INTERVAL_MS) return;
    lastTailRead.current = now;
    dispatch({ type: 'terminalTailHover' });
  }, [available, dispatch, document?.nonCliMode]);

  const submitDraft = useCallback(
    (requested: SubmitMode, options?: { bypassCompactPrompt?: boolean }): boolean => {
      if (holdSend) return false;
      if (chat.machine !== null) markDraftTouched(attachSessionKey(chat.machine.id, sessionId));
      const from = chat.machine;
      const hasPendingMove =
        pendingTarget !== null &&
        from !== null &&
        (pendingTarget.machineId !== from.id || pendingTarget.projectId !== projectId);
      if (hasPendingMove && from !== null && input !== null) {
        if (pendingMoveInFlight) return false;
        const userPrompt = draftAt.current.text;
        const trimmed = userPrompt.trim();
        const startingCoordinator = draftCoordinatorMode && requested === 'send';
        const skillOnlyStart = startingCoordinator && trimmed.length === 0;
        if (trimmed.length === 0 && !startingCoordinator && (document?.pendingAttachments ?? 0) === 0) {
          return false;
        }
        const to = pendingTarget.machineId === from.id ? from : machineTargetFor(pendingTarget.machineId);
        const agentId = document?.sessionAgentId ?? null;
        if (to === null || agentId === null) return false;
        const fullPrompt = startingCoordinator ? (skillOnlyStart ? FIRST_LINE : `${FIRST_LINE}\n\n${userPrompt}`) : userPrompt;
        const selectedOptions = obj(document?.selectedOptions);
        const agentModel = str(obj(selectedOptions?.model), 'value').trim() || null;
        const agentEffort = str(obj(selectedOptions?.effort), 'value').trim() || null;
        setPendingMoveInFlight(true);
        if (startingCoordinator) setDraftCoordinatorMode(false);
        void (async () => {
          try {
            const committed = await commitPendingDraftSend({
              from,
              fromProjectId: projectId,
              fromSessionId: sessionId,
              agentId,
              to,
              toProjectId: pendingTarget.projectId,
              agentModel,
              agentEffort,
              startingCoordinator,
              skillOnlyStart,
            });
            setPendingTarget(null);
            setPendingTrayAnswer(null);
            setPendingMoveInFlight(false);
            const targetInput = committed.host?.composerInput ?? input;
            if (startingCoordinator) targetInput.replace(fullPrompt);
            targetInput.submit(requested, options);
          } catch (error: unknown) {
            setPendingMoveInFlight(false);
            if (startingCoordinator) setDraftCoordinatorMode(true);
            if (reportMissingAgentError(to.id, error)) return;
            onHostAction?.('toast', {
              message: error instanceof Error ? error.message : String(error),
              level: 'error',
            });
          }
        })();
        return true;
      }
      if (!draftCoordinatorMode || requested !== 'send' || input === null) {
        return input?.submit(requested, options) ?? false;
      }
      if (from === null) return false;
      const userPrompt = draftAt.current.text.trim();
      const skillOnlyStart = userPrompt.length === 0;
      const fullPrompt = skillOnlyStart ? FIRST_LINE : `${FIRST_LINE}\n\n${userPrompt}`;
      setDraftCoordinatorMode(false);
      void (async () => {
        try {
          const answer = await sessionChatRpc(from, 'promoteCoordinator', {
            projectId,
            sessionId,
            forDraft: true,
            skillOnlyStart,
          });
          if (answer.error !== null) {
            setDraftCoordinatorMode(true);
            onHostAction?.('toast', { message: answer.error.message, level: 'error' });
            return;
          }
          input.replace(fullPrompt);
          input.submit('send', options);
        } catch (error: unknown) {
          setDraftCoordinatorMode(true);
          onHostAction?.('toast', {
            message: error instanceof Error ? error.message : String(error),
            level: 'error',
          });
        }
      })();
      return true;
    },
    [
      chat.machine,
      document?.pendingAttachments,
      document?.selectedOptions,
      document?.sessionAgentId,
      draftCoordinatorMode,
      holdSend,
      input,
      onHostAction,
      pendingMoveInFlight,
      pendingTarget,
      projectId,
      sessionId,
    ],
  );

  // ---- layout ------------------------------------------------------------------------------------

  if (state === null || input === null || model === null) return null;
  // The Mode row of the merged model sheet, while the model pill carries the mode (layout A, `OptionPills.tsx`).
  const sheetMode: ModelSheetMode | null =
    document !== null && modeInModelPill(document, compact)
      ? {
          label: str(obj(document.optionLabels), 'mode'),
          look: modeLook(str(obj(document.optionLabels), 'modeValue'), P.light),
          rows: optionMenuRows(document, 'mode'),
        }
      : null;
  const collapsed = motion.collapsed;
  // A picture whose upload failed counts as a draft: Send uploads it again (`RustChatHost.retryFailedPictures`).
  const hasDraft = text.trim().length > 0 || (model?.failedPictures.length ?? 0) > 0;
  const placeholder = phonePlaceholder(document?.composerPlaceholder ?? '', available('dictate'));
  const statusLine = document !== null && statusLineReserved(document);
  const statusLineShown = statusLine && !compact;
  /*
   * CDXC:SessionChat 2026-10-28 DECISION:
   * User: "I should always be able to click on the send for the composer in all cases". With the
   * keyboard open, an attachment and a long draft, the field grew until the footer (model, Send)
   * sat under the keyboard on Android. The field now takes only the room the screen has left
   * (`room`, which keeps a strip of the transcript) after the composer's other rows, the card's
   * attachments and footer and the keyboard's padding, between two lines and `INPUT_MAX_HEIGHT`,
   * and scrolls the rest of the draft inside itself.
   */
  const measured = frame.cardTop >= 0 && frame.content >= 0 && frame.field >= 0;
  // `bottom` is the padding below the composer (the keyboard's lift or the home indicator's inset), which
  // KeyboardLiftedView hands to its child in the very render it changes, so the field is never sized for
  // the previous keyboard.
  // Expanded (More actions' Expand), the field takes all of that room, so the box fills the chat.
  const fillsRoom = expanded === true && room !== undefined && measured && !collapsed;
  const roomForField = (bottom: number): number =>
    room === undefined || !measured
      ? INPUT_MAX_HEIGHT
      : room -
        (frame.cardTop +
          (compact ? 0 : stripHeight) +
          CARD_BORDER +
          (frame.content - frame.field) +
          (statusLineShown ? statusLineHeight : 0) +
          bottom);
  const inputMaxHeightFor = (bottom: number): number =>
    Math.max(INPUT_MIN_HEIGHT, fillsRoom ? roomForField(bottom) : Math.min(INPUT_MAX_HEIGHT, roomForField(bottom)));

  const draftToggles: DraftStripToggles | null =
    document?.worktreeTray != null && document.worktreeTray.status == null
      ? {
          busy: document.worktreeTray.busy === true,
          noProject: noProjectOn,
          canToggleNoProject: homeProjectId !== null || mainHubMachineChoice() !== null,
          onToggleNoProject: toggleNoProject,
          coordinatorOn: draftCoordinatorMode,
          canToggleCoordinator: document.firstMessageCard == null,
          onToggleCoordinator: toggleCoordinator,
        }
      : null;
  const stripNode = renderStrip !== undefined ? renderStrip(draftToggles) : strip;

  return (
    <KeyboardLiftedView style={styles.root} padBelow={false}>
      {(bottom) => (
        <>
          {/* A draft saved elsewhere is offered by the Saved draft pill in the box's pill strip (`cards/SavedDraftPill.tsx`). */}
          {/* A refused operation's error line is the card band's (`ComposerNotReadyCard`), where desktop draws it; drawing it here too showed it twice. */}
          {document !== null ? <NotePanel note={document.note} dispatch={dispatch} /> : null}
          {document !== null ? <CatchUpCard catchUp={document.catchUp} dispatch={dispatch} /> : null}
          {document !== null ? (
            <CompactPromptCard offer={document.compactBeforeSend} composer={input} dispatch={dispatch} />
          ) : null}
          {document !== null ? <FilesLinksCard filesLinks={document.filesLinks} dispatch={dispatch} /> : null}
          {document?.suggestions ? <Suggestions data={document.suggestions} dispatch={dispatch} /> : null}
          {document?.runLocation ? <RunLocationRow row={document.runLocation} dispatch={dispatch} /> : null}
          {attachError !== null ? (
            <DictationCard
              icon="alert-circle"
              hue={toneLook('error', P.light).hue}
              title="Couldn't attach"
              text={attachError}
              onDismiss={() => setAttachError(null)}
              dismissLabel="Dismiss"
            />
          ) : null}
          <DictationBar
            phase={dictation.phase}
            elapsedMs={dictation.phase === 'waiting' ? dictation.waitingMs : dictation.elapsedMs}
            failure={dictation.failure}
            retrying={dictation.retrying}
            onShare={dictation.canShare ? () => void dictation.share() : undefined}
            engine={dictation.engine?.label ?? null}
            fix={dictation.fix}
            problem={unavailableProblem(dictation.unavailable, machineLabel)}
            recordingId={dictation.recordingId}
            notice={dictation.notice}
            failureCode={dictation.failureCode}
            onCancel={() => void dictation.cancel()}
            onRetry={() => void dictation.retry()}
            onFix={() => {
              // Open settings: the computer's Voice settings, where the engine, Install Hex and the keys are.
              if (chat.machine !== null) host('voiceSettings', { machineId: chat.machine.id });
            }}
          />
          <ProjectPickerSheet
            visible={projectChoices !== null}
            choices={projectChoices ?? []}
            onClose={() => setProjectChoices(null)}
            onPick={(choice, machineIndex) => {
              setProjectChoices(null);
              const ownProject = choice.machines.some(
                (machine) => machine.machineId === effectiveMachineId && machine.projectId === effectiveProjectId,
              );
              if (ownProject && machineIndex === choice.selected) return;
              const picked = choice.machines[machineIndex];
              if (picked !== undefined && picked.connected) {
                setPendingTargetHere({
                  repoKey: choice.repoKey,
                  machineId: picked.machineId,
                  projectId: picked.projectId,
                  label: choice.label,
                  isMainHub: choice.repoKey === NO_PROJECT_REPO_KEY || isHomeProject(picked.machineId, picked.projectId),
                });
              }
            }}
          />
          <MachinePickerSheet
            visible={machineChoice !== null}
            machines={machineChoice?.machines ?? []}
            currentMachineId={effectiveMachineId || null}
            onClose={() => setMachineChoice(null)}
            onPick={(picked) => {
              const choice = machineChoice;
              setMachineChoice(null);
              if (choice !== null) {
                setPendingTargetHere({
                  repoKey: choice.repoKey,
                  machineId: picked.machineId,
                  projectId: picked.projectId,
                  label: choice.label,
                  isMainHub: choice.repoKey === NO_PROJECT_REPO_KEY || isHomeProject(picked.machineId, picked.projectId),
                });
              }
            }}
          />
          {document?.worktreeTray ? (
            <WorktreeTray
              tray={
                pendingTarget !== null
                  ? {
                      ...document.worktreeTray,
                      projectName: pendingTarget.label,
                      busy: pendingMoveInFlight,
                      status: null,
                      where: null,
                      detail:
                        !pendingTarget.isMainHub &&
                        pendingTrayAnswer?.projectId === pendingTarget.projectId &&
                        pendingTrayAnswer.currentBranch !== null
                          ? {
                              kind: 'branch',
                              glyph: 'git-branch',
                              label: pendingTrayAnswer.currentBranch,
                              menu: null,
                              placeholder: false,
                            }
                          : null,
                    }
                  : document.worktreeTray
              }
              openRows={(title, rows, search) => setMenu({ kind: 'rows', title, rows, search: search ?? null })}
              runCommand={(command) => void runCommand(command)}
              retry={() => submitDraft('send')}
              projectLabel={projectChipLabel}
              openProjects={() =>
                setProjectChoices(effectiveMachineId.length === 0 ? [] : draftProjectChoices(effectiveMachineId))
              }
              machineLabel={machineChipLabel}
              openMachines={openMachines}
              noProject={noProjectOn}
            />
          ) : null}
          {/*
            CDXC:SessionChat 2026-11-28 DECISION:
            User: "For the mobile app let's make the chat box fill the bottom width and not rounded." The box is a
            square dock across the chat's whole width, flush on the bottom edge (or on the keyboard), with a hairline
            along its top in the box's border colour (the ring's colour while it has the caret). Its background runs
            under the status line and the space below it (the home indicator's or gesture bar's inset, which
            KeyboardLiftedView hands over as `bottom`), so nothing floats. What the box holds is unchanged.
          */}
          <View
            style={[styles.dock, focused ? styles.dockFocused : null, { paddingBottom: bottom }]}
            onLayout={(event: LayoutChangeEvent) => measureFrame('cardTop', event.nativeEvent.layout.y)}
          >
            <View style={styles.card}>
              {/* The chat's pills ride in a strip along the box's top edge, inside its border (`PillsStrip.tsx`); what the box holds under it is unchanged. */}
              {stripNode !== undefined && !compact ? (
                <View
                  onLayout={(event: LayoutChangeEvent) => setStripHeight(Math.round(event.nativeEvent.layout.height))}
                >
                  {stripNode}
                </View>
              ) : null}
              <Animated.View style={[styles.cardInner, motion.cardStyle]}>
                <Pressable
                  accessible={false}
                  onPress={() => {
                    if (requestedCollapsed) dispatch({ type: 'composerExpand', editor: true });
                    field.current?.focus();
                  }}
                  onLayout={(event: LayoutChangeEvent) => {
                    motion.onContentLayout(event);
                    if (!collapsed) measureFrame('content', event.nativeEvent.layout.height);
                  }}
                  style={[styles.cardBody, collapsed ? styles.cardCollapsed : null]}
                >
                  {/* A new coordinator's first message, waiting for Start (`FirstMessageCard.tsx`); desktop draws it above the image tiles too. */}
                  {!collapsed && document !== null ? <FirstMessageCard document={document} dispatch={dispatch} /> : null}
                  {!collapsed && document?.worktreeTray && document.firstMessageCard == null && draftCoordinatorMode ? (
                    <View style={styles.coordinatorDraftCard}>
                      <View style={styles.coordinatorDraftHeader}>
                        <Glyph name="coordinator-crown-points" size={13} color={P.foreground} />
                        <Text style={styles.coordinatorDraftTitle}>Coordinator first message</Text>
                      </View>
                      <Text style={styles.coordinatorDraftLine} selectable>
                        {FIRST_LINE}
                      </Text>
                      <Text style={styles.coordinatorDraftBenefits}>{NEW_ORCHESTRATOR_BENEFITS}</Text>
                    </View>
                  ) : null}
                  {!collapsed && document !== null ? (
                    <AttachmentPreviews
                      references={references}
                      pending={document.pendingAttachments}
                      images={state.images}
                      draft={text}
                      active={activeImage}
                      dispatch={dispatch}
                      waiting={model?.heldSend != null}
                      failed={model?.failedPictures}
                      onDropFailed={chat.dropFailedPicture}
                    />
                  ) : null}
                  {document !== null ? <QueueList document={document} dispatch={dispatch} /> : null}
                  {(() => {
                    const boostHint =
                      !collapsed &&
                      !compact &&
                      document?.boosts?.hint != null &&
                      (Boolean(document.boosts.hint.title?.trim()) || Boolean(document.boosts.hint.text?.trim()))
                        ? document.boosts.hint
                        : null;
                    return (
                      <View
                        style={
                          collapsed
                            ? styles.collapsedRow
                            : boostHint !== null
                              ? styles.editorWithChipRow
                              : null
                        }
                      >
                        <View
                          style={collapsed || boostHint !== null ? styles.grow : null}
                          onLayout={(event: LayoutChangeEvent) => {
                            if (!collapsed) measureFrame('field', event.nativeEvent.layout.height);
                          }}
                        >
                          <ComposerInput
                            ref={field}
                            model={model}
                            input={{
                              ...input,
                              focused: () => {
                                setFocused(true);
                                onFocusChange?.(true);
                                input.focused();
                                readTerminalTail();
                              },
                              blurred: () => {
                                setFocused(false);
                                onFocusChange?.(false);
                                input.blurred();
                              },
                            }}
                            references={references}
                            parsedFor={text}
                            parse={parseDraftReferences}
                            placeholder={placeholder}
                            collapsed={collapsed}
                            maxHeight={inputMaxHeightFor(bottom)}
                            {...(fillsRoom ? { minHeight: inputMaxHeightFor(bottom) } : {})}
                            onTextChange={(next) => {
                              if (next.length > 0 && chat.machine !== null) {
                                markDraftTouched(attachSessionKey(chat.machine.id, sessionId));
                              }
                              setText(next);
                            }}
                            onCaret={setCaret}
                            onImages={(event) => {
                              if (chat.machine !== null) markDraftTouched(attachSessionKey(chat.machine.id, sessionId));
                              receiveImages(event);
                            }}
                          />
                        </View>
                        {boostHint !== null ? <BoostHintChip hint={boostHint} dispatch={dispatch} /> : null}
                        {collapsed ? (
                          // Collapsed, desktop's toolbar keeps More actions beside Send (`render_toolbar`).
                          <ToolbarButton glyph="dots" label="More actions" onPress={openMore} disabled={document === null} />
                        ) : null}
                        {collapsed ? (
                          <SendControl
                            document={document}
                            hasDraft={hasDraft || draftCoordinatorMode}
                            ready={model.ready && !holdSend}
                            submit={submitDraft}
                            dispatch={dispatch}
                            onHold={openSendMenu}
                          />
                        ) : null}
                      </View>
                    );
                  })()}
                  {/* Quiet lines about the box itself, under its text (`BoxNotes.tsx`). */}
                  {!collapsed ? (
                    <SecretSendWarning
                      model={model}
                      cardOpen={secretRequestOpen(document)}
                      keptOnDevice={document?.draftKeptOnDevice === true}
                    />
                  ) : null}
                  {!collapsed && document !== null ? <BoxNotes document={document} /> : null}
                  {!collapsed ? (
                    <Animated.View
                      style={[styles.footer, motion.controlsStyle]}
                      onLayout={(event: LayoutChangeEvent) => setFooterWidth(Math.round(event.nativeEvent.layout.width))}
                    >
                      <View
                        style={[
                          styles.options,
                          { marginLeft: document !== null ? -optionPillsLeadIn(document, compact) : 0 },
                        ]}
                      >
                        {document !== null ? (
                          <OptionPills document={document} onOpen={openPill} modelOnly={compact} />
                        ) : null}
                      </View>
                      <View style={styles.toolbar}>
                        <ToolbarButton
                          glyph="dots"
                          label={
                            document !== null && terminalIssue(document) !== null
                              ? `More actions. Terminal problem: ${terminalIssue(document)}`
                              : 'More actions'
                          }
                          onPress={openMore}
                          disabled={document === null}
                          tint={document !== null && terminalIssue(document) !== null ? NOT_READY_TINT : null}
                        />
                        {document !== null && !compact
                          ? COMPOSER_CONTROLS.filter(
                              (control) =>
                                available(control.id) &&
                                (control.id === 'terminal' ? terminalFixed : !overflowed(document, control.id)),
                            ).map((control) => {
                              const glyph = CONTROL_GLYPHS[control.id];
                              const pressed = control.id === 'note' && document.composerChrome.notePressed;
                              const badge = control.id === 'note' && document.composerChrome.notePresence ? '' : null;
                              // Copy Report sits right before the Terminal View glyph while it reads not ready
                              // (desktop `toolbar.rs`, CDXC:SessionChat 2026-10-25).
                              const report =
                                control.id === 'terminal' && document.terminalTail?.readiness === 'notReady' ? (
                                  <CopyReportPill key="copyReport" onPress={() => dispatch({ type: 'copyReport' })} />
                                ) : null;
                              return [
                                report,
                                <ToolbarButton
                                  key={control.id}
                                  glyph={glyph}
                                  label={control.label}
                                  pressed={pressed}
                                  badge={badge}
                                  tint={control.id === 'terminal' ? terminalReadinessTint(document) : null}
                                  onPress={() => performComposerAction(control.action)}
                                />,
                              ];
                            })
                          : null}
                        {voiceShown ? (
                          <ToolbarButton
                            glyph="headset"
                            label={voiceLit ? 'Voice mode on: open the voice agent' : 'Talk to the voice agent'}
                            tint={voiceLit ? P.accent : null}
                            onPress={() => host('voiceAgent')}
                          />
                        ) : null}
                        {available('dictate') ? (
                          <ToolbarButton
                            glyph={dictation.listening ? 'player-stop' : 'microphone'}
                            label={
                              dictation.listening
                                ? 'Stop dictating'
                                : !dictation.ready
                                  ? `Dictate isn't ready on ${machineLabel ?? 'your computer'}`
                                  : dictation.engine !== null
                                    ? `Dictate · ${dictation.engine.label}`
                                    : 'Dictate'
                            }
                            dimmed={!dictation.ready && !dictation.listening}
                            pressed={dictation.listening}
                            onPress={() => performComposerAction('dictate')}
                            onLongPress={openDictationMenu}
                          />
                        ) : null}
                        <SendControl
                          document={document}
                          hasDraft={hasDraft || draftCoordinatorMode}
                          ready={model.ready && !holdSend}
                          submit={submitDraft}
                          dispatch={dispatch}
                          onHold={openSendMenu}
                        />
                      </View>
                      {document !== null && !compact ? (
                        <View
                          style={styles.measure}
                          pointerEvents="none"
                          onLayout={(event) => setOptionsWidth(Math.round(event.nativeEvent.layout.width))}
                        >
                          <OptionPills
                            document={
                              {
                                ...document,
                                composerOverflow: { overflowed: [], optionsOverflowed: false },
                              } as ChatDocument
                            }
                            onOpen={() => undefined}
                          />
                        </View>
                      ) : null}
                    </Animated.View>
                  ) : null}
                </Pressable>
                {/* Non-interactive mirror of the collapsed `...` + Send slot that cross-fades cleanly
                    during collapse/expand transitions so those controls never pop. */}
                {!collapsed && motion.showCompactOverlay ? (
                  <Animated.View pointerEvents="none" style={[styles.compactOverlay, motion.compactControlsStyle]}>
                    <ToolbarButton glyph="dots" label="More actions" onPress={openMore} disabled={document === null} />
                    <SendControl
                      document={document}
                      hasDraft={hasDraft || draftCoordinatorMode}
                      ready={model.ready && !holdSend}
                      submit={submitDraft}
                      dispatch={dispatch}
                      onHold={openSendMenu}
                    />
                  </Animated.View>
                ) : null}
              </Animated.View>
            </View>
            {statusLineShown && document !== null ? (
              <View
                style={styles.statusLine}
                onLayout={(event: LayoutChangeEvent) => setStatusLineHeight(Math.round(event.nativeEvent.layout.height))}
              >
                <StatusLine document={document} dispatch={dispatch} />
              </View>
            ) : null}
          </View>
          <MenuSheet
            rows={menu?.kind === 'rows' ? menu.rows : null}
            {...(menu?.kind === 'rows' && menu.title !== undefined ? { title: menu.title } : {})}
            onClose={closeMenu}
            onCommand={runCommand}
            onDismissed={onMenuDismissed}
            search={menu?.kind === 'rows' ? (menu.search ?? null) : null}
            {...(menu?.kind === 'rows' && menu.pasteImage === true
              ? { header: <PasteImageRow onImage={attachPastedImage} /> }
              : {})}
          />
          <ModelMenuSheet
            menu={obj(document?.modelMenu)}
            visible={menu?.kind === 'model'}
            ownProvider={str(document?.modelMenuContext, 'provider')}
            onClose={closeMenu}
            dispatch={dispatch}
            mode={sheetMode}
          />
          <ContextEditorSheet editor={obj(document?.contextEditor)} dispatch={dispatch} />
        </>
      )}
    </KeyboardLiftedView>
  );
}

/** Copy Report (gx-chat-core `extras/report.rs`): the report goes to the clipboard, then Send Bug / Feedback opens. */
function CopyReportPill({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy Report"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.reportPill, pressed ? styles.controlPressed : null]}
    >
      <CardGlyph name="copy" size={14} color={NOT_READY_TINT} />
      <Text style={styles.reportPillLabel}>Copy Report</Text>
    </Pressable>
  );
}

function ToolbarButton({
  glyph,
  label,
  onPress,
  onLongPress,
  pressed = false,
  badge = null,
  disabled = false,
  tint = null,
  dimmed = false,
}: {
  glyph: GlyphName;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  pressed?: boolean;
  /** Text badge (the stash count), `''` for a presence dot, null for none. */
  badge?: string | null;
  disabled?: boolean;
  /** A glyph colour that carries meaning (the Terminal View button's readiness light). */
  tint?: string | null;
  /** Greyed but still pressed: Dictate can't transcribe yet, and a press says why. */
  dimmed?: boolean;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: pressed, disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      {...(onLongPress !== undefined ? { onLongPress } : {})}
      style={({ pressed: touching }) => [styles.control, pressed || touching ? styles.controlPressed : null]}
    >
      <View style={dimmed ? styles.dimmed : null}>
        <Glyph name={glyph} size={18} color={tint ?? (pressed ? P.controlPrimary : P.primary)} />
      </View>
      {badge !== null ? (
        <View style={badge.length === 0 ? styles.dot : styles.badge}>
          {badge.length > 0 ? <Text style={styles.badgeText}>{badge}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = themedStyles((P) => ({
  root: { gap: 8, paddingHorizontal: 10, paddingTop: 6, backgroundColor: 'transparent' },
  error: { color: P.error, fontSize: 13, paddingHorizontal: 8 },
  /*
   * The box, square and as wide as the chat: it reaches past the root's side padding (which the cards above it
   * keep), and its background runs under the status line and the bottom inset (`paddingBottom`, set inline).
   */
  dock: {
    marginHorizontal: -10,
    borderTopWidth: CARD_BORDER,
    borderTopColor: P.composerBorder,
    backgroundColor: P.composerBackground,
  },
  dockFocused: { borderTopColor: P.ring },
  card: { overflow: 'hidden' },
  statusLine: { paddingHorizontal: 10, paddingBottom: 4 },
  /** The box's content under the strip; it clips it while its height tweens. */
  cardInner: {
    overflow: 'hidden',
  },
  /** The card's content at its natural height; the card clips it while its height tweens. */
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 6,
  },
  cardCollapsed: { paddingTop: 6, paddingBottom: 6 },
  collapsedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editorWithChipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  compactOverlay: {
    position: 'absolute',
    top: 6,
    right: 14,
    height: CONTROL_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: { flex: 1, minWidth: 0 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: FOOTER_GAP },
  /*
   * CDXC:SessionChat 2026-11-12 DECISION:
   * User, with layout A: "less space left of the model pill so it matches the space right of the send button". The
   * pills keep their pressed-fill padding, and the row reaches that far past the card's 14pt inset
   * (`optionPillsLeadIn`, set inline), so the leading pill's mark starts 14pt from the box's edge, as Send ends 14pt
   * from the other one.
   */
  options: { flexShrink: 1, minWidth: 0, flexDirection: 'row' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: ACTION_GAP, marginLeft: 'auto' },
  control: {
    width: CONTROL_WIDTH,
    height: CONTROL_WIDTH,
    borderRadius: CONTROL_WIDTH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlPressed: { backgroundColor: P.border },
  dimmed: { opacity: 0.38 },
  reportPill: {
    height: CONTROL_WIDTH,
    paddingHorizontal: 10,
    borderRadius: CONTROL_WIDTH / 2,
    borderWidth: 1,
    borderColor: P.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reportPillLabel: { color: NOT_READY_TINT, fontSize: 12 },
  dot: { position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: P.foreground },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    backgroundColor: P.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: P.background, fontSize: 9, lineHeight: 11, fontWeight: '600' },
  measure: { position: 'absolute', left: 0, top: 0, opacity: 0, flexDirection: 'row' },
  coordinatorDraftCard: {
    gap: 5,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.composerBackground,
  },
  coordinatorDraftHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordinatorDraftTitle: { color: P.foreground, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  coordinatorDraftLine: { color: P.primary, fontSize: 13.5, lineHeight: 19 },
  coordinatorDraftBenefits: { color: P.muted, fontSize: 12, lineHeight: 17 },
}));
