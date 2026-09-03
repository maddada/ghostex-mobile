/**
 * One Machines card (`.mach` in docs/2026-09-03/mobile-setup/mobile-07-machines.html):
 * cloud icon tile tinted by status, name + status badge, the one-line
 * "how / what's wrong" detail, and a chevron. Tap opens Edit machine; a left
 * swipe shrinks the card to reveal Edit and Remove at its right edge while
 * the icon, name and badge stay put (SwipeRevealRow). Tapping an open card
 * closes it instead of opening the editor.
 */

import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ChevronRightGlyph,
  CloudGlyph,
  PencilGlyph,
  TrashGlyph,
} from '../../components/sessions/icons';
import { MachinesCopy } from '../../copy';
import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import {
  MACHINE_STATUS_BADGE_LABEL,
  MACHINE_STATUS_COLOR,
  type MachineCardStatus,
} from './machineCardModel';
import SwipeRevealRow, { SWIPE_REVEAL_WIDTH, type SwipeRevealRowMethods } from './SwipeRevealRow';

function StatusBadge({ status }: { status: MachineCardStatus }) {
  const color = MACHINE_STATUS_COLOR[status];
  const tinted = status === 'connected' || status === 'failed';
  return (
    <View style={[styles.badge, tinted ? { borderColor: `${color}4d` } : null]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text numberOfLines={1} style={[styles.badgeLabel, tinted ? { color } : null]}>
        {MACHINE_STATUS_BADGE_LABEL[status]}
      </Text>
    </View>
  );
}

export default function MachineCard({
  title,
  detail,
  status,
  onPress,
  onEdit,
  onRemove,
}: {
  title: string;
  detail: string;
  status: MachineCardStatus;
  onPress: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const row = useRef<SwipeRevealRowMethods>(null);
  const [open, setOpen] = useState(false);
  const closeThen = (action: () => void) => (): void => {
    row.current?.close();
    action();
  };
  return (
    <SwipeRevealRow
      ref={row}
      style={styles.row}
      onOpenChange={setOpen}
      actions={
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={MachinesCopy.swipe.edit}
            onPress={closeThen(onEdit)}
            style={[styles.action, styles.actionEdit]}
          >
            <PencilGlyph size={16} color={SetupPalette.FOREGROUND} />
            <Text style={styles.actionLabel}>{MachinesCopy.swipe.edit}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={MachinesCopy.swipe.remove}
            onPress={closeThen(onRemove)}
            style={[styles.action, styles.actionRemove]}
          >
            <TrashGlyph size={16} color="#ffffff" />
            <Text style={[styles.actionLabel, styles.actionRemoveLabel]}>
              {MachinesCopy.swipe.remove}
            </Text>
          </Pressable>
        </>
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${MACHINE_STATUS_BADGE_LABEL[status]}`}
        onPress={open ? () => row.current?.close() : onPress}
        style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
      >
        <View style={styles.iconTile}>
          <CloudGlyph size={20} color={MACHINE_STATUS_COLOR[status]} />
        </View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <StatusBadge status={status} />
          </View>
          <Text numberOfLines={1} style={styles.detail}>
            {detail}
          </Text>
        </View>
        <ChevronRightGlyph size={16} color={SetupPalette.DIM} />
      </Pressable>
    </SwipeRevealRow>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: GhostexRadii.section,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: SetupPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    borderRadius: GhostexRadii.section,
  },
  cardPressed: {
    backgroundColor: SetupPalette.CARD_HOVER,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: SetupPalette.MUTED_BG,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  /** Keeps the name readable when the row is swiped open: the badge yields first. */
  title: {
    flexShrink: 1,
    minWidth: 72,
    color: SetupPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
  },
  detail: {
    marginTop: 2,
    color: SetupPalette.MUTED,
    fontSize: 12.5,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: GhostexRadii.pill,
    backgroundColor: SetupPalette.MUTED_BG,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    flexShrink: 1,
    minWidth: 0,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeLabel: {
    color: SetupPalette.MUTED,
    fontSize: 11.5,
    fontWeight: '600',
  },
  action: {
    width: SWIPE_REVEAL_WIDTH / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionEdit: {
    backgroundColor: '#2c2c2c',
  },
  actionRemove: {
    backgroundColor: '#7a2e2e',
  },
  actionLabel: {
    color: SetupPalette.FOREGROUND,
    fontSize: 12,
    fontWeight: '600',
  },
  actionRemoveLabel: {
    color: '#ffffff',
  },
});
