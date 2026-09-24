/**
 * The line above the composer while the agent works, drawn from `workingStrip`. Port of desktop
 * `working_strip.rs`: the spark and the stint word (`label`, "Brewing…"), or, when the terminal
 * shows something more specific (compaction, running shells), the activity card with its clock
 * and progress. Every word, clock and percent comes from the document; the strip only animates.
 *
 * Desktop's armed Delayed Send / Close After Done items come from the app shell, not the
 * document, and the phone has no Delayed Actions modal, so they are not drawn.
 */

import { useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import { Glyph, Spark } from './icons';
import { isTrue, num, obj, str } from './json';
import { ChatCardPalette as P } from './palette';
import { PulseDot, Spinner, StatusCard, useLoop } from './primitives';

/** `packages/shared/session-chat-presentation/working-strip.json`. */
const VISUAL = { minHeight: 24, paddingX: 6, gap: 8, sparkBox: 16, sparkSize: 14, fontSize: 12.5, pulseMs: 1600, spinMs: 9000 };

export function WorkingStrip({ document }: { document: ChatDocument }) {
  const strip = document.workingStrip;
  const activity = obj(strip?.presentation);
  if (activity !== null) return <WorkingActivity activity={activity} />;
  const label = typeof strip?.label === 'string' ? strip.label : null;
  if (label === null) return null;
  return (
    <View accessibilityRole="text" accessibilityLabel={label} style={styles.row}>
      <WorkingSpark />
      <Text style={styles.word} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The spark: a slow turn with a breathing scale and opacity, as `working_spark.rs` draws it. */
function WorkingSpark() {
  const pulse = useLoop(VISUAL.pulseMs, Easing.linear);
  const spin = useLoop(VISUAL.spinMs, Easing.linear);
  const breathe = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] });
  return (
    <View style={styles.sparkBox}>
      <Animated.View
        style={{
          opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
            { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.12] }) },
          ],
        }}
      >
        <Spark size={VISUAL.sparkSize} color={P.foreground} />
      </Animated.View>
    </View>
  );
}

/** Compaction and running shells: a status card with the activity, its clock and its progress. */
function WorkingActivity({ activity }: { activity: Record<string, unknown> }) {
  const percent = num(activity, 'percent');
  const indeterminate = isTrue(activity, 'indeterminate');
  const elapsed = str(activity, 'elapsedLabel');
  const hint = str(activity, 'hint');
  const header = (
    <View style={styles.activityHeader}>
      <View style={styles.activityLead}>
        {isTrue(activity, 'shellsRunning') ? (
          <Spinner size={14} color={P.controlPrimary} />
        ) : (
          <PulseDot size={6} color={P.controlPrimary} active />
        )}
      </View>
      <View style={styles.activityTitle}>
        <Text style={styles.activityLabel}>{str(activity, 'label')}</Text>
        {hint.length > 0 ? (
          <View accessibilityLabel={hint} accessible>
            <Glyph name="info-circle" size={14} color={P.muted} />
          </View>
        ) : null}
      </View>
      {elapsed.length > 0 ? <Text style={styles.activityClock}>{elapsed}</Text> : null}
      {percent !== null ? <Text style={styles.activityPercent}>{`${percent}%`}</Text> : null}
    </View>
  );
  const body =
    percent !== null || indeterminate
      ? [<ProgressTrack key="progress" percent={percent} />]
      : [];
  return (
    <View accessibilityRole="progressbar" style={styles.fill}>
      <StatusCard header={header} body={body} />
    </View>
  );
}

function ProgressTrack({ percent }: { percent: number | null }) {
  const [width, setWidth] = useState(0);
  const sweep = useLoop(1800, Easing.inOut(Easing.cubic), percent === null);
  return (
    <View style={styles.track} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {percent !== null ? (
        <View style={[styles.trackFill, { width: `${Math.max(0, Math.min(100, percent))}%` }]} />
      ) : (
        <Animated.View
          style={[
            styles.trackFill,
            styles.trackSweep,
            { transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-0.35 * width, width] }) }] },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: VISUAL.minHeight,
    paddingHorizontal: VISUAL.paddingX,
    flexDirection: 'row',
    alignItems: 'center',
    gap: VISUAL.gap,
  },
  sparkBox: {
    width: VISUAL.sparkBox,
    height: VISUAL.sparkBox,
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    flexShrink: 1,
    color: P.muted,
    fontSize: VISUAL.fontSize,
    lineHeight: VISUAL.fontSize * 1.5,
  },
  fill: {
    width: '100%',
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activityLead: {
    height: 22,
    justifyContent: 'center',
  },
  activityTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activityLabel: {
    flexShrink: 1,
    color: P.foreground,
    fontSize: 14,
    lineHeight: 22,
  },
  activityClock: {
    color: P.muted,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  activityPercent: {
    color: 'rgba(252,252,252,0.8)',
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(252,252,252,0.1)',
  },
  trackFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: P.controlPrimary,
  },
  trackSweep: {
    position: 'absolute',
    left: 0,
    width: '35%',
  },
});
