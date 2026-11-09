/**
 * The count pills at the right of a "Worked for" row (desktop `work_summary` in
 * `completed_work_row.rs`), always on one line: when they don't fit, the last ones drop their
 * label and show icon and count ("🔧 7"), and only if that still doesn't fit the last ones go into
 * one "+N" pill. The row's accessibility label still names every count.
 *
 * CDXC:SessionChat 2026-11-10 DECISION: User, of a "Worked for" row whose four pills ("7 tool calls", "1 file", "2 messages", "1 answer") wrapped onto two lines and were clipped: "Don't wrap and don't grow the row: follow the rule the pills row above the chat box just got": labels drop from the right, then one "+N". Supersedes the 2026-10-11 rule that the pills wrap among themselves. Sizes the row with the chat box's own `planStrip` (`../cards/PillsStrip.tsx`); desktop `stat_pills` in completed_work_row.rs matches.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { WorkStat } from '../../rust/document';
import { planStrip } from '../cards/PillsStrip';
import type { GlyphName } from './icons';
import { SingleLinePill } from './singleLineCard';
import { useTranscriptEnv } from './context';

/** The gap between two pills, as the row's own `gap`. */
const GAP = 6;
/** The "+N" pill's width before it has been measured. */
const OVERFLOW_ESTIMATE = 40;

function statGlyph(kind: WorkStat['kind']): GlyphName {
  switch (kind) {
    case 'files':
      return 'pencil';
    case 'images':
      return 'photo';
    case 'messages':
      return 'messages';
    case 'answers':
      return 'message-question';
    case 'failed':
    case 'recovered':
      return 'alert-triangle';
    default:
      return 'tool';
  }
}

/** A stat's count without its words: the number its label opens with ("7 tool calls" → "7"). */
export function statCount(label: string): string {
  return label.split(' ')[0] ?? label;
}

export function StatPills({ stats }: { stats: readonly WorkStat[] }) {
  const { theme } = useTranscriptEnv();
  const [avail, setAvail] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const measure = (key: string) => (event: { nativeEvent: { layout: { width: number } } }) => {
    const width = event.nativeEvent.layout.width;
    setWidths((was) => (Math.abs((was[key] ?? -1) - width) < 0.5 ? was : { ...was, [key]: width }));
  };
  const pill = (stat: WorkStat, collapsed: boolean) => {
    const failed = stat.kind === 'failed' || stat.kind === 'recovered';
    return (
      <SingleLinePill
        icon={statGlyph(stat.kind)}
        label={collapsed ? statCount(stat.label) : stat.label}
        color={failed ? theme.error : theme.cardMuted}
      />
    );
  };
  const known = stats.every(
    (stat) => widths[`full:${stat.kind}`] !== undefined && widths[`icon:${stat.kind}`] !== undefined,
  );
  const plan =
    avail > 0 && known
      ? planStrip(
          avail,
          [],
          stats.map((stat) => ({ full: widths[`full:${stat.kind}`] ?? 0, icon: widths[`icon:${stat.kind}`] ?? 0 })),
          widths.overflow ?? OVERFLOW_ESTIMATE,
          GAP,
        )
      : { hidden: 0, collapsed: 0 };
  const visible = stats.length - plan.hidden;
  return (
    <View style={styles.fit} onLayout={(event) => setAvail(event.nativeEvent.layout.width)}>
      <View style={styles.row}>
        {stats.slice(0, visible).map((stat, index) => (
          <View key={stat.kind}>{pill(stat, index >= visible - plan.collapsed)}</View>
        ))}
        {plan.hidden > 0 ? (
          <View onLayout={measure('overflow')}>
            <SingleLinePill label={`+${plan.hidden}`} color={theme.cardMuted} />
          </View>
        ) : null}
      </View>
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {stats.map((stat) => (
          <View key={stat.kind} style={styles.measureRow}>
            <View onLayout={measure(`full:${stat.kind}`)}>{pill(stat, false)}</View>
            <View onLayout={measure(`icon:${stat.kind}`)}>{pill(stat, true)}</View>
          </View>
        ))}
        {plan.hidden === 0 && widths.overflow === undefined ? (
          <View onLayout={measure('overflow')}>
            <SingleLinePill label={`+${stats.length}`} color={theme.cardMuted} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** The room right of the title; the pills sit at its right end, whole. */
  fit: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
  },
  /** The pills drawn invisibly to know their widths, with and without their words. */
  measure: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
    alignItems: 'flex-start',
  },
  measureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
