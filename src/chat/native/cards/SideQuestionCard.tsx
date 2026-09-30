/**
 * Claude's `/btw` side question (desktop `native_chat/side_question.rs`): the question, the answer
 * as Markdown capped with "Show all", and Copy, Fork and Close in place of the panel's key hints.
 * The keys the desktop shows beside those buttons are desktop-only.
 */

import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Json } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { TranscriptEnvProvider, type TranscriptEnv } from '../transcript/context';
import { Markdown } from '../transcript/markdown/Markdown';
import { estimatedLines } from '../transcript/SystemRows';
import { PROSE_LINE, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Glyph } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { ChatButton, StatusCard } from './primitives';

/** A long answer shows about this many lines before "Show all". */
const CAP_LINES = 12;
/** The live card's footer note (desktop `SIDE_CARD_NOTE` in `native_chat/side_question.rs`). */
const SIDE_CARD_NOTE = "Can't reply to sidechat. Close it to message main agent.";

export function SideQuestionCard({ chat, dialog }: { chat: RustChat; dialog: JsonRecord }) {
  const styles = useStyles();
  const { dispatch } = chat;
  const presentation = obj(dialog.presentation);
  const card = obj(presentation?.sideQuestion);
  const dialogId = str(dialog, 'id');
  const answering = isTrue(card, 'answering');
  const answer = str(card, 'answer');
  const offered = (action: string) => arr(presentation?.actions).some((entry) => str(entry, 'action') === action);
  const send = (dialogAction: string) => dispatch({ type: 'answer', answer: { kind: 'terminalDialog', dialogId, dialogAction } });
  // Cut to one line like the desktop's note; a phone has no hover, so a tap shows the whole line.
  const [noteOpen, setNoteOpen] = useState(false);
  const header = (
    <View style={styles.header}>
      <SideBadge />
      <Text style={styles.question}>{str(card, 'question')}</Text>
      {answering ? <Text style={styles.status}>Answering…</Text> : null}
    </View>
  );
  const body = answering ? (
    <AnsweringPlaceholder key="answering" />
  ) : (
    <SideAnswer key={`answer:${dialogId}`} dispatch={dispatch} markdown={str(card, 'answerMarkdown')} references={card?.answerReferences as Json} />
  );
  const actions = [
    <Text key="note" style={styles.note} numberOfLines={noteOpen ? undefined : 1} onPress={() => setNoteOpen(!noteOpen)}>
      {SIDE_CARD_NOTE}
    </Text>,
    <ChatButton
      key="copy"
      label="Copy"
      icon="copy"
      disabled={answering || answer.length === 0}
      onPress={() => void Clipboard.setStringAsync(answer)}
    />,
    offered('fork') ? <ChatButton key="fork" label="Fork" icon="git-fork" onPress={() => send('fork')} /> : null,
    offered('cancel') ? <ChatButton key="close" label="Close" onPress={() => send('cancel')} /> : null,
  ];
  return <StatusCard header={header} body={[body]} actions={actions} />;
}

/** The answer, capped at about `CAP_LINES` lines with a Show all / Show less toggle under it. */
export function SideAnswer({ dispatch, markdown, references }: { dispatch: RustChat['dispatch']; markdown: string; references?: Json }) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  const [expanded, setExpanded] = useState(false);
  const env = useMemo<TranscriptEnv>(
    () => ({ dispatch, theme, verbose: false, filePreviews: false, main: false }),
    [dispatch, theme]
  );
  const lines = estimatedLines(markdown);
  const capped = lines > CAP_LINES;
  return (
    <TranscriptEnvProvider value={env}>
      <View style={capped && !expanded ? { maxHeight: CAP_LINES * PROSE_LINE, overflow: 'hidden' } : undefined}>
        <Markdown text={markdown} references={references} color={theme.prose} />
      </View>
      {capped ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less' : 'Show all'}
          onPress={() => setExpanded(!expanded)}
          hitSlop={6}
          style={styles.toggle}
        >
          <Glyph name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={theme.primary} />
          <Text style={styles.toggleLabel}>{expanded ? 'Show less' : `Show all · ${lines - CAP_LINES} more lines`}</Text>
        </Pressable>
      ) : null}
    </TranscriptEnvProvider>
  );
}

/** The "Side question" pill the card and the transcript row lead with. */
export function SideBadge() {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={styles.badge}>
      <Glyph name="message-circle" size={12} color={P.primary} />
      <Text style={styles.badgeLabel}>Side question</Text>
    </View>
  );
}

function AnsweringPlaceholder() {
  const styles = useStyles();
  return (
    <View style={styles.placeholder}>
      {[0.92, 0.78, 0.45].map((width) => (
        <View key={width} style={[styles.placeholderBar, { width: `${width * 100}%` }]} />
      ))}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  question: {
    flex: 1,
    minWidth: 0,
    color: P.foreground,
    fontSize: 14,
    lineHeight: 20,
  },
  status: {
    color: P.muted,
    fontSize: 12,
    lineHeight: 20,
  },
  note: {
    flex: 1,
    minWidth: 120,
    color: P.muted,
    fontSize: 12,
    alignSelf: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  toggleLabel: {
    color: P.primary,
    fontSize: 13,
  },
  // The pill, the question's first line and "Answering…" share one 20pt line box.
  badge: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.border,
  },
  badgeLabel: {
    color: P.primary,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '500',
  },
  placeholder: {
    gap: 9,
    paddingVertical: 4,
  },
  placeholderBar: {
    height: 9,
    borderRadius: 5,
    backgroundColor: P.muted,
    opacity: 0.28,
  },
}));
