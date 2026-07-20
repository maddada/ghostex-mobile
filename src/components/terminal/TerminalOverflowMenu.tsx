/**
 * Overflow (⋯) menu for the terminal header (terminal-screen.md §1), rendered
 * as a transparent Modal anchored under the header's trailing button.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';

export type OverflowMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onPress: () => void;
};

export type TerminalOverflowMenuProps = {
  visible: boolean;
  /** Distance from the window top to anchor the card (below the header). */
  topOffset: number;
  items: OverflowMenuItem[];
  onDismiss: () => void;
};

export default function TerminalOverflowMenu({
  visible,
  topOffset,
  items,
  onDismiss,
}: TerminalOverflowMenuProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <View style={[styles.card, { top: topOffset }]}>
          {items.map((item, index) => (
            <Pressable
              key={item.id}
              accessibilityRole="menuitem"
              accessibilityState={{ disabled: item.disabled === true }}
              disabled={item.disabled === true}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.rowDivider,
                pressed && styles.rowPressed,
              ]}
              onPress={() => {
                onDismiss();
                item.onPress();
              }}
            >
              <Text
                style={[
                  styles.rowLabel,
                  item.destructive === true && styles.rowLabelDestructive,
                  item.disabled === true && styles.rowLabelDisabled,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  card: {
    position: 'absolute',
    right: 12,
    minWidth: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GhostexPalette.BORDER,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  rowLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
  },
  rowLabelDestructive: {
    color: GhostexPalette.DANGER,
  },
  rowLabelDisabled: {
    color: GhostexPalette.MUTED,
    opacity: 0.5,
  },
});
