/**
 * The terminal screen's pane controller, beside the pane state of `usePaneHost`: what a touch in a pane, a pick in the
 * chooser (also its Close row and its new terminal), a row of the agents or attention list pane and the header's Panes
 * button do, the keyboard following the active pane (to a terminal or to the composer of a chat in a pane; a touch that
 * moves the focus from one session pane, terminal or chat, to the other lowers it instead while the command pad is
 * closed), Back from a
 * question opened in the attention list pane, and the active pane's content opening full screen when the Duo folds.
 * `paneLayoutInput` places the two panes in the terminal area from the keyboard, the text editor and the fold.
 * `TerminalScreen` calls the hook once its keyboard and editor state are known, and holds the question opened from the
 * attention list pane (`PaneQuestion`): the panes are offered only while none stands.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Keyboard, TextInput, type LayoutRectangle } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { GhostexNative } from '../../modules/ghostex-native/src';
import type { FoldDivision } from '../../modules/ghostex-native/src/GhostexNative.types';
import { sessionDeepLink } from '../app/deepLinkHandler';
import type * as DeepLinksModule from '../app/deepLinks';
import { createSessionCommand } from '../commands/ghostexCli';
import type { LaptopFold } from '../components/common/verticalBar/layout';
import { createdSessionId, runGhostexCli } from '../components/sessions/cli';
import { laptopEditorInset, laptopObstruction } from '../components/terminal/laptopMode';
import { TEXT_EDITOR_HEIGHT } from '../components/terminal/TerminalTextEditor';
import type { GhostexSession } from '../contract/mobileSummary';
import { PanesCopy, ProgressCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import type { RootStackParamList } from '../navigation/types';
import type { OpenSessionTarget } from '../notifications/AttentionList';
import { machineRecordFor, machineTargetFor } from '../screens/terminal-screen/session-lookups';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { attachSessionKey, useTerminalStore, type TerminalTab } from '../terminal/sessions';
import { PANE_FOLD_CLEARANCE, paneGeometry, type PaneGeometryInput, type PaneIndex } from './geometry';
import type { PaneArrangement } from './layout';
import { openPaneFullScreen } from './openFullScreen';
import type { PaneContent, PaneDisplay } from './resolve';
import { usePaneStore } from './store';
import type { PaneHost } from './usePaneHost';
import { showAlert } from '../components/common/dialog/alert';

type TerminalNavigation = NativeStackScreenProps<RootStackParamList, 'Terminal'>['navigation'];
type TwoPanes = Extract<PaneDisplay, { kind: 'panes' }>;

/**
 * Where the stack's full-width swipe back may begin: from `start` to `end` points across the screen. A start past the
 * end leaves no point, so the swipe does not begin anywhere (used while the swipe is off, `swipeBackOff`).
 */
const NO_SWIPE_BACK_START = { start: 1, end: 0 } as const;

/**
 * A question opened from the attention list pane: its session's chat view stands full screen while the panes wait
 * and Back returns to `returnSessionKey`, the session that was beside the list.
 */
export type PaneQuestion = { chatSessionKey: string; returnSessionKey: string };

export type TerminalPanesInput = {
  /** The pane state (`usePaneHost`). */
  panes: PaneHost;
  navigation: TerminalNavigation;
  isFocused: boolean;
  /** The window has pane slots and the selected tab is an agent session, no question standing (`usePaneHost`'s). */
  panesOffered: boolean;
  /** The question opened from the attention list pane, held by the screen, and its setter. */
  paneQuestion: PaneQuestion | null;
  setPaneQuestion: (question: PaneQuestion | null) => void;
  /** The window has pane slots (the fold's divisions), offered or not. */
  hasPaneSlots: boolean;
  tabs: readonly TerminalTab[];
  selectedSessionKey: string | null;
  /** The computer of the selected tab. */
  activeMachineId: string | null;
  /** The selected session shows its chat view (with two panes: in its pane). */
  chatModeActive: boolean;
  /** The terminal on screen with one pane. */
  mountedTerminalSessionKey: string | null;
  /** Gives the keyboard to the composer of the chat in a pane (`usePaneHost`'s `chatSessionKey`). */
  focusComposer: () => void;
  keyboardVisible: boolean;
  /** The text editor is open: it keeps the keyboard. */
  editorShown: boolean;
  dismissKeyboard: () => void;
  /** The screen's way back to Sessions. */
  showSessions: () => void;
  /** The screen's progress overlay (a new terminal being created), or null to hide it. */
  setProgress: (progress: string | null) => void;
  /**
   * A finger is on the command pad's toggle (`CommandPad`'s `onHold`): the stack's swipe back does not start
   * meanwhile, not even for that finger's own touch.
   */
  padHeld: boolean;
  /**
   * The command pad is open over the active terminal. A touch that moves the focus to the other pane takes the value
   * of the pane it starts from: while the pad is open there the keyboard keeps its state.
   */
  padOpen: boolean;
  /** A touch in a pane selected this session: the screen's startup keyboard is not for it (`useKeyboardEntry`). */
  touchSelected: (sessionKey: string) => void;
};

export type TerminalPanes = {
  /** The screen's Back (button and side bar entry): to the panes after a question opened from the attention list. */
  goBack: () => void;
  /** A touch in a pane. */
  activatePane: (slot: PaneIndex) => void;
  /** A session picked in the chooser or the agents pane, on the selected tab's computer. */
  pickPaneSession: (session: GhostexSession) => void;
  /** A row opened in the attention list pane. */
  openAttentionTarget: (target: OpenSessionTarget) => void;
  /** The header's Panes button. */
  togglePanes: () => void;
  /** The Panes button's label (header and "More options"). */
  panesLabel: string;
  /** The chooser's Close row: as its close button. */
  closeChooser: () => void;
  /** The chooser's new terminal in the project of the session beside it, opened in the chooser's pane. */
  newPaneTerminal: (beside: GhostexSession) => void;
  showsTwoPanes: boolean;
  /** The slot of the chooser, or null. */
  chooserSlot: PaneIndex | null;
  /** The slot of the selected session's pane (else the active one): the queued prompts stand there. */
  selectedPaneSlot: PaneIndex;
};

export function useTerminalPanes({
  panes,
  navigation,
  isFocused,
  panesOffered,
  paneQuestion,
  setPaneQuestion,
  hasPaneSlots,
  tabs,
  selectedSessionKey,
  activeMachineId,
  chatModeActive,
  mountedTerminalSessionKey,
  keyboardVisible,
  focusComposer,
  editorShown,
  dismissKeyboard,
  showSessions,
  setProgress,
  padHeld,
  padOpen,
  touchSelected,
}: TerminalPanesInput): TerminalPanes {
  const twoPanes: TwoPanes | null = panes.display.kind === 'panes' ? panes.display : null;

  // A question opened from the attention list pane (`PaneQuestion`): the screen's Back (button and side bar entry) goes
  // back to the panes instead of to Sessions: the session that was beside the list is selected again, or, when the
  // question was that session's, it shows its terminal again, so the stored layout is there as it was. Over as soon as
  // that chat view is left another way (its terminal view, another session); every other way into a chat (the
  // Notifications screen, a notification tap) keeps Back to Sessions.
  useEffect(() => {
    if (paneQuestion !== null && (selectedSessionKey !== paneQuestion.chatSessionKey || !chatModeActive)) {
      setPaneQuestion(null);
    }
  }, [paneQuestion, selectedSessionKey, chatModeActive, setPaneQuestion]);
  // The stack's swipe back would leave for Sessions past the waiting panes, so it is not offered while such a chat
  // view stands: Back is the way back there. Turned off rather than caught (`usePreventRemove`), whose iOS path lets
  // the native pop begin, cancels it and puts the screen back into the native stack. A finger on the screen's pad
  // toggle turns it off as well (`padHeld`), so neither the hold nor the drag is taken for it. One writer for both,
  // with both of the stack's options: `gestureEnabled` for touches that begin meanwhile, and an empty
  // `gestureResponseDistance` for the touch already on the toggle, which the stack reads only as the swipe is about to
  // begin. The swipe is off while a finger is on the toggle or such a question stands, so letting the pad go during
  // the question keeps it off; once neither holds, the screen keeps the stack's own swipe.
  const swipeBackOff = padHeld || paneQuestion !== null;
  useLayoutEffect(() => {
    if (!swipeBackOff) return;
    navigation.setOptions({ gestureEnabled: false, gestureResponseDistance: NO_SWIPE_BACK_START });
    return () => navigation.setOptions({ gestureEnabled: undefined, gestureResponseDistance: undefined });
  }, [navigation, swipeBackOff]);
  const goBack = useCallback((): void => {
    const question = paneQuestion;
    setPaneQuestion(null);
    const store = useTerminalStore.getState();
    if (
      question === null ||
      store.selectedSessionKey !== question.chatSessionKey ||
      !store.tabs.some((tab) => tab.sessionKey === question.returnSessionKey)
    ) {
      showSessions();
      return;
    }
    dismissKeyboard();
    if (question.returnSessionKey === question.chatSessionKey) {
      store.setSessionViewMode(question.chatSessionKey, 'terminal');
    } else {
      store.selectTab(question.returnSessionKey);
    }
  }, [paneQuestion, dismissKeyboard, showSessions]);

  // A touch in a pane makes it the active one (the pane tapped last): a session pane's session is selected where it
  // stands, not scrolled, and its attention acknowledged as a tap on its tab does; a pane without a terminal only
  // becomes the active one. The keyboard follows below; a touch that moved the focus is told apart there
  // (`paneTouch`) from every other way the active pane changes, with the pad's state in the pane it started from (the
  // pad stands over a terminal only, so a chat pane made active turns it off before the keyboard is judged).
  const paneTouch = useRef<{ padOpen: boolean } | null>(null);
  const activatePane = useCallback(
    (slot: PaneIndex): void => {
      const content = twoPanes?.slots[slot];
      const store = useTerminalStore.getState();
      if (content === undefined || content.kind === 'chooser') return;
      if (slot !== twoPanes?.active) paneTouch.current = { padOpen };
      usePaneStore.getState().setActiveSlot(slot);
      if (content.kind !== 'session' || content.sessionKey === store.selectedSessionKey) return;
      const tab = store.tabs.find((entry) => entry.sessionKey === content.sessionKey);
      if (tab?.ghostexSessionId !== undefined) acknowledgeSessionAttention(tab.machineId, tab.ghostexSessionId);
      touchSelected(content.sessionKey);
      store.selectTab(content.sessionKey, { scrollToBottom: false });
    },
    [twoPanes, padOpen, touchSelected],
  );

  // The keyboard follows the active pane. However it changes (a touch in a pane, the tab strip, a link or a
  // notification, a pick in the chooser, the selected tab or the active pane closing, which leaves the other terminal
  // alone on screen), while the keyboard is up the new active terminal takes it, once that terminal is open, so typing
  // never goes to the other pane. The text editor keeps the keyboard while it is open, and a keyboard the person
  // lowered stays down. With one pane a change of tab moves no keyboard, as before. A pane without a terminal
  // becoming the active one takes the keyboard from the terminal: typing goes to the active pane, into a field of
  // its own once one is tapped. From such a pane the keyboard comes back the same way: up in one of its fields, it
  // goes to the terminal that becomes active (a touch in the session pane, the tab strip, a pick in the chooser), or
  // to the session left alone on screen when either pane closes. A session pane showing its chat view (`chatSessionKey`)
  // is such a pane with its composer as its field: becoming the active pane while the keyboard is up, the composer
  // takes it; left for a pane without a terminal, the keyboard goes down. A pane turned between its terminal and its
  // chat view stays the same pane: the keyboard does not follow (the view button lowers it, as with one pane).
  // A hardware keyboard follows the same way, although no software keyboard then needs to cover the app (no keyboard
  // frame arrives): whatever holds its typing (a text field of the app, which React Native's focus registry names, or,
  // as the native side answers (`keyboardInputHeld`), a terminal or a field of a web page) hands it on. A keyboard the
  // person lowered let its holder go, so nothing comes up. An answer that arrives after the active pane, the text
  // editor or the keyboard changed, or after a newer question, is stale and moves nothing.
  //
  // CDXC:Terminal 2026-11-21 DECISION:
  // User: a touch on a terminal never brings the keyboard up. A touch that moves the focus from one session pane to
  // the other (a terminal or a chat pane, either way) while the keyboard is up and the command pad is closed moves the
  // focus and lowers the keyboard, instead of the keyboard following to the terminal or the chat's composer. While the
  // pad is open over the terminal the touch starts from, the keyboard keeps its state: up, it follows to the newly
  // active terminal or composer as above; down, it stays down. A hardware keyboard's typing follows as above (no
  // software keyboard is up to lower), and the text editor keeps the keyboard while it is open. Every other way the
  // active pane changes, and a touch into or out of a pane without a session, keeps the rules above.
  const chatSessionKey = panes.chatSessionKey;
  const activePaneContent = twoPanes === null || !isFocused ? null : twoPanes.slots[twoPanes.active];
  const activeIsChat = activePaneContent?.kind === 'session' && activePaneContent.sessionKey === chatSessionKey;
  const activePaneSessionKey =
    activePaneContent?.kind === 'session' && !activeIsChat ? activePaneContent.sessionKey : null;
  const otherPaneActive = activePaneContent !== null && (activePaneContent.kind !== 'session' || activeIsChat);
  // The active pane by what it holds: a session's pane stays the same pane whether it shows its terminal or its chat.
  const activePane =
    activePaneContent === null
      ? null
      : activePaneContent.kind === 'session'
        ? activePaneContent.sessionKey
        : activePaneContent.kind;
  // The terminal typing goes to: the active pane's, or with one pane the terminal on screen; and the terminal beside
  // it: the other session pane's, or beside a pane without a terminal the session pane's.
  const typingInPanes = twoPanes !== null;
  const typingSessionKey = typingInPanes ? activePaneSessionKey : mountedTerminalSessionKey;
  const besideContent = otherPaneActive
    ? twoPanes?.slots.find((content) => content.kind === 'session' && content.sessionKey !== chatSessionKey)
    : undefined;
  const besideSessionKey = !typingInPanes
    ? null
    : besideContent?.kind === 'session'
      ? besideContent.sessionKey
      : panes.paneSessionKey === chatSessionKey
        ? null
        : panes.paneSessionKey;
  const typingTerminalOpen = tabs.some((tab) => tab.sessionKey === typingSessionKey && tab.state === 'open');
  const lastTyping = useRef<{
    sessionKey: string | null;
    other: boolean;
    chat: boolean;
    pane: string | null;
    inPanes: boolean;
    beside: string | null;
    editor: boolean;
    visible: boolean;
  }>({
    sessionKey: null,
    other: false,
    chat: false,
    pane: null,
    inPanes: false,
    beside: null,
    editor: false,
    visible: false,
  });
  // The terminal that takes the keyboard once it is open.
  const keyboardFollows = useRef<string | null>(null);
  // The keyboard question last asked of the native side; a later one, or a change of the situation, supersedes it.
  const keyboardRequest = useRef(0);
  useEffect(() => {
    const previous = lastTyping.current;
    lastTyping.current = {
      sessionKey: typingSessionKey,
      other: otherPaneActive,
      chat: activeIsChat,
      pane: activePane,
      inPanes: typingInPanes,
      beside: besideSessionKey,
      editor: editorShown,
      visible: keyboardVisible,
    };
    const paneChanged = activePane !== previous.pane || typingInPanes !== previous.inPanes;
    // A touch moved the focus (`activatePane`); it counts for this change only.
    const touch = paneChanged ? paneTouch.current : null;
    paneTouch.current = null;
    if (paneChanged || editorShown !== previous.editor || keyboardVisible !== previous.visible) {
      keyboardRequest.current += 1;
    }
    // A touch that moves the focus between the two session panes (terminal or chat) with the software keyboard up and
    // the pad closed where the touch started: the keyboard goes down instead of following.
    const touchLowers =
      touch !== null &&
      !touch.padOpen &&
      typingInPanes &&
      previous.inPanes &&
      keyboardVisible &&
      !editorShown &&
      (previous.sessionKey !== null || previous.chat) &&
      (typingSessionKey !== null || activeIsChat);
    if (typingSessionKey !== previous.sessionKey || typingInPanes !== previous.inPanes) {
      // From one pane to the other, or to the pane left alone on screen when the active one closed; from a browser,
      // files or Git changes pane or a chat the same way, except when the Duo folds (its content then opens full
      // screen). Not a pane turned to its terminal: it stays the active pane.
      const fromPane =
        paneChanged && (previous.sessionKey !== null || (previous.other && (typingInPanes || panesOffered)));
      const follows =
        fromPane &&
        typingSessionKey !== null &&
        (typingInPanes ? previous.inPanes : typingSessionKey === previous.beside);
      keyboardFollows.current = follows && !touchLowers ? typingSessionKey : null;
    }
    // A move of the keyboard: at once while it is on screen or a text field of the app holds its input; otherwise once
    // the native side answers that something holds a hardware keyboard's typing, unless that answer is stale.
    const fieldHolds = TextInput.State.currentlyFocusedInput() != null;
    const whileTyping = (move: () => void): void => {
      if (keyboardVisible || fieldHolds) {
        move();
        return;
      }
      keyboardRequest.current += 1;
      const request = keyboardRequest.current;
      void GhostexNative.keyboardInputHeld()
        .then((held) => {
          if (held && keyboardRequest.current === request) move();
        })
        .catch(() => undefined);
    };
    if (touchLowers) {
      // The terminal lets the keyboard go, or the chat's composer does.
      const from = previous.sessionKey;
      if (from !== null) void GhostexNative.blurTerminal(from).catch(() => undefined);
      else Keyboard.dismiss();
    } else if (activeIsChat && paneChanged && typingInPanes && previous.inPanes) {
      // To the chat in a pane: its composer takes the keyboard from the terminal or the field it was in.
      whileTyping(focusComposer);
    } else if (otherPaneActive && previous.inPanes && previous.sessionKey !== null) {
      // From a terminal pane to a pane without a terminal: the terminal lets the keyboard go.
      const from = previous.sessionKey;
      whileTyping(() => void GhostexNative.blurTerminal(from).catch(() => undefined));
    } else if (otherPaneActive && paneChanged && previous.chat && (keyboardVisible || fieldHolds)) {
      // From the chat's composer to a pane without a terminal: the keyboard goes down until one of its fields is tapped.
      Keyboard.dismiss();
    }
    const sessionKey = keyboardFollows.current;
    if (sessionKey === null) return;
    // The text editor keeps the keyboard.
    if (editorShown) {
      keyboardFollows.current = null;
      return;
    }
    if (!typingTerminalOpen) return;
    keyboardFollows.current = null;
    whileTyping(() => void GhostexNative.focusTerminal(sessionKey).catch(() => undefined));
  }, [
    typingSessionKey,
    typingInPanes,
    besideSessionKey,
    typingTerminalOpen,
    keyboardVisible,
    editorShown,
    otherPaneActive,
    activeIsChat,
    activePane,
    focusComposer,
    panesOffered,
  ]);

  // A session opened from a pane goes into the session pane as its terminal (the approved mockup): the chooser's pick
  // beside the session on screen, a session of the agents pane or a row of the attention list beside them. Only the
  // pane shows the terminal; the session's saved view stays. Any computer's: the attention list
  // spans them all.
  const openPaneSession = useCallback((machineId: string, sessionId: string): void => {
    const machine = machineTargetFor(machineId);
    if (machine === null) return;
    const store = useTerminalStore.getState();
    const sessionKey = attachSessionKey(machine.id, sessionId);
    usePaneStore.getState().setPickedSession(sessionKey);
    // The session on screen stays beside a pick: it is the pane's before the pick takes the selection, so making room
    // for the pick at the warm-terminal limit never closes it.
    if (store.selectedSessionKey !== sessionKey) store.setPaneSessionKey(store.selectedSessionKey);
    const record = useInventoryStore
      .getState()
      .inventoriesByMachineId[machine.id]?.summary?.sessions.find((entry) => entry.sessionId === sessionId);
    void store
      .attachSession(machine, {
        sessionId,
        ...(record !== undefined && record.projectId.length > 0 ? { projectId: record.projectId } : {}),
        ...(record !== undefined && record.displayTitle.length > 0 ? { title: record.displayTitle } : {}),
      })
      .catch(() => {
        // The pane shows the failure with Retry (`TerminalStateOverlay`); a pick never selected is no pick any more.
        if (useTerminalStore.getState().selectedSessionKey !== sessionKey)
          usePaneStore.getState().setPickedSession(null);
      });
  }, []);
  const pickPaneSession = useCallback(
    (session: GhostexSession): void => {
      if (activeMachineId !== null) openPaneSession(activeMachineId, session.sessionId);
    },
    [activeMachineId, openPaneSession],
  );
  // A row of the attention list pane: its session beside it, a question at its question card in the chat view, full
  // screen, as the Notifications screen opens it: the panes wait. Back there (`goBack`) or its
  // terminal view brings the layout back.
  const openAttentionTarget = useCallback(
    (target: OpenSessionTarget): void => {
      if (target.question) {
        // The app's link module (with its navigation container) loads on the first question opened here, as the
        // browser pane's module does: the terminal screen loads without it, as before.
        const { openDeepLink } = require('../app/deepLinks') as typeof DeepLinksModule;
        const returnSessionKey = useTerminalStore.getState().selectedSessionKey;
        openDeepLink(sessionDeepLink({ machineId: target.machineId, sessionId: target.sessionId, view: 'question' }));
        // The chat view came at once (the session is in the computer's list): Back goes back to the panes.
        const store = useTerminalStore.getState();
        const chatSessionKey = attachSessionKey(target.machineId, target.sessionId);
        if (
          returnSessionKey !== null &&
          store.selectedSessionKey === chatSessionKey &&
          store.chatModeArmed(chatSessionKey)
        ) {
          setPaneQuestion({ chatSessionKey, returnSessionKey });
        }
        return;
      }
      openPaneSession(target.machineId, target.sessionId);
    },
    [openPaneSession],
  );

  // A new terminal in the project of the session beside the chooser (the Sessions screen's New terminal): created on
  // the computer, then opened in the chooser's pane as a pick is (`openPaneSession`), never full screen.
  const newPaneTerminal = useCallback(
    (beside: GhostexSession): void => {
      const machine = activeMachineId === null ? null : machineRecordFor(activeMachineId);
      if (machine === null) return;
      setProgress(ProgressCopy.creatingTerminal(beside.projectName));
      void (async () => {
        try {
          const result = await runGhostexCli(machine, createSessionCommand({ projectId: beside.projectId }));
          await useInventoryStore.getState().refreshMachine(machine);
          setProgress(null);
          const sessionId = createdSessionId(result);
          if (sessionId !== null) openPaneSession(machine.id, sessionId);
        } catch (error) {
          setProgress(null);
          showAlert(PanesCopy.newTerminalFailed, error instanceof Error ? error.message : String(error), [
            { text: 'OK' },
          ]);
        }
      })();
    },
    [activeMachineId, openPaneSession, setProgress],
  );

  // The slot of the chooser.
  const chooserSlot =
    twoPanes === null ? null : (([0, 1] as const).find((slot) => twoPanes.slots[slot].kind === 'chooser') ?? null);
  const { openPanes, closeSlot: closePaneSlot } = panes;
  // The chooser's Close row: as its close button.
  const closeChooser = useCallback((): void => {
    if (chooserSlot !== null) closePaneSlot(chooserSlot);
  }, [chooserSlot, closePaneSlot]);

  // The header's Panes button: the pane types and divider stored for the window's shape, a stored session's slot
  // taking the selected session or the chooser, else the chooser in a second slot; with two panes the chooser closed
  // where one is on screen (in either slot), else the second pane.
  const showsTwoPanes = twoPanes !== null;
  const togglePanes = useCallback(
    (): void => (showsTwoPanes ? closePaneSlot(chooserSlot ?? 1) : openPanes()),
    [showsTwoPanes, chooserSlot, closePaneSlot, openPanes],
  );
  // What the button and its "More options" entry say: what a press does now.
  const panesLabel = !showsTwoPanes
    ? PanesCopy.addPane
    : chooserSlot !== null
      ? PanesCopy.closeNewPane
      : PanesCopy.closeSecondPane;

  // The slot of the selected session's pane.
  const selectedPaneSlot: PaneIndex =
    ([0, 1] as const).find((slot) => {
      const content = twoPanes?.slots[slot];
      return content?.kind === 'session' && content.sessionKey === selectedSessionKey;
    }) ??
    twoPanes?.active ??
    0;

  // Folded while a pane other than a session is the active one: its content opens full screen, as the screen the app
  // has for it (`openPaneFullScreen`). The layout waits for the unfolded window.
  const lastActivePane = useRef<PaneContent | null>(null);
  useEffect(() => {
    if (twoPanes !== null) {
      lastActivePane.current = twoPanes.slots[twoPanes.active];
      return;
    }
    const content = lastActivePane.current;
    lastActivePane.current = null;
    if (content === null || hasPaneSlots || !isFocused || activeMachineId === null) return;
    openPaneFullScreen(content, navigation, activeMachineId);
  }, [twoPanes, hasPaneSlots, isFocused, navigation, activeMachineId]);

  return {
    goBack,
    activatePane,
    pickPaneSession,
    openAttentionTarget,
    togglePanes,
    panesLabel,
    closeChooser,
    newPaneTerminal,
    showsTwoPanes,
    chooserSlot,
    selectedPaneSlot,
  };
}

export type PaneLayoutSource = {
  /** The two panes on screen, or null. */
  twoPanes: { active: PaneIndex } | null;
  arrangement: PaneArrangement;
  /** The divider's stored position for the window's shape (`usePaneHost`'s `ratio`). */
  ratio: number;
  /** The terminal area's frame in the window: the pane container. */
  terminalArea: LayoutRectangle | null;
  /** The terminal area's bottom edge in the window. */
  terminalAreaBottom: number;
  windowHeight: number;
  /** Half folded like a laptop (iOS terminal mode), else null. */
  laptopFold: LaptopFold | null;
  foldDivisions: readonly FoldDivision[] | undefined;
  editorShown: boolean;
  /** The text editor's measured height (0 until measured). */
  editorHeight: number;
  /** How much of the terminal's bottom the keyboard covers, with the text editor on it when `editorOpen`. */
  keyboardCover: (editorOpen: boolean) => number;
  /** How much of the terminal's bottom a pad layer in the keyboard's place covers. */
  layerCover: number;
};

/**
 * Where the two panes stand in the terminal area (`paneGeometry`'s input), and the text editor's frame across when it
 * stands over the active pane only.
 */
export function paneLayoutInput({
  twoPanes,
  arrangement,
  ratio,
  terminalArea,
  terminalAreaBottom,
  windowHeight,
  laptopFold,
  foldDivisions,
  editorShown,
  editorHeight,
  keyboardCover,
  layerCover,
}: PaneLayoutSource): {
  paneLayout: PaneGeometryInput | null;
  editorDockFrame: { left: number; width: number } | undefined;
} {
  // Two panes in the terminal area (the pane container). Upright, what covers its bottom across the whole width (the
  // keyboard with the text editor riding on it, or a layer in its place) decides the keyboard rules; side by side the
  // editor stands over the active pane only, as wide as it; half folded the panes end above the fold (`end`), where the
  // keyboard and the layers below it do not reach them. There the fold alone, the keyboard and a layer down, is no
  // cover: the divider handle stays.
  const panesUpright = arrangement === 'stacked';
  const laptopCovered = keyboardCover(false) > 0 || layerCover > 0;
  const paneCover =
    laptopFold !== null
      ? laptopCovered
        ? laptopObstruction({
            fold: laptopFold,
            areaBottom: terminalAreaBottom,
            keyboardCover: keyboardCover(false),
            layerCover,
            editorHeight: 0,
          })
        : 0
      : Math.max(keyboardCover(panesUpright && editorShown), layerCover);
  // Half folded like a book (an active division down the window; the pose has no layout of its own): the panes'
  // content may run across the fold, their controls keep off it.
  const bookDivision = foldDivisions?.find((division) => division.active && division.height > division.width);
  const paneLayout: PaneGeometryInput | null =
    twoPanes === null || terminalArea === null
      ? null
      : {
          arrangement,
          width: terminalArea.width,
          height: terminalArea.height,
          ratio,
          active: twoPanes.active,
          coverTop: paneCover > 0 ? terminalArea.height - paneCover : null,
          editorTop:
            !editorShown || panesUpright
              ? null
              : laptopFold !== null
                ? windowHeight -
                  laptopEditorInset(laptopFold, windowHeight) -
                  (editorHeight || TEXT_EDITOR_HEIGHT) -
                  terminalArea.y
                : terminalArea.height - keyboardCover(true),
          end: laptopFold === null ? null : laptopFold.top - terminalArea.y - PANE_FOLD_CLEARANCE,
          division:
            bookDivision === undefined
              ? null
              : { start: bookDivision.x - terminalArea.x, end: bookDivision.x + bookDivision.width - terminalArea.x },
        };
  const activePaneCard = paneLayout === null || panesUpright ? null : paneGeometry(paneLayout).cards[paneLayout.active];
  const editorDockFrame =
    activePaneCard === null || terminalArea === null
      ? undefined
      : { left: terminalArea.x + activePaneCard.x, width: activePaneCard.width };
  return { paneLayout, editorDockFrame };
}
