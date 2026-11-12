/**
 * The terminal view's bottom bar while the keyboard is down (Android): the chat box's bottom row replayed under the
 * terminal, with no message field and no model picker, as the desktop's terminal bar is (`terminal_agent_action_bar.rs`):
 * the mode button (Shift+Tab, which cycles an agent TUI's permission mode), then More actions, Attach, Chat view, the
 * voice agent, Dictate and, in Send's place, the keyboard. A tap on the bar's empty room brings the keyboard back too;
 * with the keyboard up the screen shows its key bar instead (`TerminalKeyBar`).
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
import { DictationBar } from '../../chat/native/composer/DictationBar';
import { Glyph, ModeGlyph, type GlyphName } from '../../chat/native/composer/icons';
import { useDictation, type DictationChat } from '../../chat/native/composer/useDictation';
import type { UserAction } from '../../chat/rust/actions';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { colorWithOpacity } from '../../theme/palette';
import type { TerminalChrome } from '../../theme/terminalColours';
import type { RootStackParamList } from '../../navigation/types';
import { forgetRecording, requestEnded, wordsAsked } from '../../voice/dictation';
import { chooseVoiceComputer } from '../../voice/dictateSettings';
import { VoiceButton } from '../../voice/VoiceButton';
import { KeyboardIcon } from './icons';
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
    options: { selected?: boolean; disabled?: boolean } = {},
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
        options.disabled === true ? styles.dim : null,
      ]}
    >
      <Glyph name={glyph} size={GLYPH_SIZE} color={glyphColor} />
    </Pressable>
  );
  return (
    <View testID="terminal-bottom-bar" style={[styles.root, { paddingBottom: 8 + bottomInset }]}>
      {dictation.phase !== 'idle' ? (
        <View
          style={[
            styles.dictation,
            {
              backgroundColor: colorWithOpacity(chrome.ink, TRACK_TINT_ALPHA * 100),
              borderColor: colorWithOpacity(chrome.ink, 12),
            },
          ]}
        >
          <DictationBar
            phase={dictation.phase}
            elapsedMs={dictation.phase === 'waiting' ? dictation.waitingMs : dictation.elapsedMs}
            failure={dictation.failure}
            retrying={dictation.retrying}
            onShare={dictation.canShare ? () => void dictation.share() : undefined}
            engine={dictation.engine?.label ?? null}
            fix={dictation.fix}
            onCancel={() => void dictation.cancel()}
            onRetry={() => void dictation.retry()}
            onFix={openVoiceSettings}
          />
        </View>
      ) : null}
      {/* The bar's empty room is the keyboard's too; its buttons take their own taps. */}
      <Pressable
        accessibilityLabel="Show the keyboard"
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
                  : dictation.engine !== null
                    ? `Dictate · ${dictation.engine.label}`
                    : 'Dictate',
                () => void dictation.toggle(),
                { selected: dictation.listening },
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
  dictation: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
