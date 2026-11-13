/**
 * An error or wait the chat shows on its own (a refused send, "Couldn't reach …", an approval wait),
 * as a one-line card in the Message to / Message from family (desktop `error_card.rs`): a tinted
 * warning tile, the title, a status chip, and on a tap the whole message and the actions the old
 * error line carried. Collapsed by default. What it says is the core's `operationErrorCard`
 * (gx-chat-core `session/error_card.rs`, where the user's decision is recorded); this only lays it out.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Glyph } from './icons';
import {
  SINGLE_LINE_CARD,
  SINGLE_LINE_HEADER_HEIGHT,
  SINGLE_LINE_TITLE,
  SingleLinePill,
  singleLinePressed,
  singleLineShell,
} from '../transcript/singleLineCard';
import { useTranscriptTheme, type TranscriptTheme } from '../transcript/theme';

export type ErrorCardValue = { tone: string; title: string; chip: string; detail: string };

/** The sidebar's failed red and the Waiting pill's amber, as desktop's `tint`. */
function tint(tone: string, theme: TranscriptTheme): string {
  if (tone === 'wait') return theme.light ? '#d97706' : '#fbbf24';
  return theme.light ? '#dc2626' : '#ef4444';
}

export function ErrorCard({ card, actions }: { card: ErrorCardValue; actions?: ReactNode }) {
  const theme = useTranscriptTheme();
  const [open, setOpen] = useState(false);
  const color = tint(card.tone, theme);
  const wait = card.tone === 'wait';
  const expandable = card.detail.length > 0 || actions !== undefined;
  const shown = expandable && open;
  const hairline = theme.ink(theme.light ? 0.08 : 0.05);
  return (
    <View accessibilityRole="alert" style={[styles.card, singleLineShell(theme)]}>
      <Pressable
        disabled={!expandable}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole={expandable ? 'button' : undefined}
        accessibilityLabel={card.title}
        accessibilityState={expandable ? { expanded: shown } : undefined}
        style={({ pressed }) => [styles.row, pressed && expandable && singleLinePressed(theme)]}
      >
        {/* Only the icon carries the colour (`ToneCard.tsx`, CDXC:SessionChat 2026-11-13): no tinted tile, a muted chip. */}
        <View style={styles.tile}>
          <Glyph name={wait ? 'alert-triangle' : 'alert-circle'} size={SINGLE_LINE_CARD.tile.glyphSize} color={color} />
        </View>
        <Text style={[SINGLE_LINE_TITLE, styles.title, { color: theme.foreground }]} numberOfLines={1}>
          {card.title}
        </Text>
        {card.chip.length > 0 ? (
          <SingleLinePill icon={wait ? 'clock' : 'alert-triangle'} label={card.chip} color={theme.muted} />
        ) : null}
      </Pressable>
      {shown ? (
        <View style={[styles.opened, { borderTopColor: hairline }]}>
          {card.detail.length > 0 ? (
            <Text selectable style={[styles.detail, { color: theme.cardMuted }]}>
              {card.detail}
            </Text>
          ) : null}
          {actions !== undefined ? <View style={styles.actions}>{actions}</View> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', minWidth: 0 },
  row: {
    height: SINGLE_LINE_HEADER_HEIGHT,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tile: {
    width: SINGLE_LINE_CARD.tile.size,
    height: SINGLE_LINE_CARD.tile.size,
    borderRadius: SINGLE_LINE_CARD.tile.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, minWidth: 0 },
  opened: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 8 },
  detail: { fontSize: 13, lineHeight: 19.6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
