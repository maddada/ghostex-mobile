/**
 * Chief's row under the Spaces tabs: the flower, "Chief", its status dot, "Pick an agent" before
 * its first open, and "+N" that unfolds the other computers' Chiefs (contract/chief.ts). The
 * desktop draws the same row (apps/desktop/src/app/native_sidebar/chief_row_view.rs).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChiefRowModel } from '../../contract/chief';
import type { GhostexSession } from '../../contract/mobileSummary';
import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { FlowerGlyph } from './icons';
import { inkStyleSheets, useSidebarInk } from './rows';
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
  const unfolded = expanded && others.length > 0;
  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={CHIEF_LABEL}
        onPress={() => (mainSession === null ? onPickAgent(main.machineId) : onOpen({ ...main, session: mainSession }))}
        onLongPress={mainSession === null ? undefined : () => onMenu({ ...main, session: mainSession })}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        <FlowerGlyph size={16} color={ink.muted} />
        <Text numberOfLines={1} style={styles.label}>
          {CHIEF_LABEL}
        </Text>
        {mainSession === null ? <Text style={styles.hint}>Pick an agent</Text> : null}
        {others.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unfolded ? "Fold the other computers' Chiefs" : "Show the other computers' Chiefs"}
            hitSlop={8}
            onPress={() => setExpanded((value) => !value)}
            style={[styles.chip, unfolded ? styles.chipOpen : null]}
          >
            <Text style={styles.chipText}>{`+${others.length}`}</Text>
          </Pressable>
        ) : null}
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
                <FlowerGlyph size={13} color={ink.muted} />
                <Text numberOfLines={1} style={styles.otherLabel}>
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
    block: {
      marginTop: 8,
      gap: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 36,
      paddingHorizontal: 10,
      borderRadius: GhostexRadii.pill,
      borderWidth: GhostexStrokeWidth,
      borderColor: ink.chipBorder,
    },
    pressed: {
      backgroundColor: ink.selected,
    },
    label: {
      flex: 1,
      minWidth: 0,
      color: ink.text,
      fontSize: 14,
      fontWeight: '600',
    },
    hint: {
      color: ink.muted,
      fontSize: 12,
    },
    chip: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    chipOpen: {
      backgroundColor: ink.selected,
    },
    chipText: {
      color: ink.muted,
      fontSize: 12,
      fontWeight: '600',
    },
    other: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      height: 32,
      paddingLeft: 26,
      paddingRight: 10,
      borderRadius: 8,
    },
    otherLabel: {
      flex: 1,
      minWidth: 0,
      color: ink.muted,
      fontSize: 13,
    },
  }),
);
