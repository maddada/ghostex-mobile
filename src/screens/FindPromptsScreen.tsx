/**
 * Find Prompts: the GUI for `gx f` on the phone, scoped to one machine because
 * prompt history lives on the machine that ran the agent.
 *
 * A search field and the agent, project and day-grouping filters on top, the
 * ranked results under them (paged in as the list scrolls), the matched/total
 * count in a pill over the results' bottom-right corner, and a notice strip
 * under them when the search failed or a history store could not be read.
 * Tapping a result opens the prompt screen, where it is read in full, starred,
 * copied, resumed or forked.
 *
 * CDXC:PromptSearch 2026-10-01 DECISION:
 * User: the phone's Find page "should be React Native screens", like the phone chat, replacing the bundled React page in a WebView. Touch replaces the `gx f` key map here (the phone has no Ctrl chords); the ranking, matcher, Codex cache and favorites file stay the daemon's, so results and stars match `gx f` and the desktop.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import KeyboardAvoidingContainer from '../components/common/keyboard/KeyboardAvoidingContainer';
import { useKeyboardTop } from '../components/common/keyboard/keyboardFrame';
import { ChevronDownGlyph, SearchGlyph, XGlyph } from '../components/sessions/icons';
import { FindPromptsCopy } from '../copy';
import FindPromptRow from '../find/FindPromptRow';
import { FindAgentFilterSheet, FindProjectFilterSheet } from '../find/FindFilterSheets';
import { formatDayHeader, formatLastActiveCompact } from '../find/findFormat';
import { useFindPromptsStore } from '../find/findPromptsStore';
import { useFindStyles, type FindStyles } from '../find/findStyles';
import { FIND_PROMPT_AGENTS, type FindPromptRow as FindPromptRowData } from '../find/promptSearch';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useAppearanceHeader } from './settings/useAppearanceHeader';

type Props = NativeStackScreenProps<RootStackParamList, 'FindPrompts'>;

/** Keystroke settle time before re-querying; the server ranks in about 100ms. */
const FIND_QUERY_DEBOUNCE_MS = 120;

type Section = { key: string; dayKey: number | null; data: FindPromptRowData[] };

/** Consecutive rows of one day form a section; the server already sorted them by day when grouping. */
function buildSections(rows: readonly FindPromptRowData[], groupByDay: boolean): Section[] {
  if (rows.length === 0) return [];
  if (!groupByDay) return [{ key: 'all', dayKey: null, data: [...rows] }];
  const sections: Section[] = [];
  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (last !== undefined && last.dayKey === row.dayKey) last.data.push(row);
    else sections.push({ key: `day-${sections.length}-${row.dayKey}`, dayKey: row.dayKey, data: [row] });
  }
  return sections;
}

/** Relative labels ("6m ago") go stale while Find sits open. */
function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function ListSkeleton({ styles, groupByDay }: { styles: FindStyles; groupByDay: boolean }) {
  const widths = ['92%', '74%', '86%', '64%', '80%', '70%'] as const;
  return (
    <View accessibilityLabel="Loading prompts">
      {groupByDay ? <View style={[styles.skeletonBar, { width: 70, marginLeft: 10, marginTop: 14 }]} /> : null}
      {widths.map((width, position) => (
        <View key={position} style={styles.skeletonRow}>
          <View style={[styles.skeletonBar, { width }]} />
          <View style={[styles.skeletonBar, { width: '45%', height: 10 }]} />
        </View>
      ))}
    </View>
  );
}

function FilterChip({
  styles,
  label,
  active,
  grow,
  accessibilityLabel,
  chevronColor,
  onPress,
}: {
  styles: FindStyles;
  label: string;
  active: boolean;
  grow: boolean;
  accessibilityLabel: string;
  chevronColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        grow ? styles.chipGrow : null,
        active ? styles.chipActive : null,
        pressed ? styles.chipPressed : null,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]} numberOfLines={1}>
        {label}
      </Text>
      {chevronColor !== undefined ? <ChevronDownGlyph size={14} color={chevronColor} /> : null}
    </Pressable>
  );
}

export default function FindPromptsScreen({ navigation, route }: Props) {
  const { machineId } = route.params;
  useAppearanceHeader();
  const { appearance, styles } = useFindStyles();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardTop() !== null;
  const machine = useMachinesStore((state) => state.machines.find((candidate) => candidate.id === machineId));
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const inputRef = useRef<TextInput | null>(null);
  const [sheet, setSheet] = useState<'agent' | 'project' | null>(null);
  const now = useNowSeconds();

  const find = useFindPromptsStore(
    useShallow((state) => ({
      query: state.query,
      agents: state.agents,
      project: state.project,
      groupByDay: state.groupByDay,
      rows: state.rows,
      matched: state.matched,
      total: state.total,
      agentFacets: state.agentFacets,
      projectFacets: state.projectFacets,
      loading: state.loading,
      loadingMore: state.loadingMore,
      refreshing: state.refreshing,
      notice: state.notice,
    })),
  );
  const actions = useFindPromptsStore.getState();

  useLayoutEffect(() => {
    useFindPromptsStore.getState().open(machineId);
  }, [machineId]);

  // Changing the query or a filter restarts the results at the top, like the terminal picker.
  const agentsKey = find.agents.join(',');
  useEffect(() => {
    const timer = setTimeout(() => {
      const target = machineRef.current;
      if (target !== undefined) void useFindPromptsStore.getState().search(target);
    }, FIND_QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [machineId, find.query, agentsKey, find.project, find.groupByDay]);

  const agentColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const facet of find.agentFacets) colors[facet.agent] = facet.color;
    return colors;
  }, [find.agentFacets]);

  const sections = useMemo(() => buildSections(find.rows, find.groupByDay), [find.rows, find.groupByDay]);

  const openRow = useCallback(
    (row: FindPromptRowData) => navigation.navigate('FindPrompt', { machineId, promptKey: row.key }),
    [machineId, navigation],
  );
  const toggleFavorite = useCallback((row: FindPromptRowData) => {
    const target = machineRef.current;
    if (target !== undefined) void useFindPromptsStore.getState().toggleFavorite(target, row.key);
  }, []);

  if (machine === undefined) return <View style={styles.page} />;

  const agentLabel =
    find.agents.length === 0
      ? FindPromptsCopy.allAgents
      : FIND_PROMPT_AGENTS.filter((agent) => find.agents.includes(agent)).join(', ');
  const projectLabel =
    find.project === null
      ? FindPromptsCopy.allProjects
      : (find.projectFacets.find((facet) => facet.path === find.project)?.name ?? find.project);
  const showSkeleton = find.loading && find.rows.length === 0;
  const searchFailed = find.notice?.kind === 'error' && find.rows.length === 0;

  return (
    <KeyboardAvoidingContainer style={[styles.page, { paddingBottom: keyboardOpen ? 0 : insets.bottom }]}>
      <View style={styles.toolbar}>
        <View style={styles.field}>
          <SearchGlyph size={16} color={appearance.muted} />
          <TextInput
            ref={inputRef}
            autoFocus
            value={find.query}
            onChangeText={actions.setQuery}
            placeholder={FindPromptsCopy.placeholder}
            placeholderTextColor={appearance.muted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="search"
            submitBehavior="blurAndSubmit"
            accessibilityLabel={FindPromptsCopy.placeholder}
            onSubmitEditing={() => {
              // The search key opens the top result, as Enter acts on the top result in `gx f`.
              const first = find.rows[0];
              if (first !== undefined) openRow(first);
            }}
          />
          {find.query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={FindPromptsCopy.clear}
              hitSlop={8}
              onPress={() => {
                actions.setQuery('');
                inputRef.current?.focus();
              }}
            >
              <XGlyph size={16} color={appearance.muted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.chips}>
          <FilterChip
            styles={styles}
            label={agentLabel}
            active={find.agents.length > 0}
            grow
            accessibilityLabel={FindPromptsCopy.agentsTitle}
            chevronColor={appearance.muted}
            onPress={() => setSheet('agent')}
          />
          <FilterChip
            styles={styles}
            label={projectLabel}
            active={find.project !== null}
            grow
            accessibilityLabel={FindPromptsCopy.projectsTitle}
            chevronColor={appearance.muted}
            onPress={() => setSheet('project')}
          />
          <FilterChip
            styles={styles}
            label={FindPromptsCopy.groupByDay}
            active={find.groupByDay}
            grow={false}
            accessibilityLabel={find.groupByDay ? FindPromptsCopy.groupByDayOn : FindPromptsCopy.groupByDayOff}
            onPress={() => actions.setGroupByDay(!find.groupByDay)}
          />
        </View>
      </View>

      <View style={{ flex: 1, minHeight: 0 }}>
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => (
            <FindPromptRow
              row={item}
              timeLabel={formatLastActiveCompact(item.ts, now)}
              styles={styles}
              dimColor={appearance.muted}
              onOpen={openRow}
              onToggleFavorite={toggleFavorite}
            />
          )}
          renderSectionHeader={({ section }) =>
            section.dayKey === null ? null : (
              <Text style={styles.dayHeader} numberOfLines={1}>
                {formatDayHeader(section.dayKey, now)}
              </Text>
            )
          }
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.6}
          onEndReached={() => void actions.loadMore(machine)}
          refreshControl={
            <RefreshControl
              refreshing={find.refreshing}
              onRefresh={() => void actions.search(machine, { refresh: true })}
              tintColor={appearance.muted}
              colors={[appearance.foreground]}
              progressBackgroundColor={appearance.card}
            />
          }
          ListEmptyComponent={
            showSkeleton ? (
              <ListSkeleton styles={styles} groupByDay={find.groupByDay} />
            ) : (
              <Text style={styles.empty}>
                {searchFailed
                  ? FindPromptsCopy.searchFailed
                  : find.total === 0
                    ? FindPromptsCopy.noHistory
                    : FindPromptsCopy.noMatches}
              </Text>
            )
          }
          ListFooterComponent={
            find.loadingMore ? <ActivityIndicator style={{ paddingVertical: 12 }} color={appearance.muted} /> : null
          }
        />
        {/* CDXC:PromptSearch 2026-09-08 DECISION: Hide the result counter while loading so Find does not display provisional 0/0 counts. */}
        {!find.loading ? (
          <View style={styles.countPill} pointerEvents="none">
            <Text style={styles.countText} accessibilityLiveRegion="polite">
              {find.matched}/{find.total}
            </Text>
          </View>
        ) : null}
      </View>

      {find.notice !== null ? (
        <View
          style={[styles.notice, find.notice.kind === 'error' ? styles.noticeError : null]}
          accessibilityRole="alert"
        >
          <Text
            style={[styles.noticeText, find.notice.kind === 'error' ? styles.noticeTextError : null]}
            numberOfLines={3}
          >
            {find.notice.message}
            {find.notice.detail !== undefined ? (
              <Text style={styles.noticeDetail}> {find.notice.detail}</Text>
            ) : null}
          </Text>
        </View>
      ) : null}

      <FindAgentFilterSheet
        visible={sheet === 'agent'}
        colors={agentColors}
        selected={find.agents}
        onToggle={actions.toggleAgent}
        onClear={actions.clearAgents}
        onClose={() => setSheet(null)}
      />
      <FindProjectFilterSheet
        visible={sheet === 'project'}
        projects={find.projectFacets}
        selected={find.project}
        onSelect={actions.setProject}
        onClose={() => setSheet(null)}
      />
    </KeyboardAvoidingContainer>
  );
}
