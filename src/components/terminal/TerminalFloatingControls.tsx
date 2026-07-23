/**
 * Floating bottom-right terminal controls (terminal-screen.md §1):
 * - Refresh button (settings.refreshButtonVisible, zmx attach tabs only):
 *   explicit native ZMX viewport refresh.
 * - Upload button (settings.fileUploadButtonVisible, hourglass while
 *   uploading).
 * - Keyboard button (settings.keyboardButtonVisible). While the soft keyboard
 *   is up (extra-keys toolbar hidden), it becomes the dismiss control so a
 *   keyboard-dismiss path always exists without the accessory bar.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';
import {
  HourglassIcon,
  KeyboardDismissIcon,
  KeyboardIcon,
  PaperclipIcon,
  RefreshIcon,
} from './icons';

export type TerminalFloatingControlsProps = {
  showKeyboardButton: boolean;
  showUploadButton: boolean;
  showRefreshButton: boolean;
  uploadEnabled: boolean;
  uploading: boolean;
  refreshEnabled: boolean;
  /** True while the soft keyboard is visible: the keyboard button dismisses. */
  keyboardShown: boolean;
  bottomOffset: number;
  onKeyboard: () => void;
  onDismissKeyboard: () => void;
  onUpload: () => void;
  onRefresh: () => void;
};

export default function TerminalFloatingControls({
  showKeyboardButton,
  showUploadButton,
  showRefreshButton,
  uploadEnabled,
  uploading,
  refreshEnabled,
  keyboardShown,
  bottomOffset,
  onKeyboard,
  onDismissKeyboard,
  onUpload,
  onRefresh,
}: TerminalFloatingControlsProps) {
  if (!showKeyboardButton && !showUploadButton && !showRefreshButton) return null;

  return (
    <View style={[styles.stack, { bottom: bottomOffset }]} pointerEvents="box-none">
      {showRefreshButton && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh terminal"
          disabled={!refreshEnabled}
          style={[styles.button, !refreshEnabled && styles.buttonDisabled]}
          onPress={onRefresh}
        >
          <RefreshIcon size={18} color={GhostexPalette.FOREGROUND} />
        </Pressable>
      )}
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
          accessibilityLabel={keyboardShown ? 'Dismiss keyboard' : 'Show keyboard'}
          style={styles.button}
          onPress={keyboardShown ? onDismissKeyboard : onKeyboard}
        >
          {keyboardShown ? (
            <KeyboardDismissIcon size={18} color={GhostexPalette.FOREGROUND} />
          ) : (
            <KeyboardIcon size={18} color={GhostexPalette.FOREGROUND} />
          )}
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
