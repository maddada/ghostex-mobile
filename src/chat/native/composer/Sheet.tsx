/**
 * The composer's bottom sheet: the phone form of the chat's popup menus (desktop draws them as
 * child windows, `option_menu/window.rs`; React as `ghostex-session-chat-popup` dropdowns). Dimmed
 * backdrop, a panel in the chat's menu tone, a grabber, an optional title row with a back arrow for
 * nested pages, and keyboard avoidance so a search field inside stays visible.
 */

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glyph } from './icons';
import { ComposerPalette as P } from './palette';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Shows a back arrow before the title (a nested page). */
  onBack?: () => void;
  /** Controls on the right of the title row. */
  accessory?: ReactNode;
  children: ReactNode;
  /** Fraction of the screen the panel may take. */
  maxHeight?: `${number}%`;
  /** iOS: the sheet finished going away, so another view controller (a picker) can present. */
  onDismissed?: () => void;
};

export function Sheet({ visible, onClose, title, onBack, accessory, children, maxHeight = '80%', onDismissed }: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onBack ?? onClose}
      {...(onDismissed !== undefined ? { onDismiss: onDismissed } : {})}
      statusBarTranslucent
    >
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.panel, { maxHeight, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.grabber} />
          {title !== undefined || onBack !== undefined || accessory !== undefined ? (
            <View style={styles.titleRow}>
              {onBack !== undefined ? (
                <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
                  <Glyph name="chevron-left" size={18} color={P.primary} />
                </Pressable>
              ) : null}
              <Text style={styles.title} numberOfLines={1}>
                {title ?? ''}
              </Text>
              {accessory}
            </View>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: P.backdrop },
  panel: {
    backgroundColor: P.menu,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: P.menuBorder,
    paddingTop: 8,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: P.grabber, alignSelf: 'center', marginBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8, minHeight: 32 },
  back: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: P.foreground, fontSize: 15, fontWeight: '600' },
});
