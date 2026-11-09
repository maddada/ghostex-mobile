/**
 * The `grouped-work` row under Agent work Reduced (`quietWork.tsx` draws the line): one line for
 * every turn the agent ran for one message of yours (desktop `grouped_work_row` in `quiet_work.rs`,
 * gx-chat-core `transcript/grouped_work.rs`), then each turn's tail as a finished turn draws it
 * (`work_tail_parts`): its artifacts, answered questions, sent messages, GBot cards, Workflow cards and reply,
 * which never fold. Agent work Quiet draws the same tail (`hiddenWork.tsx`).
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { GroupedTurn, GroupedWorkItem, ProjectedMessage } from '../../rust/document';
import { QuestionExchangeCards } from '../cards';
import { SentAgentMessageCards } from './AgentMessageCards';
import { gapAbove } from './cardSpacing';
import { useNativeChatUi, useTranscriptEnv, useTranscriptFlags } from './context';
import { DeferredNotice } from './DeferredNotice';
import { FoldPlaceProvider } from './Disclosure';
import { FileChangeStack } from './FileChanges';
import { ReadImageStrip } from './Images';
import { arr, num, obj, str, type JsonRecord } from './json';
import { useRowGap } from './messageSpacing';
import { MessageRow } from './MessageRow';
import {
  countSegments,
  finishedMark,
  lowerFirst,
  QUIET_TEXT_GAP,
  quietSegments,
  QuietSteps,
  QuietWorkLine,
} from './quietWork';
import { useDisclosure } from './state';
import { GbotCards, shownGbotCards } from './GbotCard';
import { WorkflowCards } from './WorkflowCard';

/** The space between the parts of a finished turn's tail (desktop `PART_GAP` in completed_work_row.rs). */
const PART_GAP = 10;
/** An opened line's rows: plain tool pairs, writes hidden (they belong to the edit line), each call a step. */
export const QUIET_STEPS = { inWorkFold: true, hideFileChanges: true, quietSteps: true };
const HIDE_FILES = { inWorkFold: false, hideFileChanges: true };

/** What a finished turn keeps out of its fold (desktop `WorkTail`). */
export type WorkTail = Pick<
  GroupedTurn,
  'id' | 'questions' | 'sentMessages' | 'gbotCards' | 'workflows' | 'artifacts' | 'final'
>;

/**
 * A `grouped-work` row: "Worked for 1m 16s · 9 tool calls · edited 2 files +14 −3", its steps when
 * opened (and the merged turns' file card after them, the one place their diffs show), then each
 * turn's tail. Opening it reads each section still on the computer once, keyed by the section's
 * prompt (`startId`), which every turn it holds looks its rows up by.
 */
export function GroupedWorkRow({ item }: { item: GroupedWorkItem }) {
  const { workOpen, theme, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const flags = useTranscriptFlags();
  const key = `work:${item.id}`;
  const [open, toggleRaw] = useDisclosure(disclosures, key, workOpen);
  // One read per section: several wake-up turns can share their prompt's section.
  const sections: { owner: string; work: JsonRecord }[] = [];
  const seen = new Set<string>();
  for (const turn of item.turns) {
    const section = obj(turn.deferred);
    if (section === null) continue;
    const signature = JSON.stringify(section);
    if (seen.has(signature)) continue;
    seen.add(signature);
    sections.push({ owner: typeof section.startId === 'string' ? section.startId : turn.id, work: section });
  }
  const toggle = () => {
    if (!open) {
      for (const { owner, work } of sections) dispatch({ type: 'loadWork', id: owner, work: work as never });
    }
    toggleRaw();
  };
  const segments = quietSegments(item.label, item.stats ?? [], theme);
  if ((item.stats ?? []).some((stat) => str(stat, 'kind') === 'files')) {
    segments.push({ text: ` · ${lowerFirst(item.simpleFilesLabel)}` });
    segments.push(...countSegments(num(item.filesCard, 'added') ?? 0, num(item.filesCard, 'removed') ?? 0, theme));
  }
  const notices = sections
    .filter(({ owner }) => flags.deferredWork[owner] !== undefined)
    .map(({ owner, work }) => (
      <DeferredNotice key={owner} id={owner} deferred={work} error={flags.deferredWork[owner]?.error ?? ''} />
    ));
  const hasFiles = arr(item.files).length > 0;
  return (
    <View style={styles.column}>
      <QuietWorkLine
        segments={segments}
        mark={finishedMark(item.work)}
        open={open}
        expandable={item.expandable}
        onPress={toggle}
      />
      {open ? (
        notices.length > 0 || item.work.length > 0 || hasFiles ? (
          <FoldPlaceProvider value={QUIET_STEPS}>
            <QuietSteps>
              {notices}
              {item.work.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
              {hasFiles ? (
                <View style={styles.groupedFiles}>
                  <FileChangeStack stackId={key} files={item.files} card={item.filesCard} />
                </View>
              ) : null}
            </QuietSteps>
          </FoldPlaceProvider>
        ) : null
      ) : (item.readImages ?? []).length > 0 ? (
        // The closed line keeps the pictures its work read in view (gx-chat-core `read_images.rs`).
        <View style={styles.groupedPictures}>
          <ReadImageStrip images={item.readImages} inset={0} />
        </View>
      ) : null}
      <QuietTail tails={item.turns} />
    </View>
  );
}

/**
 * Each turn's tail, in order, with the space above each part (desktop `spaced_tail` with the quiet
 * lines' 2pt): the agent's text 2pt under the lines, a stack of one-line cards a part gap away, or
 * a row gap under another stack. `firstGap`, when given, is the space above the first part
 * whatever it is (Agent work Quiet draws no line above it, `hiddenWork.tsx`).
 */
export function QuietTail({ tails, firstGap }: { tails: readonly WorkTail[]; firstGap?: number }) {
  const { workflowCards, gbotCardStates } = useTranscriptFlags();
  const rowGap = useRowGap();
  const parts: { key: string; node: ReactNode; card: boolean }[] = [];
  const row = (message: ProjectedMessage) => ({
    key: `message:${message.id}`,
    node: <MessageRow message={message} />,
    card: false,
  });
  for (const tail of tails) {
    parts.push(...tail.artifacts.map(row));
    if (arr(tail.questions).length > 0) {
      parts.push({
        key: `questions:${tail.id}`,
        node: <QuestionExchangeCards exchanges={tail.questions} />,
        card: true,
      });
    }
    if (arr(tail.sentMessages).some((sent) => obj(obj(sent)?.card) !== null)) {
      parts.push({ key: `sent:${tail.id}`, node: <SentAgentMessageCards cards={tail.sentMessages} />, card: true });
    }
    if (shownGbotCards(tail.gbotCards, gbotCardStates).length > 0) {
      parts.push({ key: `gbot:${tail.id}`, node: <GbotCards cards={tail.gbotCards} />, card: true });
    }
    if (arr(tail.workflows).some((id) => typeof id === 'string' && obj(workflowCards[id]) !== null)) {
      parts.push({ key: `workflows:${tail.id}`, node: <WorkflowCards ids={tail.workflows} />, card: false });
    }
    if (obj(tail.final) !== null) parts.push(row(tail.final!));
  }
  let aboveIsCard = false;
  return (
    <FoldPlaceProvider value={HIDE_FILES}>
      {parts.map(({ key, node, card }, index) => {
        const gap =
          index === 0 && firstGap !== undefined
            ? firstGap
            : index === 0 && !card
              ? QUIET_TEXT_GAP
              : gapAbove(aboveIsCard, card, PART_GAP, rowGap);
        aboveIsCard = card;
        return (
          <View key={key} style={{ paddingTop: gap }}>
            {node}
          </View>
        );
      })}
    </FoldPlaceProvider>
  );
}

const styles = StyleSheet.create({
  column: { minWidth: 0 },
  groupedFiles: { paddingTop: 4, paddingBottom: 2 },
  groupedPictures: { paddingTop: 4 },
});
