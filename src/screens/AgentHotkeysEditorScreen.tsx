import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AGENT_HOTKEY_LABEL_MAX_LENGTH,
  AGENT_HOTKEYS_MAX_PER_AGENT,
  AGENT_NAMES,
  CONFIGURABLE_AGENT_IDS,
  formatAgentHotkeySteps,
  parseAgentHotkey,
  useAgentHotkeysStore,
  type AgentHotkey,
  type ConfigurableAgentId,
} from '../settings/agentHotkeys';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';
import type { Appearance } from '../theme/useAppearance';
import { useAppearanceHeader } from './settings/useAppearanceHeader';

function makeHotkeyId(agentId: ConfigurableAgentId): string {
  return `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AgentHotkeysEditorScreen() {
  const appearance = useAppearanceHeader();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const profiles = useAgentHotkeysStore((state) => state.profiles);
  const saveProfile = useAgentHotkeysStore((state) => state.saveProfile);
  const resetAgent = useAgentHotkeysStore((state) => state.resetAgent);
  const [agentId, setAgentId] = useState<ConfigurableAgentId>('codex');
  const [agentPickerVisible, setAgentPickerVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [hotkey, setHotkey] = useState('');

  const agentHotkeys = profiles[agentId];
  const editingIndex = useMemo(
    () => agentHotkeys.findIndex((item) => item.id === editingId),
    [agentHotkeys, editingId],
  );

  const clearEditor = (): void => {
    setEditingId(null);
    setLabel('');
    setHotkey('');
  };

  const chooseAgent = (nextAgentId: ConfigurableAgentId): void => {
    setAgentId(nextAgentId);
    setAgentPickerVisible(false);
    clearEditor();
  };

  const editHotkey = (item: AgentHotkey): void => {
    setEditingId(item.id);
    setLabel(item.label);
    setHotkey(formatAgentHotkeySteps(item.steps));
  };

  const submitHotkey = (): void => {
    const normalizedLabel = label.trim();
    if (normalizedLabel.length === 0) {
      Alert.alert('Missing Label', 'Enter the short label shown on the agent key.');
      return;
    }
    const parsed = parseAgentHotkey(hotkey);
    if (typeof parsed === 'string') {
      Alert.alert('Invalid Hotkey', parsed);
      return;
    }
    if (editingIndex < 0 && agentHotkeys.length >= AGENT_HOTKEYS_MAX_PER_AGENT) {
      Alert.alert(
        'Hotkey Limit Reached',
        `${AGENT_NAMES[agentId]} can have at most ${AGENT_HOTKEYS_MAX_PER_AGENT} hotkeys.`,
      );
      return;
    }
    const next = agentHotkeys.map((item) => ({
      ...item,
      steps: item.steps.map((itemStep) => ({ ...itemStep, mods: { ...itemStep.mods } })),
    }));
    const item: AgentHotkey = {
      id: editingIndex >= 0 ? next[editingIndex].id : makeHotkeyId(agentId),
      label: normalizedLabel,
      steps: parsed,
    };
    if (editingIndex >= 0) next[editingIndex] = item;
    else next.push(item);
    const error = saveProfile(agentId, next);
    if (error !== null) {
      Alert.alert('Cannot Save Hotkey', error);
      return;
    }
    clearEditor();
  };

  const removeHotkey = (id: string): void => {
    const next = agentHotkeys.filter((item) => item.id !== id);
    const error = saveProfile(agentId, next);
    if (error !== null) {
      Alert.alert('Cannot Remove Hotkey', error);
      return;
    }
    if (editingId === id) clearEditor();
  };

  const moveHotkey = (index: number, delta: -1 | 1): void => {
    const target = index + delta;
    if (target < 0 || target >= agentHotkeys.length) return;
    const next = [...agentHotkeys];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    const error = saveProfile(agentId, next);
    if (error !== null) Alert.alert('Cannot Move Hotkey', error);
  };

  const handleReset = (): void => {
    Alert.alert(
      `Restore ${AGENT_NAMES[agentId]} Defaults?`,
      `Only ${AGENT_NAMES[agentId]}'s hotkeys will be replaced.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => {
            resetAgent(agentId);
            clearEditor();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.status}>
          Configure the exact terminal shortcuts shown on each agent's key page. These keys never
          type slash commands.
        </Text>

        <Text style={styles.fieldLabel}>Agent</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select agent"
          accessibilityValue={{ text: AGENT_NAMES[agentId] }}
          style={styles.dropdown}
          onPress={() => setAgentPickerVisible(true)}
        >
          <Text style={styles.dropdownLabel}>{AGENT_NAMES[agentId]}</Text>
          <Text style={styles.dropdownChevron}>⌄</Text>
        </Pressable>

        <Text style={styles.sectionHeader}>Current hotkeys</Text>
        {agentHotkeys.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No agent hotkeys configured.</Text>
          </View>
        ) : (
          agentHotkeys.map((item, index) => (
            <View key={item.id} style={styles.hotkeyRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.label}`}
                style={styles.hotkeyMain}
                onPress={() => editHotkey(item)}
              >
                <Text style={styles.hotkeyLabel}>{item.label}</Text>
                <Text style={styles.hotkeyChord}>{formatAgentHotkeySteps(item.steps)}</Text>
              </Pressable>
              <View style={styles.rowActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${item.label} earlier`}
                  disabled={index === 0}
                  style={[styles.smallButton, index === 0 && styles.disabled]}
                  onPress={() => moveHotkey(index, -1)}
                >
                  <Text style={styles.smallButtonLabel}>↑</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${item.label} later`}
                  disabled={index === agentHotkeys.length - 1}
                  style={[
                    styles.smallButton,
                    index === agentHotkeys.length - 1 && styles.disabled,
                  ]}
                  onPress={() => moveHotkey(index, 1)}
                >
                  <Text style={styles.smallButtonLabel}>↓</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.label}`}
                  style={styles.smallButton}
                  onPress={() => removeHotkey(item.id)}
                >
                  <Text style={styles.removeLabel}>×</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        <Text style={styles.sectionHeader}>
          {editingIndex >= 0 ? 'Edit hotkey' : 'Add hotkey'}
        </Text>
        <Text style={styles.fieldLabel}>Label</Text>
        <TextInput
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={AGENT_HOTKEY_LABEL_MAX_LENGTH}
          placeholder="e.g. HISTORY"
          placeholderTextColor={appearance.muted}
          style={styles.input}
          value={label}
          onChangeText={setLabel}
        />
        <Text style={styles.fieldLabel}>Hotkey</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. Ctrl+R"
          placeholderTextColor={appearance.muted}
          style={styles.input}
          value={hotkey}
          onChangeText={setHotkey}
        />
        <Text style={styles.help}>
          Use Ctrl, Option, or Shift with a character or named key. For a sequence, use “then”:
          Ctrl+C then Ctrl+C.
        </Text>

        <View style={styles.editorActions}>
          <Pressable
            accessibilityRole="button"
            style={styles.primaryButton}
            onPress={submitHotkey}
          >
            <Text style={styles.primaryButtonLabel}>
              {editingIndex >= 0 ? 'Update hotkey' : 'Add hotkey'}
            </Text>
          </Pressable>
          {editingIndex >= 0 ? (
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={clearEditor}
            >
              <Text style={styles.secondaryButtonLabel}>Cancel edit</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          style={styles.resetButton}
          onPress={handleReset}
        >
          <Text style={styles.resetButtonLabel}>
            Restore {AGENT_NAMES[agentId]} defaults
          </Text>
        </Pressable>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={agentPickerVisible}
        onRequestClose={() => setAgentPickerVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setAgentPickerVisible(false)}>
          <Pressable style={styles.pickerCard} onPress={() => undefined}>
            <Text style={styles.pickerTitle}>Select agent</Text>
            {CONFIGURABLE_AGENT_IDS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: option === agentId }}
                style={styles.pickerRow}
                onPress={() => chooseAgent(option)}
              >
                <Text style={styles.pickerRowLabel}>{AGENT_NAMES[option]}</Text>
                {option === agentId ? <Text style={styles.selectedMark}>✓</Text> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
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
      paddingBottom: 28,
      gap: 8,
    },
    status: {
      color: appearance.muted,
      fontSize: 12,
      lineHeight: 18,
      marginBottom: 4,
    },
    sectionHeader: {
      color: appearance.muted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 14,
      paddingHorizontal: 4,
    },
    fieldLabel: {
      color: appearance.muted,
      fontSize: 12,
      paddingHorizontal: 4,
      marginTop: 4,
    },
    dropdown: {
      minHeight: 46,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    dropdownLabel: {
      color: appearance.foreground,
      fontSize: 15,
      fontWeight: '600',
    },
    dropdownChevron: {
      color: appearance.muted,
      fontSize: 20,
    },
    hotkeyRow: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      overflow: 'hidden',
    },
    hotkeyMain: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 3,
    },
    hotkeyLabel: {
      color: appearance.foreground,
      fontSize: 14,
      fontWeight: '600',
    },
    hotkeyChord: {
      color: appearance.muted,
      fontSize: 11,
    },
    rowActions: {
      flexDirection: 'row',
      gap: 4,
      paddingRight: 7,
    },
    smallButton: {
      width: 30,
      height: 32,
      borderRadius: GhostexRadii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: appearance.background,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    smallButtonLabel: {
      color: appearance.foreground,
      fontSize: 15,
    },
    removeLabel: {
      color: '#FF7B72',
      fontSize: 19,
      lineHeight: 20,
    },
    disabled: {
      opacity: 0.3,
    },
    emptyCard: {
      minHeight: 52,
      paddingHorizontal: 12,
      justifyContent: 'center',
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    emptyText: {
      color: appearance.muted,
      fontSize: 13,
    },
    input: {
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.input,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      color: appearance.foreground,
      fontSize: 14,
    },
    help: {
      color: appearance.muted,
      fontSize: 11,
      lineHeight: 16,
      paddingHorizontal: 4,
    },
    editorActions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 4,
    },
    primaryButton: {
      minHeight: 44,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: GhostexRadii.row,
      backgroundColor: GhostexPalette.ACCENT,
    },
    primaryButtonLabel: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
    secondaryButton: {
      minHeight: 44,
      paddingHorizontal: 15,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    secondaryButtonLabel: {
      color: appearance.foreground,
      fontSize: 14,
    },
    resetButton: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    resetButtonLabel: {
      color: '#FF7B72',
      fontSize: 14,
      fontWeight: '600',
    },
    backdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: 'rgba(0,0,0,0.72)',
    },
    pickerCard: {
      width: '100%',
      maxWidth: 420,
      padding: 14,
      gap: 6,
      borderRadius: GhostexRadii.card,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    pickerTitle: {
      color: appearance.foreground,
      fontSize: 17,
      fontWeight: '700',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    pickerRow: {
      minHeight: 46,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.background,
    },
    pickerRowLabel: {
      color: appearance.foreground,
      fontSize: 15,
    },
    selectedMark: {
      color: GhostexPalette.ACCENT,
      fontSize: 17,
      fontWeight: '700',
    },
  });
}
