/**
 * The card a published HTML page (`ghostex show`) gets in the transcript: a window bar with three
 * dots and the file name, a scaled-down picture of the page fading out at its bottom, then the
 * title, "Interactive page · file.html", the Answered pill once the page's answers were sent (or a
 * Withdrawn pill once a later block withdrew its questions), and
 * Open. Until the picture exists (the desktop app takes it the first time the page is opened in its
 * floating page window) the window shows a page icon and the file name. A touch screen has no hover, so the
 * desktop's "Open page" label over the picture is left out; the whole card opens the page.
 *
 * CDXC:SessionChat 2026-10-11 SEE-ALSO:
 * The user's decision is on server/src/visual_pages/thumbnail.rs. Desktop and the web build draw the
 * same card in apps/desktop/src/app/native_chat/page_card.rs; the picture comes through the core
 * (packages/gx-chat-core/src/transcript/page_thumbnails.rs) and the measurements are
 * packages/gx-chat-core/visual/page-card.json. Change them together.
 */

import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useTranscriptEnv, useTranscriptFlags } from './context';
import { Glyph } from './icons';
import { str, type JsonRecord } from './json';
import { answeredColor } from './PageAnswersCard';
import { askedPageThumbnail, usePageThumbnailStore } from './pageThumbnails';
import { QuestionFlashFrame } from './OpenQuestions';
import { VerticalFade } from './verticalFade';

/** `packages/gx-chat-core/visual/page-card.json`. */
const VISUAL = {
  radius: 14,
  barHeight: 34,
  dotSize: 9,
  dotGap: 6,
  previewHeight: 148,
  fadeHeight: 60,
  footerPaddingX: 14,
  footerPaddingY: 11,
  titleSize: 14,
  detailSize: 12,
  thumbnailWidth: 800,
  thumbnailHeight: 500,
};

/** The card, outlined for a moment when the Previous question pill or a Q-tag link lands on it. */
export function PageCard({
  answer,
  onLayout,
}: {
  answer: JsonRecord | null;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { theme } = useTranscriptEnv();
  return (
    <QuestionFlashFrame target={str(answer, 'pageId')} light={theme.light}>
      <PageCardBody answer={answer} onLayout={onLayout} />
    </QuestionFlashFrame>
  );
}

function PageCardBody({
  answer,
  onLayout,
}: {
  answer: JsonRecord | null;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { theme, dispatch } = useTranscriptEnv();
  const flags = useTranscriptFlags();
  const url = str(answer, 'url');
  const file = str(answer, 'file');
  const title = str(answer, 'title') || 'Page';
  const pageId = str(answer, 'pageId');
  const answered = pageId.length > 0 && flags.answeredPages.has(pageId);
  // Its questions a later block withdrew, some or all (desktop `page_card.rs`): the card says so
  // where an answered page says Answered.
  const withdrawnEntry = !answered && pageId.length > 0 ? flags.withdrawnPages[pageId] : undefined;
  // One the reader removed without answering says Canceled in the same place (gx-chat-core `questions/later.rs`).
  const canceled = !answered && flags.canceledQuestions.has(pageId);
  const withdrawn = canceled
    ? { label: 'Canceled', hint: 'Canceled, no answer needed' }
    : withdrawnEntry === undefined
      ? null
      : withdrawnEntry.tags.length >= withdrawnEntry.total
        ? { label: 'Withdrawn', hint: 'Withdrawn, no answer needed' }
        : {
            label: `${withdrawnEntry.tags.length} of ${withdrawnEntry.total} withdrawn`,
            hint: `${withdrawnEntry.tags.join(', ')}: withdrawn, no answer needed`,
          };
  // A page still waiting offers For later; one put off says so and offers Back to unanswered
  // (gx-chat-core `questions/later.rs`, desktop `page_card.rs`).
  const later = !answered && flags.laterQuestions.has(pageId);
  const waiting = later || (!answered && flags.unansweredQuestions.has(pageId));
  const entry = usePageThumbnailStore((state) => (pageId.length > 0 ? state.pages[pageId] : undefined));

  // Asked once per page and answered state (an answered page is pictured again), not per mount.
  useEffect(() => {
    if (pageId.length > 0 && askedPageThumbnail(pageId, answered)) dispatch({ type: 'loadPageThumbnail', pageId });
  }, [answered, dispatch, pageId]);
  // While the picture is on its way, ask again when the core says to; a card that left the list
  // asks nothing until it is drawn again.
  const retryInMs = entry !== undefined && !entry.settled ? entry.retryInMs : null;
  const revision = entry?.revision ?? 0;
  useEffect(() => {
    if (pageId.length === 0 || retryInMs === null) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'loadPageThumbnail', pageId }), retryInMs);
    return () => clearTimeout(timer);
  }, [dispatch, pageId, retryInMs, revision]);

  const open = () => dispatch({ type: 'openMarkdownLink', href: url, external: false });
  const picture = entry?.png ?? null;
  const detail = file.length > 0 ? `Interactive page · ${file}` : 'Interactive page';
  const good = answeredColor(theme.light);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.input, borderColor: pressed ? theme.muted : theme.border },
      ]}
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={`Open page ${title}`}
      onLayout={onLayout}
    >
      <View style={[styles.bar, { backgroundColor: theme.cardPanel, borderBottomColor: theme.border }]}>
        <View style={styles.dots}>
          {[0, 1, 2].map((index) => (
            <View key={index} style={[styles.dot, { backgroundColor: theme.muted, opacity: 0.3 }]} />
          ))}
        </View>
        <Text numberOfLines={1} style={[styles.barLabel, { color: theme.muted }]}>
          {file.length > 0 ? file : title}
        </Text>
        {/* Balances the dots so the name sits in the middle of the bar. */}
        <View style={styles.dotsBalance} />
      </View>
      <View style={[styles.preview, { backgroundColor: theme.background }]}>
        {picture !== null ? (
          <Image
            source={{ uri: `data:image/png;base64,${picture}` }}
            style={styles.picture}
            resizeMode="stretch"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.placeholder}>
            <Glyph name="file-code" size={22} color={theme.muted} />
            <Text numberOfLines={1} style={[styles.placeholderLabel, { color: theme.muted }]}>
              {file.length > 0 ? file : title}
            </Text>
          </View>
        )}
        <VerticalFade id="page-card-fade" color={theme.input} from={0} to={1} style={styles.fade} />
      </View>
      <View style={styles.footer}>
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.foreground }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.detail, { color: theme.muted }]}>
            {detail}
          </Text>
        </View>
        {withdrawn !== null ? (
          <View
            style={[styles.answered, { backgroundColor: `${theme.muted}24` }]}
            accessibilityRole="text"
            accessibilityLabel={withdrawn.hint}
          >
            <Text style={[styles.answeredText, { color: theme.muted }]}>{withdrawn.label}</Text>
          </View>
        ) : null}
        {answered ? (
          <View style={[styles.answered, { backgroundColor: `${good}24` }]}>
            <Glyph name="check" size={11} color={good} />
            <Text style={[styles.answeredText, { color: good }]}>Answered</Text>
          </View>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.open, { backgroundColor: theme.controlPrimary }, pressed && { opacity: 0.8 }]}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel="Open"
        >
          <Text style={[styles.openText, { color: theme.background }]}>Open</Text>
          <Glyph name="arrow-up-right" size={13} color={theme.background} />
        </Pressable>
      </View>
      {waiting ? (
        <View style={styles.laterRow}>
          {later ? (
            <View style={[styles.answered, { backgroundColor: `${theme.muted}24` }]}>
              <Glyph name="clock" size={11} color={theme.muted} />
              <Text style={[styles.answeredText, { color: theme.muted }]}>For later</Text>
            </View>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.later, { backgroundColor: `${theme.foreground}${pressed ? '26' : '1a'}` }]}
            onPress={() => dispatch({ type: 'questionForLater', id: pageId, later: !later })}
            accessibilityRole="button"
            accessibilityLabel={later ? 'Back to unanswered' : 'For later'}
            hitSlop={4}
          >
            <Text style={[styles.laterText, { color: theme.foreground }]}>{later ? 'Back to unanswered' : 'For later'}</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: VISUAL.radius, overflow: 'hidden' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: VISUAL.barHeight,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  dots: { flexDirection: 'row', gap: VISUAL.dotGap },
  dot: { width: VISUAL.dotSize, height: VISUAL.dotSize, borderRadius: VISUAL.dotSize / 2 },
  dotsBalance: { width: VISUAL.dotSize * 3 + VISUAL.dotGap * 2 },
  barLabel: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 11.5 },
  preview: { height: VISUAL.previewHeight, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  // As wide as the card, cut at the bottom: the top of the page is what it opens on.
  picture: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    aspectRatio: VISUAL.thumbnailWidth / VISUAL.thumbnailHeight,
  },
  placeholder: { alignItems: 'center', gap: 6, maxWidth: '80%' },
  placeholderLabel: { fontSize: 11.5 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: VISUAL.fadeHeight },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: VISUAL.footerPaddingX,
    paddingVertical: VISUAL.footerPaddingY,
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: VISUAL.titleSize, fontWeight: '600' },
  detail: { fontSize: VISUAL.detailSize },
  answered: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  answeredText: { fontSize: 11, fontWeight: '600' },
  open: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 11, borderRadius: 8 },
  openText: { fontSize: 12.5, fontWeight: '600' },
  /** For later / Back to unanswered, under the footer: the phone's card is too narrow for a third button beside Open. */
  laterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: VISUAL.footerPaddingX,
    paddingBottom: VISUAL.footerPaddingY,
  },
  later: { height: 28, paddingHorizontal: 11, borderRadius: 8, justifyContent: 'center' },
  laterText: { fontSize: 12.5, fontWeight: '500' },
});
