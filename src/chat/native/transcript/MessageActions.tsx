/**
 * What sits under a message (desktop `message_actions.rs`, React `CopyFooter`) and the actions its
 * menu offers: the time under a final reply, starting at the prose column, and under a prompt,
 * right-aligned; the buttons desktop shows on hover are rows of the message's menu.
 *
 * CDXC:SessionChat 2026-10-21 DECISION: User: "On mobile app i should be able to hold and select text in messages so i can copy or add to chat", and picked "Hold selects text": holding a message's words starts the phone's own text selection, whose bar offers Copy and Add to Chat for the selected words and More, which opens the message's menu (`TranscriptMenu.tsx`: Copy and Add to Chat for the whole message, then its actions). For iPhone the user answered "Yes, build it on iPhone" (Q373), so both platforms select the same way (`messageSelection.tsx`). Supersedes the 2026-10-12 hold that opened the menu from anywhere on a message.
 *
 * CDXC:SessionChat 2026-10-22 DECISION: User: "Yes, make both icons tappable". A queued message's play icon (Interrupt and send) and its Back to composer icon (`DeliveryIndicator` below) are buttons on the phone too, the one exception to the 2026-10-12 rule (User: "we dont show buttons on any messages in the transcript without holding on it first (since these are shown on hover on desktop but there's no hover on mobile)"). Everything else stays in the message's menu: Copy, Edit, Back to composer, Delete, Rewind, Save prompt, Save to md and Send now are its rows, built from `useUserActionItems` / `useReplyActionItems` here, in the main transcript and the subagent viewer, and only the time and those two icons stay beside a message. Supersedes the 2026-10-21 decision's "no message shows a button".
 */

import * as Clipboard from 'expo-clipboard';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { useChatLook, useTranscriptEnv, useTranscriptFlags } from './context';
import { Glyph } from './icons';
import { arr, obj, str } from './json';
import { messageCommands } from './markdown/runCommands';
import { rememberSaveMarkdown } from './saveMarkdownStore';
import { WorkButton, type HiddenWork } from './hiddenWorkButton';
import { compactSpacing, FOOTER_DIM, FOOTER_HEIGHT } from './messageSpacing';
import { PROSE_COLUMN } from './theme';
import type { MessageMenuAction } from './transcriptMenuStore';

/** One action of a message: a row of its menu. */
type ActionItem = MessageMenuAction;

/** The work button's height in a reply's time row at Default spacing (Agent work Quiet), the desktop's 20px button in its 24px action row. */
const WORK_ROW_HEIGHT = 20;

/** The time a message arrived; in a Compact footer (`footer`) as dim as the desktop footer's. */
function MessageTime({ message, footer = false }: { message: ProjectedMessage; footer?: boolean }) {
  const { theme } = useTranscriptEnv();
  const label = str(message.time, 'label');
  if (label.length === 0) return null;
  return (
    <Text
      style={[styles.time, footer ? { color: theme.mutedInk(FOOTER_DIM), fontSize: 11.5 } : { color: theme.muted }]}
      accessibilityLabel={str(message.time, 'title') || label}
    >
      {label}
    </Text>
  );
}

/**
 * A turn's final answer with no tool calls of its own: drawn flush with the chat column, without
 * the reply dot (desktop `is_flush_reply` in native_chat/message_actions.rs).
 */
export function isFlushReply(message: ProjectedMessage, finalIds: ReadonlySet<string>): boolean {
  return message.role === 'assistant' && arr(message.tools).length === 0 && finalIds.has(message.id);
}

/** Whether a reply gets its actions: a copyable assistant row whose turn is final. */
export function hasReplyActions(message: ProjectedMessage, finalIds: ReadonlySet<string>): boolean {
  return message.role === 'assistant' && obj(message.actionContent)?.copyable === true && finalIds.has(message.id);
}

/**
 * Desktop's reply row: Copy, Reply by Annotating, Save to md, then the time. Reply by Annotating
 * opens the reply in the desktop Docs review surface, which the phone does not have, so it is left
 * out rather than drawn as a control that does nothing. Under Agent work Quiet the reply that
 * carries its turn's work (`work`, `hiddenWorkButton.tsx`) leads the row with the work button.
 * At Message spacing Compact the row is the reply's footer (`messageSpacing.ts`): its space is
 * always kept, the work button on its left and the time on its right.
 */
export const ReplyActions = memo(function ReplyActions({
  message,
  flush,
  work = null,
}: {
  message: ProjectedMessage;
  flush: boolean;
  work?: HiddenWork | null;
}) {
  const compact = compactSpacing(useChatLook());
  if (compact) {
    return (
      <View style={[styles.footer, { paddingLeft: flush ? 0 : PROSE_COLUMN }]}>
        {work !== null ? <WorkButton work={work} height={FOOTER_HEIGHT} /> : null}
        <View style={styles.footerEnd}>
          <MessageTime message={message} footer />
        </View>
      </View>
    );
  }
  // Only the time shows; Save to md is in the message's menu (see the file doc).
  if (str(message.time, 'label').length === 0 && work === null) return null;
  return (
    <View style={[styles.row, { paddingLeft: flush ? 0 : PROSE_COLUMN }]}>
      {work !== null ? <WorkButton work={work} height={WORK_ROW_HEIGHT} /> : null}
      <MessageTime message={message} />
    </View>
  );
});

/** A reply's own actions besides Copy, which the menu's core row covers. */
function useReplyActionItems(message: ProjectedMessage): ActionItem[] {
  const { dispatch, main } = useTranscriptEnv();
  const flags = useTranscriptFlags();
  const markdown = typeof message.copyText === 'string' ? message.copyText : '';
  const items: ActionItem[] = [];
  if (obj(message.actionContent)?.canSaveMarkdown === true) {
    items.push({
      label: 'Save message to Markdown',
      icon: 'file-export',
      run: () => {
        rememberSaveMarkdown(markdown);
        dispatch({ type: 'markdownSaveOpen', markdown });
      },
    });
  }
  /*
   * CDXC:SessionChat 2026-10-24 DECISION: User: "for inline it shouldn't be showing overlapping the command text. instead we should have 2 buttons (copy and paste in terminal (just pastes it doesn't run it)". On the phone, a reply holding one inline command offers Copy command and Paste in terminal (typed into a new terminal, Enter left to the user) in its menu; one holding one command block offers Run in terminal, which the block's own Run button beside its copy button does too.
   */
  const commands =
    message.role === 'assistant' && typeof message.text === 'string' ? messageCommands(message.text) : [];
  if (commands.length === 1) {
    const { command, inline } = commands[0]!;
    if (inline) {
      items.push({ label: 'Copy command', icon: 'copy', run: () => void Clipboard.setStringAsync(command) });
      items.push({
        label: 'Paste in terminal',
        icon: 'terminal-2',
        run: () => dispatch({ type: 'pasteInTerminal', command }),
      });
    } else {
      items.push({
        label: 'Run in terminal',
        icon: 'terminal-2',
        run: () => dispatch({ type: 'runInTerminal', command }),
      });
    }
  }
  /*
   * CDXC:VoiceMode 2026-10-20 DECISION: User: a per-message Read aloud action; on the phone it is a row of the message's long-press menu, never a button on the message (CDXC:SessionChat 2026-10-12). On the reply being read it reads Stop reading.
   * CDXC:VoiceMode 2026-10-22 WHY: it shows where the reply actions show (a final reply, `finalIds`) and comes last, as the desktop's hover row has it last before the time (Q24). The subagent viewer never offers it: Read aloud reads only the session's own transcript.
   */
  if (main && flags.readAloudAvailable && hasReplyActions(message, flags.finalIds)) {
    const speaking = flags.readAloudSpeakingId === message.id;
    items.push({
      label: speaking ? 'Stop reading' : 'Read aloud',
      icon: speaking ? 'player-stop' : 'volume',
      run: () => dispatch({ type: 'readAloudMessage', messageId: message.id }),
    });
  }
  return items;
}

/** The actions a reply's menu offers after Copy and Add to Chat. */
export function useReplyMenuActions(message: ProjectedMessage): MessageMenuAction[] {
  return useReplyActionItems(message);
}

/**
 * Desktop's `delivery_indicator` (`startup_delivery.rs`): a spinner while the send waits for the
 * agent's terminal, a play button while the agent holds it queued behind its running turn, drawn
 * left of the bubble level with its last line. A tap on play interrupts the turn so the agent takes
 * the queued prompt now; Back to composer, left of it where the agent can give the message back,
 * takes it out of the agent's queue into the composer and spins while it does.
 */
export function DeliveryIndicator({ message, inline = false }: { message: ProjectedMessage; inline?: boolean }) {
  const { dispatch, main, theme } = useTranscriptEnv();
  const flags = useTranscriptFlags();
  const delivery = message.startupDelivery;
  // An unconfirmed send is no longer waiting on anything: its line says so, with no spinner (desktop: startup_delivery.rs).
  const waiting =
    delivery !== undefined && delivery !== null && delivery.state !== 'failed' && delivery.state !== 'unconfirmed';
  const queued = message.queued === true && (delivery === undefined || delivery === null);
  // A held message waits for its computer, not for the agent: a clock, not a spinner (desktop:
  // startup_delivery.rs).
  if (waiting && delivery.state === 'held') {
    return (
      <View style={[styles.button, styles.indicator]} accessibilityLabel="Waiting for the computer">
        <Glyph name="clock" size={13} color={theme.muted} />
      </View>
    );
  }
  if (waiting) {
    return (
      <View
        style={[styles.button, inline ? styles.inlineIndicator : styles.indicator]}
        accessibilityRole="progressbar"
        accessibilityLabel="Waiting for agent"
      >
        <ActivityIndicator size={13} color={theme.muted} />
      </View>
    );
  }
  if (!queued) return null;
  const takeable = main && flags.takeBackIds.has(message.id);
  const takingBack = takeable && flags.takeBackBusy === message.id;
  // The icons keep their 26pt look; the hit slop makes each a finger-sized target without moving
  // the bubble, and stops short of the neighbour's.
  return (
    <View style={[styles.indicatorRow, inline ? styles.inlineIndicator : styles.indicator]}>
      {takingBack ? (
        <View style={styles.button} accessibilityRole="progressbar" accessibilityLabel="Taking the message back">
          <ActivityIndicator size={13} color={theme.muted} />
        </View>
      ) : takeable ? (
        <Pressable
          style={styles.button}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 1 }}
          accessibilityRole="button"
          accessibilityLabel="Back to composer"
          onPress={() => dispatch({ type: 'takeBackQueued', messageId: message.id })}
        >
          <Glyph name="arrow-back-up" size={13} color={theme.muted} />
        </Pressable>
      ) : null}
      <Pressable
        style={styles.button}
        hitSlop={{ top: 10, bottom: 10, left: takeable ? 1 : 10, right: 2 }}
        accessibilityRole="button"
        accessibilityLabel="Queued. Interrupt and send"
        onPress={() => dispatch({ type: 'sendKey', key: 'escape' })}
      >
        <Glyph name="player-play" size={13} color={theme.muted} />
      </Pressable>
    </View>
  );
}

export const UserActions = memo(function UserActions({
  message,
  start = false,
}: {
  message: ProjectedMessage;
  /** Under a left-aligned message the time starts at its left edge (desktop `user_actions`). */
  start?: boolean;
}) {
  const prompt = typeof message.copyText === 'string' ? message.copyText : '';
  const compact = compactSpacing(useChatLook());
  // A message the agent itself queued comes back to the composer (CDXC:SessionChat 2026-10-11 in
  // packages/gx-chat-core/src/composer/queue_take_back.rs); `DeliveryIndicator` spins while it does.
  if (prompt.length === 0) return null;
  // Message spacing Compact: the message's footer, its space always kept, the time on the
  // message's side (`messageSpacing.ts`).
  if (compact) {
    return (
      <View style={[styles.footer, start ? styles.userRowStart : styles.userRow]}>
        <MessageTime message={message} footer />
      </View>
    );
  }
  if (str(message.time, 'label').length === 0) return null;
  return (
    <View style={[styles.row, start ? styles.userRowStart : styles.userRow]}>
      <MessageTime message={message} />
    </View>
  );
});

/**
 * A prompt's own actions besides Copy, in the order desktop shows them: Edit, Back to composer,
 * Delete, Rewind, Save prompt, and Send now for a message waiting behind the agent's running turn.
 */
function useUserActionItems(message: ProjectedMessage): ActionItem[] {
  const { dispatch, main } = useTranscriptEnv();
  const flags = useTranscriptFlags();
  const prompt = typeof message.copyText === 'string' ? message.copyText : '';
  if (prompt.length === 0) return [];
  const saved = flags.savedPrompts[message.id];
  // A rewind types into this session's own pane, so a subagent's transcript never offers one.
  const rewindable = main && message.canRewind === true && flags.rewindAvailable && flags.rewindEnabled;
  // A message gxserver still holds for the agent can be taken back the way a queued row can
  // (CDXC:SessionChat 2026-10-11 in server/src/session_chat_send_wake.rs; desktop `message_actions.rs`).
  const waitingPromptId = message.startupDelivery?.state === 'queued' ? message.startupDelivery.promptId : null;
  const takeable = main && flags.takeBackIds.has(message.id) && flags.takeBackBusy !== message.id;
  const delivery = message.startupDelivery;
  const queued = message.queued === true && (delivery === undefined || delivery === null);
  const items: ActionItem[] = [];
  if (queued) {
    items.push({ label: 'Send now', icon: 'arrow-up', run: () => dispatch({ type: 'sendKey', key: 'escape' }) });
  }
  if (waitingPromptId !== null && flags.canEditQueued) {
    items.push({
      label: 'Edit message',
      icon: 'pencil',
      run: () => dispatch({ type: 'removeQueue', promptId: waitingPromptId, edit: true }),
    });
  }
  if (takeable) {
    items.push({
      label: 'Back to composer',
      icon: 'arrow-back-up',
      run: () => dispatch({ type: 'takeBackQueued', messageId: message.id }),
    });
  }
  if (waitingPromptId !== null && flags.canRemoveQueued) {
    items.push({
      label: 'Delete message',
      icon: 'trash',
      run: () => dispatch({ type: 'removeQueue', promptId: waitingPromptId }),
    });
  }
  if (rewindable) {
    items.push({
      label: 'Rewind to here',
      icon: 'arrow-back-up',
      run: () => dispatch({ type: 'rewindOpen', messageId: message.id, prompt }),
    });
  }
  if (flags.canSavePrompt) {
    items.push({
      label:
        saved === 'saved'
          ? 'Prompt saved'
          : saved === 'saving'
            ? 'Saving prompt'
            : saved === 'error'
              ? 'Could not save prompt. Tap to retry.'
              : 'Save prompt',
      icon: 'star',
      run: () => dispatch({ type: 'savePrompt', messageId: message.id, prompt }),
    });
  }
  return items;
}

/** The actions a prompt's menu offers after Copy and Add to Chat. */
export function useUserMenuActions(message: ProjectedMessage): MessageMenuAction[] {
  return useUserActionItems(message);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { alignSelf: 'stretch', height: FOOTER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerEnd: { marginLeft: 'auto', flexShrink: 0 },
  userRow: { justifyContent: 'flex-end', paddingRight: 4 },
  userRowStart: { justifyContent: 'flex-start' },
  indicator: { marginBottom: 10 },
  // At a Band message's right end, level with its last line, without making its line taller.
  inlineIndicator: { marginVertical: -2 },
  indicatorRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  button: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  time: { fontSize: 12 },
});
