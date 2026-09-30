/**
 * The transcript rows that are cards or quiet lines rather than prose: system cards
 * (`system_cards.rs`), harness-injected turns (`status_rows.rs`), a message from another agent
 * (`inter_agent_message.rs`) and one this session's agent sent another, a send still waiting for the terminal (`startup_delivery.rs`) and the
 * pending tool read off the agent's screen (`terminal_tool_row.rs`). Answered question cards are the
 * cards area's (`../cards/QuestionExchangeCards.tsx`). Which card a row is comes from the core; this file only lays it out.
 */

import { memo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { useNativeChatUi, useTranscriptEnv } from './context';
import { Chevron, DisclosureHeading, LaneMarker } from './Disclosure';
import { Glyph, type GlyphName } from './icons';
import { arr, obj, str, type JsonRecord } from './json';
import { Markdown } from './markdown/Markdown';
import { useDisclosure } from './state';
import { MONO_FONT, PROSE_LINE, PROSE_SIZE } from './theme';

/** Collapsed, a goal shows this many lines of its objective and an agent message this many of its body. */
const GOAL_PREVIEW_LINES = 3;
const MESSAGE_PREVIEW_LINES = 2;
/** The transcript column fits roughly this many characters (`thinking.rs`). */
const WRAP_COLUMNS = 48;

export function estimatedLines(text: string): number {
  return text.split('\n').reduce((total, line) => total + 1 + Math.floor(line.length / WRAP_COLUMNS), 0);
}

/** The status card shell (`cards.rs`): a rounded panel, its header, body column and footer band. */
export function StatusCard({ header, children, footer }: { header: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  const { theme } = useTranscriptEnv();
  const panel = theme.light ? '#fefefe' : '#1f1f1f';
  const footerTone = theme.light ? '#fdfdfd' : '#161616';
  return (
    <View
      style={[
        styles.card,
        { borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.08)', backgroundColor: footer !== undefined ? footerTone : panel },
      ]}
    >
      <View style={[styles.cardPanel, footer !== undefined && { backgroundColor: panel }]}>
        {header}
        {children !== undefined && children !== null ? <View style={styles.cardBody}>{children}</View> : null}
      </View>
      {footer !== undefined ? (
        <View style={[styles.cardFooter, { borderTopColor: theme.light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)' }]}>{footer}</View>
      ) : null}
    </View>
  );
}

function CardHeader({ glyph, title, trailing }: { glyph: GlyphName; title: ReactNode; trailing?: ReactNode }) {
  const { theme } = useTranscriptEnv();
  return (
    <View style={styles.cardHeader}>
      <View style={styles.cardGlyph}>
        <Glyph name={glyph} size={14} color={theme.muted} />
      </View>
      <View style={styles.cardTitle}>{typeof title === 'string' ? <Text style={[styles.prose, { color: theme.foreground }]}>{title}</Text> : title}</View>
      {trailing}
    </View>
  );
}

function CardChevron({ open, onPress }: { open: boolean; onPress(): void }) {
  const { theme } = useTranscriptEnv();
  return (
    <Pressable hitSlop={8} onPress={onPress} accessibilityRole='button' accessibilityState={{ expanded: open }} style={styles.cardChevron}>
      <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={14} color={theme.muted} />
    </Pressable>
  );
}

// ---- system cards --------------------------------------------------------------------------

export const SystemCard = memo(function SystemCard({ message }: { message: ProjectedMessage }) {
  const card = obj(message.systemCard);
  if (card === null) return null;
  switch (str(card, 'kind')) {
    case 'auto-named':
      return <AutoNamedCard card={card} />;
    case 'fork-boundary':
      return <ForkBoundary card={card} />;
    case 'goal':
      return <GoalCard id={message.id} card={card} />;
    case 'command-output':
      return <CommandOutputCard id={message.id} card={card} />;
    case 'agent-message':
      return <AgentMessageCard id={message.id} card={card} references={message.markdownReferences} />;
    default:
      return <SystemMarker card={card} />;
  }
});

function AutoNamedCard({ card }: { card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  return (
    <View style={styles.autoNamedRow}>
      <View style={[styles.autoNamed, { borderColor: theme.border, backgroundColor: theme.input }]}>
        <View style={styles.autoNamedGlyph}>
          <Glyph name={card.userRenamed === true ? 'pencil' : 'sparkles'} size={16} color={theme.muted} />
        </View>
        <View style={styles.autoNamedText}>
          <Text style={[styles.prose, styles.medium, { color: theme.foreground }]}>{str(card, 'lead')}</Text>
          <Text style={[styles.small, { color: theme.cardMuted }]}>
            New name: <Text style={{ color: theme.foreground }}>{str(card, 'title')}</Text>
          </Text>
        </View>
      </View>
    </View>
  );
}

function ForkBoundary({ card }: { card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  return (
    <View style={styles.forkBoundary}>
      <View style={[styles.forkRule, { backgroundColor: theme.border }]} />
      <Glyph name='git-branch' size={14} color={theme.muted} />
      <Text style={[styles.prose, { color: theme.muted }]}>{str(card, 'text')}</Text>
      <View style={[styles.forkRule, { backgroundColor: theme.border }]} />
    </View>
  );
}

function GoalCard({ id, card }: { id: string; card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `goal:${id}`);
  const status = str(card, 'status');
  const usage = str(card, 'usage');
  const objective = str(card, 'objective');
  const expandable = estimatedLines(objective) > GOAL_PREVIEW_LINES;
  const limited = status === 'stalled' || status === 'usage limited' || status === 'limited by budget';
  const pill = limited ? '#fb7185' : theme.cardMuted;
  return (
    <StatusCard
      header={
        <CardHeader
          glyph='focus-2'
          title={
            <View style={styles.goalTitle}>
              <Text style={[styles.prose, { color: theme.foreground }]}>Goal</Text>
              {status.length > 0 ? (
                <View style={[styles.goalPill, { backgroundColor: limited ? 'rgba(251,113,133,0.15)' : 'rgba(180,184,191,0.15)' }]}>
                  <Text style={[styles.goalPillText, { color: pill }]}>{status}</Text>
                </View>
              ) : null}
            </View>
          }
          trailing={
            <>
              {usage.length > 0 ? <Text style={[styles.small, { color: theme.muted }]}>{usage}</Text> : null}
              {expandable ? <CardChevron open={open} onPress={toggle} /> : null}
            </>
          }
        />
      }
    >
      {objective.length > 0 ? (
        <Text numberOfLines={expandable && !open ? GOAL_PREVIEW_LINES : undefined} style={[styles.prose, { color: theme.cardMuted }]}>
          {objective}
        </Text>
      ) : null}
    </StatusCard>
  );
}

function CommandOutputCard({ id, card }: { id: string; card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  // Open by default: the reader asked for the command, so its output is the row.
  const [open, toggle] = useDisclosure(disclosures, `command-output:${id}`, true);
  const output = str(card, 'output');
  return (
    <View style={[styles.commandCard, { borderColor: theme.border, backgroundColor: theme.input }]}>
      <View style={styles.commandHeader}>
        <DisclosureHeading label={str(card, 'command')} open={open} onToggle={toggle} color={theme.cardMuted} medium />
      </View>
      {open && output.length > 0 ? (
        <ScrollView nestedScrollEnabled style={[styles.commandBody, { borderTopColor: theme.border }]}>
          <Text selectable style={[styles.commandText, { color: theme.cardMuted }]}>
            {output}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function AgentMessageCard({ id, card, references }: { id: string; card: JsonRecord; references: unknown }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `agent-message:${id}`);
  const body = str(card, 'body');
  const marked = str(card, 'markdown');
  const expandable = estimatedLines(body) > MESSAGE_PREVIEW_LINES;
  return (
    <StatusCard
      header={
        <CardHeader
          glyph='message-report'
          title={`Received a message from “${str(card, 'name')}” subagent`}
          trailing={expandable ? <CardChevron open={open} onPress={toggle} /> : undefined}
        />
      }
    >
      {body.length === 0 ? null : open ? (
        <Markdown text={marked.length > 0 ? marked : body} references={references} color={theme.cardMuted} />
      ) : (
        <Text numberOfLines={MESSAGE_PREVIEW_LINES} style={[styles.prose, { color: theme.cardMuted }]}>
          {body}
        </Text>
      )}
    </StatusCard>
  );
}

function SystemMarker({ card }: { card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  return <Text style={[styles.prose, styles.markerRow, { color: theme.muted }]}>{str(card, 'text')}</Text>;
}

// ---- harness-injected turns ----------------------------------------------------------------

/** The tone table React's status rows read (`status-tone.json`). */
const TONES: { [tone: string]: { glyph: GlyphName; color: string | null } } = {
  ok: { glyph: 'check', color: '#34d399' },
  error: { glyph: 'alert-triangle', color: '#fb7185' },
  neutral: { glyph: 'info-circle', color: null },
};

export const SuppressedRow = memo(function SuppressedRow({ message }: { message: ProjectedMessage }) {
  const suppressed = obj(message.suppressed);
  if (suppressed === null) return null;
  switch (str(suppressed, 'kind')) {
    case 'status':
      return <StatusRows suppressed={suppressed} />;
    case 'inline':
      return <InlineSuppressed suppressed={suppressed} />;
    default:
      return <CollapsedSuppressed id={message.id} suppressed={suppressed} />;
  }
});

function StatusRows({ suppressed }: { suppressed: JsonRecord }) {
  const listed = arr(suppressed.statuses).map((status) => obj(status)).filter((status): status is JsonRecord => status !== null);
  const statuses = listed.length > 0 ? listed : [{ label: suppressed.label, tone: suppressed.tone } as JsonRecord];
  return (
    <View style={styles.statusColumn}>
      {statuses.map((status, index) => (
        <StatusPill key={index} label={str(status, 'label')} detail={str(status, 'detail')} tone={str(status, 'tone')} />
      ))}
    </View>
  );
}

function StatusPill({ label, detail, tone }: { label: string; detail: string; tone: string }) {
  const { theme } = useTranscriptEnv();
  const spec = TONES[tone] ?? TONES.ok!;
  const color = spec.color ?? theme.cardMuted;
  return (
    <View style={[styles.statusPill, { borderColor: theme.border, backgroundColor: theme.input }]}>
      <View style={[styles.statusBadge, { backgroundColor: spec.color !== null ? `${spec.color}26` : theme.border }]}>
        <Glyph name={spec.glyph} size={10} color={color} strokeWidth={2.4} />
      </View>
      <View style={styles.statusText}>
        <Text style={[styles.statusLabel, { color: theme.muted }]}>{label}</Text>
        {detail.length > 0 ? (
          <View style={[styles.statusDetail, { borderColor: theme.border }]}>
            <Text style={[styles.statusDetailText, { color: theme.muted }]}>{detail}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function InlineSuppressed({ suppressed }: { suppressed: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  return (
    <View style={styles.lane}>
      <LaneMarker color={theme.muted} />
      <Text style={[styles.prose, styles.laneText, { color: theme.muted }]}>
        <Text style={styles.semibold}>{`${str(suppressed, 'label')} · `}</Text>
        {str(suppressed, 'text')}
      </Text>
    </View>
  );
}

function CollapsedSuppressed({ id, suppressed }: { id: string; suppressed: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `suppressed:${id}`);
  const body = str(suppressed, 'text');
  return (
    <View style={styles.collapsed}>
      <DisclosureHeading label={str(suppressed, 'label')} open={open} onToggle={toggle} color={theme.muted} />
      {open && body.length > 0 ? (
        <ScrollView nestedScrollEnabled style={[styles.suppressedBody, { borderColor: theme.border, backgroundColor: theme.input }]}>
          <Text selectable style={[styles.commandText, { color: theme.muted }]}>
            {body}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

// ---- another agent's message, delivery, the terminal's pending tool ------------------------

/**
 * A send that failed, with Retry and Remove. `waitingLine` also writes "Waiting for agent…" for a
 * card without the delivery indicator (`MessageActions.tsx`) that a user bubble has.
 */
export function StartupDelivery({ message, waitingLine = true }: { message: ProjectedMessage; waitingLine?: boolean }) {
  const { theme, dispatch } = useTranscriptEnv();
  const delivery = message.startupDelivery;
  if (delivery === undefined || delivery === null) return null;
  const failed = delivery.state === 'failed';
  if (!failed && !waitingLine) return null;
  const status = failed ? (delivery.errorMessage?.length ? delivery.errorMessage : 'Message could not be delivered.') : 'Waiting for agent…';
  return (
    <View style={styles.delivery} accessibilityRole='text'>
      <Text style={[styles.small, { color: theme.muted }]}>{status}</Text>
      {failed ? (
        <>
          <Pressable style={styles.deliveryAction} onPress={() => dispatch({ type: 'retryQueue', promptId: delivery.promptId })}>
            <Text style={[styles.small, { color: theme.primary }]}>Retry</Text>
          </Pressable>
          <Pressable style={styles.deliveryAction} onPress={() => dispatch({ type: 'removeQueue', promptId: delivery.promptId })}>
            <Text style={[styles.small, { color: theme.primary }]}>Remove</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

/**
 * The header of a message card (`message_header` in desktop `inter_agent_message.rs`): the message
 * icon, the title with its session beside it, a tag, and the chevron. The whole header is the toggle
 * when the card has more to show.
 */
function MessageCardHeader({
  title,
  detail,
  tag,
  expandable,
  open,
  onToggle,
}: {
  title: string;
  detail: string;
  tag?: { label: string; color: string };
  expandable: boolean;
  open: boolean;
  onToggle(): void;
}) {
  const { theme } = useTranscriptEnv();
  return (
    <Pressable
      disabled={!expandable}
      onPress={onToggle}
      accessibilityRole={expandable ? 'button' : undefined}
      accessibilityState={expandable ? { expanded: open } : undefined}
      style={styles.cardHeader}
    >
      <View style={styles.cardGlyph}>
        <Glyph name='message-report' size={14} color={theme.muted} />
      </View>
      <Text style={[styles.prose, styles.cardTitle, { color: theme.foreground }]}>
        {title}
        {detail.length > 0 ? <Text style={{ color: theme.muted }}>{`  ${detail}`}</Text> : null}
      </Text>
      {tag !== undefined ? <Text style={[styles.queued, { color: tag.color }]}>{tag.label}</Text> : null}
      {expandable ? (
        <View style={styles.cardChevron}>
          <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={14} color={theme.muted} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Collapsed to its first two lines; the header or the preview opens it (desktop `inter_agent_message_card`). */
export const InterAgentCard = memo(function InterAgentCard({ message }: { message: ProjectedMessage }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [openState, toggle] = useDisclosure(disclosures, `inter-agent:${message.id}`);
  const sent = obj(message.interAgentMessage);
  const body = str(sent, 'body');
  const expandable = estimatedLines(body) > MESSAGE_PREVIEW_LINES;
  const open = expandable && openState;
  const hasDelivery = message.startupDelivery !== undefined && message.startupDelivery !== null;
  return (
    <StatusCard
      header={
        <MessageCardHeader
          title={`Message from ${str(sent, 'agentName')}`}
          detail={str(sent, 'sessionTitle')}
          {...(message.queued === true ? { tag: { label: 'QUEUED', color: theme.muted } } : {})}
          expandable={expandable}
          open={open}
          onToggle={toggle}
        />
      }
      footer={hasDelivery ? <StartupDelivery message={message} /> : undefined}
    >
      {body.length === 0 ? null : expandable && !open ? (
        <Pressable onPress={toggle} accessibilityRole='button' accessibilityState={{ expanded: false }}>
          <Text numberOfLines={MESSAGE_PREVIEW_LINES} style={[styles.prose, { color: theme.cardMuted }]}>
            {body}
          </Text>
        </Pressable>
      ) : (
        <Markdown text={body} references={message.markdownReferences} color={theme.cardMuted} />
      )}
    </StatusCard>
  );
});

/**
 * The messages this session's agent sent other agents, collapsed to their headers (desktop
 * `sent_agent_message_cards`). Which calls these are and whom they went to comes from the core.
 */
export function SentAgentMessageCards({ cards }: { cards: unknown }) {
  const list = arr(cards)
    .map((card) => obj(card))
    .filter((card): card is JsonRecord => card !== null);
  if (list.length === 0) return null;
  return (
    <View style={styles.sentColumn}>
      {list.map((card) => (
        <SentAgentMessageCard key={str(card, 'key')} card={card} />
      ))}
    </View>
  );
}

const SentAgentMessageCard = memo(function SentAgentMessageCard({ card }: { card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [openState, toggle] = useDisclosure(disclosures, `sent-message:${str(card, 'key')}`);
  const marked = str(card, 'markdown');
  const body = marked.length > 0 ? marked : str(card, 'body');
  const expandable = body.length > 0;
  const open = expandable && openState;
  return (
    <StatusCard
      header={
        <MessageCardHeader
          title={str(card, 'title')}
          detail={str(card, 'detail')}
          {...(card.failed === true ? { tag: { label: 'NOT SENT', color: theme.error } } : {})}
          expandable={expandable}
          open={open}
          onToggle={toggle}
        />
      }
    >
      {open ? <Markdown text={body} references={card.markdownReferences} color={theme.cardMuted} /> : null}
    </StatusCard>
  );
});

/** One key for every card, so the next pending tool comes up the way the last one was left. */
const TERMINAL_TOOL_KEY = 'terminal-tool';

export const TerminalToolRow = memo(function TerminalToolRow({ activity }: { activity: unknown }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [openState, toggle] = useDisclosure(disclosures, TERMINAL_TOOL_KEY);
  const detail = str(activity, 'detail').trim();
  const expandable = detail.length > 0;
  const open = expandable && openState;
  return (
    <StatusCard
      header={
        <Pressable disabled={!expandable} onPress={toggle} style={styles.cardHeader} accessibilityState={{ expanded: open }}>
          <View style={styles.cardGlyph}>
            <View style={[styles.toolDot, { backgroundColor: theme.cardMuted }]} />
          </View>
          <Text style={[styles.prose, styles.cardTitle, { color: theme.foreground }]}>{str(activity, 'label')}</Text>
          {expandable ? <Chevron open={open} color={theme.muted} /> : null}
        </Pressable>
      }
    >
      {open ? (
        <ScrollView nestedScrollEnabled style={[styles.terminalDetail, { backgroundColor: theme.input }]}>
          <Text selectable style={[styles.commandText, { color: theme.prose }]}>
            {detail}
          </Text>
        </ScrollView>
      ) : null}
    </StatusCard>
  );
});

const styles = StyleSheet.create({
  prose: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  small: { fontSize: 12, lineHeight: 17 },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', minWidth: 0 },
  cardPanel: { paddingHorizontal: 16, paddingVertical: 12 },
  cardBody: { paddingTop: 8, gap: 12 },
  cardFooter: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardGlyph: { height: PROSE_LINE, justifyContent: 'center' },
  cardTitle: { flex: 1, minWidth: 0 },
  cardChevron: { width: 22, height: PROSE_LINE, alignItems: 'center', justifyContent: 'center' },
  sentColumn: { gap: 8, minWidth: 0 },
  autoNamedRow: { flexDirection: 'row', paddingBottom: 8 },
  autoNamed: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: 1, flexShrink: 1 },
  autoNamedGlyph: { marginTop: 2 },
  autoNamedText: { gap: 2, flexShrink: 1 },
  forkBoundary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 12 },
  forkRule: { height: 1, flex: 1 },
  goalTitle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  goalPill: { borderRadius: 999, paddingHorizontal: 6 },
  goalPillText: { fontSize: 11, fontWeight: '500' },
  commandCard: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  commandHeader: { paddingHorizontal: 12, paddingVertical: 8 },
  commandBody: { maxHeight: 384, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  commandText: { fontFamily: MONO_FONT, fontSize: 12, lineHeight: 19.5 },
  markerRow: { paddingBottom: 8 },
  statusColumn: { alignItems: 'flex-start', gap: 6 },
  statusPill: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' },
  statusBadge: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statusText: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, flexShrink: 1 },
  statusLabel: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  statusDetail: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6 },
  statusDetailText: { fontFamily: MONO_FONT, fontSize: 11 },
  lane: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingBottom: 13 },
  laneText: { flex: 1 },
  collapsed: { gap: 6, paddingBottom: 8 },
  suppressedBody: { maxHeight: 400, padding: 10, borderRadius: 8, borderWidth: 1 },
  delivery: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  deliveryAction: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  queued: { fontSize: 11, marginTop: 4 },
  toolDot: { width: 7, height: 7, borderRadius: 4 },
  terminalDetail: { maxHeight: 300, padding: 10, borderRadius: 6 },
  exchanges: { gap: 12, paddingVertical: 6 },
  exchange: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  exchangeSection: { gap: 6, paddingHorizontal: 16, paddingVertical: 14 },
  exchangeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  microLabel: { fontSize: 11, fontWeight: '600' },
  micro: { fontSize: 10 },
  counter: { borderRadius: 5, paddingHorizontal: 5 },
  counterText: { fontSize: 10 },
  answers: { gap: 6, paddingTop: 6 },
  unanswered: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  optionsToggle: { paddingTop: 4 },
  option: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  answerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  answerCheck: { marginTop: 3 },
  answerText: { flex: 1, minWidth: 0, gap: 2 },
});

