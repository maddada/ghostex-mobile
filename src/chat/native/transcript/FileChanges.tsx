/**
 * The file change card (desktop `file_change_card.rs`): a header that sums up the edit (pencil
 * tile, "Edited N files", the folder the files share, total +/-, a ratio bar), then a row per file
 * (chevron, file icon, name, folder, counts, five-block change bar) that
 * opens to its diff with old and new line numbers, "Show all N changed lines" and Open file.
 * Everything the card says comes from the core (`file_change_rows.rs`; the user's pick is the
 * `CDXC:SessionChat 2026-10-11 DECISION` on `file_change_card` there). The desktop header's Review
 * all opens the Code view, which the phone does not have, so the phone leaves it out.
 */

import { memo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useNativeChatUi, useRowDetail, useTranscriptEnv } from './context';
import { DisclosureHeading } from './Disclosure';
import { Glyph, type GlyphName } from './icons';
import { arr, num, obj, str, type JsonRecord } from './json';
import { useDisclosure } from './state';
import { MONO_FONT, type TranscriptTheme } from './theme';
import { SingleLineTile } from './singleLineCard';
import { openTranscriptMenu } from './transcriptMenuStore';

function fileRows(files: unknown): JsonRecord[] {
  return arr(files)
    .map((file) => obj(file))
    .filter((file): file is JsonRecord => file !== null);
}

/** The card's hues, the desktop palette's (`file_change_card.rs`). */
export function palette(theme: TranscriptTheme) {
  const pick = (dark: string, light: string) => (theme.light ? light : dark);
  return {
    border: theme.light ? theme.border : 'rgba(255,255,255,0.075)',
    hairline: theme.ink(theme.light ? 0.08 : 0.045),
    well: theme.light ? theme.ink(0.03) : theme.background,
    edited: pick('#60a5fa', '#2563eb'),
    new: pick('#34d399', '#059669'),
    deleted: pick('#fb7185', '#e11d48'),
    addedRow: 'rgba(63,179,127,0.11)',
    removedRow: 'rgba(224,108,117,0.11)',
    addedText: pick('#b9e3c9', '#14532d'),
    removedText: pick('#f1c1c5', '#7f1d1d'),
    barAdd: pick('#3fb37f', '#16a34a'),
    barDel: pick('#e06c75', '#dc2626'),
    barNone: theme.light ? theme.border : '#2e2e2e',
    hunk: pick('#7f8ea3', '#52617a'),
    hunkRow: 'rgba(96,165,250,0.07)',
    lineNumber: theme.mutedInk(0.5),
  };
}
export type Palette = ReturnType<typeof palette>;

function statusHue(colors: Palette, status: string): string {
  return status === 'new' ? colors.new : status === 'deleted' ? colors.deleted : colors.edited;
}

function statusGlyph(status: string): GlyphName {
  return status === 'new' ? 'file-plus' : status === 'deleted' ? 'file-minus' : 'file-text';
}

export function Counts({ added, removed }: { added: number; removed: number }) {
  const { theme } = useTranscriptEnv();
  return (
    <View style={styles.counts}>
      <Text style={[styles.count, { color: theme.diff.added }]}>{`+${added}`}</Text>
      <Text style={[styles.count, { color: theme.diff.removed }]}>{`−${removed}`}</Text>
    </View>
  );
}

/** One card; `stackId` is the message id, or `work:<turn id>` for a turn's fold. */
export function FileChangeStack({ stackId, files, card }: { stackId: string; files: unknown; card: unknown }) {
  const { theme } = useTranscriptEnv();
  const rows = fileRows(files);
  if (rows.length === 0) return null;
  const colors = palette(theme);
  const summary = obj(card) ?? {};
  const added = num(summary, 'added') ?? 0;
  const removed = num(summary, 'removed') ?? 0;
  const share = Math.min(1, Math.max(0, num(summary, 'addShare') ?? 0));
  const folder = str(summary, 'folder');
  return (
    <View style={[styles.card, { backgroundColor: theme.input, borderColor: colors.border }]}>
      <View style={styles.header}>
        {/* The one-line cards' neutral tile (desktop `file_change_card.rs`); the counts and the bar are the colour. */}
        <SingleLineTile glyph="pencil" />
        <View style={styles.titleColumn}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.foreground }]}>
            {str(summary, 'title')}
          </Text>
          {folder !== '' ? (
            <Text numberOfLines={1} ellipsizeMode="head" style={[styles.folder, { color: theme.muted }]}>
              {folder}
            </Text>
          ) : null}
        </View>
        <Counts added={added} removed={removed} />
        {added + removed > 0 ? (
          <View style={[styles.ratio, { backgroundColor: colors.barNone }]}>
            <View style={{ flex: share, backgroundColor: colors.barAdd }} />
            <View style={{ flex: 1 - share, backgroundColor: colors.barDel }} />
          </View>
        ) : null}
      </View>
      {rows.map((file, index) => (
        <FileChangeRow key={index} stackId={stackId} index={index} file={file} colors={colors} />
      ))}
    </View>
  );
}

/** Whether an open finished turn shows its "N files changed" fold: files it changed, or the paths its unread work changed (gx-chat-core `turn_files_fold`). */
export function hasCompletedFiles(files: unknown, deferred?: unknown): boolean {
  return fileRows(files).length > 0 || arr(obj(deferred)?.filePaths).length > 0;
}

/** A finished turn's writes, folded behind "N files changed", drawn under the turn's card while it is open. */
export function CompletedFilesFold({
  itemId,
  files,
  card,
  label,
  deferred,
  notice,
}: {
  itemId: string;
  files: unknown;
  /** The card's header (`filesCard`). */
  card: unknown;
  label: string;
  /** The turn's `deferred` descriptor, when its work has not been read yet. */
  deferred?: unknown;
  /** What the fold shows while that work is being read, or after the read failed. */
  notice?: ReactNode;
}) {
  const { dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [open, toggleRaw] = useDisclosure(disclosures, `work-files:${itemId}`);
  const work = obj(deferred);
  // An older turn arrives collapsed with only the paths its unread work changed: the row stays and
  // reads that work on open (desktop `file_change_card.rs`, React `list.tsx`).
  const unread = fileRows(files).length === 0 && arr(work?.filePaths).length > 0;
  if (!hasCompletedFiles(files, deferred)) return null;
  const toggle = () => {
    if (!open && unread) dispatch({ type: 'loadWork', id: itemId, work: work as never });
    toggleRaw();
  };
  return (
    <View style={styles.fold}>
      <DisclosureHeading label={label} open={open} onToggle={toggle} />
      {open ? (
        unread ? (
          (notice ?? null)
        ) : (
          <FileChangeStack stackId={`work:${itemId}`} files={files} card={card} />
        )
      ) : null}
    </View>
  );
}

const FileChangeRow = memo(function FileChangeRow({
  stackId,
  index,
  file,
  colors,
}: {
  stackId: string;
  index: number;
  file: JsonRecord;
  colors: Palette;
}) {
  const { theme, filePreviews } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const key = `file:${stackId}:${index}`;
  // Settings > Chat > Show file edit previews opens every row to its preview, and a write waiting on
  // an approval opens its own row so the diff shows beside the card (gx-chat-core `approval_wait.rs`).
  const [open, toggle] = useDisclosure(disclosures, key, filePreviews || file.awaitingApproval === true);
  const status = str(file, 'status') || 'edited';
  const hue = statusHue(colors, status);
  const failed = file.failed === true;
  // Holding a file's row opens the file menu a held file link opens (Copy Path; CDXC:SessionChat 2026-10-17 in desktop `native_chat/file_actions.rs`).
  const path = str(file, 'path');
  return (
    <View>
      <Pressable
        onPress={toggle}
        {...(path.length > 0 ? { onLongPress: () => openTranscriptMenu({ href: path }) } : {})}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.row,
          { borderTopColor: colors.hairline },
          pressed && { backgroundColor: theme.pressed },
        ]}
      >
        <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={13} color={theme.muted} />
        <Glyph name={statusGlyph(status)} size={15} color={hue} />
        <Text numberOfLines={1} style={[styles.fileName, { color: theme.foreground }]}>
          {str(file, 'filename')}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="head" style={[styles.parent, { color: theme.muted }]}>
          {str(file, 'parent')}
        </Text>
        {failed ? <Text style={[styles.failed, { color: theme.error }]}>Failed</Text> : null}
        <View style={styles.spacer} />
        <Counts added={num(file, 'added') ?? 0} removed={num(file, 'removed') ?? 0} />
        <View style={styles.bars}>
          {arr(file.bars).map((bar, block) => (
            <View
              key={block}
              style={[
                styles.bar,
                { backgroundColor: bar === 'add' ? colors.barAdd : bar === 'del' ? colors.barDel : colors.barNone },
              ]}
            />
          ))}
        </View>
      </Pressable>
      {open ? <FileChangeDiff rowKey={key} file={file} colors={colors} /> : null}
    </View>
  );
});

/** An open row's diff on its darker well, with the buttons under it. */
export function FileChangeDiff({ rowKey, file, colors }: { rowKey: string; file: JsonRecord; colors: Palette }) {
  const { theme, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [showAll, toggleAll] = useDisclosure(disclosures, `file-all:${rowKey}`);
  const detail = obj(useRowDetail(rowKey, 'file', str(file, 'messageId'), num(file, 'index') ?? 0, true));
  if (detail === null) return null;
  const hasMore = file.hasMore === true;
  const failed = file.failed === true;
  const lines = arr(detail.lines)
    .map((line) => obj(line))
    .filter((line): line is JsonRecord => line !== null);
  const preview = num(detail, 'preview') ?? lines.length;
  const shown = showAll || !hasMore ? lines : lines.slice(0, preview);
  const numbered = lines.some((line) => typeof line.old === 'number' || typeof line.new === 'number');
  const status = str(file, 'status');
  return (
    <View style={[styles.well, { backgroundColor: colors.well, borderTopColor: colors.hairline }]}>
      {shown.length === 0 ? (
        <Text style={[styles.code, styles.pad, { color: theme.muted }]}>
          {status === 'deleted' ? 'File removed' : 'Empty file'}
        </Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
          <View style={styles.lines}>
            {shown.map((line, lineIndex) => {
              const kind = str(line, 'kind');
              const text = str(line, 'text');
              if (kind === 'meta') {
                const hunk = text.startsWith('@@');
                return (
                  <Text
                    key={lineIndex}
                    style={[
                      styles.hunk,
                      { color: hunk ? colors.hunk : theme.muted },
                      hunk && { backgroundColor: colors.hunkRow },
                    ]}
                  >
                    {text}
                  </Text>
                );
              }
              const color = kind === 'add' ? colors.addedText : kind === 'del' ? colors.removedText : theme.prose;
              const signColor = kind === 'add' ? colors.barAdd : kind === 'del' ? colors.barDel : theme.muted;
              const background = kind === 'add' ? colors.addedRow : kind === 'del' ? colors.removedRow : undefined;
              return (
                <View
                  key={lineIndex}
                  style={[
                    styles.line,
                    !numbered && styles.unnumbered,
                    background !== undefined && { backgroundColor: background },
                  ]}
                >
                  {numbered ? (
                    <>
                      <Text style={[styles.code, styles.number, { color: colors.lineNumber }]}>
                        {typeof line.old === 'number' ? String(line.old) : ''}
                      </Text>
                      <Text style={[styles.code, styles.number, { color: colors.lineNumber }]}>
                        {typeof line.new === 'number' ? String(line.new) : ''}
                      </Text>
                    </>
                  ) : null}
                  <Text style={[styles.code, styles.sign, { color: signColor }]}>
                    {kind === 'add' ? '+' : kind === 'del' ? '−' : ' '}
                  </Text>
                  <Text style={[styles.code, { color }]}>{text}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
      {failed && (showAll || !hasMore) ? (
        <Text style={[styles.error, { color: theme.error }]}>{str(file, 'error')}</Text>
      ) : null}
      <View style={styles.footer}>
        {hasMore ? (
          <Pressable
            onPress={toggleAll}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.ghost,
              { backgroundColor: pressed ? theme.neutralFillPressed : theme.neutralFill },
            ]}
          >
            <Glyph name={showAll ? 'chevron-up' : 'chevron-down'} size={13} color={theme.muted} />
            <Text style={[styles.ghostText, { color: theme.muted }]}>
              {showAll ? 'Show fewer lines' : str(file, 'showAllLabel')}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.spacer} />
        {status !== 'deleted' ? (
          <Pressable
            onPress={() => dispatch({ type: 'openMarkdownLink', href: str(file, 'path'), external: false })}
            accessibilityRole="link"
            accessibilityLabel={`Open ${str(file, 'filename')}`}
            style={({ pressed }) => [
              styles.ghost,
              { backgroundColor: pressed ? theme.neutralFillPressed : theme.neutralFill },
            ]}
          >
            <Glyph name="external-link" size={13} color={theme.muted} />
            <Text style={[styles.ghostText, { color: theme.muted }]}>Open file</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fold: { gap: 8, minWidth: 0 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', minWidth: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 0,
  },
  titleColumn: { flex: 1, minWidth: 0 },
  title: { fontSize: 13.5, lineHeight: 18, fontWeight: '600' },
  folder: { fontSize: 12, lineHeight: 16 },
  counts: { flexDirection: 'row', gap: 4 },
  count: { fontFamily: MONO_FONT, fontSize: 12 },
  ratio: { flexDirection: 'row', width: 56, height: 5, borderRadius: 3, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    minWidth: 0,
  },
  fileName: { fontSize: 13.5, fontWeight: '500', flexShrink: 0, maxWidth: '45%' },
  parent: { fontSize: 12.5, flexShrink: 1, minWidth: 0 },
  failed: { fontSize: 12 },
  spacer: { flex: 1 },
  bars: { flexDirection: 'row', gap: 2 },
  bar: { width: 6, height: 6, borderRadius: 1.5 },
  well: { paddingTop: 6, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth },
  lines: { minWidth: '100%' },
  line: { flexDirection: 'row', paddingRight: 14 },
  unnumbered: { paddingLeft: 14 },
  code: { fontFamily: MONO_FONT, fontSize: 12.4, lineHeight: 20 },
  pad: { paddingHorizontal: 14 },
  number: { width: 38, paddingRight: 8, textAlign: 'right' },
  sign: { width: 16 },
  hunk: { fontFamily: MONO_FONT, fontSize: 11.5, lineHeight: 18, paddingHorizontal: 14, paddingVertical: 2 },
  error: { fontSize: 14, paddingHorizontal: 14, paddingTop: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8 },
  // The footer's text buttons take the chat's neutral fill (CDXC:AppModal 2026-10-14 on the desktop's `neutral_button_fills`).
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 11, borderRadius: 8 },
  ghostText: { fontSize: 13, fontWeight: '500' },
});
