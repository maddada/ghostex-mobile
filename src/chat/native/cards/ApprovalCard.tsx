/**
 * The approval card, in the tone card's approval tone: the chat core's plain-words title ("Claude
 * Code wants to run a command"), the tool and folder under it, the command, then Copy on the left
 * and Deny / Allow on the right. Port of desktop `approval.rs`; the phone has no keyboard hints.
 */

import * as Clipboard from 'expo-clipboard';
import { Text } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { APPROVAL_ASK_FALLBACK, APPROVAL_TITLE_FALLBACK, RECONNECTING_NOTE, approvalAnswer } from './answers';
import { str } from './json';
import { useCardText } from './primitives';
import { CommandBox, PendingAnswerNote, ToneButton, ToneCard, ToneDismiss, dimPending, isShellTool } from './ToneCard';

export function ApprovalCard({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const cardText = useCardText();
  const { dispatch } = chat;
  const prompt = document.prompt;
  const card = document.questionCard;
  // An answered approval waits here, dimmed and held, until its prompt is gone (the chat core's questions/pending_approval.rs).
  const pending = document.approvalPending?.card === 'prompt';
  const busy = card.busy || pending;
  const summary = str(prompt, 'summary');
  const tool = str(prompt, 'tool');
  const body =
    summary.length > 0
      ? [<CommandBox key="command" command={summary} shell={isShellTool(tool)} />]
      : [
          <Text key="ask" style={cardText.prose}>
            {card.approvalAsk || APPROVAL_ASK_FALLBACK}
          </Text>,
        ];
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
