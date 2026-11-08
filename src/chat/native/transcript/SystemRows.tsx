/**
 * The transcript rows that are cards or quiet lines rather than prose: system cards
 * (`system_cards.rs`), harness-injected turns (`status_rows.rs`), a send still waiting for the terminal (`startup_delivery.rs`) and the
 * pending tool read off the agent's screen (`terminal_tool_row.rs`). Messages between agents are
 * `AgentMessageCards.tsx`'s. Answered question cards are the
 * cards area's (`../cards/QuestionExchangeCards.tsx`). Which card a row is comes from the core; this file only lays it out.
 */

import { memo, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { useNativeChatUi, useTranscriptEnv, useTranscriptFlags } from './context';
import { DisclosureHeading, LaneMarker } from './Disclosure';
import { Glyph, type GlyphName } from './icons';
import { arr, obj, str, type JsonRecord } from './json';
import { useDisclosure } from './state';
import { SubagentMessageCard, toneColor } from './AgentMessageCards';
import { Markdown } from './markdown/Markdown';
import {
  SINGLE_LINE_CARD,
  SINGLE_LINE_HEADER_HEIGHT,
  SINGLE_LINE_TITLE,
  SingleLinePill,
  SingleLineTile,
  singleLinePressed,
  singleLineShell,
} from './singleLineCard';
import { MONO_FONT, PROSE_LINE, PROSE_SIZE, type TranscriptTheme } from './theme';
import { ROW_GAP } from './cardSpacing';

/** Collapsed, a goal shows this many lines of its objective. */
const GOAL_PREVIEW_LINES = 3;
/** The transcript column fits roughly this many characters (`thinking.rs`). */
const WRAP_COLUMNS = 48;

export function estimatedLines(text: string): number {
  return text.split('\n').reduce((total, line) => total + 1 + Math.floor(line.length / WRAP_COLUMNS), 0);
}

/** The status card shell (`cards.rs`): a rounded panel, its header, body column and footer band. */
export function StatusCard({
  header,
  children,
  footer,
}: {
  header: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const { theme } = useTranscriptEnv();
  const panel = theme.light ? '#fefefe' : '#1f1f1f';
  const footerTone = theme.light ? '#fdfdfd' : '#161616';
  return (
    <View
      style={[
        styles.card,
        {
          borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.08)',
          backgroundColor: footer !== undefined ? footerTone : panel,
        },
      ]}
    >
      <View style={[styles.cardPanel, footer !== undefined && { backgroundColor: panel }]}>
        {header}
        {children !== undefined && children !== null ? <View style={styles.cardBody}>{children}</View> : null}
      </View>
      {footer !== undefined ? (
        <View
          style={[styles.cardFooter, { borderTopColor: theme.light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)' }]}
        >
          {footer}
        </View>
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
      <View style={styles.cardTitle}>
        {typeof title === 'string' ? <Text style={[styles.prose, { color: theme.foreground }]}>{title}</Text> : title}
      </View>
      {trailing}
    </View>
  );
}

function CardChevron({ open, onPress }: { open: boolean; onPress(): void }) {
  const { theme } = useTranscriptEnv();
  return (
    <Pressable
      hitSlop={8}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={styles.cardChevron}
    >
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
      return <SubagentMessageCard id={message.id} card={card} references={message.markdownReferences} />;
    case 'advisor':
      return <AdvisorCard id={message.id} card={card} />;
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
      <Glyph name="git-branch" size={14} color={theme.muted} />
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
          glyph="focus-2"
          title={
            <View style={styles.goalTitle}>
              <Text style={[styles.prose, { color: theme.foreground }]}>Goal</Text>
              {status.length > 0 ? (
                <View
                  style={[
                    styles.goalPill,
                    { backgroundColor: limited ? 'rgba(251,113,133,0.15)' : 'rgba(180,184,191,0.15)' },
                  ]}
                >
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
        <Text
          numberOfLines={expandable && !open ? GOAL_PREVIEW_LINES : undefined}
          style={[styles.prose, { color: theme.cardMuted }]}
        >
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

/** An advisor severity's glyph, named by the core (`ADVISOR_RANKS` in gx-chat-core `transcript/system_cards.rs`). */
function advisorGlyph(icon: string): GlyphName {
  return icon === 'alert-octagon' || icon === 'alert-triangle' || icon === 'bulb' ? icon : 'info-circle';
}

/** An advisor severity's colour: the message cards' red and amber, otherwise the card's muted text. */
function advisorTone(tone: string, theme: TranscriptTheme): string {
  return tone === 'failed' || tone === 'waiting' ? toneColor(tone, theme) : theme.cardMuted;
}

/** A light card keeps red and amber severity words in its ink, with the tone on the icon. */
function advisorLabel(tone: string, theme: TranscriptTheme): string {
  return theme.light && (tone === 'failed' || tone === 'waiting') ? theme.foreground : advisorTone(tone, theme);
}

/**
 * OMP's advisor notes (desktop `advisor_card` in `system_cards.rs`): one 44pt row (the info tile,
 * "Advisor shared notes" and the core's count of each severity as a pill) that opens to every note below a
 * hairline, each with its severity word and icon in its tone and its text as Markdown. A light appearance
 * keeps red and amber words in the card's ink (`advisorLabel`). The core
 * decides the notes, their order (worst first), their words and tones; this lays them out in the
 * one-line card every transcript card shares (`singleLineCard.tsx`).
 *
 * CDXC:SessionChat WHY: the phone row leaves the time out so the pills have room. With more than two severities, or whenever the pills measure wider than the room beside the title (large text, a narrow screen), it shows only the worst severity's pill and a neutral "+N" for the other notes, the count OMP's own "+N more notes" gives; opening the card still lists every note. Until two pills are measured they show side by side.
 */
function AdvisorCard({ id, card }: { id: string; card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `advisor:${id}`);
  const [room, setRoom] = useState<number | null>(null);
  const [needed, setNeeded] = useState<number | null>(null);
  // Read once per card: the width reports re-render the card without changing what it says.
  const { counts, notes, others } = useMemo(() => {
    const counts = arr(card.counts)
      .map((count) => obj(count))
      .filter((count): count is JsonRecord => count !== null);
    const notes = arr(card.notes)
      .map((note) => obj(note))
      .filter((note): note is JsonRecord => note !== null);
    const worstSeverity = str(counts[0], 'severity');
    let others = 0;
    for (const note of notes) if (str(note, 'severity') !== worstSeverity) others += 1;
    return { counts, notes, others };
  }, [card]);
  const worst = counts[0];
  const folded = counts.length > 2 || (room !== null && needed !== null && needed > room);
  const hairline = theme.ink(theme.light ? 0.08 : 0.05);
  const pill = (count: JsonRecord, index: number) => (
    <SingleLinePill
      key={index}
      icon={advisorGlyph(str(count, 'icon'))}
      label={str(count, 'label')}
      color={advisorTone(str(count, 'tone'), theme)}
      labelColor={advisorLabel(str(count, 'tone'), theme)}
    />
  );
  return (
    <View style={[styles.advisorCard, singleLineShell(theme)]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={str(card, 'title')}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.advisorRow, pressed && singleLinePressed(theme)]}
      >
        <SingleLineTile glyph="info-circle" />
        <Text style={[SINGLE_LINE_TITLE, styles.advisorName, { color: theme.foreground }]} numberOfLines={1}>
          {str(card, 'name')}
        </Text>
        <View style={styles.advisorPills} onLayout={(event) => setRoom(event.nativeEvent.layout.width)}>
          {counts.length === 2 ? (
            <View
              pointerEvents="none"
              style={styles.advisorMeasure}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={styles.advisorPillRow} onLayout={(event) => setNeeded(event.nativeEvent.layout.width)}>
                {counts.map(pill)}
              </View>
            </View>
          ) : null}
          {folded && worst !== undefined ? (
            <>
              {pill(worst, 0)}
              <SingleLinePill label={`+${others}`} color={theme.cardMuted} />
            </>
          ) : (
            counts.map(pill)
          )}
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.advisorNotes, { borderTopColor: hairline }]}>
          {notes.map((note, index) => {
            const tone = advisorTone(str(note, 'tone'), theme);
            return (
              <View key={index} style={styles.advisorNote}>
                <View style={styles.advisorSeverity}>
                  <Glyph name={advisorGlyph(str(note, 'icon'))} size={13} color={tone} />
                  <Text style={[styles.advisorSeverityText, { color: advisorLabel(str(note, 'tone'), theme) }]}>
                    {str(note, 'label')}
                  </Text>
                </View>
                <View style={styles.advisorNoteText}>
                  <Markdown text={str(note, 'markdown')} references={note.references} color={theme.cardMuted} />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function SystemMarker({ card }: { card: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  return <Text style={[styles.prose, styles.markerRow, { color: theme.muted }]}>{str(card, 'text')}</Text>;
}

// ---- harness-injected turns ----------------------------------------------------------------

/** The status tones' colours (`status-tone.json`); a trailing fact takes its tone's, a neutral one muted. */
const TONE_COLORS: { [tone: string]: string | null } = { ok: '#34d399', error: '#fb7185', neutral: null };

/** What a status card's tile shows (`subject` from the core's `suppressed_turn_presentation`). */
function subjectGlyph(subject: string): GlyphName {
  if (subject === 'compaction') return 'arrows-diagonal-minimize';
  if (subject === 'command') return 'terminal-2';
  return 'adjustments-horizontal';
}

export const SuppressedRow = memo(function SuppressedRow({ message }: { message: ProjectedMessage }) {
  const suppressed = obj(message.suppressed);
  if (suppressed === null) return null;
  switch (str(suppressed, 'kind')) {
    case 'status':
      return <StatusRows id={message.id} suppressed={suppressed} />;
    case 'inline':
      return <InlineSuppressed suppressed={suppressed} />;
    default:
      return <CollapsedSuppressed id={message.id} suppressed={suppressed} />;
  }
});

/**
 * A slash command's output with more than one line (`expandable`, core `command_output_note`)
 * shows its first line, and a tap opens the whole output under it (desktop `expandable_status`).
 */
function StatusRows({ id, suppressed }: { id: string; suppressed: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const expandable = suppressed.expandable === true;
  const [open, toggle] = useDisclosure(disclosures, `suppressed:${id}`);
  const body = str(suppressed, 'text');
  const listed = arr(suppressed.statuses)
    .map((status) => obj(status))
    .filter((status): status is JsonRecord => status !== null);
  const statuses = listed.length > 0 ? listed : [{ label: suppressed.label, tone: suppressed.tone } as JsonRecord];
  const glyph = subjectGlyph(str(suppressed, 'subject'));
  return (
    <View style={styles.statusColumn}>
      {statuses.map((status, index) => (
        <StatusRowCard
          key={index}
          glyph={glyph}
          label={str(status, 'label')}
          detail={str(status, 'detail')}
          tone={str(status, 'tone')}
          {...(expandable ? { onPress: toggle } : {})}
        />
      ))}
      {expandable && open && body.length > 0 ? (
        <ScrollView
          nestedScrollEnabled
          style={[styles.suppressedBody, { borderColor: theme.border, backgroundColor: theme.input }]}
        >
          <Text selectable style={[styles.commandText, { color: theme.muted }]}>
            {body}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

/**
 * A status as a one-line card (desktop `status_row` in `status_rows.rs`): a tile for what it is
 * about with its tone as the badge (a green check, a red cross, none when neutral), the sentence on
 * one line, and a trailing fact such as "exit code 1" as a pill. Holding the card shows the whole
 * sentence above it, so the card keeps its height.
 */
function StatusRowCard({
  glyph,
  label,
  detail,
  tone,
  onPress,
}: {
  glyph: GlyphName;
  label: string;
  detail: string;
  tone: string;
  onPress?: () => void;
}) {
  const { theme } = useTranscriptEnv();
  const [held, setHeld] = useState(false);
  const badge = tone === 'error' ? 'error' : tone === 'neutral' ? undefined : 'check';
  const detailColor = tone === 'error' ? (TONE_COLORS.error ?? theme.cardMuted) : theme.cardMuted;
  return (
    <View>
      <Pressable
        {...(onPress !== undefined ? { onPress } : {})}
        onLongPress={() => setHeld(true)}
        onPressOut={() => setHeld(false)}
        accessibilityRole="text"
        accessibilityLabel={detail.length > 0 ? `${label}, ${detail}` : label}
        style={[styles.statusCard, singleLineShell(theme)]}
      >
        <SingleLineTile glyph={glyph} {...(badge !== undefined ? { badge } : {})} />
        <Text
          style={[SINGLE_LINE_TITLE, styles.statusLabel, { color: theme.foreground }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        {detail.length > 0 ? <SingleLinePill label={detail} color={detailColor} /> : null}
      </Pressable>
      {held ? (
        <View
          pointerEvents="none"
          style={[styles.statusBubble, { borderColor: theme.inputBorder, backgroundColor: theme.cardPanel }]}
        >
          <Text style={[styles.statusBubbleText, { color: theme.foreground }]}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

function InlineSuppressed({ suppressed }: { suppressed: JsonRecord }) {
  const { theme } = useTranscriptEnv();
  const body = str(suppressed, 'text');
  return (
    <View style={styles.lane}>
      <LaneMarker color={theme.muted} />
      <Text style={[styles.prose, styles.laneText, { color: theme.muted }]}>
        <Text style={styles.semibold}>
          {body.length > 0 ? `${str(suppressed, 'label')} · ` : str(suppressed, 'label')}
        </Text>
        {body}
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
        <ScrollView
          nestedScrollEnabled
          style={[styles.suppressedBody, { borderColor: theme.border, backgroundColor: theme.input }]}
        >
          <Text selectable style={[styles.commandText, { color: theme.muted }]}>
            {body}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

// ---- delivery, the terminal's pending tool --------------------------------------------------

/**
 * A send that failed, with Retry and Remove. `waitingLine` also writes "Waiting for agent…" for a
 * card without the delivery indicator (`MessageActions.tsx`) that a user bubble has.
 */
export function StartupDelivery({ message, waitingLine = true }: { message: ProjectedMessage; waitingLine?: boolean }) {
  const { theme, dispatch } = useTranscriptEnv();
  const { canRemoveQueued, sendFailureCardPromptId } = useTranscriptFlags();
  const delivery = message.startupDelivery;
  if (delivery === undefined || delivery === null) return null;
  // A message held on another computer while the session's computer is offline (gx-chat-core
  // `session/computer.rs`; desktop: startup_delivery.rs): "Will send when Windows PC is back" and
  // Cancel, which puts it back in the chat box. Its delivery shows "Sending to …" with no Cancel.
  if (delivery.state === 'held') {
    const reason = delivery.waitReason ?? '';
    const sending = reason.startsWith('Sending');
    return (
      <View style={styles.delivery} accessibilityRole="text">
        <Text style={[styles.small, { color: theme.muted }]}>{reason}</Text>
        {sending ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [
              styles.deliveryAction,
              { backgroundColor: pressed ? theme.neutralFillPressed : theme.neutralFill },
            ]}
            onPress={() => dispatch({ type: 'removeQueue', promptId: delivery.promptId })}
          >
            <Text style={[styles.small, { color: theme.primary }]}>Cancel</Text>
          </Pressable>
        )}
      </View>
    );
  }
  const failed = delivery.state === 'failed';
  // The card that stands for this row has the reason and Retry (desktop: startup_delivery.rs).
  const onCard = failed && delivery.promptId === sendFailureCardPromptId;
  // Why gxserver still holds it, once it has waited about a minute (desktop: startup_delivery.rs).
  const reason = delivery.waitReason ?? '';
  if (!failed && !waitingLine && reason.length === 0) return null;
  // A held row that says why can go from here too, and a send that left the queue unconfirmed has only this line (desktop: startup_delivery.rs).
  const removable =
    delivery.state === 'unconfirmed' || (delivery.state === 'queued' && reason.length > 0 && canRemoveQueued);
  const status = onCard
    ? 'Not sent'
    : failed
      ? delivery.errorMessage?.length
        ? delivery.errorMessage
        : 'Message could not be delivered.'
      : reason.length > 0
        ? reason
        : 'Waiting for agent…';
  return (
    <View style={styles.delivery} accessibilityRole="text">
      <Text style={[styles.small, { color: theme.muted }]}>{status}</Text>
      {failed ? (
        <>
          {onCard ? null : (
            <Pressable
              style={({ pressed }) => [
                styles.deliveryAction,
                { backgroundColor: pressed ? theme.neutralFillPressed : theme.neutralFill },
              ]}
              onPress={() => dispatch({ type: 'retryQueue', promptId: delivery.promptId })}
            >
              <Text style={[styles.small, { color: theme.primary }]}>Retry</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.deliveryAction,
              { backgroundColor: pressed ? theme.neutralFillPressed : theme.neutralFill },
            ]}
            onPress={() => dispatch({ type: 'removeQueue', promptId: delivery.promptId })}
          >
            <Text style={[styles.small, { color: theme.primary }]}>Remove</Text>
          </Pressable>
        </>
      ) : null}
      {removable ? (
        <Pressable
          style={({ pressed }) => [
            styles.deliveryAction,
            { backgroundColor: pressed ? theme.neutralFillPressed : theme.neutralFill },
          ]}
          onPress={() => dispatch({ type: 'removeQueue', promptId: delivery.promptId })}
        >
          <Text style={[styles.small, { color: theme.primary }]}>Remove</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  prose: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  small: { fontSize: 12, lineHeight: 17 },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', minWidth: 0 },
  cardPanel: { paddingHorizontal: 16, paddingVertical: 12 },
  cardBody: { paddingTop: 8, gap: 12 },
  cardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardGlyph: { height: PROSE_LINE, justifyContent: 'center' },
  cardTitle: { flex: 1, minWidth: 0 },
  cardChevron: { width: 22, height: PROSE_LINE, alignItems: 'center', justifyContent: 'center' },
  autoNamedRow: { flexDirection: 'row', paddingBottom: 8 },
  autoNamed: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    flexShrink: 1,
  },
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
  advisorCard: { minWidth: 0 },
  advisorRow: {
    height: SINGLE_LINE_HEADER_HEIGHT,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  advisorName: { flexShrink: 1, minWidth: 0 },
  advisorPills: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  /** The pills side by side without a width limit, drawn invisibly to measure what they need. */
  advisorMeasure: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 10000,
    flexDirection: 'row',
    alignItems: 'flex-start',
    opacity: 0,
  },
  advisorPillRow: { flexDirection: 'row', gap: 6 },
  advisorNotes: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 10 },
  advisorNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 },
  advisorSeverity: { minWidth: 76, height: PROSE_LINE, flexDirection: 'row', alignItems: 'center', gap: 5 },
  advisorSeverityText: { fontSize: 12, fontWeight: '600' },
  /** Bounded beside the severity, so a long code name in a note wraps inside the card. */
  advisorNoteText: { flex: 1, minWidth: 0 },
  markerRow: { paddingBottom: 8 },
  statusColumn: { gap: ROW_GAP, minWidth: 0 },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: SINGLE_LINE_CARD.height,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
    minWidth: 0,
  },
  statusLabel: { flex: 1, minWidth: 0 },
  /** The whole sentence while the card is held, above the card (`WorkingCard.tsx`'s bubble). */
  statusBubble: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: '100%',
    marginBottom: -2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusBubbleText: { fontSize: 13, lineHeight: 18 },
  lane: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingBottom: 13 },
  laneText: { flex: 1 },
  collapsed: { gap: 6, paddingBottom: 8 },
  suppressedBody: { maxHeight: 400, padding: 10, borderRadius: 8, borderWidth: 1 },
  delivery: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  deliveryAction: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
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
  answerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  answerCheck: { marginTop: 3 },
  answerText: { flex: 1, minWidth: 0, gap: 2 },
});
