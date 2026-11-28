/**
 * The voice screen's hold button: a waveform and words that say what holding does now ("Hold to
 * talk", "Hold to unmute", "Let go to send" while held), dimmed when holding does nothing. Press and
 * hold to talk (or, in a muted Regular call, to unmute); let go to send. Sliding the finger off
 * shows "Release to cancel" and letting go there sends nothing; sliding back keeps talking.
 *
 * CDXC:VoiceMode 2026-10-24 DECISION: User, asked "On the phone, what happens when your finger slides off the hold button?", picked "It cancels: "Release to cancel", and sliding back on keeps talking". Built on the touch responder, not `Pressable`, whose `onPressOut` fired as soon as the finger left the button's press area and sent the turn early.
 * CDXC:VoiceMode 2026-11-28 DECISION: User, on the voice screen's button with only a waveform: "the button in the middle there doesn't have text ... I don't know what it does", then picked "Always there, labelled with what holding does ("Hold to talk", "Hold to unmute"), dimmed when it does nothing". The button always shows its words beside the waveform and stays in place in every state, so the buttons never move. Supersedes the 2026-10-24 decision "On the phone it's icon-only beside Mute; keep it a comfortable size to hold, but no label."
 * SEE-ALSO: server/src/voice_agent/talk.rs (what a hold does), apps/desktop/src/app/voice_agent/panel_controls.rs (the computer's button).
 */

import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useAppearance } from '../theme/useAppearance';
import { cancelVoiceTalking, setVoiceTalking, useVoiceStore, voiceHoldMode } from './conversation';

/** How far past the button's edge the finger may wander before it counts as slid off. */
const SLIDE_SLOP = 24;

export function WaveformGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 4 10 v 4 M 8 7 v 10 M 12 4 v 16 M 16 7 v 10 M 20 10 v 4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** The button's words for what holding does now (`voiceHoldMode`); a hold that does nothing keeps "Hold to talk", dimmed. */
function holdWords(mode: ReturnType<typeof voiceHoldMode>, held: boolean): string {
  if (held) return 'Let go to send';
  return mode === 'unmute' ? 'Hold to unmute' : 'Hold to talk';
}

/** `onSlide` tells the screen whether the finger is off the button, for "Release to cancel". */
export function VoiceHoldButton({ style, onSlide }: { style: ViewStyle; onSlide: (off: boolean) => void }) {
  const appearance = useAppearance();
  const voice = useVoiceStore();
  const mode = voiceHoldMode(voice);
  const ready = mode === 'talk' || mode === 'unmute';
  const size = useRef({ width: 0, height: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const offRef = useRef(false);
  const [off, setOff] = useState(false);

  const setSlid = (next: boolean) => {
    if (offRef.current === next) return;
    offRef.current = next;
    setOff(next);
    onSlide(next);
    if (next) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };

  const outside = (event: GestureResponderEvent): boolean => {
    const x = event.nativeEvent.pageX - origin.current.x;
    const y = event.nativeEvent.pageY - origin.current.y;
    const { width, height } = size.current;
    return x < -SLIDE_SLOP || y < -SLIDE_SLOP || x > width + SLIDE_SLOP || y > height + SLIDE_SLOP;
  };

  const press = (event: GestureResponderEvent) => {
    // The children ignore touches, so the location is within this view.
    origin.current = {
      x: event.nativeEvent.pageX - event.nativeEvent.locationX,
      y: event.nativeEvent.pageY - event.nativeEvent.locationY,
    };
    offRef.current = false;
    setOff(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setVoiceTalking(true);
  };

  /** Lifting the finger (or the system taking the touch, like the screen locking): off the button cancels. */
  const release = () => {
    const slidOff = offRef.current;
    setSlid(false);
    if (!useVoiceStore.getState().talking) return;
    if (slidOff) {
      cancelVoiceTalking();
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => undefined);
      setVoiceTalking(false);
    }
  };

  const held = voice.talking;
  // A hold that does nothing dims the whole button (`unavailable`), so its words stay readable.
  const ink = held && off ? appearance.danger : appearance.foreground;
  const accessibilityLabel =
    mode === 'mutedLock'
      ? 'Unmute to talk'
      : mode === 'alreadyHeard'
        ? 'Hold to talk while muted'
        : mode === 'unmute'
          ? 'Hold to unmute'
          : 'Hold to talk';
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Hold and speak, then let go to send. Slide off to cancel."
      accessibilityState={{ disabled: !ready, selected: held }}
      // A screen reader taps once to start and once to send, since holding is hard to do with one.
      accessibilityActions={[{ name: 'activate', label: held ? 'Send' : 'Start talking' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') setVoiceTalking(!useVoiceStore.getState().talking);
      }}
      onLayout={(event: LayoutChangeEvent) => {
        size.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
      }}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={press}
      onResponderMove={(event) => {
        if (useVoiceStore.getState().talking) setSlid(outside(event));
      }}
      onResponderRelease={release}
      onResponderTerminate={release}
      style={[
        style,
        ready ? { backgroundColor: appearance.primaryFill } : styles.unavailable,
        held &&
          (off
            ? [styles.slidOff, { backgroundColor: appearance.dangerFill, borderColor: appearance.danger }]
            : [styles.held, { backgroundColor: appearance.primaryFillPressed, borderColor: appearance.border }]),
      ]}
    >
      <View pointerEvents="none" style={styles.content}>
        <WaveformGlyph size={20} color={ink} />
        <Text style={[styles.label, { color: ink }]} numberOfLines={2}>
          {holdWords(mode, held)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  label: { flexShrink: 1, fontSize: 15, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  unavailable: { opacity: 0.45 },
  held: {
    transform: [{ scale: 0.96 }],
    borderWidth: 2,
  },
  slidOff: {
    borderWidth: 2,
    borderStyle: 'dashed',
  },
});
