/**
 * The "GBot added" card (desktop `gbot_card.rs`): Chief of Staff added a GBot on its own. The bot's
 * icon in its colour, "Researcher added", what it is and runs on, then Undo and Open settings; after
 * Undo, "Researcher removed" and "Undone".
 *
 * The words come from the core (`gbotCards` on a message or finished turn, `gbotCardStates` in the
 * document; packages/gx-chat-core/src/transcript/gbot_cards.rs, where the user's decision is); a
 * card with no state yet asks for it once with `{type: 'gbotCard', op: 'load'}`.
 *
 * Open settings asks the core (`op: 'openSettings'`), which hands the screen `openGbotSettings
 * {botId, machineId}`; the chat screen opens the same GBot Settings sheet a GBot's long press does
 * (NativeChatScreen.tsx, screens/sessions-screen/GbotSettingsHost.tsx), as the desktop opens its
 * window.
 */

import { memo, useEffect } from 'react';
import { Text, View } from 'react-native';

import type { Json } from '../../rust/document';
import { GbotIcon } from '../../../components/sessions/gbotIcons';
import { ToneButton, ToneCard } from '../cards/ToneCard';
import { CARD_TEXT_SIZE } from '../cards/primitives';
import { useTranscriptEnv, useTranscriptFlags } from './context';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { themedStyles } from './theme';

/** Change ids this app already asked the core about, so a redraw never asks again. */
const asked = new Set<string>();

/** The "GBot added" cards of one message or finished turn. */
export function GbotCards({ cards }: { cards: Json | undefined }) {
  const rows = arr(cards)
    .map(obj)
    .filter((card): card is JsonRecord => card !== null && str(card, 'changeId').length > 0);
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {rows.map((card) => (
        <GbotCard key={str(card, 'changeId')} card={card} />
      ))}
    </View>
  );
}

const GbotCard = memo(function GbotCard({ card }: { card: JsonRecord }) {
  const styles = useStyles();
  const { dispatch } = useTranscriptEnv();
  const { gbotCardStates } = useTranscriptFlags();
  const changeId = str(card, 'changeId');
  const state = obj(gbotCardStates[changeId]);
  useEffect(() => {
    if (state === null && !asked.has(changeId)) {
      asked.add(changeId);
      dispatch({ type: 'gbotCard', op: 'load', changeId });
    }
  }, [changeId, dispatch, state]);
  const undone = state !== null && isTrue(state, 'undone');
  const line = str(card, 'body');
  const note = state === null ? '' : str(state, 'note');
  const error = state === null ? '' : str(state, 'error');
  const undoLabel = state === null ? '' : str(state, 'undoLabel');
  return (
    <ToneCard
      tone="info"
      hue={str(card, 'colorHex')}
      tileGlyph={(size, color) => <GbotIcon icon={str(card, 'icon')} color={color} size={size} />}
      title={undone ? str(card, 'removedTitle') : str(card, 'title')}
      accessibilityLabel={undone ? str(card, 'removedTitle') : str(card, 'title')}
      body={[
        line.length > 0 && !undone ? (
          <Text key="line" selectable style={styles.line}>
            {line}
          </Text>
        ) : null,
        note.length > 0 ? (
          <Text key="note" style={styles.note}>
            {note}
          </Text>
        ) : null,
        error.length > 0 ? (
          <Text key="error" style={styles.error}>
            {error}
          </Text>
        ) : null,
      ]}
      footerEnd={
        undone
          ? []
          : [
              <ToneButton
                key="undo"
                kind="secondary"
                icon="arrow-back-up"
                label={undoLabel.length > 0 ? undoLabel : 'Undo'}
                disabled={state === null || !isTrue(state, 'undoEnabled')}
                onPress={() => dispatch({ type: 'gbotCard', op: 'undo', changeId })}
              />,
              ...(state !== null && isTrue(state, 'settingsEnabled')
                ? [
                    <ToneButton
                      key="settings"
                      kind="secondary"
                      icon="settings"
                      label="Open settings"
                      onPress={() =>
                        dispatch({ type: 'gbotCard', op: 'openSettings', changeId, botId: str(card, 'botId') })
                      }
                    />,
                  ]
                : []),
            ]
      }
    />
  );
});

const useStyles = themedStyles((P) => ({
  line: {
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: 20,
  },
  note: {
    color: P.muted,
    fontSize: 12.5,
    lineHeight: 17,
  },
  error: {
    color: '#ef9999',
    fontSize: 12.5,
  },
}));
