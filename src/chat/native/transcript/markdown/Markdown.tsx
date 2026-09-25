/**
 * Draws one message body: the blocks `parse.ts` reads out of the core's marked Markdown, in the
 * React chat's prose styles (packages/core-ui/styles/chat.css, `.ghostex-chat-markdown`), the way
 * desktop's `rich_markdown.rs`, `markdown_style.rs`, `markdown_links.rs` and `code_block.rs` lay
 * them out. Links and file references dispatch `openMarkdownLink`, the action desktop sends.
 */

import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type TextStyle } from 'react-native';

import { openChatTablePreview, tableCsv } from '../../cards';
import { useTranscriptEnv } from '../context';
import { Glyph, type GlyphName } from '../icons';
import { arr, obj, str, type JsonRecord } from '../json';
import { CODE_SIZE, MONO_FONT, PROSE_LINE, PROSE_SIZE, type TranscriptTheme } from '../theme';
import { InlineImage } from '../Images';
import { openTranscriptMenu } from '../transcriptMenuStore';
import { inlineText, parseMarkdown, type Block, type FenceHeader, type Inline } from './parse';

type Reference = { label: string; kind: string };

type InlineContext = {
  theme: TranscriptTheme;
  references: Map<string, Reference>;
  openLink(href: string): void;
  /** A long press on a link: the transcript menu's reference rows (main transcript only). */
  longPressLink: ((href: string) => void) | undefined;
  /** Whether prose and code take the platform's own text selection (see `TranscriptMenu.tsx`). */
  selectable: boolean;
};

function referenceMap(references: unknown): Map<string, Reference> {
  const map = new Map<string, Reference>();
  for (const entry of arr(references)) {
    const reference = obj(entry);
    if (reference === null) continue;
    const href = str(reference, 'href');
    const sourceLabel = str(reference, 'sourceLabel');
    if (href.length === 0) continue;
    map.set(`${href}\u0000${sourceLabel}`, { label: str(reference, 'label'), kind: str(reference, 'kind') });
  }
  return map;
}

const REFERENCE_GLYPHS: { [kind: string]: GlyphName } = {
  file: 'file',
  folder: 'folder',
  image: 'photo',
  skill: 'skill',
  url: 'link',
};

function linkColor(theme: TranscriptTheme, kind: string): string {
  return (theme.link as { [kind: string]: string })[kind] ?? theme.link.url;
}

function isExternal(href: string): boolean {
  return /^(https?|mailto):/i.test(href);
}

function renderInlines(inlines: readonly Inline[], context: InlineContext, keyPrefix: string, style?: TextStyle): ReactNode[] {
  return inlines.map((inline, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (inline.t) {
      case 'text':
        return style === undefined ? inline.v : <Text key={key} style={style}>{inline.v}</Text>;
      case 'br':
        return '\n';
      case 'code':
        return (
          <Text
            key={key}
            style={[
              style,
              styles.inlineCode,
              { backgroundColor: context.theme.inlineCodeSurface, color: context.theme.primary },
            ]}
          >
            {`\u00a0${inline.v}\u00a0`}
          </Text>
        );
      case 'strong':
        return (
          <Text key={key} style={[style, styles.strong]}>
            {renderInlines(inline.c, context, key)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} style={[style, styles.em]}>
            {renderInlines(inline.c, context, key)}
          </Text>
        );
      case 'del':
        return (
          <Text key={key} style={[style, styles.del]}>
            {renderInlines(inline.c, context, key)}
          </Text>
        );
      case 'image':
        // Pictures are split out of their paragraph before this runs (`FlowParagraph`).
        return str(inline.image, 'label');
      case 'link': {
        const reference = context.references.get(`${inline.href}\u0000${inline.label}`);
        const kind = reference?.kind ?? (isExternal(inline.href) ? 'url' : 'file');
        const color = linkColor(context.theme, kind);
        const glyph = reference !== undefined ? REFERENCE_GLYPHS[kind] : undefined;
        return (
          <Text
            key={key}
            style={[style, { color }]}
            suppressHighlighting={false}
            onPress={() => context.openLink(inline.href)}
            {...(context.longPressLink !== undefined
              ? { onLongPress: () => context.longPressLink?.(inline.href) }
              : {})}
            accessibilityRole='link'
          >
            {glyph !== undefined ? (
              <Text>
                <View style={styles.referenceIcon}>
                  <Glyph name={glyph} size={13} color={color} strokeWidth={2} />
                </View>{' '}
              </Text>
            ) : null}
            {reference !== undefined && reference.label.length > 0 ? reference.label : renderInlines(inline.c, context, key)}
          </Text>
        );
      }
    }
  });
}

/** A paragraph with pictures in it: the run of words and thumbnails it was written as (`flow` in `rich_markdown.rs`). */
function FlowParagraph({ inlines, context, color }: { inlines: Inline[]; context: InlineContext; color: string }) {
  const parts: ({ kind: 'text'; inlines: Inline[] } | { kind: 'image'; image: JsonRecord })[] = [];
  for (const inline of inlines) {
    if (inline.t === 'image') parts.push({ kind: 'image', image: inline.image });
    else {
      const last = parts[parts.length - 1];
      if (last !== undefined && last.kind === 'text') last.inlines.push(inline);
      else parts.push({ kind: 'text', inlines: [inline] });
    }
  }
  return (
    <View style={styles.flow}>
      {parts.map((part, index) =>
        part.kind === 'image' ? (
          <InlineImage key={index} image={part.image} />
        ) : (
          <Text key={index} style={[styles.prose, { color }]}>
            {renderInlines(part.inlines, context, `f${index}`)}
          </Text>
        )
      )}
    </View>
  );
}

const CELL_PAD_X = 12;

/** `markdown-visual.json`: the shared heading sizes, gaps and leading. */
const HEADING_SIZES = [0, 20, 18, 16, 14, 14, 14];
const HEADING_LINE = 1.3;

function CodeBlock({ block, blockKey, selectable }: { block: Extract<Block, { t: 'code' }>; blockKey: string; selectable: boolean }) {
  const { theme, dispatch } = useTranscriptEnv();
  const [wrapped, setWrapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const header: FenceHeader | null = block.header;
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(block.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [block.text]);
  const openHeader = header?.href;
  const separator = header === null ? -1 : Math.max(header.label.lastIndexOf('/'), header.label.lastIndexOf('\\'));
  const body = (
    <Text selectable={selectable} style={[styles.codeText, { color: theme.primary }]}>
      {block.text}
    </Text>
  );
  return (
    <View style={[styles.codeBlock, { backgroundColor: theme.light ? '#fafafa' : '#171717', borderColor: theme.border }]} key={blockKey}>
      <View style={[styles.codeHeader, { borderBottomColor: theme.border }]}>
        {header !== null ? (
          <Pressable
            style={styles.codeTitle}
            disabled={openHeader === undefined}
            onPress={() => openHeader !== undefined && dispatch({ type: 'openMarkdownLink', href: openHeader, external: false })}
            accessibilityRole='link'
            accessibilityLabel={`Open ${header.label}`}
          >
            <Glyph name={header.icon === 'markdown' ? 'markdown' : header.icon === 'file-code' ? 'file-code' : 'file'} size={13} color={theme.muted} />
            <Text numberOfLines={1} ellipsizeMode='head' style={[styles.codeHeaderText, { color: theme.muted, flexShrink: 1 }]}>
              {separator >= 0 ? header.label.slice(0, separator + 1) : ''}
              <Text style={{ color: theme.primary }}>{separator >= 0 ? header.label.slice(separator + 1) : header.label}</Text>
            </Text>
          </Pressable>
        ) : (
          <Text numberOfLines={1} style={[styles.codeHeaderText, { color: theme.muted, flexShrink: 1 }]}>
            {block.lang.toLowerCase() || 'text'}
          </Text>
        )}
        <View style={styles.codeActions}>
          <Pressable
            hitSlop={6}
            style={[styles.codeAction, wrapped && { backgroundColor: theme.pressed }]}
            onPress={() => setWrapped((value) => !value)}
            accessibilityRole='button'
            accessibilityLabel={wrapped ? 'Turn off line wrap' : 'Wrap lines'}
            accessibilityState={{ selected: wrapped }}
          >
            <Glyph name='text-wrap' size={14} color={wrapped ? theme.foreground : theme.muted} />
          </Pressable>
          <Pressable hitSlop={6} style={styles.codeAction} onPress={copy} accessibilityRole='button' accessibilityLabel='Copy code'>
            <Glyph name={copied ? 'check' : 'copy'} size={14} color={theme.muted} />
          </Pressable>
        </View>
      </View>
      {wrapped ? (
        <View style={styles.codeBody}>{body}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeBody}>
          {body}
        </ScrollView>
      )}
    </View>
  );
}

function Table({ block, context }: { block: Extract<Block, { t: 'table' }>; context: InlineContext }) {
  const { theme } = useTranscriptEnv();
  const { width } = useWindowDimensions();
  const [collapsed, setCollapsed] = useState(false);
  // React's `--chat-table-cell-max`: min(24rem, 60% of the pane).
  const cellMax = Math.min(384, width * 0.6);
  // React Native has no table layout. Each column takes its widest cell's natural width, capped like
  // the React cell (cells wrap inside the cap). The widths are measured from an invisible copy of
  // the cells laid out without a width limit; until that layout lands, an estimate from the prose
  // size stands in (it runs narrow for wide glyphs, which broke words like "number" mid-word).
  // A column reports only when its width changes, so the last report per column stays valid.
  const [measured, setMeasured] = useState<number[] | null>(null);
  const pending = useRef<number[]>([]);
  const columns = useMemo(() => {
    let natural: number[];
    if (measured !== null && measured.length === block.head.length) natural = measured;
    else {
      natural = block.head.map((cell) => inlineText(cell).length * 7.9);
      for (const row of block.rows) {
        row.forEach((cell, column) => {
          natural[column] = Math.max(natural[column] ?? 0, inlineText(cell).length * 7.3);
        });
      }
    }
    return natural.map((textWidth) => Math.min(cellMax, Math.max(44, Math.ceil(textWidth) + 1 + CELL_PAD_X * 2)));
  }, [block, cellMax, measured]);
  const measureColumn = (column: number, columnWidth: number) => {
    const widths = pending.current;
    widths[column] = columnWidth;
    if (!block.head.every((_, index) => typeof widths[index] === 'number')) return;
    const next = block.head.map((_, index) => widths[index]!);
    setMeasured((current) =>
      current !== null && current.length === next.length && current.every((value, index) => value === next[index]) ? current : next
    );
  };
  const cellStyle = (column: number) => {
    const align = block.align[column] ?? null;
    return [styles.tableCell, { width: columns[column] }, align === 'right' ? styles.right : align === 'center' ? styles.center : null];
  };
  const lines = collapsed ? 1 : undefined;
  return (
    <View style={styles.table}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.tableMeasure} pointerEvents='none' accessibilityElementsHidden importantForAccessibility='no-hide-descendants'>
          {block.head.map((cell, column) => (
            <View key={column} style={styles.tableMeasureColumn} onLayout={(event) => measureColumn(column, event.nativeEvent.layout.width)}>
              <Text style={[styles.tableText, styles.strong]}>{renderInlines(cell, context, `mh${column}`)}</Text>
              {block.rows.map((row, rowIndex) => (
                <Text key={rowIndex} style={styles.tableText}>
                  {renderInlines(row[column] ?? [], context, `mr${rowIndex}.${column}`)}
                </Text>
              ))}
            </View>
          ))}
        </View>
        <View>
          <View style={[styles.tableRow, { borderBottomColor: theme.border }]}>
            {block.head.map((cell, column) => (
              <View key={column} style={cellStyle(column)}>
                <Text numberOfLines={lines} style={[styles.tableText, styles.strong, { color: theme.foreground }]}>
                  {renderInlines(cell, context, `h${column}`)}
                </Text>
              </View>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.tableRow, { borderBottomColor: theme.light ? 'rgba(229,229,229,0.6)' : 'rgba(29,29,29,0.6)' }]}>
              {row.map((cell, column) => (
                <View key={column} style={cellStyle(column)}>
                  <Text numberOfLines={lines} style={[styles.tableText, { color: theme.prose }]}>
                    {renderInlines(cell, context, `r${rowIndex}.${column}`)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.tableActions}>
        <TableAction label='Open table' glyph='maximize' theme={theme} onPress={() => openChatTablePreview(block.source)} />
        <TableAction
          label={collapsed ? 'Expand cells' : 'Collapse cells'}
          glyph={collapsed ? 'chevron-down' : 'chevron-up'}
          theme={theme}
          onPress={() => setCollapsed((value) => !value)}
        />
        <TableAction label='Copy as Markdown' text='MD' theme={theme} onPress={() => void Clipboard.setStringAsync(block.source)} />
        <TableAction label='Copy as CSV' text='CSV' theme={theme} onPress={() => void Clipboard.setStringAsync(tableCsv(block.source))} />
      </View>
    </View>
  );
}

function TableAction({ label, glyph, text, theme, onPress }: { label: string; glyph?: GlyphName; text?: string; theme: TranscriptTheme; onPress(): void }) {
  return (
    <Pressable
      hitSlop={4}
      onPress={onPress}
      accessibilityRole='button'
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tableAction, pressed && { backgroundColor: theme.pressed }]}
    >
      {glyph !== undefined ? <Glyph name={glyph} size={14} color={theme.muted} /> : <Text style={[styles.tableActionText, { color: theme.muted }]}>{text}</Text>}
    </Pressable>
  );
}

const ALERTS: { [kind: string]: { label: string; glyph: GlyphName } } = {
  note: { label: 'Note', glyph: 'info-circle' },
  tip: { label: 'Tip', glyph: 'bulb' },
  important: { label: 'Important', glyph: 'message-report' },
  warning: { label: 'Warning', glyph: 'alert-triangle' },
  caution: { label: 'Caution', glyph: 'alert-octagon' },
};

const BULLETS = ['•', '◦', '▪'];

function orderedLabel(value: number, depth: number): string {
  if (depth % 3 === 1) {
    let label = '';
    let remaining = value;
    while (remaining > 0) {
      remaining -= 1;
      label = String.fromCharCode(97 + (remaining % 26)) + label;
      remaining = Math.floor(remaining / 26);
    }
    return `${label}.`;
  }
  if (depth % 3 === 2) {
    const numerals: [number, string][] = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let label = '';
    let remaining = value;
    for (const [amount, numeral] of numerals) {
      while (remaining >= amount) {
        label += numeral;
        remaining -= amount;
      }
    }
    return `${label}.`;
  }
  return `${value}.`;
}

type BlockProps = { blocks: Block[]; context: InlineContext; color: string; depth: number; listDepth: { ordered: number; bullet: number } };

function Blocks({ blocks, context, color, depth, listDepth }: BlockProps) {
  const { theme } = context;
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${depth}.${index}`;
        const spacing = index === 0 ? null : block.t === 'h' ? styles.headingGap : styles.blockGap;
        switch (block.t) {
          case 'p':
            if (block.c.some((inline) => inline.t === 'image')) {
              return (
                <View key={key} style={spacing}>
                  <FlowParagraph inlines={block.c} context={context} color={color} />
                </View>
              );
            }
            return (
              <Text key={key} selectable={context.selectable} style={[styles.prose, { color }, spacing]}>
                {renderInlines(block.c, context, key)}
              </Text>
            );
          case 'h':
            return (
              <Text
                key={key}
                selectable={context.selectable}
                accessibilityRole='header'
                style={[
                  styles.heading,
                  { fontSize: HEADING_SIZES[block.level] ?? PROSE_SIZE, lineHeight: (HEADING_SIZES[block.level] ?? PROSE_SIZE) * HEADING_LINE },
                  { color: block.level === 6 ? theme.muted : theme.primary },
                  spacing,
                  styles.headingBottom,
                ]}
              >
                {renderInlines(block.c, context, key)}
              </Text>
            );
          case 'code':
            return (
              <View key={key} style={spacing}>
                <CodeBlock block={block} blockKey={key} selectable={context.selectable} />
              </View>
            );
          case 'hr':
            return <View key={key} style={[styles.rule, { backgroundColor: theme.border }, spacing]} />;
          case 'quote':
            return (
              <View key={key} style={[styles.quote, { borderLeftColor: theme.border }, spacing]}>
                <Blocks blocks={block.c} context={context} color={theme.muted} depth={depth + 1} listDepth={listDepth} />
              </View>
            );
          case 'alert': {
            const alert = ALERTS[block.kind] ?? ALERTS.note!;
            const accent = (theme.alert as { [kind: string]: string })[block.kind] ?? theme.alert.note;
            return (
              <View key={key} style={[styles.alert, { borderLeftColor: accent }, spacing]}>
                <View style={styles.alertTitle}>
                  <Glyph name={alert.glyph} size={15} color={accent} />
                  <Text style={[styles.alertTitleText, { color: accent }]}>{alert.label}</Text>
                </View>
                <Blocks blocks={block.c} context={context} color={color} depth={depth + 1} listDepth={listDepth} />
              </View>
            );
          }
          case 'table':
            return (
              <View key={key} style={spacing}>
                <Table block={block} context={context} />
              </View>
            );
          case 'list': {
            const nested = block.ordered
              ? { ...listDepth, ordered: listDepth.ordered + 1 }
              : { ...listDepth, bullet: listDepth.bullet + 1 };
            const widest = block.ordered ? orderedLabel(block.start + block.items.length - 1, listDepth.ordered) : '';
            const gutter = block.ordered ? Math.max(20, widest.length * 8 + 4) : 20;
            return (
              <View key={key} style={spacing}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={[styles.listItem, itemIndex > 0 && styles.listItemGap]}>
                    <View style={[styles.listMarker, { width: gutter }]}>
                      {item.checked !== null ? (
                        <View style={[styles.checkbox, { borderColor: theme.muted }, item.checked && { backgroundColor: theme.muted }]}>
                          {item.checked ? <Glyph name='check' size={10} color={theme.background} strokeWidth={3} /> : null}
                        </View>
                      ) : (
                        <Text style={[styles.prose, { color: block.ordered ? color : theme.muted }]}>
                          {block.ordered
                            ? orderedLabel(block.start + itemIndex, listDepth.ordered)
                            : BULLETS[listDepth.bullet % BULLETS.length]}
                        </Text>
                      )}
                    </View>
                    <View style={styles.listBody}>
                      <Blocks blocks={item.c} context={context} color={color} depth={depth + 1} listDepth={nested} />
                    </View>
                  </View>
                ))}
              </View>
            );
          }
        }
      })}
    </>
  );
}

export type MarkdownProps = {
  text: string;
  /** The message's `markdownReferences`: the pill label and kind of each link, by href and source label. */
  references?: unknown;
  /** The running text colour; defaults to the answer's prose tone. */
  color?: string;
  /** Text somebody typed: single newlines are line breaks. */
  breaks?: boolean;
  /** False where a long press on the message opens the transcript menu instead. */
  selectable?: boolean;
};

export const Markdown = memo(function Markdown({ text, references, color, breaks = false, selectable = true }: MarkdownProps) {
  const { theme, dispatch, main } = useTranscriptEnv();
  const blocks = useMemo(() => parseMarkdown(text, { breaks }), [breaks, text]);
  const referencesMap = useMemo(() => referenceMap(references), [references]);
  const openLink = useCallback(
    (href: string) => dispatch({ type: 'openMarkdownLink', href, external: false }),
    [dispatch]
  );
  const context = useMemo<InlineContext>(
    () => ({
      theme,
      references: referencesMap,
      openLink,
      longPressLink: main ? (href: string) => openTranscriptMenu({ href }) : undefined,
      selectable,
    }),
    [main, openLink, referencesMap, selectable, theme]
  );
  return (
    <View style={styles.root}>
      <Blocks blocks={blocks} context={context} color={color ?? theme.prose} depth={0} listDepth={{ ordered: 0, bullet: 0 }} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { minWidth: 0, flexShrink: 1 },
  prose: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  strong: { fontWeight: '600' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  inlineCode: { fontFamily: MONO_FONT, fontSize: CODE_SIZE },
  referenceIcon: { width: 13, height: 13, transform: [{ translateY: 2 }] },
  flow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  blockGap: { marginTop: 10.4 },
  headingGap: { marginTop: 20 },
  headingBottom: { marginBottom: 0 },
  heading: { fontWeight: '600' },
  rule: { height: 1 },
  quote: { borderLeftWidth: 2, paddingLeft: 12 },
  alert: { borderLeftWidth: 2, paddingLeft: 12 },
  alertTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  alertTitleText: { fontSize: PROSE_SIZE, fontWeight: '600', lineHeight: 20 },
  listItem: { flexDirection: 'row' },
  listItemGap: { marginTop: 4 },
  listMarker: { alignItems: 'flex-start' },
  listBody: { flex: 1, minWidth: 0 },
  checkbox: { width: 13, height: 13, borderWidth: 1, borderRadius: 3, marginTop: 5, alignItems: 'center', justifyContent: 'center' },
  codeBlock: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  codeHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
    borderBottomWidth: 1,
  },
  codeTitle: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, minWidth: 0 },
  codeHeaderText: { fontFamily: MONO_FONT, fontSize: 11 },
  codeActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  codeAction: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  codeBody: { paddingHorizontal: 14, paddingVertical: 12 },
  codeText: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, lineHeight: 17.5 },
  table: { gap: 2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1 },
  tableMeasure: { position: 'absolute', left: 0, top: 0, width: 10000, flexDirection: 'row', alignItems: 'flex-start', opacity: 0 },
  tableMeasureColumn: { alignItems: 'flex-start' },
  tableCell: { paddingHorizontal: CELL_PAD_X, paddingVertical: 7 },
  tableText: { fontSize: PROSE_SIZE, lineHeight: 20 },
  right: { alignItems: 'flex-end' },
  center: { alignItems: 'center' },
  tableActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 2 },
  tableAction: { minWidth: 26, height: 24, paddingHorizontal: 5, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tableActionText: { fontSize: 11, fontWeight: '600' },
});
