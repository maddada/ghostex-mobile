/**
 * One message card (desktop `transcript.rs` `message_row`): the user's bubble with its pictures and
 * actions, an agent's prose as the heading its tool calls hang from, a reasoning row, and the cards
 * a system or harness turn becomes. What each row is and says comes from the core's projection.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { QuestionExchangeCards } from '../cards';
import { useNativeChatUi, useTranscriptEnv, useTranscriptFlags } from './context';
import { Chevron, DisclosureBody, DisclosureHeading, LaneMarker, useFoldPlace } from './Disclosure';
import { FileChangeStack } from './FileChanges';
import { ImageRow } from './Images';
import { arr, obj, str } from './json';
import { Markdown } from './markdown/Markdown';
import { DeliveryIndicator, hasReplyActions, ReplyActions, UserActions } from './MessageActions';
import { openTranscriptMenu } from './transcriptMenuStore';
import { useDisclosure } from './state';
import { estimatedLines, InterAgentCard, StartupDelivery, SuppressedRow, SystemCard, TerminalToolRow } from './SystemRows';
import { PROSE_LINE, PROSE_SIZE } from './theme';
import { SideQuestionRow } from './SideQuestionRow';
import { ToolRows } from './ToolRows';

/** React caps a secondary block at 18rem (`.ghostex-chat-scroll-cap`). */
const THINKING_CAP = 288;

export const MessageRow = memo(function MessageRow({ message }: { message: ProjectedMessage }) {
  const { theme } = useTranscriptEnv();
  if (message.pending === true) return <PendingRow user={message.role === 'user'} />;
  if (message.role === 'user' && obj(message.interAgentMessage) !== null) return <InterAgentCard message={message} />;
  if (obj(message.terminalTool) !== null) return <TerminalToolRow activity={message.terminalTool} />;
  if (message.role === 'user' && obj(message.suppressed) === null) return <UserMessage message={message} />;
  if (obj(message.sideQuestion) !== null) return <SideQuestionRow message={message} />;
  if (obj(message.suppressed) !== null) return <SuppressedRow message={message} />;
  if (obj(message.systemCard) !== null) return <SystemCard message={message} />;
  return <AgentMessage message={message} proseColor={theme.prose} />;
});

/**
 * The long press that opens the transcript menu on a message (desktop's right press), with the
 * message's own text as the selection. Only the main transcript has the menu (`TranscriptMenu.tsx`).
 */
function useMessageMenu(message: ProjectedMessage): (() => void) | undefined {
  const { main } = useTranscriptEnv();
  const selection = typeof message.copyText === 'string' ? message.copyText : '';
  return main && selection.trim().length > 0 ? () => openTranscriptMenu({ selection }) : undefined;
}

const MENU_HINT = 'Long press for Copy and Add to Chat';

function UserMessage({ message }: { message: ProjectedMessage }) {
  const { theme } = useTranscriptEnv();
  const body = typeof message.text === 'string' ? message.text : '';
  const openMenu = useMessageMenu(message);
  const bubble = <Markdown text={body} references={message.markdownReferences} color={theme.primary} breaks selectable={openMenu === undefined} />;
  return (
    <View style={styles.message} accessibilityLabel={`user message: ${body.slice(0, 2000)}`}>
      <StartupDelivery message={message} waitingLine={false} />
      <ImageRow images={message.images} user />
      <View style={styles.userColumn}>
        <View style={styles.bubbleRow}>
          <DeliveryIndicator message={message} />
          {body.length > 0 ? (
            openMenu !== undefined ? (
              <Pressable
                onLongPress={openMenu}
                accessibilityHint={MENU_HINT}
                style={({ pressed }) => [styles.bubble, { backgroundColor: theme.input }, pressed && { opacity: 0.85 }]}
              >
                {bubble}
              </Pressable>
            ) : (
              <View style={[styles.bubble, { backgroundColor: theme.input }]}>{bubble}</View>
            )
          ) : null}
        </View>
        <UserActions message={message} />
      </View>
    </View>
  );
}

function AgentMessage({ message, proseColor }: { message: ProjectedMessage; proseColor: string }) {
  const { theme, verbose } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const flags = useTranscriptFlags();
  const { inWorkFold, hideFileChanges } = useFoldPlace();
  const id = message.id;
  const body = typeof message.text === 'string' ? message.text : '';
  const reasoning = message.role === 'reasoning';
  const hasTools = arr(message.tools).length > 0;
  const toolsKey = reasoning ? `reasoning:${id}` : `tools:${id}`;
  const [toolsOpen, toggleTools] = useDisclosure(disclosures, toolsKey, verbose);
  const openMenu = useMessageMenu(message);
  let lead = null;
  let toolsRendered = false;
  if (body.length > 0) {
    if (reasoning && hasTools) {
      // A reasoning headline owns the tools that followed it (React's ReasoningRow).
      const detail = str(message.reasoning, 'body');
      lead = (
        <>
          <DisclosureHeading label={str(message.reasoning, 'headline')} open={toolsOpen} onToggle={toggleTools} />
          {toolsOpen ? (
            <DisclosureBody onCollapse={toggleTools} label='Collapse thinking'>
              {detail.length > 0 ? <Markdown text={detail} references={message.markdownReferences} /> : null}
              <ToolRows message={message} />
            </DisclosureBody>
          ) : null}
        </>
      );
      toolsRendered = true;
    } else if (reasoning) {
      lead = <ThinkingRow id={id} body={body} references={message.markdownReferences} />;
    } else {
      // An agent's own words are the heading its tool calls hang from (React's AgentToolsDisclosure).
      const heading = (
        <View style={styles.heading}>
          {hasTools ? <Chevron open={toolsOpen} color={theme.primary} /> : <LaneMarker color={theme.primary} />}
          <View style={styles.headingBody}>
            <Markdown text={body} references={message.markdownReferences} color={proseColor} selectable={openMenu === undefined} />
          </View>
        </View>
      );
      lead = hasTools ? (
        <>
          <Pressable
            onPress={toggleTools}
            {...(openMenu !== undefined ? { onLongPress: openMenu } : {})}
            accessibilityRole='button'
            accessibilityState={{ expanded: toolsOpen }}
            accessibilityHint={toolsOpen ? 'Hide tool calls for this message' : 'Show tool calls for this message'}
            style={({ pressed }) => [styles.headingPress, pressed && { backgroundColor: theme.pressed }]}
          >
            {heading}
          </Pressable>
          {toolsOpen ? (
            <DisclosureBody onCollapse={toggleTools} label='Collapse tool calls'>
              <ToolRows message={message} />
            </DisclosureBody>
          ) : null}
        </>
      ) : openMenu !== undefined ? (
        <Pressable onLongPress={openMenu} accessibilityHint={MENU_HINT} style={({ pressed }) => [styles.headingPress, pressed && { backgroundColor: theme.pressed }]}>
          {heading}
        </Pressable>
      ) : (
        heading
      );
      toolsRendered = hasTools;
    }
  }
  return (
    <View style={styles.message} accessibilityLabel={`${message.role} message: ${body.slice(0, 2000)}`}>
      <ImageRow images={message.images} user={false} />
      {lead}
      {!hideFileChanges && arr(message.files).length > 0 ? <FileChangeStack stackId={id} files={message.files} /> : null}
      {!toolsRendered ? <ToolRows message={message} /> : null}
      {/* Inside a turn's work fold the answered cards are hoisted onto the turn instead. */}
      {!inWorkFold ? <QuestionExchangeCards exchanges={message.questions} /> : null}
      {hasReplyActions(message, flags.finalIds) ? <ReplyActions message={message} /> : null}
    </View>
  );
}

/** A reasoning turn with no tool calls: the quiet lane, with a long thought capped (`thinking.rs`). */
function ThinkingRow({ id, body, references }: { id: string; body: string; references: unknown }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `thinking:${id}`);
  const lane = theme.light ? theme.muted : theme.primary;
  const capped = estimatedLines(body) > THINKING_CAP / PROSE_LINE;
  return (
    <View style={styles.thinking}>
      <LaneMarker color={lane} />
      <View style={styles.thinkingColumn}>
        <View style={capped && !open ? styles.capped : null}>
          <Markdown text={body} references={references} color={lane} />
        </View>
        {capped ? (
          <Pressable onPress={toggle} style={styles.showMore} accessibilityRole='button'>
            <Chevron open={!open} color={theme.muted} />
            <Text style={[styles.showMoreText, { color: theme.muted }]}>{open ? 'Show less' : 'Show more'}</Text>
          </Pressable>
        ) : null}
      </View>
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
  message: { gap: 8, minWidth: 0 },
  userColumn: { alignItems: 'flex-end', gap: 4 },
  bubbleRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 6 },
  bubble: { maxWidth: '80%', flexShrink: 1, borderRadius: 16, padding: 12 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  headingBody: { flex: 1, minWidth: 0 },
  headingPress: { borderRadius: 4, paddingRight: 5 },
  thinking: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingBottom: 13 },
  thinkingColumn: { flex: 1, minWidth: 0, gap: 4 },
  capped: { maxHeight: THINKING_CAP, overflow: 'hidden' },
  showMore: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  showMoreText: { fontSize: PROSE_SIZE },
  pendingBubble: { alignSelf: 'flex-end', width: '42%', height: 60, borderRadius: 16 },
  pendingLines: { gap: 12 },
  pendingBar: { height: 10, borderRadius: 5 },
});
