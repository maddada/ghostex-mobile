/**
 * The private secret request cards above the composer (`secretRequests` in the chat core's
 * document, `packages/gx-chat-core/src/extras/secret_requests.rs`): an agent asked for a
 * password, key or token with `ghostex secret request`. Port of desktop `secret_request.rs`.
 *
 * The typed value lives only in this card's own state, in a secure field, until Save sends it
 * once with the `answerSecretRequest` action; it is never echoed through the core's document or
 * the composer draft. The field is cleared when its card closes.
 */

import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph } from './icons';
import { ErrorLine } from './ErrorLine';
import { arr, isTrue, str, type JsonRecord, obj } from './json';
import { CARD_TEXT_SIZE } from './primitives';
import { ToneButton, ToneCard } from './ToneCard';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function SecretRequestCards({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const cards = arr(document.secretRequests)
    .map(obj)
    .filter((card): card is JsonRecord => card !== null && str(card, 'id').length > 0);
  if (cards.length === 0) return null;
  return (
    <>
      {cards.map((card) => (
        <SecretRequestCard key={str(card, 'id')} chat={chat} card={card} />
      ))}
    </>
  );
}

function SecretRequestCard({ chat, card }: { chat: RustChat; card: JsonRecord }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [secret, setSecret] = useState('');
  const id = str(card, 'id');
  const open = isTrue(card, 'open');
  const busy = isTrue(card, 'busy');
  useEffect(() => {
    if (!open) setSecret('');
  }, [open]);
  if (!open) {
    return <ToneCard tone="approval" icon="lock" title={str(card, 'label')} detail={str(card, 'closedLabel')} />;
  }
  const canSave = !busy && secret.trim().length > 0;
  const save = () => {
    if (canSave) chat.dispatch({ type: 'answerSecretRequest', requestId: id, secret });
  };
  const error = str(card, 'error');
  return (
    <ToneCard
      tone="approval"
      icon="lock"
      title={str(card, 'label')}
      detail={str(card, 'title')}
      body={[
        <Text key="reason" selectable style={styles.reason}>
          {str(card, 'reason')}
        </Text>,
        <TextInput
          key="field"
          style={styles.field}
          value={secret}
          onChangeText={setSecret}
          editable={!busy}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          spellCheck={false}
          submitBehavior="submit"
          returnKeyType="done"
          onSubmitEditing={save}
          placeholder={str(card, 'placeholder')}
          placeholderTextColor={P.placeholder}
          accessibilityLabel={str(card, 'label')}
        />,
        error.length > 0 ? <ErrorLine key="error" message={error} /> : null,
        <View key="note" style={styles.note}>
          <Glyph name="shield-check" size={13} color={P.muted} />
          <Text style={styles.noteText}>{str(card, 'note')}</Text>
        </View>,
      ]}
      footerEnd={[
        <ToneButton
          key="decline"
          kind="secondary"
          label={str(card, 'declineLabel')}
          disabled={busy}
          onPress={() => chat.dispatch({ type: 'answerSecretRequest', requestId: id, decline: true })}
        />,
        <ToneButton
          key="save"
          kind="primary"
          icon="lock"
          label={str(card, 'saveLabel')}
          disabled={!canSave}
          onPress={save}
        />,
      ]}
    />
  );
}

const useStyles = themedStyles((P) => ({
  reason: {
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: 20,
  },
  field: {
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    borderWidth: 1,
    borderColor: P.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: P.background,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  noteText: {
    flex: 1,
    color: P.muted,
    fontSize: 12,
    lineHeight: 16,
  },
}));
