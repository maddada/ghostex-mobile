/**
 * A coordinator's work item cards under its replies (`workCards` in the chat core's document,
 * `packages/gx-chat-core/src/extras/work_cards.rs`, which holds the user's decision): a card per item
 * the turn changed, with its status, where it stands, who has the ball and how long ago, and a card
 * per ask with its answer buttons; an item's earlier cards and settled asks fold to one quiet line.
 * Port of desktop `native_chat/work_cards.rs`.
 *
 * A tap on an answer sends `coordinatorBoardAnswer`, which the core records with gxserver once and
 * then tells the coordinator ("W3 Q2: Now"). Every button is a neutral fill, never the dark primary
 * one: the card sits on the chat's glass (the user's standing rule, no black fills on glass).
 */

import { Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { SidebarPalette } from '../../../theme/palette';
import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { ToneButton } from './ToneCard';
import { askColor, tint } from './askCard';
import { QuestionFlashFrame } from '../transcript/OpenQuestions';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

type Dispatch = RustChat['dispatch'];

/** Each status's colour, the board's (`CoordinatorBoard.tsx` `GROUP_COLOR`, desktop `group_look`). */
const STATUS_COLOR: Record<string, string> = {
  needs: SidebarPalette.ROW_QUESTION,
  blocked: SidebarPalette.ROW_APPROVAL,
  waiting: '#7fa1c4',
  moving: '#c68a06',
  finished: '#2fa865',
};

const CHIP_ICON: Record<string, GlyphName> = {
  you: 'user',
  thread: 'robot',
  coordinator: 'coordinator-crown',
  steps: 'checklist',
  item: 'stack',
  wait: 'clock',
};

/** The cards in the document, by the reply each sits under and by summary-mode turn. */
export type WorkCardIndex = {
  byAnchor: { [messageId: string]: JsonRecord[] };
  byTurn: { [turnId: string]: JsonRecord[] };
};

export function workCardIndex(document: ChatDocument | null): WorkCardIndex {
  const index: WorkCardIndex = { byAnchor: {}, byTurn: {} };
  for (const card of arr(document?.workCards)
    .map(obj)
    .filter((card): card is JsonRecord => card !== null && str(card, 'key').length > 0)) {
    const anchor = str(card, 'anchorId');
    const turn = str(card, 'turnId');
    if (anchor.length > 0) (index.byAnchor[anchor] ??= []).push(card);
    if (turn.length > 0) (index.byTurn[turn] ??= []).push(card);
  }
  return index;
}

/** A status's marker: the board's ring with a dot, disc, pause, check or dashed ring. */
function StatusMarker({ status, size, dim }: { status: string; size: number; dim?: boolean }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const color = STATUS_COLOR[status] ?? P.cardMuted;
  const opacity = dim === true ? 0.8 : 1;
  if (status === 'finished') return <Glyph name="circle-check-filled" size={size} color={color} />;
  if (status === 'dropped') return <Glyph name="x" size={size} color={P.muted} />;
  const box = { width: size, height: size, opacity };
  if (status === 'waiting') {
    return (
      <View style={[styles.pause, box]}>
        <View style={[styles.pauseBar, { backgroundColor: color }]} />
        <View style={[styles.pauseBar, { backgroundColor: color }]} />
      </View>
    );
  }
  if (status === 'blocked' || status === 'moving') {
    return <View style={[box, { borderRadius: size / 2, backgroundColor: color }]} />;
  }
  if (status === 'needs') {
    return (
      <View style={[box, styles.ring, { borderRadius: size / 2, borderColor: color }]}>
        <View style={[styles.ringDot, { backgroundColor: color }]} />
      </View>
    );
  }
  return <View style={[box, styles.ring, { borderRadius: size / 2, borderColor: color, borderStyle: 'dashed' }]} />;
}

/** The cards under one reply or summary-mode turn. */
export function WorkCardStack({ cards, dispatch }: { cards: JsonRecord[]; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  if (cards.length === 0) return null;
  return (
    <View style={styles.stack}>
      {cards.map((card) => (
        // The ? pill's jump lands on an ask's card and outlines it (`OpenQuestions.tsx`).
        <QuestionFlashFrame key={str(card, 'key')} target={str(card, 'key')} light={P.light}>
          {isTrue(card, 'folded') ? <WorkFoldLine card={card} /> : <WorkCard card={card} dispatch={dispatch} />}
        </QuestionFlashFrame>
      ))}
    </View>
  );
}

function WorkCard({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const status = str(card, 'statusLabel');
  const right = [status, str(card, 'age')].filter((part) => part.length > 0).join(' · ');
  const line = str(card, 'line');
  const chips = arr(card.chips)
    .map(obj)
    .filter((chip): chip is JsonRecord => chip !== null);
  const buttons = arr(card.buttons)
    .map(obj)
    .filter((button): button is JsonRecord => button !== null);
  const busy = isTrue(card, 'busy');
  return (
    <View accessible={false} accessibilityLabel={`${str(card, 'title')}, ${status}`} style={styles.card}>
      <View style={styles.top}>
        <View style={styles.marker}>
          <StatusMarker status={str(card, 'status')} size={13} />
        </View>
        <Text style={styles.title}>{str(card, 'title')}</Text>
        {right.length > 0 ? <Text style={styles.right}>{right}</Text> : null}
      </View>
      {line.length > 0 ? <Text style={styles.line}>{line}</Text> : null}
      {chips.length > 0 || buttons.length > 0 ? (
        <View style={styles.meta}>
          {chips.map((chip, index) => (
            <View key={`chip:${index}`} style={styles.chip}>
              <Glyph name={CHIP_ICON[str(chip, 'kind')] ?? 'clock'} size={12} color={P.cardMuted} />
              <Text numberOfLines={1} style={styles.chipText}>
                {str(chip, 'label')}
              </Text>
            </View>
          ))}
          {buttons.length > 0 ? (
            <View style={styles.buttons}>
              {buttons.map((button, index) => (
                <ToneButton
                  key={`answer:${index}`}
                  kind="secondary"
                  label={str(button, 'label')}
                  // The recommended answer carries the question forms' star (`askCard.tsx` `RecommendedMark`).
                  trailing={
                    isTrue(button, 'recommended') ? (
                      <Glyph name="star" size={10} color={tint(askColor(P.light), 0.75)} />
                    ) : undefined
                  }
                  accessibilityLabel={
                    isTrue(button, 'recommended') ? `${str(button, 'label')}, Recommended` : undefined
                  }
                  icon={isTrue(button, 'picked') ? 'check' : undefined}
                  disabled={busy}
                  onPress={() => dispatch(button.command as never)}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** An item's earlier card, or a settled ask: one quiet line, what that turn did, and when. */
function WorkFoldLine({ card }: { card: JsonRecord }) {
  const styles = useStyles();
  const status = str(card, 'foldStatus') || str(card, 'status');
  return (
    <View accessibilityLabel={str(card, 'foldText')} style={styles.fold}>
      <StatusMarker status={status} size={11} dim />
      <Text numberOfLines={1} style={styles.foldText}>
        {str(card, 'foldText')}
      </Text>
      <Text style={styles.foldTime}>{str(card, 'time')}</Text>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  stack: { gap: 6, marginTop: 8 },
  card: {
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.cardPanel,
  },
  // On a narrow screen the status and age wrap under the title rather than squeeze it.
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 8 },
  marker: { width: 14, height: 20, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 140, fontSize: 14, lineHeight: 20, fontWeight: '500', color: P.foreground },
  right: { marginLeft: 'auto', fontSize: 12.5, lineHeight: 20, color: P.cardMuted },
  line: { paddingLeft: 22, fontSize: 13, lineHeight: 19, color: P.cardMuted },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 22, paddingTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 22,
    maxWidth: 240,
    paddingHorizontal: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: P.inputBorder,
  },
  chipText: { flexShrink: 1, fontSize: 12.5, color: P.cardMuted },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' },
  fold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.inputBorder,
  },
  foldText: { flex: 1, minWidth: 0, fontSize: 12.5, color: P.muted },
  foldTime: { fontSize: 12.5, color: P.muted },
  ring: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  ringDot: { width: 4, height: 4, borderRadius: 2 },
  pause: { flexDirection: 'row', justifyContent: 'center', gap: 2.5 },
  pauseBar: { width: 3, borderRadius: 1, height: '100%' },
}));
