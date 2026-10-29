/**
 * A project's Changes on the phone, read-only: the same diff the desktop Changes tab shows
 * (gxserver's `changesDiff`, `src/changes/client.ts`) against main or against HEAD, as a file list
 * with +/− counts and one unified stream with pinned file headers that fold, old and new line
 * numbers, word-level highlights and the unchanged lines between hunks folded into a count.
 *
 * CDXC:Changes 2026-10-25 DECISION:
 * The user chose "phone read-only" for the Changes view: the phone shows the diff, switches between
 * Whole branch and Uncommitted only, and copies a held line, but has no line comments, revert or commit
 * bar. It opens from the session screen's ⋯ menu and a session row's long-press menu, for that
 * session's project.
 *
 * CDXC:Changes 2026-10-27 DECISION: User: "i don't like "Uncommited" and "Against main" being shown as 2 buttons, should just be a toggle button on the right side that toggles these 2 states and should be clearer name". They picked the dropdown-style button (Q650 "dropdown") named "Whole branch & Uncommitted only" (Q651), and the phone gets the same as the desktop (Q652 "same").
 * SEE-ALSO: apps/desktop/src/app/native_changes/view.rs, src/changes/model.ts
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Glyph } from '../chat/native/transcript/icons';
import { MONO_FONT, themedStyles, useTranscriptTheme, type TranscriptTheme } from '../chat/native/transcript/theme';
import { ChangesUnsupportedError, readChanges } from '../changes/client';
import {
  buildRows,
  fileName,
  folderOf,
  lineSegments,
  ROW_HEIGHTS,
  rowOffsets,
  sliceSegments,
  type ChangedFile,
  type ChangesAnswer,
  type ChangesData,
  type ChangesRow,
  type ChangesScope,
  type FileStatus,
  type HunkLine,
  type LineSegment,
  type TokenKind,
} from '../changes/model';
import { GitBranchGlyph, PencilGlyph } from '../components/sessions/icons';
import { useStackScreenRail } from '../components/common/verticalBar/stackRail';
import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import { RefreshIcon } from '../components/terminal/icons';
import { ChangesCopy } from '../copy';
import { FILE_LIST_DETAIL_SIZE, FILE_LIST_NAME_SIZE, FILE_VIEWER_CODE_SIZE } from '../docs/textSizes';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Changes'>;

/** The last answer per project and scope, so reopening Changes shows it at once while it refreshes. */
const answerCache = new Map<string, ChangesAnswer>();

const COPIED_NOTICE_MS = 1_400;
/**
 * The diff text's size, and everything left of and right of the code on a line row. The diff uses
 * the file viewer's code size and its file headers the Files list's sizes (`docs/textSizes.ts`).
 */
const CODE_SIZE = FILE_VIEWER_CODE_SIZE;
const NUMBER_WIDTH = 34;
const SIGN_WIDTH = 16;
const LINE_END_PADDING = 10;
const CODE_INSET = NUMBER_WIDTH * 2 + SIGN_WIDTH + LINE_END_PADDING;
const MEASURE_SAMPLE = '0'.repeat(40);

/** The desktop Changes tab's hues (`native_changes/style.rs`), by theme. */
function palette(theme: TranscriptTheme) {
  const pick = (dark: string, light: string) => (theme.light ? light : dark);
  const rgba = (hex: number, alpha: number) => `rgba(${hex >> 16},${(hex >> 8) & 0xff},${hex & 0xff},${alpha})`;
  return {
    hairline: theme.ink(theme.light ? 0.08 : 0.06),
    header: theme.light ? '#f4f4f5' : '#151515',
    /** A held file header: opaque, since it may be pinned over the lines scrolling under it. */
    headerPressed: theme.light ? '#e4e4e7' : '#222222',
    addedRow: rgba(0x16a34a, theme.light ? 0.12 : 0.14),
    addedGutter: rgba(0x16a34a, theme.light ? 0.2 : 0.22),
    addedWord: rgba(0x22c55e, theme.light ? 0.3 : 0.34),
    removedRow: rgba(0xef4444, theme.light ? 0.1 : 0.13),
    removedGutter: rgba(0xef4444, theme.light ? 0.18 : 0.2),
    removedWord: rgba(0xf87171, theme.light ? 0.3 : 0.34),
    gapRow: rgba(0x3b82f6, theme.light ? 0.08 : 0.1),
    gapText: pick('#7f9cbc', '#4a6a8c'),
    plus: pick('#26b36a', '#15803d'),
    minus: pick('#e05656', '#be123c'),
    badge: {
      added: pick('#86efac', '#15803d'),
      modified: pick('#e2c08d', '#a16207'),
      deleted: pick('#fda4af', '#be123c'),
    } satisfies Record<FileStatus, string>,
    lineNumber: theme.mutedInk(0.5),
    warning: pick('#e2c08d', '#a16207'),
    token: {
      keyword: pick('#ff7b72', '#cf222e'),
      type: pick('#79c0ff', '#0550ae'),
      literal: pick('#79c0ff', '#0550ae'),
      function: pick('#d2a8ff', '#8250df'),
      attribute: pick('#d2a8ff', '#8250df'),
      string: pick('#a5d6ff', '#0a3069'),
      number: pick('#79c0ff', '#0550ae'),
      comment: pick('#8b949e', '#6e7781'),
    } as Partial<Record<TokenKind, string>>,
  };
}
type Palette = ReturnType<typeof palette>;

const STATUS_LETTER: Record<FileStatus, string> = { added: 'A', deleted: 'D', modified: 'M' };

function Counts({ file, colors }: { file: Pick<ChangedFile, 'additions' | 'deletions'>; colors: Palette }) {
  const styles = useStyles();
  return (
    <View style={styles.counts}>
      <Text style={[styles.count, { color: colors.plus }]}>{`+${file.additions}`}</Text>
      <Text style={[styles.count, { color: colors.minus }]}>{`−${file.deletions}`}</Text>
    </View>
  );
}

/** Each line's runs, computed once however many wrapped rows draw it. */
const segmentCache = new WeakMap<HunkLine, LineSegment[]>();

function segmentsOf(line: HunkLine): LineSegment[] {
  let segments = segmentCache.get(line);
  if (segments === undefined) {
    segments = lineSegments(line);
    segmentCache.set(line, segments);
  }
  return segments;
}

/** One screen row of a diff line; only its first row shows the line numbers and the marker. */
const DiffLine = memo(function DiffLine({
  line,
  part,
  start,
  end,
  colors,
  onCopy,
}: {
  line: HunkLine;
  part: number;
  start: number;
  end: number;
  colors: Palette;
  onCopy: (text: string) => void;
}) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  const segments = useMemo(() => sliceSegments(segmentsOf(line), start, end), [line, start, end]);
  const added = line.kind === 'added';
  const removed = line.kind === 'removed';
  const first = part === 0;
  const word = added ? colors.addedWord : removed ? colors.removedWord : undefined;
  return (
    <Pressable
      onLongPress={() => onCopy(line.text)}
      delayLongPress={350}
      style={[
        styles.line,
        added && { backgroundColor: colors.addedRow },
        removed && { backgroundColor: colors.removedRow },
      ]}
    >
      <View
        style={[
          styles.gutter,
          added && { backgroundColor: colors.addedGutter },
          removed && { backgroundColor: colors.removedGutter },
        ]}
      >
        <Text style={[styles.number, { color: colors.lineNumber }]}>{first ? (line.old ?? '') : ''}</Text>
        <Text style={[styles.number, { color: colors.lineNumber }]}>{first ? (line.new ?? '') : ''}</Text>
      </View>
      <Text style={[styles.sign, { color: added ? colors.plus : removed ? colors.minus : colors.lineNumber }]}>
        {first && added ? '+' : first && removed ? '−' : ' '}
      </Text>
      <Text numberOfLines={1} style={[styles.code, { color: theme.prose }]}>
        {segments.length === 0
          ? ' '
          : segments.map((segment, index) => (
              <Text
                key={index}
                style={[
                  colors.token[segment.kind] !== undefined && { color: colors.token[segment.kind] },
                  segment.kind === 'comment' && styles.italic,
                  segment.changed && word !== undefined && { backgroundColor: word },
                ]}
              >
                {segment.text}
              </Text>
            ))}
      </Text>
    </Pressable>
  );
});

const SCOPES: ChangesScope[] = ['main', 'uncommitted'];
const scopeLabel = (scope: ChangesScope) => (scope === 'main' ? ChangesCopy.scopeMain : ChangesCopy.scopeUncommitted);

/** The scope's dropdown button at the right of the toolbar (the desktop's scope button). */
function ScopeButton({ scope, open, onPress }: { scope: ChangesScope; open: boolean; onPress: () => void }) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${ChangesCopy.scopeMenu}: ${scopeLabel(scope)}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.scopeButton, (open || pressed) && { backgroundColor: theme.selectedFill }]}
    >
      {scope === 'main' ? (
        <GitBranchGlyph size={15} color={theme.muted} />
      ) : (
        <PencilGlyph size={15} color={theme.muted} />
      )}
      <Text style={styles.scopeButtonText}>{scopeLabel(scope)}</Text>
      <Glyph name="chevron-down" size={13} color={theme.muted} />
    </Pressable>
  );
}

/** The scope button's menu: both scopes with a line on what each shows, the current one ticked. */
function ScopeMenu({
  scope,
  base,
  top,
  onPick,
  onClose,
}: {
  scope: ChangesScope;
  base: string;
  top: number;
  onPick: (scope: ChangesScope) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  return (
    <>
      <Pressable accessibilityLabel={ChangesCopy.scopeMenu} onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={[styles.scopeMenu, { top }]} accessibilityRole="menu">
        {SCOPES.map((value) => {
          const selected = value === scope;
          return (
            <Pressable
              key={value}
              accessibilityRole="menuitem"
              accessibilityState={{ selected }}
              onPress={() => onPick(value)}
              style={({ pressed }) => [
                styles.scopeItem,
                (selected || pressed) && { backgroundColor: pressed ? theme.controlPressed : theme.selectedFill },
              ]}
            >
              <View style={styles.scopeCheck}>
                {selected ? (
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M5 12l5 5l10 -10"
                      stroke={theme.accent}
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                ) : null}
              </View>
              <View style={styles.scopeItemText}>
                <Text style={styles.scopeItemTitle}>{scopeLabel(value)}</Text>
                <Text style={styles.scopeItemDetail}>
                  {value === 'main' ? ChangesCopy.scopeMainDetail(base) : ChangesCopy.scopeUncommittedDetail}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

export default function ChangesScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  // The list reaches under the iPhone Duo's side bar, its rows keep clear of it.
  const listEdges = useScrollToBarEdges();
  const theme = useTranscriptTheme();
  const styles = useStyles();
  const colors = useMemo(() => palette(theme), [theme]);
  const { machineId, projectId, projectName } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((candidate) => candidate.id === machineId));
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const [scope, setScope] = useState<ChangesScope>('main');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [toolbarBottom, setToolbarBottom] = useState(50);
  const cacheKey = `${machineId}\u0000${projectId}\u0000${scope}`;
  const [answer, setAnswer] = useState<ChangesAnswer | null>(() => answerCache.get(cacheKey) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const listRef = useRef<FlatList<ChangesRow>>(null);
  const [listWidth, setListWidth] = useState(0);
  /** The code font's advance, measured once from a run of zeros (Menlo and Android's monospace). */
  const [charWidth, setCharWidth] = useState(CODE_SIZE * 0.6);

  const refresh = useCallback(() => {
    const target = machineRef.current;
    if (target === undefined) {
      setError(ChangesCopy.machineMissing);
      return;
    }
    generation.current += 1;
    const current = generation.current;
    setLoading(true);
    setError(null);
    readChanges(target, projectId, scope)
      .then((next) => {
        if (current !== generation.current) return;
        answerCache.set(cacheKey, next);
        setAnswer(next);
      })
      .catch((failure: unknown) => {
        if (current !== generation.current) return;
        setError(
          failure instanceof ChangesUnsupportedError
            ? ChangesCopy.oldCli
            : failure instanceof Error
              ? failure.message
              : String(failure),
        );
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
  }, [cacheKey, projectId, scope]);

  useEffect(() => {
    refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const changeScope = useCallback(
    (next: ChangesScope) => {
      if (next === scope) return;
      setAnswer(answerCache.get(`${machineId}\u0000${projectId}\u0000${next}`) ?? null);
      setError(null);
      setScope(next);
    },
    [machineId, projectId, scope],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: projectName.length > 0 ? `${ChangesCopy.title} · ${projectName}` : ChangesCopy.title,
      headerStyle: { backgroundColor: theme.background },
      headerTintColor: theme.foreground,
      contentStyle: { backgroundColor: theme.background },
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ChangesCopy.reload}
          hitSlop={6}
          onPress={refresh}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <RefreshIcon size={18} color={theme.foreground} />
        </Pressable>
      ),
    });
  }, [navigation, projectName, refresh, styles, theme]);
  // On the iPhone Duo, Reload stands in the side bar under Back; nothing here takes the keyboard.
  useStackScreenRail(
    useMemo(
      () => ({
        entries: [
          {
            key: 'reload',
            label: ChangesCopy.reload,
            icon: (size: number) => <RefreshIcon size={size} color={theme.foreground} />,
            onPress: refresh,
          },
        ],
        reserveKeyboard: false,
      }),
      [refresh, theme.foreground],
    ),
  );

  const data: ChangesData | null = answer?.kind === 'repo' ? answer.data : null;
  const columns = listWidth > 0 ? Math.floor((listWidth - CODE_INSET) / charWidth) : 0;
  const rows = useMemo(
    () => (data === null || columns === 0 ? [] : buildRows(data, listOpen, folded, columns)),
    [columns, data, listOpen, folded],
  );
  const offsets = useMemo(() => rowOffsets(rows), [rows]);
  const getItemLayout = useCallback(
    (_: ArrayLike<ChangesRow> | null | undefined, index: number) => ({
      length: rows[index] === undefined ? 0 : ROW_HEIGHTS[rows[index].kind],
      offset: offsets[index] ?? 0,
      index,
    }),
    [offsets, rows],
  );
  const stickyIndices = useMemo(() => rows.flatMap((row, index) => (row.kind === 'file' ? [index] : [])), [rows]);

  /** Folding a file whose lines were on screen brings its header back to the top, where it was pinned. */
  const toggleFold = useCallback(
    (path: string) => {
      const folding = !folded.has(path);
      setFolded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      if (folding) setPendingJump(path);
    },
    [folded],
  );

  /** Opens a folded file first, then scrolls to it once the rows have been rebuilt. */
  const jumpToFile = useCallback((path: string) => {
    setFolded((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
    setPendingJump(path);
  }, []);

  useEffect(() => {
    if (pendingJump === null || data === null) return;
    setPendingJump(null);
    const index = rows.findIndex((row) => row.kind === 'file' && data.files[row.fileIndex]?.path === pendingJump);
    if (index >= 0) {
      requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 }));
    }
  }, [data, pendingJump, rows]);

  const copyLine = useCallback((text: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    void Clipboard.setStringAsync(text);
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_NOTICE_MS);
  }, []);

  const renderRow = useCallback(
    ({ item }: { item: ChangesRow }) => {
      if (data === null) return null;
      switch (item.kind) {
        case 'listHeading':
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: item.open }}
              onPress={() => setListOpen((open) => !open)}
              style={({ pressed }) => [styles.listHeading, pressed && { backgroundColor: theme.pressed }]}
            >
              <Glyph name={item.open ? 'chevron-down' : 'chevron-right'} size={13} color={theme.muted} />
              <Text style={styles.listHeadingText}>{ChangesCopy.filesChanged(data.files.length)}</Text>
              <Text numberOfLines={1} style={styles.baseText}>
                {ChangesCopy.against(data.baseLabel)}
              </Text>
              <View style={styles.spacer} />
              <Counts file={data} colors={colors} />
            </Pressable>
          );
        case 'listItem': {
          const file = data.files[item.fileIndex];
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => jumpToFile(file.path)}
              style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: theme.pressed }]}
            >
              <Text style={[styles.badge, { color: colors.badge[file.status] }]}>{STATUS_LETTER[file.status]}</Text>
              <Text numberOfLines={1} style={styles.listName}>
                {fileName(file.path)}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="head" style={styles.listFolder}>
                {folderOf(file.path)}
              </Text>
              <View style={styles.spacer} />
              <Counts file={file} colors={colors} />
            </Pressable>
          );
        }
        case 'file': {
          const file = data.files[item.fileIndex];
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !item.folded }}
              accessibilityHint={item.folded ? ChangesCopy.unfoldFile : ChangesCopy.foldFile}
              onPress={() => toggleFold(file.path)}
              style={({ pressed }) => [
                styles.fileHeader,
                { backgroundColor: pressed ? colors.headerPressed : colors.header, borderColor: colors.hairline },
              ]}
            >
              <Glyph name={item.folded ? 'chevron-right' : 'chevron-down'} size={13} color={theme.muted} />
              <Text style={[styles.badge, { color: colors.badge[file.status] }]}>{STATUS_LETTER[file.status]}</Text>
              <View style={styles.fileTitle}>
                <Text numberOfLines={1} style={styles.fileName}>
                  {fileName(file.path)}
                </Text>
                {folderOf(file.path).length > 0 ? (
                  <Text numberOfLines={1} ellipsizeMode="head" style={styles.fileFolder}>
                    {folderOf(file.path)}
                  </Text>
                ) : null}
              </View>
              <Counts file={file} colors={colors} />
            </Pressable>
          );
        }
        case 'gap':
          return (
            <View style={[styles.gap, { backgroundColor: colors.gapRow }]}>
              <Text numberOfLines={1} style={[styles.gapText, { color: colors.gapText }]}>
                {[item.count > 0 ? ChangesCopy.unchangedLines(item.count) : '', item.context]
                  .filter((part) => part.length > 0)
                  .join('  ·  ') || '⋯'}
              </Text>
            </View>
          );
        case 'line': {
          const line = data.files[item.fileIndex].hunks[item.hunkIndex].lines[item.lineIndex];
          return (
            <DiffLine
              line={line}
              part={item.part}
              start={item.start}
              end={item.end}
              colors={colors}
              onCopy={copyLine}
            />
          );
        }
        case 'note':
          return (
            <Text numberOfLines={1} style={styles.note}>
              {item.text}
            </Text>
          );
      }
    },
    [colors, copyLine, data, jumpToFile, styles, theme, toggleFold],
  );

  const empty = (() => {
    if (error !== null) return null;
    if (answer === null) {
      return loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.muted} />
          <Text style={styles.muted}>{ChangesCopy.loading}</Text>
        </View>
      ) : null;
    }
    if (answer.kind === 'notRepo') {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>{ChangesCopy.notRepo}</Text>
        </View>
      );
    }
    if (answer.data.files.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>
            {scope === 'uncommitted' || answer.data.onDefaultBranch
              ? ChangesCopy.noUncommitted
              : ChangesCopy.noChangesAgainstBase}
          </Text>
        </View>
      );
    }
    return null;
  })();

  return (
    <View style={styles.screen} onLayout={(event) => setListWidth(event.nativeEvent.layout.width)}>
      <Text
        style={[styles.code, styles.measure]}
        onTextLayout={(event) => {
          const measured = event.nativeEvent.lines[0]?.width ?? 0;
          if (measured > 0) setCharWidth(measured / MEASURE_SAMPLE.length);
        }}
      >
        {MEASURE_SAMPLE}
      </Text>
      <View
        style={styles.toolbar}
        onLayout={(event) => setToolbarBottom(event.nativeEvent.layout.y + event.nativeEvent.layout.height)}
      >
        <ScopeButton scope={scope} open={scopeOpen} onPress={() => setScopeOpen((open) => !open)} />
      </View>
      {error !== null ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{ChangesCopy.loadFailed}</Text>
          <Text style={styles.errorBody} selectable>
            {error}
          </Text>
          <Pressable accessibilityRole="button" onPress={refresh} style={styles.retryButton}>
            <Text style={styles.retryText}>{ChangesCopy.retry}</Text>
          </Pressable>
        </View>
      ) : null}
      {data?.truncated === true ? (
        <Text style={[styles.truncated, { color: colors.warning }]}>{ChangesCopy.truncated}</Text>
      ) : null}
      <FlatList
        ref={listRef}
        data={empty === null ? rows : []}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        stickyHeaderIndices={empty === null ? stickyIndices : undefined}
        getItemLayout={getItemLayout}
        style={listEdges.scroll}
        contentContainerStyle={[listEdges.content, { paddingBottom: insets.bottom + 24 }]}
        ListEmptyComponent={empty ?? undefined}
        refreshControl={
          <RefreshControl refreshing={loading && answer !== null} onRefresh={refresh} tintColor={theme.muted} />
        }
        initialNumToRender={40}
        maxToRenderPerBatch={40}
        windowSize={15}
      />
      {scopeOpen ? (
        <ScopeMenu
          scope={scope}
          base={data?.baseLabel ?? 'main'}
          top={toolbarBottom}
          onPick={(next) => {
            setScopeOpen(false);
            changeScope(next);
          }}
          onClose={() => setScopeOpen(false)}
        />
      ) : null}
      {copied ? (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + 24 }]}>
          <Text style={styles.toastText}>{ChangesCopy.lineCopied}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.background },
  headerButton: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  scopeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingLeft: 11,
    paddingRight: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: t.controlBorder,
  },
  scopeButtonText: { color: t.foreground, fontSize: 13.5, fontWeight: '500' },
  scopeMenu: {
    position: 'absolute',
    right: 12,
    width: 290,
    maxWidth: '92%',
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.menuBorder,
    backgroundColor: t.menu,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  scopeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
  },
  scopeCheck: { width: 14, paddingTop: 2 },
  scopeItemText: { flex: 1, minWidth: 0, gap: 2 },
  scopeItemTitle: { color: t.menuForeground, fontSize: 14, fontWeight: '500' },
  scopeItemDetail: { color: t.muted, fontSize: 12.5, lineHeight: 17 },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: ROW_HEIGHTS.listHeading,
    minWidth: 0,
  },
  listHeadingText: { color: t.foreground, fontSize: 14, fontWeight: '600' },
  baseText: { color: t.muted, fontSize: 12.5, flexShrink: 1, minWidth: 0 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 35,
    paddingRight: 14,
    height: ROW_HEIGHTS.listItem,
    minWidth: 0,
  },
  listName: { color: t.foreground, fontSize: FILE_LIST_NAME_SIZE, flexShrink: 0, maxWidth: '50%' },
  listFolder: { color: t.muted, fontSize: FILE_LIST_DETAIL_SIZE, flexShrink: 1, minWidth: 0 },
  badge: { fontFamily: MONO_FONT, fontSize: 12, fontWeight: '700', width: 12, textAlign: 'center' },
  spacer: { flex: 1 },
  counts: { flexDirection: 'row', gap: 5 },
  count: { fontFamily: MONO_FONT, fontSize: FILE_LIST_DETAIL_SIZE },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: ROW_HEIGHTS.file,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileTitle: { flex: 1, minWidth: 0 },
  fileName: { color: t.foreground, fontSize: FILE_LIST_NAME_SIZE, fontWeight: '600' },
  fileFolder: { color: t.muted, fontSize: FILE_LIST_DETAIL_SIZE, marginTop: 1 },
  gap: { paddingHorizontal: 14, height: ROW_HEIGHTS.gap, justifyContent: 'center' },
  gapText: { fontFamily: MONO_FONT, fontSize: CODE_SIZE - 0.5, lineHeight: 18 },
  line: { flexDirection: 'row', alignItems: 'stretch', height: ROW_HEIGHTS.line, paddingRight: LINE_END_PADDING },
  gutter: { flexDirection: 'row' },
  number: {
    fontFamily: MONO_FONT,
    fontSize: CODE_SIZE - 1,
    lineHeight: 19,
    width: NUMBER_WIDTH,
    paddingRight: 5,
    textAlign: 'right',
  },
  sign: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, lineHeight: 19, width: SIGN_WIDTH, textAlign: 'center' },
  code: { flex: 1, fontFamily: MONO_FONT, fontSize: CODE_SIZE, lineHeight: 19, minWidth: 0 },
  measure: { position: 'absolute', top: 0, left: 0, flex: 0, opacity: 0 },
  italic: { fontStyle: 'italic' },
  note: { color: t.muted, fontSize: 13, lineHeight: ROW_HEIGHTS.note, height: ROW_HEIGHTS.note, paddingHorizontal: 16 },
  truncated: { fontSize: 12, lineHeight: 17, paddingHorizontal: 14, paddingBottom: 6 },
  centered: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingTop: 56 },
  emptyTitle: { color: t.foreground, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  muted: { color: t.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  errorCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 14,
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBackground,
  },
  errorTitle: { color: t.foreground, fontSize: 14, fontWeight: '600' },
  errorBody: { color: t.muted, fontSize: 13, lineHeight: 18 },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 8,
    backgroundColor: t.neutralFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: t.foreground, fontSize: 13, fontWeight: '600' },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: t.menu,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.menuBorder,
  },
  toastText: { color: t.menuForeground, fontSize: 13, fontWeight: '500' },
}));
