/**
 * The one collapsible section of the app (`.advanced` in
 * docs/2026-09-03/mobile-setup/shared.css): a card whose header shows a title,
 * a muted hint of what is inside and a chevron; the body is only mounted while
 * open. Both Advanced sections of the machine form use it, so their look can
 * only ever change here.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';

export type CollapsibleProps = {
  title: string;
  /** Short list of what the body holds, shown while collapsed and expanded. */
  hint?: string;
  initiallyOpen?: boolean;
  children: ReactNode;
};

export default function Collapsible({
  title,
  hint,
  initiallyOpen = false,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.header, pressed ? styles.headerPressed : null]}
        onPress={() => setOpen((current) => !current)}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {hint !== undefined && hint.length > 0 ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
        <Svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke={SetupPalette.MUTED}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={open ? styles.chevronOpen : null}
        >
          <Path d="M9 6l6 6l-6 6" />
        </Svg>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: GhostexRadii.section,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    backgroundColor: SetupPalette.PANEL,
    overflow: 'hidden',
  },
  header: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerPressed: {
    backgroundColor: SetupPalette.CARD_HOVER,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: SetupPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    color: SetupPalette.DIM,
    fontSize: 12,
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }],
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
    gap: 12,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: SetupPalette.BORDER,
  },
});
