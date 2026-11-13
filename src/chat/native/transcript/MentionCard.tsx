/**
 * A session pill's state dot, and the card a long press on the pill shows at the top of its menu:
 * the session's title and state, then its agent, project and computer. Desktop shows the same card
 * when the pointer rests on the pill (`session_card` in apps/desktop/src/app/native_chat/).
 *
 * CDXC:SessionChat 2026-11-13 DECISION:
 * User, answering the session-mention design page: Q3061 "hovering a session mention shows the hover card (long press on the phone)". The phone has no hover, so a long press on a mention opens the link menu with the card above its rows; a card's session name (no link of its own) opens the card alone.
 */

import { StyleSheet, Text, View } from 'react-native';

import { SidebarPalette } from '../../../theme/palette';
import { mentionMeta, useMentionedSession, type MentionState, type MentionTarget } from './mentionedSession';
import { useTranscriptTheme, type TranscriptTheme } from './theme';

/** The sidebar's working colour, as the Workers list uses it (`AgentPanels.tsx` `THREAD_WORKING`). */
const WORKING = '#c68a06';

/** A session's state as a 6px dot: filled amber while working, red while it needs you, a ring otherwise. */
export function MentionStateDot({
  state,
  theme,
  size = 6,
}: {
  state: MentionState;
  theme: TranscriptTheme;
  size?: number;
}) {
  const filled = state === 'Working' ? WORKING : state === 'Needs you' ? SidebarPalette.ROW_APPROVAL : null;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2 },
        filled !== null ? { backgroundColor: filled } : { borderWidth: 1.3, borderColor: theme.muted, opacity: 0.8 },
      ]}
    />
  );
}

/** The card above a session pill's menu rows; nothing when the phone's list does not have the session. */
export function MentionCard({ target, homeMachineId }: { target: MentionTarget; homeMachineId: string | null }) {
  const theme = useTranscriptTheme();
  const session = useMentionedSession(target, homeMachineId);
  if (session === null) return null;
  return (
    <View
      style={[styles.card, { borderBottomColor: theme.ink(0.1) }]}
      accessibilityLabel={`${session.title}, ${session.state}`}
    >
      <View style={styles.titleLine}>
        <Text style={[styles.title, { color: theme.foreground }]} numberOfLines={2}>
          {session.title}
        </Text>
        <View style={styles.state}>
          <MentionStateDot state={session.state} theme={theme} size={7} />
          <Text style={[styles.small, { color: theme.muted }]}>{session.state}</Text>
        </View>
      </View>
      <Text style={[styles.small, { color: theme.cardMuted }]} numberOfLines={2}>
        {mentionMeta(session)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
    marginBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  state: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 2 },
  small: { fontSize: 13, lineHeight: 18 },
});
