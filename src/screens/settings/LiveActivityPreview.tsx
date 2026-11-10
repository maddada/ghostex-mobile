/**
 * What the Live Activity switches control, drawn once with sample agents (the
 * design's preview, so that it is clear what the switches control). A picture of
 * the Lock Screen card, not live data: the real one is rendered by the widget extension
 * (modules/ghostex-live-activity/ios/Extension/GhostexActivityViews.swift), whose colours and words it repeats.
 * `showSessionNames` is the "Show session names" switch: on, a row leads with its agent's mark and its session's
 * sample name, since the mark is then what tells the agent, as on the real card; off, it is drawn as before the
 * switch, with the agent's name and no mark.
 */

import { useMemo } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import { agentIconTint } from '../../contract/mobileSummary';
import { LiveActivityCopy } from '../../copy';
import { GhostexPalette, SidebarPalette } from '../../theme/palette';
import { readableSecondaryText } from '../../theme/sidebarAppearance';

type PreviewState = (typeof LiveActivityCopy.previewRows)[number]['state'];
type PreviewIcon = (typeof LiveActivityCopy.previewRows)[number]['icon'];

/** Glyphs of the design (24-unit paths), so colour never carries the state alone. */
const GLYPHS: Record<PreviewState, { path: string; color: string; word: string }> = {
  working: { path: 'M12 3a9 9 0 1 1-9 9', color: SidebarPalette.ROW_WORKING, word: LiveActivityCopy.working },
  waiting: {
    path: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5V12l3 2',
    color: SidebarPalette.ROW_ATTENTION,
    word: LiveActivityCopy.waiting,
  },
  question: {
    path: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.6M12 17h.01',
    color: SidebarPalette.ROW_QUESTION,
    word: LiveActivityCopy.question,
  },
  finished: {
    path: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8 12.5l2.7 2.7L16 10',
    color: GhostexPalette.MUTED,
    word: LiveActivityCopy.finished,
  },
};

function Glyph({ state, size }: { state: PreviewState; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={GLYPHS[state].path}
        stroke={GLYPHS[state].color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The size of the agent's mark in a row (the real card's is 18 pt in a 29 pt row). */
const MARK_SIZE = 16;

/**
 * An agent's mark in its own tint, as the session list and the real card draw it. The real card is always dark;
 * this one follows the theme, so a tint too light for the card (Codex's white on a light card) moves toward the
 * text colour as far as the card needs.
 */
function markColor(icon: PreviewIcon, appearance: Appearance): string {
  return readableSecondaryText(agentIconTint(icon), appearance.foreground, [appearance.card]);
}

export default function LiveActivityPreview({ showSessionNames }: { showSessionNames: boolean }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const marks = useMemo(
    () =>
      LiveActivityCopy.previewRows.map((row) => {
        const Mark = AGENT_ICONS[row.icon];
        return Mark === undefined ? null : <Mark size={MARK_SIZE} color={markColor(row.icon, appearance)} />;
      }),
    [appearance],
  );
  return (
    <View
      style={styles.frame}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        showSessionNames ? LiveActivityCopy.previewLabelWithSessionNames : LiveActivityCopy.previewLabel
      }
    >
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.count}>
            <Glyph state="working" size={14} />
            <Text style={styles.headText}>
              <Text style={styles.number}>1</Text> {LiveActivityCopy.working}
            </Text>
          </View>
          <View style={styles.count}>
            <Glyph state="waiting" size={14} />
            <Text style={styles.headText}>
              <Text style={styles.number}>2</Text> {LiveActivityCopy.waiting}
            </Text>
          </View>
          <Text style={styles.more}>{LiveActivityCopy.more(1)}</Text>
        </View>
        {LiveActivityCopy.previewRows.map((row, index) => (
          <View key={`${row.agent}:${row.project}`} style={[styles.row, index > 0 && styles.rowDivider]}>
            {showSessionNames ? <View style={styles.mark}>{marks[index]}</View> : null}
            <View style={styles.identity}>
              <Text style={[styles.agent, row.state === 'finished' && styles.secondary]} numberOfLines={1}>
                {showSessionNames ? row.session : row.agent}
              </Text>
              <Text style={styles.project} numberOfLines={1}>
                {row.project}
              </Text>
            </View>
            <View style={styles.state}>
              <Glyph state={row.state} size={13} />
              <Text style={styles.stateText}>{GLYPHS[row.state].word}</Text>
            </View>
            <Text style={styles.time}>{row.time}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  frame: {
    borderRadius: 28,
    padding: 14,
    backgroundColor: appearance.background,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: appearance.border,
    backgroundColor: appearance.card,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 20,
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headText: {
    color: appearance.foreground,
    fontSize: 13,
  },
  number: {
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  more: {
    marginLeft: 'auto',
    color: appearance.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 29,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  mark: {
    width: 18,
    alignItems: 'center',
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    minWidth: 0,
  },
  agent: {
    color: appearance.foreground,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 0,
  },
  secondary: {
    color: appearance.muted,
  },
  project: {
    color: appearance.muted,
    fontSize: 13,
    flexShrink: 1,
  },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stateText: {
    color: appearance.foreground,
    fontSize: 12,
    fontWeight: '600',
  },
  time: {
    width: 38,
    textAlign: 'right',
    color: appearance.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
