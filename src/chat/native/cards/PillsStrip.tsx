/**
 * The pill strip along the chat box's top edge (`NativeComposer.tsx` draws it inside the box): a
 * faintly tinted band with a hairline under it and the box's top corners, holding the chat's pills
 * on the right: the armed timers, the ? (a question waits), Resources, Workers, Links, Tasks,
 * Subagents and Background, and the ↓ jump-to-bottom at the left of them while the strip shows.
 * Pills that don't fit drop their label, last first, then the last ones wait in one "+N" pill; nothing scrolls or
 * fades (`planStrip`). With no pill there is no strip; it grows in and shrinks away with the chat box's own ease (`composer-animation.json`).
 * Each pill opens its own sheet (`ChatPills.tsx`). Port of desktop `pills_strip.rs`.
 *
 * The band's left holds the view status chip ("Summary view" or "Detailed view"), pinned there while
 * the pills fit beside it. With no hover on a phone the chip's X always shows; a tap anywhere on the chip
 * goes back to Normal view (gx-chat-core extras/chat_pills.rs `view_chips` has the user's words).
 * Before it, while a draft saved elsewhere is offered, the Saved draft pill (`SavedDraftPill.tsx`),
 * which alone is enough to show the strip and opens its own sheet.
 *
 * CDXC:SessionChat 2026-10-29 SEE-ALSO:
 * The user's words (option E) are on packages/gx-chat-core/src/extras/chat_pills.rs.
 */

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { ChatDocument, ChatPill, ViewChip } from '../../rust/document';
import { BLOCKED_PILL } from './CoordinatorBoard';
import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import type { GhostexSessionLinks } from '../../../contract/mobileSummary';
import { Glyph as ComposerGlyph } from '../composer/icons';
import { sessionLinksChatPill } from '../sessionLinks';
import { useTranscriptBottomStore } from '../transcript/bottomStore';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { IconPill, LinksPill, OverflowPill, OverflowPillRow, Pill, QuestionPill } from './ChatPills';
import { Sheet } from '../composer/Sheet';
import { SavedDraftPill, SavedDraftSheet } from './SavedDraftPill';
import { VISUAL, type ArmedAction } from './WorkingStrip';

/** The session's links and the Links pill's tap, from the screen that knows the session (`TerminalScreen`). */
export type PillsStripLinks = { links: GhostexSessionLinks | undefined; onOpen: () => void };

/** The strip's band: a pill's 25 with 5 above and below; its hairline under it (desktop `STRIP_HEIGHT`). */
const BAND = 25 + 5 * 2;
const STRIP = BAND + 1;
/** The gap between two pills, and the "+N" pill's width before it has been measured (desktop `PILL_GAP`, `OVERFLOW_ESTIMATE`). */
const PILL_GAP = 6;
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
  // What the dock above the box cannot show (gx-chat-core `pill_count`): one place per question.
  return (document.openQuestions?.pillCount ?? 0) > 0;
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
  // The pills in the "+N" pill (`PillsFit`), its sheet, and the pill a row of it picked, pressed once the sheet is gone.
  const [hiddenIds, setHiddenIds] = useState<readonly string[]>([]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const afterDismiss = useRef<ChatPill | null>(null);
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
  const pressPill = (pill: ChatPill) =>
    // Autopilot's pill opens its sheet like any other (its rows are the pill's `menu`, gx-chat-core
    // `extras/autopilot.rs`); a tap never toggles it.
    pill.id === 'stashed'
      ? onStashedPress?.()
      : pill.id === BLOCKED_PILL
        ? // Blocked opens the board at its Blocked group (gx-chat-core `show_group`), through
          // the board focus the chat screen keeps for the pill sheet.
          chat.dispatch({ type: 'showCoordinatorBoardGroup', group: 'blocked' } as unknown as UserAction)
        : onMenuChange(pill.id);
  const panel = pills.map((pill) => ({
    id: pill.id,
    pill,
    node: (collapsed: boolean) => (
      <Pill key={pill.id} pill={pill} open={pill.id === menu} collapsed={collapsed} onPress={() => pressPill(pill)} />
    ),
  }));
  // The Links pill is the last one (desktop `links_pill.rs` has the user's words).
  const linksNode =
    links && linksPill !== null ? <LinksPill key="links" pill={linksPill} onPress={links.onOpen} /> : null;
  const hiddenPills = pills.filter((pill) => hiddenIds.includes(pill.id));
  useEffect(() => {
    if (hiddenPills.length === 0) setOverflowOpen(false);
  }, [hiddenPills.length]);
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
            <PillsFit
              panel={panel}
              after={linksNode}
              overflow={(count) => (
                <OverflowPill count={count} open={overflowOpen} onPress={() => setOverflowOpen(true)} />
              )}
              onHidden={setHiddenIds}
            >
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
                  count={questions.pillCount ?? 0}
                  newest={questions.newest ?? null}
                  accessibilityLabel={questions.accessibilityLabel}
                  onPress={() => chat.dispatch({ type: 'previousQuestion' })}
                />
              ) : null}
            </PillsFit>
          </View>
          <View style={styles.hairline} />
        </Animated.View>
      ) : null}
      <SavedDraftSheet pill={savedDraft} open={draftOpen} onClose={closeDraft} dispatch={chat.dispatch} />
      <Sheet
        visible={overflowOpen && hiddenPills.length > 0}
        title="More pills"
        onClose={() => setOverflowOpen(false)}
        // A sheet picked from this one opens only after this one has gone (iOS drops a modal presented over a closing one).
        onDismissed={() => {
          const pill = afterDismiss.current;
          afterDismiss.current = null;
          if (pill !== null) pressPill(pill);
        }}
      >
        {hiddenPills.map((pill) => (
          <OverflowPillRow
            key={pill.id}
            pill={pill}
            onPress={() => {
              afterDismiss.current = pill;
              setOverflowOpen(false);
            }}
          />
        ))}
      </Sheet>
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
 * How the row of pills fits `avail`: how many of the last panel pills go into the "+N" pill and how
 * many of the last ones left drop their label, as few as can be, labels before pills. `fixed` are
 * the widths of the pills that always show and `pills` the panel pills' (with label, without).
 * Port of desktop `plan_strip`.
 */
export function planStrip(
  avail: number,
  fixed: readonly number[],
  pills: readonly { full: number; icon: number }[],
  overflow: number,
  gap: number,
): { hidden: number; collapsed: number } {
  const n = pills.length;
  const fixedTotal = fixed.reduce((sum, width) => sum + width, 0);
  for (let hidden = 0; hidden <= n; hidden += 1) {
    const visible = n - hidden;
    for (let collapsed = 0; collapsed <= visible; collapsed += 1) {
      let total = fixedTotal;
      let count = fixed.length;
      for (let index = 0; index < visible; index += 1) {
        const pill = pills[index];
        total += index >= visible - collapsed ? (pill?.icon ?? 0) : (pill?.full ?? 0);
        count += 1;
      }
      if (hidden > 0) {
        total += overflow;
        count += 1;
      }
      total += gap * Math.max(0, count - 1);
      if (total <= avail + 0.5) return { hidden, collapsed };
    }
  }
  return { hidden: n, collapsed: 0 };
}

type FitPanel = { id: string; node: (collapsed: boolean) => ReactNode };

/**
 * The pills' room: they sit at the right, whole. No pill is scrolled, cut or faded; when the row is
 * too wide the last panel pills drop their label first, then go into one "+N" pill (`planStrip`).
 * Every panel pill is also drawn invisibly with and without its label, to know both widths.
 *
 * CDXC:SessionChat 2026-11-10 DECISION:
 * User, of the row scrolling sideways behind edge fades (Board and Autopilot faded at its two edges
 * once the pills grew to 13): "the pills hiding is still bad, please make this simpler". Matches
 * desktop `pills_strip_fit` in apps/desktop/src/app/native_chat/pills_strip.rs. Supersedes the
 * 2026-10-28 and 2026-11-08 edge fades and the sideways scroll.
 */
function PillsFit({
  children,
  panel,
  after,
  overflow,
  onHidden,
}: {
  /** The pills that always show (↓, timers, ?), before the panel pills. */
  children: ReactNode;
  panel: readonly FitPanel[];
  /** The Links pill, after them. */
  after: ReactNode;
  overflow: (count: number) => ReactNode;
  onHidden: (ids: readonly string[]) => void;
}) {
  const styles = useStyles();
  const [avail, setAvail] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const measure = (key: string) => (event: { nativeEvent: { layout: { width: number } } }) => {
    const width = event.nativeEvent.layout.width;
    setWidths((was) => (Math.abs((was[key] ?? -1) - width) < 0.5 ? was : { ...was, [key]: width }));
  };
  const hasBefore = Children.toArray(children).length > 0;
  const fixed = [
    hasBefore ? widths['fixed:before'] : undefined,
    after !== null ? widths['fixed:after'] : undefined,
  ].filter((width): width is number => width !== undefined && width > 0);
  const known = panel.every(
    (pill) => widths[`full:${pill.id}`] !== undefined && widths[`icon:${pill.id}`] !== undefined,
  );
  // Everything drawn whole until the widths are known.
  const plan =
    avail > 0 && known
      ? planStrip(
          avail,
          fixed,
          panel.map((pill) => ({ full: widths[`full:${pill.id}`] ?? 0, icon: widths[`icon:${pill.id}`] ?? 0 })),
          widths.overflow ?? 56,
          PILL_GAP,
        )
      : { hidden: 0, collapsed: 0 };
  const visible = panel.length - plan.hidden;
  const hiddenIds = panel.slice(visible).map((pill) => pill.id);
  const hiddenKey = hiddenIds.join(',');
  useEffect(() => {
    onHidden(hiddenKey === '' ? [] : hiddenKey.split(','));
  }, [hiddenKey, onHidden]);
  return (
    <View style={styles.fit} onLayout={(event) => setAvail(event.nativeEvent.layout.width)}>
      <View style={styles.pills}>
        {hasBefore ? (
          <View style={styles.pills} onLayout={measure('fixed:before')}>
            {children}
          </View>
        ) : null}
        {panel.slice(0, visible).map((pill, index) => (
          <View key={pill.id}>{pill.node(index >= visible - plan.collapsed)}</View>
        ))}
        {plan.hidden > 0 ? <View onLayout={measure('overflow')}>{overflow(plan.hidden)}</View> : null}
        {after !== null ? <View onLayout={measure('fixed:after')}>{after}</View> : null}
      </View>
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {panel.map((pill) => (
          <View key={pill.id} style={styles.measureRow}>
            <View onLayout={measure(`full:${pill.id}`)}>{pill.node(false)}</View>
            <View onLayout={measure(`icon:${pill.id}`)}>{pill.node(true)}</View>
          </View>
        ))}
        {plan.hidden === 0 && widths.overflow === undefined ? (
          <View onLayout={measure('overflow')}>{overflow(panel.length)}</View>
        ) : null}
      </View>
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
  /** A pill's 25 (its 1px border included), quieter: a faint fill and no outline. */
  chip: {
    height: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 6,
    borderRadius: 13,
    backgroundColor: P.ink(0.04),
  },
  chipPressed: {
    backgroundColor: P.ink(0.08),
  },
  chipLabel: {
    color: P.cardMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  /** The hairline under the band, the box's border colour. */
  hairline: {
    height: 1,
    backgroundColor: P.composerBorder,
  },
  fit: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  /** The pills drawn invisibly to know their widths. */
  measure: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
    alignItems: 'flex-start',
  },
  measureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
