/**
 * Generic action sheet: modal bottom sheet with a title/subtitle header and a
 * scrollable list of action rows (label + optional detail line, destructive
 * tint, disabled state). Styling per docs/specs/sessions-drawer.md §0.
 */

import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export type ActionSheetItem = {
  key: string;
  label: string;
  /** Muted description line under the label. */
  detail?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export type ActionSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  items: ActionSheetItem[];
  onClose: () => void;
};

export default function ActionSheet({ visible, title, subtitle, items, onClose }: ActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle !== undefined && subtitle.length > 0 ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {items.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                disabled={item.disabled === true}
                style={({ pressed }) => [
                  styles.row,
                  pressed ? styles.rowPressed : null,
                  item.disabled === true ? styles.rowDisabled : null,
                ]}
                onPress={item.onPress}
              >
                <Text
                  style={[styles.rowLabel, item.destructive === true ? styles.rowLabelDestructive : null]}
                >
                  {item.label}
                </Text>
                {item.detail !== undefined && item.detail.length > 0 ? (
                  <Text style={styles.rowDetail}>{item.detail}</Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: GhostexPalette.BACKGROUND,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    paddingTop: 14,
    paddingBottom: 24,
    paddingHorizontal: 12,
    maxHeight: '80%',
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },
  subtitle: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  list: {
    marginTop: 10,
  },
  listContent: {
    gap: 6,
  },
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  rowPressed: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rowLabelDestructive: {
    color: GhostexPalette.DANGER,
  },
  rowDetail: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 2,
  },
});
