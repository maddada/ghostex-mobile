/**
 * The cards for messages between agents (desktop `inter_agent_message.rs`): one another agent sent
 * this session, one this session's agent sent another, and a subagent's reply. Each is one 44pt row
 * (the agent's logo, one sentence such as `Message from "<session>"` that reads the same collapsed and
 * opened, the time and the status as a pill, no chevron) that opens to the whole message. Everything a card says is the core's
 * `card` object (`agent_message_card.rs`; the user's pick is the `CDXC:SessionChat 2026-10-12 DECISION` there);
 * this file only lays it out, in the shell, height and title type every one-line card shares
 * (`singleLineCard.tsx`). The phone has no hover, so Go to session sits in the opened message;
 * a message sent to several sessions lists each of them there instead, each name opening its session.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { CoordinatorGlyph } from '../../../components/sessions/icons';
import { SidebarPalette } from '../../../theme/palette';
import { AgentMark } from '../cards/agentMark';
import { useNativeChatUi, useTranscriptEnv } from './context';
import { Glyph, type GlyphName } from './icons';
import { arr, obj, str, type JsonRecord } from './json';
import { Markdown } from './markdown/Markdown';
import { SessionPill } from './SessionPill';
import {
  SINGLE_LINE_CARD,
  SINGLE_LINE_HEADER_HEIGHT,
  SINGLE_LINE_TITLE,
  SingleLineBadge,
  SingleLinePill,
  SingleLineTileBox,
  singleLinePressed,
  singleLineShell,
} from './singleLineCard';
import { useDisclosure } from './state';
import type { TranscriptTheme } from './theme';
import { ROW_GAP, cardStackMargin } from './cardSpacing';

function toneColor(tone: string, theme: TranscriptTheme): string {
  if (tone === 'failed') return theme.light ? '#e11d48' : '#fb7185';
  if (tone === 'waiting') return theme.light ? '#d97706' : '#fbbf24';
  return theme.light ? '#059669' : '#34d399';
}

/**
 * The agent's own logo (a coordinator's crown, `CDXC:Coordinators 2026-10-15` in the core's
 * agent_message_card.rs) with a small arrow badge (prose grey coming in, sky going out), or a
 * subagent's sparkle, inside the fold's tile (`SingleLineTileBox`) so the left icons look alike.
 */
function Mark({ card }: { card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const direction = str(card, 'direction');
  const size = SINGLE_LINE_CARD.tile.glyphSize;
  if (direction === 'subagent') {
    return (
      <SingleLineTileBox>
        <Glyph name="sparkles" size={size} color={theme.prose} />
      </SingleLineTileBox>
    );
  }
  const sent = direction === 'sent';
  const icon = str(card, 'agentIcon');
  return (
    <SingleLineTileBox>
      {card.coordinator === true ? (
        <CoordinatorGlyph size={size} color={theme.light ? '#000000' : SidebarPalette.ROW_COORDINATOR_CROWN} />
      ) : (
        <AgentMark icon={icon.length > 0 ? icon : null} size={size} />
      )}
      <SingleLineBadge fill={sent ? (theme.light ? '#0284c7' : '#7dd3fc') : theme.prose}>
        <Glyph
          name={sent ? 'arrow-up-right' : 'arrow-down-left'}
          size={SINGLE_LINE_CARD.badge.glyphSize}
          color={theme.cardPanel}
          strokeWidth={2.8}
        />
      </SingleLineBadge>
    </SingleLineTileBox>
  );
}

/** A pill (`singleLineCard.tsx`) with its glyph and word: Delivered in green, like Answered; Queued, Waiting for agent and Not sent in their colour. */
function Status({ status }: { status: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const color = toneColor(str(status, 'tone'), theme);
  const icon = str(status, 'icon');
  const glyph: GlyphName = icon === 'alert' ? 'alert-triangle' : icon === 'clock' ? 'clock' : 'check';
  return (
    <View accessibilityRole="text" accessibilityLabel={str(status, 'hint')}>
      <SingleLinePill icon={glyph} label={str(status, 'label')} color={color} />
    </View>
  );
}

const AgentCard = memo(function AgentCard({
  disclosureKey,
  card,
  body,
  references,
}: {
  disclosureKey: string;
  card: JsonRecord;
  body: string;
  references: unknown;
}) {
  const { theme, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [openState, toggle] = useDisclosure(disclosures, disclosureKey);
  const expandable = body.length > 0;
  const open = expandable && openState;
  const status = obj(card.status);
  const failure = str(card, 'failure');
  // A message still waiting says why in the same footer, once gxserver has held it a minute.
  const footer = failure.length > 0 ? failure : str(card, 'waitReason');
  const retry = typeof card.retryPromptId === 'string' ? card.retryPromptId : null;
  const session = obj(card.session);
  const time = str(card, 'time');
  const hairline = theme.ink(theme.light ? 0.08 : 0.05);
  const recipients = arr(card.recipients)
    .map((recipient) => obj(recipient))
    .filter((recipient): recipient is JsonRecord => recipient !== null);
  const showSession = failure.length === 0 && session !== null;
  const pill = obj(card.pill);

  return (
    <View style={[styles.card, singleLineShell(theme)]}>
      <Pressable
        disabled={!expandable}
        onPress={toggle}
        accessibilityRole={expandable ? 'button' : undefined}
        accessibilityLabel={str(card, 'title')}
        accessibilityState={expandable ? { expanded: open } : undefined}
        style={({ pressed }) => [styles.row, pressed && expandable && singleLinePressed(theme)]}
      >
        <Mark card={card} />
        {pill !== null ? (
          // `Message from` / `Message to`, then the other session's pill (`session_mentions.rs`).
          <View style={[styles.name, styles.pillTitle]}>
            <Text style={[SINGLE_LINE_TITLE, { color: theme.foreground }]} numberOfLines={1}>
              {str(pill, 'prefix')}
            </Text>
            <SessionPill pill={pill} textStyle={[SINGLE_LINE_TITLE, { color: theme.foreground }]} />
          </View>
        ) : (
          <Text style={[SINGLE_LINE_TITLE, styles.name, { color: theme.foreground }]} numberOfLines={1}>
            {str(card, 'name')}
          </Text>
        )}
        {time.length > 0 ? <Text style={[styles.small, { color: theme.muted }]}>{time}</Text> : null}
        {status !== null ? <Status status={status} /> : null}
      </Pressable>
      {open ? (
        <View style={[styles.opened, { borderTopColor: hairline }]}>
          {showSession && session !== null ? (
            <Pressable
              onPress={() =>
                dispatch({
                  type: 'openAgentSession',
                  projectId: str(session, 'projectId'),
                  sessionId: str(session, 'sessionId'),
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Go to session"
              hitSlop={6}
              style={({ pressed }) => [styles.goto, pressed && { backgroundColor: theme.ink(0.08) }]}
            >
              <Glyph name="arrow-up-right" size={12} color={theme.muted} />
              <Text style={[styles.gotoText, { color: theme.muted }]}>Go to session</Text>
            </Pressable>
          ) : null}
          {recipients.length > 0 ? (
            <View style={styles.recipients}>
              {recipients.map((recipient, index) => {
                const target = obj(recipient.session);
                const shown = obj(recipient.status);
                return (
                  <Pressable
                    key={index}
                    disabled={target === null}
                    onPress={() => {
                      if (target === null) return;
                      dispatch({
                        type: 'openAgentSession',
                        projectId: str(target, 'projectId'),
                        sessionId: str(target, 'sessionId'),
                      });
                    }}
                    accessibilityRole={target !== null ? 'button' : undefined}
                    accessibilityLabel={target !== null ? `Go to ${str(recipient, 'name')}` : undefined}
                    hitSlop={4}
                    style={({ pressed }) => [
                      styles.recipient,
                      pressed && target !== null && { backgroundColor: theme.ink(0.08) },
                    ]}
                  >
                    <Mark card={recipient} />
                    {obj(recipient.pill) !== null ? (
                      <View style={styles.recipientName}>
                        <SessionPill
                          pill={obj(recipient.pill) ?? {}}
                          textStyle={[styles.recipientText, { color: theme.foreground }]}
                        />
                      </View>
                    ) : (
                      <Text style={[styles.recipientName, { color: theme.foreground }]} numberOfLines={1}>
                        {str(recipient, 'name')}
                      </Text>
                    )}
                    {shown !== null ? <Status status={shown} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Markdown text={body} references={references} color={theme.cardMuted} />
        </View>
      ) : null}
      {footer.length > 0 ? (
        <View style={[styles.failure, { borderTopColor: hairline }]}>
          <Text style={[styles.small, styles.failureText, { color: theme.muted }]}>{footer}</Text>
          {retry !== null ? (
            <>
              <Pressable style={styles.action} onPress={() => dispatch({ type: 'retryQueue', promptId: retry })}>
                <Text style={[styles.small, { color: theme.primary }]}>Retry</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => dispatch({ type: 'removeQueue', promptId: retry })}>
                <Text style={[styles.small, { color: theme.primary }]}>Remove</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

/** A message another agent sent this session. */
export const InterAgentCard = memo(function InterAgentCard({ message }: { message: ProjectedMessage }) {
  const inter = obj(message.interAgentMessage);
  const card = obj(inter?.card);
  if (inter === null || card === null) return null;
  return (
    <AgentCard
      disclosureKey={`inter-agent:${message.id}`}
      card={card}
      body={str(inter, 'body')}
      references={message.markdownReferences}
    />
  );
});

/** A subagent's reply that arrived as a system turn (`Message from <agent>`). */
export function SubagentMessageCard({ id, card, references }: { id: string; card: JsonRecord; references: unknown }) {
  const shown = obj(card.card);
  if (shown === null) return null;
  const marked = str(card, 'markdown');
  return (
    <AgentCard
      disclosureKey={`agent-message:${id}`}
      card={shown}
      body={marked.length > 0 ? marked : str(card, 'body')}
      references={references}
    />
  );
}

/** The messages this session's agent sent other agents, one row each. */
export function SentAgentMessageCards({ cards, aboveIsCard = false, columnGap = 0 }: { cards: unknown; aboveIsCard?: boolean; columnGap?: number }) {
  const list = arr(cards)
    .map((card) => obj(card))
    .filter((card): card is JsonRecord => card !== null && obj(card.card) !== null);
  if (list.length === 0) return null;
  return (
    <View style={[styles.column, { marginTop: cardStackMargin(aboveIsCard, columnGap) }]}>
      {list.map((sent) => {
        const marked = str(sent, 'markdown');
        return (
          <AgentCard
            key={str(sent, 'key')}
            disclosureKey={`sent-message:${str(sent, 'key')}`}
            card={obj(sent.card) ?? {}}
            body={marked.length > 0 ? marked : str(sent, 'body')}
            references={sent.markdownReferences}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: ROW_GAP, minWidth: 0 },
  card: { minWidth: 0 },
  row: {
    height: SINGLE_LINE_HEADER_HEIGHT,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: { flex: 1, minWidth: 0 },
  // An ordinary word space between `Message to` and the session's name.
  pillTitle: { flexDirection: 'row', alignItems: 'center', gap: Math.round(SINGLE_LINE_CARD.titleSize * 0.27) },
  small: { fontSize: 12, lineHeight: 16 },
  opened: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 6 },
  goto: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: -6,
  },
  gotoText: { fontSize: 12.5, lineHeight: 17 },
  recipients: { gap: 4, paddingBottom: 4 },
  recipient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginLeft: -6,
    borderRadius: 6,
  },
  recipientName: { flexShrink: 1, minWidth: 0, fontSize: 13 },
  recipientText: { fontSize: 13 },
  failure: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  failureText: { flex: 1, minWidth: 0 },
  action: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
});
