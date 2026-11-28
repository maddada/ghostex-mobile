/**
 * The voice screen's centre waveform: a row of bars in the state's colour that move while the call
 * listens or speaks and lie flat as dots while it connects, is muted, paused or ended. It shows what
 * the call is doing, not the microphone's level (the phone has no level for a call).
 * SEE-ALSO: the computer's voice panel centre (`apps/desktop/src/app/voice_agent/panel.rs` `empty_body`).
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/** How much the bars move: none (flat dots), a calm listen, or a stronger speak. */
export type WaveMotion = 'flat' | 'calm' | 'strong';

const BARS = 28;
const BAR_WIDTH = 4;
const BAR_GAP = 4;
const MAX_HEIGHT = 40;
const REST_HEIGHT = 4;

/** Each bar's tallest height: highest in the middle, uneven so it reads as a voice. */
const PEAKS = Array.from({ length: BARS }, (_, at) => {
  const envelope = Math.sin((Math.PI * at) / (BARS - 1));
  const grain = 0.45 + 0.55 * Math.abs(Math.sin(at * 1.7));
  return Math.max(REST_HEIGHT, envelope * grain * MAX_HEIGHT);
});

/** How tall the bars may grow for each motion, as a share of their peak. */
const LEVEL: Record<WaveMotion, number> = { flat: 0, calm: 0.6, strong: 1 };

export function VoiceCallWaveform({ color, motion }: { color: string; motion: WaveMotion }) {
  // Two swings out of step, so neighbouring bars rise and fall at different times, and a level that
  // eases between flat, calm and strong. The bars always follow these animated values: a bar that
  // switched to a fixed scale kept the last height the native driver gave it.
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(1)).current;
  const level = useRef(new Animated.Value(LEVEL[motion])).current;

  useEffect(() => {
    const ease = Animated.timing(level, { toValue: LEVEL[motion], duration: 250, useNativeDriver: true });
    ease.start();
    if (motion === 'flat') return () => ease.stop();
    const duration = motion === 'strong' ? 420 : 900;
    const swing = (value: Animated.Value, from: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 1 - from, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(value, { toValue: from, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    const loops = [swing(a, 0), swing(b, 1)];
    loops.forEach((loop) => loop.start());
    return () => {
      ease.stop();
      loops.forEach((loop) => loop.stop());
    };
  }, [a, b, level, motion]);

  // Each bar rests at a dot and grows by the level times its swing.
  const scales = useMemo(
    () =>
      PEAKS.map((peak, at) => {
        const rest = REST_HEIGHT / peak;
        const swing = (at % 2 === 0 ? a : b).interpolate({ inputRange: [0, 1], outputRange: [0.35 * (1 - rest), 1 - rest] });
        return Animated.add(rest, Animated.multiply(level, swing));
      }),
    [a, b, level],
  );

  return (
    <View style={styles.row} accessible={false} importantForAccessibility="no-hide-descendants">
      {PEAKS.map((peak, at) => {
        const scale = scales[at];
        return (
          <Animated.View
            key={at}
            style={[styles.bar, { height: peak, backgroundColor: color, transform: [{ scaleY: scale }] }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: MAX_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: BAR_GAP },
  bar: { width: BAR_WIDTH, borderRadius: BAR_WIDTH / 2 },
});
