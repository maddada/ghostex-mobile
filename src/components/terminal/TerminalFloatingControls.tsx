/**
 * Floating bottom-right controls shown while the soft keyboard is hidden
 * (terminal-screen.md §1): Keyboard button (per settings.keyboardButtonVisible)
 * and Upload button (per settings.fileUploadButtonVisible, hourglass while
 * uploading).
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';
import { HourglassIcon, KeyboardIcon, PaperclipIcon } from './icons';

export type TerminalFloatingControlsProps = {
  showKeyboardButton: boolean;
  showUploadButton: boolean;
  uploadEnabled: boolean;
  uploading: boolean;
  bottomOffset: number;
  onKeyboard: () => void;
  onUpload: () => void;
};

export default function TerminalFloatingControls({
  showKeyboardButton,
  showUploadButton,
  uploadEnabled,
  uploading,
  bottomOffset,
  onKeyboard,
  onUpload,
}: TerminalFloatingControlsProps) {
  if (!showKeyboardButton && !showUploadButton) return null;

  return (
    <View style={[styles.stack, { bottom: bottomOffset }]} pointerEvents="box-none">
      {showUploadButton && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Upload Image or File"
          disabled={!uploadEnabled || uploading}
          style={[styles.button, (!uploadEnabled || uploading) && styles.buttonDisabled]}
          onPress={onUpload}
        >
          {uploading ? (
            <HourglassIcon size={18} color={GhostexPalette.FOREGROUND} />
          ) : (
            <PaperclipIcon size={18} color={GhostexPalette.FOREGROUND} />
          )}
        </Pressable>
      )}
      {showKeyboardButton && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show keyboard"
          style={styles.button}
          onPress={onKeyboard}
        >
          <KeyboardIcon size={18} color={GhostexPalette.FOREGROUND} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    right: 16,
    alignItems: 'center',
    gap: 12,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
