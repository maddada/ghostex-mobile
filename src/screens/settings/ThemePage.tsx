import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useSettingsStore } from '../../settings/store';
import { GhostexPalette, GhostexRadii } from '../../theme/palette';
import {
  normalizeSidebarTint,
  sidebarBackgroundForSettings,
  SIDEBAR_BACKGROUND_CONTRAST_MAX,
  SIDEBAR_BACKGROUND_CONTRAST_MIN,
  SIDEBAR_BACKGROUND_TINT_OPTIONS,
} from '../../theme/sidebarAppearance';
import { useAppearance } from '../../theme/useAppearance';
import { Caption, SettingsScreenLayout, SettingsSlider, useSettingsStyles } from './SettingsControls';

function TintControl({
  value,
  resolvedBackground,
  onChange,
}: {
  value: string;
  resolvedBackground: string;
  onChange: (value: string) => void;
}) {
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();
  const [draft, setDraft] = useState(value.toUpperCase());

  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);

  const commitDraft = (): void => {
    if (/^#[0-9a-f]{6}$/iu.test(draft.trim())) {
      onChange(normalizeSidebarTint(draft));
    } else {
      setDraft(value.toUpperCase());
    }
  };

  return (
    <View style={settingsStyles.card}>
      <View style={styles.tintHeader}>
        <Text style={settingsStyles.rowLabel}>Background Tint</Text>
        <View
          style={[styles.resolvedBackgroundPreview, { backgroundColor: resolvedBackground, borderColor: appearance.border }]}
        />
      </View>
      <View style={styles.tintSwatches}>
        {SIDEBAR_BACKGROUND_TINT_OPTIONS.map((option) => {
          const selected = option.value.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={option.value}
              accessibilityRole='radio'
              accessibilityLabel={`${option.label} background tint`}
              accessibilityState={{ selected }}
              hitSlop={3}
              style={[
                styles.tintSwatch,
                { backgroundColor: option.value, borderColor: appearance.border },
                selected ? styles.tintSwatchSelected : null,
              ]}
              onPress={() => onChange(option.value.toLowerCase())}
            />
          );
        })}
      </View>
      <TextInput
        accessibilityLabel='Background tint hex color'
        autoCapitalize='characters'
        autoCorrect={false}
        maxLength={7}
        placeholder='#808080'
        placeholderTextColor={appearance.muted}
        returnKeyType='done'
        spellCheck={false}
        style={[settingsStyles.input, styles.tintInput]}
        value={draft}
        onBlur={commitDraft}
        onChangeText={(next) => {
          setDraft(next);
          if (/^#[0-9a-f]{6}$/iu.test(next.trim())) {
            onChange(normalizeSidebarTint(next));
          }
        }}
        onSubmitEditing={commitDraft}
      />
    </View>
  );
}

export default function ThemePage() {
  const contrast = useSettingsStore((state) => state.settings.sidebarBackgroundContrast);
  const tint = useSettingsStore((state) => state.settings.sidebarBackgroundTint);
  const setSetting = useSettingsStore((state) => state.setSetting);

  return (
    <SettingsScreenLayout>
      <SettingsSlider
        label='Background Contrast'
        maximumValue={SIDEBAR_BACKGROUND_CONTRAST_MAX}
        minimumValue={SIDEBAR_BACKGROUND_CONTRAST_MIN}
        step={1}
        value={contrast}
        valueLabel={`${contrast}`}
        onValueChange={(value) => setSetting('sidebarBackgroundContrast', value)}
      />
      <Caption>85 is softer gray; 100 is black. Drawer and Settings surfaces adjust automatically.</Caption>
      <TintControl
        value={tint}
        resolvedBackground={sidebarBackgroundForSettings(tint, contrast)}
        onChange={(value) => setSetting('sidebarBackgroundTint', value)}
      />
      <Caption>Uses the same tint colors as the desktop sidebar.</Caption>
    </SettingsScreenLayout>
  );
}

const styles = StyleSheet.create({
  tintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resolvedBackgroundPreview: {
    width: 28,
    height: 28,
    borderRadius: GhostexRadii.pill,
    borderWidth: 1,
  },
  tintSwatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tintSwatch: {
    width: 28,
    height: 28,
    borderRadius: 5,
    borderWidth: 1,
  },
  tintSwatchSelected: {
    borderWidth: 3,
    borderColor: GhostexPalette.ACCENT,
  },
  tintInput: {
    fontFamily: 'monospace',
  },
});
