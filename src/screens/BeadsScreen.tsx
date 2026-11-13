/**
 * A project's beads on the phone, as the desktop Beads view's Tree lists them: beads that need a
 * decision pinned on top, every other bead under its epic with the epic's progress, "Not in an
 * epic" last, done beads folded per section. A filter strip scrolled sideways, search, and the
 * sync pill (its sheet has Pull and Push) sit above the list. A tap on a bead opens it full screen
 * (`BeadScreen`); back returns here where the list was.
 *
 * CDXC:ProjectBoard 2026-11-13 DECISION:
 * Sebastian chose the phone's Beads view as option B: the Tree, the scrolled filters, the sync pill
 * and its menu, and a full-screen bead with back and its Links row (editable only where the computer
 * advertises links); no Board and no New bead on the phone. It opens from a menu row beside Changes,
 * not a new tab.
 * SEE-ALSO: apps/desktop/src/app/native_beads/, packages/gx-core/src/beads_view/tree.rs, src/beads/
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BEADS_SYNC_CAPABILITY } from '../beads/model';
import { beadsTree, type BeadRowModel, type BeadsFilter, type BeadsSection, type BeadsTree } from '../beads/tree';
import { NoticeCard, PriorityTag, StatusMark, SyncPill, SyncSheet, syncFailure } from '../beads/parts';
import {
  beadsKey,
  currentBinding,
  dismissBeadsNotice,
  fetchBeads,
  runBeads,
  useBeadsEntry,
  useBeadsPolling,
  type BeadsBinding,
} from '../beads/store';
import { Glyph } from '../chat/native/transcript/icons';
import { MONO_FONT, themedStyles, useTranscriptTheme } from '../chat/native/transcript/theme';
import SegmentedStrip from '../components/common/SegmentedStrip';
import { SwitchRow } from '../components/common/SwitchRow';
import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import { BeadsCopy } from '../copy';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Beads'>;

type Item =
  | { type: 'section'; key: string; section: BeadsSection }
  | { type: 'row'; key: string; row: BeadRowModel; done: boolean }
  | { type: 'done'; key: string; section: BeadsSection };

/** What the filter strip and the folds were, per project, so reopening Beads keeps them. */
const viewState = new Map<string, { filter: BeadsFilter; showDone: boolean; openDone: Set<string>; collapsed: Set<string> }>();

export default function BeadsScreen({ navigation, route }: Props) {
  const { machineId, projectId, projectName, projectPath } = route.params;
  const project = useMemo(() => ({ projectId, projectPath }), [projectId, projectPath]);
  const key = beadsKey(machineId, projectId);
  const entry = useBeadsEntry(key);
  const theme = useTranscriptTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const listEdges = useScrollToBarEdges();
  useBeadsPolling(machineId, project);

  const saved = viewState.get(key) ?? {
    filter: 'all' as BeadsFilter,
    showDone: false,
    openDone: new Set<string>(),
    collapsed: new Set<string>(),
  };
  const [filter, setFilterState] = useState<BeadsFilter>(saved.filter);
  const [showDone, setShowDone] = useState(saved.showDone);
  const [openDone, setOpenDone] = useState<Set<string>>(saved.openDone);
  const [collapsed, setCollapsed] = useState<Set<string>>(saved.collapsed);
  const [query, setQuery] = useState('');
  /** The sheet's binding: Pull and Push run for the workspace the sheet opened on. */
  const [syncOpen, setSyncOpen] = useState<BeadsBinding | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  viewState.set(key, { filter, showDone, openDone, collapsed });

  const snapshot = entry.snapshot;
  // The tree comes from the desktop's rules in the phone's WebAssembly core; the last one stays on
  // screen while the next is worked out.
  const [tree, setTree] = useState<BeadsTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeAttempt, setTreeAttempt] = useState(0);
  useEffect(() => {
    if (snapshot?.beads == null) {
      setTree(null);
      return undefined;
    }
    let current = true;
    beadsTree(snapshot.beads, snapshot.readiness, {
      filter,
      showDone,
      query,
      openDone: [...openDone],
      collapsed: [...collapsed],
    })
      .then((next) => {
        if (!current) return;
        setTree(next);
        setTreeError(null);
      })
      .catch((failure: unknown) => {
        if (current) setTreeError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      current = false;
    };
  }, [snapshot, filter, showDone, query, openDone, collapsed, treeAttempt]);

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const items = useMemo<Item[]>(() => {
    if (tree === null) return [];
    const out: Item[] = [];
    for (const section of tree.sections) {
      out.push({ type: 'section', key: `s:${section.key}`, section });
      if (section.collapsed) continue;
      for (const row of section.rows) out.push({ type: 'row', key: `r:${section.key}:${row.id}`, row, done: false });
      if (section.doneCount > 0) out.push({ type: 'done', key: `d:${section.key}`, section });
      for (const row of section.doneRows) out.push({ type: 'row', key: `c:${section.key}:${row.id}`, row, done: true });
    }
    return out;
  }, [tree]);

  const openBead = useCallback(
    (beadId: string) => navigation.navigate('Bead', { machineId, projectId, projectPath, beadId }),
    [machineId, navigation, projectId, projectPath],
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchBeads(machineId, project, true).finally(() => setRefreshing(false));
  }, [machineId, project]);

  const startSync = useCallback(
    (kind: 'pull' | 'push', binding: BeadsBinding | null) => {
      setSyncOpen(null);
      void runBeads(
        machineId,
        project,
        { action: kind === 'push' ? 'doltPush' : 'doltPull' },
        kind === 'push' ? BeadsCopy.pushFailed : BeadsCopy.pullFailed,
        binding,
      );
    },
    [machineId, project],
  );
  const openSync = useCallback(() => setSyncOpen(currentBinding(machineId, projectId)), [machineId, projectId]);

  const canSync = snapshot !== null && snapshot.workspace.state === 'ready' && snapshot.capabilities.includes(BEADS_SYNC_CAPABILITY);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: projectName.length > 0 ? `${BeadsCopy.title} · ${projectName}` : BeadsCopy.title,
      headerStyle: { backgroundColor: theme.background },
      headerTintColor: theme.foreground,
      contentStyle: { backgroundColor: theme.background },
      headerRight: canSync && snapshot !== null ? () => <SyncPill sync={snapshot.sync} onPress={openSync} /> : undefined,
    });
  }, [canSync, navigation, openSync, projectName, snapshot, theme]);

  const syncCard = snapshot !== null ? syncFailure(snapshot.sync.lastResult) : null;
  const [dismissedSyncAt, setDismissedSyncAt] = useState<string | null>(null);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.type === 'section') {
        const { section } = item;
        const epic = section.epic;
        const progress = section.summary !== null && section.summary.total > 0 ? section.summary.done / section.summary.total : 0;
        return (
          <View style={styles.sectionHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !section.collapsed }}
              hitSlop={6}
              onPress={() => setCollapsed((set) => toggle(set, section.key))}
              style={styles.chevron}
            >
              <Glyph name={section.collapsed ? 'chevron-right' : 'chevron-down'} size={15} color={theme.muted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={epic === null}
              onPress={() => epic !== null && openBead(epic.id)}
              style={({ pressed }) => [styles.sectionMain, pressed && styles.pressed]}
            >
              <View style={styles.sectionTitleLine}>
                <Text style={styles.sectionTitle} numberOfLines={2}>
                  {section.title}
                </Text>
                {epic === null ? <Text style={styles.sectionCount}>{section.count}</Text> : null}
                <View style={styles.spacer} />
                {epic !== null ? <PriorityTag priority={epic.priority} /> : null}
              </View>
              {section.summary !== null ? (
                <View style={styles.summaryLine}>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                  <Text style={styles.summaryText} numberOfLines={1}>
                    {section.summary.text}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        );
      }
      if (item.type === 'done') {
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: item.section.doneOpen }}
            onPress={() => setOpenDone((set) => toggle(set, item.section.key))}
            style={({ pressed }) => [styles.doneRow, pressed && styles.pressed]}
          >
            <Glyph name={item.section.doneOpen ? 'chevron-down' : 'chevron-right'} size={13} color={theme.muted} />
            <Text style={styles.doneText}>{BeadsCopy.done(item.section.doneCount)}</Text>
          </Pressable>
        );
      }
      const { row } = item;
      return (
        <Pressable
          accessibilityRole="button"
          onPress={() => openBead(row.id)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.mark}>
            <StatusMark glyph={row.glyph} />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, row.closed && styles.rowTitleDone]} numberOfLines={2}>
              {row.title}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {[...row.meta, ...row.labels.map((label) => `#${label}`)].join(' · ')}
            </Text>
          </View>
          <PriorityTag priority={row.priority} />
        </Pressable>
      );
    },
    [openBead, styles, theme.muted],
  );

  const header = (
    <View>
      <View style={styles.searchRow}>
        <Glyph name="search" size={15} color={theme.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={BeadsCopy.search}
          placeholderTextColor={theme.placeholder}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>
      <SegmentedStrip
        accessibilityLabel={BeadsCopy.filters}
        selected={tree?.filter ?? filter}
        onSelect={setFilterState}
        items={tree?.filters ?? [{ key: 'all', label: 'All' }]}
      />
      <SwitchRow label={BeadsCopy.showDone} value={showDone} onValueChange={setShowDone} style={styles.switchRow}>
        <Text style={styles.switchLabel}>{BeadsCopy.showDone}</Text>
        <Switch value={showDone} onValueChange={setShowDone} />
      </SwitchRow>
      <View style={styles.headerGap} />
      {tree !== null && !tree.readinessOk ? <Text style={styles.note}>{BeadsCopy.readinessPaused}</Text> : null}
      {treeError !== null ? (
        <NoticeCard
          notice={{ title: BeadsCopy.listFailedTitle, message: BeadsCopy.coreFailed, details: treeError }}
          action={{ label: BeadsCopy.retry, onPress: () => setTreeAttempt((attempt) => attempt + 1) }}
        />
      ) : null}
      {entry.notice !== null ? <NoticeCard notice={entry.notice} onDismiss={() => dismissBeadsNotice(machineId, projectId)} /> : null}
      {syncCard !== null && snapshot?.sync.lastResult?.at !== dismissedSyncAt ? (
        <NoticeCard
          notice={syncCard}
          action={syncCard.pullNow ? { label: BeadsCopy.pull, onPress: () => startSync('pull', currentBinding(machineId, projectId)) } : undefined}
          onDismiss={() => setDismissedSyncAt(snapshot?.sync.lastResult?.at ?? null)}
        />
      ) : null}
    </View>
  );

  let body: React.ReactNode = null;
  if (entry.unsupported) {
    body = <StateBlock title={BeadsCopy.oldComputerTitle} body={BeadsCopy.oldComputer} />;
  } else if (snapshot?.beads != null && tree === null && treeError !== null) {
    body = (
      <StateBlock
        title={BeadsCopy.listFailedTitle}
        body={BeadsCopy.coreFailed}
        details={treeError}
        action={{ label: BeadsCopy.retry, onPress: () => setTreeAttempt((attempt) => attempt + 1) }}
      />
    );
  } else if (snapshot === null) {
    body =
      entry.error !== null ? (
        <StateBlock title={BeadsCopy.loadFailed} body={entry.error} action={{ label: BeadsCopy.retry, onPress: refresh }} />
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.muted} />
          <Text style={styles.muted}>{BeadsCopy.loading}</Text>
        </View>
      );
  } else if (snapshot.workspace.state === 'none') {
    body = (
      <StateBlock
        title={BeadsCopy.noWorkspaceTitle}
        body={BeadsCopy.noWorkspace(snapshot.workspace.checkedFolder)}
        action={{ label: BeadsCopy.reload, onPress: refresh }}
      />
    );
  } else if (snapshot.workspace.state === 'noBd') {
    body = <StateBlock title={BeadsCopy.noBdTitle} body={BeadsCopy.noBd} action={{ label: BeadsCopy.reload, onPress: refresh }} />;
  } else if (snapshot.workspace.state === 'failed') {
    body = (
      <StateBlock
        title={BeadsCopy.failedTitle}
        body={BeadsCopy.failedBody}
        details={snapshot.workspace.message ?? snapshot.error}
        action={{ label: BeadsCopy.retry, onPress: refresh }}
      />
    );
  }

  return (
    <View style={styles.screen}>
      {body !== null ? (
        body
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            tree === null ? (
              <ActivityIndicator color={theme.muted} style={styles.empty} />
            ) : (
              <Text style={[styles.muted, styles.empty]}>
                {(snapshot?.beads?.length ?? 0) === 0 ? BeadsCopy.emptyAll : BeadsCopy.emptyFiltered}
              </Text>
            )
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={listEdges.scroll}
          contentContainerStyle={[listEdges.content, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.muted} />}
        />
      )}
      {snapshot !== null ? (
        <SyncSheet
          visible={syncOpen !== null}
          sync={snapshot.sync}
          onSync={(kind) => startSync(kind, syncOpen)}
          onClose={() => setSyncOpen(null)}
        />
      ) : null}
    </View>
  );
}

function StateBlock({
  title,
  body,
  details,
  action,
}: {
  title: string;
  body: string;
  /** What bd or the computer said, behind Details. */
  details?: string | null;
  action?: { label: string; onPress: () => void };
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.centered}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.muted}>{body}</Text>
      {open && details != null ? (
        <Text style={styles.stateDetails} selectable>
          {details}
        </Text>
      ) : null}
      {details != null ? (
        <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)} style={styles.stateButton}>
          <Text style={styles.stateButtonText}>{open ? BeadsCopy.hideDetails : BeadsCopy.details}</Text>
        </Pressable>
      ) : null}
      {action !== undefined ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.stateButton}>
          <Text style={styles.stateButtonText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.background },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: t.inputBorder,
    backgroundColor: t.input,
  },
  search: { flex: 1, color: t.foreground, fontSize: 14.5, paddingVertical: 0 },
  headerGap: { height: 4 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  switchLabel: { color: t.foreground, fontSize: 14 },
  note: { color: t.muted, fontSize: 12.5, paddingHorizontal: 14, paddingBottom: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingLeft: 6,
    paddingRight: 14,
    paddingTop: 14,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border,
  },
  chevron: { width: 26, height: 24, alignItems: 'center', justifyContent: 'center' },
  sectionMain: { flex: 1, minWidth: 0, gap: 6 },
  sectionTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  sectionTitle: { color: t.foreground, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  sectionCount: { color: t.muted, fontSize: 13 },
  summaryLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { width: 64, height: 4, borderRadius: 2, backgroundColor: t.meterTrack, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: t.meterFill },
  summaryText: { color: t.muted, fontSize: 12.5, flexShrink: 1 },
  spacer: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 36, paddingRight: 14, paddingVertical: 9 },
  rowPressed: { backgroundColor: t.pressedFill },
  mark: { width: 16, alignItems: 'center', alignSelf: 'flex-start', paddingTop: 2 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: t.foreground, fontSize: 14.5 },
  rowTitleDone: { color: t.muted, textDecorationLine: 'line-through' },
  rowMeta: { color: t.muted, fontSize: 12.5 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 36, paddingVertical: 8 },
  doneText: { color: t.muted, fontSize: 13 },
  pressed: { opacity: 0.6 },
  centered: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingTop: 56 },
  stateDetails: { color: t.muted, fontSize: 12, lineHeight: 17, fontFamily: MONO_FONT, alignSelf: 'stretch' },
  stateTitle: { color: t.foreground, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  muted: { color: t.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  empty: { paddingTop: 32 },
  stateButton: {
    marginTop: 4,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 8,
    backgroundColor: t.neutralFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateButtonText: { color: t.foreground, fontSize: 13, fontWeight: '600' },
}));
