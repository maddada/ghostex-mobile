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
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettingsStore } from '../../../settings/store';
import type { UserAction } from '../../rust/actions';
import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { AttachmentPreviews } from './AttachmentPreviews';
import { pickAttachments, type AttachSource } from './attachments';
import { COLLAPSED_INPUT_HEIGHT, ComposerInput, type ComposerInputHandle } from './ComposerInput';
import { ContextEditorSheet } from './ContextEditorSheet';
import { Glyph, type GlyphName } from './icons';
import { IncomingDraftBar } from './IncomingDraftBar';
import { isTrue, obj, str, type JsonRecord } from './json';
import { COMPOSER_CONTROLS, moreActionsRows, optionMenuRows, overflowed, type ComposerControlId } from './menus';
import { MenuSheet, type MenuRow } from './MenuSheet';
import { ModelMenuSheet } from './ModelMenuSheet';
import { NotePanel } from './NotePanel';
import { OptionPills, type PillKind } from './OptionPills';
import { RunLocationRow } from './RunLocationRow';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { QueueList } from './QueueList';
import { parseReferences } from './references';
import { SendControl } from './SendControl';
import { StatusLine, statusLineReserved } from './StatusLine';
import { Suggestions } from './Suggestions';
import { useComposerMotion } from './useComposerMotion';
import { useDictation } from './useDictation';
import { useKeyboardInset } from './useKeyboardInset';

export type NativeComposerProps = {
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
};

const DEFAULT_HOST_ACTIONS: readonly string[] = ['terminalView'];

/** Toolbar geometry the overflow fit is computed from (`toolbar.rs`, `composer_measurement`). */
const CONTROL_WIDTH = 32;
const ACTION_GAP = 4;
const SEND_WIDTH = 30;
const FOOTER_GAP = 8;
const CLEARANCE = 8;
const INPUT_MAX_HEIGHT = 168;
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
  if (readiness === 'notReady') return '#f0a3a3';
  return null;
}

const CONTROL_GLYPHS: Record<ComposerControlId, GlyphName> = {
  summary: 'list-details',
  note: 'note',
  stash: 'stack-push',
  attach: 'paperclip',
  dictate: 'microphone',
  terminal: 'terminal-2',
};

type OpenMenu =
  | { kind: 'rows'; title?: string; rows: MenuRow[] }
  | { kind: 'model' }
  | null;

export function NativeComposer({ chat, onHostAction, hostActions = DEFAULT_HOST_ACTIONS, openAccountsRequestId = 0 }: NativeComposerProps) {
  const styles = useStyles();
  const serves = useCallback(
    (action: string) => onHostAction !== undefined && hostActions.includes(action),
    [hostActions, onHostAction]
  );
  const state = chat.state;
  const document = state?.document ?? null;
  const input = chat.composer;
  const model = state?.composer ?? null;
  const dispatch = chat.dispatch;
  const insets = useSafeAreaInsets();
  const anchor = useRef<View>(null);
  const keyboard = useKeyboardInset(anchor);
  const requestedCollapsed = document?.composerCollapsed === true;
  const motion = useComposerMotion(requestedCollapsed, CARD_BORDER, COLLAPSED_CARD_ESTIMATE);
  const field = useRef<ComposerInputHandle>(null);
  const [text, setText] = useState(model?.text ?? '');
  const [caret, setCaret] = useState(0);
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [focused, setFocused] = useState(false);
  const pendingPick = useRef<AttachSource | null>(null);
  // Dictated phrases go into the draft at the caret, a space apart from the text around them.
  const draftAt = useRef({ text, caret });
  draftAt.current = { text, caret };
  const dictation = useDictation(
    (phrase) => {
      const { text: current, caret: at } = draftAt.current;
      const before = current.slice(0, at);
      const after = current.slice(at);
      const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
      const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
      input?.replace(before + lead + phrase + trail + after);
    },
    (message) => onHostAction?.('toast', { message, level: 'error' })
  );
  const verboseSetting = useSettingsStore((store) => store.settings.sessionChatVerboseMode);
  const simpleSetting = useSettingsStore((store) => store.settings.sessionChatSimpleMode);
  const setSetting = useSettingsStore((store) => store.setSetting);

  useEffect(
    () =>
      chat.onViewRequest((request) => {
        if (request.kind === 'focusComposer') field.current?.focus();
      }),
    [chat.onViewRequest]
  );

  // Pills: the core parses the draft (`composerReferences`) in the same turn the text changes.
  const parseDraftReferences = useCallback((draft: string) => parseReferences(draft, chat.query('composerReferences', [draft])), [chat.query]);
  const references = useMemo(() => parseDraftReferences(text), [text, parseDraftReferences]);
  const activeImage = useMemo(() => {
    const reference = references.find((entry) => entry.kind === 'image' && caret >= entry.start && caret <= entry.end);
    return reference?.path ?? null;
  }, [references, caret]);

  // ---- the toolbar's overflow fit, measured like desktop's `composer_measurement` ----------------

  const available = useCallback(
    (id: ComposerControlId): boolean => {
      if (document === null) return false;
      // Dictation is the phone's own (the platform recognizer), so the core does not gate it.
      if (id === 'dictate') return dictation.available;
      const gate = document.composerActions?.[id];
      if (gate === false) return false;
      if (id === 'terminal') return serves('terminalView');
      return true;
    },
    [dictation.available, document, serves]
  );
  const [footerWidth, setFooterWidth] = useState(0);
  const [optionsWidth, setOptionsWidth] = useState(0);
  const sentMeasurement = useRef('');
  const composerReady = model?.ready === true;
  useEffect(() => {
    if (document === null || !composerReady || footerWidth <= 0) return;
    const controls = COMPOSER_CONTROLS.filter((control) => available(control.id)).map((control) => ({ id: control.id, width: CONTROL_WIDTH }));
    const labels = obj(document.optionLabels);
    const measurements = {
      available: footerWidth,
      options: optionsWidth,
      actions: CONTROL_WIDTH + controls.length * (CONTROL_WIDTH + ACTION_GAP) + ACTION_GAP + SEND_WIDTH,
      footerGap: FOOTER_GAP,
      actionGap: ACTION_GAP,
      clearance: CLEARANCE,
      hasOverflowOptions: (isTrue(labels, 'showOptions') && obj(document.modelMenu) === null) || obj(document.contextMeter) !== null,
      controls,
    };
    const key = JSON.stringify(measurements);
    if (key === sentMeasurement.current) return;
    sentMeasurement.current = key;
    dispatch({ type: 'measureComposer', measurements });
  }, [document, composerReady, footerWidth, optionsWidth, available, dispatch]);

  // ---- menus and host actions --------------------------------------------------------------------

  const host = useCallback(
    (action: string, params: JsonRecord = {}) => {
      onHostAction?.(action, params);
    },
    [onHostAction]
  );

  const openAttach = useCallback(() => {
    setMenu({
      kind: 'rows',
      title: 'Attach',
      rows: [
        { label: 'Photo library', iconPath: 'titlebar/photo.svg', command: { type: 'pickAttachments', source: 'library' } },
        { label: 'Take photo', iconPath: 'titlebar/camera.svg', command: { type: 'pickAttachments', source: 'camera' } },
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
        case 'attachPath':
          openAttach();
          return;
        case 'dictate':
          void dictation.toggle();
          return;
        case 'stashPrompt':
          if (model !== null && model.text.trim().length > 0) {
            dispatch({ type: 'stash', text: model.text, draftVersion: { draftId: model.draftId, revision: model.revision } });
          } else if (serves('stashedPrompts')) {
            host('stashedPrompts');
          }
          return;
        default:
          host(action);
      }
    },
    [dictation, dispatch, host, model, openAttach, serves]
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
          input?.submit((str(command, 'mode') || 'send') as 'send' | 'queue' | 'compact' | 'handoff');
          return false;
        case 'composerHost':
          // Attach swaps this sheet's rows for the Attach rows; closing it would close those too.
          if (str(command, 'action') === 'attachPath') {
            openAttach();
            return true;
          }
          performComposerAction(str(command, 'action'));
          return false;
        case 'openAccountsSettings':
          if (serves('openAccountsSettings')) host('openAccountsSettings');
          // Signing in to an account runs the agent's login on the computer, where desktop's Add
          // account leads (Settings > Accounts); the phone says where instead of doing nothing.
          else Alert.alert('Add accounts on your computer', 'Open Ghostex on your computer and go to Settings > Accounts to sign in to another account.');
          return false;
        case 'copyText':
          void Clipboard.setStringAsync(str(command, 'text'));
          return false;
        case 'setSimpleMode':
          // A phone setting, like desktop's `setSimpleMode` host action writing its own settings.
          setSetting('sessionChatSimpleMode', command.enabled === true);
          return false;
        case 'host':
          host(str(command, 'action'), command);
          return false;
        default:
          dispatch(command as UserAction);
          return false;
      }
    },
    [dispatch, host, input, openAttach, performComposerAction, serves, setSetting]
  );

  const launchPick = useCallback(
    (source: AttachSource) => {
      pickAttachments(source)
        .then((files) => chat.attachFiles(files))
        .catch((error: unknown) => {
          Alert.alert('Attachment failed', error instanceof Error ? error.message : 'The attachment could not be added.');
        });
    },
    [chat]
  );
  /** A source picked in the sheet, launched once the sheet's modal is gone (iOS). */
  const pickAfterDismiss = useRef<AttachSource | null>(null);
  const closeMenu = useCallback(() => {
    setMenu(null);
    const source = pendingPick.current;
    pendingPick.current = null;
    if (source === null) return;
    // iOS cannot present the picker while the sheet's modal is still sliding away; a fixed delay
    // raced that animation and the picker silently never showed. Android's modal is a dialog.
    if (Platform.OS === 'ios') pickAfterDismiss.current = source;
    else launchPick(source);
  }, [launchPick]);
  const onMenuDismissed = useCallback(() => {
    const source = pickAfterDismiss.current;
    pickAfterDismiss.current = null;
    if (source !== null) launchPick(source);
  }, [launchPick]);

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
      if (rows.length > 0) setMenu({ kind: 'rows', rows });
    },
    [document]
  );

  const handledAccountsRequest = useRef(openAccountsRequestId);
  useEffect(() => {
    if (openAccountsRequestId === handledAccountsRequest.current) return;
    handledAccountsRequest.current = openAccountsRequestId;
    if (openAccountsRequestId > 0 && document !== null && obj(document.accountPanel) !== null) {
      setMenu({ kind: 'rows', rows: [{ accounts: document.accountPanel }] });
    }
  }, [document, openAccountsRequestId]);

  const openMore = useCallback(() => {
    if (document === null) return;
    const verbose = document.verboseOverride ?? verboseSetting;
    // Send's own menu on desktop (`show_send_actions`), which a phone has no right press to open.
    const compactAndSend =
      model !== null && model.text.trim().length > 0
        ? { disabled: !(model.ready && document.queue.capabilities.canQueue) }
        : null;
    setMenu({ kind: 'rows', rows: moreActionsRows({ document, simple: simpleSetting, verbose, available, serves, compactAndSend, draft: model?.text ?? '' }) });
  }, [available, document, model, serves, simpleSetting, verboseSetting]);

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
  const collapsed = motion.collapsed;
  const hasDraft = text.trim().length > 0;
  const placeholder = document?.composerPlaceholder ?? '';
  const operationError = document?.operationErrorCode === 'composerNotReady' ? null : (document?.operationError ?? null);
  const statusLine = document !== null && statusLineReserved(document);
  const bottom = keyboard > 0 ? keyboard + 8 : Math.max(insets.bottom, 12);

  return (
    <View ref={anchor} style={[styles.root, { paddingBottom: bottom }]}>
      {document?.incomingDraft ? <IncomingDraftBar draft={document.incomingDraft} dispatch={dispatch} /> : null}
      {operationError !== null && operationError.length > 0 ? <Text style={styles.error}>{operationError}</Text> : null}
      {document !== null ? <NotePanel note={document.note} dispatch={dispatch} /> : null}
      {document?.suggestions ? <Suggestions data={document.suggestions} dispatch={dispatch} /> : null}
      {document?.runLocation ? <RunLocationRow row={document.runLocation} dispatch={dispatch} /> : null}
      <Animated.View style={[styles.card, focused ? styles.cardFocused : null, motion.cardStyle]}>
        <Pressable
          accessible={false}
          onPress={() => {
            if (requestedCollapsed) dispatch({ type: 'composerExpand', editor: true });
            field.current?.focus();
          }}
          onLayout={motion.onContentLayout}
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
            />
          ) : null}
          {document !== null ? <QueueList document={document} dispatch={dispatch} /> : null}
          <View style={collapsed ? styles.collapsedRow : null}>
            <View style={collapsed ? styles.grow : null}>
              <ComposerInput
                  ref={field}
                  model={model}
                  input={{
                    ...input,
                    focused: () => {
                      setFocused(true);
                      input.focused();
                      readTerminalTail();
                    },
                    blurred: () => {
                      setFocused(false);
                      input.blurred();
                    },
                  }}
                  references={references}
                  parsedFor={text}
                  parse={parseDraftReferences}
                  placeholder={placeholder}
                  collapsed={collapsed}
                  maxHeight={INPUT_MAX_HEIGHT}
                  dispatch={dispatch}
                  onTextChange={setText}
                  onCaret={setCaret}
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
              />
            ) : null}
          </View>
          {!collapsed ? (
            <Animated.View style={[styles.footer, motion.controlsStyle]} onLayout={(event: LayoutChangeEvent) => setFooterWidth(Math.round(event.nativeEvent.layout.width))}>
              <View style={styles.options}>{document !== null ? <OptionPills document={document} onOpen={openPill} /> : null}</View>
              <View style={styles.toolbar}>
                <ToolbarButton glyph="dots" label="More actions" onPress={openMore} disabled={document === null} />
                {document !== null
                  ? COMPOSER_CONTROLS.filter((control) => available(control.id) && !overflowed(document, control.id)).map((control) => {
                      const glyph =
                        control.id === 'summary' && document.summaryMode
                          ? 'list-check'
                          : control.id === 'dictate' && dictation.listening
                            ? 'player-stop'
                            : CONTROL_GLYPHS[control.id];
                      const pressed =
                        (control.id === 'summary' && document.composerChrome.summaryPressed) ||
                        (control.id === 'note' && document.composerChrome.notePressed) ||
                        (control.id === 'dictate' && dictation.listening);
                      const badge =
                        control.id === 'stash'
                          ? document.composerChrome.stashBadge
                          : control.id === 'note' && document.composerChrome.notePresence
                            ? ''
                            : null;
                      return (
                        <ToolbarButton
                          key={control.id}
                          glyph={glyph}
                          label={control.label}
                          pressed={pressed}
                          badge={badge}
                          tint={control.id === 'terminal' ? terminalReadinessTint(document) : null}
                          onPress={() => performComposerAction(control.action)}
                          {...(control.id === 'stash' && serves('stashedPrompts') ? { onLongPress: () => host('stashedPrompts') } : {})}
                        />
                      );
                    })
                  : null}
                <SendControl
                  document={document}
                  hasDraft={hasDraft}
                  ready={model.ready}
                  submit={input.submit}
                  dispatch={dispatch}
                />
              </View>
              {document !== null ? (
                <View style={styles.measure} pointerEvents="none" onLayout={(event) => setOptionsWidth(Math.round(event.nativeEvent.layout.width))}>
                  <OptionPills document={{ ...document, composerOverflow: { overflowed: [], optionsOverflowed: false } } as ChatDocument} onOpen={() => undefined} />
                </View>
              ) : null}
            </Animated.View>
          ) : null}
        </Pressable>
      </Animated.View>
      {statusLine && document !== null ? <StatusLine document={document} dispatch={dispatch} /> : null}
      <MenuSheet
        rows={menu?.kind === 'rows' ? menu.rows : null}
        {...(menu?.kind === 'rows' && menu.title !== undefined ? { title: menu.title } : {})}
        onClose={closeMenu}
        onCommand={runCommand}
        onDismissed={onMenuDismissed}
      />
      <ModelMenuSheet
        menu={obj(document?.modelMenu)}
        visible={menu?.kind === 'model'}
        ownProvider={str(document?.modelMenuContext, 'provider')}
        onClose={closeMenu}
        dispatch={dispatch}
      />
      <ContextEditorSheet editor={obj(document?.contextEditor)} dispatch={dispatch} />
    </View>
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
      <Glyph name={glyph} size={18} color={tint ?? (pressed ? P.controlPrimary : P.primary)} />
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
  /** The card's content at its natural height; the card clips it while its height tweens. */
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 6,
  },
  cardFocused: { borderColor: P.ring, shadowColor: P.ring, shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } },
  cardCollapsed: { paddingTop: 6, paddingBottom: 6 },
  collapsedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: FOOTER_GAP },
  options: { flexShrink: 1, minWidth: 0, flexDirection: 'row' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: ACTION_GAP, marginLeft: 'auto' },
  control: { width: CONTROL_WIDTH, height: CONTROL_WIDTH, borderRadius: CONTROL_WIDTH / 2, alignItems: 'center', justifyContent: 'center' },
  controlPressed: { backgroundColor: P.border },
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
