/**
 * Extra-keys layout editor (Settings › Keyboard). Visual two-row editor over
 * the React Native key model (no raw Termux config text): select a chip to
 * move/remove it, add built-in keys from the catalog, or create custom actions
 * (insert text, insert text + Enter, shortcut with modifiers). Save validates
 * against the supported keys and per-row limits; Reset restores the spec
 * default layout.
 */

import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  EXTRA_KEYS_MAX_PER_ROW,
  EXTRA_KEY_LABEL_MAX_LENGTH,
  EXTRA_KEY_TEXT_MAX_LENGTH,
  SHORTCUT_KEY_NAMES,
  extraKeyCatalog,
  storedItemLabel,
  useExtraKeysStore,
  validateExtraKeysLayout,
  type ExtraKeyStored,
  type ExtraKeysLayout,
} from '../settings/extraKeys';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';
import type { Appearance } from '../theme/useAppearance';
import KeyboardAvoidingContainer from '../components/common/keyboard/KeyboardAvoidingContainer';
import KeyboardAwareScrollView from '../components/common/keyboard/KeyboardAwareScrollView';
import { useAppearanceHeader } from './settings/useAppearanceHeader';

const STATUS_LINE =
  'Customize the two key rows shown above the keyboard. Tap a key to move or remove it.';
const EXAMPLES_LINE =
  'Examples: a key that types "git status" and presses Enter, a key that inserts a long path, or Ctrl+C as a single tap.';

type CustomActionKind = 'text' | 'textEnter' | 'shortcut';

type CustomDraft = {
  kind: CustomActionKind;
  label: string;
  text: string;
  shortcutKey: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};

function emptyCustomDraft(kind: CustomActionKind): CustomDraft {
  return { kind, label: '', text: '', shortcutKey: '', ctrl: false, alt: false, shift: false };
}

function cloneLayout(layout: ExtraKeysLayout): ExtraKeysLayout {
  return layout.map((row) => row.map((item) => ({ ...item })));
}

export default function ExtraKeysEditorScreen() {
  const navigation = useNavigation();
  const appearance = useAppearanceHeader();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const savedLayout = useExtraKeysStore((state) => state.layout);
  const saveLayout = useExtraKeysStore((state) => state.saveLayout);
  const resetToDefault = useExtraKeysStore((state) => state.resetToDefault);

  const [draft, setDraft] = useState<ExtraKeysLayout>(() => cloneLayout(savedLayout));
  const [selected, setSelected] = useState<{ row: number; index: number } | null>(null);
  const [addTargetRow, setAddTargetRow] = useState<number | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomDraft | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedLayout);

  const updateDraft = (mutate: (next: ExtraKeysLayout) => void): void => {
    setDraft((current) => {
      const next = cloneLayout(current);
      mutate(next);
      return next;
    });
  };

  const moveSelected = (delta: -1 | 1): void => {
    if (selected === null) return;
    const { row, index } = selected;
    const target = index + delta;
    if (target < 0 || target >= draft[row].length) return;
    updateDraft((next) => {
      const [item] = next[row].splice(index, 1);
      next[row].splice(target, 0, item);
    });
    setSelected({ row, index: target });
  };

  const moveSelectedToOtherRow = (): void => {
    if (selected === null) return;
    const { row, index } = selected;
    const otherRow = row === 0 ? 1 : 0;
    if (draft[otherRow].length >= EXTRA_KEYS_MAX_PER_ROW) {
      Alert.alert('Row Full', `A row can hold at most ${EXTRA_KEYS_MAX_PER_ROW} keys.`);
      return;
    }
    updateDraft((next) => {
      const [item] = next[row].splice(index, 1);
      next[otherRow].push(item);
    });
    setSelected({ row: otherRow, index: draft[otherRow].length });
  };

  const removeSelected = (): void => {
    if (selected === null) return;
    updateDraft((next) => {
      next[selected.row].splice(selected.index, 1);
    });
    setSelected(null);
  };

  const addItem = (row: number, item: ExtraKeyStored): void => {
    if (draft[row].length >= EXTRA_KEYS_MAX_PER_ROW) {
      Alert.alert('Row Full', `A row can hold at most ${EXTRA_KEYS_MAX_PER_ROW} keys.`);
      return;
    }
    updateDraft((next) => {
      next[row].push(item);
    });
  };

  const handleSave = (): void => {
    const error = saveLayout(draft);
    if (error !== null) {
      Alert.alert('Cannot Save Layout', error);
      return;
    }
    navigation.goBack();
  };

  const handleReset = (): void => {
    Alert.alert('Reset to Default?', 'This replaces both rows with the standard layout.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          resetToDefault();
          setDraft(cloneLayout(useExtraKeysStore.getState().layout));
          setSelected(null);
        },
      },
    ]);
  };

  const submitCustomDraft = (): void => {
    if (customDraft === null || addTargetRow === null) return;
    const label = customDraft.label.trim();
    if (label.length === 0) {
      Alert.alert('Missing Label', 'Give the key a short label.');
      return;
    }
    let item: ExtraKeyStored;
    if (customDraft.kind === 'shortcut') {
      const key = customDraft.shortcutKey.trim();
      const normalized = SHORTCUT_KEY_NAMES.find(
        (name) => name.toLowerCase() === key.toLowerCase(),
      );
      if (normalized === undefined && key.length !== 1) {
        Alert.alert(
          'Unsupported Key',
          `Use a single character or one of: ${SHORTCUT_KEY_NAMES.join(', ')}.`,
        );
        return;
      }
      if (!customDraft.ctrl && !customDraft.alt && !customDraft.shift) {
        Alert.alert('Missing Modifier', 'Shortcuts need at least one of Ctrl, Alt, or Shift.');
        return;
      }
      item = {
        type: 'shortcut',
        label,
        key: normalized ?? key,
        ctrl: customDraft.ctrl,
        alt: customDraft.alt,
        shift: customDraft.shift,
      };
    } else {
      if (customDraft.text.length === 0) {
        Alert.alert('Missing Text', 'Enter the text this key should insert.');
        return;
      }
      item = {
        type: 'text',
        label,
        text: customDraft.text,
        sendEnter: customDraft.kind === 'textEnter',
      };
    }
    setCustomDraft(null);
    const row = addTargetRow;
    setAddTargetRow(null);
    addItem(row, item);
  };

  const renderRow = (row: number) => (
    <View key={`row-${row}`}>
      <Text style={styles.rowHeader}>{`Row ${row + 1}`}</Text>
      <View style={styles.chipRow}>
        {draft[row].map((item, index) => {
          const isSelected = selected?.row === row && selected.index === index;
          return (
            <Pressable
              key={`chip-${row}-${index}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => setSelected(isSelected ? null : { row, index })}
            >
              <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
                {storedItemLabel(item)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add key to row ${row + 1}`}
          style={[styles.chip, styles.chipAdd]}
          onPress={() => setAddTargetRow(row)}
        >
          <Text style={styles.chipAddLabel}>+</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.statusLine}>{STATUS_LINE}</Text>
        {renderRow(0)}
        {renderRow(1)}

        {selected !== null && (
          <View style={styles.selectionActions}>
            <Pressable style={styles.actionButton} onPress={() => moveSelected(-1)}>
              <Text style={styles.actionLabel}>◀ Move</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={() => moveSelected(1)}>
              <Text style={styles.actionLabel}>Move ▶</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={moveSelectedToOtherRow}>
              <Text style={styles.actionLabel}>Other row</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={removeSelected}>
              <Text style={[styles.actionLabel, styles.actionLabelDestructive]}>Remove</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.examples}>{EXAMPLES_LINE}</Text>

        <Pressable
          accessibilityRole="button"
          style={[styles.primaryButton, !dirty && styles.primaryButtonDisabled]}
          disabled={!dirty}
          onPress={handleSave}
        >
          <Text style={styles.primaryButtonLabel}>Save keys</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleReset}>
          <Text style={styles.secondaryButtonLabel}>Reset to default</Text>
        </Pressable>
      </ScrollView>

      {/* Add-key picker */}
      <Modal
        visible={addTargetRow !== null && customDraft === null}
        transparent
        animationType="fade"
        onRequestClose={() => setAddTargetRow(null)}
      >
        <KeyboardAvoidingContainer safeAreaTop style={styles.modalKeyboardFill}>
          <Pressable style={styles.modalBackdrop} onPress={() => setAddTargetRow(null)}>
            <Pressable style={styles.modalCard} onPress={() => undefined}>
              <Text style={styles.modalTitle}>Add key</Text>
              <ScrollView style={styles.modalScroll}>
                <Text style={styles.modalSection}>Custom actions</Text>
                {(
                  [
                    { kind: 'text', label: 'Insert text…' },
                    { kind: 'textEnter', label: 'Insert text and press Enter…' },
                    { kind: 'shortcut', label: 'Shortcut with modifiers…' },
                  ] as { kind: CustomActionKind; label: string }[]
                ).map((option) => (
                  <Pressable
                    key={option.kind}
                    style={styles.modalRow}
                    onPress={() => setCustomDraft(emptyCustomDraft(option.kind))}
                  >
                    <Text style={styles.modalRowLabel}>{option.label}</Text>
                  </Pressable>
                ))}
                <Text style={styles.modalSection}>Keys and modifiers</Text>
                {extraKeyCatalog().map((entry) => (
                  <Pressable
                    key={entry.id}
                    style={styles.modalRow}
                    onPress={() => {
                      const row = addTargetRow;
                      setAddTargetRow(null);
                      if (row !== null) addItem(row, { type: 'builtin', id: entry.id });
                    }}
                  >
                    <Text style={styles.modalRowLabel}>
                      {entry.label}
                      {entry.isModifier ? '  (modifier)' : ''}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingContainer>
      </Modal>

      {/* Custom-action editor */}
      <Modal
        visible={customDraft !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomDraft(null)}
      >
        <KeyboardAvoidingContainer safeAreaTop style={styles.modalKeyboardFill}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCustomDraft(null)}>
            <Pressable style={styles.modalCard} onPress={() => undefined}>
              {customDraft !== null && (
                <KeyboardAwareScrollView style={styles.modalScroll} contentContainerStyle={styles.modalForm}>
                  <Text style={styles.modalTitle}>
                    {customDraft.kind === 'shortcut'
                      ? 'Shortcut with modifiers'
                      : customDraft.kind === 'textEnter'
                        ? 'Insert text and press Enter'
                        : 'Insert text'}
                  </Text>
                  <Text style={styles.fieldLabel}>Key label</Text>
                  <TextInput
                    style={styles.input}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={EXTRA_KEY_LABEL_MAX_LENGTH}
                    placeholder="e.g. GITST"
                    placeholderTextColor={appearance.muted}
                    value={customDraft.label}
                    onChangeText={(label) => setCustomDraft({ ...customDraft, label })}
                  />
                  {customDraft.kind === 'shortcut' ? (
                    <>
                      <Text style={styles.fieldLabel}>Key (single character or key name)</Text>
                      <TextInput
                        style={styles.input}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="e.g. c, escape, f5"
                        placeholderTextColor={appearance.muted}
                        value={customDraft.shortcutKey}
                        onChangeText={(shortcutKey) => setCustomDraft({ ...customDraft, shortcutKey })}
                      />
                      {(['ctrl', 'alt', 'shift'] as const).map((modifier) => (
                        <View key={modifier} style={styles.modifierRow}>
                          <Text style={styles.modalRowLabel}>{modifier.toUpperCase()}</Text>
                          <Switch
                            value={customDraft[modifier]}
                            onValueChange={(value) =>
                              setCustomDraft({ ...customDraft, [modifier]: value })
                            }
                            trackColor={{ false: appearance.control, true: GhostexPalette.ACCENT }}
                            thumbColor={customDraft[modifier] ? appearance.foreground : appearance.controlThumb}
                            ios_backgroundColor={appearance.control}
                          />
                        </View>
                      ))}
                    </>
                  ) : (
                    <>
                      <Text style={styles.fieldLabel}>Text to insert</Text>
                      <TextInput
                        style={[styles.input, styles.inputMultiline]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        multiline
                        maxLength={EXTRA_KEY_TEXT_MAX_LENGTH}
                        placeholder="e.g. git status"
                        placeholderTextColor={appearance.muted}
                        value={customDraft.text}
                        onChangeText={(text) => setCustomDraft({ ...customDraft, text })}
                      />
                    </>
                  )}
                  <View style={styles.modalActions}>
                    <Pressable style={styles.secondaryButton} onPress={() => setCustomDraft(null)}>
                      <Text style={styles.secondaryButtonLabel}>Cancel</Text>
                    </Pressable>
                    <Pressable style={[styles.primaryButton, styles.modalPrimaryButton]} onPress={submitCustomDraft}>
                      <Text style={styles.primaryButtonLabel}>Add key</Text>
                    </Pressable>
                  </View>
                </KeyboardAwareScrollView>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingContainer>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(appearance: Appearance) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: appearance.background,
    },
    list: {
      padding: 12,
      gap: 10,
    },
    statusLine: {
      color: appearance.muted,
      fontSize: 12,
    },
    rowHeader: {
      color: appearance.muted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 8,
      marginBottom: 6,
      paddingHorizontal: 2,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      padding: 10,
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    chip: {
      minWidth: 52,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
    },
    chipSelected: {
      backgroundColor: GhostexPalette.ACCENT,
      borderColor: 'transparent',
    },
    chipLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: appearance.foreground,
    },
    chipLabelSelected: {
      color: '#FFFFFF',
    },
    chipAdd: {
      backgroundColor: 'transparent',
      borderStyle: 'dashed',
    },
    chipAddLabel: {
      fontSize: 16,
      color: appearance.muted,
    },
    selectionActions: {
      flexDirection: 'row',
      gap: 8,
    },
    actionButton: {
      flex: 1,
      height: 36,
      borderRadius: GhostexRadii.row,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    actionLabel: {
      color: appearance.foreground,
      fontSize: 12,
    },
    actionLabelDestructive: {
      color: '#FF6B6B',
    },
    examples: {
      color: appearance.muted,
      fontSize: 11,
      marginTop: 4,
    },
    primaryButton: {
      height: 44,
      borderRadius: GhostexRadii.row,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: GhostexPalette.ACCENT,
    },
    primaryButtonDisabled: {
      opacity: 0.45,
    },
    primaryButtonLabel: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
    },
    secondaryButton: {
      height: 44,
      borderRadius: GhostexRadii.row,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      paddingHorizontal: 16,
    },
    secondaryButtonLabel: {
      color: appearance.foreground,
      fontSize: 14,
    },
    // The dim sits on the keyboard-avoiding layer so it also covers the strip the keyboard leaves while it slides away.
    modalKeyboardFill: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    modalBackdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxHeight: '80%',
      borderRadius: 14,
      padding: 16,
      gap: 8,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    modalScroll: {
      flexGrow: 0,
    },
    modalForm: {
      gap: 8,
    },
    modalTitle: {
      color: appearance.foreground,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    modalSection: {
      color: appearance.muted,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 10,
      marginBottom: 4,
    },
    modalRow: {
      minHeight: 40,
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    modalRowLabel: {
      color: appearance.foreground,
      fontSize: 14,
    },
    modifierRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 40,
      paddingHorizontal: 4,
    },
    fieldLabel: {
      color: appearance.muted,
      fontSize: 12,
      marginTop: 8,
    },
    input: {
      minHeight: 40,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
      backgroundColor: 'rgba(255,255,255,0.08)',
      color: appearance.foreground,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
    },
    inputMultiline: {
      minHeight: 70,
      textAlignVertical: 'top',
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 12,
    },
    modalPrimaryButton: {
      paddingHorizontal: 16,
    },
  });
}
