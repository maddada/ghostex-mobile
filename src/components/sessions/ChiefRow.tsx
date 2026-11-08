/**
 * Chief's row under the Spaces tabs, drawn like a project header (rows.tsx `SidebarHeaderBox`): no
 * border, the header's box, insets and light title. The gutter where a project draws its chevron
 * holds the flower while only this computer has a Chief, and the project's fold chevron once other
 * computers have one; their Chiefs fold under it like a project's sessions (contract/chief.ts). A
 * tap on the row opens the chat; a tap on the chevron folds. The desktop draws the same row
 * (apps/desktop/src/app/native_sidebar/chief_row_view.rs, CDXC:Chief 2026-11-08 there).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChiefRowModel } from '../../contract/chief';
import type { GhostexSession } from '../../contract/mobileSummary';
import { ChevronRightGlyph, FlowerGlyph } from './icons';
import { HEADER_CHEVRON_INSET, TOUCH_ROW_HEIGHT, ds, inkStyleSheets, inkWash, useSidebarInk } from './rows';
import StatusDotStack from './StatusDotStack';

/** Chief's name on its row (Q1746). */
export const CHIEF_LABEL = 'Chief';

/** The one dot a Chief's row draws, in the session card's order. */
function chiefCounts(session: GhostexSession) {
  const approval = session.awaitingApproval;
  const question = !approval && (session.pendingQuestionCount > 0 || session.awaitingAnswer);
  const working = !approval && !question && session.activity === 'working';
  const attention = !approval && !question && session.activity === 'attention';
  const background = !approval && !question && !working && !attention && session.backgroundWorkDetectedAt.length > 0;
  return {
    approvalCount: approval ? 1 : 0,
    questionCount: question ? 1 : 0,
    workingCount: working ? 1 : 0,
    attentionCount: attention ? 1 : 0,
    backgroundWorkCount: background ? 1 : 0,
  };
}

function hasDot(counts: ReturnType<typeof chiefCounts>): boolean {
  return Object.values(counts).some((count) => count > 0);
}

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
            accessibilityLabel={unfolded ? "Fold the other computers' Chiefs" : "Show the other computers' Chiefs"}
            accessibilityState={{ expanded: unfolded }}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 4 }}
            onPress={() => setExpanded((value) => !value)}
            style={styles.gutter}
          >
            <ChevronRightGlyph size={ds(16)} color={ink.muted} rotated={unfolded} />
          </Pressable>
        ) : (
          <View pointerEvents="none" style={styles.gutter}>
            <FlowerGlyph size={ds(16)} color={ink.muted} />
          </View>
        )}
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
    /** Where a project header draws its chevron. */
    gutter: {
      position: 'absolute',
      left: 0,
      top: (TOUCH_ROW_HEIGHT - ds(16)) / 2,
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
