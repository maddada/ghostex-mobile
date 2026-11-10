/**
 * One way to add a computer under Machines → Add a computer: icon tile, title, one line, and its button, in one
 * compact row. The main way's button is the filled one; no card gets a coloured border or tag.
 */

import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { SetupButton } from './SetupPrimitives';

export type PathCardProps = {
  icon: ReactNode;
  title: string;
  subtitle: string;
  button: { label: string; icon?: ReactNode; onPress: () => void };
  /** The main way: its button is the filled one. */
  primary?: boolean;
};

export default function PathCard({ icon, title, subtitle, button, primary = false }: PathCardProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  return (
    <View style={styles.card}>
      <View style={styles.iconTile}>{icon}</View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <SetupButton
        small
        variant={primary ? 'primary' : 'secondary'}
        label={button.label}
        icon={button.icon}
        onPress={button.onPress}
      />
    </View>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      borderRadius: GhostexRadii.section,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    iconTile: {
      width: 34,
      height: 34,
      borderRadius: 9,
      backgroundColor: appearance.cardActive,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: appearance.foreground,
      fontSize: 15,
      fontWeight: '600',
    },
    subtitle: {
      color: appearance.muted,
      fontSize: 13,
      lineHeight: 18,
    },
  });
