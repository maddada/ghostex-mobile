/**
 * The line above the composer while the agent works, drawn from `workingStrip`. Port of desktop
 * `working_strip.rs`: the spark and the stint word (`label`, "Brewing…"), or, when the terminal
 * shows something more specific (compaction, running shells), the activity card with its clock
 * and progress. Every word, clock and percent comes from the document; the strip only animates.
 *
 * The armed Delayed Send / Close After Done items on the right of the row come from the app shell,
 * not the document (desktop's `armed_actions`); the screen builds them from the session's row in the
 * inventory (`armedActions`) and a tap opens Delayed Actions, as desktop's click does.
 */

import { useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import { Glyph as ComposerGlyph } from '../composer/icons';
import { Glyph, Spark } from './icons';
import { isTrue, num, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { PulseDot, SWEEP_EASING, Spinner, StatusCard, useLoop } from './primitives';

/** `packages/gx-chat-core/visual/working-strip.json`. */
const VISUAL = {
  minHeight: 24,
  paddingX: 6,
  gap: 8,
  sparkBox: 16,
  sparkSize: 14,
  fontSize: 12.5,
  pulseMs: 1600,
  spinMs: 9000,
  armedIconGap: 6,
  armedColumnGap: 16,
  armedRowGap: 2,
  delayedSendColor: '#f6c945',
  closeAfterDoneColor: '#ff9aa2',
};

/** One armed timer on the working row (`SessionChatArmedAction` in `armed-actions.ts`). */
export type ArmedAction = { id: 'delayedSend' | 'closeAfterDone'; label: string };

export function WorkingStrip({
  document,
  armed = [],
  onArmedPress,
}: {
  document: ChatDocument;
  armed?: readonly ArmedAction[];
  /** Opens Delayed Actions; without it the items are drawn but not pressable. */
  onArmedPress?: () => void;
}) {
  const styles = useStyles();
  const strip = document.workingStrip;
  const activity = obj(strip?.presentation);
  if (activity !== null) {
    if (armed.length === 0) return <WorkingActivity activity={activity} />;
    return (
      <View style={styles.stack}>
        <WorkingActivity activity={activity} />
        <WorkingRow label={null} armed={armed} onArmedPress={onArmedPress} />
      </View>
    );
  }
  const label = typeof strip?.label === 'string' ? strip.label : null;
  if (label === null && armed.length === 0) return null;
  return <WorkingRow label={label} armed={armed} onArmedPress={onArmedPress} />;
}

/**
 * The working row: spark and word on the left while the agent works, the armed items pushed right,
 * wrapping onto a left-aligned second line when they do not fit (`working_row`).
 */
function WorkingRow({
  label,
  armed,
  onArmedPress,
}: {
  label: string | null;
  armed: readonly ArmedAction[];
  onArmedPress: (() => void) | undefined;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const aria = [label, ...armed.map((action) => action.label)].filter((part): part is string => part !== null).join(', ');
  return (
    <View accessibilityRole="text" accessibilityLabel={aria} style={styles.row}>
      <View style={styles.lead}>
        {label !== null ? (
          <>
            <WorkingSpark />
            <Text style={styles.word} numberOfLines={1}>
              {label}
            </Text>
          </>
        ) : null}
      </View>
      {armed.map((action) => (
        <Pressable
          key={action.id}
          disabled={onArmedPress === undefined}
          onPress={onArmedPress}
          accessibilityRole="button"
          accessibilityLabel={`${action.label}. Manage delayed actions`}
          hitSlop={6}
          style={({ pressed }) => [styles.armed, pressed ? styles.armedPressed : null]}
        >
          <View style={styles.sparkBox}>
            <ComposerGlyph
              name="clock"
              size={VISUAL.sparkSize}
              color={action.id === 'delayedSend' ? VISUAL.delayedSendColor : VISUAL.closeAfterDoneColor}
            />
          </View>
          <Text style={[styles.armedLabel, { color: P.foreground }]}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The spark: a slow turn with a breathing scale and opacity, as `working_spark.rs` draws it. */
function WorkingSpark() {
  const styles = useStyles();
  const P = useTranscriptTheme();
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

/**
 * Compaction and running shells: a status card with the activity, its clock and its progress.
 *
 * CDXC:SessionChat 2026-09-11 DECISION: User: put the compaction hint in an info-circle tooltip immediately right of the title, replacing the visible hint line.
 */
function WorkingActivity({ activity }: { activity: Record<string, unknown> }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const percent = num(activity, 'percent');
  const indeterminate = isTrue(activity, 'indeterminate');
  const elapsed = str(activity, 'elapsedLabel');
  const tokens = str(activity, 'tokens');
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
      {tokens.length > 0 ? <Text style={styles.activityClock}>{tokens}</Text> : null}
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
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const sweep = useLoop(1800, SWEEP_EASING, percent === null);
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

const useStyles = themedStyles((P) => ({
  row: {
    minHeight: VISUAL.minHeight,
    paddingHorizontal: VISUAL.paddingX,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: VISUAL.armedColumnGap,
    rowGap: VISUAL.armedRowGap,
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: VISUAL.gap,
    minWidth: 0,
    flexShrink: 1,
    marginRight: 'auto',
  },
  stack: {
    width: '100%',
    gap: 8,
  },
  armed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: VISUAL.armedIconGap,
    minWidth: 0,
  },
  armedPressed: {
    opacity: 0.8,
  },
  armedLabel: {
    flexShrink: 1,
    fontSize: VISUAL.fontSize,
    lineHeight: VISUAL.fontSize * 1.5,
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
    color: P.ink(0.8),
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: P.ink(0.1),
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
}));
