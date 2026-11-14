/**
 * Another session named in the chat (gx-chat-core `transcript/session_mentions.rs`, where the user's
 * decisions live): the agent's logo and the session's title with a faint dotted underline, no frame
 * and no fill, then a state dot only while it works or needs you and, for a session on another
 * computer than the chat's, that computer's own icon (no name), the one its session rows draw
 * (machines/computerIcons.ts). The same look desktop draws (`session_pill_link` in
 * markdown_links.rs, `session_pill` in inter_agent_message.rs). The dot and the computer are read
 * live from the phone's session list (`mentionedSession.ts`). A card's name (the core marks it
 * `logo: false`) sits beside the card's own agent tile and leaves the logo to it (CDXC:SessionChat
 * 2026-10-28 on `card_pill`), except a coordinator's, whose tile is the crown: it draws the agent's
 * logo (CDXC:SessionChat 2026-11-14 on `titled_pill` in gx-chat-core agent_message_card.rs).
 *
 * CDXC:SessionChat 2026-11-14 SEE-ALSO: the user's "i believe we agreed to show the logo of the
 * machine here?" (desktop gx_chat/session_directory.rs `computer_icon`): the computer mark is that
 * computer's own icon, the plain computer only while its icon is unknown. A tap switches to that
 * session, its underline full strength while pressed (the desktop's hover); a long press shows its
 * card (`MentionCard.tsx`); a session that is gone draws muted, without an underline, and does
 * nothing.
 *
 * CDXC:SessionChat 2026-11-15 SEE-ALSO: the user's "i dont like the pill border around the name of
 * different agents ... only show status when running (red/yellow dots only should show)" is on
 * `mention_card` in gx-chat-core; it supersedes the framed pill and the idle ring of 2026-11-13.
 * The side chat bar's parent name (`plain`) keeps the line's own type without the logo or marks.
 *
 * A board card's mention (`[title](board:B4)`, gx-chat-core `board_reference`) is not a session: it
 * keeps the framed pill in the board's own tint (`reference.board`, desktop `board_mention_link`)
 * with the Board pill's icon and the card's title now; a card the board no longer has draws muted
 * with the link's own text.
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
            // The session's computer: the core hands it on when it is not the chat's own.
            ...(str(session, 'serverId').length > 0 ? { serverId: str(session, 'serverId') } : {}),
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
  // The name's own colour, which its underline takes (the line's `textStyle`, else the theme's).
  const nameColor = StyleSheet.flatten(textStyle)?.color;
  const ink = typeof nameColor === 'string' ? nameColor : theme.foreground;
  const opens = !missing && open !== undefined;
  if (plain) {
    return (
      <Pressable
        disabled={!opens}
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={`${label}: ${title}`}
        hitSlop={4}
        style={({ pressed }) => [
          styles.pill,
          styles.plainPill,
          pressed && opens ? { backgroundColor: theme.ink(0.08) } : null,
        ]}
      >
        {({ pressed }) => (
          <Text
            style={[
              styles.plainLabel,
              textStyle,
              missing ? { color: theme.cardMuted } : null,
              opens ? dottedUnderline(ink, pressed) : null,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        )}
      </Pressable>
    );
  }
  if (!board) {
    // Only a session that works or needs you shows its state; idle and sleeping show none.
    const running = live !== null && (live.state === 'Working' || live.state === 'Needs you');
    return (
      <Pressable
        disabled={!opens}
        onPress={open}
        {...(longPress !== undefined ? { onLongPress: longPress } : {})}
        accessibilityRole="link"
        accessibilityLabel={`${label}: ${title}${live !== null ? `, ${live.state}` : ''}${
          live !== null && live.computer.length > 0 ? `, on ${live.computer}` : ''
        }`}
        hitSlop={4}
        style={[styles.pill, styles.name]}
      >
        {({ pressed }) => (
          <>
            {showsLogo ? (
              <View style={missing ? styles.faded : null}>
                {pill.coordinator === true ? (
                  <CoordinatorGlyph size={12} color={theme.light ? '#000000' : SidebarPalette.ROW_COORDINATOR_CROWN} />
                ) : (
                  <AgentMark icon={icon.length > 0 ? icon : null} size={12} />
                )}
              </View>
            ) : null}
            <Text
              style={[
                styles.nameLabel,
                textStyle,
                { color: missing ? theme.cardMuted : ink },
                opens ? dottedUnderline(ink, pressed) : null,
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {running && live !== null ? <MentionStateDot state={live.state} theme={theme} /> : null}
            {live !== null && live.computer.length > 0 ? (
              <ComputerIconGlyph drawing={computerDrawing} size={11} color={theme.muted} />
            ) : null}
          </>
        )}
      </Pressable>
    );
  }
  return (
    <Pressable
      disabled={missing || open === undefined}
      onPress={open}
      {...(longPress !== undefined ? { onLongPress: longPress } : {})}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${title}`}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        styles.frame,
        tint !== undefined
          ? { borderColor: colorWithOpacity(tint, 42), backgroundColor: colorWithOpacity(tint, pressed ? 18 : 10) }
          : { borderColor: theme.ink(0.14), backgroundColor: pressed && !missing ? theme.ink(0.08) : theme.ink(0.03) },
      ]}
    >
      {showsLogo ? (
        <View style={missing ? styles.faded : null}>
          {/* A board item's pill (gx-chat-core `board_reference`) takes the Board pill's icon. */}
          <Glyph name="layout-board-split" size={12} color={tint ?? theme.foreground} />
        </View>
      ) : null}
      <Text style={[styles.label, { color: missing ? theme.cardMuted : theme.foreground }]} numberOfLines={1}>
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
  },
  // A board item's framed pill.
  frame: {
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  // A session's name: no frame, the line's own height.
  name: { alignSelf: 'auto' },
  nameLabel: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  // The pressed fill reaches past the name on each side and the margin takes it back.
  plainPill: { paddingHorizontal: CARD_PILL_PAD, marginHorizontal: -CARD_PILL_PAD, borderRadius: 5 },
  plainLabel: { flexShrink: 1 },
  faded: { opacity: 0.45 },
  label: { fontSize: 12.5, lineHeight: 16, fontWeight: '500', flexShrink: 1 },
});
