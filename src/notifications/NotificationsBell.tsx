/**
 * The bell on the Sessions screen (its entry from the list): opens the attention list and carries the number of
 * sessions under its Needs you section as a figure, not as a colour alone: the sessions of every enabled computer that
 * wait for the user (`needsYouCount`), also a computer's last known waits while it cannot be reached. A number that
 * holds such a wait is marked as last known ("3?"), as the list's Needs you title is; a number of current waits only
 * is not. Finished and failed sessions are in the list but not in the number.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import { StyleSheet, Text, View } from 'react-native';

import { NotificationsCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { enabledMachines, useMachinesStore } from '../machines/store';

import { cannotReach, needsYouCount } from './attentionRows';
import { useAttentionFeedStore } from './feedStore';
import { BellGlyph } from './icons';

export type BellCount = { count: number; lastKnown: boolean };

/** The sessions under Needs you, across every enabled computer, and whether one of them is a last known wait. */
export function useNeedsYouCount(): BellCount {
  const machines = useMachinesStore((state) => state.machines);
  const enabled = useMemo(() => enabledMachines({ machines }), [machines]);
  // Only the feeds' states, so a new feed row does not re-render the bell's screen.
  const feedStatuses = useAttentionFeedStore(
    useShallow((state) => enabled.map((machine) => state.feeds[machine.id]?.status)),
  );
  return useInventoryStore(
    useShallow((state) =>
      needsYouCount(
        enabled.map((machine, index) => {
          const inventory = state.inventoriesByMachineId[machine.id];
          return {
            summary: inventory?.summary ?? null,
            offline: cannotReach(feedStatuses[index], inventory?.lastError),
          };
        }),
      ),
    ),
  );
}

export function bellLabel({ count, lastKnown }: BellCount): string {
  if (count === 0) return NotificationsCopy.bell;
  return lastKnown ? NotificationsCopy.bellLastKnown(count) : NotificationsCopy.bellNeedsYou(count);
}

/** The bell glyph with its count badge; the label is the caller's (`bellLabel`). */
export function BellWithCount({ size, color, count }: { size: number; color: string; count: BellCount }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <BellGlyph size={size} color={color} />
      {count.count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {`${count.count > 99 ? '99+' : String(count.count)}${count.lastKnown ? '?' : ''}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -7,
    right: -9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: appearance.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: appearance.accentForeground, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
