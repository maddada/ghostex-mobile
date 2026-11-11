/**
 * Another session's agent pill (gx-chat-core `transcript/session_mentions.rs`, where the user's
 * decision lives): a hairline rounded frame around the agent's logo and the session's title, the
 * same look desktop draws (`session_pill_link` in markdown_links.rs). A card's pill (the core marks
 * it `logo: false`) sits beside the card's own agent tile, leaves the logo to it
 * (CDXC:SessionChat 2026-10-28 on `card_pill`) and reads as part of the card's title: no frame,
 * the line's own type and colour (`textStyle`), a fill only while pressed (CDXC:SessionChat
 * 2026-10-29 DECISION on desktop `session_pill` in inter_agent_message.rs). A tap switches to that session; a session that is gone
 * draws muted and does nothing. A card's name that opens its session has a faint dotted underline in
 * its own colour, so it reads as something to tap (desktop `session_name_underline` in
 * inter_agent_message.rs, whose decision has the user's words); the phone has no hover, so the dots
 * stay at the strength the phone's question links use (`LinkWords.tsx`).
 *
 * A board card's mention (`[title](board:B4)`, gx-chat-core `board_reference`) is the same pill in
 * the board's own tint (`reference.board`, desktop `board_mention_link`) with the Board pill's icon
 * and the card's title now; a card the board no longer has draws muted with the link's own text.
 */

import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { CoordinatorGlyph } from '../../../components/sessions/icons';
import { colorWithOpacity, SidebarPalette } from '../../../theme/palette';
import { AgentMark } from '../cards/agentMark';
import { Glyph } from '../cards/icons';
import { useTranscriptEnv, useTranscriptFlags } from './context';
import { dottedUnderline } from './LinkWords';
import { obj, str, type JsonRecord } from './json';

/** How far a card name's pressed fill reaches past the name (desktop `CARD_PILL_PAD`). */
const CARD_PILL_PAD = 3;

export function SessionPill({
  pill,
  onOpen,
  onLongPress,
  textStyle,
}: {
  /** The card's `pill`, or a `session` reference: `label`, `agentIcon`, `coordinator`, `missing`, `logo`. */
  pill: JsonRecord;
  /** A mention link opens through the core like any link; a card's pill names its session. */
  onOpen?: () => void;
  onLongPress?: () => void;
  /**
   * A card's session name: the type and colour of the words before it (`Message to`), so the two
   * read as one title (CDXC:SessionChat 2026-10-29 DECISION on desktop `session_pill` in
   * inter_agent_message.rs).
   */
  textStyle?: StyleProp<TextStyle>;
}) {
  const { theme, dispatch } = useTranscriptEnv();
  const { boardItemTitles } = useTranscriptFlags();
  const board = pill.kind === 'board';
  const boardTitle = board ? boardItemTitles?.[str(pill, 'item')] : undefined;
  const missing = board ? boardItemTitles !== null && !boardTitle : pill.missing === true;
  const label = boardTitle !== undefined && boardTitle.length > 0 ? boardTitle : str(pill, 'label');
  const title = board && missing ? str(pill, 'goneTitle') : str(pill, 'title');
  const tint = board && !missing ? theme.reference.board : undefined;
  const showsLogo = pill.logo !== false;
  const session = obj(pill.session);
  const open =
    onOpen ??
    (session !== null
      ? () =>
          dispatch({
            type: 'openAgentSession',
            projectId: str(session, 'projectId'),
            sessionId: str(session, 'sessionId'),
          })
      : undefined);
  const icon = str(pill, 'agentIcon');
  // The name's own colour, which its underline takes (the line's `textStyle`, else the theme's).
  const nameColor = StyleSheet.flatten(textStyle)?.color;
  const underline =
    !showsLogo && !missing && open !== undefined
      ? dottedUnderline(typeof nameColor === 'string' ? nameColor : theme.foreground)
      : null;
  return (
    <Pressable
      disabled={missing || open === undefined}
      onPress={open}
      {...(onLongPress !== undefined ? { onLongPress } : {})}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${title}`}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        !showsLogo
          ? [styles.cardPill, pressed && !missing ? { backgroundColor: theme.ink(0.08) } : null]
          : tint !== undefined
            ? { borderColor: colorWithOpacity(tint, 42), backgroundColor: colorWithOpacity(tint, pressed ? 18 : 10) }
            : { borderColor: theme.ink(0.14), backgroundColor: pressed && !missing ? theme.ink(0.08) : theme.ink(0.03) },
      ]}
    >
      {showsLogo ? (
        <View style={missing ? styles.faded : null}>
          {board ? (
            // A board item's pill (gx-chat-core `board_reference`) takes the Board pill's icon.
            <Glyph name="layout-board-split" size={12} color={tint ?? theme.foreground} />
          ) : pill.coordinator === true ? (
            <CoordinatorGlyph size={12} color={theme.light ? '#000000' : SidebarPalette.ROW_COORDINATOR_CROWN} />
          ) : (
            <AgentMark icon={icon.length > 0 ? icon : null} size={12} />
          )}
        </View>
      ) : null}
      <Text
        style={
          showsLogo
            ? [styles.label, { color: missing ? theme.cardMuted : theme.foreground }]
            : [styles.cardLabel, textStyle, missing ? { color: theme.cardMuted } : null, underline]
        }
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 1,
    minWidth: 0,
    gap: 4,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  // The fill reaches past the name on each side and the margin takes it back: no space at rest.
  cardPill: { paddingHorizontal: CARD_PILL_PAD, marginHorizontal: -CARD_PILL_PAD, height: 'auto', borderWidth: 0, borderRadius: 5 },
  cardLabel: { flexShrink: 1 },
  faded: { opacity: 0.45 },
  label: { fontSize: 12.5, lineHeight: 16, fontWeight: '500', flexShrink: 1 },
});
