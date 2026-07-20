/**
 * Key-value details panel (sessions-drawer.md §§2-4): modal bottom sheet with
 * a title, muted subtitle, and label/value rows ("-" for blanks is the
 * caller's responsibility).
 */

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export type DetailsEntry = {
  label: string;
  value: string;
};

export type DetailsSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  entries: DetailsEntry[];
  onClose: () => void;
};

export default function DetailsSheet({ visible, title, subtitle, entries, onClose }: DetailsSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle !== undefined && subtitle.length > 0 ? (
            <Text style={styles.subtitle}>{subtitle}</Text>
          ) : null}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {entries.map((entry) => (
              <View key={entry.label} style={styles.row}>
                <Text style={styles.rowLabel}>{entry.label}</Text>
                <Text selectable style={styles.rowValue}>
                  {entry.value.length > 0 ? entry.value : '-'}
                </Text>
              </View>
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
    flexDirection: 'row',
    minHeight: 36,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    gap: 12,
  },
  rowLabel: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    width: 110,
  },
  rowValue: {
    flex: 1,
    color: GhostexPalette.FOREGROUND,
    fontSize: 12,
  },
});
