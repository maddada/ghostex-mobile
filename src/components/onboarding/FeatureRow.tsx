/**
 * Welcome-screen feature row (onboarding.md §1): 46x46 rounded-12 color badge
 * with a glyph, then title over secondary description.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GhostexPalette } from '../../theme/palette';

type Props = {
  badgeColor: string;
  icon: ReactNode;
  title: string;
  description: string;
};

export default function FeatureRow({ badgeColor, icon, title, description }: Props) {
  return (
    <View style={styles.row}>
      <View style={[styles.badge, { backgroundColor: badgeColor }]}>{icon}</View>
      <View style={styles.textColumn}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  badge: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 16,
    fontWeight: '600',
  },
  description: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
});
