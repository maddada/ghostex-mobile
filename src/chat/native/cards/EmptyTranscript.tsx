/**
 * What the transcript area shows while it has no rows. Port of desktop `new_session_welcome.rs`
 * and `transcript_reveal.rs`:
 *
 * - `loadingStage` set (or no status yet): the loading hold, blank; the skeleton rows while
 *   Ghostex is not answering (`transcriptSkeleton`, no text: the core retries every 2 s), or the
 *   core's `loadingNotice` (a read running long) and its Try now button;
 * - `newSessionWelcome`: the agent mark and "What should we build with X?";
 * - a ready transcript with no rows: nothing (React's empty message list);
 * - otherwise `emptyState`'s title and detail, with its retry button when the chat errored.
 *
 * The transcript screen renders this in place of its list when `items` is empty.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { AgentMark } from './agentMark';
import { themedStyles } from '../transcript/theme';
import { ChatButton } from './primitives';

export function EmptyTranscript({ chat, document }: { chat: RustChat; document: ChatDocument | null }) {
  const styles = useStyles();
  const retry = () => chat.dispatch({ type: 'retry' });
  const stage = document === null ? 'indicator' : (document.loadingStage ?? (document.status == null ? 'indicator' : null));
  if (document === null || stage !== null) {
    if (document?.transcriptSkeleton === true) return <TranscriptSkeleton />;
    const notice = document?.loadingNotice ?? null;
    return (
      <View style={styles.region}>
        {notice !== null ? (
          <View accessibilityRole="text" accessibilityLabel={notice.title} style={styles.notice}>
            <Text style={styles.muted}>{notice.title}</Text>
            {notice.detail ? <Text style={styles.noticeDetail}>{notice.detail}</Text> : null}
            <View style={styles.noticeAction}>
              <ChatButton label={notice.action} onPress={retry} />
            </View>
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
      {document.status === 'error' ? (
        <ChatButton label={document.emptyState?.action ?? 'Try again'} onPress={retry} />
      ) : null}
    </View>
  );
}

/**
 * `packages/gx-chat-core/visual/transcript-skeleton.json`, the rows the desktop's loading hold
 * draws while Ghostex is not answering (`transcript_reveal.rs`; CDXC:SessionChat 2026-10-08 in
 * `packages/gx-chat-core/src/session/constants.rs`).
 */
const SKELETON = {
  topPadding: 32,
  rowGap: 32,
  barHeight: 10,
  barGap: 12,
  bubbleHeight: 60,
  bubbleRadius: 16,
  tint: 0.12,
  pulseMs: 1400,
  pulseMinOpacity: 0.5,
  rows: [
    { user: true, widths: [0.42] },
    { user: false, widths: [0.94, 0.88, 0.97, 0.62, 0.91, 0.84, 0.96, 0.9, 0.78, 0.93, 0.5] },
    { user: true, widths: [0.3] },
    { user: false, widths: [0.9, 0.96, 0.8, 0.92, 0.45, 0.95, 0.87, 0.98, 0.83, 0.91, 0.76, 0.94, 0.89, 0.58] },
    { user: true, widths: [0.52] },
    { user: false, widths: [0.86, 0.7, 0.93, 0.97, 0.82, 0.9, 0.88, 0.64] },
  ],
} as const;

function TranscriptSkeleton() {
  const styles = useStyles();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const half = SKELETON.pulseMs / 2;
    const easing = Easing.inOut(Easing.quad);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: SKELETON.pulseMinOpacity, duration: half, easing, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: half, easing, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View accessibilityLabel="Loading conversation…" style={[styles.skeleton, { opacity: pulse }]}>
      {SKELETON.rows.map((row, index) =>
        row.user ? (
          <View key={index} style={[styles.skeletonBubble, { width: `${row.widths[0] * 100}%` }]} />
        ) : (
          <View key={index} style={styles.skeletonLines}>
            {row.widths.map((width, line) => (
              <View key={line} style={[styles.skeletonBar, { width: `${width * 100}%` }]} />
            ))}
          </View>
        ),
      )}
    </Animated.View>
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

const useStyles = themedStyles((P) => ({
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
    backgroundColor: P.markCard,
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
  notice: {
    maxWidth: '100%',
    alignItems: 'center',
    gap: 6,
  },
  noticeDetail: {
    color: P.muted,
    opacity: 0.75,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  noticeAction: {
    marginTop: 8,
  },
  skeleton: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: SKELETON.topPadding,
    gap: SKELETON.rowGap,
  },
  skeletonBubble: {
    alignSelf: 'flex-end',
    height: SKELETON.bubbleHeight,
    borderRadius: SKELETON.bubbleRadius,
    backgroundColor: P.ink(SKELETON.tint),
  },
  skeletonLines: {
    gap: SKELETON.barGap,
  },
  skeletonBar: {
    height: SKELETON.barHeight,
    borderRadius: SKELETON.barHeight / 2,
    backgroundColor: P.ink(SKELETON.tint),
  },
}));
