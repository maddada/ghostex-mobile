/**
 * A coordinator's threads' approval cards, relayed to its own chat (`relayedApprovals` in the chat
 * core's document, `packages/gx-chat-core/src/extras/relayed_approvals.rs`, which holds the user's
 * decision): the card under the thread's "waiting for an answer" report, the Approvals pill's
 * sheet, and, in the thread's own chat, the "Approved from <coordinator>" line. The board's Needs
 * you row draws the same buttons (`CoordinatorBoard.tsx`). Port of desktop `relayed_approval.rs`.
 *
 * A tap sends `answerRelayedApproval`; the core turns it into the thread card's own answer for the
 * thread's session. Every button is a neutral fill, never the dark primary one: the card sits on
 * the chat's glass (the user's standing rule, no black fills on glass).
 */

import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { SidebarPalette } from '../../../theme/palette';
import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { relayedCards } from './relayedApprovals';
import { CARD_TEXT_SIZE } from './primitives';
import { AutoBlockLine, CommandBox, PendingAnswerNote, ToneButton, ToneCard, dimPending } from './ToneCard';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

type Dispatch = RustChat['dispatch'];

/** "2:15 PM" for an ISO time, empty when it does not parse. */
function clock(at: string): string {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return '';
  return new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function settledMark(tone: string, muted: string): { icon: GlyphName; color: string } {
  if (tone === 'good') return { icon: 'check', color: '#3fb871' };
  if (tone === 'bad') return { icon: 'x', color: SidebarPalette.ROW_APPROVAL };
  if (tone === 'warn') return { icon: 'clock', color: '#f5a524' };
  return { icon: 'chevron-right', color: muted };
}

/** One relayed card: open with the thread's own buttons, or one line saying how it ended. */
export function RelayedApprovalCard({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [codeOpen, setCodeOpen] = useState(false);
  if (!isTrue(card, 'open')) return <RelayedSettledRow card={card} />;
  const key = str(card, 'key');
  const busy = isTrue(card, 'busy');
  const code = str(card, 'code');
  const preview = str(card, 'codePreview');
  const more = str(card, 'codeMore');
  const reason = str(obj(card.reason), 'text');
  const error = str(card, 'error');
  const detail = [str(card, 'header'), str(card, 'threadTitle'), str(card, 'source')]
    .filter((part) => part.length > 0)
    .join(' · ');
  const choices = arr(card.choices)
    .map(obj)
    .filter((choice): choice is JsonRecord => choice !== null);
  const lasting = choices.map((choice) => str(choice, 'tooltip')).filter((tip) => tip.length > 0);
  return (
    <ToneCard
      tone="approval"
      icon="shield-check"
      title={str(card, 'title')}
      detail={detail}
      body={dimPending(
        [
          code.length > 0 ? (
            <View key="code" style={styles.code}>
              <CommandBox
                command={codeOpen || preview.length === 0 ? code : preview}
                shell={str(card, 'codeLabel') === 'Command'}
              />
              {more.length > 0 ? (
                <Text
                  accessibilityRole="button"
                  accessibilityLabel={codeOpen ? 'Show less of the command' : `Show all of the command, ${more}`}
                  style={styles.more}
                  onPress={() => setCodeOpen((was) => !was)}
                >
                  {codeOpen ? 'Show less' : 'Show all'}
                </Text>
              ) : null}
            </View>
          ) : null,
          reason.length > 0 ? (
            <Text key="reason" style={styles.reason}>
              {reason}
            </Text>
          ) : null,
          // The phone has no hover, so what a lasting choice changes is said under the card.
          ...lasting.map((tip, index) => (
            <Text key={`tip:${index}`} style={styles.tip}>
              {tip}
            </Text>
          )),
          str(card, 'autoBlockAt').length > 0 ? <AutoBlockLine key="auto-block" at={str(card, 'autoBlockAt')} /> : null,
          error.length > 0 ? (
            <Text key="error" style={styles.error}>
              {error}
            </Text>
          ) : null,
        ].filter(Boolean),
        busy,
      )}
      footerStart={
        busy
          ? [<PendingAnswerNote key="pending" words="Sending…" />]
          : [
              <Pressable
                key="open"
                accessibilityRole="link"
                accessibilityLabel="Open the thread"
                hitSlop={6}
                onPress={() =>
                  dispatch({
                    type: 'openCoordinatorThread',
                    projectId: str(card, 'projectId'),
                    sessionId: str(card, 'sessionId'),
                  })
                }
                style={styles.note}
              >
                <Glyph name="shield-check" size={13} color={P.muted} />
                <Text style={styles.noteText}>{str(card, 'note')}</Text>
              </Pressable>,
            ]
      }
      footerEnd={choices.map((choice, index) => (
        <ToneButton
          key={`choice:${index}`}
          kind="secondary"
          label={str(choice, 'label')}
          disabled={busy}
          onPress={() => dispatch({ type: 'answerRelayedApproval', key, choice: index })}
        />
      ))}
    />
  );
}

/** An ended card: its mark, how it ended and when. */
function RelayedSettledRow({ card }: { card: JsonRecord }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const mark = settledMark(str(card, 'settledTone'), P.muted);
  const time = clock(str(card, 'settledAt'));
  return (
    <View style={styles.line} accessibilityLabel={`${str(card, 'settledLead')} ${str(card, 'settledText')}`}>
      <Glyph name={mark.icon} size={14} color={mark.color} />
      <Text style={styles.lineText} numberOfLines={2}>
        <Text style={styles.lineLead}>{str(card, 'settledLead')} </Text>
        {str(card, 'settledText')}
      </Text>
      {time.length > 0 ? <Text style={styles.lineTime}>{time}</Text> : null}
    </View>
  );
}

/** The Approvals pill's sheet: every card that waits on the user. */
export function RelayedApprovalsMenu({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const styles = useStyles();
  const open = relayedCards(document).filter((card) => isTrue(card, 'open'));
  return (
    <ScrollView style={styles.menu} contentContainerStyle={styles.menuList} nestedScrollEnabled>
      {open.map((card) => (
        <RelayedApprovalCard key={str(card, 'key')} card={card} dispatch={chat.dispatch} />
      ))}
    </ScrollView>
  );
}

/** A thread's chat: the newest answer its coordinator's chat sent for it, where its card was. */
export function RelayedAnswerLine({ document }: { document: ChatDocument }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const lines = arr(document.relayedAnswerLines);
  const line = obj(lines[lines.length - 1]);
  if (line === null) return null;
  const mark = settledMark(str(line, 'tone'), P.muted);
  const time = clock(str(line, 'at'));
  return (
    <View style={styles.line} accessibilityLabel={`${str(line, 'text')}. ${str(line, 'detail')}`}>
      <Glyph name={mark.icon} size={14} color={mark.color} />
      <Text style={styles.lineText} numberOfLines={2}>
        <Text style={styles.lineLead}>{str(line, 'text')} </Text>
        {str(line, 'detail')}
      </Text>
      {time.length > 0 ? <Text style={styles.lineTime}>{time}</Text> : null}
    </View>
  );
}

/** Whether the thread's chat shows its relayed answer line (`chatCardsShown`). */
export function relayedAnswerLineShown(document: ChatDocument): boolean {
  return arr(document.relayedAnswerLines).length > 0;
}

/**
 * The board row's buttons for its thread's open card: one segmented pill, the thread card's own
 * choices, and the question on the line under it (the phone has no tooltip).
 */
export function BoardRelayButtons({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const key = str(card, 'key');
  const busy = isTrue(card, 'busy');
  const choices = arr(card.choices)
    .map(obj)
    .filter((choice): choice is JsonRecord => choice !== null);
  return (
    <View style={styles.segmented}>
      {choices.map((choice, index) => (
        <Pressable
          key={`relay:${index}`}
          accessibilityRole="button"
          accessibilityLabel={`${str(choice, 'label')}: ${str(card, 'title')}`}
          disabled={busy}
          onPress={() => dispatch({ type: 'answerRelayedApproval', key, choice: index })}
          style={({ pressed }) => [
            styles.segment,
            index > 0 && styles.segmentDivider,
            pressed && styles.segmentPressed,
            busy && styles.segmentBusy,
          ]}
        >
          <Text
            style={[styles.segmentText, str(choice, 'tone') === 'deny' && { color: SidebarPalette.ROW_APPROVAL }]}
            numberOfLines={1}
          >
            {str(choice, 'label')}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  code: {
    gap: 4,
  },
  more: {
    color: P.muted,
    fontSize: 12.5,
  },
  reason: {
    color: '#f5a524',
    fontSize: 12.5,
    lineHeight: 17,
  },
  tip: {
    color: P.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  error: {
    color: '#ef9999',
    fontSize: 12.5,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  noteText: {
    color: P.muted,
    fontSize: 12,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.ink(0.04),
  },
  lineText: {
    flex: 1,
    color: P.cardMuted,
    fontSize: CARD_TEXT_SIZE - 1.5,
    lineHeight: 17,
  },
  lineLead: {
    color: P.foreground,
    fontWeight: '600',
  },
  lineTime: {
    color: P.muted,
    fontSize: 11,
  },
  menu: {
    maxHeight: 560,
  },
  menuList: {
    gap: 8,
    paddingBottom: 8,
  },
  segmented: {
    flexDirection: 'row',
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.ink(0.14),
    overflow: 'hidden',
    flexShrink: 1,
  },
  segment: {
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  segmentDivider: {
    borderLeftWidth: 1,
    borderLeftColor: P.ink(0.14),
  },
  segmentPressed: {
    backgroundColor: P.ink(0.1),
  },
  segmentBusy: {
    opacity: 0.5,
  },
  segmentText: {
    color: P.foreground,
    fontSize: 12.5,
  },
}));
