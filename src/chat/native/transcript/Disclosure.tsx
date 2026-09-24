/**
 * The pieces every fold in the transcript is built from: the heading with its chevron in the
 * marker column (`disclosure` in desktop's `transcript.rs`), the rail that hangs an open body off
 * its heading (`disclosure_body.rs`, React's `SessionChatExpansion`), and the reply dot a plain
 * prose lane hangs from (`reply_marker` / `lane_marker`).
 */

import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranscriptEnv } from './context';
import { Glyph } from './icons';
import { MARKER_INSET, MARKER_SLOT, PROSE_LINE, PROSE_SIZE } from './theme';

/**
 * Where a row is drawn: inside a finished turn's work fold, rows keep their tool pairs as plain rows
 * (`in_work_fold`), and every row of a finished turn hides its writes, which belong to the turn's
 * "N files changed" fold instead (`hide_file_changes`).
 */
export type FoldPlace = { inWorkFold: boolean; hideFileChanges: boolean };
const FoldContext = createContext<FoldPlace>({ inWorkFold: false, hideFileChanges: false });
export const FoldPlaceProvider = FoldContext.Provider;
export function useFoldPlace(): FoldPlace {
  return useContext(FoldContext);
}

/** The chevron slot in the marker column. */
export function Chevron({ open, color, size = 14 }: { open: boolean; color: string; size?: number }) {
  return (
    <View style={styles.markerSlot}>
      <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={size} color={color} />
    </View>
  );
}

/** The bullet a prose lane hangs its first line from. */
export function LaneMarker({ color }: { color: string }) {
  return (
    <View style={styles.markerSlot}>
      <View style={[styles.bullet, { backgroundColor: color }]} />
    </View>
  );
}

/** A heading that opens and closes the rows below it. */
export function DisclosureHeading({
  label,
  open,
  onToggle,
  color,
  medium = false,
}: {
  label: ReactNode;
  open: boolean;
  onToggle(): void;
  color?: string;
  medium?: boolean;
}) {
  const { theme } = useTranscriptEnv();
  const tone = color ?? theme.primary;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole='button'
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [styles.heading, pressed && { backgroundColor: theme.pressed }]}
    >
      <Chevron open={open} color={tone} />
      {typeof label === 'string' ? (
        <Text style={[styles.headingText, { color: tone }, medium && styles.medium]}>{label}</Text>
      ) : (
        <View style={styles.headingBody}>{label}</View>
      )}
    </Pressable>
  );
}

/**
 * An open disclosure's rows on the rail that says they belong to the heading above. Pressing the
 * rail closes the disclosure, as React's `.ghostex-chat-expansion-rail` button does.
 */
export function DisclosureBody({
  onCollapse,
  label,
  gap = 8,
  rail = 'marker',
  children,
}: {
  onCollapse(): void;
  label: string;
  gap?: number;
  rail?: 'marker' | 'tool';
  children: ReactNode;
}) {
  const { theme } = useTranscriptEnv();
  // The centre of the two-pixel line, from the row's left edge (`DisclosureRail::centre`).
  const centre = rail === 'marker' ? 2.5 : 15;
  return (
    <View style={[styles.body, { marginLeft: centre - RAIL_BOX / 2 }]}>
      <Pressable onPress={onCollapse} accessibilityRole='button' accessibilityLabel={label} style={styles.railBox}>
        {({ pressed }) => (
          <View style={[styles.rail, { backgroundColor: pressed ? theme.foreground : theme.muted, opacity: pressed ? 1 : 0.42 }]} />
        )}
      </Pressable>
      <View style={[styles.bodyColumn, { gap }]}>{children}</View>
    </View>
  );
}

const RAIL_BOX = 15;

const styles = StyleSheet.create({
  markerSlot: {
    width: MARKER_SLOT,
    height: PROSE_LINE,
    marginLeft: MARKER_INSET,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bullet: { width: 4, height: 4, borderRadius: 2 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: 4 },
  headingText: { flex: 1, minWidth: 0, fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  headingBody: { flex: 1, minWidth: 0 },
  medium: { fontWeight: '500' },
  body: { flexDirection: 'row', minWidth: 0, gap: 7 },
  railBox: { width: RAIL_BOX, alignItems: 'center', flexShrink: 0 },
  rail: { width: 2, flex: 1, borderRadius: 1 },
  bodyColumn: { flex: 1, minWidth: 0 },
});
