/**
 * The voice screen: one conversation with the manager voice agent, made to be glanced at while
 * walking or driving. A big state circle (listening, thinking, speaking, running a tool), live
 * captions of what you and the agent said with tool calls as short rows, the voice (tap it to pick
 * another) with a small speed button beside it (a list from 1x to 2x), the remembered last conversation to continue
 * (`VoiceMemoryCard`), and large Mute, hold-to-talk and Hang up controls with a Stop talking pill above them
 * (`VoiceStopPill`). Closing the screen keeps the conversation going; the top bar's
 * Voice button and the "Voice mode on" notification bring it back.
 */

import { readableSecondaryText } from '../theme/sidebarAppearance';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import GhostexSelectionMenuView from '../../modules/ghostex-native/src/GhostexSelectionMenuView';
import { IconPill } from '../chat/native/cards/ChatPills';
import { MESSAGE_TEXT_SELECTABLE } from '../chat/native/transcript/messageSelection';
import { useTranscriptTheme } from '../chat/native/transcript/theme';
import BottomSheet from '../components/common/BottomSheet';
import KeyboardAvoidingContainer from '../components/common/keyboard/KeyboardAvoidingContainer';
import { useKeyboardTop } from '../components/common/keyboard/keyboardFrame';
import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import { CheckGlyph } from '../components/onboarding/SetupIcons';
import { SettingsGlyph } from '../components/sessions/icons';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useTerminalStore } from '../terminal/sessions';
import { GhostexPalette, GhostexRadii } from '../theme/palette';
import {
  dismissVoice,
  flashVoiceHint,
  focusVoiceOn,
  hangUpVoice,
  pickVoice,
  setCallMode,
  setVoiceMuted,
  setVoiceSpeed,
  startVoice,
  useVoiceStore,
  voiceActive,
  voiceName,
  voiceProviderName,
  VOICE_SPEEDS,
  type VoiceLine,
  VOICE_CALL_MODES,
  voiceCallModeNote,
} from '../voice/conversation';
import { focusBannerDetail } from '../voice/focus';
import { GbotCallBanner, useGbotCallOpen } from '../voice/GbotCallBanner';
import { HeadsetGlyph, MicrophoneGlyph } from '../voice/VoiceButton';
import { VoiceHoldButton } from '../voice/VoiceHoldButton';
import { VoiceStopPill } from '../voice/VoiceStopPill';
import { VoiceTextBox } from '../voice/VoiceTextBox';
import { VoiceMemoryCard } from '../voice/VoiceMemoryCard';
import { voiceSheetScrollY } from '../voice/voiceList';

type Props = NativeStackScreenProps<RootStackParamList, 'Voice'>;

/** At or under this many points from the end the reader is at the bottom (the chat's `edgeThreshold`, `Transcript.tsx`). */
const BOTTOM_EDGE = 10;

/** How far the captions are from their end, in points. */
function distanceFromEnd(event: NativeSyntheticEvent<NativeScrollEvent>): number {
  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
  return contentSize.height - layoutMeasurement.height - contentOffset.y;
}

/**
 * CDXC:VoiceMode 2026-10-21 DECISION:
 * User: new messages must not scroll the voice screen to the bottom once the reader has scrolled up; at the bottom it keeps following them, like the chat. A scroll-to-bottom pill (the chat's ↓ `IconPill`, at the lone pill's place, `LoneScrollBottom` in `WorkingCard.tsx`) shows only after the reader scrolled up and hides once they are back at the bottom. Only the reader's own drag decides "scrolled up", so a follow scroll in flight never counts.
 */
function useFollowBottom() {
  const scroll = useRef<ScrollViewInstance>(null);
  const [away, setAway] = useState(false);
  const awayRef = useRef(false);
  /** The reader's finger is on the captions (begin drag to end drag). */
  const fingerDown = useRef(false);
  /** The fling that follows the reader's drag is still running. */
  const momentum = useRef(false);
  /**
   * The finger just lifted, so a momentum begin that comes next is the reader's fling; a follow or
   * jump scroll clears it, so momentum events Android sends for its own animated scrolls never count.
   */
  const released = useRef(false);

  const setAwayBoth = useCallback((next: boolean) => {
    awayRef.current = next;
    setAway(next);
  }, []);
  const measure = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (fingerDown.current || momentum.current) setAwayBoth(distanceFromEnd(event) > BOTTOM_EDGE);
    },
    [setAwayBoth],
  );
  const follow = useCallback(() => {
    if (awayRef.current || fingerDown.current || momentum.current) return;
    released.current = false;
    scroll.current?.scrollToEnd({ animated: true });
  }, []);
  const jumpToBottom = useCallback(() => {
    momentum.current = false;
    released.current = false;
    setAwayBoth(false);
    scroll.current?.scrollToEnd({ animated: true });
  }, [setAwayBoth]);

  const scrollProps = {
    ref: scroll,
    scrollEventThrottle: 32,
    onScroll: measure,
    onScrollBeginDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      fingerDown.current = true;
      momentum.current = false;
      released.current = false;
      measure(event);
    },
    onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      measure(event);
      fingerDown.current = false;
      // A drag with no fling never sends momentum end (Android); a fling sets it again on begin.
      momentum.current = false;
      released.current = true;
    },
    onMomentumScrollBegin: () => {
      momentum.current = released.current;
      released.current = false;
    },
    onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      measure(event);
      momentum.current = false;
    },
    onContentSizeChange: follow,
    onLayout: follow,
  };
  return { away, jumpToBottom, scrollProps };
}

/** The state circle's words and colour for what the agent is doing. */
function stateLook(state: ReturnType<typeof useVoiceStore.getState>): { label: string; color: string } {
  if (state.phase === 'starting') return { label: 'Connecting…', color: GhostexPalette.MUTED };
  if (state.phase === 'reattaching') return { label: 'Reconnecting…', color: GhostexPalette.STATUS_WORKING };
  if (state.phase === 'ended') return { label: 'Ended', color: GhostexPalette.MUTED };
  if (state.paused) return { label: 'Paused', color: GhostexPalette.STATUS_WORKING };
  switch (state.agentState) {
    case 'connecting':
      return { label: 'Connecting…', color: GhostexPalette.MUTED };
    case 'userSpeaking':
      return { label: 'Hearing you', color: GhostexPalette.ACCENT };
    case 'thinking':
      return { label: 'Thinking', color: GhostexPalette.STATUS_WORKING };
    case 'toolRunning':
      return { label: state.toolLabel ?? 'Working', color: GhostexPalette.STATUS_WORKING };
    case 'speaking':
      return { label: 'Speaking', color: GhostexPalette.STATUS_ATTENTION };
    default:
      return {
        label: state.talking ? 'Hearing you' : state.muted ? 'Muted' : state.pushToTalk || state.clipTalk ? 'Hold to talk' : 'Listening',
        color: state.muted && !state.talking ? GhostexPalette.MUTED : GhostexPalette.ACCENT,
      };
  }
}

function ChevronDown({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d="M 6 9 l 6 6 6 -6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** "1×", "1.2×", … "2×". */
function speedLabel(speed: number): string {
  return `${speed}×`;
}

/** The voice list: the computer's voices for the conversation's provider, the current one checked. */
function VoicePickerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const provider = useVoiceStore((state) => state.provider);
  const current = useVoiceStore((state) => state.voice);
  const next = useVoiceStore((state) => state.nextVoice);
  const options = useVoiceStore((state) => state.voiceOptions);
  // In a call with a GBot the pick is saved as that GBot's voice (`pickVoice`).
  const gbotName = useVoiceStore((state) => state.focus?.gbot?.name ?? null);
  const scroll = useRef<ScrollViewInstance>(null);
  return (
    <BottomSheet visible={visible} onClose={onClose} scrollRef={scroll}>
      <Text style={styles.sheetTitle}>
        {gbotName !== null ? `${gbotName}'s voice` : `${voiceProviderName(provider)} voice`}
      </Text>
      {options.map((voice) => {
        const checked = voice === current;
        return (
          <Pressable
            key={voice}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            // The sheet opens on the current voice (`voiceList.ts`); the row lays out once per opening.
            onLayout={
              checked
                ? (event) => {
                    const { y, height } = event.nativeEvent.layout;
                    scroll.current?.scrollTo({ y: voiceSheetScrollY(y, height), animated: false });
                  }
                : undefined
            }
            style={({ pressed }) => [styles.sheetRow, pressed && styles.controlPressed]}
            onPress={() => {
              onClose();
              pickVoice(voice);
            }}
          >
            <View style={styles.sheetCheck}>
              {checked ? <CheckGlyph size={18} color={appearance.foreground} strokeWidth={2.4} /> : null}
            </View>
            <Text style={styles.sheetRowLabel}>{voiceName(voice)}</Text>
            {voice === next ? <Text style={styles.sheetRowDetail}>Next conversation</Text> : null}
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

/** The speed list: 1× to 2×, the current one checked; picking one plays faster at once and saves it. */
function VoiceSpeedSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const current = useVoiceStore((state) => state.speed);
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Speaking speed</Text>
      {VOICE_SPEEDS.map((speed) => {
        const checked = Math.abs(speed - current) < 0.01;
        return (
          <Pressable
            key={speed}
            accessibilityRole="radio"
            accessibilityLabel={`${speedLabel(speed)} speed`}
            accessibilityState={{ checked }}
            style={({ pressed }) => [styles.sheetRow, pressed && styles.controlPressed]}
            onPress={() => {
              onClose();
              setVoiceSpeed(speed);
            }}
          >
            <View style={styles.sheetCheck}>
              {checked ? <CheckGlyph size={18} color={appearance.foreground} strokeWidth={2.4} /> : null}
            </View>
            <Text style={styles.sheetRowLabel}>{speedLabel(speed)}</Text>
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

/** The gear's sheet: the computer's call mode (`voiceAgentCallMode`), with each mode's pricing. */
function VoiceSettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const current = useVoiceStore((state) => state.callMode);
  const live = useVoiceStore((state) => state.callModeLive);
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Call mode</Text>
      {VOICE_CALL_MODES.map((choice) => {
        const checked = choice.mode === current;
        return (
          <Pressable
            key={choice.mode}
            accessibilityRole="radio"
            accessibilityLabel={`${choice.label}. ${choice.detail}`}
            accessibilityState={{ checked }}
            style={({ pressed }) => [styles.sheetRow, styles.sheetRowTall, pressed && styles.controlPressed]}
            onPress={() => {
              onClose();
              setCallMode(choice.mode);
            }}
          >
            <View style={styles.sheetCheck}>
              {checked ? <CheckGlyph size={18} color={appearance.foreground} strokeWidth={2.4} /> : null}
            </View>
            <View style={styles.sheetRowText}>
              <Text style={styles.sheetChoiceLabel}>{choice.label}</Text>
              <Text style={styles.sheetRowDetail}>{choice.detail}</Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.sheetNote}>{voiceCallModeNote(live)}</Text>
    </BottomSheet>
  );
}

/**
 * The line above the captions in a call about one session: "Only about <title> (<project>)", or
 * "<title> was closed", with All sessions at its right end (the WHY on `focusVoiceOn`).
 */
function FocusBanner() {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const focus = useVoiceStore((state) => state.focus);
  const requested = useVoiceStore((state) => state.requestedFocus);
  const phase = useVoiceStore((state) => state.phase);
  const gbotCall = useGbotCallOpen();
  if (!voiceActive(phase)) return null;
  if (gbotCall) return <GbotCallBanner />;
  const title = focus?.title ?? requested?.title ?? null;
  if (title === null) return null;
  const detail = focus !== null ? focusBannerDetail(focus) : '';
  return (
    <View style={styles.focusBanner}>
      <Text style={styles.focusText} numberOfLines={2}>
        {focus?.closed === true ? (
          <>
            <Text style={styles.focusTitle}>{title}</Text>
            {' was closed'}
          </>
        ) : (
          <>
            {'Only about '}
            <Text style={styles.focusTitle}>{title}</Text>
            {detail.length > 0 ? ` ${detail}` : ''}
          </>
        )}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="All sessions: talk about every session"
        disabled={phase !== 'live'}
        hitSlop={8}
        style={({ pressed }) => [
          styles.allSessions,
          phase !== 'live' && styles.controlDisabled,
          pressed && styles.controlPressed,
        ]}
        onPress={() => focusVoiceOn(null)}
      >
        <Text style={styles.allSessionsText}>All sessions</Text>
      </Pressable>
    </View>
  );
}

/** What a screen reader says a caption's hold does. */
const CAPTION_HOLD_HINT = 'Hold the words to select them, or hold the name above them to copy the whole message';

const CAPTION_ACTIONS = [{ name: 'longpress', label: 'Copy message' }];

/** A JS touch on the words claims the touch, so the bubble's own hold never starts over a selection. */
const claimTouch = () => true;

/**
 * CDXC:VoiceMode 2026-11-10 DECISION:
 * User: "I should be able to copy my messages or the agent's messages by long-pressing on them in the voice agent. I should be able to also select text in the transcript." Holding a caption's words starts the phone's own selection, with the system's Copy; holding the caption anywhere else (its "You" / "Agent" name, the padding around the words) copies the whole message, with a haptic and "Copied" in the strip above the buttons (`flashVoiceHint`, which never covers a caption). The names are never selectable.
 *
 * CDXC:VoiceMode 2026-11-11 WHY: On a real iPhone the chat's native hold view (`GhostexSelectionMenuView.swift`) selected the held word with no Copy menu, selected the "Agent" name, and a hold beside the words copied nothing. So on iPhone the words are a read-only system text view (a `TextInput` that cannot be edited), whose hold selects and offers Copy by itself, and the bubble around them is a plain `Pressable` whose long press copies the whole message; no native code is involved. Android keeps the chat's native view, which works there, with the name outside the selectable words.
 */
const Caption = memo(function Caption({ line }: { line: Extract<VoiceLine, { kind: 'caption' }> }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const parts = line.paragraphs.length > 1 ? line.paragraphs : [line.text];
  const shown = parts.map((part, at) =>
    line.cut && at === parts.length - 1 ? (part.trim().length > 0 ? `${part} …` : '…') : part,
  );
  const whole = line.paragraphs.length > 1 ? line.paragraphs.join('\n\n') : line.text;
  const copy = (text: string, haptic: boolean) => {
    if (text.length === 0) return;
    void Clipboard.setStringAsync(text);
    // The native hold gives its own haptic; a JS long press gives the same one here.
    if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    flashVoiceHint('Copied');
  };
  const bubble = [styles.caption, line.role === 'user' ? styles.captionUser : styles.captionAgent];
  const accessibility = {
    accessible: true,
    accessibilityHint: CAPTION_HOLD_HINT,
    accessibilityActions: CAPTION_ACTIONS,
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'longpress') copy(whole, false);
    },
  };
  const name = <Text style={styles.captionWho}>{line.role === 'user' ? 'You' : 'Agent'}</Text>;
  if (Platform.OS === 'ios') {
    return (
      <Pressable style={bubble} onLongPress={() => copy(whole, true)} {...accessibility}>
        {name}
        {shown.map((part, at) => (
          <View key={at} onStartShouldSetResponder={claimTouch}>
            <TextInput
              value={part}
              editable={false}
              multiline
              scrollEnabled={false}
              style={[
                styles.captionText,
                styles.captionWords,
                at > 0 && styles.captionParagraph,
                !line.final && styles.captionDraft,
              ]}
            />
          </View>
        ))}
      </Pressable>
    );
  }
  return (
    <Pressable style={bubble} onLongPress={() => copy(whole, true)} {...accessibility}>
      {name}
      <View onStartShouldSetResponder={claimTouch}>
        <GhostexSelectionMenuView
          onHold={() => copy(whole, false)}
          onSelectionAction={({ nativeEvent }) => {
            if (nativeEvent.action === 'more') copy(whole, false);
            else copy(nativeEvent.text, false);
          }}
        >
          {shown.map((part, at) => (
            <Text
              key={at}
              selectable={MESSAGE_TEXT_SELECTABLE}
              style={[styles.captionText, at > 0 && styles.captionParagraph, !line.final && styles.captionDraft]}
            >
              {part}
            </Text>
          ))}
        </GhostexSelectionMenuView>
      </View>
    </Pressable>
  );
});

function Line({ line }: { line: VoiceLine }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  switch (line.kind) {
    case 'caption':
      return <Caption line={line} />;
    case 'tool':
      return (
        <View style={styles.toolRow}>
          <Text
            style={[
              styles.toolDot,
              {
                color: line.finished
                  ? line.ok
                    ? appearance.accent
                    : appearance.danger
                  : appearance.working,
              },
            ]}
          >
            ●
          </Text>
          <Text style={styles.toolText} numberOfLines={2}>
            {line.label}
          </Text>
        </View>
      );
    case 'announcement':
      return <Text style={styles.announcement}>{line.text}</Text>;
    case 'notice':
      return <Text style={styles.notice}>{line.text}</Text>;
  }
}

export default function VoiceScreen({ navigation }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const voice = useVoiceStore();
  const chatTheme = useTranscriptTheme();
  const { away, jumpToBottom, scrollProps } = useFollowBottom();
  const look = stateLook(voice);
  const active = voiceActive(voice.phase);
  /*
   * While the keyboard is up the state shows small and the buttons step aside, so the text box and
   * its send button always fit above the keyboard (CDXC:VoiceMode 2026-11-11 WHY: on an iPhone 15 Pro
   * Max the big state circle, the buttons and a three-line box were taller than the room left above
   * the keyboard, so the box's last line and its send button sat under it).
   */
  const keyboardUp = useKeyboardTop() !== null;
  const compact = voice.lines.length > 0 || keyboardUp;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === voice.machineId) ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The hold button's finger is off the button: the strip says "Release to cancel". */
  const [holdSlidOff, setHoldSlidOff] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const canPickVoice = active && voice.voiceOptions.length > 0;
  // The conversation reaches under the iPhone Duo's side bar, its lines keep clear of it.
  const linesEdges = useScrollToBarEdges(styles.linesContent);

  /**
   * CDXC:VoiceMode 2026-10-20 DECISION:
   * User: "Show an 'Open <session>' chip on the voice screen". It names the latest session the agent showed (server/src/voice_agent/show.rs), replaces the previous one and goes when the call ends; the phone never opens it on its own. Tapping it opens that session's chat the way the session list does, and the call keeps running behind it.
   */
  const shown = active && machine !== null ? voice.shownSession : null;
  const openShown = () => {
    if (shown === null || machine === null) return;
    const sessionKey = useTerminalStore.getState().openChatTab(machine, {
      sessionId: shown.sessionId,
      projectId: shown.projectId,
      title: shown.title,
    });
    navigation.navigate('Terminal', { sessionKey, machineId: machine.id, title: shown.title });
  };

  const close = () => {
    if (!active) dismissVoice();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Sessions');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* The text box and everything above it stand above the keyboard while it is up. */}
      <KeyboardAvoidingContainer style={styles.body}>
        {/* Everything above the text box; on a short screen it gives way first, so the box never does. */}
        <View style={styles.above}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close the voice screen"
              hitSlop={10}
              style={styles.headerButton}
              onPress={close}
            >
              <ChevronDown color={appearance.foreground} />
            </Pressable>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>Voice agent</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {voice.machineName}
              </Text>
              <View style={styles.voiceChips}>
                {voice.voice !== null ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Voice: ${voiceName(voice.voice)}. Change the voice`}
                    disabled={!canPickVoice}
                    hitSlop={8}
                    style={({ pressed }) => [styles.voiceChip, pressed && styles.controlPressed]}
                    onPress={() => setPickerOpen(true)}
                  >
                    <Text style={styles.voiceChipText} numberOfLines={1}>
                      {`${voiceProviderName(voice.provider)} · ${voiceName(voice.voice)}`}
                    </Text>
                    {canPickVoice ? (
                      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                        <Path
                          d="M 6 9 l 6 6 6 -6"
                          stroke={appearance.muted}
                          strokeWidth={2.4}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                    ) : null}
                  </Pressable>
                ) : null}
                {active ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Speaking speed ${speedLabel(voice.speed)}. Change the speed`}
                    hitSlop={8}
                    style={({ pressed }) => [styles.voiceChip, styles.speedChip, pressed && styles.controlPressed]}
                    onPress={() => setSpeedOpen(true)}
                  >
                    <Text style={styles.speedChipText}>{speedLabel(voice.speed)}</Text>
                    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M 6 9 l 6 6 6 -6"
                        stroke={appearance.muted}
                        strokeWidth={2.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {active ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Voice settings"
                hitSlop={10}
                style={({ pressed }) => [styles.headerButton, pressed && styles.controlPressed]}
                onPress={() => setSettingsOpen(true)}
              >
                <SettingsGlyph size={22} color={appearance.muted} />
              </Pressable>
            ) : (
              <View style={styles.headerButton} />
            )}
          </View>

          {/* Big while nothing has been said yet; once captions arrive it shrinks so they get the room. */}
          <View style={[styles.stateBlock, compact && styles.stateBlockCompact]} accessibilityLiveRegion="polite">
            <View style={[styles.orb, compact && styles.orbCompact, { borderColor: look.color }]}>
              <View style={[styles.orbCore, compact && styles.orbCoreCompact, { backgroundColor: look.color }]} />
            </View>
            <Text style={[styles.stateLabel, compact && styles.stateLabelCompact, { color: readableSecondaryText(look.color, appearance.foreground, [appearance.background, appearance.card, appearance.cardActive]) }]} numberOfLines={2}>
              {look.label}
            </Text>
          </View>

          {voice.problem !== null ? (
            <View style={styles.problem}>
              <Text style={styles.problemText}>{voice.problem.message}</Text>
            </View>
          ) : null}

          <FocusBanner />

          <View style={styles.lines}>
            <ScrollView
              {...scrollProps}
              style={[styles.lines, linesEdges.scroll]}
              contentContainerStyle={[styles.linesContent, linesEdges.content]}
            >
              {voice.phase === 'live' ? <VoiceMemoryCard /> : null}
              {voice.lines.length === 0 && active ? (
                <Text style={styles.hint}>
                  {voice.focus?.gbot !== undefined
                    ? `Talk with ${voice.focus.gbot.name} as you would in its chat.`
                    : voice.focus !== null && !voice.focus.closed
                    ? `Ask what ${voice.focus.title} is doing, or tell it what to do next.`
                    : 'Ask what your agents are doing, or tell one what to do next.'}
                </Text>
              ) : null}
              {voice.lines.map((line) => (
                <Line key={line.key} line={line} />
              ))}
              {voice.phase === 'ended' && voice.endedMessage !== null && voice.problem?.message !== voice.endedMessage ? (
                <Text style={styles.notice}>{voice.endedMessage}</Text>
              ) : null}
            </ScrollView>
            {away ? (
              <View pointerEvents="box-none" style={styles.jumpRow}>
                <IconPill
                  glyph="arrow-down"
                  accessibilityLabel="Scroll to bottom"
                  color={chatTheme.primary}
                  onPress={jumpToBottom}
                />
              </View>
            ) : null}
          </View>

          {shown !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${shown.title}`}
              style={({ pressed }) => [styles.openSession, pressed && styles.controlPressed]}
              onPress={openShown}
            >
              <Text style={styles.openSessionText} numberOfLines={1}>{`Open ${shown.title}`}</Text>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M 9 6 l 6 6 -6 6"
                  stroke={appearance.muted}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          ) : null}

          {/* After the call too: a caption copied then still says "Copied". */}
          {active || voice.phase === 'ended' ? <VoiceStopPill slidOff={holdSlidOff} /> : null}
          {keyboardUp ? null : active ? (
            <View style={styles.controls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={voice.muted ? 'Unmute the microphone' : 'Mute the microphone'}
                style={({ pressed }) => [styles.control, voice.muted && styles.controlOn, pressed && styles.controlPressed]}
                onPress={() => setVoiceMuted(!voice.muted)}
              >
                <MicrophoneGlyph
                  size={30}
                  color={voice.muted ? appearance.accentForeground : appearance.foreground}
                  crossed={voice.muted}
                />
                <Text style={[styles.controlLabel, voice.muted && styles.controlLabelOn]}>
                  {voice.muted ? 'Unmute' : 'Mute'}
                </Text>
              </Pressable>
              <VoiceHoldButton style={styles.control} onSlide={setHoldSlidOff} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hang up"
                style={({ pressed }) => [styles.control, styles.hangUp, pressed && styles.hangUpPressed]}
                onPress={hangUpVoice}
              >
                <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M 3 14 c 5 -5 13 -5 18 0 l -2 3 l -4 -1.5 v -2.5 c -2 -0.6 -4 -0.6 -6 0 v 2.5 l -4 1.5 z"
                    fill={appearance.accentForeground}
                  />
                </Svg>
                <Text style={[styles.controlLabel, styles.controlLabelOn]}>Hang up</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.controls}>
              {machine !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start a new conversation"
                  style={({ pressed }) => [styles.control, styles.wide, styles.controlOn, pressed && styles.controlPressed]}
                  onPress={() =>
                    // Talk again keeps the call's scope: about the same session, unless it was closed.
                    void startVoice(
                      machine,
                      voice.machineName,
                      voice.focus !== null && !voice.focus.closed
                        ? { projectId: voice.focus.projectId, sessionId: voice.focus.sessionId, title: voice.focus.title }
                        : undefined,
                    )
                  }
                >
                  <HeadsetGlyph size={30} color={appearance.accentForeground} />
                  <Text style={[styles.controlLabel, styles.controlLabelOn]}>Talk again</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={({ pressed }) => [styles.control, styles.wide, pressed && styles.controlPressed]}
                onPress={close}
              >
                <Text style={styles.controlLabel}>Close</Text>
              </Pressable>
            </View>
          )}
        </View>
        {active ? <VoiceTextBox /> : null}
      </KeyboardAvoidingContainer>
      <VoicePickerSheet visible={pickerOpen && canPickVoice} onClose={() => setPickerOpen(false)} />
      <VoiceSpeedSheet visible={speedOpen && active} onClose={() => setSpeedOpen(false)} />
      <VoiceSettingsSheet visible={settingsOpen && active} onClose={() => setSettingsOpen(false)} />
    </SafeAreaView>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  root: { flex: 1, backgroundColor: appearance.background },
  body: { flex: 1 },
  above: { flex: 1, minHeight: 0, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerTitles: { flex: 1, alignItems: 'center' },
  title: { color: appearance.foreground, fontSize: 18, fontWeight: '600' },
  subtitle: { color: appearance.muted, fontSize: 14, marginTop: 2 },
  voiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 12,
    minHeight: 32,
    borderRadius: 16,
    backgroundColor: appearance.cardActive,
  },
  voiceChipText: { color: appearance.foreground, fontSize: 15, fontWeight: '600' },
  voiceChips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  focusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: GhostexRadii.section,
    backgroundColor: appearance.card,
  },
  focusText: { flex: 1, color: appearance.muted, fontSize: 16, lineHeight: 22 },
  focusTitle: { color: appearance.foreground, fontWeight: '700' },
  allSessions: {
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: appearance.cardActive,
  },
  allSessionsText: { color: appearance.foreground, fontSize: 14, fontWeight: '600' },
  openSession: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    maxWidth: '90%',
    marginTop: 4,
    paddingHorizontal: 14,
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: appearance.cardActive,
  },
  openSessionText: { flexShrink: 1, color: appearance.foreground, fontSize: 15, fontWeight: '600' },
  speedChip: { paddingHorizontal: 8, minHeight: 26, borderRadius: 13 },
  speedChipText: { color: appearance.foreground, fontSize: 13, fontWeight: '600' },
  sheetTitle: { color: appearance.foreground, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 10 },
  sheetRowTall: { paddingVertical: 8 },
  sheetRowText: { flex: 1, gap: 2 },
  sheetChoiceLabel: { color: appearance.foreground, fontSize: 18 },
  sheetNote: { color: appearance.muted, fontSize: 14, marginTop: 8 },
  sheetCheck: { width: 24, alignItems: 'center' },
  sheetRowLabel: { flex: 1, color: appearance.foreground, fontSize: 18 },
  sheetRowDetail: { color: appearance.muted, fontSize: 14 },
  stateBlock: { alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
  orb: { width: 132, height: 132, borderRadius: 66, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  orbCore: { width: 72, height: 72, borderRadius: 36, opacity: 0.85 },
  stateLabel: { marginTop: 14, fontSize: 26, fontWeight: '700', textAlign: 'center', paddingHorizontal: 24 },
  stateBlockCompact: { flexDirection: 'row', justifyContent: 'center', gap: 16, paddingTop: 4, paddingBottom: 12 },
  orbCompact: { width: 64, height: 64, borderRadius: 32 },
  orbCoreCompact: { width: 34, height: 34, borderRadius: 17 },
  stateLabelCompact: { marginTop: 0, paddingHorizontal: 0, flexShrink: 1 },
  problem: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: GhostexRadii.section,
    backgroundColor: appearance.dangerFill,
  },
  problemText: { color: appearance.foreground, fontSize: 17, lineHeight: 24 },
  lines: { flex: 1 },
  jumpRow: { position: 'absolute', right: 22, bottom: 16 },
  // CDXC:VoiceMode 2026-10-24 WHY: more room between lines so a reply, its tool line and an announcement read apart; the user's decision is in gxserver's paragraphs.rs.
  linesContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 16 },
  hint: { color: appearance.muted, fontSize: 17, textAlign: 'center', marginTop: 8 },
  caption: { borderRadius: GhostexRadii.section, padding: 12, maxWidth: '92%' },
  captionUser: { alignSelf: 'flex-end', backgroundColor: appearance.cardActive },
  captionAgent: { alignSelf: 'flex-start', backgroundColor: appearance.card },
  captionWho: { color: appearance.muted, fontSize: 13, marginBottom: 4 },
  // A read-only system text view drawn like the caption's text (iPhone, `Caption`).
  captionWords: { padding: 0, paddingTop: 0, paddingBottom: 0, margin: 0, backgroundColor: 'transparent' },
  captionText: { color: appearance.foreground, fontSize: 19, lineHeight: 26 },
  captionParagraph: { marginTop: 10 },
  captionDraft: { opacity: 0.7 },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  toolDot: { fontSize: 12 },
  toolText: { color: appearance.muted, fontSize: 15, flex: 1 },
  announcement: { color: appearance.attention, fontSize: 16, paddingHorizontal: 4 },
  notice: { color: appearance.muted, fontSize: 15, fontStyle: 'italic', paddingHorizontal: 4 },
  controls: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  control: {
    flex: 1,
    minHeight: 96,
    borderRadius: GhostexRadii.section,
    backgroundColor: appearance.cardActive,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  wide: { minHeight: 72 },
  controlOn: { backgroundColor: appearance.accent },
  controlPressed: { opacity: 0.75 },
  controlDisabled: { opacity: 0.35 },
  controlLabel: { color: appearance.foreground, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  controlLabelOn: { color: appearance.accentForeground },
  hangUp: { backgroundColor: appearance.danger },
  hangUpPressed: { transform: [{ scale: 0.98 }] },
});
