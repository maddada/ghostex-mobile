/**
 * What the transcript area shows while it has no rows. Port of desktop `new_session_welcome.rs`
 * and `transcript_reveal.rs`:
 *
 * - `loadingStage` set (or no status yet): the loading hold, blank, with "Still loading this
 *   conversation." and Retry once the stage is `retry`;
 * - `newSessionWelcome`: the agent mark and "What should we build with X?";
 * - a ready transcript with no rows: nothing (React's empty message list);
 * - otherwise `emptyState`'s title and detail, with Retry when the chat errored.
 *
 * The transcript screen renders this in place of its list when `items` is empty.
 */

import { StyleSheet, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { AgentMark } from './agentMark';
import { ChatCardPalette as P } from './palette';
import { ChatButton } from './primitives';

export function EmptyTranscript({ chat, document }: { chat: RustChat; document: ChatDocument | null }) {
  const retry = () => chat.dispatch({ type: 'retry' });
  const stage = document === null ? 'indicator' : (document.loadingStage ?? (document.status == null ? 'indicator' : null));
  if (document === null || stage !== null) {
    return (
      <View style={styles.region}>
        {stage === 'retry' ? (
          <View accessibilityLabel="Loading conversation…" style={styles.retryRow}>
            <Text style={styles.muted}>Still loading this conversation.</Text>
            <ChatButton label="Retry" onPress={retry} />
          </View>
        ) : null}
      </View>
    );
  }
  const welcome = document.newSessionWelcome;
  if (welcome !== null && welcome !== undefined) {
    return (
      <View style={[styles.region, styles.welcome]}>
        <View style={styles.markCard}>
          <AgentMark icon={welcome.icon} size={28} />
        </View>
        {welcome.showTitle !== false ? (
          <Text style={styles.welcomeTitle}>{wrapWelcomeTitle(welcome.title || 'What should we work on?')}</Text>
        ) : null}
      </View>
    );
  }
  if (document.view?.kind === 'ready') return <View style={styles.region} />;
  return (
    <View style={[styles.region, styles.empty]}>
      <Text style={styles.emptyTitle}>{document.emptyState?.title ?? ''}</Text>
      <Text style={styles.muted}>{document.emptyState?.detail ?? ''}</Text>
      {document.status === 'error' ? <ChatButton label="Retry" onPress={retry} /> : null}
    </View>
  );
}

/**
 * Desktop's user decision for a narrow chat: a wrapped welcome title keeps 2 or 3 words on its
 * last line, never 1 (`new_session_welcome_title_wrap`, React's `wrapNewSessionWelcomeTitle`).
 */
function wrapWelcomeTitle(title: string): string {
  if (title.includes('\n')) return title;
  const words = title.split(/\s+/).filter((word) => word.length > 0);
  if (words.length < 4) return title;
  const last = words.length >= 6 ? 3 : 2;
  const split = words.length - last;
  return `${words.slice(0, split).join(' ')}\n${words.slice(split).join(' ')}`;
}

const styles = StyleSheet.create({
  region: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  welcome: {
    gap: 14,
  },
  markCard: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: '#2c2c2c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeTitle: {
    color: P.foreground,
    fontSize: 22,
    lineHeight: 27.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  empty: {
    gap: 14,
    paddingBottom: 24,
  },
  emptyTitle: {
    color: P.primary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  muted: {
    color: P.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
