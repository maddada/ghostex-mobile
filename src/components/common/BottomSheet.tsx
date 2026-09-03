/**
 * Bottom sheet with free-form content: dimmed backdrop, #161616 panel with a
 * grabber and 20px top corners, keyboard-avoiding so inputs inside stay
 * visible. `ActionSheet` stays the list-only variant; this one hosts the setup
 * flow's paste, help and password sheets.
 */

import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
};

export default function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.grabber} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            bounces={false}
            contentContainerStyle={styles.content}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: SetupPalette.BACKDROP,
  },
  sheet: {
    backgroundColor: SetupPalette.PANEL,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: SetupPalette.BORDER_STRONG,
    paddingTop: 10,
    paddingHorizontal: 16,
    maxHeight: '88%',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: SetupPalette.GRABBER,
    alignSelf: 'center',
    marginBottom: 12,
  },
  content: {
    paddingBottom: 4,
  },
});
