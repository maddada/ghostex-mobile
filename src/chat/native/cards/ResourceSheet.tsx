/**
 * The Chat Resources sheet: a question form (or chart) the reader tapped in the list, shown over
 * the chat so it can be answered, or its answer read, without scrolling to it. The form is the
 * transcript's own card (`QuestionFormCard`), so picking, Other, the notes, Send, For later and
 * Remove are the card's actions on the card's draft; closing the sheet half-filled loses nothing.
 * "Go to chat" scrolls the chat to the form, loading earlier messages first when it is older than
 * the loaded rows (the core does it: gx-chat-core `questions/resource_modal.rs`, where the user's
 * words are). Desktop: `resource_modal.rs`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, Text } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { Sheet } from '../composer/Sheet';
import { TranscriptEnvProvider, type TranscriptEnv } from '../transcript/context';
import { QuestionFormCard, QuestionFormsProvider } from '../transcript/QuestionForm';
import { VisualBlock } from '../transcript/VisualBlock';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function ResourceSheet({ chat, document }: { chat: RustChat; document: ChatDocument | null }) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  const modal = document?.resourceModal ?? null;
  const { dispatch: chatDispatch, uploadFiles, queryAsync } = chat;
  const forms = document?.questionForms ?? {};
  // The form the reader sent from this sheet (Send or Skip all), and whether its call was seen in
  // flight: the sheet closes (its own slide and fade) once the send settles OK, and stays open on
  // the answers when it fails (the form open again with its `sendError`). Desktop:
  // `resource_modal.rs` `settle_resource_modal_send`.
  //
  // CDXC:SessionChat 2026-11-12 DECISION:
  // User: as soon as the reply is sent, close the question form popup and the Ghostex page popup
  // with a short fade; keep it open with the answers if the send fails.
  const sent = useRef<{ id: string; seen: boolean } | null>(null);
  const modalId = modal?.id ?? null;
  const dispatch = useMemo<typeof chatDispatch>(
    () => (action) => {
      const type = (action as { type?: unknown }).type;
      const form = (action as { form?: unknown }).form;
      if ((type === 'formSend' || type === 'formSkipAll') && typeof form === 'string' && form === modalId) {
        sent.current = { id: form, seen: false };
      }
      return chatDispatch(action);
    },
    [chatDispatch, modalId],
  );
  const sentForm = sent.current ? (forms[sent.current.id] as { sendInFlight?: unknown; state?: unknown } | undefined) : undefined;
  const inFlight = sentForm?.sendInFlight === true;
  const sentState = typeof sentForm?.state === 'string' ? sentForm.state : '';
  useEffect(() => {
    const watched = sent.current;
    if (watched === null) return;
    if (modalId !== watched.id) {
      sent.current = null;
      return;
    }
    if (inFlight) {
      watched.seen = true;
      return;
    }
    if (sentState === 'open' || sentState === '') {
      // Not dispatched yet, or it failed after going out.
      if (watched.seen) sent.current = null;
      return;
    }
    sent.current = null;
    chatDispatch({ type: 'closeResource' });
  }, [modalId, inFlight, sentState, chatDispatch]);
  const env = useMemo<TranscriptEnv>(
    () => ({
      dispatch,
      theme,
      simple: false,
      workOpen: false,
      filePreviews: false,
      mutedThinking: false,
      main: false,
      uploadFiles,
      queryAsync,
    }),
    [dispatch, theme, uploadFiles, queryAsync],
  );
  return (
    <Sheet
      visible={modal !== null}
      onClose={() => dispatch({ type: 'closeResource' })}
      title={modal?.title && modal.title.length > 0 ? modal.title : 'Resource'}
      // No "Go to chat": nothing the reader taps scrolls the chat to a question any more
      // (gx-chat-core questions/open_questions.rs `show`).
    >
      {/* The panel stops at its max height; the form (two questions, a long option list) scrolls inside it. */}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {modal === null ? null : modal.loading ? (
          <Text style={styles.note}>Reading it from the chat…</Text>
        ) : modal.missing.length > 0 ? (
          <Text style={styles.note}>{modal.missing}</Text>
        ) : modal.kind === 'chart' ? (
          <VisualBlock source={modal.source} />
        ) : (
          <TranscriptEnvProvider value={env}>
            <QuestionFormsProvider value={forms}>
              <QuestionFormCard id={modal.id} source="" />
            </QuestionFormsProvider>
          </TranscriptEnvProvider>
        )}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
  content: { paddingBottom: 4 },
  note: { color: P.cardMuted, fontSize: 13.5, paddingHorizontal: 4, paddingVertical: 10 },
}));
