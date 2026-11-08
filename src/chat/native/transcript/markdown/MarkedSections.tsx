/**
 * Marked sections in an agent's reply: each section drawn in its kind's colour, in the style picked
 * in Settings > Chat. The core finds the sections (`packages/gx-chat-core/src/transcript/marked_sections.rs`);
 * this file only draws them.
 *
 * CDXC:MarkedHandovers 2026-10-11 DECISION:
 * User picked three styles from the mockups (docs/2026-10-11/chat-section-markers/index.html in the Ghostex repo): A, a thin left rule in the kind's colour with the emoji kept; C, a coloured badge naming the kind in place of the emoji, dropping a bold label that only repeats it; D, the emoji kept and the label coloured, the default. The phone cannot read the computer's Marked handovers switch, so its own Settings > Chat entry picks the style and adds Plain text for no colouring. Supersedes the same day's summary strip at the top of the message (user: "let's actually just remove the summary at the top i don't think it's useful at all").
 *
 * CDXC:MarkedHandovers 2026-10-11 DECISION:
 * User: "add a toggle for emojis in the colorful handover please. and set it to off by default. and if enabled add emojis to all 3." Show marker emojis (Settings > Chat > Marked sections, off by default): off, no style shows the marker emoji and the colour and label carry the kind (a section with no label of its own shows the kind's name as its coloured label); on, all three show it, the badge style before its badge.
 * SEE-ALSO: apps/desktop/src/app/native_chat/marked_look.rs in the Ghostex repo (the desktop look and the same palette).
 *
 * The kind's colour is drawn at the computer's Handover heading color strength, which the chat core sends as the
 * document's `markedHeadingStrength` (CDXC:MarkedHandovers 2026-10-20 in packages/gx-chat-core/src/transcript/marked_sections.rs in the Ghostex repo).
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSettingsStore, type MarkedHandoversStyle } from '../../../../settings/store';
import { useTranscriptFlags } from '../context';
import { PROSE_LINE, PROSE_SIZE, type TranscriptTheme } from '../theme';
import type { SectionMeta } from './parse';

/**
 * CDXC:MarkedHandovers 2026-11-06 DECISION:
 * User: "please make in progress color in handover headings #C68A06 like Moving is in the board". The "In progress" heading takes the board's Moving amber in both appearances (the board uses this one colour on dark and light); it replaces the earlier #00A6ED / #0077B6 pick of 2026-10-11.
 */
const IN_PROGRESS = { dark: '#c68a06', light: '#c68a06' };

/**
 * CDXC:MarkedHandovers 2026-11-08 DECISION:
 * User: "please make Needs you pinkish color in the handover section headings, and make blocked red". "Needs you" takes the sidebar's pink question dot (#f472b6) and "Blocked" its red dot (#ef4444) on the dark chat; the light chat keeps a darker shade of each so the text stays readable on white. Same values as the desktop (apps/desktop/src/app/native_chat/marked_look.rs).
 */
const NEED = { dark: '#f472b6', light: '#be185d' };
const BLOCKED = { dark: '#ef4444', light: '#dc2626' };

const PALETTE: { [kind: string]: { dark: string; light: string } } = {
  need: NEED,
  done: { dark: '#4ade80', light: '#15803d' },
  read: { dark: '#fbbf24', light: '#b45309' },
  kicked: { dark: '#f472b6', light: '#be185d' },
  progress: IN_PROGRESS,
  untested: { dark: '#2dd4bf', light: '#0f766e' },
  shipped: { dark: '#818cf8', light: '#4f46e5' },
  blocked: BLOCKED,
  comms: { dark: '#a3e635', light: '#4d7c0f' },
  parked: { dark: '#94a3b8', light: '#475569' },
  held: { dark: '#d6a77a', light: '#92400e' },
  suggestions: { dark: '#c084fc', light: '#7e22ce' },
};

export function kindColor(kind: string, light: boolean): string {
  const entry = PALETTE[kind];
  if (entry === undefined) return light ? '#71717b' : '#9e9e9e';
  return light ? entry.light : entry.dark;
}

/** Reads `#rrggbb` as channels 0 to 255; `null` for anything else. */
function channels(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const at = (index: number) => parseInt(hex.slice(index, index + 2), 16);
  return [at(1), at(3), at(5)];
}

/**
 * `palette` drawn at `strength` (0 to 1): blended in sRGB toward the text colour, so 1 is the palette itself and
 * 0 the plain text colour; the same blend as `blend_strength` in the desktop's marked_look.rs. Both are opaque
 * `#rrggbb`, so the result is too and `withAlpha` can tint it.
 */
export function blendStrength(palette: string, text: string, strength: number): string {
  if (strength >= 1) return palette;
  const to = channels(palette);
  const from = channels(text);
  if (to === null || from === null) return palette;
  const t = Math.max(strength, 0);
  const mix = (index: number) => from[index] + (to[index] - from[index]) * t;
  const byte = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  return `#${byte(mix(0))}${byte(mix(1))}${byte(mix(2))}`;
}

/** `#rrggbb` at `alpha`, as `#rrggbbaa`. */
function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

function tint(theme: TranscriptTheme): { fill: number; edge: number } {
  return theme.light ? { fill: 0.07, edge: 0.28 } : { fill: 0.11, edge: 0.3 };
}

export function useMarkedStyle(): MarkedHandoversStyle {
  return useSettingsStore((store) => store.settings.markedHandoversStyle);
}

export function useMarkedEmoji(): boolean {
  return useSettingsStore((store) => store.settings.markedHandoversEmoji);
}

type SectionProps = {
  meta: SectionMeta;
  style: MarkedHandoversStyle;
  /** Show the marker emoji (Show marker emojis). */
  emoji: boolean;
  theme: TranscriptTheme;
  color: string;
  /** Every line of the section drawn as written (style A, and Plain text). */
  all: ReactNode;
  /** The lines after the first (styles C and D). */
  rest: ReactNode;
  /** The label, as inline text: a marked heading's label is the whole heading, links and code spans included (styles C and D). */
  label: ReactNode;
  /** The first line without its emoji, drawn as written (the thin rule with emojis off). */
  first: ReactNode;
  selectable: boolean;
};

export function MarkedSection({
  meta,
  style,
  emoji,
  theme,
  color,
  all,
  rest,
  label: labelText,
  first,
  selectable,
}: SectionProps) {
  const { markedHeadingStrength } = useTranscriptFlags();
  if (style === 'plain') return <View>{all}</View>;
  const text = channels(color) === null ? theme.prose : color;
  const accent = blendStrength(kindColor(meta.kind, theme.light), text, markedHeadingStrength);
  if (style === 'rule') {
    return (
      <View style={[styles.rule, { borderLeftColor: accent }]}>
        {emoji ? (
          all
        ) : (
          <>
            {first}
            {rest}
          </>
        )}
      </View>
    );
  }
  // The label stands alone on its line: the core moves whatever followed it into `rest`, under it.
  if (style === 'badge') {
    const { fill, edge } = tint(theme);
    const label = meta.label.length > 0 && !meta.labelRepeats ? meta.label : '';
    return (
      <View>
        <View style={styles.badgeRow}>
          {emoji ? <Text style={[styles.prose, { color }]}>{meta.emoji}</Text> : null}
          <View style={styles.badgeLine}>
            <View
              style={[
                styles.badge,
                { borderColor: withAlpha(accent, edge), backgroundColor: withAlpha(accent, fill + 0.05) },
              ]}
            >
              <View style={[styles.badgeDot, { backgroundColor: accent }]} />
              <Text style={[styles.badgeText, { color: accent }]}>{meta.name.toUpperCase()}</Text>
            </View>
          </View>
          {label.length > 0 ? (
            <Text
              selectable={selectable}
              style={[styles.prose, styles.badgeLead, styles.label, { color: theme.foreground }]}
            >
              {labelText}
            </Text>
          ) : null}
        </View>
        {rest}
      </View>
    );
  }
  // Coloured labels: the line reads as written, with its label in the kind's colour; without the
  // emoji, a section with no label of its own shows the kind's name so the line keeps its colour.
  const label = meta.label.length > 0 ? labelText : emoji ? null : `${meta.name}:`;
  const hasLabel = meta.label.length > 0 || !emoji;
  return (
    <View>
      <Text selectable={selectable} style={[styles.prose, { color }]}>
        {emoji ? `${meta.emoji} ` : null}
        {hasLabel ? <Text style={[styles.label, { color: accent }]}>{label}</Text> : null}
      </Text>
      {rest}
    </View>
  );
}

const styles = StyleSheet.create({
  prose: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  label: { fontWeight: '600' },
  rule: { borderLeftWidth: 3, paddingLeft: 12 },
  badgeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  badgeLine: { height: PROSE_LINE, justifyContent: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 7,
    paddingRight: 8,
    paddingVertical: 3,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, lineHeight: 13, fontWeight: '600', letterSpacing: 0.4 },
  badgeLead: { flex: 1, minWidth: 0 },
});
