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
 * goes back to Normal view, and its view's icon sits at its left as on the desktop (gx-chat-core extras/chat_pills.rs `view_chips` has the user's words).
 * Before it, while a draft saved elsewhere is offered, the Saved draft pill (`SavedDraftPill.tsx`),
 * which alone is enough to show the strip and opens its own sheet.
 *
 * A Ghostex page put aside with the page sheet's Hide shows as a pill of its own, first among the
 * panel pills (`PagePill`, `hiddenPages.ts`), and is enough to show the strip. It shrinks with the
 * others: icon and count once labels drop, icon and a dot only once every pill shown has dropped its
 * label (`planStripTiers`), then into "+N". Desktop: `minimized_pages.rs`.
 *
 * CDXC:SessionChat 2026-10-29 SEE-ALSO:
 * The user's words (option E) are on packages/gx-chat-core/src/extras/chat_pills.rs.
 */

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { ChatDocument, ChatPill, ViewChip } from '../../rust/document';
import { BLOCKED_PILL } from './CoordinatorBoard';
import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import type { GhostexSessionLinks } from '../../../contract/mobileSummary';
import { Glyph as ComposerGlyph } from '../composer/icons';
import { sessionLinksChatPill } from '../sessionLinks';
import { SessionDetailsPill, sessionDetailsRingOf } from './SessionDetailsSheet';
import { useTranscriptBottomStore } from '../transcript/bottomStore';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import {
  IconPill,
  LinksPill,
  OverflowPill,
  OverflowPillRow,
  PageOverflowRow,
  PagePill,
  Pill,
  QuestionPill,
  type PagePillTier,
} from './ChatPills';
import type { HiddenPage } from './hiddenPages';
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
const NO_PILLS: readonly string[] = [];

/**
 * The pills the strip leaves out while the work dock's bar shows above the chat box: the Work
 * pill, whose sheet the bar's Work items button opens (`WorkCards.tsx` `DockHeader`).
 *
 * CDXC:Coordinators 2026-11-12 DECISION:
 * User, of the phone's bar with its Work items button beside "● 6" and the Work pill "▦ ● 6" in
 * the row under it: remove the Work items pill from the pills row, since the bar's button does the
 * same thing; only while the chat shows the bar, so a chat with work items and no bar keeps it.
 */
export const PILLS_IN_DOCK_BAR: readonly string[] = ['board'];

export function pillsStripShown(
  document: ChatDocument,
  armed: readonly ArmedAction[],
  links: PillsStripLinks | null,
  muted: string,
  hiddenPages = 0,
  omitPills: readonly string[] = NO_PILLS,
): boolean {
  return (
    hiddenPages > 0 ||
    armed.length > 0 ||
    (document.savedDraftPill ?? null) !== null ||
    (document.viewChips?.length ?? 0) > 0 ||
    questionWaiting(document) ||
    (document.workingCard?.pills ?? []).some((id) => !omitPills.includes(id)) ||
    (links !== null && sessionLinksChatPill(links.links, muted) !== null) ||
    // The Session details ring lives in the strip, so a chat with the panel always has one.
    sessionDetailsRingOf(document) !== null
  );
}

export function PillsStrip({
  chat,
  document,
  armed,
  onArmedPress,
  links,
  onStashedPress,
  onSessionDetailsPress,
  menu,
  onMenuChange,
  hiddenPages = [],
  onShowPage,
  onClosePage,
  omitPills = NO_PILLS,
}: {
  chat: RustChat;
  /** Pills left out of the strip (`PILLS_IN_DOCK_BAR` while the dock's bar shows). */
  omitPills?: readonly string[];
  document: ChatDocument;
  /** The chat's hidden pages, oldest first (`hiddenPages.ts`), drawn first among the panel pills. */
  hiddenPages?: readonly HiddenPage[];
  /** A tap on a page's pill (or its "+N" row): the page opens again. */
  onShowPage?: (page: HiddenPage) => void;
  /** A long press on a page's pill: the page closes for good. */
  onClosePage?: (page: HiddenPage) => void;
  menu: string | null;
  onMenuChange: (menu: string | null) => void;
  armed: readonly ArmedAction[];
  /** Opens Delayed Actions; without it the timers are drawn but not pressable. */
  onArmedPress?: () => void;
  links: PillsStripLinks | null;
  /** Opens Saved prompts: the Stashed pill opens that list rather than a sheet of its own (desktop `chat_pills.rs`). */
  onStashedPress?: () => void;
  /** Opens the Session details sheet: the ring at the strip's right end, while the chat has the panel. */
  onSessionDetailsPress?: () => void;
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
  const afterDismiss = useRef<ChatPill | HiddenPage | null>(null);
  const closeDraft = useCallback(() => setDraftOpen(false), []);
  // A draft answered or withdrawn elsewhere takes its sheet with it.
  useEffect(() => {
    if (savedDraft === null) setDraftOpen(false);
  }, [savedDraft]);
  // The box's width, which the Saved draft pill shortens its label by (`savedDraft.ts`).
  const [stripWidth, setStripWidth] = useState(0);
  const shown = pillsStripShown(document, armed, links, P.cardMuted, hiddenPages.length, omitPills);
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
    .filter((id) => !omitPills.includes(id))
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
        : // The Work pill opens the Work sheet, collapsed dock or not, as the desktop's opens its Work
          // panel: a collapsed dock keeps its bar, whose tap opens it again (`WorkCards.tsx` `DockHeader`).
          onMenuChange(pill.id);
  const pagePanel: FitPanel[] = hiddenPages.map((page) => ({
    id: `page:${page.pageId}`,
    tiny: true,
    node: (tier: PagePillTier) => (
      <PagePill
        key={page.pageId}
        page={page}
        tier={tier}
        onPress={() => onShowPage?.(page)}
        onLongPress={() => onClosePage?.(page)}
      />
    ),
  }));
  const panel: FitPanel[] = [
    ...pagePanel,
    ...pills.map((pill) => ({
      id: pill.id,
      node: (tier: PagePillTier) => (
        <Pill
          key={pill.id}
          pill={pill}
          open={pill.id === menu}
          collapsed={tier !== 'full'}
          onPress={() => pressPill(pill)}
        />
      ),
    })),
  ];
  // The Links pill is the last one (desktop `links_pill.rs` has the user's words).
  const linksNode =
    links && linksPill !== null ? <LinksPill key="links" pill={linksPill} onPress={links.onOpen} /> : null;
  /*
   * CDXC:SessionDetails 2026-11-11 DECISION:
   * User, of the ring button in the phone's chat header: "Please move the new session details button
   * to the pills bar above the composer on mobile (keep in header on desktop)". The ring and its
   * percentage close the strip, after Links, among the pills that always show, so it never goes
   * into "+N". It stands for the context meter too: while the chat has the panel the meter's ring
   * under the box steps aside (`OptionPills.tsx`), and the sheet's Context card carries Compact
   * context; a computer that cannot serve the panel keeps the meter and its Context sheet.
   */
  const ring = onSessionDetailsPress !== undefined ? sessionDetailsRingOf(document) : null;
  const afterNode =
    ring !== null ? (
      <View style={styles.after}>
        {linksNode}
        <SessionDetailsPill ring={ring} onPress={onSessionDetailsPress!} />
      </View>
    ) : (
      linksNode
    );
  const hiddenPills = pills.filter((pill) => hiddenIds.includes(pill.id));
  const overflowPages = hiddenPages.filter((page) => hiddenIds.includes(`page:${page.pageId}`));
  const overflowCount = hiddenPills.length + overflowPages.length;
  useEffect(() => {
    if (overflowCount === 0) setOverflowOpen(false);
  }, [overflowCount]);
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
              after={afterNode}
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
        visible={overflowOpen && overflowCount > 0}
        title="More pills"
        // The desktop menu's detail (`strip_overflow.rs`).
        subtitle={`${overflowCount} hidden`}
        onClose={() => setOverflowOpen(false)}
        // A sheet picked from this one opens only after this one has gone (iOS drops a modal presented over a closing one).
        onDismissed={() => {
          const pill = afterDismiss.current;
          afterDismiss.current = null;
          if (pill === null) return;
          if ('pageId' in pill) onShowPage?.(pill);
          else pressPill(pill);
        }}
      >
        {overflowPages.map((page) => (
          <PageOverflowRow
            key={page.pageId}
            page={page}
            onPress={() => {
              // As a pill's row below: iOS waits for this sheet to go first, Android goes now.
              setOverflowOpen(false);
              if (Platform.OS === 'ios') afterDismiss.current = page;
              else onShowPage?.(page);
            }}
          />
        ))}
        {hiddenPills.map((pill) => (
          <OverflowPillRow
            key={pill.id}
            pill={pill}
            onPress={() => {
              // A row does what its pill does in the strip. iOS waits for this sheet to go first
              // (`onDismissed`); Android never reports that (React Native's Modal sends `onDismiss`
              // on iOS only), and its sheets are dialogs that open over a closing one, so it goes now.
              // CDXC:SessionChat 2026-11-11 WHY: the user, on Android: "When i click on share here
              // in my phone nothing happens"; every row of this sheet did nothing there since
              // 2026-11-10 (2d2dd229).
              setOverflowOpen(false);
              if (Platform.OS === 'ios') afterDismiss.current = pill;
              else pressPill(pill);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

/** A view chip's icon, the one its View menu row shows (`composer/menus.ts`; desktop `view_chip_icon`). */
function viewChipGlyph(id: string): 'list-check' | 'list-details' | 'eye-off' | 'eye' {
  switch (id) {
    case 'summary':
      return 'list-check';
    // Quiet View's chip (gx-chat-core `transcript/quiet_view.rs` `view_chip`).
    case 'quiet':
      return 'eye-off';
    case 'full':
      return 'eye';
    default:
      return 'list-details';
  }
}

/**
 * One view status chip: quieter than the pills (a faint fill, no outline) at their height, with its
 * view's icon at the left and its X at the right.
 *
 * CDXC:SessionChat 2026-11-11 DECISION:
 * The desktop chip shows its view's icon at the left, which turns into the X on hover (gx-chat-core
 * extras/chat_pills.rs `view_chips` has the user's words). A phone has no hover, so the user picked
 * "icon at the left, X kept at the right": the icon tells the two views apart at a glance, the X says
 * a tap turns the view off.
 */
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
      <ComposerGlyph name={viewChipGlyph(chip.id)} size={12} color={P.cardMuted} />
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
  const { hidden, collapsed } = planStripTiers(
    avail,
    fixed,
    pills.map((pill) => ({ ...pill, least: pill.icon })),
    overflow,
    gap,
  );
  return { hidden, collapsed };
}

/**
 * `planStrip` for pills with a third, narrowest width (a hidden page's pill: full, icon and count,
 * icon and dot; a panel pill's last two are the same). The last pills shown take their narrowest
 * width only once every pill shown has dropped its label, and before any goes into "+N": `tiny` of
 * the last `collapsed`. Port of desktop `plan_strip_tiers`.
 */
export function planStripTiers(
  avail: number,
  fixed: readonly number[],
  pills: readonly { full: number; icon: number; least: number }[],
  overflow: number,
  gap: number,
): { hidden: number; collapsed: number; tiny: number } {
  const n = pills.length;
  const fixedTotal = fixed.reduce((sum, width) => sum + width, 0);
  for (let hidden = 0; hidden <= n; hidden += 1) {
    const visible = n - hidden;
    for (let collapsed = 0; collapsed <= visible; collapsed += 1) {
      const tinyMost = collapsed === visible ? visible : 0;
      for (let tiny = 0; tiny <= tinyMost; tiny += 1) {
        let total = fixedTotal;
        let count = fixed.length;
        for (let index = 0; index < visible; index += 1) {
          const pill = pills[index];
          total +=
            index >= visible - tiny
              ? (pill?.least ?? 0)
              : index >= visible - collapsed
                ? (pill?.icon ?? 0)
                : (pill?.full ?? 0);
          count += 1;
        }
        if (hidden > 0) {
          total += overflow;
          count += 1;
        }
        total += gap * Math.max(0, count - 1);
        if (total <= avail + 0.5) return { hidden, collapsed, tiny };
      }
    }
  }
  return { hidden: n, collapsed: 0, tiny: 0 };
}

/** A panel pill drawn at a tier; `tiny` pills (a hidden page's) have a narrowest one of their own. */
type FitPanel = { id: string; tiny?: boolean; node: (tier: PagePillTier) => ReactNode };

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
    (pill) =>
      widths[`full:${pill.id}`] !== undefined &&
      widths[`icon:${pill.id}`] !== undefined &&
      (pill.tiny !== true || widths[`tiny:${pill.id}`] !== undefined),
  );
  // Everything drawn whole until the widths are known.
  const plan =
    avail > 0 && known
      ? planStripTiers(
          avail,
          fixed,
          panel.map((pill) => {
            const icon = widths[`icon:${pill.id}`] ?? 0;
            return {
              full: widths[`full:${pill.id}`] ?? 0,
              icon,
              least: pill.tiny === true ? (widths[`tiny:${pill.id}`] ?? icon) : icon,
            };
          }),
          widths.overflow ?? 56,
          PILL_GAP,
        )
      : { hidden: 0, collapsed: 0, tiny: 0 };
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
          <View key={pill.id}>
            {pill.node(index >= visible - plan.tiny ? 'icon' : index >= visible - plan.collapsed ? 'count' : 'full')}
          </View>
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
            <View onLayout={measure(`full:${pill.id}`)}>{pill.node('full')}</View>
            <View onLayout={measure(`icon:${pill.id}`)}>{pill.node('count')}</View>
            {pill.tiny === true ? <View onLayout={measure(`tiny:${pill.id}`)}>{pill.node('icon')}</View> : null}
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
    gap: 5,
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
  /** Links and the Session details ring, together at the strip's right end. */
  after: { flexDirection: 'row', alignItems: 'center', gap: PILL_GAP },
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
