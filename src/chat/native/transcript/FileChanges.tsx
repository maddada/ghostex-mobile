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
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NestedHorizontalScroll } from '../../../components/common/HorizontalSwipe';

import { useNativeChatUi, useRowDetail, useTranscriptEnv } from './context';
import { DisclosureBody } from './Disclosure';
import { Glyph, type GlyphName } from './icons';
import { arr, num, obj, str, type JsonRecord } from './json';
import { successTone } from './quietWork';
import { highlightLabel, useRowFind } from './searchHighlight';
import { useDisclosure } from './state';
import { MONO_FONT, PROSE_SIZE, type TranscriptTheme } from './theme';
import {
  SINGLE_LINE_CARD,
  SINGLE_LINE_HEADER_HEIGHT,
  SINGLE_LINE_TITLE,
  SingleLineTile,
  TITLE_ROW_GAP,
  singleLinePressed,
  singleLineShell,
} from './singleLineCard';
import { openTranscriptMenu } from './transcriptMenuStore';
import { FoldChevron } from './foldChevron';
import { Shimmer } from './ToolCard';

/** The tool row's horizontal padding, icon tile size, and described label opacity (`ToolRows.tsx`). */
const ROW_PAD_X = 8;
const TILE = 22;
const DESCRIBED_LABEL_OPACITY = 0.8;

/** A `#rrggbb` theme colour at an alpha (`ToolRows.tsx`). */
function dimmed(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/** A failed row's tint: the error tone at 6% (`ToolRows.tsx`). */
function errorWash(error: string): string {
  return `${error}0f`;
}

function fileRows(files: unknown): JsonRecord[] {
  return arr(files)
    .map((file) => obj(file))
    .filter((file): file is JsonRecord => file !== null);
}

function fileCallStatus(file: JsonRecord): string {
  return str(file, 'callStatus') || (file.failed === true ? 'failed' : 'done');
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

/**
 * The "Edited N files" fold row styled like the tool and thought rows around it (desktop
 * `files_fold_row` in `file_change_card.rs`, CDXC:SessionChat 2026-11-24): 22pt neutral pencil
 * tile, 8pt inset, prose size at 80% opacity, +/- counts and right-side check or error mark,
 * expanding on a rail into per-file rows in the same style. `boxed` draws it as an opened Quiet
 * View line's one-line card instead.
 *
 * CDXC:SessionChat 2026-11-25 DECISION: User, of an opened Working line where the thoughts and a
 * background command were one-line cards and the "Edited 1 file" rows between them were bare tool
 * rows: "file editing looks different from the others pls fix". Inside an opened Quiet View line
 * the fold is the same one-line card as the "N tool calls" and thought cards there: its shell,
 * height, inset and title type, the pencil in the card's tile, the +N −N counts and the check
 * where those cards keep their pill; opened, its files sit under the card's hairline with no rail.
 * SEE-ALSO: the desktop's `files_fold_row` in native_chat/file_change_card.rs.
 */
export function FilesFold({
  foldKey,
  stackId,
  files,
  card,
  label,
  open,
  onToggle,
  unread = false,
  notice,
  boxed = false,
}: {
  foldKey: string;
  stackId: string;
  files: unknown;
  card: unknown;
  label: string;
  open: boolean;
  onToggle(): void;
  unread?: boolean;
  notice?: ReactNode;
  boxed?: boolean;
}) {
  const { theme, working } = useTranscriptEnv();
  const find = useRowFind();
  const rows = fileRows(files);
  const colors = palette(theme);
  const summary = obj(card) ?? {};
  const added = num(summary, 'added') ?? 0;
  const removed = num(summary, 'removed') ?? 0;
  const anyRunning = rows.some((file) => fileCallStatus(file) === 'running');
  const anyFailed = rows.some((file) => fileCallStatus(file) === 'failed');
  const allFailed = rows.length > 0 && rows.every((file) => fileCallStatus(file) === 'failed');
  const shimmer = anyRunning && working === true;
  const ends = (
    <>
      {added + removed > 0 ? <Counts added={added} removed={removed} /> : null}
      {!anyRunning ? (
        <Glyph name={anyFailed ? 'x' : 'check'} size={13} color={anyFailed ? theme.error : successTone(theme.light)} />
      ) : null}
    </>
  );
  if (boxed) {
    return (
      <View style={singleLineShell(theme)}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [
            styles.cardHeader,
            allFailed && { backgroundColor: errorWash(theme.error) },
            pressed && singleLinePressed(theme),
          ]}
        >
          <SingleLineTile glyph="pencil" />
          {shimmer ? (
            <View style={[styles.shimmerBox, styles.fill]}>
              <Text numberOfLines={1} style={[SINGLE_LINE_TITLE, { color: theme.foreground }]}>
                {highlightLabel(label, find, foldKey)}
              </Text>
              <Shimmer color={theme.light ? '#000000' : '#ffffff'} />
            </View>
          ) : (
            <Text
              numberOfLines={1}
              style={[SINGLE_LINE_TITLE, styles.cardTitle, { color: allFailed ? theme.error : theme.foreground }]}
            >
              {highlightLabel(label, find, foldKey)}
            </Text>
          )}
          {ends}
        </Pressable>
        {open ? (
          unread ? (
            (notice ?? null)
          ) : (
            <View style={[styles.cardBody, { borderTopColor: theme.ink(SINGLE_LINE_CARD.borderAlpha) }]}>
              {rows.map((file, index) => (
                <FileFoldEntryRow key={index} stackId={stackId} index={index} file={file} colors={colors} />
              ))}
            </View>
          )
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.fold}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.foldTrigger,
          allFailed && { backgroundColor: errorWash(theme.error) },
          pressed && { backgroundColor: theme.pressed },
        ]}
      >
        <View style={[styles.foldTile, { backgroundColor: theme.ink(0.05) }]}>
          <Glyph name="pencil" size={13} color={theme.muted} />
        </View>
        {shimmer ? (
          <View style={[styles.shimmerBox, styles.fill]}>
            <Text
              numberOfLines={1}
              style={[styles.foldLabel, { color: dimmed(theme.prose, DESCRIBED_LABEL_OPACITY) }]}
            >
              {highlightLabel(label, find, foldKey)}
            </Text>
            <Shimmer color={theme.light ? '#000000' : '#ffffff'} />
          </View>
        ) : (
          <Text
            numberOfLines={1}
            style={[
              styles.foldLabel,
              { color: allFailed ? theme.error : dimmed(theme.prose, DESCRIBED_LABEL_OPACITY) },
            ]}
          >
            {highlightLabel(label, find, foldKey)}
          </Text>
        )}
        {ends}
      </Pressable>
      {open ? (
        unread ? (
          (notice ?? null)
        ) : (
          <View style={styles.foldInset}>
            <DisclosureBody onCollapse={onToggle} label="Collapse edited files" gap={2}>
              {rows.map((file, index) => (
                <FileFoldEntryRow key={index} stackId={stackId} index={index} file={file} colors={colors} />
              ))}
            </DisclosureBody>
          </View>
        )
      ) : null}
    </View>
  );
}

/** A finished turn's writes, folded behind "N files changed" / "Edited N files", drawn inside the opened turn. */
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
  const foldKey = `work-files:${itemId}`;
  const [open, toggleRaw] = useDisclosure(disclosures, foldKey);
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
    <FilesFold
      foldKey={foldKey}
      stackId={`work:${itemId}`}
      files={files}
      card={card}
      label={label}
      open={open}
      onToggle={toggle}
      unread={unread}
      notice={notice}
    />
  );
}

/** One file row inside an expanded "Edited N files" fold, matching `ToolRow` and opening onto its diff on a rail. */
const FileFoldEntryRow = memo(function FileFoldEntryRow({
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
  const { theme, filePreviews, working } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const key = `file:${stackId}:${num(file, 'disclosureIndex') ?? index}`;
  const [open, toggle] = useDisclosure(disclosures, key, filePreviews || file.awaitingApproval === true);
  const status = str(file, 'status') || 'edited';
  const glyphColor = status === 'new' ? colors.new : status === 'deleted' ? colors.deleted : theme.muted;
  const callStatus = fileCallStatus(file);
  const failed = callStatus === 'failed';
  const shimmer = callStatus === 'running' && working === true;
  const added = num(file, 'added') ?? 0;
  const removed = num(file, 'removed') ?? 0;
  const filename = str(file, 'filename');
  const parent = str(file, 'parent');
  const path = str(file, 'path');
  return (
    <View style={styles.foldEntry}>
      <Pressable
        onPress={toggle}
        {...(path.length > 0 ? { onLongPress: () => openTranscriptMenu({ href: path }) } : {})}
        accessibilityRole="button"
        accessibilityLabel={parent.length > 0 ? `${parent}${filename}` : filename}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.foldTrigger,
          failed && { backgroundColor: errorWash(theme.error) },
          pressed && { backgroundColor: theme.pressed },
        ]}
      >
        <View style={[styles.foldTile, { backgroundColor: theme.ink(0.05) }]}>
          <Glyph name={statusGlyph(status)} size={13} color={glyphColor} />
        </View>
        {shimmer ? (
          <View style={styles.shimmerBox}>
            <Text
              numberOfLines={1}
              style={[styles.foldFileName, { color: dimmed(theme.prose, DESCRIBED_LABEL_OPACITY) }]}
            >
              {filename}
            </Text>
            <Shimmer color={theme.light ? '#000000' : '#ffffff'} />
          </View>
        ) : (
          <Text
            numberOfLines={1}
            style={[
              styles.foldFileName,
              { color: failed ? theme.error : dimmed(theme.prose, DESCRIBED_LABEL_OPACITY) },
            ]}
          >
            {filename}
          </Text>
        )}
        {parent.length > 0 ? (
          <Text numberOfLines={1} ellipsizeMode="head" style={[styles.parent, { color: theme.muted }]}>
            {parent}
          </Text>
        ) : null}
        {failed ? <Text style={[styles.failed, { color: theme.error }]}>Failed</Text> : null}
        <View style={styles.spacer} />
        {added + removed > 0 ? <Counts added={added} removed={removed} /> : null}
        {callStatus === 'done' ? <Glyph name="check" size={13} color={successTone(theme.light)} /> : null}
        {callStatus === 'failed' ? <Glyph name="x" size={13} color={theme.error} /> : null}
      </Pressable>
      {open ? (
        <View style={styles.foldInset}>
          <DisclosureBody onCollapse={toggle} label={`Collapse ${filename}`} rail="tool" gap={4}>
            <View style={[styles.framedDiff, { borderColor: colors.border }]}>
              <FileChangeDiff rowKey={key} file={file} colors={colors} borderTop={false} />
            </View>
          </DisclosureBody>
        </View>
      ) : null}
    </View>
  );
});

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
  // Agent work Quiet draws only the edit waiting on an approval, which keeps the key of its place in
  // the message (gx-chat-core `grouped_work::only_what_waits`).
  const key = `file:${stackId}:${num(file, 'disclosureIndex') ?? index}`;
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
        <FoldChevron open={open} size={13} color={theme.muted} />
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
export function FileChangeDiff({
  rowKey,
  file,
  colors,
  borderTop = true,
}: {
  rowKey: string;
  file: JsonRecord;
  colors: Palette;
  borderTop?: boolean;
}) {
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
    <View style={[styles.well, { backgroundColor: colors.well }, borderTop && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }]}>
      {shown.length === 0 ? (
        <Text style={[styles.code, styles.pad, { color: theme.muted }]}>
          {status === 'deleted' ? 'File removed' : 'Empty file'}
        </Text>
      ) : (
        <NestedHorizontalScroll showsHorizontalScrollIndicator={false} nestedScrollEnabled>
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
        </NestedHorizontalScroll>
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
            <FoldChevron open={showAll} size={13} color={theme.muted} half />
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
  fold: { gap: 4, minWidth: 0 },
  foldEntry: { gap: 4, minWidth: 0 },
  foldTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: ROW_PAD_X,
    paddingVertical: 5,
    borderRadius: 8,
    minWidth: 0,
  },
  foldTile: {
    width: TILE,
    height: TILE,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  foldLabel: { flex: 1, minWidth: 0, fontSize: PROSE_SIZE, lineHeight: 20, fontWeight: '400' },
  foldFileName: { fontSize: PROSE_SIZE, lineHeight: 20, fontWeight: '400', flexShrink: 0, maxWidth: '50%' },
  fill: { flex: 1 },
  shimmerBox: { flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  foldInset: { paddingLeft: ROW_PAD_X + TILE / 2 - 10 },
  // The boxed fold: the "N tool calls" card's header and body (`ToolRows.tsx`).
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TITLE_ROW_GAP,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
    height: SINGLE_LINE_HEADER_HEIGHT,
    minWidth: 0,
  },
  cardTitle: { flex: 1, minWidth: 0 },
  cardBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: 4, gap: 2, minWidth: 0 },
  framedDiff: { borderRadius: 8, borderWidth: 1, overflow: 'hidden', minWidth: 0 },
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
  well: { paddingTop: 6, paddingBottom: 8 },
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
