/**
 * The recording pill's live waveform: the microphone's recent levels as thin bars that scroll in
 * from the right and fill the room the pill leaves them, so the speaker sees their voice reaching
 * the recording. Each bar eases to its new height on the UI thread (Reanimated), so a level never
 * re-renders React. The same bars as the desktop's pill (`waveform` in
 * `apps/desktop/src/app/native_chat/dictation.rs`). Levels come from `voice/dictationLevel.ts`.
 *
 * CDXC:Dictate 2026-11-13 DECISION: User (Q2917 "reanimated"): the bars glide like the reference app's (a 100 ms ease on the UI thread, as many bars as fit) instead of stepping every 50 ms through React. Q2919: the pill keeps its look in a quiet room, and after 3 seconds of near-silence it says "Can't hear you" until sound comes back (`onQuiet`; user: "add the 3 seconds can't hear you thingy").
 */

import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { watchDictationLevel } from '../../../voice/dictationLevel';
import { useTranscriptTheme } from '../transcript/theme';

/** The most levels kept (3.2 s at one every 50 ms); the pill shows as many as fit. */
export const WAVEFORM_SAMPLES = 64;
/** A silent bar's height, as a share of the full height. */
const REST_SCALE = 0.2;
const BAR_WIDTH = 2.5;
const BAR_GAP = 2;
const HEIGHT = 18;
/** Below this level the microphone counts as hearing nothing (about -40 dBFS). */
const QUIET_LEVEL = 0.04;
/** How long near-silence lasts before the pill says it can't hear (Q2919). */
export const QUIET_MS = 3_000;
const EASE = { duration: 100, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System } as const;

const silent = (): number[] => Array<number>(WAVEFORM_SAMPLES).fill(0);

const Bar = memo(function Bar({
  levels,
  index,
  color,
}: {
  levels: SharedValue<number[]>;
  index: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const level = levels.value[index] ?? 0;
    return {
      opacity: withTiming(0.3 + level * 0.55, EASE),
      transform: [{ scaleY: withTiming(Math.max(REST_SCALE, level), EASE) }],
    };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
});

/** Bars for `levels` (oldest first, the newest last), as many as `count`. */
function Bars({ levels, count }: { levels: SharedValue<number[]>; count: number }) {
  const P = useTranscriptTheme();
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <Bar key={index} levels={levels} index={WAVEFORM_SAMPLES - count + index} color={P.foreground} />
      ))}
    </>
  );
}

/**
 * The waveform of recording `recordingId` while it records; resting bars without one. `onQuiet`
 * hears when near-silence has lasted [QUIET_MS], and when sound comes back.
 */
export const DictationWaveform = memo(function DictationWaveform({
  recordingId,
  onQuiet,
}: {
  recordingId: string | null;
  onQuiet?: (quiet: boolean) => void;
}) {
  const levels = useSharedValue<number[]>(silent());
  const [count, setCount] = useState(0);
  const quietRef = useRef(onQuiet);
  quietRef.current = onQuiet;
  useEffect(() => {
    levels.value = silent();
    quietRef.current?.(false);
    if (recordingId === null) return undefined;
    const started = Date.now();
    let loudAt = started;
    let quiet = false;
    return watchDictationLevel(recordingId, (level) => {
      levels.value = [...levels.value.slice(1), level];
      const now = Date.now();
      if (level >= QUIET_LEVEL) loudAt = now;
      const nowQuiet = now - loudAt >= QUIET_MS;
      if (nowQuiet !== quiet) {
        quiet = nowQuiet;
        quietRef.current?.(quiet);
      }
    });
  }, [recordingId, levels]);
  const measure = (event: LayoutChangeEvent) => {
    const fit = Math.floor((event.nativeEvent.layout.width + BAR_GAP) / (BAR_WIDTH + BAR_GAP));
    setCount(Math.max(1, Math.min(WAVEFORM_SAMPLES, fit)));
  };
  return (
    <View
      style={styles.wave}
      onLayout={measure}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Bars levels={levels} count={count} />
    </View>
  );
});

const styles = StyleSheet.create({
  wave: {
    flex: 1,
    minWidth: 0,
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: BAR_GAP,
    overflow: 'hidden',
  },
  bar: { width: BAR_WIDTH, height: HEIGHT, borderRadius: BAR_WIDTH / 2 },
});
