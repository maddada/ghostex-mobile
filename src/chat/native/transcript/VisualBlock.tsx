/**
 * A ```visual block in the transcript: the chart, stats, table or text layout the core lays out
 * (`renderVisual`, the same scene desktop paints in `native_chat/visual.rs`), drawn here as SVG, or
 * a page card (`PageCard.tsx`) for a published HTML page.
 *
 * CDXC:SessionChat 2026-10-06 SEE-ALSO:
 * The layout is packages/gx-visual (reached through the core's `renderVisual` query); desktop and the
 * web build paint the same scene in apps/desktop/src/app/native_chat/visual.rs. Change them together.
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';

import { useOptionalNativeChatUi, useTranscriptEnv } from './context';
import { Glyph } from './icons';
import { PageCard } from './PageCard';
import { chartId } from './chartId';
import { QuestionFlashFrame } from './OpenQuestions';
import { arr, num, obj, str, type JsonRecord } from './json';
import { MONO_FONT, PROSE_SIZE, type TranscriptTheme } from './theme';

const PADDING = 12;
/** `packages/gx-chat-core/visual/chart-motion.json`: how long a chart takes to draw in. */
const DRAW_IN_MS = 1000;
/** Frames the core lays out ahead for a draw-in, played back by time. */
const DRAW_IN_FRAMES = 24;
/** Draw-in frames that arrive later than this would read as a glitch: the chart stays finished. */
const DRAW_IN_LATE_MS = 250;

/**
 * The charts (by source) already drawn in during this run of the app. A chart draws in the first
 * time it is shown and never again: not when its row scrolls back into the list, which unmounts
 * rows, nor in a session the reader comes back to.
 * CDXC:SessionChat 2026-10-08 SEE-ALSO: `packages/gx-visual/src/motion.rs` holds the motion and the
 * user decision; the desktop draws the same frames in `apps/desktop/src/app/native_chat/visual.rs`.
 */
const DRAWN_IN = new Set<string>();
const TOOLTIP_WIDTH = 240;
/** A tooltip line: the transcript's prose size plus its leading. */
const TOOLTIP_LINE = Math.round(PROSE_SIZE * 1.4);

type TooltipLine = { label: string; value: string; color: string };
/** `shape` is a pie slice's outline: a tap is matched to the slice it lands in, not its box. */
type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: TooltipLine[];
  shape: [number, number][] | null;
};

function insidePolygon(points: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [px, py] = points[index]!;
    const [qx, qy] = points[previous]!;
    if (py > y !== qy > y && x < ((qx - px) * (y - py)) / (qy - py) + px) inside = !inside;
  }
  return inside;
}

function hexColor(color: string): string | undefined {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

/** The chat's own colours for the scene's text and lines; the series palette stays the crate's. */
function visualTheme(theme: TranscriptTheme): JsonRecord {
  // The scene's text is drawn at the transcript's prose size (desktop `visual.rs` `theme`).
  const entries: JsonRecord = { light: theme.light, textSize: PROSE_SIZE };
  const set = (key: string, color: string) => {
    const value = hexColor(color);
    if (value !== undefined) entries[key] = value;
  };
  set('foreground', theme.prose);
  set('muted', theme.muted);
  set('border', theme.border);
  set('background', theme.input);
  return entries;
}

function regions(answer: JsonRecord | null): Region[] {
  return arr(answer?.regions).flatMap((entry) => {
    const region = obj(entry);
    const x = num(region, 'x');
    const y = num(region, 'y');
    const width = num(region, 'width');
    const height = num(region, 'height');
    if (region === null || x === null || y === null || width === null || height === null) return [];
    const lines = arr(region.lines).map((line) => ({
      label: str(line, 'label'),
      value: str(line, 'value'),
      color: str(line, 'color'),
    }));
    const points = arr(region.shape).flatMap((point) => {
      const pair = arr(point);
      return typeof pair[0] === 'number' && typeof pair[1] === 'number' ? [[pair[0], pair[1]] as [number, number]] : [];
    });
    return [{ x, y, width, height, lines, shape: points.length >= 3 ? points : null }];
  });
}

export function VisualBlock({ source }: { source: string }) {
  const { theme } = useTranscriptEnv();
  const ui = useOptionalNativeChatUi();
  const [width, setWidth] = useState(0);
  const [showSource, setShowSource] = useState(false);
  const [active, setActive] = useState<{ region: number; x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const scheme = useMemo(() => visualTheme(theme), [theme]);
  const answer = useMemo(
    () => (ui !== null && width > 0 ? ui.renderVisual(source, width, scheme) : null),
    [scheme, source, ui, width],
  );
  const kind = str(answer, 'kind');
  const hits = useMemo(() => regions(answer), [answer]);
  const reduceMotion = useReducedMotion();
  const moves = kind === 'drawing' && answer?.motion === true;
  const [frame, setFrame] = useState<string | null>(null);
  // Read through a ref: `ui` changes whenever a late core answer arrives, and that must not
  // end a draw-in that is running.
  const uiRef = useRef(ui);
  uiRef.current = ui;
  useEffect(() => {
    const current = uiRef.current;
    // Checked here rather than in the dependencies: marking the chart drawn must not end its own run.
    if (!moves || reduceMotion || current === null || DRAWN_IN.has(source)) return;
    DRAWN_IN.add(source);
    const started = Date.now();
    let request = 0;
    let cancelled = false;
    const play = (frameAt: (progress: number) => string | null) => {
      const step = () => {
        const progress = (Date.now() - started) / DRAW_IN_MS;
        if (progress >= 1) {
          setFrame(null);
          return;
        }
        setFrame(frameAt(progress));
        request = requestAnimationFrame(step);
      };
      step();
    };
    // The core answers a moment later, so the frames are asked for together and played back by time.
    const steps = Array.from({ length: DRAW_IN_FRAMES }, (_, index) => index / DRAW_IN_FRAMES);
    void Promise.all(steps.map((progress) => current.renderVisualAsync(source, width, scheme, progress))).then(
      (answers) => {
        if (cancelled || Date.now() - started > DRAW_IN_LATE_MS) return;
        const frames = answers.map((answer) => str(answer, 'svg') || null);
        play((progress) => frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))] ?? null);
      },
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(request);
      setFrame(null);
    };
  }, [moves, reduceMotion, scheme, source, width]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const inner = Math.round(event.nativeEvent.layout.width - PADDING * 2);
    setWidth((current) => (Math.abs(current - inner) >= 4 ? inner : current));
  }, []);
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [source]);
  const onPress = useCallback(
    (event: GestureResponderEvent) => {
      const { locationX, locationY } = event.nativeEvent;
      const hit = hits.findIndex(
        (region) =>
          locationX >= region.x &&
          locationX <= region.x + region.width &&
          locationY >= region.y &&
          locationY <= region.y + region.height &&
          (region.shape === null || insidePolygon(region.shape, locationX, locationY)),
      );
      setActive(hit >= 0 && hit !== active?.region ? { region: hit, x: locationX, y: locationY } : null);
    },
    [active, hits],
  );

  if (kind === 'page') {
    return <PageCard answer={answer} onLayout={onLayout} />;
  }

  const drawing = kind === 'drawing' && !showSource;
  const height = num(answer, 'height') ?? 0;
  const tip = active !== null ? hits[active.region] : undefined;
  // Beside the tap, flipped to the other side near the drawing's edge (desktop `visual.rs` `tooltip`).
  const tipHeight = tip === undefined ? 0 : tip.lines.length * TOOLTIP_LINE + 16;
  const tipLeft =
    active === null
      ? 0
      : active.x + 12 + TOOLTIP_WIDTH <= width
        ? active.x + 12
        : Math.max(0, active.x - 12 - TOOLTIP_WIDTH);
  const tipTop =
    active === null ? 0 : active.y + 12 + tipHeight <= height ? active.y + 12 : Math.max(0, active.y - 12 - tipHeight);
  // A jump from the ? pill's list flashes the chart it named (`chartId`).
  return (
    <QuestionFlashFrame target={chartId(source)} light={theme.light}>
      <View style={[styles.card, { backgroundColor: theme.input, borderColor: theme.border }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <View style={styles.title}>
            <Glyph name="chart-bar" size={13} color={theme.muted} />
            <Text numberOfLines={1} style={[styles.headerText, { color: theme.muted }]}>
              {str(answer, 'title') || 'visual'}
            </Text>
          </View>
          <View style={styles.actions}>
            {kind === 'drawing' ? (
              <Pressable
                style={styles.action}
                onPress={() => setShowSource((value) => !value)}
                accessibilityRole="button"
              >
                <Text style={[styles.actionText, { color: theme.muted }]}>{showSource ? 'Chart' : 'Source'}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.action} onPress={copy} accessibilityRole="button" accessibilityLabel="Copy source">
              <Glyph name={copied ? 'check' : 'copy'} size={14} color={theme.muted} />
            </Pressable>
          </View>
        </View>
        <View style={styles.body} onLayout={onLayout}>
          {drawing ? (
            <Pressable onPress={onPress} style={{ width, height }}>
              <SvgXml xml={frame ?? str(answer, 'svg')} width={width} height={height} />
              {tip !== undefined && tip.lines.length > 0 ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.tooltip,
                    {
                      left: tipLeft,
                      top: tipTop,
                      backgroundColor: theme.light ? '#ffffff' : '#1f1f23',
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {tip.lines.map((line, index) => (
                    <View key={index} style={styles.tooltipLine}>
                      {line.color.length > 0 ? <View style={[styles.swatch, { backgroundColor: line.color }]} /> : null}
                      {line.label.length > 0 ? (
                        <Text style={[styles.tooltipText, { color: theme.muted }]}>{line.label}</Text>
                      ) : null}
                      <Text numberOfLines={1} style={[styles.tooltipText, styles.tooltipValue, { color: theme.prose }]}>
                        {line.value}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Pressable>
          ) : (
            <View>
              {kind === 'error' ? (
                <Text style={[styles.note, { color: theme.muted }]}>{str(answer, 'message')}</Text>
              ) : null}
              <Text selectable style={[styles.source, { color: theme.prose }]}>
                {source}
              </Text>
            </View>
          )}
        </View>
      </View>
    </QuestionFlashFrame>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  header: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
    borderBottomWidth: 1,
  },
  title: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, minWidth: 0 },
  headerText: { fontSize: PROSE_SIZE, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  action: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 5,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: 11, fontWeight: '500' },
  body: { padding: PADDING },
  note: { fontSize: PROSE_SIZE, marginBottom: 8 },
  source: { fontFamily: MONO_FONT, fontSize: 12, lineHeight: 19 },
  tooltip: {
    position: 'absolute',
    maxWidth: TOOLTIP_WIDTH,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
  },
  tooltipLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  tooltipText: { fontSize: PROSE_SIZE },
  tooltipValue: { fontWeight: '500', flexShrink: 1 },
});
