/**
 * The terminal view's bottom bar while the keyboard is down: the chat box's bottom row replayed under the
 * terminal, with no message field and no model picker, as the desktop's terminal bar is (`terminal_agent_action_bar.rs`):
 * the mode button (Shift+Tab, which cycles an agent TUI's permission mode), then More actions, Attach, Chat view, the
 * voice agent, Dictate and, in Send's place, the keyboard (on the iPhone also Panes, from its top bar). A tap on the
 * bar's empty room brings the keyboard back too. With the keyboard up Android shows its key bar instead
 * (`TerminalKeyBar`); the iPhone keeps the bar under the terminal, where the keyboard covers it, so the terminal keeps
 * its size and only slides (`terminalKeyboardSlide.ts`).
 *
 * CDXC:Terminal 2026-11-12 DECISION:
 * User, of the phone's terminal view: show a bottom bar like the desktop's terminal bar, its buttons the chat box's
 * bottom row without the model picker ("agent TUIs already show the model in their status line"); tapping its empty
 * area or its keyboard button brings the keyboard back, and the keyboard's own key bar stays as it is. The top bar then
 * holds the tab strip alone, as the chat view's does, as its buttons are here.
 *
 * Dictate types the words into the terminal at its cursor and never presses Enter (the desktop's terminal Dictate,
 * `terminal_agent_action_bar/dictation.rs`); the recording is the chat box's (`useDictation`), kept until its words
 * are typed.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Alert, Platform, Pressable, StyleSheet, ToastAndroid, View } from 'react-native';

import { GhostexNative } from '../../../modules/ghostex-native/src';
import { DictationBar, unavailableProblem } from '../../chat/native/composer/DictationBar';
import { Glyph, ModeGlyph, type GlyphName } from '../../chat/native/composer/icons';
import { useDictation, type DictationChat } from '../../chat/native/composer/useDictation';
import type { UserAction } from '../../chat/rust/actions';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { colorWithOpacity, GhostexPalette } from '../../theme/palette';
import type { TerminalChrome } from '../../theme/terminalColours';
import type { RootStackParamList } from '../../navigation/types';
import { forgetRecording, requestEnded, wordsAsked } from '../../voice/dictation';
import { chooseVoiceComputer } from '../../voice/dictateSettings';
import { VoiceButton } from '../../voice/VoiceButton';
import { KeyboardIcon, PanesIcon } from './icons';
import { TRACK_TINT_ALPHA } from './tabStrip';

/** The chat box's geometry (`NativeComposer.tsx`): its side margin, corner, inner padding and 32 pt controls. */
const SIDE_MARGIN = 10;
const BAR_HEIGHT = 44;
const INNER_PADDING = 10;
const CONTROL_SIZE = 32;
const CONTROL_GAP = 4;
const GLYPH_SIZE = 18;
/** Send's twin: the keyboard button in Send's place. */
const ACCENT_SIZE = 30;

export type TerminalBottomBarProps = {
  sessionKey: string;
  /** The terminal's own colours: the bar's wash, border and glyphs take its ink. */
  chrome: TerminalChrome;
  /** The terminal's computer: the voice agent and Dictate are offered when it runs them. */
  machine: (MachineConnectionTarget & { name?: string }) | null;
  /** The screen's bottom inset (gesture bar), kept below the bar. */
  bottomInset: number;
  /** An agent's terminal: the mode button (Shift+Tab) shows. */
  agent: boolean;
  /** The session has a chat view: the Chat view button shows. */
  chatView: boolean;
  /** Attach shows (Settings' upload button switch); `uploadEnabled` while the terminal can take a file. */
  upload: boolean;
  uploadEnabled: boolean;
  uploading: boolean;
  onKeyboard: () => void;
  onMore: () => void;
  onChatView: () => void;
  onUpload: () => void;
  /**
   * The iPhone's Panes button, which stood in its top bar: shown where the window has pane slots (`across`: side by
   * side, else stacked; `selected` while two panes show).
   */
  panes?: { label: string; across: boolean; selected: boolean; onPress: () => void } | null;
  /** The bar's height with its bottom inset, whenever it changes (the iPhone's terminal ends above it). */
  onHeightChange?: (height: number) => void;
  /**
   * Kept in place but not drawn and not touched: the iPhone's keyboard is over it, and its glass would show the bar
   * through it.
   */
  covered?: boolean;
};

/** A short problem no row shows (no microphone permission, nothing to transcribe again). */
function toast(message: string): void {
  if (message.length === 0) return;
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  else Alert.alert(message);
}

export default function TerminalBottomBar({
  sessionKey,
  chrome,
  machine,
  bottomInset,
  agent,
  chatView,
  upload,
  uploadEnabled,
  uploading,
  onKeyboard,
  onMore,
  onChatView,
  onUpload,
  panes = null,
  onHeightChange,
  covered = false,
}: TerminalBottomBarProps) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  // Dictate's Set up Hex: Settings › Voice on this terminal's computer, as the chat box's does.
  const openVoiceSettings = useCallback((): void => {
    if (machine === null) return;
    chooseVoiceComputer(machine.id);
    navigation.navigate('SettingsPage', { page: 'voice' });
  }, [machine, navigation]);
  const sessionRef = useRef(sessionKey);
  sessionRef.current = sessionKey;
  // Dictate's words go to the terminal: typed at its cursor, never sent. A recording has one request on the whole
  // phone (`wordsAsked`); typed, it is forgotten, and a terminal that refused the text lets it wait again.
  const dictationChat = useMemo<DictationChat>(
    () => ({
      targets: null,
      dispatch: (action: UserAction) => {
        if (action.type !== 'insertDictation') return;
        const { id, text } = action;
        if (id !== undefined && !wordsAsked(id)) return;
        const spaced = text.endsWith(' ') ? text : `${text} `;
        void GhostexNative.sendText(sessionRef.current, spaced).then(
          () => (id === undefined ? undefined : forgetRecording(id)),
          () => (id === undefined ? undefined : requestEnded(id)),
        );
      },
    }),
    [],
  );
  const dictation = useDictation(machine, toast, dictationChat);
  const sendModeKey = useCallback((): void => {
    void GhostexNative.sendKey(sessionRef.current, 'tab', { shift: true }).catch(() => undefined);
  }, []);

  const glyphColor = chrome.foreground;
  const pressedWash = colorWithOpacity(chrome.ink, 14);
  const control = (
    glyph: GlyphName,
    label: string,
    onPress: () => void,
    /** `dimmed`: shown greyed but still pressed (a Dictate that can't transcribe yet says why). */
    options: { selected?: boolean; disabled?: boolean; dimmed?: boolean } = {},
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: options.selected === true, disabled: options.disabled === true }}
      disabled={options.disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        pressed || options.selected === true ? { backgroundColor: pressedWash } : null,
        options.disabled === true || options.dimmed === true ? styles.dim : null,
      ]}
    >
      <Glyph name={glyph} size={GLYPH_SIZE} color={glyphColor} />
    </Pressable>
  );
  return (
    <View
      testID="terminal-bottom-bar"
      pointerEvents={covered ? 'none' : 'auto'}
      style={[styles.root, { paddingBottom: 8 + bottomInset }, covered ? styles.covered : null]}
      onLayout={onHeightChange === undefined ? undefined : (event) => onHeightChange(event.nativeEvent.layout.height)}
    >
      {/* The pill and cards draw their own surface, as above the chat box. */}
      <DictationBar
        phase={dictation.phase}
        elapsedMs={dictation.phase === 'waiting' ? dictation.waitingMs : dictation.elapsedMs}
        failure={dictation.failure}
        retrying={dictation.retrying}
        onShare={dictation.canShare ? () => void dictation.share() : undefined}
        engine={dictation.engine?.label ?? null}
        fix={dictation.fix}
        problem={unavailableProblem(dictation.unavailable, machine?.name ?? null)}
        recordingId={dictation.recordingId}
            notice={dictation.notice}
            failureCode={dictation.failureCode}
        onCancel={() => void dictation.cancel()}
        onRetry={() => void dictation.retry()}
        onFix={openVoiceSettings}
      />
      {/* The bar's empty room is the keyboard's too; its buttons take their own taps. Not an accessibility element
          itself, so VoiceOver and TalkBack reach each button (the keyboard button is the bar's Show the keyboard). */}
      <Pressable
        accessible={false}
        onPress={onKeyboard}
        style={[
          styles.bar,
          {
            backgroundColor: colorWithOpacity(chrome.ink, TRACK_TINT_ALPHA * 100),
            borderColor: colorWithOpacity(chrome.ink, 12),
          },
        ]}
      >
        {agent ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next mode (Shift+Tab)"
            hitSlop={4}
            onPress={sendModeKey}
            style={({ pressed }) => [styles.control, pressed ? { backgroundColor: pressedWash } : null]}
          >
            <ModeGlyph mode="advance" color={glyphColor} />
          </Pressable>
        ) : null}
        <View style={styles.toolbar}>
          {control('dots', 'More actions', onMore)}
          {upload
            ? control(uploading ? 'loader' : 'paperclip', 'Send & Attach File', onUpload, {
                disabled: !uploadEnabled || uploading,
              })
            : null}
          {panes !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={panes.label}
              accessibilityState={{ selected: panes.selected }}
              hitSlop={4}
              onPress={panes.onPress}
              style={({ pressed }) => [styles.control, pressed ? { backgroundColor: pressedWash } : null]}
            >
              <PanesIcon
                across={panes.across}
                size={GLYPH_SIZE}
                color={panes.selected ? GhostexPalette.ACCENT : glyphColor}
              />
            </Pressable>
          ) : null}
          {chatView ? control('message-circle', 'Chat View', onChatView) : null}
          <VoiceButton
            machine={machine}
            style={styles.control}
            color={glyphColor}
            size={GLYPH_SIZE}
            activeFill={false}
          />
          {dictation.available
            ? control(
                dictation.listening ? 'player-stop' : 'microphone',
                dictation.listening
                  ? 'Stop dictating'
                  : !dictation.ready
                    ? "Dictate isn't ready on this computer"
                    : dictation.engine !== null
                      ? `Dictate · ${dictation.engine.label}`
                      : 'Dictate',
                () => void dictation.toggle(),
                { selected: dictation.listening, dimmed: !dictation.ready && !dictation.listening },
              )
            : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show the keyboard"
            hitSlop={4}
            onPress={onKeyboard}
            style={({ pressed }) => [
              styles.accent,
              { backgroundColor: chrome.foreground },
              pressed ? styles.pressed : null,
            ]}
          >
            <KeyboardIcon size={18} color={chrome.background} />
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: SIDE_MARGIN,
    paddingTop: 6,
    gap: 6,
  },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    borderWidth: 1,
    paddingHorizontal: INNER_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CONTROL_GAP,
    marginLeft: 'auto',
  },
  control: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: CONTROL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accent: {
    width: ACCENT_SIZE,
    height: ACCENT_SIZE,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  covered: { opacity: 0 },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
