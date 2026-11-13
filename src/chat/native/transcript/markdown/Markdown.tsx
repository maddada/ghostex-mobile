/**
 * Draws one message body: the blocks `parse.ts` reads out of the core's marked Markdown, in the
 * React chat's prose styles (packages/core-ui/styles/chat.css, `.ghostex-chat-markdown`), the way
 * desktop's `rich_markdown.rs`, `markdown_style.rs`, `markdown_links.rs` and `code_block.rs` lay
 * them out. Links and file references dispatch `openMarkdownLink`, the action desktop sends.
 */

import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { openChatTablePreview, tableCsv } from '../../cards';
import { useChatViewSize } from '../../chatPlacement';
import { useIssueLinkBase, useTranscriptEnv } from '../context';
import { Glyph, type GlyphName } from '../icons';
import { arr, obj, str, type JsonRecord } from '../json';
import { CODE_SIZE, MONO_FONT, PROSE_LINE, PROSE_SIZE, type TranscriptTheme } from '../theme';
import { InlineImage, PictureStrip } from '../Images';
import { VisualBlock } from '../VisualBlock';
import { QuestionForm } from '../QuestionForm';
import { InlineAnswers } from './InlineAnswers';
import { QUESTION_TAGS, type QuestionTagState } from '../OpenQuestions';
import { openTranscriptMenu } from '../transcriptMenuStore';
import { highlightText, useOwnFind, useRowFind, type RowFind } from '../searchHighlight';
import { inlineText, parseMarkdown, type Block, type FenceHeader, type Inline } from './parse';
import { BlockLongPress } from './blockLongPress';
import { isRunCommandHref } from './runCommands';
import { fitTableColumns } from './tableLayout';
import { RIGHT_TO_LEFT_TEXT, startsRightToLeft } from './textDirection';
import { MarkedSection, useMarkedEmoji, useMarkedStyle } from './MarkedSections';
import { SessionPill } from '../SessionPill';
import type { MentionTarget } from '../mentionedSession';
import { openQuestionReply } from '../QuestionReply';

/** One `markdownReferences` entry; `record` is the whole entry (a `session` pill reads its logo and state). */
type Reference = { label: string; kind: string; state: string; title: string; record: JsonRecord };

type InlineContext = {
  theme: TranscriptTheme;
  references: Map<string, Reference>;
  openLink(href: string): void;
  /** A long press on a link: the transcript menu's reference rows (and a session pill's card, `mention`). */
  longPressLink: ((href: string, mention?: MentionTarget) => void) | undefined;
  /** Whether prose and code take the platform's own text selection (see `TranscriptMenu.tsx`). */
  selectable: boolean;
  /** Transcript search's word highlight for the row this text is in (`searchHighlight.tsx`). */
  find: RowFind | null;
  /** False in a prompt somebody sent: its pictures stay small thumbnails (`pictureRuns`). */
  strips: boolean;
  /** The heading colour (levels 1 to 5): the theme's `primary` unless the row's lane sets one. */
  heading: string;
  /** The inline code colour: the theme's `primary` unless the row's Text strength raises it. */
  inlineCode: string;
  /** A table's body text: the row's running text colour. */
  body: string;
  /** Where a `ghostex-issue:<n>` link goes, its number appended; null keeps it the `#<n>` text. */
  issueLinkBase: string | null;
};

/**
 * The core writes each `#123` in prose as a link to `ghostex-issue:123` (gx-chat-core
 * `transcript/issue_links.rs`, the rule desktop draws by too); the document's `issueLinkBase` says
 * where it goes, the project's GitHub issues, which GitHub forwards to a pull request.
 */
const ISSUE_LINK_SCHEME = 'ghostex-issue:';

/**
 * The core writes each hex colour in prose (`#ff8800`), and each code span that names one and
 * nothing else, as a link to `ghostex-color:<hex>` (gx-chat-core `transcript/hex_colors.rs`, the
 * rule desktop draws by too); the phone draws the colour's swatch before its words, which stay as
 * they were written. A colour in a fenced block or among other words in a code span is not marked.
 */
const COLOR_LINK_SCHEME = 'ghostex-color:';

/** A swatch's side: about 0.78 of the text's height, as the desktop sizes it (`swatch_side`). */
const SWATCH_SIDE = 12;

/**
 * A colour's swatch: a small rounded square in that colour with the desktop's grey hairline ring,
 * the same in both themes, so a very light colour on a light background (or a dark one on dark)
 * still shows its edge (desktop `markdown_style.rs`, `swatch_ring`).
 */
function ColorSwatch({ hex }: { hex: string }) {
  return (
    <View style={styles.swatchBox}>
      <View style={[styles.swatch, { backgroundColor: `#${hex}` }]} />
    </View>
  );
}

/** The hex digits of a `ghostex-color:` link, or null for anything a swatch cannot draw. */
function colorOfHref(href: string): string | null {
  if (!href.startsWith(COLOR_LINK_SCHEME)) return null;
  const hex = href.slice(COLOR_LINK_SCHEME.length);
  return /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) ? hex : null;
}

function referenceMap(references: unknown): Map<string, Reference> {
  const map = new Map<string, Reference>();
  for (const entry of arr(references)) {
    const reference = obj(entry);
    if (reference === null) continue;
    const href = str(reference, 'href');
    const sourceLabel = str(reference, 'sourceLabel');
    if (href.length === 0) continue;
    map.set(`${href}\u0000${sourceLabel}`, {
      label: str(reference, 'label'),
      kind: str(reference, 'kind'),
      state: str(reference, 'state'),
      title: str(reference, 'title'),
      record: reference,
    });
  }
  return map;
}

const REFERENCE_GLYPHS: { [kind: string]: GlyphName } = {
  file: 'file',
  folder: 'folder',
  image: 'photo',
  skill: 'skill',
  url: 'link',
  comment: 'comment',
};

function linkColor(theme: TranscriptTheme, kind: string): string {
  return (theme.link as { [kind: string]: string })[kind] ?? theme.link.url;
}

function isExternal(href: string): boolean {
  return /^(https?|mailto):/i.test(href);
}

function renderInlines(
  inlines: readonly Inline[],
  context: InlineContext,
  keyPrefix: string,
  style?: TextStyle,
): ReactNode[] {
  return inlines.map((inline, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (inline.t) {
      case 'text':
        return highlightText(inline.v, context.find, key, style);
      case 'br':
        return '\n';
      case 'code':
        return (
          <Text
            key={key}
            style={[
              style,
              styles.inlineCode,
              { backgroundColor: context.theme.inlineCodeSurface, color: context.inlineCode },
            ]}
          >
            {'\u00a0'}
            {highlightText(inline.v, context.find, `${key}.code`)}
            {'\u00a0'}
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
        // A hex colour: its swatch before its words. The desktop draws a code span's swatch inside
        // its chip; a React Native text's background does not run under a view inside it, so the
        // chip would split around the swatch, and the phone draws it just before the chip instead.
        const swatch = colorOfHref(inline.href);
        if (swatch !== null) {
          return (
            <Text key={key} style={style}>
              <ColorSwatch hex={swatch} />
              {renderInlines(inline.c, context, key)}
            </Text>
          );
        }
        // `#123`: a link to the project's GitHub issue, opened in the browser as any web link is;
        // without a GitHub remote it stays the text it was written as.
        if (inline.href.startsWith(ISSUE_LINK_SCHEME)) {
          if (context.issueLinkBase === null)
            return (
              <Text key={key} style={style}>
                {renderInlines(inline.c, context, key)}
              </Text>
            );
          const href = `${context.issueLinkBase}${inline.href.slice(ISSUE_LINK_SCHEME.length)}`;
          return (
            <Text
              key={key}
              style={[style, { color: linkColor(context.theme, 'url') }]}
              suppressHighlighting={false}
              onPress={() => context.openLink(href)}
              {...(context.longPressLink !== undefined
                ? { onLongPress: () => context.longPressLink?.(href) }
                : {})}
              accessibilityRole="link"
            >
              {renderInlines(inline.c, context, key)}
            </Text>
          );
        }
        // An inline command stays the code it was written as; the phone runs it from the message's
        // long-press menu (`runCommands.ts`), never from a button on the message.
        if (isRunCommandHref(inline.href)) {
          return (
            <Text key={key} style={style}>
              {renderInlines(inline.c, context, key)}
            </Text>
          );
        }
        const reference = context.references.get(`${inline.href}\u0000${inline.label}`);
        if (reference?.kind === 'question')
          return <QuestionTagPill key={key} reference={reference} href={inline.href} context={context} />;
        // A mention of another session (`[<title>](<Global Ref>)`) is its agent pill; a tap goes
        // to the core as any link does, which switches to it (`session_mentions.rs`). A board item
        // (`[<title>](board:B4)`) is the same pill with the board's icon, and a tap opens the
        // board at it (`coordinator_board.rs`).
        if (reference?.kind === 'session' || reference?.kind === 'board')
          return (
            <Text key={key}>
              <SessionPill
                pill={reference.record}
                onOpen={() => context.openLink(inline.href)}
                {...(context.longPressLink !== undefined
                  ? {
                      // A session's pill shows its card above the link's rows (CDXC:SessionChat 2026-11-13 in MentionCard.tsx).
                      onLongPress: () =>
                        context.longPressLink?.(
                          inline.href,
                          reference.kind === 'session' ? { globalRef: inline.href } : undefined,
                        ),
                    }
                  : {})}
              />
            </Text>
          );
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
            accessibilityRole="link"
          >
            {glyph !== undefined ? (
              <Text>
                <View style={styles.referenceIcon}>
                  <Glyph name={glyph} size={13} color={color} strokeWidth={2} />
                </View>{' '}
              </Text>
            ) : null}
            {reference !== undefined && reference.label.length > 0
              ? reference.label
              : renderInlines(inline.c, context, key)}
          </Text>
        );
      }
    }
  });
}

/**
 * A Q-tag (`Q80`) as an outlined pill in its question's state: pink with a ? while open, green with
 * a check once answered, grey and struck through once withdrawn. Desktop draws the same pill from
 * `question_tag_link` in `open_questions.rs`; the state is gx-chat-core's `TagState`.
 */
function QuestionTagPill({ reference, href, context }: { reference: Reference; href: string; context: InlineContext }) {
  const state = (reference.state in QUESTION_TAGS.tone.dark ? reference.state : 'open') as QuestionTagState;
  const tone = (context.theme.light ? QUESTION_TAGS.tone.light : QUESTION_TAGS.tone.dark)[state];
  const glyph = state === 'open' ? 'question-mark' : state === 'answered' ? 'check' : undefined;
  // On its own one-click question the tag answers it there instead of jumping (desktop
  // `here_tag`, gx-chat-core `jump_to_tag`).
  const here = reference.record.here === true ? str(reference.record, 'tag') : '';
  return (
    <Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={reference.title}
        onPress={() => (here.length > 0 ? openQuestionReply({ form: null, tag: here }) : context.openLink(href))}
        {...(context.longPressLink !== undefined ? { onLongPress: () => context.longPressLink?.(href) } : {})}
        style={({ pressed }) => [
          styles.questionTag,
          { borderColor: tone.border, backgroundColor: pressed ? tone.border : 'transparent' },
        ]}
      >
        {glyph !== undefined ? (
          <Glyph name={glyph} size={QUESTION_TAGS.iconSize} color={tone.text} strokeWidth={2.8} />
        ) : null}
        <Text style={[styles.questionTagLabel, { color: tone.text }, state === 'withdrawn' ? styles.del : null]}>
          {reference.label}
        </Text>
      </Pressable>
    </Text>
  );
}

/**
 * A paragraph with pictures in it, cut at its line breaks: consecutive lines made only of pictures
 * become one filmstrip, every other line keeps its words and inline thumbnails (`parse` in
 * desktop's `rich_markdown.rs` groups the same lines).
 */
function pictureRuns(inlines: Inline[]): { pictures: boolean; inlines: Inline[] }[] {
  const lines: Inline[][] = [[]];
  for (const inline of inlines) {
    if (inline.t === 'br') lines.push([]);
    else lines[lines.length - 1]!.push(inline);
  }
  const runs: { pictures: boolean; inlines: Inline[] }[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    const pictures =
      line.some((inline) => inline.t === 'image') &&
      line.every((inline) => inline.t === 'image' || (inline.t === 'text' && inline.v.trim().length === 0));
    const last = runs[runs.length - 1];
    if (last !== undefined && last.pictures === pictures)
      last.inlines.push(...(pictures ? line : [{ t: 'br' } as Inline, ...line]));
    else runs.push({ pictures, inlines: [...line] });
  }
  return runs;
}

/**
 * A paragraph with pictures in it: the run of words and thumbnails it was written as (`flow` in `rich_markdown.rs`).
 * `lead` is the marker of the list item the paragraph opens. It leads the first words in one row of the flow, so it
 * stays on their first line however the flow centres them against a picture: the desktop's flow keeps a line's `1.`
 * in the text the line starts with.
 */
function FlowParagraph({
  inlines,
  context,
  color,
  lead,
}: {
  inlines: Inline[];
  context: InlineContext;
  color: string;
  lead?: ReactNode;
}) {
  const parts: ({ kind: 'text'; inlines: Inline[] } | { kind: 'image'; image: JsonRecord })[] = [];
  for (const inline of inlines) {
    if (inline.t === 'image') parts.push({ kind: 'image', image: inline.image });
    else {
      const last = parts[parts.length - 1];
      if (last !== undefined && last.kind === 'text') last.inlines.push(inline);
      else parts.push({ kind: 'text', inlines: [inline] });
    }
  }
  const leadsWords = lead !== undefined && parts[0]?.kind === 'text';
  return (
    <View style={styles.flow}>
      {lead !== undefined && !leadsWords ? lead : null}
      {parts.map((part, index) => {
        if (part.kind === 'image') return <InlineImage key={index} image={part.image} />;
        const words = (
          <Text
            key={index}
            selectable={context.selectable}
            style={[styles.prose, { color }, leadsWords && index === 0 && styles.flowLeadWords]}
          >
            {renderInlines(part.inlines, context, `f${index}`)}
          </Text>
        );
        return leadsWords && index === 0 ? (
          <View key={index} style={styles.flowLead}>
            {lead}
            {words}
          </View>
        ) : (
          words
        );
      })}
    </View>
  );
}

/**
 * Whether a list item's first block is a paragraph that starts as a flow of words and pictures, which then carries
 * the item's marker (`FlowParagraph`). A paragraph that opens with a filmstrip keeps the marker beside it, as the
 * desktop's strip does.
 */
function leadsFlow(block: Block | undefined, strips: boolean): boolean {
  if (block?.t !== 'p' || !block.c.some((inline) => inline.t === 'image')) return false;
  return !strips || pictureRuns(block.c)[0]?.pictures === false;
}

const CELL_PAD_X = 12;
/** How many of a column's longest words are laid out to find its widest one. */
const TABLE_MEASURED_WORDS = 4;

/**
 * `markdown-visual.json` `codeBlock`: a fence longer than `collapseAfterLines` shows `collapsedLines`
 * lines and scrolls the rest under its header until the reader shows it whole.
 * CDXC:SessionChat 2026-10-08 SEE-ALSO: the desktop caps its blocks with the same numbers
 * (`apps/desktop/src/app/native_chat/markdown_style.rs`, `code_block_cap`).
 */
const CODE_COLLAPSED_LINES = 20;
const CODE_COLLAPSE_AFTER_LINES = 26;
/** `styles.codeText` line height and `styles.codeBody` vertical padding. */
const CODE_CAP = CODE_COLLAPSED_LINES * 17.5 + 12 * 2;

/** `markdown-visual.json`: the shared heading sizes, gaps and leading. */
const HEADING_SIZES = [0, 20, 18, 16, 14, 14, 14];
const HEADING_LINE = 1.3;

function CodeBlock({
  block,
  blockKey,
  selectable,
}: {
  block: Extract<Block, { t: 'code' }>;
  blockKey: string;
  selectable: boolean;
}) {
  const { theme, dispatch } = useTranscriptEnv();
  const [find, findDone] = useOwnFind(useRowFind());
  const [wrapped, setWrapped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const long = useMemo(() => block.text.split('\n').length > CODE_COLLAPSE_AFTER_LINES, [block.text]);
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
      {highlightText(block.text, find, `${blockKey}.code`)}
    </Text>
  );
  findDone();
  const codeContent = wrapped ? (
    <View style={styles.codeBody}>{body}</View>
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeBody}>
      <BlockLongPress>{body}</BlockLongPress>
    </ScrollView>
  );
  return (
    <View
      style={[styles.codeBlock, { backgroundColor: theme.light ? '#fafafa' : '#171717', borderColor: theme.border }]}
      key={blockKey}
    >
      <View style={[styles.codeHeader, { borderBottomColor: theme.border }]}>
        {header !== null ? (
          <Pressable
            style={styles.codeTitle}
            disabled={openHeader === undefined}
            onPress={() =>
              openHeader !== undefined && dispatch({ type: 'openMarkdownLink', href: openHeader, external: false })
            }
            accessibilityRole="link"
            accessibilityLabel={`Open ${header.label}`}
          >
            <Glyph
              name={header.icon === 'markdown' ? 'markdown' : header.icon === 'file-code' ? 'file-code' : 'file'}
              size={13}
              color={theme.muted}
            />
            <Text
              numberOfLines={1}
              ellipsizeMode="head"
              style={[styles.codeHeaderText, { color: theme.muted, flexShrink: 1 }]}
            >
              {separator >= 0 ? header.label.slice(0, separator + 1) : ''}
              <Text style={{ color: theme.primary }}>
                {separator >= 0 ? header.label.slice(separator + 1) : header.label}
              </Text>
            </Text>
          </Pressable>
        ) : (
          <Text numberOfLines={1} style={[styles.codeHeaderText, { color: theme.muted, flexShrink: 1 }]}>
            {block.lang.toLowerCase() || 'text'}
          </Text>
        )}
        <View style={styles.codeActions}>
          {long ? (
            <Pressable
              hitSlop={6}
              style={styles.codeAction}
              onPress={() => setExpanded((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse code' : 'Show all code'}
              accessibilityState={{ expanded }}
            >
              <Glyph name={expanded ? 'arrows-diagonal-minimize' : 'arrows-diagonal'} size={14} color={theme.muted} />
            </Pressable>
          ) : null}
          <Pressable
            hitSlop={6}
            style={[styles.codeAction, wrapped && { backgroundColor: theme.pressed }]}
            onPress={() => setWrapped((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={wrapped ? "Don't wrap lines" : 'Wrap lines'}
            accessibilityState={{ selected: wrapped }}
          >
            <Glyph name="text-wrap" size={14} color={wrapped ? theme.foreground : theme.muted} />
          </Pressable>
          {block.run !== null ? (
            <Pressable
              hitSlop={6}
              style={styles.codeAction}
              onPress={() => block.run !== null && dispatch({ type: 'runInTerminal', command: block.run })}
              accessibilityRole="button"
              accessibilityLabel="Run in terminal"
            >
              <Glyph name="terminal-2" size={14} color={theme.muted} />
            </Pressable>
          ) : null}
          <Pressable
            hitSlop={6}
            style={styles.codeAction}
            onPress={copy}
            accessibilityRole="button"
            accessibilityLabel="Copy"
          >
            <Glyph name={copied ? 'check' : 'copy'} size={14} color={theme.muted} />
          </Pressable>
        </View>
      </View>
      {long && !expanded ? (
        // The transcript is a list too, so Android needs `nestedScrollEnabled` for the code to scroll on its own.
        <ScrollView nestedScrollEnabled style={{ maxHeight: CODE_CAP }}>
          {codeContent}
        </ScrollView>
      ) : (
        codeContent
      )}
    </View>
  );
}

function Table({ block, context: rowContext }: { block: Extract<Block, { t: 'table' }>; context: InlineContext }) {
  const { theme } = useTranscriptEnv();
  // The table renders again on its own once its columns are measured; its occurrences keep their
  // numbers then (`useOwnFind`), and the invisible measuring copy marks none.
  const [find, findDone] = useOwnFind(rowContext.find);
  const context = { ...rowContext, find };
  const measureContext = { ...rowContext, find: null };
  const { width } = useChatViewSize();
  const [collapsed, setCollapsed] = useState(false);
  // The table fits the transcript's width (`fitTableColumns`). React Native has no table layout,
  // so both of a column's widths are measured from an invisible copy of the cells laid out without
  // a width limit (each column's cells, and its longest words alone); until that layout lands, an
  // estimate from the prose size stands in. A column reports only when its width changes, so the
  // last report per column stays valid.
  const [available, setAvailable] = useState<number | null>(null);
  const [measured, setMeasured] = useState<{ max: number[]; min: number[] } | null>(null);
  const pending = useRef<{ max: number[]; min: number[] }>({ max: [], min: [] });
  const longWords = useMemo(
    () =>
      block.head.map((cell, column) => {
        const words = [cell, ...block.rows.map((row) => row[column] ?? [])].flatMap((inlines) =>
          inlineText(inlines).split(/\s+/),
        );
        return [...new Set(words.filter((word) => word.length > 0))]
          .sort((a, b) => b.length - a.length)
          .slice(0, TABLE_MEASURED_WORDS);
      }),
    [block],
  );
  const columns = useMemo(() => {
    let natural: number[];
    let word: number[];
    if (measured !== null && measured.max.length === block.head.length) ({ max: natural, min: word } = measured);
    else {
      natural = block.head.map((cell) => inlineText(cell).length * 7.9);
      for (const row of block.rows) {
        row.forEach((cell, column) => {
          natural[column] = Math.max(natural[column] ?? 0, inlineText(cell).length * 7.3);
        });
      }
      word = longWords.map((words) => (words[0]?.length ?? 0) * 7.9);
    }
    const extents = natural.map((max, column) => ({ max, min: word[column] ?? 0 }));
    return fitTableColumns(extents, 1 + CELL_PAD_X * 2, available ?? width, PROSE_SIZE);
  }, [block, measured, longWords, available, width]);
  const report = (kind: 'max' | 'min', column: number, columnWidth: number) => {
    const widths = pending.current;
    widths[kind][column] = columnWidth;
    const complete = (values: number[]) => block.head.every((_, index) => typeof values[index] === 'number');
    if (!complete(widths.max) || !complete(widths.min)) return;
    const next = {
      max: block.head.map((_, index) => widths.max[index]!),
      min: block.head.map((_, index) => widths.min[index]!),
    };
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);
    setMeasured((current) =>
      current !== null && same(current.max, next.max) && same(current.min, next.min) ? current : next,
    );
  };
  const cellStyle = (column: number) => {
    const align = block.align[column] ?? null;
    return [
      styles.tableCell,
      { width: columns[column] },
      align === 'right' ? styles.right : align === 'center' ? styles.center : null,
    ];
  };
  const lines = collapsed ? 1 : undefined;
  const table = (
    <View style={styles.table}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}
      >
        <View
          style={styles.tableMeasure}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {block.head.map((cell, column) => (
            <View
              key={column}
              style={styles.tableMeasureColumn}
              onLayout={(event) => report('max', column, event.nativeEvent.layout.width)}
            >
              <Text style={[styles.tableText, styles.strong]}>
                {renderInlines(cell, measureContext, `mh${column}`)}
              </Text>
              {block.rows.map((row, rowIndex) => (
                <Text key={rowIndex} style={styles.tableText}>
                  {renderInlines(row[column] ?? [], measureContext, `mr${rowIndex}.${column}`)}
                </Text>
              ))}
            </View>
          ))}
          {longWords.map((words, column) => (
            <View
              key={`w${column}`}
              style={styles.tableMeasureColumn}
              onLayout={(event) => report('min', column, event.nativeEvent.layout.width)}
            >
              {words.map((word, wordIndex) => (
                <Text key={wordIndex} style={[styles.tableText, styles.strong]}>
                  {word}
                </Text>
              ))}
            </View>
          ))}
        </View>
        <BlockLongPress>
          <View style={[styles.tableRow, { borderBottomColor: theme.border }]}>
            {block.head.map((cell, column) => (
              <View key={column} style={cellStyle(column)}>
                <Text
                  numberOfLines={lines}
                  selectable={context.selectable}
                  style={[styles.tableText, styles.strong, { color: theme.foreground }]}
                >
                  {renderInlines(cell, context, `h${column}`)}
                </Text>
              </View>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View
              key={rowIndex}
              style={[
                styles.tableRow,
                { borderBottomColor: theme.light ? 'rgba(229,229,229,0.6)' : 'rgba(29,29,29,0.6)' },
              ]}
            >
              {row.map((cell, column) => (
                <View key={column} style={cellStyle(column)}>
                  <Text
                    numberOfLines={lines}
                    selectable={context.selectable}
                    style={[styles.tableText, { color: context.body }]}
                  >
                    {renderInlines(cell, context, `r${rowIndex}.${column}`)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </BlockLongPress>
      </ScrollView>
      <View style={styles.tableActions}>
        <TableAction
          label="Open table"
          glyph="maximize"
          theme={theme}
          onPress={() => openChatTablePreview(block.source)}
        />
        <TableAction
          label={collapsed ? 'Expand cells' : 'Collapse cells'}
          glyph={collapsed ? 'chevron-down' : 'chevron-up'}
          theme={theme}
          onPress={() => setCollapsed((value) => !value)}
        />
        <TableAction
          label="Copy as Markdown"
          text="MD"
          theme={theme}
          onPress={() => void Clipboard.setStringAsync(block.source)}
        />
        <TableAction
          label="Copy as CSV"
          text="CSV"
          theme={theme}
          onPress={() => void Clipboard.setStringAsync(tableCsv(block.source))}
        />
      </View>
    </View>
  );
  findDone();
  return table;
}

function TableAction({
  label,
  glyph,
  text,
  theme,
  onPress,
}: {
  label: string;
  glyph?: GlyphName;
  text?: string;
  theme: TranscriptTheme;
  onPress(): void;
}) {
  return (
    <Pressable
      hitSlop={4}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tableAction, pressed && { backgroundColor: theme.pressed }]}
    >
      {glyph !== undefined ? (
        <Glyph name={glyph} size={14} color={theme.muted} />
      ) : (
        <Text style={[styles.tableActionText, { color: theme.muted }]}>{text}</Text>
      )}
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

/**
 * Whether a list item (or the blocks of a quote) starts right to left: its first paragraph, heading or nested
 * list's first item says, as the web's `dir="auto"` does. An item that opens with code, a table or a picture
 * strip stays left to right.
 */
function blocksStartRightToLeft(blocks: readonly Block[]): boolean {
  const first = blocks[0];
  if (first === undefined) return false;
  if (first.t === 'p' || first.t === 'h') return startsRightToLeft(inlineText(first.c));
  if (first.t === 'list') return blocksStartRightToLeft(first.items[0]?.c ?? []);
  return false;
}

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
    const numerals: [number, string][] = [
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i'],
    ];
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

type BlockProps = {
  blocks: Block[];
  context: InlineContext;
  color: string;
  depth: number;
  listDepth: { ordered: number; bullet: number };
  /** The marker of the list item these blocks open, drawn by the first block's flow (`leadsFlow`). */
  lead?: ReactNode;
};

function Blocks({ blocks, context, color, depth, listDepth, lead }: BlockProps) {
  const { theme } = context;
  const markedStyle = useMarkedStyle();
  const markedEmoji = useMarkedEmoji();
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${depth}.${index}`;
        const spacing = index === 0 ? null : block.t === 'h' ? styles.headingGap : styles.blockGap;
        switch (block.t) {
          case 'p':
            if (block.c.some((inline) => inline.t === 'image')) {
              return (
                <View key={key} style={[spacing, styles.pictureLines]}>
                  {(context.strips ? pictureRuns(block.c) : [{ pictures: false, inlines: block.c }]).map((run, part) =>
                    run.pictures ? (
                      <PictureStrip
                        key={part}
                        images={run.inlines.flatMap((inline) => (inline.t === 'image' ? [inline.image] : []))}
                      />
                    ) : (
                      <FlowParagraph
                        key={part}
                        inlines={run.inlines}
                        context={context}
                        color={color}
                        lead={index === 0 && part === 0 ? lead : undefined}
                      />
                    ),
                  )}
                </View>
              );
            }
            return (
              <Text
                key={key}
                selectable={context.selectable}
                style={[styles.prose, { color }, spacing, startsRightToLeft(inlineText(block.c)) && RIGHT_TO_LEFT_TEXT]}
              >
                {renderInlines(block.c, context, key)}
              </Text>
            );
          case 'h':
            return (
              <Text
                key={key}
                selectable={context.selectable}
                accessibilityRole="header"
                style={[
                  styles.heading,
                  {
                    fontSize: HEADING_SIZES[block.level] ?? PROSE_SIZE,
                    lineHeight: (HEADING_SIZES[block.level] ?? PROSE_SIZE) * HEADING_LINE,
                  },
                  { color: block.level === 6 ? theme.muted : context.heading },
                  spacing,
                  styles.headingBottom,
                  startsRightToLeft(inlineText(block.c)) && RIGHT_TO_LEFT_TEXT,
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
          case 'visual':
            return (
              <View key={key} style={spacing}>
                <VisualBlock source={block.source} />
              </View>
            );
          case 'questions':
            return (
              <View key={key} style={spacing}>
                <QuestionForm id={block.id} source={block.source} />
              </View>
            );
          case 'answers':
            return (
              <View key={key} style={spacing}>
                <InlineAnswers mark={block.mark} />
              </View>
            );
          case 'hr':
            return <View key={key} style={[styles.rule, { backgroundColor: theme.border }, spacing]} />;
          case 'section':
            return (
              <View key={key} style={spacing}>
                <MarkedSection
                  meta={block.meta}
                  style={markedStyle}
                  emoji={markedEmoji}
                  theme={theme}
                  color={color}
                  selectable={context.selectable}
                  all={
                    <Blocks
                      blocks={block.all}
                      context={context}
                      color={color}
                      depth={depth + 1}
                      listDepth={listDepth}
                    />
                  }
                  rest={
                    block.rest.length > 0 ? (
                      <View style={styles.blockGap}>
                        <Blocks
                          blocks={block.rest}
                          context={context}
                          color={color}
                          depth={depth + 1}
                          listDepth={listDepth}
                        />
                      </View>
                    ) : null
                  }
                  label={renderInlines(block.label, context, `${key}.label`)}
                  first={
                    <Blocks
                      blocks={block.first}
                      context={context}
                      color={color}
                      depth={depth + 1}
                      listDepth={listDepth}
                    />
                  }
                />
              </View>
            );
          case 'quote':
            return (
              <View key={key} style={[styles.quote, { borderLeftColor: theme.border }, spacing]}>
                <Blocks
                  blocks={block.c}
                  context={context}
                  color={theme.muted}
                  depth={depth + 1}
                  listDepth={listDepth}
                />
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
                {block.items.map((item, itemIndex) => {
                  // An item that starts right to left keeps its bullet or number on the right (its words read
                  // right to left, desktop `dir="auto"`), unless it opens with a picture flow, which stays left.
                  const rtl = !leadsFlow(item.c[0], context.strips) && blocksStartRightToLeft(item.c);
                  const marker = (
                    <View style={[styles.listMarker, { width: gutter }, rtl && styles.listMarkerRtl]}>
                      {item.checked !== null ? (
                        <View
                          style={[
                            styles.checkbox,
                            { borderColor: theme.muted },
                            item.checked && { backgroundColor: theme.muted },
                          ]}
                        >
                          {item.checked ? (
                            <Glyph name="check" size={10} color={theme.background} strokeWidth={3} />
                          ) : null}
                        </View>
                      ) : (
                        <Text style={[styles.prose, { color: theme.muted }]}>
                          {block.ordered
                            ? orderedLabel(block.start + itemIndex, listDepth.ordered)
                            : BULLETS[listDepth.bullet % BULLETS.length]}
                        </Text>
                      )}
                    </View>
                  );
                  // A done task steps back so the open ones stand out, as on the desktop.
                  const itemColor = item.checked ? theme.muted : color;
                  if (leadsFlow(item.c[0], context.strips)) {
                    // Words and pictures flow in one row that centres them against the picture; the marker
                    // goes into that row before the words, not into a column of its own above them. The
                    // item's later blocks keep the list's indent.
                    const rest = item.c.slice(1);
                    return (
                      <View key={itemIndex} style={itemIndex > 0 && styles.listItemGap}>
                        <Blocks
                          blocks={item.c.slice(0, 1)}
                          context={context}
                          color={itemColor}
                          depth={depth + 1}
                          listDepth={nested}
                          lead={marker}
                        />
                        {rest.length > 0 ? (
                          <View
                            style={[rest[0]?.t === 'h' ? styles.headingGap : styles.blockGap, { paddingLeft: gutter }]}
                          >
                            <Blocks
                              blocks={rest}
                              context={context}
                              color={itemColor}
                              depth={depth + 1}
                              listDepth={nested}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  }
                  return (
                    <View
                      key={itemIndex}
                      style={[styles.listItem, rtl && styles.listItemRtl, itemIndex > 0 && styles.listItemGap]}
                    >
                      {marker}
                      <View style={styles.listBody}>
                        <Blocks
                          blocks={item.c}
                          context={context}
                          color={itemColor}
                          depth={depth + 1}
                          listDepth={nested}
                        />
                      </View>
                    </View>
                  );
                })}
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
  /** The headings' colour; defaults to the theme's `primary` (Grey thinking sets it, desktop `thinking_lane`). */
  headingColor?: string;
  /** The inline code colour; defaults to the theme's `primary` (Text strength sets it). */
  codeColor?: string;
  /** Text somebody typed: single newlines are line breaks. */
  breaks?: boolean;
  /** False on iOS for a message with a menu, whose native view selects its words (`messageSelection.tsx`). */
  selectable?: boolean;
  /** False in a sent prompt, whose pictures keep their small thumbnails instead of a filmstrip. */
  strips?: boolean;
};

export const Markdown = memo(function Markdown({
  text,
  references,
  color,
  headingColor,
  codeColor,
  breaks = false,
  selectable = true,
  strips = true,
}: MarkdownProps) {
  const { theme, dispatch } = useTranscriptEnv();
  const find = useRowFind();
  const issueLinkBase = useIssueLinkBase();
  const blocks = useMemo(() => parseMarkdown(text, { breaks }), [breaks, text]);
  const referencesMap = useMemo(() => referenceMap(references), [references]);
  const openLink = useCallback(
    (href: string) => dispatch({ type: 'openMarkdownLink', href, external: false }),
    [dispatch],
  );
  const context = useMemo<InlineContext>(
    () => ({
      theme,
      references: referencesMap,
      openLink,
      longPressLink: (href: string, mention?: MentionTarget) =>
        openTranscriptMenu(mention !== undefined ? { href, mention } : { href }),
      selectable,
      find,
      strips,
      heading: headingColor ?? theme.primary,
      inlineCode: codeColor ?? theme.primary,
      body: color ?? theme.prose,
      issueLinkBase,
    }),
    [codeColor, color, find, headingColor, issueLinkBase, openLink, referencesMap, selectable, strips, theme],
  );
  return (
    <View style={styles.root}>
      <Blocks
        blocks={blocks}
        context={context}
        color={color ?? theme.prose}
        depth={0}
        listDepth={{ ordered: 0, bullet: 0 }}
      />
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
  /** The swatch and the room after it (desktop `chip_edges`: the side and 45% more). */
  swatchBox: { width: SWATCH_SIDE + 5, height: SWATCH_SIDE, transform: [{ translateY: 1.5 }] },
  swatch: {
    width: SWATCH_SIDE,
    height: SWATCH_SIDE,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.45)',
  },
  questionTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: QUESTION_TAGS.gap,
    paddingHorizontal: QUESTION_TAGS.paddingX,
    borderWidth: 1,
    borderRadius: QUESTION_TAGS.radius,
    transform: [{ translateY: 4 }],
  },
  questionTagLabel: { fontSize: PROSE_SIZE - 1, lineHeight: PROSE_SIZE + 4, fontWeight: '600' },
  flow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  // A list item's marker and its first words, one item of the flow that may shrink and wrap inside the bubble.
  flowLead: { flexDirection: 'row', flexShrink: 1, minWidth: 0 },
  flowLeadWords: { flexShrink: 1 },
  pictureLines: { gap: 6 },
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
  // A right-to-left item: the marker first from the right edge, and the item's own text reads from there.
  listItemRtl: { flexDirection: 'row-reverse' },
  listMarkerRtl: { alignItems: 'flex-end' },
  // A content-sized user bubble needs the body's intrinsic width, not `flex: 1`'s zero basis.
  // Grow still fills an answer's row; shrink keeps long prompts inside their bubble.
  listBody: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  checkbox: {
    width: 13,
    height: 13,
    borderWidth: 1,
    borderRadius: 3,
    marginTop: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  tableMeasure: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 10000,
    flexDirection: 'row',
    alignItems: 'flex-start',
    opacity: 0,
  },
  tableMeasureColumn: { alignItems: 'flex-start' },
  tableCell: { paddingHorizontal: CELL_PAD_X, paddingVertical: 7 },
  tableText: { fontSize: PROSE_SIZE, lineHeight: 20 },
  right: { alignItems: 'flex-end' },
  center: { alignItems: 'center' },
  tableActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 2 },
  tableAction: {
    minWidth: 26,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableActionText: { fontSize: 11, fontWeight: '600' },
});
