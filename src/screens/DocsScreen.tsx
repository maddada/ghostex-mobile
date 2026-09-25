/**
 * A project's Docs on the phone: the Markdown and HTML files in the folders the desktop Docs view
 * lists (gxserver's list, `src/docs/client.ts`), as a folder tree with a search box and the most
 * recently changed files on top. Tapping a file opens it in the Docs viewer.
 *
 * CDXC:Docs 2026-09-24 DECISION:
 * User: "i want also docs list in the app for folders and the docs and mds in them. implement this
 * with react native." The list is native React Native (not a bundled web page), reached from a
 * project's long-press menu and the terminal screen's menu, and only shows Markdown and HTML.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CaretRightGlyph,
  FolderGlyph,
  FolderOpenGlyph,
  NoteGlyph,
  SearchGlyph,
  WorldGlyph,
  XGlyph,
} from '../components/sessions/icons';
import { RefreshIcon } from '../components/terminal/icons';
import { DocsCopy } from '../copy';
import { listProjectDocs, resolveDocsEntryPath } from '../docs/client';
import { buildDocsTree, flattenDocsFiles, recentDocsFiles, searchDocsFiles, type DocsFileNode, type DocsNode } from '../docs/tree';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Docs'>;

const RECENT_LIMIT = 6;
const INDENT = 16;

type Listing = { tree: DocsNode[]; files: DocsFileNode[] };

/** The last listing per project, so returning to Docs shows it at once while it refreshes. */
const listingCache = new Map<string, Listing>();

type Row =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'folder'; key: string; node: Extract<DocsNode, { kind: 'directory' }>; depth: number; expanded: boolean }
  | { kind: 'file'; key: string; node: DocsFileNode; depth: number; showLocation: boolean };

function relativeTime(timestamp: number | null): string {
  if (timestamp === null) return '';
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function folderOf(file: DocsFileNode): string {
  const slash = file.displayPath.lastIndexOf('/');
  return slash < 0 ? '' : file.displayPath.slice(0, slash);
}

export default function DocsScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { machineId, projectId, projectName, projectPath } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((candidate) => candidate.id === machineId));
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const cacheKey = `${machineId}\u0000${projectId}`;
  const [listing, setListing] = useState<Listing | null>(() => listingCache.get(cacheKey) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const target = machineRef.current;
    if (target === undefined) {
      setError(DocsCopy.machineMissing);
      return;
    }
    generation.current += 1;
    const current = generation.current;
    setLoading(true);
    setError(null);
    listProjectDocs(target, projectId)
      .then((entries) => {
        if (current !== generation.current) return;
        const tree = buildDocsTree(entries);
        const next = { tree, files: flattenDocsFiles(tree) };
        listingCache.set(cacheKey, next);
        setListing(next);
      })
      .catch((failure: unknown) => {
        if (current !== generation.current) return;
        const message = failure instanceof Error ? failure.message : String(failure);
        setError(/unsupportedClient|Unknown command: session-chat-rpc|Update Ghostex/iu.test(message) ? DocsCopy.oldCli : message);
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
  }, [cacheKey, projectId]);

  useEffect(() => {
    refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: projectName.length > 0 ? `${DocsCopy.listTitle} · ${projectName}` : DocsCopy.listTitle,
      headerRight: () => (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={DocsCopy.reload}
          hitSlop={6}
          onPress={refresh}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <RefreshIcon size={18} color={GhostexPalette.FOREGROUND} />
        </Pressable>
      ),
    });
  }, [navigation, projectName, refresh]);

  // Top-level folders start open; everything deeper starts closed.
  const expandedSet = useMemo(() => {
    if (expanded !== null) return expanded;
    return new Set((listing?.tree ?? []).filter((node) => node.kind === 'directory').map((node) => node.path));
  }, [expanded, listing]);

  const toggleFolder = useCallback(
    (path: string) => {
      const next = new Set(expandedSet);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      setExpanded(next);
    },
    [expandedSet]
  );

  const openFile = useCallback(
    (file: DocsFileNode) => {
      const target = machineRef.current;
      if (target === undefined || opening !== null) return;
      setOpening(file.path);
      resolveDocsEntryPath(target, projectId, projectPath, file.path)
        .then((path) => navigation.push('DocViewer', { machineId, path }))
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
        .finally(() => setOpening(null));
    },
    [machineId, navigation, opening, projectId, projectPath]
  );

  const rows = useMemo<Row[]>(() => {
    if (listing === null) return [];
    const trimmed = query.trim();
    if (trimmed.length > 0) {
      const matches = searchDocsFiles(listing.files, trimmed);
      return [
        { kind: 'section', key: 'search', title: DocsCopy.searchSection(matches.length) },
        ...matches.map((node): Row => ({ kind: 'file', key: `match:${node.path}`, node, depth: 0, showLocation: true })),
      ];
    }
    const out: Row[] = [];
    const recent = recentDocsFiles(listing.files, RECENT_LIMIT);
    if (recent.length > 0 && listing.files.length > RECENT_LIMIT) {
      out.push({ kind: 'section', key: 'recent', title: DocsCopy.recentSection });
      for (const node of recent) out.push({ kind: 'file', key: `recent:${node.path}`, node, depth: 0, showLocation: true });
      out.push({ kind: 'section', key: 'folders', title: DocsCopy.foldersSection });
    }
    const walk = (nodes: readonly DocsNode[], depth: number) => {
      for (const node of nodes) {
        if (node.kind === 'file') {
          out.push({ kind: 'file', key: node.path, node, depth, showLocation: false });
          continue;
        }
        const isOpen = expandedSet.has(node.path);
        out.push({ kind: 'folder', key: node.path, node, depth, expanded: isOpen });
        if (isOpen) walk(node.children, depth + 1);
      }
    };
    walk(listing.tree, 0);
    return out;
  }, [expandedSet, listing, query]);

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'section') return <Text style={styles.sectionTitle}>{item.title}</Text>;
      if (item.kind === 'folder') {
        return (
          <Pressable
            accessibilityRole='button'
            accessibilityState={{ expanded: item.expanded }}
            onPress={() => toggleFolder(item.node.path)}
            style={({ pressed }) => [styles.row, { paddingLeft: 12 + item.depth * INDENT }, pressed && styles.rowPressed]}
          >
            <CaretRightGlyph size={12} color={GhostexPalette.MUTED} rotated={item.expanded} />
            {item.expanded ? (
              <FolderOpenGlyph size={16} color={GhostexPalette.MUTED} />
            ) : (
              <FolderGlyph size={16} color={GhostexPalette.MUTED} />
            )}
            <Text style={styles.folderName} numberOfLines={1}>
              {item.node.name}
            </Text>
            <Text style={styles.meta}>{DocsCopy.fileCount(item.node.fileCount)}</Text>
          </Pressable>
        );
      }
      const file = item.node;
      const location = item.showLocation ? folderOf(file) : '';
      return (
        <Pressable
          accessibilityRole='button'
          onPress={() => openFile(file)}
          style={({ pressed }) => [
            styles.row,
            { paddingLeft: 12 + item.depth * INDENT + (item.showLocation ? 0 : 18) },
            pressed && styles.rowPressed,
          ]}
        >
          {file.docKind === 'html' ? (
            <WorldGlyph size={16} color={GhostexPalette.ACCENT} />
          ) : (
            <NoteGlyph size={16} color={GhostexPalette.FOREGROUND} />
          )}
          <View style={styles.fileText}>
            <Text style={styles.fileName} numberOfLines={1}>
              {file.name}
            </Text>
            {location.length > 0 ? (
              <Text style={styles.location} numberOfLines={1}>
                {location}
              </Text>
            ) : null}
          </View>
          {opening === file.path ? (
            <ActivityIndicator size='small' color={GhostexPalette.MUTED} />
          ) : (
            <Text style={styles.meta}>{relativeTime(file.modifiedAt)}</Text>
          )}
        </Pressable>
      );
    },
    [openFile, opening, toggleFolder]
  );

  const empty =
    listing === null ? (
      loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={GhostexPalette.MUTED} />
          <Text style={styles.muted}>{DocsCopy.loading}</Text>
        </View>
      ) : null
    ) : query.trim().length > 0 ? null : (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>{DocsCopy.empty}</Text>
        <Text style={styles.muted}>{DocsCopy.emptyHint}</Text>
      </View>
    );

  return (
    <View style={styles.screen}>
      <View style={styles.searchBar}>
        <SearchGlyph size={15} color={GhostexPalette.MUTED} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={DocsCopy.searchPlaceholder}
          placeholderTextColor={GhostexPalette.MUTED}
          autoCapitalize='none'
          autoCorrect={false}
          spellCheck={false}
          clearButtonMode='never'
          returnKeyType='search'
        />
        {query.length > 0 ? (
          <Pressable accessibilityRole='button' accessibilityLabel='Clear search' hitSlop={8} onPress={() => setQuery('')}>
            <XGlyph size={14} color={GhostexPalette.MUTED} />
          </Pressable>
        ) : null}
      </View>
      {error !== null ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{DocsCopy.listFailed}</Text>
          <Text style={styles.errorBody} selectable>
            {error}
          </Text>
          <Pressable accessibilityRole='button' onPress={refresh} style={styles.retryButton}>
            <Text style={styles.retryText}>{DocsCopy.retry}</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
        ListEmptyComponent={error === null ? empty : null}
        ListFooterComponent={
          query.trim().length > 0 && rows.length <= 1 ? <Text style={[styles.muted, styles.noMatches]}>{DocsCopy.noMatches}</Text> : null
        }
        refreshControl={
          <RefreshControl refreshing={loading && listing !== null} onRefresh={refresh} tintColor={GhostexPalette.MUTED} />
        }
        initialNumToRender={30}
        windowSize={11}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: GhostexPalette.BACKGROUND },
  headerButton: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
  },
  searchInput: { flex: 1, color: GhostexPalette.FOREGROUND, fontSize: 15, paddingVertical: 0 },
  listContent: { paddingTop: 4 },
  sectionTitle: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingRight: 14, paddingVertical: 6 },
  rowPressed: { backgroundColor: GhostexPalette.CARD_ACTIVE },
  folderName: { flex: 1, color: GhostexPalette.FOREGROUND, fontSize: 15, fontWeight: '500' },
  fileText: { flex: 1, minWidth: 0 },
  fileName: { color: GhostexPalette.FOREGROUND, fontSize: 15 },
  location: { color: GhostexPalette.MUTED, fontSize: 12, marginTop: 1 },
  meta: { color: GhostexPalette.MUTED, fontSize: 12 },
  centered: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingTop: 56 },
  emptyTitle: { color: GhostexPalette.FOREGROUND, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  muted: { color: GhostexPalette.MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  noMatches: { paddingTop: 24 },
  errorCard: {
    margin: 12,
    padding: 14,
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.CARD,
  },
  errorTitle: { color: GhostexPalette.FOREGROUND, fontSize: 14, fontWeight: '600' },
  errorBody: { color: GhostexPalette.MUTED, fontSize: 13, lineHeight: 18 },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 8,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: GhostexPalette.ACCENT_FOREGROUND, fontSize: 13, fontWeight: '600' },
});
