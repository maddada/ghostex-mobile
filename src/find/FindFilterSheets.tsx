/**
 * The agent and project filters of Find, as bottom sheets: the phone's form of
 * the desktop window's two dropdowns (checkmarks on the active choices, a
 * searchable project list). Agents are a multi-select that stays open; picking a
 * project applies it and closes the sheet.
 */

import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import BottomSheet from '../components/common/BottomSheet';
import { CheckGlyph } from '../components/onboarding/SetupIcons';
import { FindPromptsCopy } from '../copy';
import { useFindStyles } from './findStyles';
import {
  FIND_PROMPT_AGENTS,
  type FindPromptAgent,
  type FindPromptProjectFacet,
} from './promptSearch';

function SheetRow({
  checked,
  label,
  detail,
  dotColor,
  onPress,
}: {
  checked: boolean;
  label: string;
  detail?: string;
  dotColor?: string;
  onPress: () => void;
}) {
  const { appearance, styles } = useFindStyles();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => [styles.sheetRow, pressed ? styles.rowPressed : null]}
      onPress={onPress}
    >
      <View style={styles.sheetCheck}>
        {checked ? <CheckGlyph size={16} color={appearance.foreground} strokeWidth={2.4} /> : null}
      </View>
      {dotColor !== undefined ? <View style={[styles.agentDot, { backgroundColor: dotColor }]} /> : null}
      <View style={styles.sheetRowText}>
        <Text style={styles.sheetRowLabel} numberOfLines={1}>
          {label}
        </Text>
        {detail !== undefined && detail.length > 0 ? (
          <Text style={styles.sheetRowDetail} numberOfLines={1} ellipsizeMode="middle">
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function FindAgentFilterSheet({
  visible,
  colors,
  selected,
  onToggle,
  onClear,
  onClose,
}: {
  visible: boolean;
  colors: Readonly<Record<string, string>>;
  selected: readonly FindPromptAgent[];
  onToggle: (agent: FindPromptAgent) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { appearance, styles } = useFindStyles();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>{FindPromptsCopy.agentsTitle}</Text>
      <SheetRow checked={selected.length === 0} label={FindPromptsCopy.allAgents} onPress={onClear} />
      {FIND_PROMPT_AGENTS.map((agent) => (
        <SheetRow
          key={agent}
          checked={selected.includes(agent)}
          label={agent}
          dotColor={colors[agent] ?? appearance.muted}
          onPress={() => onToggle(agent)}
        />
      ))}
    </BottomSheet>
  );
}

export function FindProjectFilterSheet({
  visible,
  projects,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  projects: readonly FindPromptProjectFacet[];
  selected: string | null;
  onSelect: (path: string | null) => void;
  onClose: () => void;
}) {
  const { appearance, styles } = useFindStyles();
  const [filter, setFilter] = useState('');
  const close = () => {
    setFilter('');
    onClose();
  };
  const pick = (path: string | null) => {
    onSelect(path);
    close();
  };
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return projects;
    return projects.filter(
      (facet) => facet.name.toLowerCase().includes(needle) || facet.path.toLowerCase().includes(needle),
    );
  }, [filter, projects]);
  return (
    <BottomSheet visible={visible} onClose={close}>
      <Text style={styles.sheetTitle}>{FindPromptsCopy.projectsTitle}</Text>
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder={FindPromptsCopy.projectsPlaceholder}
        placeholderTextColor={appearance.muted}
        style={styles.sheetField}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel={FindPromptsCopy.projectsPlaceholder}
      />
      {filter.trim().length === 0 ? (
        <SheetRow checked={selected === null} label={FindPromptsCopy.allProjects} onPress={() => pick(null)} />
      ) : null}
      {shown.map((facet) => (
        <SheetRow
          key={facet.path}
          checked={selected === facet.path}
          label={facet.name.length > 0 ? facet.name : facet.path}
          detail={facet.path}
          onPress={() => pick(facet.path)}
        />
      ))}
      {shown.length === 0 ? <Text style={styles.empty}>{FindPromptsCopy.noProjects}</Text> : null}
    </BottomSheet>
  );
}
