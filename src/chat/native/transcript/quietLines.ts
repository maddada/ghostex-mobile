/**
 * Quiet View's lines as the rows read them (gx-chat-core `transcript/quiet_view.rs`, desktop
 * `native_chat/quiet_view.rs` `QuietLines`): which line each row belongs to, which reply a line of
 * work item lines follows, the work item lines the lines hold and the answers cards drawn shut.
 * No React here, so the transcript's context can read it too; `quietView.tsx` draws them.
 */

import type {
  ChatDocument,
  CompletedWorkItem,
  GroupedWorkItem,
  ProjectedMessage,
  QuietAnswers,
  QuietStretch,
  QuietTurnTail,
  TranscriptItem,
} from '../../rust/document';
import type { WorkCardIndex } from '../cards/WorkCards';
import { arr, obj, str, type JsonRecord } from './json';

export type QuietLines = {
  /** The line each row belongs to, by row index. */
  rows: ReadonlyMap<number, QuietStretch>;
  /** The line of work item lines drawn after a reply's row, by row index. */
  after: ReadonlyMap<number, QuietStretch>;
  /** The work item lines the lines hold, which the replies no longer draw. */
  cards: ReadonlySet<string>;
  /** The answers cards drawn shut as a line of their own, by row id (`<turn id>#questions` for a turn's answered questions). */
  answers: ReadonlyMap<string, QuietAnswers>;
  /** The document's work item cards, for the lines that hold some. */
  workCards: readonly JsonRecord[];
};

/** The document's lines, or `null` when Quiet View draws nothing in it. */
export function quietLinesOf(document: ChatDocument | null): QuietLines | null {
  const quiet = obj(document?.quietView);
  if (quiet === null) return null;
  const stretches = arr(quiet.stretches)
    .map(obj)
    .filter((line): line is JsonRecord => line !== null && typeof line.key === 'string')
    .map((line) => line as unknown as QuietStretch);
  const answers = arr(quiet.answers)
    .map(obj)
    .filter((card): card is JsonRecord => card !== null && typeof card.id === 'string')
    .map((card) => card as unknown as QuietAnswers);
  if (stretches.length === 0 && answers.length === 0) return null;
  const rows = new Map<number, QuietStretch>();
  const after = new Map<number, QuietStretch>();
  const cards = new Set<string>();
  for (const line of stretches) {
    for (let row = line.start; row < line.end; row += 1) rows.set(row, line);
    if (typeof line.after === 'number') after.set(line.after, line);
    for (const key of line.cards ?? []) cards.add(key);
  }
  return {
    rows,
    after,
    cards,
    answers: new Map(answers.map((card) => [card.id, card])),
    workCards: arr(document?.workCards)
      .map(obj)
      .filter((card): card is JsonRecord => card !== null),
  };
}

/** `index` without the reply-anchored work item lines a quiet line holds (desktop `quiet_holds_card`). */
export function withoutHeldCards(index: WorkCardIndex, document: ChatDocument | null): WorkCardIndex {
  const lines = quietLinesOf(document);
  if (lines === null || lines.cards.size === 0) return index;
  const byAnchor: WorkCardIndex['byAnchor'] = {};
  for (const [anchor, cards] of Object.entries(index.byAnchor)) {
    const kept = cards.filter((card) => !lines.cards.has(str(card, 'key')));
    if (kept.length > 0) byAnchor[anchor] = kept;
  }
  return { ...index, byAnchor };
}

/** The work item cards `line` holds. */
export function lineCards(lines: QuietLines, line: QuietStretch): JsonRecord[] {
  const held = line.cards ?? [];
  if (held.length === 0) return [];
  return lines.workCards.filter((card) => held.includes(str(card, 'key')));
}

type TurnParts = {
  artifacts: ProjectedMessage[];
  questions: unknown[];
  sentMessages?: unknown[];
  final?: ProjectedMessage;
};

/** What one turn keeps in view after its line. */
export type KeptTurn = {
  /** The turn's id: the `completed-work` row's, or the merged turn's. */
  id: string;
  artifacts: ProjectedMessage[];
  questions: unknown[];
  sent: unknown[];
  reply: ProjectedMessage | null;
};

function turnsOf(item: TranscriptItem): { id: string; parts: TurnParts }[] {
  if (item.kind === 'completed-work') {
    const work = item as CompletedWorkItem;
    return [{ id: work.id, parts: work }];
  }
  if (item.kind === 'grouped-work') {
    return (item as GroupedWorkItem).turns.map((turn) => ({ id: turn.id, parts: turn as unknown as TurnParts }));
  }
  return [];
}

/** `item` without what of it stays in view after its line (desktop `fold_part`). */
export function foldPart(item: TranscriptItem, tail: { turns: QuietTurnTail[] }): TranscriptItem {
  const trim = (parts: TurnParts, turn: QuietTurnTail): TurnParts => {
    const keptIds = new Set(turn.artifacts ?? []);
    const sends = new Set(turn.sends ?? []);
    // `final` is always written, so merging this over the row drops a reply that stays in view.
    return {
      artifacts: parts.artifacts.filter((row) => !keptIds.has(row.id)),
      questions: turn.questions === true ? [] : parts.questions,
      sentMessages: arr(parts.sentMessages).filter((_, at) => !sends.has(at)),
      final: turn.reply === true ? undefined : parts.final,
    };
  };
  if (item.kind === 'completed-work') {
    let work = item as CompletedWorkItem;
    for (const turn of tail.turns) work = { ...work, ...trim(work, turn) } as CompletedWorkItem;
    return work as unknown as TranscriptItem;
  }
  if (item.kind === 'grouped-work') {
    const grouped = item as GroupedWorkItem;
    const turns = grouped.turns.slice();
    for (const turn of tail.turns) {
      const at = turns[turn.turn];
      if (at !== undefined) turns[turn.turn] = { ...at, ...trim(at as unknown as TurnParts, turn) } as typeof at;
    }
    return { ...grouped, turns } as unknown as TranscriptItem;
  }
  return item;
}

/** What each turn of `item` keeps in view after its line (desktop `kept_parts`). */
export function keptParts(item: TranscriptItem, tail: { turns: QuietTurnTail[] }): KeptTurn[] {
  const turns = turnsOf(item);
  const single = item.kind === 'completed-work';
  const kept: KeptTurn[] = [];
  for (const turn of tail.turns) {
    const found = single ? turns[0] : turns[turn.turn];
    if (found === undefined) continue;
    const { id, parts } = found;
    const keptIds = new Set(turn.artifacts ?? []);
    const sent = arr(parts.sentMessages);
    kept.push({
      id,
      artifacts: parts.artifacts.filter((row) => keptIds.has(row.id)),
      questions: turn.questions === true ? parts.questions : [],
      sent: (turn.sends ?? []).map((at) => sent[at]).filter((card) => card !== undefined),
      reply: turn.reply === true && parts.final !== undefined ? parts.final : null,
    });
  }
  return kept;
}
