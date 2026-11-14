/**
 * Another session's agent pill (gx-chat-core `transcript/session_mentions.rs`, where the user's
 * decision lives): a hairline rounded frame around the agent's logo and the session's title, then
 * its state dot and, for a session on another computer than the chat's, that computer's own icon
 * (no name), the one its session rows draw (machines/computerIcons.ts). The same look desktop draws
 * (`session_pill_link` in markdown_links.rs). The dot and the computer are read live from the
 * phone's session list (`mentionedSession.ts`). A card's pill (the core marks it `logo: false`)
 * sits beside the card's own agent tile and leaves the logo to it (CDXC:SessionChat 2026-10-28 on
 * `card_pill`), except a coordinator's, whose tile is the crown: its pill draws the agent's logo
 * (CDXC:SessionChat 2026-11-14 on `titled_pill` in gx-chat-core agent_message_card.rs).
 *
 * CDXC:SessionChat 2026-11-14 SEE-ALSO: the user's "i believe we agreed to show the logo of the
 * machine here?" (desktop gx_chat/session_directory.rs `computer_icon`): the computer mark is that
 * computer's own icon, the plain computer only while its icon is unknown. A tap switches to that session; a long press shows
 * its card (`MentionCard.tsx`); a session that is gone draws muted and does nothing.
 *
 * CDXC:SessionChat 2026-11-13 DECISION:
 * User, answering the session-mention design page: Q3060 "the rich pill, in both the chat box and the sent message. But for a session on another computer, show only that computer's icon, not its whole name", and Q3063 "the same look spreads to message cards and the Workers popover, where they name a session". A "Message from / to" card's session name is the framed pill too (without the logo its tile already shows), with the dot and the computer icon. Supersedes the frameless card name in the line's own type and its dotted underline (CDXC:SessionChat 2026-10-29 and 2026-10-31 on desktop `session_pill` in inter_agent_message.rs). The side chat bar's parent name (`plain`) keeps the frameless look: it is not a card.
 *
 * A board card's mention (`[title](board:B4)`, gx-chat-core `board_reference`) is the same pill in
 * the board's own tint (`reference.board`, desktop `board_mention_link`) with the Board pill's icon
 * and the card's title now; a card the board no longer has draws muted with the link's own text.
 */

import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { ComputerIconGlyph } from '../../../components/sessions/ComputerIconGlyph';
import { CoordinatorGlyph } from '../../../components/sessions/icons';
import { colorWithOpacity, SidebarPalette } from '../../../theme/palette';
import { AgentMark } from '../cards/agentMark';
import { Glyph } from '../cards/icons';
import { useHomeMachineId, useTranscriptEnv, useTranscriptFlags } from './context';
import { dottedUnderline } from './LinkWords';
import { obj, str, type JsonRecord } from './json';
import { MentionStateDot } from './MentionCard';
import { useComputerIconDrawing, useMentionedSession, type MentionTarget } from './mentionedSession';
import { openTranscriptMenu } from './transcriptMenuStore';

/** How far the side chat bar's name's pressed fill reaches past it (desktop `CARD_PILL_PAD`). */
const CARD_PILL_PAD = 3;

export function SessionPill({
  pill,
  onOpen,
  onLongPress,
  textStyle,
  plain = false,
}: {
  /** The card's `pill`, or a `session` reference: `label`, `agentIcon`, `coordinator`, `missing`, `logo`. */
  pill: JsonRecord;
  /** A mention link opens through the core like any link; a card's pill names its session. */
  onOpen?: () => void;
  onLongPress?: () => void;
  /** The `plain` name's type and colour: the words before it, so the two read as one line. */
  textStyle?: StyleProp<TextStyle>;
  /**
   * The side chat bar's parent name: no frame, the line's own type and colour (`textStyle`), a
   * fill only while pressed, a faint dotted underline when it opens its session.
   */
  plain?: boolean;
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
  // The session the pill names, for its dot, its computer and its card: a mention's Global Ref, a
  // card's ids.
  const target: MentionTarget | null = board
    ? null
    : str(pill, 'href').length > 0
      ? { globalRef: str(pill, 'href') }
      : session !== null
        ? {
            projectId: str(session, 'projectId'),
            sessionId: str(session, 'sessionId'),
            ...(str(session, 'serverId').length > 0 ? { serverId: str(session, 'serverId') } : {}),
          }
        : null;
  const homeMachineId = useHomeMachineId();
  const live = useMentionedSession(missing ? null : target, homeMachineId);
  // The computer's own icon, the plain computer while it is unknown.
  const computerDrawing = useComputerIconDrawing(live?.machineId ?? '');
  const longPress =
    onLongPress ?? (target !== null && live !== null ? () => openTranscriptMenu({ mention: target }) : undefined);
  if (plain) {
    // The name's own colour, which its underline takes (the line's `textStyle`, else the theme's).
    const nameColor = StyleSheet.flatten(textStyle)?.color;
    const underline =
      !missing && open !== undefined
        ? dottedUnderline(typeof nameColor === 'string' ? nameColor : theme.foreground)
        : null;
    return (
      <Pressable
        disabled={missing || open === undefined}
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={`${label}: ${title}`}
        hitSlop={4}
        style={({ pressed }) => [
          styles.pill,
          styles.plainPill,
          pressed && !missing ? { backgroundColor: theme.ink(0.08) } : null,
        ]}
      >
        <Text style={[styles.plainLabel, textStyle, missing ? { color: theme.cardMuted } : null, underline]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      disabled={missing || open === undefined}
      onPress={open}
      {...(longPress !== undefined ? { onLongPress: longPress } : {})}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${title}${live !== null ? `, ${live.state}` : ''}${
        live !== null && live.computer.length > 0 ? `, on ${live.computer}` : ''
      }`}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        tint !== undefined
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
      <Text style={[styles.label, { color: missing ? theme.cardMuted : theme.foreground }]} numberOfLines={1}>
        {label}
      </Text>
      {live !== null ? <MentionStateDot state={live.state} theme={theme} /> : null}
      {live !== null && live.computer.length > 0 ? (
        <ComputerIconGlyph drawing={computerDrawing} size={11} color={theme.muted} />
      ) : null}
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
  plainPill: { paddingHorizontal: CARD_PILL_PAD, marginHorizontal: -CARD_PILL_PAD, height: 'auto', borderWidth: 0, borderRadius: 5 },
  plainLabel: { flexShrink: 1 },
  faded: { opacity: 0.45 },
  label: { fontSize: 12.5, lineHeight: 16, fontWeight: '500', flexShrink: 1 },
});
