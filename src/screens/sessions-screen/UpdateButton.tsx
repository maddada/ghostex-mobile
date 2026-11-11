/**
 * The Sessions screen's Update button: a small accent pill in the top bar, shown only while there is an
 * update to take. A downloaded over-the-air update restarts into it; a newer app downloads and opens
 * the installer (GitHub APK) or opens its store page (Google Play, TestFlight, App Store). While the
 * APK downloads, the pill shows the percent.
 *
 * CDXC:Updates 2026-11-12 DECISION: the user: "on the home screen, in the menu, you are showing me
 * there's an update, but there is nothing that indicates that there's an update at the top of the app.
 * I think we just need a download button there. [...] We need to show this update button even when
 * there is an OTA, so I click it to reload the app. Let's not show 'Settings: Update available.' in the
 * menu." The menu no longer carries the notice; this button is the one place on the screen.
 * SEE-ALSO: src/updates/updateNotice.ts, src/screens/settings/UpdatesPage.tsx.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import ErrorBoundary from '../../components/common/ErrorBoundary';
import { DownloadGlyph, LoaderGlyph, RefreshGlyph } from '../../components/sessions/icons';
import type { Appearance } from '../../theme/useAppearance';
import { useAppearance } from '../../theme/useAppearance';
import { takeUpdateAction, updateActionLabel, useUpdateAction, type UpdateAction } from '../../updates/updateNotice';

export const UpdateButtonCopy = { label: 'Update' } as const;

/** The pill's glyph, for the side bar's entry too. */
export function UpdateActionGlyph({ action, size, color }: { action: UpdateAction; size: number; color: string }) {
  if (action.kind === 'restart') return <RefreshGlyph size={size} color={color} />;
  if (action.downloadPercent !== null) return <LoaderGlyph size={size} color={color} />;
  return <DownloadGlyph size={size} color={color} />;
}

function UpdatePill() {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const action = useUpdateAction();
  if (action === null) return null;
  const downloading = action.kind === 'newApp' && action.downloadPercent !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={updateActionLabel(action)}
      disabled={downloading}
      hitSlop={8}
      style={({ pressed }) => [styles.pill, pressed ? styles.pressed : null]}
      onPress={() => takeUpdateAction(action)}
    >
      <UpdateActionGlyph action={action} size={15} color={appearance.accentForeground} />
      <Text style={styles.label} numberOfLines={1}>
        {downloading ? `${action.downloadPercent}%` : UpdateButtonCopy.label}
      </Text>
    </Pressable>
  );
}

/** Nothing shows when the update state cannot be read (expo-updates can throw while starting). */
export function UpdateButton() {
  return (
    <ErrorBoundary name="sessions:update-button" renderFallback={() => null}>
      <UpdatePill />
    </ErrorBoundary>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 30,
      paddingHorizontal: 10,
      marginHorizontal: 4,
      borderRadius: 15,
      backgroundColor: appearance.accent,
    },
    pressed: {
      opacity: 0.8,
    },
    label: {
      color: appearance.accentForeground,
      fontSize: 13,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
  });
