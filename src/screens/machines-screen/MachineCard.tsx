/**
 * One Machines card (`.mach` in docs/2026-09-03/mobile-setup/mobile-07-machines.html):
 * cloud icon tile, name + status badge (the only place its state is coloured), the one-line
 * "how / what's wrong" detail, and a chevron. Tap opens the computer's page; a left
 * swipe shrinks the card to reveal Remove at its right edge while the icon, name and
 * badge stay put (SwipeRevealRow). Tapping an open card closes it instead.
 */

import { readableSecondaryText } from '../../theme/sidebarAppearance';
import { useMemo, useRef, useState } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronRightGlyph, CloudGlyph, DownloadGlyph, TrashGlyph } from '../../components/sessions/icons';
import { MachinesCopy } from '../../copy';
import type { AppUpdateView } from '../../machines/appUpdate';
import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import { MACHINE_STATUS_BADGE_LABEL, MACHINE_STATUS_COLOR, type MachineCardStatus } from './machineCardModel';
import SwipeRevealRow, { SWIPE_REVEAL_WIDTH, type SwipeRevealRowMethods } from './SwipeRevealRow';

function StatusBadge({ status }: { status: MachineCardStatus }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const color = MACHINE_STATUS_COLOR[status];
  const labelColor = readableSecondaryText(color, appearance.foreground, [appearance.card, appearance.cardActive]);
  const tinted = status === 'connected' || status === 'failed';
  return (
    <View style={[styles.badge, tinted ? { borderColor: `${color}4d` } : null]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text numberOfLines={1} style={[styles.badgeLabel, tinted ? { color: labelColor } : null]}>
        {MACHINE_STATUS_BADGE_LABEL[status]}
      </Text>
    </View>
  );
}

const UPDATE_TONE_COLOR: Record<AppUpdateView['tone'], string> = {
  muted: SetupPalette.DIM,
  warning: SetupPalette.WARN,
  success: SetupPalette.OK,
};

/** The card's Ghostex line, and its Update button while an update is available (`tile_update_line`, `tile_update_button`). */
export type MachineCardUpdate = {
  line: string;
  view: AppUpdateView;
  onUpdate: () => void;
};

export default function MachineCard({
  title,
  detail,
  status,
  update,
  onPress,
  onRemove,
}: {
  title: string;
  detail: string;
  status: MachineCardStatus;
  update?: MachineCardUpdate | null;
  onPress: () => void;
  onRemove: () => void;
}) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const installLabel =
    update?.view.updateAvailable === true ? (update.view.action?.label ?? MachinesCopy.update) : null;
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
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={MachinesCopy.swipe.remove}
            onPress={closeThen(onRemove)}
            style={[styles.action, styles.actionRemove]}
          >
            <TrashGlyph size={16} color="#ffffff" />
            <Text style={[styles.actionLabel, styles.actionRemoveLabel]}>{MachinesCopy.swipe.remove}</Text>
          </Pressable>
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${MACHINE_STATUS_BADGE_LABEL[status]}`}
        onPress={open ? () => row.current?.close() : onPress}
        style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
      >
        <View style={styles.iconTile}>
          <CloudGlyph size={20} color={appearance.muted} />
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
          {update != null ? (
            <Text numberOfLines={1} style={[styles.detail, { color: readableSecondaryText(UPDATE_TONE_COLOR[update.view.tone], appearance.foreground, [appearance.background, appearance.card, appearance.cardActive]) }]}>
              {update.line}
            </Text>
          ) : null}
        </View>
        {update?.view.busy === true ? <ActivityIndicator size="small" color={appearance.muted} /> : null}
        {installLabel !== null && update?.view.busy !== true ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={installLabel}
            disabled={update?.view.action?.enabled === false}
            onPress={update?.onUpdate}
            hitSlop={6}
            style={({ pressed }) => [styles.updateButton, pressed ? styles.updateButtonPressed : null]}
          >
            <DownloadGlyph size={14} color={appearance.foreground} />
            <Text style={styles.updateLabel}>{MachinesCopy.update}</Text>
          </Pressable>
        ) : null}
        <ChevronRightGlyph size={16} color={appearance.muted} />
      </Pressable>
    </SwipeRevealRow>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  row: {
    borderRadius: GhostexRadii.section,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: appearance.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    borderRadius: GhostexRadii.section,
  },
  cardPressed: {
    backgroundColor: appearance.cardActive,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: appearance.cardActive,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
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
    overflow: 'hidden',
  },
  /**
   * Keeps the name readable when the row is swiped open: the name shrinks to its minimum and the badge
   * past it is clipped by the row.
   *
   * CDXC:Mobile 2026-10-26 WHY: the badge must not shrink too. With both the name and the badge
   * shrinkable, Yoga gave them widths in the millions once the swiped-open row was narrower than
   * their minimums, so the name was laid out at full length and painted across the Edit button.
   */
  title: {
    flexShrink: 1,
    minWidth: 72,
    color: appearance.foreground,
    fontSize: 15,
    fontWeight: '600',
  },
  detail: {
    marginTop: 2,
    color: appearance.muted,
    fontSize: 12.5,
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: GhostexRadii.control,
    backgroundColor: appearance.neutralFill,
  },
  updateButtonPressed: {
    backgroundColor: appearance.cardActive,
  },
  updateLabel: {
    color: appearance.foreground,
    fontSize: 12.5,
    fontWeight: '600',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: GhostexRadii.pill,
    backgroundColor: appearance.cardActive,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    flexShrink: 0,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeLabel: {
    color: appearance.muted,
    fontSize: 11.5,
    fontWeight: '600',
  },
  action: {
    width: SWIPE_REVEAL_WIDTH / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionRemove: {
    backgroundColor: appearance.dangerFill,
  },
  actionLabel: {
    color: appearance.foreground,
    fontSize: 12,
    fontWeight: '600',
  },
  actionRemoveLabel: {
    color: appearance.foreground,
  },
});
