/**
 * The pill strip along the chat box's top edge (`NativeComposer.tsx` draws it inside the box): a
 * faintly tinted band with a hairline under it and the box's top corners, holding the chat's pills
 * on the right: the armed timers, the ? (a question waits), Resources, Workers, Links, Tasks,
 * Subagents and Background, and the ↓ jump-to-bottom at the left of them while the strip shows.
 * Pills that don't fit scroll sideways, each fading out before an edge that hides more. With no pill there is
 * no strip; it grows in and shrinks away with the chat box's own ease (`composer-animation.json`).
 * Each pill opens its own sheet (`ChatPills.tsx`). Port of desktop `pills_strip.rs`.
 *
 * The band's left holds the view status chip ("Summary view" or "Detailed view"), pinned there while
 * the pills scroll. With no hover on a phone the chip's X always shows; a tap anywhere on the chip
 * goes back to Normal view (gx-chat-core extras/chat_pills.rs `view_chips` has the user's words).
 * Before it, while a draft saved elsewhere is offered, the Saved draft pill (`SavedDraftPill.tsx`),
 * which alone is enough to show the strip and opens its own sheet.
 *
 * CDXC:SessionChat 2026-10-29 SEE-ALSO:
 * The user's words (option E) are on packages/gx-chat-core/src/extras/chat_pills.rs.
 */

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { ChatDocument, ViewChip } from '../../rust/document';
import { BLOCKED_PILL } from './CoordinatorBoard';
import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import type { GhostexSessionLinks } from '../../../contract/mobileSummary';
import { Glyph as ComposerGlyph } from '../composer/icons';
import { sessionLinksChatPill } from '../sessionLinks';
import { useTranscriptBottomStore } from '../transcript/bottomStore';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { IconPill, LinksPill, Pill, QuestionPill } from './ChatPills';
import { SavedDraftPill, SavedDraftSheet } from './SavedDraftPill';
import { VISUAL, type ArmedAction } from './WorkingStrip';

/** The session's links and the Links pill's tap, from the screen that knows the session (`TerminalScreen`). */
export type PillsStripLinks = { links: GhostexSessionLinks | undefined; onOpen: () => void };

/** The strip's band: a pill's 22 with 5 above and below; its hairline under it (desktop `STRIP_HEIGHT`). */
const BAND = 22 + 5 * 2;
const STRIP = BAND + 1;
/** The width over which a pill fades out before an edge that hides more pills (desktop `PILLS_FADE`). */
const PILLS_FADE = 24;
/** The band's tint over the box's fill (desktop `STRIP_TINT`). */
const STRIP_TINT = 0.035;
/** `packages/gx-chat-core/visual/composer-animation.json`: the chat box's own ease. */
const EASE_MS = 280;
const EASE = Easing.bezier(0.32, 0.72, 0, 1);

/** `over` laid over `base` at `alpha`, both `#rrggbb`; `base` as it is for any other colour. */
export function mixHex(base: string, over: string, alpha: number): string {
  const parse = (color: string) =>
    /^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16)) : null;
  const from = parse(base);
  const to = parse(over);
  if (from === null || to === null) return base;
  return `#${from
    .map((channel, index) => Math.round(channel + ((to[index] ?? channel) - channel) * alpha))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Whether the question pill shows: a question form or page waits (the core's `openQuestions.count`). */
function questionWaiting(document: ChatDocument): boolean {
  return (document.openQuestions?.count ?? 0) > 0;
}

/** Whether the strip shows: the Saved draft pill, a view chip, a panel pill, the ?, the Links pill or an armed timer calls for it; the ↓ only joins them. */
export function pillsStripShown(
  document: ChatDocument,
  armed: readonly ArmedAction[],
  links: PillsStripLinks | null,
  muted: string,
): boolean {
  return (
    armed.length > 0 ||
    (document.savedDraftPill ?? null) !== null ||
    (document.viewChips?.length ?? 0) > 0 ||
    questionWaiting(document) ||
    (document.workingCard?.pills.length ?? 0) > 0 ||
    (links !== null && sessionLinksChatPill(links.links, muted) !== null)
  );
}

export function PillsStrip({
  chat,
  document,
  armed,
  onArmedPress,
  links,
  onStashedPress,
  menu,
  onMenuChange,
}: {
  chat: RustChat;
  document: ChatDocument;
  menu: string | null;
  onMenuChange: (menu: string | null) => void;
  armed: readonly ArmedAction[];
  /** Opens Delayed Actions; without it the timers are drawn but not pressable. */
  onArmedPress?: () => void;
  links: PillsStripLinks | null;
  /** Opens Saved prompts: the Stashed pill opens that list rather than a sheet of its own (desktop `chat_pills.rs`). */
  onStashedPress?: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const reduceMotion = useReducedMotion();
  const awayFromBottom = useTranscriptBottomStore((store) => store.awayFromBottom);
  const jumpToBottom = useTranscriptBottomStore((store) => store.jumpToBottom);
  const savedDraft = document.savedDraftPill ?? null;
  const [draftOpen, setDraftOpen] = useState(false);
  const closeDraft = useCallback(() => setDraftOpen(false), []);
  // A draft answered or withdrawn elsewhere takes its sheet with it.
  useEffect(() => {
    if (savedDraft === null) setDraftOpen(false);
  }, [savedDraft]);
  // The box's width, which the Saved draft pill shortens its label by (`savedDraft.ts`).
  const [stripWidth, setStripWidth] = useState(0);
  const shown = pillsStripShown(document, armed, links, P.cardMuted);
  // Grows in and shrinks away; drawn while it shrinks, dropped once it has.
  const open = useRef(new Animated.Value(shown ? 1 : 0)).current;
  const [drawn, setDrawn] = useState(shown);
  useEffect(() => {
    if (shown) setDrawn(true);
    if (reduceMotion) {
      open.setValue(shown ? 1 : 0);
      if (!shown) setDrawn(false);
      return undefined;
    }
    const run = Animated.timing(open, {
      toValue: shown ? 1 : 0,
      duration: EASE_MS,
      easing: EASE,
      useNativeDriver: false,
    });
    run.start(({ finished }) => {
      if (finished && !shown) setDrawn(false);
    });
    return () => run.stop();
  }, [shown, reduceMotion, open]);
  const linksPill = links ? sessionLinksChatPill(links.links, P.cardMuted, P.light) : null;
  const card = document.workingCard;
  const pills = (card?.pills ?? [])
    .map((id) => (document.chatPills ?? []).find((pill) => pill.id === id))
    .filter((pill) => pill !== undefined);
  const panelPills = pills.map((pill) => (
    <Pill
      key={pill.id}
      pill={pill}
      open={pill.id === menu}
      onPress={() =>
        // Autopilot's pill opens its sheet like any other (its rows are the pill's `menu`, gx-chat-core
        // `extras/autopilot.rs`); a tap never toggles it.
        pill.id === 'stashed'
          ? onStashedPress?.()
          : pill.id === BLOCKED_PILL
            ? // Blocked opens the board at its Blocked group (gx-chat-core `show_group`), through
              // the board focus the chat screen keeps for the pill sheet.
              chat.dispatch({ type: 'showCoordinatorBoardGroup', group: 'blocked' } as unknown as UserAction)
            : onMenuChange(pill.id)
      }
    />
  ));
  // The Links pill is the last one (desktop `links_pill.rs` has the user's words).
  if (links && linksPill !== null) panelPills.push(<LinksPill key="links" pill={linksPill} onPress={links.onOpen} />);
  const questions = document.openQuestions;
  const showJump = awayFromBottom && jumpToBottom !== null;
  return (
    <>
      {drawn ? (
        <Animated.View
          accessibilityRole="toolbar"
          accessibilityLabel="Chat pills"
          style={[
            styles.strip,
            { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, STRIP] }), opacity: open },
          ]}
        >
          <View style={styles.band} onLayout={(event) => setStripWidth(event.nativeEvent.layout.width)}>
            {/* The Saved draft pill and the view chips stay pinned left; the pills scroll in what is left beside them. */}
            {shown && (savedDraft !== null || (document.viewChips?.length ?? 0) > 0) ? (
              <View style={styles.chips}>
                {savedDraft !== null ? (
                  <SavedDraftPill
                    pill={savedDraft}
                    width={stripWidth}
                    open={draftOpen}
                    onPress={() => setDraftOpen(true)}
                  />
                ) : null}
                {(document.viewChips ?? []).map((chip) => (
                  <ViewChipButton key={chip.id} chip={chip} onPress={() => chat.dispatch(chip.command)} />
                ))}
              </View>
            ) : null}
            <PillsScroll>
              {/* The ↓ at the left of the pills, so it appearing moves none of them. */}
              {shown && showJump ? (
                <IconPill
                  glyph="arrow-down"
                  accessibilityLabel="Scroll to bottom"
                  color={P.primary}
                  onPress={() => jumpToBottom?.()}
                />
              ) : null}
              {armed.map((action) => (
                <Pressable
                  key={action.id}
                  disabled={onArmedPress === undefined}
                  onPress={onArmedPress}
                  accessibilityRole="button"
                  accessibilityLabel={`${action.label}. Manage delayed actions`}
                  hitSlop={6}
                  style={({ pressed }) => [styles.armed, pressed ? styles.armedPressed : null]}
                >
                  <ComposerGlyph
                    name="clock"
                    size={VISUAL.sparkSize}
                    color={action.id === 'delayedSend' ? VISUAL.delayedSendColor : VISUAL.closeAfterDoneColor}
                  />
                  <Text style={styles.armedLabel} numberOfLines={1}>
                    {action.label}
                  </Text>
                </Pressable>
              ))}
              {questions !== undefined && questions !== null && questionWaiting(document) ? (
                <QuestionPill
                  count={questions.count}
                  newest={questions.newest ?? null}
                  accessibilityLabel={questions.accessibilityLabel}
                  onPress={() => chat.dispatch({ type: 'previousQuestion' })}
                />
              ) : null}
              {panelPills}
            </PillsScroll>
          </View>
          <View style={styles.hairline} />
        </Animated.View>
      ) : null}
      <SavedDraftSheet pill={savedDraft} open={draftOpen} onClose={closeDraft} dispatch={chat.dispatch} />
    </>
  );
}

/** One view status chip: quieter than the pills (a faint fill, no outline) at their height, with its X. */
function ViewChipButton({ chip, onPress }: { chip: ViewChip; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={chip.ariaLabel}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}
    >
      <Text style={styles.chipLabel} numberOfLines={1}>
        {chip.label}
      </Text>
      <ComposerGlyph name="x" size={10} color={P.cardMuted} />
    </Pressable>
  );
}

/**
 * How much of itself each pill keeps inside `view`, fading out toward an edge that hides more pills:
 * the pill's near edge `fade` away from that edge or more is solid, and it ramps to nothing as that
 * edge reaches it, so a pill is gone before the edge can cut it (no clipped border or word, and no
 * colour band over the pills). An edge with nothing more past it fades nothing. Steps of 1/16 keep a
 * scroll from re-rendering at every pixel. Port of desktop `pill_opacities`.
 */
export function pillOpacities(
  pills: readonly { x: number; width: number }[],
  view: { x: number; width: number },
  more: { left: boolean; right: boolean },
  fade: number,
): number[] {
  return pills.map((pill) => {
    let keep = 1;
    if (more.left) keep = Math.min(keep, (pill.x - view.x) / fade);
    if (more.right) keep = Math.min(keep, (view.x + view.width - (pill.x + pill.width)) / fade);
    return Math.round(Math.min(1, Math.max(0, keep)) * 16) / 16;
  });
}

/**
 * The pills' scroll: right-aligned while they fit, scrolling sideways when they don't, each pill
 * fading out before an edge that hides more of them (`pillOpacities`).
 *
 * CDXC:SessionChat 2026-11-08 DECISION:
 * User, of the desktop strip scrolled sideways, a dark band over a clipped stub of a pill at its edge,
 * then of the hairlines left by a cut pill's border and a right-edge pill's word cut hard: the colour
 * fade over the pills is gone on the phone too (it matches desktop `pills_strip_scroll` in
 * apps/desktop/src/app/native_chat/pills_strip.rs). Each pill fades itself over 24px before the edge,
 * so none is ever cut. Supersedes 2026-10-28's colour fade into the band.
 */
function PillsScroll({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const pills = Children.toArray(children);
  const metrics = useRef({ x: 0, width: 0, content: 0 });
  // Each pill's frame in the row, by position in `pills`.
  const frames = useRef<{ x: number; width: number }[]>([]);
  const [opacities, setOpacities] = useState<number[]>([]);
  const update = () => {
    const { x, width, content } = metrics.current;
    const more = { left: x > 0.5, right: content - width - x > 0.5 };
    const known = frames.current.slice(0, pills.length).map((frame) => frame ?? { x: 0, width: 0 });
    const next = pillOpacities(known, { x, width }, more, PILLS_FADE);
    setOpacities((was) =>
      was.length === next.length && was.every((value, index) => value === next[index]) ? was : next,
    );
  };
  return (
    <View style={styles.scrollArea}>
      <ScrollView
        horizontal
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsHorizontalScrollIndicator={false}
        alwaysBounceHorizontal={false}
        overScrollMode="never"
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(event) => {
          metrics.current.x = event.nativeEvent.contentOffset.x;
          update();
        }}
        onLayout={(event) => {
          metrics.current.width = event.nativeEvent.layout.width;
          update();
        }}
        onContentSizeChange={(width) => {
          metrics.current.content = width;
          update();
        }}
      >
        <View style={styles.pills}>
          {pills.map((pill, index) => (
            <View
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              onLayout={(event) => {
                const { x, width } = event.nativeEvent.layout;
                frames.current[index] = { x, width };
                update();
              }}
              style={opacities[index] !== undefined && opacities[index] < 1 ? { opacity: opacities[index] } : null}
            >
              {pill}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  /** Inside the box's border, at its top, with its top corners. */
  strip: {
    overflow: 'hidden',
    borderTopLeftRadius: 21,
    borderTopRightRadius: 21,
    backgroundColor: P.ink(STRIP_TINT),
  },
  band: {
    height: BAND,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  /** A pill's 22 (its 1px border included), quieter: a faint fill and no outline. */
  chip: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 6,
    borderRadius: 11,
    backgroundColor: P.ink(0.04),
  },
  chipPressed: {
    backgroundColor: P.ink(0.08),
  },
  chipLabel: {
    color: P.cardMuted,
    fontSize: 11.5,
    lineHeight: 16,
  },
  /** The hairline under the band, the box's border colour. */
  hairline: {
    height: 1,
    backgroundColor: P.composerBorder,
  },
  scrollArea: {
    flex: 1,
    minWidth: 0,
    height: '100%',
  },
  scroll: {
    flexGrow: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  pills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  armed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: VISUAL.armedIconGap,
  },
  armedPressed: {
    opacity: 0.8,
  },
  armedLabel: {
    color: P.foreground,
    fontSize: VISUAL.fontSize,
    lineHeight: VISUAL.fontSize * 1.5,
  },
}));
