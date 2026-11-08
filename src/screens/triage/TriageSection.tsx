/**
 * The folded triage (the triage design): on the iPhone Duo's outer display the Sessions list starts with the
 * sessions that wait for the user, the one waiting longest first, each a card with the answer that fits it (rules in
 * `model.ts`). The full list stays below, where these sessions show a second time; a card's head opens its session
 * exactly as its list row does. When nothing waits, one quiet row says so.
 *
 * - Approval: the stored card's Deny and Allow (`approvalAnswer`) or the permission notice's folded rows, with their
 *   labels and answers from the chat core.
 * - Question with options one tap answers: the options, sent as the question card's option row sends them
 *   (`questionOptionAnswer`). Other questions: "Open Question" opens the session at its question card (the
 *   notification's `view=question` link).
 * - Any other waiting session: the short replies of Settings › Short Replies, under the last lines of its screen
 *   (`actions.ts` sends them).
 *
 * A tap locks the card's buttons at once (no second send). An answer is out once the chat takes its card away, a
 * short reply once the computer confirms it; the card then leaves and a message at the bottom says what went to which
 * session. While the computer cannot be reached the card keeps its locked buttons and the chat's reconnecting note.
 * Question text and screen lines stay on this screen: nothing here is logged or notified.
 */

import { useAppearance } from '../../theme/useAppearance';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import { RECONNECTING_NOTE, questionOptionAnswer } from '../../chat/native/cards/answers';
import { Glyph } from '../../chat/native/cards/icons';
import { askColor, tint } from '../../chat/native/cards/askCard';
import { isShellTool, toneLook } from '../../chat/native/cards/ToneCard';
import type * as DeepLinksModule from '../../app/deepLinks';
import { sessionDeepLink } from '../../app/deepLinkHandler';
import type { Notice } from '../../components/common/NoticeToast';
import { runGhostexCli } from '../../components/sessions/cli';
import { sessionChatRpc } from '../../chat/rust/transport';
import { ChevronRightGlyph, CircleCheckGlyph } from '../../components/sessions/icons';
import { STATUS_DOT_SIZE, useSidebarInk } from '../../components/sessions/rows';
import { elapsedLabel } from '../../components/sessions/sessionStatus';
import { OverlappedDots } from '../../components/sessions/StatusDotStack';
import {
  agentIconTint,
  hasQuestion,
  resolveAgentIconId,
  type GhostexSession,
  type GhostexSummaryCapabilities,
} from '../../contract/mobileSummary';
import { TriageCopy, WallCopy } from '../../copy';
import type { MachineRecord } from '../../machines/store';
import { useSettingsStore } from '../../settings/store';
import { acknowledgeSessionAttention } from '../../terminal/attention';
import { attachSessionKey } from '../../terminal/sessions';
import { colorOver, GhostexRadii, neutralButtonFills, SetupPalette } from '../../theme/palette';
import { readableSecondaryText, type SidebarAppearance } from '../../theme/sidebarAppearance';
import { sessionHasChatView, sessionOpensInChatView } from '../terminal-screen/session-lookups';
import { sessionTitle } from '../sessions-screen/session-actions';
import { statusBadge } from '../wall/badge';
import { sendShortReply } from './actions';
import { triageEntry, waitSignature, type TriageEntry, type TriageWait } from './model';
import { useTriageChats, useTriageTails, type TriageChat } from './useTriageData';

/** How often the cards' "waiting 5m" moves on while the triage is shown. */
const CLOCK_TICK_MS = 30_000;
const MONOSPACE = Platform.select({ ios: 'Menlo', default: 'monospace' });
const APPROVAL_HUE = toneLook('approval', false).hue ?? SetupPalette.WARN;

export type TriageSectionProps = {
  /**
   * The list's waiting sessions with their computers, the one waiting longest first (`model.ts`): the classic list's
   * one computer (its workspace and Space) or every computer of the Unified list.
   */
  waiting: readonly TriageWait<MachineRecord>[];
  appearance: SidebarAppearance;
  /** A card's head: the list row's own open. */
  onOpen: (machine: MachineRecord, session: GhostexSession) => void;
  /** The message at the bottom of the screen after a send. */
  onNotice: (notice: Omit<Notice, 'id'>) => void;
};

export default function TriageSection({ waiting, appearance, onOpen, onNotice }: TriageSectionProps) {
  const shortReplies = useSettingsStore((state) => state.settings.shortReplies);
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const chatTargets = useMemo(
    () =>
      waiting
        .filter(
          ({ session, capabilities }) =>
            sessionHasChatView(session) &&
            (session.awaitingApproval ||
              hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer)),
        )
        .map(({ machine, session }) => ({
          key: attachSessionKey(machine.id, session.sessionId),
          machine,
          projectId: session.projectId,
          sessionId: session.sessionId,
        })),
    [waiting],
  );
  const chats = useTriageChats(chatTargets);

  /** Sessions answered here, by key, with the wait they were answered in: hidden until the computer's list moves on. */
  const [answered, setAnswered] = useState<Readonly<Record<string, string>>>({});
  const cards = waiting.map(({ machine, session, capabilities }) => {
    const key = attachSessionKey(machine.id, session.sessionId);
    return {
      key,
      machine,
      capabilities,
      session,
      signature: waitSignature(session, capabilities),
      chat: chats[key],
      entry: triageEntry(session, capabilities, chats[key]?.document ?? null),
    };
  });
  // A card the chat still shows (a new approval or question) comes back even in the same wait.
  const shown = cards.filter(
    ({ key, signature, entry }) =>
      answered[key] !== signature || entry.kind === 'approval' || entry.kind === 'question',
  );
  const waits = cards.map(({ key, signature }) => `${key}\t${signature}`).join('\n');
  useEffect(() => {
    const now = new Set(waits.split('\n'));
    setAnswered((current) => {
      const kept = Object.entries(current).filter(([key, signature]) => now.has(`${key}\t${signature}`));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [waits]);

  const tails = useTriageTails(
    shown
      .filter(({ entry }) => entry.kind === 'reply')
      .map(({ key, machine, session, signature }) => ({
        key,
        machine,
        projectId: session.projectId,
        sessionId: session.sessionId,
        signature,
      })),
  );

  const sentTo = useCallback(
    (key: string, signature: string, session: GhostexSession, title: string): void => {
      setAnswered((current) => ({ ...current, [key]: signature }));
      onNotice({ title, message: TriageCopy.sessionLine(sessionTitle(session), session.projectName), error: false });
    },
    [onNotice],
  );

  const reply = useCallback(
    async (key: string, signature: string, machine: MachineRecord, session: GhostexSession, text: string) => {
      try {
        await sendShortReply({ machine, session, chatView: sessionOpensInChatView(key, session) }, text, {
          run: runGhostexCli,
          sendToTerminal: async (target, terminalSession, reply) => {
            const answer = await sessionChatRpc(target, 'sendSessionMessage', {
              projectId: terminalSession.projectId,
              sessionId: terminalSession.sessionId,
              text: reply,
              submit: true,
            });
            if (answer.error !== null) throw new Error(answer.error.message);
          },
          acknowledge: acknowledgeSessionAttention,
        });
        sentTo(key, signature, session, TriageCopy.sent(text));
      } catch (error) {
        onNotice({
          title: TriageCopy.notSent,
          message: error instanceof Error ? error.message : String(error),
          error: true,
        });
        throw error;
      }
    },
    [onNotice, sentTo],
  );

  const openQuestion = useCallback((machine: MachineRecord, session: GhostexSession): void => {
    // The app's link module (with its navigation container) loads on the first question opened here, as on the
    // terminal screen's attention pane: the Sessions screen loads without it, as before.
    const { openDeepLink } = require('../../app/deepLinks') as typeof DeepLinksModule;
    openDeepLink(sessionDeepLink({ machineId: machine.id, sessionId: session.sessionId, view: 'question' }));
  }, []);

  return (
    <View accessibilityLabel={TriageCopy.section} style={[styles.section, { borderBottomColor: appearance.border }]}>
      {shown.length === 0 ? (
        <View style={styles.empty}>
          <CircleCheckGlyph size={18} color={SetupPalette.OK} />
          <Text style={[styles.emptyText, { color: appearance.muted }]}>{TriageCopy.nothingWaiting}</Text>
        </View>
      ) : (
        <>
          <Text accessibilityRole="header" style={[styles.heading, { color: appearance.muted }]}>
            {TriageCopy.heading(shown.length)}
          </Text>
          {shown.map(({ key, machine, session, capabilities, signature, chat, entry }) => (
            <TriageCard
              key={key}
              session={session}
              capabilities={capabilities}
              entry={entry}
              chat={chat}
              waited={elapsedLabel(session.attentionEnteredAt, nowMs)}
              tail={tails[key] ?? []}
              replies={shortReplies}
              appearance={appearance}
              onOpen={() => onOpen(machine, session)}
              onAnswered={(title) => sentTo(key, signature, session, title)}
              onReply={(text) => reply(key, signature, machine, session, text)}
              onOpenQuestion={() => openQuestion(machine, session)}
            />
          ))}
        </>
      )}
    </View>
  );
}

type TriageCardProps = {
  session: GhostexSession;
  /** The computer's summary capabilities, which the card's status dots read. */
  capabilities: GhostexSummaryCapabilities;
  entry: TriageEntry;
  /** The session's chat, for the entries answered through it. */
  chat: TriageChat | undefined;
  waited: string | null;
  tail: readonly string[];
  replies: readonly string[];
  appearance: SidebarAppearance;
  onOpen: () => void;
  /** The chat took the answered card away: `title` says what went out. */
  onAnswered: (title: string) => void;
  /** Resolves once the computer took the reply; rejects (and has said why) when it did not. */
  onReply: (text: string) => Promise<void>;
  onOpenQuestion: () => void;
};

/** An answer handed to the chat: its label, its message once out, and whether the chat showed the card busy since. */
type Pending = { label: string; title: string; busySeen: boolean };

function TriageCard({
  session,
  capabilities,
  entry,
  chat,
  waited,
  tail,
  replies,
  appearance,
  onOpen,
  onAnswered,
  onReply,
  onOpenQuestion,
}: TriageCardProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const ink = useSidebarInk();
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const answering = entry.kind === 'approval' || entry.kind === 'question';
  const busy = answering && entry.busy;
  useEffect(() => {
    if (pending === null) return;
    if (!answering) {
      setPending(null);
      onAnswered(pending.title);
    } else if (busy && !pending.busySeen) {
      setPending({ ...pending, busySeen: true });
    } else if (!busy && pending.busySeen) {
      // The chat gave the card back without taking the answer: the buttons work again.
      setPending(null);
    }
  }, [answering, busy, pending, onAnswered]);

  const answer = (label: string, title: string, action: Parameters<TriageChat['dispatch']>[0]): void => {
    if (chat === undefined || pending !== null || busy) return;
    setPending({ label, title, busySeen: false });
    chat.dispatch(action);
  };
  const sendReply = (text: string): void => {
    if (replying !== null) return;
    setReplying(text);
    onReply(text).catch(() => {
      if (mounted.current) setReplying(null);
    });
  };
  // The answered card leaves with the next draw; until the triage hides it, it shows nothing in between.
  if (pending !== null && !answering) return null;

  const locked = pending !== null || busy;
  const iconId = resolveAgentIconId(
    session.agentIcon,
    session.agentName.length > 0 ? session.agentName : session.agent,
  );
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  const title = sessionTitle(session);
  const dots = statusBadge(session, capabilities)?.dots ?? [];
  // The appearance's neutral fill and the command's model page colour.
  const fills = neutralButtonFills(ink.light);
  const commandWell = appearance.background;
  // The question's hue of the chat's ask card, its darker light-page tone on a light card.
  const askHue = askColor(ink.light);

  return (
    <View
      accessibilityLabel={title}
      style={[styles.card, { backgroundColor: appearance.card, borderColor: appearance.border }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={TriageCopy.open(title, waited)}
        onPress={onOpen}
        style={({ pressed }) => [styles.head, pressed ? { backgroundColor: appearance.cardActive } : null]}
      >
        <Icon size={18} color={agentIconTint(iconId)} />
        <View style={styles.name}>
          <Text style={[styles.title, { color: appearance.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          {session.projectName.length > 0 ? (
            <Text style={[styles.project, { color: appearance.muted }]} numberOfLines={1}>
              {session.projectName}
            </Text>
          ) : null}
        </View>
        {waited !== null ? <Text style={[styles.waited, { color: ink.time }]}>{waited}</Text> : null}
        <OverlappedDots colors={dots} size={STATUS_DOT_SIZE} ringColor={appearance.card} />
        <ChevronRightGlyph size={14} color={appearance.mutedGlyph} />
      </Pressable>
      <View style={styles.body}>
        {entry.kind === 'approval' ? (
          <>
            <ToneLine
              glyph="shield-check"
              hue={APPROVAL_HUE}
              title={entry.title}
              detail={entry.detail}
              appearance={appearance}
            />
            {entry.command.length > 0 ? (
              <View style={[styles.command, { borderColor: appearance.border, backgroundColor: commandWell }]}>
                <Text style={[styles.commandText, { color: appearance.foreground }]} numberOfLines={4}>
                  {isShellTool(entry.tool) ? <Text style={{ color: appearance.muted }}>{'$ '}</Text> : null}
                  {entry.command}
                </Text>
              </View>
            ) : (
              <Text style={[styles.question, { color: appearance.foreground }]}>{entry.ask}</Text>
            )}
            <View style={styles.actions}>
              <CardButton
                label={pending?.label === entry.deny.label ? TriageCopy.sending : entry.deny.label}
                appearance={appearance}
                accessibilityLabel={entry.deny.label}
                disabled={locked}
                onPress={() => answer(entry.deny.label, TriageCopy.sent(entry.deny.label), entry.deny.action)}
              />
              <CardButton
                primary
                label={pending?.label === entry.approve.label ? TriageCopy.sending : entry.approve.label}
                appearance={appearance}
                accessibilityLabel={entry.approve.label}
                disabled={locked}
                onPress={() => answer(entry.approve.label, TriageCopy.sent(entry.approve.label), entry.approve.action)}
              />
            </View>
          </>
        ) : entry.kind === 'approvalInSession' ? (
          <ToneLine
            glyph="shield-check"
            hue={APPROVAL_HUE}
            title={WallCopy.badge.approval}
            detail={TriageCopy.approvalInSession}
            appearance={appearance}
          />
        ) : entry.kind === 'question' ? (
          <>
            <QuestionText header={entry.header} text={entry.text} appearance={appearance} />
            <View accessibilityLabel={TriageCopy.answers} style={styles.options}>
              {entry.options.map((option, index) => (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  accessibilityLabel={option}
                  accessibilityState={{ disabled: locked }}
                  disabled={locked}
                  onPress={() => answer(option, TriageCopy.answered(option), questionOptionAnswer(index))}
                  style={({ pressed }) => [
                    styles.option,
                    { backgroundColor: pressed ? fills.pressed : fills.rest },
                    pending?.label === option ? { borderColor: askHue } : null,
                    locked && pending?.label !== option ? styles.disabled : null,
                  ]}
                >
                  <Text style={[styles.optionText, { color: appearance.foreground }]}>{option}</Text>
                  {pending?.label === option ? (
                    // On the option's neutral fill (at rest, or pressed while the finger is still down).
                    <Text
                      style={[
                        styles.sending,
                        {
                          color: readableSecondaryText(appearance.muted, appearance.foreground, [
                            colorOver(fills.rest, appearance.card),
                            colorOver(fills.pressed, appearance.card),
                          ]),
                        },
                      ]}
                    >
                      {TriageCopy.sending}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </>
        ) : entry.kind === 'openQuestion' ? (
          <>
            {entry.text.length > 0 ? (
              <QuestionText
                header={entry.reason === 'steps' ? TriageCopy.stepHeader(entry.header, entry.steps) : entry.header}
                text={entry.text}
                appearance={appearance}
              />
            ) : null}
            {entry.reason !== null ? (
              <Text style={[styles.hint, { color: appearance.muted }]}>
                {entry.reason === 'steps'
                  ? TriageCopy.hint.steps(entry.steps)
                  : entry.reason === 'multiSelect'
                    ? TriageCopy.hint.multiSelect
                    : TriageCopy.hint.text}
              </Text>
            ) : null}
            <CardButton
              label={TriageCopy.openQuestion}
              appearance={appearance}
              glyph={<Glyph name="help-circle" size={16} color={appearance.foreground} />}
              onPress={onOpenQuestion}
            />
          </>
        ) : (
          <>
            {tail.length > 0 ? (
              <View
                accessible
                accessibilityLabel={`${TriageCopy.lastOutput}: ${tail.join('\n')}`}
                style={[styles.tail, { borderColor: appearance.border }]}
              >
                {tail.map((line, index) => (
                  <Text key={index} style={[styles.tailLine, { color: appearance.foreground }]} numberOfLines={1}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
            <View accessibilityLabel={TriageCopy.shortReplies} style={styles.replies}>
              {replies.map((text, index) => (
                <Pressable
                  key={`${index}:${text}`}
                  accessibilityRole="button"
                  accessibilityLabel={text}
                  accessibilityState={{ disabled: replying !== null }}
                  disabled={replying !== null}
                  onPress={() => sendReply(text)}
                  style={({ pressed }) => [
                    styles.reply,
                    {
                      backgroundColor: pressed ? fills.pressed : fills.rest,
                      borderColor: replying === text ? askHue : appearance.border,
                    },
                    replying !== null && replying !== text ? styles.disabled : null,
                  ]}
                >
                  <Text style={[styles.replyText, { color: appearance.foreground }]}>
                    {replying === text ? TriageCopy.sending : text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
      {answering && entry.reconnecting ? (
        <Text
          accessibilityRole="alert"
          style={[styles.note, { color: appearance.muted, borderTopColor: appearance.border }]}
        >
          {RECONNECTING_NOTE}
        </Text>
      ) : null}
    </View>
  );
}

/** The approval's line in the chat's approval tone: a tinted tile, the title and a muted detail. */
function ToneLine({
  glyph,
  hue,
  title,
  detail,
  appearance,
}: {
  glyph: 'shield-check';
  hue: string;
  title: string;
  detail: string;
  appearance: SidebarAppearance;
}) {
  return (
    <View style={styles.tone}>
      <View style={[styles.toneTile, { backgroundColor: tint(hue, 0.16), borderColor: tint(hue, 0.4) }]}>
        <Glyph name={glyph} size={16} color={hue} />
      </View>
      <View style={styles.name}>
        <Text style={[styles.toneTitle, { color: appearance.foreground }]}>{title}</Text>
        {detail.length > 0 ? (
          <Text style={[styles.project, { color: appearance.muted }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function QuestionText({ header, text, appearance }: { header: string; text: string; appearance: SidebarAppearance }) {
  // The ask hue reads on the dark cards only; a light card's header takes its ink (the marks keep the hue).
  const ink = useSidebarInk();
  return (
    <View>
      {header.length > 0 ? (
        <Text style={[styles.questionHeader, { color: ink.light ? appearance.foreground : askColor(false) }]}>
          {header}
        </Text>
      ) : null}
      <Text style={[styles.question, { color: appearance.foreground }]}>{text}</Text>
    </View>
  );
}

/**
 * A card's button: the primary one in the model's accent, the others the neutral fill of the appearance (a wash of white
 * on dark cards, of black on light ones) with the ink that reads on it.
 */
function CardButton({
  label,
  accessibilityLabel,
  primary = false,
  glyph,
  appearance,
  disabled = false,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  primary?: boolean;
  glyph?: ReactNode;
  appearance: SidebarAppearance;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useAppearance();
  const fills = neutralButtonFills(colors.light);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? colors.accent : pressed ? fills.pressed : fills.rest },
        primary && pressed ? styles.primaryPressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {glyph}
      <Text
        style={[
          styles.buttonLabel,
          {
            color: primary ? colors.accentForeground : appearance.foreground,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
    paddingTop: 4,
    paddingBottom: 14,
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heading: { paddingHorizontal: 4, fontSize: 13, fontWeight: '600' },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 6 },
  emptyText: { fontSize: 14 },
  card: {
    borderRadius: GhostexRadii.section,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  name: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600' },
  project: { fontSize: 12 },
  waited: { fontSize: 13, fontVariant: ['tabular-nums'] },
  body: { gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
  tone: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toneTile: {
    width: 30,
    height: 30,
    borderRadius: GhostexRadii.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toneTitle: { fontSize: 14, fontWeight: '600' },
  command: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: GhostexRadii.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  commandText: { fontFamily: MONOSPACE, fontSize: 12.5, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  button: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: GhostexRadii.control,
  },
  primaryPressed: { opacity: 0.88 },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  questionHeader: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  question: { fontSize: 15, lineHeight: 20 },
  hint: { fontSize: 13 },
  options: { gap: 6 },
  option: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: GhostexRadii.control,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionText: { flex: 1, fontSize: 15 },
  sending: { fontSize: 12 },
  tail: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: GhostexRadii.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tailLine: { fontFamily: MONOSPACE, fontSize: 11, lineHeight: 15 },
  replies: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reply: {
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GhostexRadii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  replyText: { fontSize: 15, fontWeight: '500' },
  note: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
