/**
 * The native chat composer: everything below the transcript that the user types into or presses.
 *
 * It draws the Rust core's document (`src/chat/rust/document.ts`) and reports gestures with the
 * actions desktop sends (`apps/desktop/src/app/native_chat/composer.rs` and its siblings), so every
 * rule (what Send does, what the queue allows, which suggestions show, what a pill is) stays in
 * `gx-chat-core`. The text itself lives in the host's composer model (`src/chat/rust/composer.ts`).
 *
 * Top to bottom, as desktop's `render_composer` stacks them: the incoming draft offer, the
 * operation error, the session note, the suggestions popup, then the card (image tiles, queue,
 * input, option pills + toolbar + Send), then the status line.
 *
 * In one of the iPhone Duo's pane slots (`chatPlacement`) the card takes the approved panes mockup's compact form,
 * with Dictate kept right before Send: under the field one row of the model pill, More actions, Dictate and Send.
 * The pill strip, the other option pills (options, permission mode, context ring), the toolbar controls, Copy Report
 * and the status line are drawn by the full chat view only; More actions carries the controls and the option
 * settings as it does when they overflow (`moreActionsRows`' `allFolded`).
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import type { UserAction } from '../../rust/actions';
import type { ChatDocument } from '../../rust/document';
import type { SubmitMode } from '../../rust/composer';
import type { RustChat } from '../../rust/useRustChat';
import { AttachmentPreviews } from './AttachmentPreviews';
import { clipboardHasImage, pickAttachments, savePastedImage, type AttachSource } from './attachments';
import { COLLAPSED_INPUT_HEIGHT, ComposerInput, type ComposerInputHandle } from './ComposerInput';
import { ContextEditorSheet } from './ContextEditorSheet';
import { PasteImageRow, pasteControlAvailable } from './PasteImageRow';
import { Glyph, type GlyphName } from './icons';
import { Glyph as CardGlyph } from '../cards/icons';
import { attachIntakeImages } from './imageIntake';
import { isTrue, obj, str, type JsonRecord } from './json';
import {
  COMPOSER_CONTROLS,
  moreActionsRows,
  optionMenuRows,
  overflowed,
  sendMenuRows,
  type ComposerActionId,
  type ComposerControlId,
} from './menus';
import { MenuSheet, type MenuRow } from './MenuSheet';
import { ModelMenuSheet, type ModelSheetMode } from './ModelMenuSheet';
import { NotePanel } from './NotePanel';
import { phonePlaceholder } from './placeholder';
import { CatchUpCard } from '../cards/CatchUpCard';
import { sessionDetailsRingOf } from '../cards/SessionDetailsSheet';
import { FilesLinksCard } from '../cards/FilesLinksCard';
import { OptionPills, modeInModelPill, modeLook, type PillKind } from './OptionPills';
import { RunLocationRow } from './RunLocationRow';
import { ProjectPickerSheet } from './ProjectPickerSheet';
import { draftProjectChoices, moveDraftToProject } from './draftProjectChoices';
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
import { engineStatusLine } from '../../../voice/dictateModel';
import { computerName } from '../../../screens/settings/voiceComputer';
import { KeyboardLiftedView } from './KeyboardLiftedView';
import { useChatPlacement } from '../chatPlacement';
import { useVoiceStore, voiceActive } from '../../../voice/conversation';

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
  /** The session's title, for the More actions row "Voice call about this chat" (shown when `voiceCall` is served). */
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
  /** The session sleeps: More actions' Sleep row reads Wake. */
  sleeping?: boolean;
  /**
   * The chat's computer runs the voice agent: the headset button stands in the bottom row (the host's `voiceAgent`
   * action starts a conversation or opens the running one, which keeps the button lit wherever it was started).
   */
  voiceAgent?: boolean;
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
const CARD_BORDER = 1;
/** The collapsed card before its first collapse is measured: the row (field or Send) inside `cardCollapsed`. */
const COLLAPSED_CARD_ESTIMATE = 6 + Math.max(COLLAPSED_INPUT_HEIGHT, SEND_WIDTH) + 6 + CARD_BORDER * 2;

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

const CONTROL_GLYPHS: Record<ComposerControlId, GlyphName> = {
  note: 'note',
  attach: 'paperclip',
  terminal: 'terminal-2',
};

type OpenMenu = { kind: 'rows'; title?: string; rows: MenuRow[]; pasteImage?: boolean } | { kind: 'model' } | null;

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
  sleeping = false,
  voiceAgent = false,
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
  const moveDraftHere = (machineId: string, toProjectId: string): void => {
    const from = chat.machine;
    const agentId = document?.sessionAgentId ?? null;
    if (from === null || agentId === null) return;
    if (machineId === from.id && toProjectId === projectId) return;
    const to = machineId === from.id ? from : machineTargetFor(machineId);
    if (to === null) return;
    void moveDraftToProject({
      from,
      fromProjectId: projectId,
      fromSessionId: sessionId,
      agentId,
      text: draftAt.current.text,
      to,
      toProjectId,
    }).catch((error: unknown) => {
      onHostAction?.('toast', { message: error instanceof Error ? error.message : String(error), level: 'error' });
    });
  };
  const projectChipLabel = document?.worktreeTray?.projectName ?? null;
  /** The machine chip, beside the project chip while the phone knows more than one computer. */
  const machineChipLabel = ((): string | null => {
    if (projectChipLabel === null) return null;
    const machines = enabledMachines(useMachinesStore.getState());
    const record = machines.length > 1 ? machines.find((entry) => entry.id === chat.machine?.id) : undefined;
    return record === undefined ? null : machineDisplayLabel(record);
  })();
  const [machineChoice, setMachineChoice] = useState<UnifiedProjectChoice | null>(null);
  const openMachines = (): void => {
    const from = chat.machine;
    if (from === null) return;
    const repoKey = repoKeyOfProject(from.id, projectId);
    setMachineChoice(draftProjectChoices(from.id).find((choice) => choice.repoKey === repoKey) ?? null);
  };
  /**
   * What the expanded composer measures around its field: the card's top inside the composer, the
   * card's content at its natural height and the field's own height. The room left for the field is
   * `room` minus everything else (`inputMaxHeight` below).
   */
  const [frame, setFrame] = useState({ cardTop: -1, content: -1, field: -1 });
  /** The pill strip's height at the box's top, which the field gives up too. */
  const [stripHeight, setStripHeight] = useState(0);
  const measureFrame = useCallback((part: 'cardTop' | 'content' | 'field', value: number) => {
    const next = Math.round(value);
    setFrame((now) => (now[part] === next ? now : { ...now, [part]: next }));
  }, []);
  const requestedCollapsed = document?.composerCollapsed === true;
  const motion = useComposerMotion(requestedCollapsed, CARD_BORDER, COLLAPSED_CARD_ESTIMATE);
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

  useEffect(
    () =>
      chat.onViewRequest((request) => {
        if (request.kind === 'focusComposer') field.current?.focus();
      }),
    [chat.onViewRequest],
  );
  const handledFocusRequest = useRef(focusRequestId);
  useEffect(() => {
    if (focusRequestId === handledFocusRequest.current) return;
    handledFocusRequest.current = focusRequestId;
    if (focusRequestId > 0) field.current?.focus();
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
  const terminalFixed = !compact && available('terminal');
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
        (document.terminalTail?.readiness === 'notReady' ? COPY_REPORT_PILL_WIDTH + ACTION_GAP : 0),
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
    [dictation, dispatch, host, model, openAttach, serves],
  );

  /** A menu row's command, routed the way desktop's `handle_action` routes it. */
  const runCommand = useCallback(
    (command: MenuRow): boolean => {
      const type = str(command, 'type');
      switch (type) {
        case 'pickAttachments': {
          pendingPick.current = str(command, 'source') as AttachSource;
          return false;
        }
        case 'submit':
          input?.submit((str(command, 'mode') || 'send') as SubmitMode);
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
            Alert.alert(
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
          Alert.alert(
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
    [dispatch, host, input, model, openAttach, performComposerAction, serves],
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
    (event: { nativeEvent: unknown }) =>
      attachIntakeImages(chat, event.nativeEvent, setAttachError),
    [chat],
  );
  /** An image pasted with the Attach sheet's Paste control joins the draft like a picked photo. */
  const attachPastedImage = useCallback(
    (dataUri: string) => {
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
      const engine = dictation.engine;
      const rows: MenuRow[] = [];
      if (voiceInMic) {
        rows.push({
          label: voiceLit ? 'Open the voice agent' : 'Talk to the voice agent',
          iconPath: 'titlebar/headset.svg',
          command: { type: 'host', action: 'voiceAgent' },
        });
      }
      if (engine !== null) {
        rows.push({
          heading: true,
          label: engine.label,
          description: engineStatusLine(engine, machineLabel ?? 'your computer'),
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
        description: `Dictate's engine and language on ${machineLabel ?? 'this computer'}`,
        iconPath: 'titlebar/settings.svg',
        command: { type: 'composerHost', action: 'voiceSettings' },
      });
      setMenu({ kind: 'rows', title: 'Dictate', rows });
    });
  }, [dictation, machineLabel, voiceInMic, voiceLit]);

  const openMore = useCallback(() => {
    if (document === null) return;
    setMenu({
      kind: 'rows',
      rows: moreActionsRows({
        document,
        available,
        serves,
        draft: model?.text ?? '',
        voiceCallTitle,
        voiceCallGbotName,
        allFolded: compact,
        sleeping,
      }),
    });
  }, [available, compact, document, model, serves, sleeping, voiceCallGbotName, voiceCallTitle]);

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
        hasDraft: model.text.trim().length > 0 || (document.pendingAttachments ?? 0) > 0,
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
    if (!available('terminal')) return;
    const now = Date.now();
    if (now - lastTailRead.current < TAIL_READ_INTERVAL_MS) return;
    lastTailRead.current = now;
    dispatch({ type: 'terminalTailHover' });
  }, [available, dispatch]);

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
  const hasDraft = text.trim().length > 0;
  const placeholder = phonePlaceholder(document?.composerPlaceholder ?? '', available('dictate'));
  const statusLine = document !== null && statusLineReserved(document);
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
  const inputMaxHeightFor = (bottom: number): number =>
    room === undefined || !measured
      ? INPUT_MAX_HEIGHT
      : Math.max(
          INPUT_MIN_HEIGHT,
          Math.min(
            INPUT_MAX_HEIGHT,
            room -
              (frame.cardTop +
                (compact ? 0 : stripHeight) +
                CARD_BORDER * 2 +
                (frame.content - frame.field) +
                bottom),
          ),
        );

  return (
    <KeyboardLiftedView style={styles.root}>
      {(bottom) => (
        <>
          {/* A draft saved elsewhere is offered by the Saved draft pill in the box's pill strip (`cards/SavedDraftPill.tsx`). */}
          {/* A refused operation's error line is the card band's (`ComposerNotReadyCard`), where desktop draws it; drawing it here too showed it twice. */}
          {document !== null ? <NotePanel note={document.note} dispatch={dispatch} /> : null}
          {document !== null ? <CatchUpCard catchUp={document.catchUp} dispatch={dispatch} /> : null}
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
              // The draft's own project, taken on its marked computer: nothing moves (the desktop's rule).
              const ownProject = choice.machines.some(
                (machine) => machine.machineId === chat.machine?.id && machine.projectId === projectId,
              );
              if (ownProject && machineIndex === choice.selected) return;
              const picked = choice.machines[machineIndex];
              if (picked !== undefined && picked.connected) moveDraftHere(picked.machineId, picked.projectId);
            }}
          />
          <MachinePickerSheet
            visible={machineChoice !== null}
            machines={machineChoice?.machines ?? []}
            currentMachineId={chat.machine?.id ?? null}
            onClose={() => setMachineChoice(null)}
            onPick={(picked) => {
              const choice = machineChoice;
              setMachineChoice(null);
              if (choice !== null) moveDraftHere(picked.machineId, picked.projectId);
            }}
          />
          {document?.worktreeTray ? (
            <WorktreeTray
              tray={document.worktreeTray}
              openRows={(title, rows) => setMenu({ kind: 'rows', title, rows })}
              retry={() => input?.submit('send')}
              projectLabel={projectChipLabel}
              openProjects={() => setProjectChoices(chat.machine === null ? [] : draftProjectChoices(chat.machine.id))}
              machineLabel={machineChipLabel}
              openMachines={openMachines}
            />
          ) : null}
          <View
            style={[styles.card, focused ? styles.cardFocused : null]}
            onLayout={(event: LayoutChangeEvent) => measureFrame('cardTop', event.nativeEvent.layout.y)}
          >
            {/* The chat's pills ride in a strip along the box's top edge, inside its border (`PillsStrip.tsx`); what the box holds under it is unchanged. */}
            {strip !== undefined && !compact ? (
              <View
                onLayout={(event: LayoutChangeEvent) => setStripHeight(Math.round(event.nativeEvent.layout.height))}
              >
                {strip}
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
                {!collapsed && document !== null ? (
                  <AttachmentPreviews
                    references={references}
                    pending={document.pendingAttachments}
                    images={state.images}
                    draft={text}
                    active={activeImage}
                    dispatch={dispatch}
                    waiting={model?.heldSend != null}
                  />
                ) : null}
                {document !== null ? <QueueList document={document} dispatch={dispatch} /> : null}
                <View style={collapsed ? styles.collapsedRow : null}>
                  <View
                    style={collapsed ? styles.grow : null}
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
                      onTextChange={setText}
                      onCaret={setCaret}
                      onImages={receiveImages}
                    />
                  </View>
                  {collapsed ? (
                    // Collapsed, desktop's toolbar keeps More actions beside Send (`render_toolbar`).
                    <ToolbarButton glyph="dots" label="More actions" onPress={openMore} disabled={document === null} />
                  ) : null}
                  {collapsed ? (
                    <SendControl
                      document={document}
                      hasDraft={hasDraft}
                      ready={model.ready}
                      submit={input.submit}
                      dispatch={dispatch}
                      onHold={openSendMenu}
                    />
                  ) : null}
                </View>
                {!collapsed ? (
                  <Animated.View
                    style={[styles.footer, motion.controlsStyle]}
                    onLayout={(event: LayoutChangeEvent) => setFooterWidth(Math.round(event.nativeEvent.layout.width))}
                  >
                    <View style={styles.options}>
                      {document !== null ? (
                        <OptionPills document={document} onOpen={openPill} modelOnly={compact} />
                      ) : null}
                    </View>
                    <View style={styles.toolbar}>
                      <ToolbarButton
                        glyph="dots"
                        label="More actions"
                        onPress={openMore}
                        disabled={document === null}
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
                                ? "Dictate isn't ready on this computer"
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
                        hasDraft={hasDraft}
                        ready={model.ready}
                        submit={input.submit}
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
            </Animated.View>
          </View>
          {statusLine && document !== null && !compact ? <StatusLine document={document} dispatch={dispatch} /> : null}
          <MenuSheet
            rows={menu?.kind === 'rows' ? menu.rows : null}
            {...(menu?.kind === 'rows' && menu.title !== undefined ? { title: menu.title } : {})}
            onClose={closeMenu}
            onCommand={runCommand}
            onDismissed={onMenuDismissed}
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
  card: {
    borderRadius: 22,
    borderWidth: CARD_BORDER,
    borderColor: P.composerBorder,
    backgroundColor: P.composerBackground,
    overflow: 'hidden',
  },
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
  cardFocused: {
    borderColor: P.ring,
    shadowColor: P.ring,
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  cardCollapsed: { paddingTop: 6, paddingBottom: 6 },
  collapsedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: FOOTER_GAP },
  /*
   * CDXC:SessionChat 2026-11-12 DECISION:
   * User, with layout A: "less space left of the model pill so it matches the space right of the send button". The
   * pills keep their 10pt pressed-fill padding, and the row reaches that far past the card's 14pt inset, so the model's
   * mark starts 14pt from the box's edge, as Send ends 14pt from the other one.
   */
  options: { flexShrink: 1, minWidth: 0, flexDirection: 'row', marginLeft: -10 },
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
}));
