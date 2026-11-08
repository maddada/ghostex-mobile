/**
 * Chief's row under the Spaces tabs, drawn like a project header (rows.tsx `SidebarHeaderBox`): no
 * border, the header's box, insets and light title. The flower sits in the project-icon column and
 * "Chief" where project names start (Q1882); the chevron gutter holds the project's chevron, dimmed
 * and doing nothing while only this computer has a Chief, and the normal fold chevron once other
 * computers have one, whose Chiefs fold under it like a project's sessions
 * (contract/chief.ts). A
 * tap on the row opens the chat; a tap on the chevron folds. The desktop draws the same row
 * (apps/desktop/src/app/native_sidebar/chief_row_view.rs, CDXC:Chief 2026-11-08 there).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CHIEF_LABEL, chiefCounts, chiefHasDot as hasDot, type ChiefRowModel } from '../../contract/chief';
import type { GhostexSession } from '../../contract/mobileSummary';
import { ChevronRightGlyph, FlowerGlyph } from './icons';
import { HEADER_CHEVRON_INSET, TOUCH_ROW_HEIGHT, ds, inkStyleSheets, inkWash, useSidebarInk } from './rows';
import StatusDotStack from './StatusDotStack';

export { CHIEF_LABEL } from '../../contract/chief';

export default function ChiefRow({
  rows,
  onOpen,
  onPickAgent,
  onMenu,
}: {
  /** contract/chief.ts `chiefRows`: the selected computer's first. */
  rows: readonly ChiefRowModel[];
  /** Opens a Chief's chat. */
  onOpen: (row: ChiefRowModel & { session: GhostexSession }) => void;
  /** The selected computer's Chief was never opened: ask which agent runs it. */
  onPickAgent: (machineId: string) => void;
  /** Long press: New Chat, Change Agent. */
  onMenu: (row: ChiefRowModel & { session: GhostexSession }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ink = useSidebarInk();
  const styles = chiefStyles(ink);
  const [main, ...others] = rows;
  if (main === undefined) return null;
  const mainSession = main.session;
  const counts = mainSession === null ? null : chiefCounts(mainSession);
  const folds = others.some((row) => row.session !== null);
  const unfolded = expanded && folds;
  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={CHIEF_LABEL}
        onPress={() => (mainSession === null ? onPickAgent(main.machineId) : onOpen({ ...main, session: mainSession }))}
        onLongPress={mainSession === null ? undefined : () => onMenu({ ...main, session: mainSession })}
        style={({ pressed }) => [styles.header, pressed ? styles.pressed : null]}
      >
        {folds ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unfolded ? `Fold ${CHIEF_LABEL} on the other computers` : `Show ${CHIEF_LABEL} on the other computers`
            }
            accessibilityState={{ expanded: unfolded }}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 4 }}
            onPress={() => setExpanded((value) => !value)}
            style={styles.gutter}
          >
            <ChevronRightGlyph size={ds(16)} color={ink.muted} rotated={unfolded} />
          </Pressable>
        ) : (
          // One Chief: the project's chevron dimmed, doing nothing, so the gutter is not empty.
          <View pointerEvents="none" style={[styles.gutter, styles.dimmed]}>
            <ChevronRightGlyph size={ds(16)} color={ink.muted} />
          </View>
        )}
        <View style={styles.icon}>
          <FlowerGlyph size={ds(16)} color={ink.muted} />
        </View>
        <Text numberOfLines={1} style={styles.title}>
          {CHIEF_LABEL}
        </Text>
        {mainSession === null ? <Text style={styles.hint}>Pick an agent</Text> : null}
        {counts !== null && hasDot(counts) ? <StatusDotStack {...counts} ringColor={ink.chipCard} /> : null}
      </Pressable>
      {unfolded
        ? others.map((row) => {
            if (row.session === null) return null;
            const session = row.session;
            const otherCounts = chiefCounts(session);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${CHIEF_LABEL} on ${row.machineLabel}`}
                key={row.machineId}
                onPress={() => onOpen({ ...row, session })}
                onLongPress={() => onMenu({ ...row, session })}
                style={({ pressed }) => [styles.other, pressed ? styles.pressed : null]}
              >
                <FlowerGlyph size={ds(14)} color={ink.muted} />
                <Text numberOfLines={1} style={styles.otherTitle}>
                  {row.machineLabel}
                </Text>
                {hasDot(otherCounts) ? <StatusDotStack {...otherCounts} ringColor={ink.chipCard} /> : null}
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

const chiefStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    /** A top-level project block's padding (DrawerBlockView.tsx `projectTopLevel`). */
    block: {
      marginTop: ds(8),
      paddingLeft: ds(18),
      marginRight: ds(5),
      marginBottom: ds(10),
    },
    /** rows.tsx `SidebarHeaderBox`'s row. */
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      height: TOUCH_ROW_HEIGHT,
      marginLeft: -HEADER_CHEVRON_INSET,
      marginRight: ds(3),
      paddingLeft: ds(5 + 18),
      paddingRight: ds(6),
      gap: ds(10),
      borderRadius: ds(5),
    },
    pressed: {
      backgroundColor: inkWash(ink, 0.06),
    },
    /** The chevron while nothing can unfold under it (desktop chief_row_view.rs `DIMMED_CHEVRON`). */
    dimmed: {
      opacity: 0.35,
    },
    /** Where a project header draws its chevron. */
    gutter: {
      position: 'absolute',
      left: 0,
      top: (TOUCH_ROW_HEIGHT - ds(16)) / 2,
    },
    /** rows.tsx `SidebarHeaderBox`'s project-icon column. */
    icon: {
      width: ds(16),
      height: ds(16),
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: ink.text,
      fontSize: ds(15.55),
      fontWeight: '300',
      lineHeight: ds(20),
    },
    hint: {
      color: ink.muted,
      fontSize: ds(12),
    },
    /** Like a session card under its project. */
    other: {
      flexDirection: 'row',
      alignItems: 'center',
      height: TOUCH_ROW_HEIGHT,
      marginRight: ds(3),
      paddingLeft: ds(8),
      paddingRight: ds(6),
      gap: ds(8),
      borderRadius: ds(5),
    },
    otherTitle: {
      flex: 1,
      minWidth: 0,
      color: ink.text,
      fontSize: ds(15.55),
      fontWeight: '300',
      lineHeight: ds(20),
    },
  }),
);

/**
 * Main Hub's first row before Chief of Staff's first open: the flower, "Chief of Staff" and "Pick an agent"; a tap asks
 * which agent runs it, then its real row (pinned first) takes this place. The desktop draws the same row
 * (apps/desktop/src/app/native_sidebar/chief.rs `render_native_sidebar_chief_placeholder`).
 */
export function ChiefPlaceholderRow({ onPress }: { onPress: () => void }) {
  const ink = useSidebarInk();
  const styles = chiefStyles(ink);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${CHIEF_LABEL}: pick the agent it runs on`}
      onPress={onPress}
      style={({ pressed }) => [styles.other, pressed ? styles.pressed : null]}
    >
      <FlowerGlyph size={ds(14)} color={ink.muted} />
      <Text numberOfLines={1} style={styles.otherTitle}>
        {CHIEF_LABEL}
      </Text>
      <Text style={styles.hint}>Pick an agent</Text>
    </Pressable>
  );
}
