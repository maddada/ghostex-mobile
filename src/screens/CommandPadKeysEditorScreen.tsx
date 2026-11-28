/**
 * Settings > Keyboard > Pad keys: the Befehlspad's nine positions as the pad shows them; a tap on a
 * position opens a sheet that offers every function of the key bar (keys, modifiers, the KEYS page
 * shortcuts, each agent's hotkeys, custom actions of the extra-keys layout) plus Paste and Upload
 * (`commandPadChoices`). A choice is saved at once (`commandPadKeys`); Reset in the header puts the default nine
 * back. Layout of the Pad keys design.
 */

import { useMemo, useCallback, useLayoutEffect, useState } from 'react';

import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BottomSheet from '../components/common/BottomSheet';
import CommandPadKeyFace from '../components/terminal/CommandPadKeyFace';
import { commandPadChoices, resolveCommandPadKeys } from '../components/terminal/commandPadKeys';
import { CommandPadCopy, SettingsCopy } from '../copy';
import { useAgentHotkeysStore } from '../settings/agentHotkeys';
import { COMMAND_PAD_POSITIONS, DEFAULT_COMMAND_PAD_KEYS } from '../settings/commandPad';
import { useExtraKeysStore } from '../settings/extraKeys';
import { useSettingsStore } from '../settings/store';
import { colorWithOpacity, GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';
import type { Appearance } from '../theme/useAppearance';
import { SettingsColumnsFrame } from './settings/SettingsColumns';
import { SettingsPageScrollView } from './settings/SettingsControls';
import { useAppearanceHeader } from './settings/useAppearanceHeader';
import { showAlert } from '../components/common/dialog/alert';

/** A position in the preview: round, the size of the design's preview keys. */
const PREVIEW_KEY = 68;
const PREVIEW_GAP = 10;

export default function CommandPadKeysEditorScreen() {
  const appearance = useAppearanceHeader();
  const sheetStyles = useMemo(() => createSheetStyles(appearance), [appearance]);
  const navigation = useNavigation();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const storedKeys = useSettingsStore((state) => state.settings.commandPadKeys);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const agentProfiles = useAgentHotkeysStore((state) => state.profiles);
  const extraKeysLayout = useExtraKeysStore((state) => state.layout);
  const sources = useMemo(
    () => ({ agentProfiles, extraKeysLayout, pasteSupported: Platform.OS === 'ios' }),
    [agentProfiles, extraKeysLayout],
  );
  const keys = useMemo(() => resolveCommandPadKeys(storedKeys, sources), [storedKeys, sources]);
  const sections = useMemo(() => commandPadChoices(sources), [sources]);
  const [editing, setEditing] = useState<number | null>(null);
  const editingName = editing === null ? '' : CommandPadCopy.positions[COMMAND_PAD_POSITIONS[editing]];

  const assign = (position: number, id: string): void => {
    const next = keys.map((key) => key.id);
    next[position] = id;
    setSetting('commandPadKeys', next);
  };

  const reset = useCallback((): void => {
    showAlert(CommandPadCopy.resetTitle, CommandPadCopy.resetBody, [
      { text: CommandPadCopy.cancel, style: 'cancel' },
      {
        text: CommandPadCopy.reset,
        style: 'destructive',
        onPress: () => setSetting('commandPadKeys', [...DEFAULT_COMMAND_PAD_KEYS]),
      },
    ]);
  }, [setSetting]);

  // Reset sits in the header, as in the design: the stack header's right side, or the page's own title
  // row when Settings shows two columns (the stack header then carries no buttons).
  const resetButton = useMemo(
    () => (
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.resetButton, pressed && styles.resetButtonPressed]}
        onPress={reset}
      >
        <Text style={styles.resetLabel}>{CommandPadCopy.reset}</Text>
      </Pressable>
    ),
    [reset, styles],
  );
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => resetButton });
  }, [navigation, resetButton]);

  return (
    <SettingsColumnsFrame title={SettingsCopy.padKeysTitle} trailing={resetButton}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <SettingsPageScrollView contentContainerStyle={styles.list}>
          <Text style={styles.intro}>{CommandPadCopy.editorIntro}</Text>
          <View style={styles.preview}>
            {keys.map((padKey, position) => {
              const positionName = CommandPadCopy.positions[COMMAND_PAD_POSITIONS[position]];
              return (
                <Pressable
                  key={COMMAND_PAD_POSITIONS[position]}
                  accessibilityRole="button"
                  accessibilityLabel={CommandPadCopy.positionKey(positionName, padKey.label)}
                  accessibilityState={{ selected: editing === position }}
                  style={({ pressed }) => [
                    styles.key,
                    padKey.glyph === 'enter' && styles.keyEnter,
                    editing === position && styles.keyEditing,
                    pressed && styles.keyPressed,
                  ]}
                  onPress={() => setEditing(position)}
                >
                  <CommandPadKeyFace padKey={padKey} color={appearance.foreground} size={22} />
                </Pressable>
              );
            })}
          </View>
        </SettingsPageScrollView>

        <BottomSheet visible={editing !== null} onClose={() => setEditing(null)}>
          <View style={sheetStyles.head}>
            <Text style={sheetStyles.title} accessibilityRole="header">
              {CommandPadCopy.pickerTitle(editingName)}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [sheetStyles.done, pressed && sheetStyles.donePressed]}
              onPress={() => setEditing(null)}
            >
              <Text style={sheetStyles.doneLabel}>{CommandPadCopy.done}</Text>
            </Pressable>
          </View>
          {sections.map((section) => (
            <View key={section.title} style={sheetStyles.section}>
              <Text style={sheetStyles.sectionTitle}>{section.title}</Text>
              {section.choices.length === 0 ? (
                <Text style={sheetStyles.empty}>{CommandPadCopy.customEmpty}</Text>
              ) : (
                <View style={sheetStyles.chips}>
                  {section.choices.map((choice) => {
                    const selected = editing !== null && keys[editing].id === choice.id;
                    return (
                      <Pressable
                        key={choice.id}
                        accessibilityRole="button"
                        accessibilityLabel={choice.label}
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          sheetStyles.chip,
                          pressed && sheetStyles.chipPressed,
                          selected && sheetStyles.chipSelected,
                        ]}
                        onPress={() => {
                          if (editing !== null) assign(editing, choice.id);
                        }}
                      >
                        <Text
                          style={[sheetStyles.chipLabel, selected && sheetStyles.chipLabelSelected]}
                          numberOfLines={1}
                        >
                          {choice.chip}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ))}
        </BottomSheet>
      </SafeAreaView>
    </SettingsColumnsFrame>
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
    intro: {
      color: appearance.muted,
      fontSize: 12,
      lineHeight: 18,
      paddingHorizontal: 4,
    },
    preview: {
      alignSelf: 'center',
      width: 3 * PREVIEW_KEY + 2 * PREVIEW_GAP,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: PREVIEW_GAP,
      paddingVertical: 24,
    },
    key: {
      width: PREVIEW_KEY,
      height: PREVIEW_KEY,
      borderRadius: PREVIEW_KEY / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    keyEnter: {
      backgroundColor: colorWithOpacity(GhostexPalette.ACCENT, 18),
      borderColor: colorWithOpacity(GhostexPalette.ACCENT, 60),
    },
    keyEditing: {
      borderWidth: 3,
      borderColor: GhostexPalette.ACCENT,
    },
    keyPressed: {
      backgroundColor: appearance.cardActive,
    },
    resetButton: {
      minHeight: 32,
      paddingHorizontal: 12,
      justifyContent: 'center',
      borderRadius: GhostexRadii.control,
      backgroundColor: appearance.neutralFill,
    },
    resetButtonPressed: {
      backgroundColor: appearance.neutralFillPressed,
    },
    resetLabel: {
      color: appearance.foreground,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}

/** The sheet is the app's dark bottom sheet (`BottomSheet`), whatever the page's appearance. */
const createSheetStyles = (appearance: Appearance) => StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    color: appearance.foreground,
    fontSize: 17,
    fontWeight: '600',
  },
  done: {
    minHeight: 36,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: GhostexRadii.control,
    backgroundColor: appearance.neutralFill,
  },
  donePressed: {
    backgroundColor: appearance.neutralFillPressed,
  },
  doneLabel: {
    color: appearance.foreground,
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    gap: 8,
    paddingVertical: 8,
  },
  sectionTitle: {
    color: appearance.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  empty: {
    color: appearance.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    minWidth: 48,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    backgroundColor: appearance.neutralFill,
  },
  chipPressed: {
    backgroundColor: appearance.neutralFillPressed,
  },
  chipSelected: {
    backgroundColor: appearance.primaryFill,
    borderColor: appearance.foreground,
  },
  chipLabel: {
    color: appearance.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  chipLabelSelected: {
    color: appearance.foreground,
  },
});
