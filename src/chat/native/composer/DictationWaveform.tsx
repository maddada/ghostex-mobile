/**
 * The recording row's live waveform: the microphone's level over the last 1.8 seconds as thin bars
 * that scroll in from the right, so the speaker sees their voice reaching the recording. The same
 * bars as the desktop's pill (`waveform` in `apps/desktop/src/app/native_chat/dictation.rs`).
 * Levels come from `voice/dictationLevel.ts`; only this view redraws for them.
 */

import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useReduceMotion } from '../../../components/common/reduceMotion';
import { watchDictationLevel } from '../../../voice/dictationLevel';
import { useTranscriptTheme } from '../transcript/theme';

/** Bars shown (1.8 s); one is added every 50 ms. */
export const WAVEFORM_BARS = 36;
/** A silent bar's height, as a share of the full height. */
const REST_SCALE = 0.2;
const BAR_WIDTH = 2.5;
const BAR_GAP = 2;
const HEIGHT = 18;

const resting = (): number[] => Array<number>(WAVEFORM_BARS).fill(0);

/** The bars for `levels` (oldest first), as drawn. Exported for previews. */
export function WaveformBars({ levels }: { levels: readonly number[] }) {
  const P = useTranscriptTheme();
  const reduceMotion = useReduceMotion();
  return (
    <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {levels.map((level, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              backgroundColor: P.foreground,
              opacity: 0.3 + level * 0.55,
              height: HEIGHT * (reduceMotion ? 0.4 : Math.max(REST_SCALE, level)),
            },
          ]}
        />
      ))}
    </View>
  );
}

/** The waveform of recording `recordingId` while it records; resting bars without one. */
export const DictationWaveform = memo(function DictationWaveform({ recordingId }: { recordingId: string | null }) {
  const [levels, setLevels] = useState(resting);
  useEffect(() => {
    setLevels(resting());
    if (recordingId === null) return undefined;
    return watchDictationLevel(recordingId, (level) => setLevels((shown) => [...shown.slice(1), level]));
  }, [recordingId]);
  return <WaveformBars levels={levels} />;
});

const styles = StyleSheet.create({
  wave: {
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: BAR_GAP,
    overflow: 'hidden',
    flexShrink: 1,
    minWidth: 0,
  },
  bar: { width: BAR_WIDTH, borderRadius: BAR_WIDTH / 2 },
});
