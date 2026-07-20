/**
 * STATE_CARD renderer (sessions-drawer.md §2): padding 12, minHeight 104,
 * radius 8, bg CARD_ACTIVE + BORDER stroke. Title 15sp bold, body 12sp muted
 * (marginTop 6), action hint 12sp bold accent (marginTop 10).
 */

import { Pressable, StyleSheet, Text } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export type StateCardProps = {
  title: string;
  body: string;
  actionHint: string;
  onPress?: () => void;
};

export default function StateCard({ title, body, actionHint, onPress }: StateCardProps) {
  return (
    <Pressable accessibilityRole="button" style={styles.card} onPress={onPress}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionHint.length > 0 ? <Text style={styles.hint}>{actionHint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    minHeight: 104,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
  },
  body: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 6,
  },
  hint: {
    color: GhostexPalette.ACCENT,
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 10,
  },
});
