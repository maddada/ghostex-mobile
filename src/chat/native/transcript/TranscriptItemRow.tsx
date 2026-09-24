/**
 * One transcript item (desktop `transcript.rs` `transcript_item_row`): a message, a summary-mode
 * turn, or a finished turn folded behind "Worked for Xs" (`completed_work_row.rs`,
 * `deferred_work.rs`). A kind this build does not know draws nothing.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CompletedWorkItem, ProjectedMessage, SummaryItem, TranscriptItem } from '../../rust/document';
import { QuestionExchangeCards } from '../cards';
import { useNativeChatUi, useTranscriptEnv, useTranscriptFlags } from './context';
import { DisclosureBody, DisclosureHeading, FoldPlaceProvider } from './Disclosure';
import { CompletedFilesFold } from './FileChanges';
import { obj } from './json';
import { MessageRow } from './MessageRow';
import { useDisclosure } from './state';
import { PROSE_COLUMN, PROSE_LINE, PROSE_SIZE } from './theme';

const IN_WORK_FOLD = { inWorkFold: true, hideFileChanges: true };
const HIDE_FILES = { inWorkFold: false, hideFileChanges: true };

export const TranscriptItemView = memo(function TranscriptItemView({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'message':
      return <MessageRow message={(item as { message: ProjectedMessage }).message} />;
    case 'summary':
      return <SummaryRow item={item as SummaryItem} />;
    case 'completed-work':
      return <CompletedWorkRow item={item as CompletedWorkItem} />;
    default:
      return null;
  }
});

function SummaryRow({ item }: { item: SummaryItem }) {
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, `summary:${item.id}`);
  const hasFinal = obj(item.final) !== null;
  return (
    <View style={styles.column}>
      <MessageRow message={item.user} />
      {hasFinal || item.active ? (
        <>
          <DisclosureHeading label={hasFinal ? 'Agent reply' : 'Active work'} open={open} onToggle={toggle} />
          {open ? (
            <View style={styles.column}>
              {hasFinal ? <MessageRow message={item.final!} /> : item.work.map((message) => <MessageRow key={message.id} message={message} />)}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function CompletedWorkRow({ item }: { item: CompletedWorkItem }) {
  const { theme, verbose, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const flags = useTranscriptFlags();
  const key = `work:${item.id}`;
  const [open, toggleRaw] = useDisclosure(disclosures, key, verbose);
  const deferred = obj(item.deferred);
  const toggle = () => {
    // Opening a turn whose work is not in the document reads it on demand.
    if (!open && deferred !== null) dispatch({ type: 'loadWork', id: item.id, work: deferred as never });
    toggleRaw();
  };
  const deferredState = flags.deferredWork[item.id];
  return (
    <View style={styles.column}>
      {item.expandable ? (
        <DisclosureHeading label={item.label} open={open} onToggle={toggle} color={theme.muted} medium />
      ) : (
        <Text style={[styles.plainHeading, { color: theme.muted }]}>{item.label}</Text>
      )}
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      {open ? (
        <FoldPlaceProvider value={IN_WORK_FOLD}>
          <DisclosureBody onCollapse={toggle} label='Collapse completed work'>
            {deferredState !== undefined ? <DeferredNotice item={item} error={deferredState.error ?? ''} /> : null}
            {item.work.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </DisclosureBody>
        </FoldPlaceProvider>
      ) : null}
      <CompletedFilesFold itemId={item.id} files={item.files} label={item.filesLabel} />
      <FoldPlaceProvider value={HIDE_FILES}>
        {item.artifacts.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
        <QuestionExchangeCards exchanges={item.questions} />
        {item.final !== undefined && item.final !== null ? <MessageRow message={item.final} /> : null}
      </FoldPlaceProvider>
    </View>
  );
}

/** The work fold while its history is being read, or after the read failed (`deferred_work.rs`). */
function DeferredNotice({ item, error }: { item: CompletedWorkItem; error: string }) {
  const { theme, dispatch } = useTranscriptEnv();
  const failed = error.length > 0;
  return (
    <View style={styles.deferred}>
      <Text style={[styles.deferredText, { color: failed ? theme.error : theme.muted }]}>{failed ? error : 'Loading work details…'}</Text>
      {failed ? (
        <Pressable
          onPress={() => dispatch({ type: 'loadWork', id: item.id, work: (item.deferred ?? null) as never })}
          style={({ pressed }) => [styles.retry, pressed && { backgroundColor: theme.pressed }]}
          accessibilityRole='button'
        >
          <Text style={[styles.deferredText, { color: theme.muted }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: 8, minWidth: 0 },
  plainHeading: { paddingLeft: PROSE_COLUMN, opacity: 0.5, fontWeight: '500', fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  divider: { height: 1, marginTop: 2, marginBottom: 8 },
  deferred: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  deferredText: { fontSize: PROSE_SIZE, flexShrink: 1 },
  retry: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
});
