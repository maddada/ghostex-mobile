/**
 * The approval card, in the tone card's approval tone: the chat core's plain-words title ("Claude
 * Code wants to run a command"), the tool and folder under it, the command, then Copy on the left
 * and Deny / Allow on the right. Port of desktop `approval.rs`; the phone has no keyboard hints.
 */

import * as Clipboard from 'expo-clipboard';
import { Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { APPROVAL_ASK_FALLBACK, APPROVAL_TITLE_FALLBACK, RECONNECTING_NOTE, approvalAnswer } from './answers';
import { Glyph } from './icons';
import { str } from './json';
import { useCardText } from './primitives';
import {
  CommandBox,
  PendingAnswerNote,
  ToneButton,
  ToneCard,
  ToneDismiss,
  dimPending,
  isShellTool,
  toneLook,
} from './ToneCard';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function ApprovalCard({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const cardText = useCardText();
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { dispatch } = chat;
  const prompt = document.prompt;
  const card = document.questionCard;
  // An answered approval waits here, dimmed and held, until its prompt is gone (the chat core's questions/pending_approval.rs).
  const pending = document.approvalPending?.card === 'prompt';
  const busy = card.busy || pending;
  const summary = str(prompt, 'summary');
  const tool = str(prompt, 'tool');
  const reason = (card.approvalReason?.trim() || str(prompt, 'reason').trim());
  const body =
    summary.length > 0
      ? [<CommandBox key="command" command={summary} shell={isShellTool(tool)} />]
      : [
          <Text key="ask" style={cardText.prose}>
            {card.approvalAsk || APPROVAL_ASK_FALLBACK}
          </Text>,
        ];
  if (reason.length > 0) {
    const warning = toneLook('warning', P.light);
    const hue = warning.hue ?? P.muted;
    const isHex = /^#[0-9a-fA-F]{6}$/.test(hue);
    body.push(
      <View
        key="reason"
        style={[
          styles.reasonBox,
          {
            borderColor: isHex ? `${hue}47` : P.border,
            backgroundColor: isHex ? `${hue}14` : P.ink(0.06),
          },
        ]}
      >
        <Glyph name={warning.icon} size={14} color={hue} />
        <Text style={styles.reasonText}>{reason}</Text>
      </View>,
    );
  }
  if (card.reconnecting === true) {
    body.push(
      <Text key="reconnecting" style={cardText.hint}>
        {RECONNECTING_NOTE}
      </Text>,
    );
  }
  return (
    <ToneCard
      tone="approval"
      title={card.approvalTitle || APPROVAL_TITLE_FALLBACK}
      detail={card.approvalDetail}
      trailing={pending ? undefined : <ToneDismiss onPress={() => dispatch({ type: 'questionCancel' })} />}
      body={dimPending(body, pending)}
      footerStart={
        pending
          ? [<PendingAnswerNote key="pending" words={document.approvalPending?.sending ?? 'Sending…'} />]
          : summary.length > 0
            ? [
                <ToneButton
                  key="copy"
                  kind="secondary"
                  icon="copy"
                  label="Copy"
                  onPress={() => void Clipboard.setStringAsync(summary)}
                />,
              ]
            : []
      }
      footerEnd={[
        <ToneButton
          key="deny"
          kind="secondary"
          label="Deny"
          disabled={busy}
          onPress={() => dispatch(approvalAnswer(false))}
        />,
        <ToneButton
          key="allow"
          kind="primary"
          label="Allow"
          disabled={busy}
          onPress={() => dispatch(approvalAnswer(true))}
        />,
      ]}
    />
  );
}

const useStyles = themedStyles((P) => ({
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  reasonText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    color: P.foreground,
  },
}));
