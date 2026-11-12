/**
 * The search at the top of the Settings list, like the desktop Settings' "Search settings": typing lists the
 * settings it finds on every Settings page (settingsSearchIndex.ts), each with its name, where it is and a short
 * description; a tap opens that page at the setting, which flashes briefly (SettingsSearchAnchor.tsx).
 *
 * The words typed stay while Settings is open, so Back from a result shows the same results; leaving Settings clears
 * them (`clearSettingsSearch`). In two columns both lists share them.
 */

import { useMemo } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { create } from 'zustand';

import { SearchGlyph, XGlyph } from '../../../components/sessions/icons';
import { SettingsSearchCopy } from '../../../copy';
import { GhostexRadii, GhostexStrokeWidth } from '../../../theme/palette';
import { useAppearance } from '../../../theme/useAppearance';
import type { SettingsPageId } from '../pages';
import { Caption, useSettingsStyles } from '../SettingsControls';
import { searchTrim } from './fuzzyMatch';
import type { SettingsSearchFocus } from './SettingsSearchAnchor';
import { searchSettings, type SettingsSearchResult } from './settingsSearchIndex';

const useSettingsSearchStore = create<{ query: string; setQuery: (query: string) => void }>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}));

/** Empties the search; Settings calls it when it closes. */
export function clearSettingsSearch(): void {
  useSettingsSearchStore.getState().setQuery('');
}

/** Whether the list shows search results instead of its pages. */
export function useSettingsSearching(): boolean {
  return useSettingsSearchStore((state) => searchTrim(state.query) !== '');
}

export function SettingsSearchField() {
  const appearance = useAppearance();
  const query = useSettingsSearchStore((state) => state.query);
  const setQuery = useSettingsSearchStore((state) => state.setQuery);
  return (
    <View style={[local.search, { backgroundColor: appearance.input, borderColor: appearance.border }]}>
      <SearchGlyph size={16} color={appearance.mutedGlyph} />
      <TextInput
        keyboardAppearance={appearance.light ? 'light' : 'dark'}
        style={[local.searchInput, { color: appearance.foreground }]}
        value={query}
        onChangeText={setQuery}
        placeholder={SettingsSearchCopy.placeholder}
        placeholderTextColor={appearance.muted}
        accessibilityLabel={SettingsSearchCopy.placeholder}
        autoCapitalize='none'
        autoCorrect={false}
        spellCheck={false}
        clearButtonMode='never'
        returnKeyType='search'
        // Search keeps the results and puts the keyboard away, so the whole list can be read.
        onSubmitEditing={() => Keyboard.dismiss()}
      />
      {query.length > 0 ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={SettingsSearchCopy.clear}
          style={local.clear}
          onPress={() => setQuery('')}
        >
          <XGlyph size={14} color={appearance.mutedGlyph} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ResultRow({ result, onPress }: { result: SettingsSearchResult; onPress: () => void }) {
  const styles = useSettingsStyles();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={SettingsSearchCopy.resultLabel(result.title, result.breadcrumb)}
      accessibilityHint={result.description === '' ? undefined : result.description}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.linkText}>
        <Text style={styles.linkTitle}>{result.title}</Text>
        <Text style={[styles.linkDescription, styles.linkDescriptionAccent]} numberOfLines={1}>
          {result.breadcrumb}
        </Text>
        {result.description !== '' ? (
          <Text style={styles.linkDescription} numberOfLines={2}>
            {result.description}
          </Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/** What the search finds among `pages` (the pages the list shows), or "No settings match". */
export function SettingsSearchResults({
  pages,
  onOpen,
}: {
  pages: readonly SettingsPageId[];
  onOpen: (page: SettingsPageId, focus?: SettingsSearchFocus) => void;
}) {
  const styles = useSettingsStyles();
  const query = useSettingsSearchStore((state) => state.query);
  const results = useMemo(() => searchSettings(query, pages), [query, pages]);

  if (results.length === 0) {
    return (
      <View style={local.empty} accessibilityLiveRegion='polite'>
        <Text style={styles.cardLabel}>{SettingsSearchCopy.noMatches}</Text>
        <Caption>{SettingsSearchCopy.noMatchesHint}</Caption>
      </View>
    );
  }
  return (
    <>
      <Text style={styles.sectionHeader} accessibilityRole='header' accessibilityLiveRegion='polite'>
        {SettingsSearchCopy.count(results.length)}
      </Text>
      {results.map((result) => (
        <ResultRow
          key={result.key}
          result={result}
          onPress={() => {
            Keyboard.dismiss();
            onOpen(result.page, result.focus === undefined ? undefined : { ...result.focus, at: Date.now() });
          }}
        />
      ))}
    </>
  );
}

const local = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingLeft: 12,
    borderRadius: GhostexRadii.row,
    borderWidth: GhostexStrokeWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
  },
  clear: {
    width: 44,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 28,
  },
});
