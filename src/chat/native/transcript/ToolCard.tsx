/**
 * The tool-call card (Settings > Chat > Tool call cards), the phone's drawing of desktop
 * `native_chat/tool_card.rs`: one rounded card per burst of tool calls, its header stacking the
 * tools' icons as overlapping round tiles with "Using N tools" / "Used N tools", the failures and
 * the burst's time, and a row per call in the call's own tense with its result and time, a shimmer
 * on the running row and a spinner, check or mark beside it. What every row says, which rows the
 * card holds, what its folded header says while calls run and when it opens are decided in
 * gx-chat-core `transcript/tool_card.rs` (the user's decisions are there); this file only lays the
 * card out and moves it.
 */

import { createContext, memo, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop, SvgXml } from 'react-native-svg';

import type { ProjectedMessage } from '../../rust/document';
import { useNativeChatUi, useRowDetail, useTranscriptEnv } from './context';
import { DisclosureBody } from './Disclosure';
import { Counts, FileChangeDiff, palette } from './FileChanges';
import { Glyph, toolGlyph } from './icons';
import { ReadImages } from './Images';
import { arr, num, obj, str, type JsonRecord } from './json';
import { useDisclosure } from './state';
import type { TranscriptTheme } from './theme';
import { SINGLE_LINE_CARD, SINGLE_LINE_HEADER_HEIGHT, singleLineShell } from './singleLineCard';
import { ToolBody } from './ToolBody';

/** How long a row takes to grow in and the header's words to settle (desktop `ENTER`). */
const ENTER_MS = 320;
/** One sweep of the running row's shimmer (desktop `SHIMMER`). */
const SHIMMER_MS = 1400;
/** How many lines of a tool's output Tool call lines show before "Show all N lines". */
export const LINE_OUTPUT_LINES = 12;
/** The header's round tiles, how far each overlaps the one before it, and the ring around each. */
const STACK_ICON = 22;
const STACK_OVERLAP = 7;
const STACK_RING = 2;
const ROW_ICON = 18;

/** `#rrggbb` mixed toward `toward` by `amount` (0 to 1); other spellings come back unchanged. */
function mix(hex: string, toward: string, amount: number): string {
  const parse = (value: string) =>
    /^#[0-9a-f]{6}$/i.test(value) ? [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) : null;
  const from = parse(hex);
  const to = parse(toward);
  if (from === null || to === null) return hex;
  return `#${from
    .map((channel, index) => Math.round(channel + (to[index]! - channel) * amount).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** A finished call's check (desktop `ChatAppearance::success`). */
function successTone(light: boolean): string {
  return light ? '#059669' : '#34d399';
}

/**
 * The card's surface, its border, and the opaque fill of the header's round tiles. A boxed card's
 * surface is the one-line cards' faint wash over the chat, made opaque for the tiles' rings.
 */
function cardColors(theme: TranscriptTheme, boxed = false) {
  const colors = palette(theme);
  const surface = boxed ? mix(theme.background, theme.foreground, 0.025) : theme.input;
  return {
    surface,
    border: colors.border,
    hairline: colors.hairline,
    disc: mix(surface, theme.light ? '#000000' : '#ffffff', theme.light ? 0.1 : 0.13),
  };
}

/** A tool's icon: its app's logo in white on the app's colour, or its glyph. */
function ToolIcon({ icon, size, round }: { icon: JsonRecord; size: number; round: boolean }) {
  const { theme } = useTranscriptEnv();
  const { toolAppLogo } = useNativeChatUi();
  const app = str(icon, 'app');
  const color = str(icon, 'appColor');
  const logo = app.length > 0 ? toolAppLogo(app) : null;
  const tile = { width: size, height: size, borderRadius: round ? size / 2 : 5 };
  if (logo !== null && color.length > 0) {
    const glyph = Math.round(size * (round ? 0.5 : 0.58));
    return (
      <View style={[styles.tile, tile, { backgroundColor: color }]}>
        <SvgXml xml={logo} width={glyph} height={glyph} color="#ffffff" fill="#ffffff" />
      </View>
    );
  }
  return (
    <View style={[styles.tile, tile]}>
      <Glyph
        name={toolGlyph(str(icon, 'glyph'))}
        size={Math.round(size * (round ? 0.5 : 0.8))}
        color={round ? theme.ink(0.75) : theme.muted}
      />
    </View>
  );
}

/**
 * Inside an opened Quiet View line (`quietView.tsx`): the card wears the "Message to …" card's
 * shell (`singleLineShell`), Tool call lines or not.
 *
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User, of the tool call row in an opened Quiet View line above a "Message to" card: "for the tool
 * calls, make it a card, not without a card, like this, just like we have for the message to card
 * there." The desktop still draws Tool call lines without a card there.
 */
export const BoxedToolCards = createContext(false);

/** The card for `message.toolCard`. */
export function ToolCard({ message }: { message: ProjectedMessage }) {
  const { theme, workOpen, toolLines } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const boxed = useContext(BoxedToolCards);
  const card = obj(message.toolCard);
  const running = card?.running === true;
  const live = message.toolCardLive === true;
  // Tool call lines (`chatToolCallLines`): the card's header without its box, and its calls as rows
  // on the rail under it; they open in Detailed view and stay shut in Simple (gx-chat-core
  // `tool_card.rs`, CDXC:SessionChat 2026-11-09).
  const line = toolLines === true && !boxed;
  // One line until the reader opens it; a call waiting on an approval opens it (`waiting`).
  // While calls run the header carries the newest one's words (the core's `liveLabel`).
  const [open, toggle] = useDisclosure(
    disclosures,
    `tool-card:${message.id}`,
    card?.waiting === true || (line && workOpen),
  );
  if (card === null) return null;
  const animate = running || live;
  const colors = cardColors(theme, boxed);
  const entries = arr(card.entries)
    .map((entry) => obj(entry))
    .filter((entry): entry is JsonRecord => entry !== null);
  const liveLabel = str(card, 'liveLabel');
  const liveMore = str(card, 'liveMore');
  const title = liveLabel.length > 0 ? liveLabel : str(card, line ? 'lineTitle' : 'title');
  // A line has no box: its circles are cut out of the chat's own background.
  const ring = line ? theme.background : colors.surface;
  const failed = str(card, 'failedLabel');
  const time = str(card, 'time');
  const more = num(card, 'moreIcons') ?? 0;
  const icons = arr(card.icons)
    .map((icon) => obj(icon))
    .filter((icon): icon is JsonRecord => icon !== null);
  return (
    <Animated.View
      layout={LinearTransition.duration(ENTER_MS)}
      style={
        line
          ? styles.line
          : boxed
            ? [styles.card, singleLineShell(theme)]
            : [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]
      }
    >
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={[title, liveMore, failed, time].filter((part) => part.length > 0).join(', ')}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          line ? styles.lineHeader : styles.header,
          boxed && styles.boxedHeader,
          pressed && { backgroundColor: theme.pressed },
        ]}
      >
        <View style={styles.stack}>
          {icons.map((icon, index) => (
            <StackTile key={index} index={index} animate={animate} ring={ring} disc={colors.disc}>
              <ToolIcon icon={icon} size={STACK_ICON - STACK_RING * 2} round />
            </StackTile>
          ))}
          {more > 0 ? (
            <StackTile index={icons.length} animate={animate} ring={ring} disc={colors.disc}>
              <Text style={[styles.more, { color: theme.ink(0.75) }]}>{`+${more}`}</Text>
            </StackTile>
          ) : null}
        </View>
        {/* The header's words settle into their next value while the card is live; the running
            call's words take the row's shimmer. */}
        <View style={styles.titleBox}>
          <Animated.Text
            key={animate ? title : 'title'}
            entering={animate ? FadeIn.duration(ENTER_MS) : undefined}
            numberOfLines={1}
            style={[styles.title, { color: theme.muted }]}
          >
            {title}
          </Animated.Text>
          {liveLabel.length > 0 && animate ? <Shimmer color={theme.light ? '#000000' : '#ffffff'} /> : null}
        </View>
        <View style={styles.spacer} />
        {failed.length > 0 ? <Text style={[styles.meta, { color: theme.error }]}>{failed}</Text> : null}
        {failed.length > 0 && time.length > 0 ? <Text style={[styles.meta, { color: theme.muted }]}>·</Text> : null}
        {time.length > 0 ? <Text style={[styles.meta, { color: theme.muted }]}>{time}</Text> : null}
        {/* The card's other calls beside the live line ("+2 more"), and the running call's spinner. */}
        {liveMore.length > 0 ? <Text style={[styles.meta, { color: theme.muted }]}>{liveMore}</Text> : null}
        {liveLabel.length > 0 ? (
          <View style={styles.status}>
            <ActivityIndicator size="small" color={theme.muted} style={styles.spinner} />
          </View>
        ) : null}
        <Glyph name={open ? 'chevron-up' : 'chevron-down'} size={12} color={theme.muted} />
      </Pressable>
      {open ? (
        <Animated.View
          entering={FadeIn.duration(ENTER_MS)}
          style={line ? [styles.lineRows, { borderLeftColor: colors.border }] : [styles.rows, { borderTopColor: colors.hairline }]}
        >
          {entries.map((entry, position) => (
            <CardRow key={position} message={message} entry={entry} animate={animate} />
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** One round tile of the header's stack, overlapping the one before it and sliding out from behind it. */
function StackTile({
  index,
  animate,
  ring,
  disc,
  children,
}: {
  index: number;
  animate: boolean;
  ring: string;
  disc: string;
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      entering={animate ? FadeIn.duration(ENTER_MS) : undefined}
      style={[
        styles.stackTile,
        { backgroundColor: disc, borderColor: ring, zIndex: index + 1 },
        index > 0 && { marginLeft: -STACK_OVERLAP },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A band of light sweeping across the running row's text (desktop `shimmer_text`). React Native
 * cannot clip a gradient to glyphs without a masked view, so the band passes over the line, faint
 * enough that it reads as light on the muted text.
 */
export function Shimmer({ color }: { color: string }) {
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: SHIMMER_MS, easing: Easing.linear }), -1, false);
  }, [progress]);
  const band = Math.max(40, width * 0.35);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -band + progress.value * (width + band) }] }));
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View style={[styles.shimmerBand, { width: band }, style]}>
          <Svg width={band} height="100%">
            <Defs>
              {/* Radial, so the band fades out at its top and bottom too and never shows as a box. */}
              <RadialGradient id="toolCardShimmer" cx="0.5" cy="0.5" rx="0.5" ry="0.5">
                <Stop offset="0" stopColor={color} stopOpacity={0.22} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width={band} height="100%" fill="url(#toolCardShimmer)" />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

const CardRow = memo(function CardRow({
  message,
  entry,
  animate,
}: {
  message: ProjectedMessage;
  entry: JsonRecord;
  animate: boolean;
}) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const kind = str(entry, 'kind');
  const index = num(entry, 'index') ?? 0;
  const source = obj(arr(kind === 'file' ? message.files : message.tools)[index]) ?? {};
  const key = kind === 'file' ? `file:${message.id}:${index}` : `tool:${message.id}:${index}`;
  const hasDetail = kind === 'file' || source.hasDetail === true;
  const [openState, toggle] = useDisclosure(disclosures, key);
  const open = hasDetail && openState;
  const status = str(entry, 'status');
  const label = str(entry, 'label');
  const reason = str(entry, 'reason');
  const result = str(entry, 'result');
  const time = str(entry, 'time');
  const added = num(entry, 'added');
  const removed = num(entry, 'removed');
  const failed = status === 'failed';
  const running = status === 'running';
  const labelColor = failed ? theme.error : status === 'stopped' ? theme.muted : running ? theme.muted : theme.foreground;
  const parts: React.ReactNode[] = [];
  if (added !== null && removed !== null) parts.push(<Counts key="counts" added={added} removed={removed} />);
  else if (result.length > 0) {
    parts.push(
      <Text key="result" style={[styles.meta, { color: failed ? theme.error : theme.muted }]}>
        {result}
      </Text>,
    );
  }
  if (time.length > 0) {
    if (parts.length > 0) {
      parts.push(
        <Text key="dot" style={[styles.meta, { color: theme.muted }]}>
          ·
        </Text>,
      );
    }
    parts.push(
      <Text key="time" style={[styles.meta, { color: theme.muted }]}>
        {time}
      </Text>,
    );
  }
  const statusIcon =
    status === 'running' ? (
      <ActivityIndicator size="small" color={theme.muted} style={styles.spinner} />
    ) : status === 'waiting' ? (
      <Glyph name="clock" size={13} color={theme.controlPrimary} />
    ) : failed ? (
      <Glyph name="alert-octagon" size={14} color={theme.error} />
    ) : status === 'stopped' ? (
      <Glyph name="x" size={13} color={theme.muted} />
    ) : (
      <Glyph name="check" size={14} color={successTone(theme.light)} />
    );
  return (
    <Animated.View entering={animate ? FadeInUp.duration(ENTER_MS) : undefined} style={styles.rowColumn}>
      <Pressable
        disabled={!hasDetail}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={[label, reason].filter((part) => part.length > 0).join(': ')}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.pressed }]}
      >
        <ToolIcon icon={entry} size={ROW_ICON} round={false} />
        <View style={styles.body}>
          {/* The band is as wide as the words, so it sweeps the text and not the empty row. */}
          <View style={styles.labelBox}>
            <Text numberOfLines={1} style={[styles.label, { color: labelColor }]}>
              {label}
            </Text>
            {running && animate ? <Shimmer color={theme.light ? '#000000' : '#ffffff'} /> : null}
          </View>
          {reason.length > 0 ? (
            <Text numberOfLines={1} style={[styles.reason, { color: theme.muted }]}>
              {reason}
            </Text>
          ) : null}
        </View>
        {parts.length > 0 ? <View style={styles.metaLine}>{parts}</View> : null}
        <View style={styles.status}>{statusIcon}</View>
      </Pressable>
      {/* The picture the call opened from disk, under its label (gx-chat-core `read_images.rs`). */}
      {entry.images !== undefined ? (
        <View style={styles.readImages}>
          <ReadImages images={entry.images} inset={8 + ROW_ICON + 9} />
        </View>
      ) : null}
      {open ? (
        kind === 'file' ? (
          <FileChangeDiff rowKey={key} file={source} colors={palette(theme)} />
        ) : (
          <CardToolDetail rowKey={key} messageId={message.id} index={index} tool={source} onCollapse={toggle} />
        )
      ) : null}
    </Animated.View>
  );
});

/** The button under a long output Tool call lines cut short: "Show all 300 lines". */
export function ShowAllLines({ count, onPress }: { count: number; onPress(): void }) {
  const { theme } = useTranscriptEnv();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Show all ${count} lines`}
      style={({ pressed }) => [styles.showAll, { borderColor: theme.ink(0.14) }, pressed && { backgroundColor: theme.pressed }]}
    >
      <Text style={[styles.showAllText, { color: theme.foreground }]}>{`Show all ${count} lines`}</Text>
    </Pressable>
  );
}

/** An open call's command or arguments and its result (desktop `tool_detail_body`). */
function CardToolDetail({
  rowKey,
  messageId,
  index,
  tool,
  onCollapse,
}: {
  rowKey: string;
  messageId: string;
  index: number;
  tool: JsonRecord;
  onCollapse(): void;
}) {
  const { toolLines } = useTranscriptEnv();
  const [showAll, setShowAll] = useState(false);
  const detail = obj(useRowDetail(rowKey, 'tool', messageId, index, true));
  if (detail === null) return null;
  const input = str(detail, 'input');
  const fullOutput = str(detail, 'output');
  // Tool call lines show a long output's first lines and a button for the rest (desktop
  // `LINE_OUTPUT_LINES`, Q1962 in gx-chat-core `tool_card.rs`).
  const outputLines = fullOutput.split('\n');
  const capped = toolLines === true && !showAll && outputLines.length > LINE_OUTPUT_LINES;
  const output = capped ? outputLines.slice(0, LINE_OUTPUT_LINES).join('\n') : fullOutput;
  const copyText = str(detail, 'copyText');
  const command = tool.glyph === 'terminal';
  const parts = [];
  if (input.length > 0) {
    parts.push(
      <ToolBody
        key="input"
        label={command ? 'Command' : output.length > 0 ? 'Input' : null}
        content={input}
        failed={false}
        copyText={copyText}
      />,
    );
  }
  if (output.length > 0) {
    parts.push(
      <ToolBody
        key="output"
        label={tool.hasCall === true ? 'Result' : null}
        content={output}
        failed={tool.failed === true}
        copyText={parts.length === 0 ? copyText : ''}
      />,
    );
    if (capped) {
      parts.push(<ShowAllLines key="show-all" count={outputLines.length} onPress={() => setShowAll(true)} />);
    }
  }
  if (parts.length === 0) return null;
  return (
    <View style={styles.detail}>
      <DisclosureBody onCollapse={onCollapse} label={`Collapse ${str(tool, 'name')}`} rail="tool">
        {parts}
      </DisclosureBody>
    </View>
  );
}

const styles = StyleSheet.create({
  // The one-line cards' border and header height ("Message to …", "Worked for 12s"), so a folded
  // tool card beside one of them is the same 44pt (desktop `tool_card.rs`, CDXC:SessionChat 2026-11-08).
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', minWidth: 0 },
  // Tool call lines: a tool row's height with no box, and the rail its rows hang from (desktop
  // `LINE_HEIGHT`, `LINE_RAIL_INSET`, `LINE_RAIL_GAP`).
  line: { minWidth: 0 },
  lineHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, height: 34, borderRadius: 8, minWidth: 0 },
  lineRows: { marginTop: 2, marginLeft: 18, paddingLeft: 8, borderLeftWidth: StyleSheet.hairlineWidth, gap: 1 },
  showAll: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  showAllText: { fontSize: 12 },
  // The "Message to …" card's side padding (`SINGLE_LINE_CARD.paddingX`).
  boxedHeader: { paddingHorizontal: SINGLE_LINE_CARD.paddingX },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    height: SINGLE_LINE_HEADER_HEIGHT,
    minWidth: 0,
  },
  stack: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  stackTile: {
    width: STACK_ICON,
    height: STACK_ICON,
    borderRadius: STACK_ICON / 2,
    borderWidth: STACK_RING,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  more: { fontSize: 9.5, fontWeight: '500' },
  titleBox: { flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  title: { fontSize: 13.5, flexShrink: 1, minWidth: 0 },
  spacer: { flexGrow: 1 },
  meta: { fontSize: 12, flexShrink: 0, fontVariant: ['tabular-nums'] },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, padding: 4, gap: 1 },
  rowColumn: { minWidth: 0 },
  readImages: { paddingBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 34,
    borderRadius: 8,
    minWidth: 0,
  },
  body: { flex: 1, minWidth: 0 },
  labelBox: { alignSelf: 'flex-start', maxWidth: '100%', overflow: 'hidden' },
  label: { fontSize: 13.5, lineHeight: 19 },
  reason: { fontSize: 12, lineHeight: 16 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  status: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  spinner: { transform: [{ scale: 0.7 }] },
  shimmerBand: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  detail: { paddingLeft: 4, paddingBottom: 4 },
});
