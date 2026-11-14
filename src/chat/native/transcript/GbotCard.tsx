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
 *
 * The "Routine set" card (`kind: routineSet`, gx-chat-core `routine_cards.rs`) is drawn here too: the GBot's icon,
 * "Routine set: Inbox watch", its schedule in words and its next run, then Pause (Resume), Edit and Undo. Edit opens
 * the GBot's Routines in its settings sheet, since the phone has no Automate view.
 *
 * The "Theme changed" card (`kind: themeChanged`, gx-chat-core `theme_cards.rs`, desktop `theme_card.rs`) is NOT
 * drawn on the phone: `shownGbotCards` drops it, so every caller (this stack, the row gaps, Quiet View parts) sees
 * no card at all. CDXC:PhoneTheme 2026-11-14: the user said "phone shouldn't care about theme being changed on the
 * pc". The desktop and web builds keep the card.
 */

import { memo, useEffect } from 'react';
import { Text, View } from 'react-native';

import type { Json } from '../../rust/document';
import { GbotIcon } from '../../../components/sessions/gbotIcons';
import { ToneButton, ToneCard } from '../cards/ToneCard';
import { ErrorLine } from '../cards/ErrorLine';
import { CARD_TEXT_SIZE } from '../cards/primitives';
import { useTranscriptEnv, useTranscriptFlags } from './context';
import { cardStackMargin } from './cardSpacing';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { useRowGap } from './messageSpacing';
import { themedStyles } from './theme';

/** Change ids this app already asked the core about, so a redraw never asks again. */
const asked = new Set<string>();

/** Card kinds the phone never draws (CDXC:PhoneTheme 2026-11-14, user: "phone shouldn't care about theme being changed on the pc"). */
const HIDDEN_ON_PHONE = new Set(['themeChanged']);

/**
 * The cards of `cards` that are drawn: each with a change id, less those whose state says GBots are off (core
 * `gbot_cards.rs`, CDXC:GBots 2026-11-09: hidden while GBots are off) and the kinds the phone never draws
 * ({@link HIDDEN_ON_PHONE}). Every caller sizes its gaps from this list, so a hidden card leaves no gap.
 */
export function shownGbotCards(cards: Json | undefined, states: { [changeId: string]: Json }): JsonRecord[] {
  return arr(cards)
    .map(obj)
    .filter(
      (card): card is JsonRecord =>
        card !== null &&
        str(card, 'changeId').length > 0 &&
        !HIDDEN_ON_PHONE.has(str(card, 'kind')) &&
        !isTrue(states[str(card, 'changeId')], 'off'),
    );
}

/** The "GBot added" cards of one message or finished turn. */
/**
 * The "GBot added" cards, a stack of one-line cards: `aboveIsCard` and `columnGap` place it a row
 * gap under the card above it in a column whose own gap is `columnGap` (`cardSpacing.ts`, desktop
 * `spaced_tail`).
 */
export function GbotCards({
  cards,
  aboveIsCard = false,
  columnGap = 0,
}: {
  cards: Json | undefined;
  aboveIsCard?: boolean;
  columnGap?: number;
}) {
  const { gbotCardStates } = useTranscriptFlags();
  const rowGap = useRowGap();
  const rows = shownGbotCards(cards, gbotCardStates);
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 8, marginTop: cardStackMargin(aboveIsCard, columnGap, rowGap) }}>
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
  const routine = str(card, 'kind') === 'routineSet';
  const routineState = routine && state !== null && isTrue(state, 'routine') ? state : null;
  const next = routineState === null ? '' : str(routineState, 'next');
  const checkNote = routineState === null ? '' : str(routineState, 'checkNote');
  const routineId = str(card, 'routineId');
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
        next.length > 0 && !undone ? (
          <Text key="next" style={styles.line}>
            {next}
          </Text>
        ) : null,
        checkNote.length > 0 && !undone ? (
          <Text key="check" style={styles.note}>
            {checkNote}
          </Text>
        ) : null,
        note.length > 0 ? (
          <Text key="note" style={styles.note}>
            {note}
          </Text>
        ) : null,
        error.length > 0 ? <ErrorLine key="error" message={error} /> : null,
      ]}
      footerEnd={
        undone
          ? []
          : [
              ...(routineState !== null
                ? [
                    <ToneButton
                      key="pause"
                      kind="secondary"
                      icon={isTrue(routineState, 'paused') ? 'player-play' : 'player-pause'}
                      label={str(routineState, 'pauseLabel')}
                      disabled={!isTrue(routineState, 'pauseEnabled')}
                      onPress={() =>
                        dispatch({
                          type: 'gbotCard',
                          op: isTrue(routineState, 'paused') ? 'resume' : 'pause',
                          changeId,
                          routineId,
                        })
                      }
                    />,
                    ...(isTrue(routineState, 'editEnabled')
                      ? [
                          <ToneButton
                            key="edit"
                            kind="secondary"
                            icon="pencil"
                            label="Edit"
                            onPress={() =>
                              dispatch({ type: 'gbotCard', op: 'edit', changeId, botId: str(card, 'botId'), routineId })
                            }
                          />,
                        ]
                      : []),
                  ]
                : []),
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
}));
