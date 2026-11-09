/**
 * A `grouped-work` row under Agent work Quiet (desktop `hidden_work_row` in `hidden_work.rs`): no
 * line, the closed work's pictures where the line would be, then each turn's tail as Reduced draws
 * it (`quietWorkRows.tsx`). The time row of the reply the core names (`workCarrier`) takes the work
 * button and the opened steps (`hiddenWorkButton.tsx`); with no carrier (an interrupted turn) the
 * button stands on its own row after the tails, so the work never goes out of reach.
 */

import { StyleSheet, View } from 'react-native';

import type { GroupedWorkItem } from '../../rust/document';
import { useNativeChatUi, useTranscriptEnv, useTranscriptFlags } from './context';
import { DeferredNotice } from './DeferredNotice';
import { FoldPlaceProvider } from './Disclosure';
import { FileChangeStack } from './FileChanges';
import { HiddenWorkProvider, WorkButton, type HiddenWork } from './hiddenWorkButton';
import { ReadImageStrip } from './Images';
import { arr, obj, type JsonRecord } from './json';
import { FOOTER_HEIGHT } from './messageSpacing';
import { MessageRow } from './MessageRow';
import { finishedMark, QuietSteps } from './quietWork';
import { QUIET_STEPS, QuietTail } from './quietWorkRows';
import { useDisclosure } from './state';

export function HiddenGroupedWorkRow({ item }: { item: GroupedWorkItem }) {
  const { workOpen, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const flags = useTranscriptFlags();
  const key = `work:${item.id}`;
  const [open, toggleRaw] = useDisclosure(disclosures, key, workOpen);
  // One read per section, keyed by the section's prompt (`startId`), as the Reduced line reads them.
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
  const carrier = item.workCarrier ?? null;
  const notices = sections
    .filter(({ owner }) => flags.deferredWork[owner] !== undefined)
    .map(({ owner, work }) => (
      <DeferredNotice key={owner} id={owner} deferred={work} error={flags.deferredWork[owner]?.error ?? ''} />
    ));
  const hasFiles = arr(item.files).length > 0;
  // The steps are drawn inside the carrier reply, and the core gives the reply's own calls its id
  // (`grouped_work::reply_calls`): with the work still in context that row would take the button and
  // draw these steps again inside themselves, without end. Nothing under the steps carries the work.
  const steps = open ? (
    <HiddenWorkProvider value={null}>
      <FoldPlaceProvider value={QUIET_STEPS}>
        <QuietSteps>
          {notices}
          {item.work.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
          {hasFiles ? (
            <View style={styles.files}>
              <FileChangeStack stackId={key} files={item.files} card={item.filesCard} />
            </View>
          ) : null}
        </QuietSteps>
      </FoldPlaceProvider>
    </HiddenWorkProvider>
  ) : null;
  const work: HiddenWork = {
    carrier,
    label: item.workButton ?? '',
    // The core moved every reply's calls into `work`, so its marks cover them all.
    mark: finishedMark(item.work),
    open,
    expandable: item.expandable,
    toggle,
    steps,
  };
  const pictures = !open && (item.readImages ?? []).length > 0;
  return (
    <View style={styles.column}>
      {/* The closed work keeps the pictures it read in view (gx-chat-core `read_images.rs`). */}
      {pictures ? <ReadImageStrip images={item.readImages} inset={0} /> : null}
      <HiddenWorkProvider value={work}>
        <QuietTail tails={item.turns} firstGap={pictures ? 4 : 0} />
      </HiddenWorkProvider>
      {carrier === null ? (
        <>
          <View style={styles.alone}>
            <WorkButton work={work} height={FOOTER_HEIGHT} />
          </View>
          {steps}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { minWidth: 0 },
  files: { paddingTop: 4, paddingBottom: 2 },
  alone: { height: FOOTER_HEIGHT, flexDirection: 'row', alignItems: 'center' },
});
