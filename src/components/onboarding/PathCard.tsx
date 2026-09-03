/**
 * "How does your phone reach your computer?" option card (`.option-card` in
 * mobile-02-choose.html): icon tile, title with an optional tag, subtitle,
 * optional numbered steps, and a footer with a left-hand note or link and a
 * small button. Reused by Machines → Add a computer (M7).
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import { SetupButton, StepNumber } from './SetupPrimitives';

export type PathCardProps = {
  icon: ReactNode;
  title: string;
  /** Small accent chip after the title ("Recommended"). */
  tag?: string;
  subtitle: string;
  steps?: readonly string[];
  /** Left side of the footer: plain note ("About a minute"). */
  footNote?: string;
  /** Left side of the footer: accent link ("Or type the details"). */
  footLink?: { label: string; onPress: () => void };
  button: { label: string; icon?: ReactNode; onPress: () => void };
  /** Accent border + tinted icon tile. */
  recommended?: boolean;
};

export default function PathCard({
  icon,
  title,
  tag,
  subtitle,
  steps,
  footNote,
  footLink,
  button,
  recommended = false,
}: PathCardProps) {
  return (
    <View style={[styles.card, recommended ? styles.cardRecommended : null]}>
      <View style={styles.head}>
        <View style={[styles.iconTile, recommended ? styles.iconTileRecommended : null]}>{icon}</View>
        <View style={styles.headText}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {tag !== undefined ? (
              <View style={styles.tag}>
                <Text style={styles.tagLabel}>{tag}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      {steps !== undefined && steps.length > 0 ? (
        <View style={styles.steps}>
          {steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <StepNumber number={index + 1} size={18} />
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.foot}>
        {footLink !== undefined ? (
          <Pressable accessibilityRole="link" hitSlop={8} onPress={footLink.onPress}>
            <Text style={styles.footLink}>{footLink.label}</Text>
          </Pressable>
        ) : (
          <Text style={styles.footNote}>{footNote ?? ''}</Text>
        )}
        <SetupButton
          small
          variant={recommended ? 'primary' : 'secondary'}
          label={button.label}
          icon={button.icon}
          onPress={button.onPress}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: SetupPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    borderRadius: GhostexRadii.section,
    padding: 14,
    gap: 10,
  },
  cardRecommended: {
    borderColor: 'rgba(134,211,248,0.35)',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: SetupPalette.MUTED_BG,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTileRecommended: {
    backgroundColor: SetupPalette.ACCENT_FILL,
    borderColor: SetupPalette.ACCENT_BORDER,
  },
  headText: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: {
    color: SetupPalette.FOREGROUND,
    fontSize: 16,
    fontWeight: '600',
  },
  tag: {
    paddingHorizontal: 7,
    height: 20,
    borderRadius: GhostexRadii.pill,
    backgroundColor: SetupPalette.ACCENT_FILL,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.ACCENT_BORDER,
    justifyContent: 'center',
  },
  tagLabel: {
    color: SetupPalette.ACCENT,
    fontSize: 11,
    fontWeight: '600',
  },
  subtitle: {
    color: SetupPalette.MUTED,
    fontSize: 13,
    lineHeight: 19,
  },
  steps: {
    gap: 6,
    marginTop: 2,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepText: {
    flex: 1,
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 18,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 10,
  },
  footNote: {
    color: SetupPalette.DIM,
    fontSize: 12.5,
    flexShrink: 1,
  },
  footLink: {
    color: SetupPalette.ACCENT,
    fontSize: 12.5,
  },
});
