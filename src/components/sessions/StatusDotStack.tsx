/**
 * The overlapping status dots a machine tab or a Space shows, ported from
 * apps/desktop/src/app/native_sidebar/status.rs `status_dot_stack`: each dot
 * keeps its session-row size (8dp working and background work, 7dp attention)
 * inside a thin ring in the surface color, and each overlaps the one before it
 * by half; blue sits rightmost and on top, orange in the middle, the grey
 * background-work dot (never shown together with orange) behind them.
 */

import { StyleSheet, View } from 'react-native';

import { SidebarPalette } from '../../theme/palette';
import { ds } from './rows';

const RING = ds(1.5);

function Dot({ size, color, first, ringColor }: { size: number; color: string; first: boolean; ringColor: string }) {
  const box = ds(size) + 2 * RING;
  return (
    <View
      style={[
        styles.dot,
        {
          width: box,
          height: box,
          borderColor: ringColor,
          backgroundColor: color,
          marginLeft: first ? 0 : -(ds(4) + 2 * RING),
        },
      ]}
    />
  );
}

export default function StatusDotStack({
  workingCount,
  attentionCount,
  backgroundWorkCount,
  ringColor,
}: {
  workingCount: number;
  attentionCount: number;
  backgroundWorkCount: number;
  /** The surface the stack sits on, so each covered edge stays readable. */
  ringColor: string;
}) {
  const background = workingCount === 0 && backgroundWorkCount > 0;
  if (workingCount === 0 && attentionCount === 0 && !background) return null;
  return (
    <View style={styles.stack}>
      {background ? (
        <Dot size={8} color={SidebarPalette.ROW_BACKGROUND_WORK} first ringColor={ringColor} />
      ) : null}
      {workingCount > 0 ? <Dot size={8} color={SidebarPalette.ROW_WORKING} first ringColor={ringColor} /> : null}
      {attentionCount > 0 ? (
        <Dot
          size={7}
          color={SidebarPalette.ROW_ATTENTION}
          first={!background && workingCount === 0}
          ringColor={ringColor}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
  dot: {
    borderRadius: 999,
    borderWidth: RING,
  },
});
