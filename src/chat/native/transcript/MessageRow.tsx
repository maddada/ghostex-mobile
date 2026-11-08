/**
 * One message card (desktop `transcript.rs` `message_row`): the user's bubble with its pictures and
 * actions, an agent's prose as the heading its tool calls hang from, a reasoning row, and the cards
 * a system or harness turn becomes. What each row is and says comes from the core's projection.
 */

import { memo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { ApiErrorCard, ApiErrorNote, QuestionExchangeCards } from '../cards';
import { cardStackMargin } from './cardSpacing';
import { useNativeChatUi, useTranscriptEnv, useTranscriptFlags } from './context';
import { Chevron, DisclosureBody, DisclosureHeading, LaneMarker, useFoldPlace } from './Disclosure';
import { FileChangeStack } from './FileChanges';
import { FOLDED_CALLS_INSET, ImageRow, ReadImageStrip } from './Images';
import { arr, obj, str } from './json';
import { MessageLongPressContext } from './markdown/blockLongPress';
import { messageMenuSelection } from './messageCopy';
import { ignoreHold, MESSAGE_TEXT_SELECTABLE, MessageSelection, messageMenuAccessibility } from './messageSelection';
import { Markdown } from './markdown/Markdown';
import {
  DeliveryIndicator,
  hasReplyActions,
  isFlushReply,
  ReplyActions,
  UserActions,
  useReplyMenuActions,
  useUserMenuActions,
} from './MessageActions';
import { PageAnswersCard } from './PageAnswersCard';
import { openTranscriptMenu, type MessageMenuAction } from './transcriptMenuStore';
import { highlightLabel, useRowFind } from './searchHighlight';
import { useDisclosure } from './state';
import { InterAgentCard, SentAgentMessageCards } from './AgentMessageCards';
import { WorkflowCards } from './WorkflowCard';
import { estimatedLines, StartupDelivery, SuppressedRow, SystemCard } from './SystemRows';
import { MONO_FONT, PROSE_LINE, PROSE_SIZE, type TranscriptTheme } from './theme';
import { SideQuestionRow } from './SideQuestionRow';
import { ShellCommandCard, ToolRows } from './ToolRows';
import { Glyph } from './icons';
import { strengthenedText } from './textStrength';

/** React caps a secondary block at 18rem (`.ghostex-chat-scroll-cap`). */
/** The space between the parts of one message row (desktop `MESSAGE_PART_GAP` in transcript.rs). */
const MESSAGE_PART_GAP = 8;
const THINKING_CAP = 288;

/**
 * The agent's thinking tone: light mode always mutes it; dark mode draws it like the answer unless
 * Grey thinking is on (desktop `ChatAppearance::thinking_lane`, CDXC:SessionChat 2026-10-16 DECISION).
 */
function thinkingTone(theme: TranscriptTheme, mutedThinking: boolean): string {
  return mutedThinking || theme.light ? theme.muted : theme.primary;
}

export const MessageRow = memo(function MessageRow({ message }: { message: ProjectedMessage }) {
  const { theme, mutedThinking } = useTranscriptEnv();
  if (message.pending === true) return <PendingRow user={message.role === 'user'} />;
  if (message.role === 'user' && obj(message.interAgentMessage) !== null) return <InterAgentCard message={message} />;
  if (message.role === 'user' && obj(message.pageAnswers) !== null) {
    if (obj(message.pageAnswers)?.withText !== true) return <PageAnswersCard message={message} />;
    // The user's own words besides the answers follow as their ordinary message (desktop transcript.rs).
    return (
      <View style={styles.answersWithText}>
        <PageAnswersCard message={message} />
        <UserMessage message={message} />
      </View>
    );
  }
  if (message.shellCommand === true) return <ShellCommandCard message={message} />;
  if (message.role === 'user' && obj(message.suppressed) === null) return <UserMessage message={message} />;
  if (obj(message.sideQuestion) !== null) return <SideQuestionRow message={message} />;
  if (obj(message.suppressed) !== null) return <SuppressedRow message={message} />;
  if (obj(message.apiError) !== null) return <ApiErrorRow message={message} />;
  if (obj(message.systemCard) !== null) return <SystemCard message={message} />;
  // Grey thinking draws a reply in the full foreground so it reads apart from the muted thinking.
  return <AgentMessage message={message} proseColor={mutedThinking ? theme.foreground : theme.prose} />;
});

/** A failed API call: the open card when the core names this row, otherwise one quiet line. */
function ApiErrorRow({ message }: { message: ProjectedMessage }) {
  const { dispatch } = useTranscriptEnv();
  const { apiErrorCard } = useTranscriptFlags();
  if (obj(apiErrorCard)?.messageId === message.id) return <ApiErrorCard card={apiErrorCard} dispatch={dispatch} />;
  return <ApiErrorNote error={message.apiError} time={message.time} />;
}

/**
 * The transcript menu of a message (desktop's right press), with the message's own text as the
 * selection and its own actions (`actions`) under Copy and Add to Chat: a hold beside the words or
 * the selection menu's More opens it (`messageSelection.tsx`). The
 * main transcript and the subagent viewer share the menu (`TranscriptMenu.tsx`).
 */
function useMessageMenu(
  message: ProjectedMessage,
  actions: MessageMenuAction[] = [],
): ((selectedWords?: string) => void) | undefined {
  const selection = messageMenuSelection(message);
  return selection !== null
    ? (selectedWords?: string) =>
        openTranscriptMenu({ selection, actions, ...(selectedWords !== undefined ? { selectedWords } : {}) })
    : undefined;
}

function UserMessage({ message }: { message: ProjectedMessage }) {
  const { theme } = useTranscriptEnv();
  const { chatTextStrength } = useTranscriptFlags();
  const { disclosures } = useNativeChatUi();
  const body = typeof message.text === 'string' ? message.text : '';
  // A long prompt shows its first lines until it is expanded (core `long_prompt.rs`, desktop `transcript.rs` `prompt_body`).
  const collapsed = typeof message.collapsedText === 'string' ? message.collapsedText : '';
  const [open, toggle] = useDisclosure(disclosures, `prompt:${message.id}`);
  const shortened = collapsed.length > 0 && !open;
  const openMenu = useMessageMenu(message, useUserMenuActions(message));
  // A slash command reads as one, in the chat's monospace (core `is_slash_command_line`).
  const prose = message.slashCommand === true ? (
    <Text
      selectable={openMenu === undefined || MESSAGE_TEXT_SELECTABLE}
      style={[styles.slashCommand, { color: strengthenedText(theme.primary, chatTextStrength, theme.light) }]}
    >
      {message.copyText ?? body}
    </Text>
  ) : (
    <Markdown
      text={shortened ? collapsed : body}
      references={shortened ? message.collapsedReferences : message.markdownReferences}
      color={strengthenedText(theme.primary, chatTextStrength, theme.light)}
      codeColor={strengthenedText(theme.primary, chatTextStrength, theme.light)}
      breaks
      selectable={openMenu === undefined || MESSAGE_TEXT_SELECTABLE}
      strips={false}
    />
  );
  const bubble =
    collapsed.length > 0 ? (
      <View style={styles.promptColumn}>
        {prose}
        <Pressable onPress={toggle} style={styles.showMore} accessibilityRole="button">
          <Chevron open={!open} color={theme.muted} />
          <Text style={[styles.showMoreText, { color: theme.muted }]}>{open ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      </View>
    ) : (
      prose
    );
  return (
    <View style={styles.message} accessibilityLabel={`user message: ${body.slice(0, 2000)}`}>
      <StartupDelivery message={message} waitingLine={false} />
      <ImageRow images={message.images} user />
      <View style={styles.userColumn}>
        <View style={styles.bubbleRow}>
          <DeliveryIndicator message={message} />
          {body.length > 0 ? (
            openMenu === undefined ? (
              <View style={[styles.bubble, { backgroundColor: theme.input }]}>{bubble}</View>
            ) : (
              <MessageSelection openMenu={openMenu} style={[styles.bubble, { backgroundColor: theme.input }]}>
                <MessageLongPressContext.Provider value={openMenu}>{bubble}</MessageLongPressContext.Provider>
              </MessageSelection>
            )
          ) : null}
        </View>
        <UserActions message={message} />
      </View>
    </View>
  );
}

function AgentMessage({ message, proseColor }: { message: ProjectedMessage; proseColor: string }) {
  const { theme, workOpen, mutedThinking, simple } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const flags = useTranscriptFlags();
  const strengthened = (color: string) => strengthenedText(color, flags.chatTextStrength, theme.light);
  const { inWorkFold, hideFileChanges } = useFoldPlace();
  const id = message.id;
  const body = typeof message.text === 'string' ? message.text : '';
  const reasoning = message.role === 'reasoning';
  // Inside a turn fold the text owns none of its calls: they follow it at the same level
  // (gx-chat-core `list_tools_in_work_fold`).
  // Settings > Chat > Tool call cards: the calls and edits are one card after the text, which owns
  // none of them (`ToolCard.tsx`).
  const toolCard = obj(message.toolCard) !== null;
  const hasTools = message.toolsFlat !== true && !toolCard && arr(message.tools).length > 0;
  const flush = isFlushReply(message, flags.finalIds);
  const toolsKey = reasoning ? `reasoning:${id}` : `tools:${id}`;
  // A running summary turn's newest row opens its tools (gx-chat-core `summary_mode_turns`).
  const [toolsOpen, toggleTools] = useDisclosure(disclosures, toolsKey, workOpen || message.toolsOpen === true);
  const openMenu = useMessageMenu(message, useReplyMenuActions(message));
  const find = useRowFind();
  let lead = null;
  let toolsRendered = false;
  if (body.length > 0) {
    // The running turn's thought is one closed line, and so is every thought in Simple mode that
    // owns no calls; a running thought folds the calls it made behind its line, as a reply's
    // sentence does (`thinkingCard.calls`), and any other leaves them to the run below (desktop
    // `thinking_card.rs`, gx-chat-core `thinking_card.rs`).
    if (reasoning && (message.thinkingCard !== undefined || (simple && !hasTools))) {
      lead = <ThinkingLine id={id} body={body} message={message} />;
      toolsRendered = message.thinkingCard?.calls !== undefined;
    } else if (reasoning && hasTools) {
      // A reasoning headline owns the tools that followed it (React's ReasoningRow).
      const detail = str(message.reasoning, 'body');
      const thought = mutedThinking ? theme.muted : undefined;
      lead = (
        <>
          <DisclosureHeading
            label={str(message.reasoning, 'headline')}
            highlighted={highlightLabel(str(message.reasoning, 'headline'), find, toolsKey)}
            open={toolsOpen}
            onToggle={toggleTools}
            color={thought}
          />
          {toolsOpen ? (
            <DisclosureBody onCollapse={toggleTools} label="Collapse thinking">
              {detail.length > 0 ? (
                <Markdown
                  text={detail}
                  references={message.markdownReferences}
                  color={thought}
                  headingColor={thought}
                />
              ) : null}
              <ToolRows message={message} />
            </DisclosureBody>
          ) : (
            // The closed headline keeps the pictures its calls read in view (gx-chat-core `read_images.rs`).
            <ReadImageStrip images={message.readImages} inset={FOLDED_CALLS_INSET} />
          )}
        </>
      );
      toolsRendered = true;
    } else if (reasoning) {
      lead = <ThinkingRow id={id} body={body} references={message.markdownReferences} />;
    } else {
      // An agent's own words are the heading its tool calls hang from (React's AgentToolsDisclosure).
      const headingContent = (
        <>
          {hasTools ? (
            <Chevron open={toolsOpen} color={theme.primary} />
          ) : flush ? null : (
            <LaneMarker color={theme.primary} />
          )}
          <View style={styles.headingBody}>
            <Markdown
              text={body}
              references={message.markdownReferences}
              color={strengthened(proseColor)}
              headingColor={
                mutedThinking
                  ? strengthened(theme.foreground)
                  : flags.chatTextStrength > 0
                    ? strengthened(theme.primary)
                    : undefined
              }
              codeColor={strengthened(theme.primary)}
              selectable={openMenu === undefined || MESSAGE_TEXT_SELECTABLE}
            />
          </View>
        </>
      );
      const heading = (
        <MessageLongPressContext.Provider value={openMenu}>
          {openMenu !== undefined ? (
            // Without tools no press wraps the heading, so it keeps that press's room on the right.
            <MessageSelection
              openMenu={openMenu}
              style={[styles.heading, !hasTools && styles.headingPress]}
              accessible={!hasTools}
            >
              {headingContent}
            </MessageSelection>
          ) : (
            <View style={styles.heading}>{headingContent}</View>
          )}
        </MessageLongPressContext.Provider>
      );
      lead = hasTools ? (
        <>
          <Pressable
            onPress={toggleTools}
            {...(openMenu === undefined ? {} : { onLongPress: ignoreHold, ...messageMenuAccessibility(openMenu) })}
            accessibilityRole="button"
            accessibilityState={{ expanded: toolsOpen }}
            accessibilityHint={toolsOpen ? 'Hide tool calls for this message' : 'Show tool calls for this message'}
            style={({ pressed }) => [styles.headingPress, pressed && { backgroundColor: theme.pressed }]}
          >
            {heading}
          </Pressable>
          {toolsOpen ? (
            <DisclosureBody onCollapse={toggleTools} label="Collapse tool calls">
              <ToolRows message={message} />
            </DisclosureBody>
          ) : (
            // The sentence's closed calls keep the pictures they read in view (gx-chat-core `read_images.rs`).
            <ReadImageStrip images={message.readImages} inset={FOLDED_CALLS_INSET} />
          )}
        </>
      ) : (
        heading
      );
      toolsRendered = hasTools;
    }
  }
  // Which of the row's parts are one-line cards, for the gap between two of them (`cardSpacing.ts`).
  const filesCard = !hideFileChanges && !toolCard && arr(message.files).length > 0;
  const callsCard = filesCard || (!toolsRendered && toolCard);
  const questionCards = !inWorkFold && arr(message.questions).length > 0;
  const sentCards = !inWorkFold && arr(message.sentMessages).length > 0;
  return (
    <View style={styles.message} accessibilityLabel={`${message.role} message: ${body.slice(0, 2000)}`}>
      <ImageRow images={message.images} user={false} />
      {lead}
      {filesCard ? <MessageFiles message={message} /> : null}
      {!toolsRendered ? <ToolRows message={message} /> : null}
      {/* Inside a turn's work fold the answered cards are hoisted onto the turn instead. Two one-line
          cards in a row (the tool card, a message to another agent…) are a row gap apart (`cardSpacing.ts`). */}
      {!inWorkFold ? (
        <QuestionExchangeCards exchanges={message.questions} aboveIsCard={callsCard} columnGap={MESSAGE_PART_GAP} />
      ) : null}
      {!inWorkFold ? (
        <SentAgentMessageCards
          cards={message.sentMessages}
          aboveIsCard={callsCard || questionCards}
          columnGap={MESSAGE_PART_GAP}
        />
      ) : null}
      {!inWorkFold && arr(message.workflows).length > 0 ? (
        <View style={{ marginTop: cardStackMargin(callsCard || questionCards || sentCards, MESSAGE_PART_GAP) }}>
          <WorkflowCards ids={message.workflows} />
        </View>
      ) : null}
      {hasReplyActions(message, flags.finalIds) ? <ReplyActions message={message} flush={flush} /> : null}
    </View>
  );
}

/** A message's file cards; Simple mode folds them behind "Edited N files" (desktop `file_change_card.rs`). */
function MessageFiles({ message }: { message: ProjectedMessage }) {
  const { simple } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  // A write waiting on an approval opens the group (gx-chat-core `approval_wait.rs`).
  const awaiting = arr(message.files).some((file) => obj(file)?.awaitingApproval === true);
  const [open, toggle] = useDisclosure(disclosures, `files:${message.id}`, awaiting);
  const stack = <FileChangeStack stackId={message.id} files={message.files} card={message.fileCard} />;
  if (!simple) return stack;
  return (
    <View style={styles.message}>
      <DisclosureHeading label={str(message, 'simpleFileLabel')} open={open} onToggle={toggle} />
      {open ? stack : null}
    </View>
  );
}

/** A reasoning turn with no tool calls: the quiet lane, with a long thought capped (`thinking.rs`). */
function ThinkingRow({ id, body, references }: { id: string; body: string; references: unknown }) {
  const { theme, mutedThinking } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `thinking:${id}`);
  const lane = thinkingTone(theme, mutedThinking);
  const capped = estimatedLines(body) > THINKING_CAP / PROSE_LINE;
  return (
    <View style={styles.thinking}>
      <LaneMarker color={lane} />
      <View style={styles.thinkingColumn}>
        <View style={capped && !open ? styles.capped : null}>
          <Markdown text={body} references={references} color={lane} headingColor={mutedThinking ? lane : undefined} />
        </View>
        {capped ? (
          <Pressable onPress={toggle} style={styles.showMore} accessibilityRole="button">
            <Chevron open={!open} color={theme.muted} />
            <Text style={[styles.showMoreText, { color: theme.muted }]}>{open ? 'Show less' : 'Show more'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A thought as one slim line shaped like a tool row (desktop `thinking_card.rs`; the user's decision
 * is in gx-chat-core `transcript/thinking_card.rs`): a brain tile, "Thinking…" while it is written or
 * "Thought" after, and its line (the newest finished one while it streams). A press opens the full
 * thought below it; open while it is being written, it keeps the newest lines in view until the
 * reader scrolls up. A running thought that owns the calls it made ends its line with "N tool calls"
 * and a chevron that folds them, on a sentence's default (open in detailed mode or while a call
 * waits on an approval).
 */
function ThinkingLine({ id, body, message }: { id: string; body: string; message: ProjectedMessage }) {
  const { theme, mutedThinking, workOpen } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `thinking-card:${id}`);
  const calls = message.thinkingCard?.calls;
  const [callsOpen, toggleCalls] = useDisclosure(
    disclosures,
    `reasoning:${id}`,
    workOpen || message.toolsOpen === true,
  );
  const scroll = useRef<ScrollViewInstance>(null);
  const atEnd = useRef(true);
  const lane = thinkingTone(theme, mutedThinking);
  const card = message.thinkingCard;
  const live = card?.live === true;
  const preview = (card?.preview ?? '') || (message.thinkingRow?.preview ?? '');
  // A Codex reasoning summary is often its headline alone: there is nothing to open.
  const expandable = card !== undefined || message.thinkingRow?.expandable !== false;
  const title = live ? 'Thinking\u2026' : 'Thought';
  return (
    <View style={styles.thinkingLine}>
      <Pressable
        disabled={!expandable}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={preview.length > 0 ? `${title} ${preview}` : title}
        accessibilityState={expandable ? { expanded: open } : undefined}
        style={({ pressed }) => [styles.thinkingTrigger, pressed && { backgroundColor: theme.pressed }]}
      >
        <View style={[styles.thinkingTile, { backgroundColor: theme.ink(0.05) }]}>
          <Glyph name="brain" size={13} color={theme.muted} />
        </View>
        <Text style={[styles.thinkingTitle, { color: theme.muted }]}>{title}</Text>
        <Text style={[styles.thinkingPreview, { color: theme.prose, opacity: 0.8 }]} numberOfLines={1}>
          {open ? '' : preview}
        </Text>
        {calls !== undefined ? (
          <Pressable
            onPress={toggleCalls}
            accessibilityRole="button"
            accessibilityLabel={`${callsOpen ? 'Hide' : 'Show'} ${calls}`}
            accessibilityState={{ expanded: callsOpen }}
            hitSlop={6}
            style={({ pressed }) => [styles.thinkingCalls, pressed && { backgroundColor: theme.pressed }]}
          >
            <Text style={[styles.thinkingCallsLabel, { color: theme.muted }]}>{calls}</Text>
            <Glyph name={callsOpen ? 'chevron-down' : 'chevron-right'} size={13} color={theme.muted} />
          </Pressable>
        ) : null}
      </Pressable>
      {open && expandable ? (
        <View style={styles.thinkingInset}>
          <DisclosureBody onCollapse={toggle} label="Collapse thinking" gap={4}>
            <ScrollView
              ref={scroll}
              style={styles.thinkingScroll}
              nestedScrollEnabled
              scrollEventThrottle={32}
              onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
                atEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 2;
              }}
              onContentSizeChange={() => {
                if (live && atEnd.current) scroll.current?.scrollToEnd({ animated: false });
              }}
            >
              <Markdown
                text={body}
                references={message.markdownReferences}
                color={lane}
                headingColor={mutedThinking ? lane : undefined}
              />
            </ScrollView>
          </DisclosureBody>
        </View>
      ) : null}
      {calls !== undefined && callsOpen ? (
        <View style={styles.thinkingInset}>
          <DisclosureBody onCollapse={toggleCalls} label="Collapse tool calls">
            <ToolRows message={message} />
          </DisclosureBody>
        </View>
      ) : calls !== undefined ? (
        // Folded calls keep the pictures they read in view, as a closed turn fold does (gx-chat-core
        // `read_images.rs`; desktop `thinking_card.rs`).
        <ReadImageStrip images={message.readImages} inset={FOLDED_CALLS_INSET} />
      ) : null}
    </View>
  );
}

/** A row the core has not projected yet: a skeleton of its role (`transcript-skeleton.json`). */
function PendingRow({ user }: { user: boolean }) {
  const { theme } = useTranscriptEnv();
  const tint = theme.light ? 'rgba(39,39,42,0.12)' : 'rgba(252,252,252,0.12)';
  if (user) return <View style={[styles.pendingBubble, { backgroundColor: tint }]} />;
  return (
    <View style={styles.pendingLines}>
      {[0.94, 0.88, 0.62].map((width, index) => (
        <View key={index} style={[styles.pendingBar, { width: `${width * 100}%`, backgroundColor: tint }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  answersWithText: { gap: 8 },
  message: { gap: MESSAGE_PART_GAP, minWidth: 0 },
  userColumn: { alignItems: 'flex-end', gap: 4 },
  bubbleRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 6 },
  bubble: { maxWidth: '80%', flexShrink: 1, borderRadius: 16, padding: 12 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  headingBody: { flex: 1, minWidth: 0 },
  headingPress: { borderRadius: 4, paddingRight: 5 },
  thinking: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingBottom: 13 },
  thinkingColumn: { flex: 1, minWidth: 0, gap: 4 },
  capped: { maxHeight: THINKING_CAP, overflow: 'hidden' },
  // The tool row's shape (`ToolRows.tsx`: ROW_PAD_X 8, TILE 22).
  thinkingLine: { gap: 4, minWidth: 0, marginBottom: 6 },
  thinkingTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    minWidth: 0,
  },
  thinkingTile: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  thinkingTitle: { fontSize: 13.5, lineHeight: 20, fontWeight: '500', flexShrink: 0 },
  thinkingPreview: { flex: 1, minWidth: 0, fontSize: PROSE_SIZE, lineHeight: 20 },
  thinkingCalls: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, borderRadius: 4, flexShrink: 0 },
  thinkingCallsLabel: { fontSize: 12.5, lineHeight: 20 },
  thinkingInset: { paddingLeft: 8 },
  thinkingScroll: { maxHeight: THINKING_CAP },
  promptColumn: { gap: 8 },
  slashCommand: { fontFamily: MONO_FONT, fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  showMore: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  showMoreText: { fontSize: PROSE_SIZE },
  pendingBubble: { alignSelf: 'flex-end', width: '42%', height: 60, borderRadius: 16 },
  pendingLines: { gap: 12 },
  pendingBar: { height: 10, borderRadius: 5 },
});
