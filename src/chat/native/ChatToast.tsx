/**
 * The chat's short-lived toast ("Copied", a link's error), shown at the top of the screen that holds
 * it: the session chat (`NativeChatScreen.tsx`) and the voice screen, whose copied lines say so the
 * same way.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useTranscriptTheme } from './transcript/theme';

/** One toast; a new `id` shows it again even with the same words. */
export type Toast = { id: number; title?: string; message: string; error: boolean } | null;

/** A short-lived toast at the top of the chat. */
export function ChatToast({ toast }: { toast: Toast }) {
  const theme = useTranscriptTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<Toast>(null);
  useEffect(() => {
    if (toast === null) return undefined;
    setShown(toast);
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setShown(null));
    }, 2600);
    return () => clearTimeout(timer);
  }, [opacity, toast]);
  if (shown === null) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toastRow, { opacity }]} accessibilityLiveRegion="polite">
      <View
        style={[
          styles.toast,
          {
            backgroundColor: theme.light ? '#ffffff' : '#1f1f1f',
            borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.08)',
          },
        ]}
      >
        {shown.title !== undefined ? (
          <Text style={[styles.toastTitle, { color: shown.error ? theme.error : theme.foreground }]}>
            {shown.title}
          </Text>
        ) : null}
        <Text
          style={[
            styles.toastText,
            { color: shown.error && shown.title === undefined ? theme.error : theme.cardMuted },
          ]}
        >
          {shown.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toastRow: { position: 'absolute', top: 8, left: 16, right: 16, alignItems: 'center' },
  toast: { maxWidth: 420, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  toastTitle: { fontSize: 13, fontWeight: '600' },
  toastText: { fontSize: 13, lineHeight: 18 },
});
