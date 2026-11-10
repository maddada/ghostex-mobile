/**
 * Every transcript card that folds to one line: the "Worked for 12s" / "Previous turn" fold
 * (`TranscriptItemRow.tsx`), the Message from / Message to / subagent reply cards
 * (`AgentMessageCards.tsx`), the answered question form (`QuestionForm.tsx`) and the "You answered"
 * receipts (`cards/QuestionExchangeCards.tsx`), and the running turn's "Thinking…" card (`MessageRow.tsx`). They are 44pt tall with their border, wear the fold's
 * fill and hairline, and title in the fold's type. None draws a chevron (the whole card opens and
 * closes), and every status on the right is a `SingleLinePill` shaped like the fold's "1 tool call",
 * in its own colour. The fold leads with a clock `SingleLineTile` wearing a green check badge, the
 * question cards with a question-bubble tile; the agent mark on "Message from" is the same size and
 * wears the same `SingleLineBadge`, so the left icons line up.
 *
 * CDXC:SessionChat 2026-10-18 SEE-ALSO:
 * The values are `packages/gx-chat-core/visual/single-line-card.json`, which the desktop reads in
 * `apps/desktop/src/app/native_chat/cards.rs` (`SINGLE_LINE_CARD`, where the user's decision is).
 * Change them together. The phone keeps its fold's own fill (`ink(0.025)`), not the desktop's
 * input tone.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Glyph, type GlyphName } from './icons';
import { useTranscriptTheme, type TranscriptTheme } from './theme';

export const SINGLE_LINE_CARD = {
  height: 44,
  radius: 10,
  paddingX: 12,
  titleSize: 13.5,
  titleLineHeight: 18,
  titleWeight: '500' as TextStyle['fontWeight'],
  borderAlpha: 0.06,
  pill: { paddingX: 8, paddingY: 2, gap: 5, textSize: 11.5, lineHeight: 16, iconSize: 12, borderAlpha: 0.1 },
  tile: {
    size: 28,
    radius: 8,
    glyphSize: 17,
    fillAlpha: 0.06,
    glyphAlpha: 0.8,
    numberSize: 13,
    numberWeight: '600' as TextStyle['fontWeight'],
  },
  badge: {
    size: 12,
    ring: 2,
    offset: -4,
    glyphSize: 6,
    fill: '#16a34a',
    errorFill: '#dc2626',
    askFill: '#F472B6',
    askInk: '#161616',
  },
};

/** The fold's border width, which the header inside a shell leaves room for. */
const BORDER = StyleSheet.hairlineWidth;

/** The header inside a bordered shell, so the folded card is 44pt tall with its border. */
export const SINGLE_LINE_HEADER_HEIGHT = SINGLE_LINE_CARD.height - 2 * BORDER;

/** The shell: the fold's fill, hairline and radius. */
export function singleLineShell(theme: TranscriptTheme): ViewStyle {
  return {
    borderRadius: SINGLE_LINE_CARD.radius,
    borderWidth: BORDER,
    borderColor: theme.ink(SINGLE_LINE_CARD.borderAlpha),
    backgroundColor: theme.ink(0.025),
    overflow: 'hidden',
  };
}

/** The title's type, the fold's "Worked for 12s". */
export const SINGLE_LINE_TITLE: TextStyle = {
  fontSize: SINGLE_LINE_CARD.titleSize,
  lineHeight: SINGLE_LINE_CARD.titleLineHeight,
  fontWeight: SINGLE_LINE_CARD.titleWeight,
};

/**
 * A pill on the card's right: `color` tints its glyph and words, its hairline stays neutral.
 * `labelColor` takes the words alone when the tone stays on the glyph.
 */
export function SingleLinePill({
  icon,
  label,
  color,
  labelColor = color,
}: {
  icon?: GlyphName;
  label?: string;
  color: string;
  labelColor?: string;
}) {
  const theme = useTranscriptTheme();
  const pill = SINGLE_LINE_CARD.pill;
  return (
    <View style={[styles.pill, { borderColor: theme.ink(pill.borderAlpha) }]}>
      {icon !== undefined ? <Glyph name={icon} size={pill.iconSize} color={color} /> : null}
      {label !== undefined ? <Text style={[styles.pillText, { color: labelColor }]}>{label}</Text> : null}
    </View>
  );
}

/**
 * The tile leading a one-line card: the fold's `clock`, the answered question cards' `question` and
 * the waiting ones' `checklist` (the mockup's own 16-unit drawings, desktop
 * `assets/titlebar/chat-card-*.svg`), or any transcript
 * `Glyph` (a status card's). `badge` puts the green check, the red cross or a waiting question's
 * "?" at its bottom right.
 */
export function SingleLineTile({
  glyph,
  badge,
  ring,
}: {
  glyph: 'clock' | 'question' | 'checklist' | GlyphName;
  badge?: 'check' | 'error' | 'ask';
  /** The badge's ring when the tile sits on another card's fill (a question card's panel). */
  ring?: string;
}) {
  const theme = useTranscriptTheme();
  const { tile } = SINGLE_LINE_CARD;
  const ink = theme.ink(tile.glyphAlpha);
  return (
    <SingleLineTileBox>
      {glyph === 'clock' || glyph === 'question' || glyph === 'checklist' ? (
        <Svg width={tile.glyphSize} height={tile.glyphSize} viewBox="0 0 16 16" fill="none" stroke={ink}>
          {glyph === 'clock' ? (
            <>
              <Circle cx={8} cy={8} r={5.8} strokeWidth={1.4} />
              <Path d="M8 4.8V8l2.2 1.4" strokeWidth={1.4} strokeLinecap="round" />
            </>
          ) : glyph === 'checklist' ? (
            <Path
              d="M2.5 4.5 3.6 5.6 5.5 3.6M2.5 10.5l1.1 1.1 1.9-2M8 4.6h5.5M8 10.6h5.5"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <>
              <Path
                d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"
                strokeWidth={1.3}
                strokeLinejoin="round"
              />
              <Path d="M6.6 6.2a1.5 1.5 0 1 1 2.1 1.4c-.5.2-.7.5-.7 1" strokeWidth={1.3} strokeLinecap="round" />
              <Circle cx={8} cy={10} r={0.7} fill={ink} stroke="none" />
            </>
          )}
        </Svg>
      ) : (
        <Glyph name={glyph} size={tile.glyphSize} color={ink} />
      )}
      {badge !== undefined ? (
        <SingleLineBadge
          fill={
            badge === 'error'
              ? SINGLE_LINE_CARD.badge.errorFill
              : badge === 'ask'
                ? SINGLE_LINE_CARD.badge.askFill
                : SINGLE_LINE_CARD.badge.fill
          }
          {...(ring !== undefined ? { ring } : {})}
        >
          <Svg
            width={SINGLE_LINE_CARD.badge.glyphSize}
            height={SINGLE_LINE_CARD.badge.glyphSize}
            viewBox="0 0 10 10"
            fill="none"
          >
            {badge === 'ask' ? (
              <>
                <Path
                  d="M3.4 3.6a1.7 1.7 0 1 1 2.4 1.5c-.5.25-.8.55-.8 1.1"
                  stroke={SINGLE_LINE_CARD.badge.askInk}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
                <Circle cx={5} cy={8.1} r={0.8} fill={SINGLE_LINE_CARD.badge.askInk} />
              </>
            ) : (
              <Path
                d={badge === 'error' ? 'M3.2 3.2 6.8 6.8M6.8 3.2 3.2 6.8' : 'M2 5.2 4.2 7.4 8 2.8'}
                stroke="#ffffff"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </Svg>
        </SingleLineBadge>
      ) : null}
    </SingleLineTileBox>
  );
}

/**
 * The tile without its glyph, for a mark that brings its own colours (the agent's logo on
 * "Message from", drawn at `SINGLE_LINE_CARD.tile.glyphSize`); a badge goes in as a child.
 */
export function SingleLineTileBox({ children }: { children: ReactNode }) {
  const theme = useTranscriptTheme();
  return <View style={[styles.tile, { backgroundColor: theme.ink(SINGLE_LINE_CARD.tile.fillAlpha) }]}>{children}</View>;
}

/** The tile with a number in it, an answered question's row number (`ReceiptRow`; desktop `number_tile`). */
export function SingleLineNumberTile({ number }: { number: number }) {
  const theme = useTranscriptTheme();
  const { tile } = SINGLE_LINE_CARD;
  return (
    <SingleLineTileBox>
      <Text
        style={{
          color: theme.ink(tile.glyphAlpha),
          fontSize: tile.numberSize,
          lineHeight: tile.size,
          fontWeight: tile.numberWeight,
        }}
      >
        {number}
      </Text>
    </SingleLineTileBox>
  );
}

/** What a one-line card shows while it is pressed, the desktop's hover fill (`card_hover_fill`). */
export function singleLinePressed(theme: TranscriptTheme): ViewStyle {
  return { backgroundColor: theme.ink(0.04) };
}

/**
 * The round badge at the bottom right of a row's leading icon (the fold tile's check, the agent
 * mark's arrow on "Message from"), its ring in the card's own fill over the transcript so the
 * icon's corner never shows through it. Its parent is the icon's box.
 */
export function SingleLineBadge({
  fill,
  ring: ringColor,
  children,
}: {
  fill: string;
  ring?: string;
  children: ReactNode;
}) {
  const theme = useTranscriptTheme();
  const { badge } = SINGLE_LINE_CARD;
  const ring = badge.size + 2 * badge.ring;
  return (
    <View
      style={[
        styles.badge,
        { width: ring, height: ring, borderRadius: ring / 2, backgroundColor: ringColor ?? theme.background },
      ]}
    >
      <View
        style={[
          styles.badgeRing,
          { borderRadius: ring / 2, backgroundColor: ringColor !== undefined ? 'transparent' : theme.ink(0.025) },
        ]}
      >
        <View style={[styles.badgeDot, { backgroundColor: fill }]}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: SINGLE_LINE_CARD.tile.size,
    height: SINGLE_LINE_CARD.tile.size,
    borderRadius: SINGLE_LINE_CARD.tile.radius,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badge: { position: 'absolute', right: SINGLE_LINE_CARD.badge.offset, bottom: SINGLE_LINE_CARD.badge.offset },
  badgeRing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badgeDot: {
    width: SINGLE_LINE_CARD.badge.size,
    height: SINGLE_LINE_CARD.badge.size,
    borderRadius: SINGLE_LINE_CARD.badge.size / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: SINGLE_LINE_CARD.pill.gap,
    paddingHorizontal: SINGLE_LINE_CARD.pill.paddingX,
    paddingVertical: SINGLE_LINE_CARD.pill.paddingY,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: SINGLE_LINE_CARD.pill.textSize, lineHeight: SINGLE_LINE_CARD.pill.lineHeight },
});
