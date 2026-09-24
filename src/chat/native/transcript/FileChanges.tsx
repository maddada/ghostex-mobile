/**
 * File-change cards (desktop `file_change_card.rs`, React `session-chat-file-change-card.tsx`): the
 * circle marker, the start-truncated path that opens the file, the +/- counts that toggle the diff,
 * the diff itself (shipped by the core only while the card is open or previewing), and a finished
 * turn's "N files changed" fold.
 */

import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useNativeChatUi, useRowDetail, useTranscriptEnv } from './context';
import { DisclosureHeading } from './Disclosure';
import { arr, obj, str, type JsonRecord } from './json';
import { useDisclosure } from './state';
import { CODE_SIZE, MONO_FONT, PROSE_SIZE } from './theme';

const STACK_RADIUS = 10;
const STACK_PAD_X = 10;
const STACK_PAD_Y = 8;
const STACK_GAP = 12;
/** A collapsed preview shows this many lines (`file_change_card.rs`). */
const PREVIEW_LINES = 7;

function fileRows(files: unknown): JsonRecord[] {
  return arr(files)
    .map((file) => obj(file))
    .filter((file): file is JsonRecord => file !== null);
}

/** The cards of one stack; `stackId` is the message id, or `work:<turn id>` for a turn's fold. */
export function FileChangeStack({ stackId, files }: { stackId: string; files: unknown }) {
  const { theme } = useTranscriptEnv();
  const rows = fileRows(files);
  if (rows.length === 0) return null;
  return (
    <View style={[styles.stack, { backgroundColor: theme.input }]}>
      {rows.map((file, index) => (
        <FileChangeCard key={index} stackId={stackId} index={index} first={index === 0} last={index === rows.length - 1} file={file} />
      ))}
    </View>
  );
}

/** A finished turn's writes, folded behind "N files changed". */
export function CompletedFilesFold({ itemId, files, label }: { itemId: string; files: unknown; label: string }) {
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `work-files:${itemId}`);
  if (fileRows(files).length === 0) return null;
  return (
    <View style={styles.fold}>
      <DisclosureHeading label={label} open={open} onToggle={toggle} />
      {open ? <FileChangeStack stackId={`work:${itemId}`} files={files} /> : null}
    </View>
  );
}

const FileChangeCard = memo(function FileChangeCard({
  stackId,
  index,
  first,
  last,
  file,
}: {
  stackId: string;
  index: number;
  first: boolean;
  last: boolean;
  file: JsonRecord;
}) {
  const { theme, dispatch, filePreviews } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const key = `file:${stackId}:${index}`;
  const [open, toggle] = useDisclosure(disclosures, key);
  const canExpand = !filePreviews || file.expandableWithPreviews === true;
  const expanded = open && canExpand;
  const showBody = expanded || filePreviews;
  const detail = obj(useRowDetail(key, 'file', str(file, 'messageId'), typeof file.index === 'number' ? file.index : 0, showBody));
  const failed = file.failed === true;
  const added = typeof file.added === 'number' ? file.added : 0;
  const removed = typeof file.removed === 'number' ? file.removed : 0;
  const parent = str(file, 'parent');
  const path = str(file, 'path');
  const allLines = arr(detail?.lines)
    .map((line) => obj(line))
    .filter((line): line is JsonRecord => line !== null);
  const lines = expanded ? allLines : allLines.filter((line) => line.kind !== 'meta').slice(0, PREVIEW_LINES);
  return (
    <Pressable
      disabled={!canExpand}
      onPress={toggle}
      accessibilityRole='button'
      accessibilityState={{ expanded }}
      style={({ pressed }) => [
        styles.card,
        {
          paddingTop: first ? STACK_PAD_Y : STACK_GAP / 2,
          paddingBottom: last ? STACK_PAD_Y : STACK_GAP / 2,
        },
        first && styles.cardFirst,
        last && styles.cardLast,
        pressed && canExpand && { backgroundColor: theme.pressed },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.marker, { borderColor: theme.light ? theme.border : 'rgba(158,158,158,0.65)' }]}>
          <View style={[styles.markerDot, { backgroundColor: theme.diff.rail }]} />
        </View>
        <Pressable
          style={styles.path}
          onPress={() => dispatch({ type: 'openMarkdownLink', href: path, external: false })}
          accessibilityRole='link'
          accessibilityLabel={`Open ${str(file, 'filename')}`}
        >
          <Text numberOfLines={1} ellipsizeMode='head' style={[styles.pathText, { color: theme.muted }]}>
            {parent}
            <Text style={[styles.fileName, { color: theme.prose }]}>{str(file, 'filename')}</Text>
          </Text>
        </Pressable>
        {failed ? <Text style={[styles.small, { color: theme.error }]}>Failed</Text> : null}
        <View style={styles.counts}>
          <Text style={[styles.small, { color: theme.diff.added }]}>{`+${added}`}</Text>
          <Text style={[styles.small, { color: theme.diff.removed }]}>{`−${removed}`}</Text>
        </View>
      </View>
      {showBody && detail !== null ? (
        <View style={styles.body}>
          <View style={styles.railColumn}>{expanded ? <View style={[styles.rail, { backgroundColor: theme.diff.rail }]} /> : null}</View>
          <View style={styles.detailColumn}>
            <View style={[styles.code, { borderColor: theme.diff.border, backgroundColor: theme.input }]}>
              {lines.length === 0 ? (
                <Text style={[styles.lineText, styles.emptyLine, { color: theme.muted }]}>
                  {file.action === 'Delete' ? 'File removed' : 'Empty file'}
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
                  <View>
                    {lines.map((line, lineIndex) => {
                      const kind = str(line, 'kind');
                      const color = kind === 'add' ? theme.diff.added : kind === 'del' ? theme.diff.removed : kind === 'meta' ? theme.muted : theme.prose;
                      const background = kind === 'add' ? theme.diff.addedRow : kind === 'del' ? theme.diff.removedRow : undefined;
                      return (
                        <View key={lineIndex} style={[styles.line, background !== undefined && { backgroundColor: background }]}>
                          <Text style={[styles.sign, { color }]}>{kind === 'add' ? '+' : kind === 'del' ? '-' : ' '}</Text>
                          <Text style={[styles.lineText, { color }]}>{str(line, 'text')}</Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              )}
            </View>
            {expanded && failed ? <Text style={[styles.errorText, { color: theme.error }]}>{str(file, 'error')}</Text> : null}
            {canExpand ? (
              <View style={styles.footer}>
                <Text style={[styles.small, styles.footerButton, { color: theme.muted }]}>
                  {expanded ? 'Collapse changes' : 'Show all changes'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fold: { gap: 8, minWidth: 0 },
  stack: { borderRadius: STACK_RADIUS, minWidth: 0 },
  card: { paddingHorizontal: STACK_PAD_X, minWidth: 0 },
  cardFirst: { borderTopLeftRadius: STACK_RADIUS, borderTopRightRadius: STACK_RADIUS },
  cardLast: { borderBottomLeftRadius: STACK_RADIUS, borderBottomRightRadius: STACK_RADIUS },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32, minWidth: 0 },
  marker: { width: 17, height: 17, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  markerDot: { width: 8, height: 8, borderRadius: 4 },
  path: { flexShrink: 1, minWidth: 0 },
  pathText: { fontSize: PROSE_SIZE },
  fileName: { fontWeight: '500' },
  counts: { flexDirection: 'row', gap: 6, marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4 },
  small: { fontSize: 12.25 },
  body: { flexDirection: 'row', marginTop: 8, gap: 12, minWidth: 0 },
  railColumn: { width: 17, alignItems: 'center' },
  rail: { width: 1, flex: 1 },
  detailColumn: { flex: 1, minWidth: 0 },
  code: { paddingVertical: 10, borderWidth: 1, borderRadius: 11, overflow: 'hidden' },
  line: { flexDirection: 'row', paddingHorizontal: 10 },
  sign: { width: 14, opacity: 0.6, fontFamily: MONO_FONT, fontSize: CODE_SIZE },
  lineText: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, lineHeight: 18 },
  emptyLine: { paddingHorizontal: 12 },
  errorText: { marginTop: 8, fontSize: PROSE_SIZE },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 12, paddingBottom: 7 },
  footerButton: { paddingHorizontal: 8, paddingVertical: 4 },
});
