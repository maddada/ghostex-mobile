/**
 * The bell on the Sessions screen (its entry from the list): opens the Notifications list and carries the number of
 * unread notifications in it as a figure, not as a colour alone, as the desktop's bell does: every online computer's
 * unread rows, an open approval counted as unread (`useFeedPanel`, the list's own rows, so the two never count
 * differently). An offline computer's rows leave the number until it is back, as they leave the list.
 */

import { useMemo } from 'react';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import { StyleSheet, Text, View } from 'react-native';

import { NotificationsCopy } from '../copy';

import { BellGlyph } from './icons';
import { useFeedPanel } from './useFeedPanel';

export type BellCount = { count: number; lastKnown: boolean };

/** The unread notifications across every online computer. */
export function useNeedsYouCount(): BellCount {
  const count = useFeedPanel().unreadCount;
  return useMemo(() => ({ count, lastKnown: false }), [count]);
}

export function bellLabel({ count, lastKnown }: BellCount): string {
  if (count === 0) return NotificationsCopy.bell;
  return lastKnown ? NotificationsCopy.bellLastKnown(count) : NotificationsCopy.feed.unreadBell(count);
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
