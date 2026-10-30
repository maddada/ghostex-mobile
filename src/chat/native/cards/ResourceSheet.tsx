/**
 * The Chat Resources sheet: a question form (or chart) the reader tapped in the list, shown over
 * the chat so it can be answered, or its answer read, without scrolling to it. The form is the
 * transcript's own card (`QuestionFormCard`), so picking, Other, the notes, Send, For later and
 * Remove are the card's actions on the card's draft; closing the sheet half-filled loses nothing.
 * "Go to chat" scrolls the chat to the form, loading earlier messages first when it is older than
 * the loaded rows (the core does it: gx-chat-core `questions/resource_modal.rs`, where the user's
 * words are). Desktop: `resource_modal.rs`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

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
  const { dispatch } = chat;
  const env = useMemo<TranscriptEnv>(
    () => ({
      dispatch,
      theme,
      verbose: false,
      simple: false,
      workOpen: false,
      filePreviews: false,
      mutedThinking: false,
      main: false,
    }),
    [dispatch, theme],
  );
  const forms = document?.questionForms ?? {};
  const open = modal !== null;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(true), Platform.OS === 'ios' ? IOS_PRESENT_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <Sheet
      visible={open && shown}
      onClose={() => dispatch({ type: 'closeResource' })}
      title={modal?.title && modal.title.length > 0 ? modal.title : 'Resource'}
      accessory={
        modal !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to chat"
            accessibilityState={{ disabled: modal.going || modal.loading }}
            disabled={modal.going || modal.loading}
            onPress={() => dispatch({ type: 'goToResource', id: modal.id })}
            style={({ pressed }) => [styles.go, (pressed || modal.going) && styles.goBusy]}
          >
            <Text style={styles.goLabel}>{modal.going ? 'Loading…' : 'Go to chat'}</Text>
          </Pressable>
        ) : undefined
      }
    >
      {modal === null ? null : modal.loading ? (
        <Text style={styles.note}>Reading it from the chat…</Text>
      ) : modal.missing.length > 0 ? (
        <Text style={styles.note}>{modal.missing}</Text>
      ) : modal.kind === 'chart' ? (
        <VisualBlock source={modal.source} />
      ) : (
        <TranscriptEnvProvider value={env}>
          <QuestionFormsProvider value={forms}>
            <View>
              <QuestionFormCard id={modal.id} source="" />
            </View>
          </QuestionFormsProvider>
        </TranscriptEnvProvider>
      )}
    </Sheet>
  );
}

/** The list's sheet is still sliding away when a row opens this one, and iOS drops a modal presented during another's dismissal (desktop has no such wait). */
const IOS_PRESENT_DELAY_MS = 320;

const useStyles = themedStyles((P) => ({
  go: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: P.ink(0.12),
    backgroundColor: P.ink(0.06),
  },
  goBusy: { opacity: 0.55 },
  goLabel: { color: P.primary, fontSize: 13 },
  note: { color: P.cardMuted, fontSize: 13.5, paddingHorizontal: 4, paddingVertical: 10 },
}));
