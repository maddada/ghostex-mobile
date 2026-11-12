/**
 * The Session details sheet: the phone form of the desktop's Session details panel
 * (`apps/desktop/src/app/native_chat/session_details/`), opened from the ring pill at the end of the
 * chat's pill strip (`PillsStrip.tsx`). The chat core words every card (`packages/gx-chat-core/src/extras/session_details/`,
 * the document's `sessionDetails`): Environment, Context, Tasks, Connectors, Skills, Memory files,
 * Changes and Background tasks, in its order, each with its rows, folds, skeletons and the actions
 * its rows send back. This file only lays them out and tells the core when the sheet is on screen
 * (`sessionDetailsVisible`), which is what makes it read and poll.
 *
 * CDXC:SessionDetails 2026-11-11 DECISION:
 * User picked "Build it with the next app release" for the phone's missing Session details panel:
 * a sheet from the chat header's ring button, drawn from what the core already words for the
 * desktop, with no second copy of the rows' wording in JavaScript. A computer too old to send
 * `sessionDetails` leaves the document's value null, and the phone shows no ring button. The phone's
 * Changes view is read-only (CDXC:Changes 2026-10-25), so the card's Commit and Create PR buttons,
 * which open the desktop's Git menu, are not drawn; View PR is.
 *
 * CDXC:SessionDetails 2026-11-11 DECISION:
 * User: "Please move the new session details button to the pills bar above the composer on mobile
 * (keep in header on desktop)". The ring left the phone's header (and the iPhone Duo's side bar and
 * status band) for the pill strip, and stands for the context meter there: the meter's own ring
 * steps aside while the chat has the panel, and the Context card carries the meter's Compact
 * context. Supersedes the header button of the decision above.
 * SEE-ALSO: src/chat/native/NativeChatScreen.tsx (what the rows open), src/chat/native/cards/PillsStrip.tsx (the ring),
 * src/chat/native/composer/OptionPills.tsx (the context meter).
 *
 * CDXC:SessionDetails 2026-11-12 DECISION:
 * User, of the ⋯ "Context window" sheet and this sheet showing the same things on the phone: "let's do 2 tabs that
 * show the 2 things. both are under Session details. we need to deduplicate stuff too", then (Q2755, Q2756, Q2762) the
 * merged sheet as drawn on the "Session details: final phone sheet and desktop match" page, with "i dont like that we
 * lost the stuff that's below the context fam" and the Context card moved to the first tab, and the names "Overview |
 * Limits" (Q2769). The chat core lays the sheet out for the phone and the desktop alike (`TABS` and the cards in
 * gx-chat-core `extras/session_details/document.rs`): one sheet, two tabs:
 * - The first: Environment, Changes, then the Context card always open (its bar, every breakdown row with tokens and
 *   %, when it was counted with the refresh, Compact context), then Tasks, Connectors, Skills, Memory files,
 *   Background tasks, and an Agent card for the agent's own settings rows. The ring opens the sheet here, scrolled
 *   to Context.
 * - The second: the context meter's "More details" rows (the ones Choose details picks, which also pin the status
 *   line) as Limits, Cost and time and Cache cards, each reset on its limit's row.
 * Rows another place already shows are not listed (context used and tokens, account, repository, folder, branch,
 * worktree, lines changed, pull request, model, thinking, session title). The ⋯ › More › Context window row and its
 * sheet went (`menus.ts`); a computer too old to send Session details keeps them.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { UserAction } from '../../rust/actions';
import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { GitBranchGlyph } from '../../../components/sessions/icons';
import { Sheet } from '../composer/Sheet';
import { FoldChevron } from '../transcript/foldChevron';
import { PROSE_SIZE, themedStyles, useTranscriptTheme, type TranscriptTheme } from '../transcript/theme';
import { TaskRow } from './AgentPanels';
import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, num, obj, str, type JsonRecord } from './json';
import { Spinner } from './primitives';

/** The sheet's title and the header button's name, the desktop panel's own. */
export const SESSION_DETAILS_TITLE = 'Session details';

/**
 * The two tabs' names, for a core too old to send its own (`sessionDetails.tabs`, whose names the core keeps for every
 * app in `TABS`, gx-chat-core `extras/session_details/document.rs`).
 */
export const SESSION_DETAILS_TABS = { overview: 'Overview', usage: 'Limits' } as const;
type DetailsTab = keyof typeof SESSION_DETAILS_TABS;

/** Where the sheet scrolls to as it opens: the ring's Context card, or the top. */
export type SessionDetailsFocus = 'context' | null;

/** What the header button draws: the core's ring (`sessionDetails.ring`). */
export type SessionDetailsRing = { percent: number | null; label: string };

/**
 * The chat's `sessionDetails` value, or null while the panel does not apply (an older computer,
 * the extension off, a chat with no agent yet). Read loosely: the value is free-form JSON.
 */
export function sessionDetailsOf(document: ChatDocument | null): JsonRecord | null {
  return obj((document as unknown as JsonRecord | null)?.sessionDetails);
}

/** The header button's ring, or null when the chat has no panel. */
export function sessionDetailsRingOf(document: ChatDocument | null): SessionDetailsRing | null {
  const details = sessionDetailsOf(document);
  if (details === null) return null;
  const ring = obj(details.ring);
  return { percent: num(ring, 'percent'), label: str(ring, 'label') };
}

/**
 * The core's actions for the panel are sent as the core words them (`sessionDetailsOpen`, …):
 * the phone's typed action list does not name them, so they go through untyped.
 */
function send(chat: RustChat, action: unknown): void {
  if (obj(action) === null || str(action, 'type').length === 0) return;
  chat.dispatch(action as UserAction);
}

/** The ring: the context use as an arc over its track (desktop `session_details/ring.rs`), in `color`. */
export function SessionDetailsRingIcon({
  percent,
  size,
  color,
}: {
  percent: number | null;
  size: number;
  color: string;
}) {
  const radius = size * 0.4;
  const stroke = Math.max(1.5, size * 0.125);
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, (percent ?? 0) / 100));
  const center = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={center} cy={center} r={radius} stroke={color} strokeOpacity={0.28} strokeWidth={stroke} fill="none" />
      {fraction > 0 ? (
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      ) : null}
    </Svg>
  );
}

/**
 * The ring pill closing the chat's pill strip (`PillsStrip.tsx`): the context use as a ring and the
 * core's label ("42%"), the desktop header's button in the strip's pill shape. It is the phone's
 * context meter as well while the chat has the panel.
 */
export function SessionDetailsPill({ ring, onPress }: { ring: SessionDetailsRing; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        ring.label.length > 0 ? `${SESSION_DETAILS_TITLE}, ${ring.label} context used` : SESSION_DETAILS_TITLE
      }
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.ringPill, pressed ? styles.ringPillPressed : null]}
    >
      <SessionDetailsRingIcon percent={ring.percent} size={15} color={P.primary} />
      {ring.label.length > 0 ? (
        <Text style={styles.ringLabel} numberOfLines={1}>
          {ring.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The sheet. While `visible` the core is told the panel is on screen, and told again when it
 * leaves; a row that opens something elsewhere closes the sheet first (`onClose`), so what it
 * opens is not under it.
 */
export function SessionDetailsSheet({
  chat,
  document,
  visible,
  focus = null,
  onClose,
  onChooseDetails,
  onDismissed,
}: {
  chat: RustChat;
  document: ChatDocument | null;
  visible: boolean;
  /** Where it scrolls as it opens; it always opens on the first tab. */
  focus?: SessionDetailsFocus;
  onClose: () => void;
  /** The second tab's Choose details: the context meter's editor (which rows show, which pin the status line). */
  onChooseDetails?: () => void;
  /** iOS: the sheet finished going away (`Sheet`). */
  onDismissed?: () => void;
}) {
  const styles = useStyles();
  const details = sessionDetailsOf(document);
  const shown = visible && details !== null;
  const [tab, setTab] = useState<DetailsTab>('overview');
  const scroll = useRef<ScrollViewInstance>(null);
  /** The Context card's top in the first tab's list, once laid out. */
  const contextTop = useRef<number | null>(null);
  /** The sheet opened to the Context card, which scrolls there once it has been laid out. */
  const scrollToContext = useRef(false);
  useEffect(() => {
    if (!shown) return;
    setTab('overview');
    if (focus !== 'context') {
      scroll.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    if (contextTop.current === null) scrollToContext.current = true;
    else scroll.current?.scrollTo({ y: contextTop.current, animated: false });
  }, [shown, focus]);
  const contextLaidOut = (y: number) => {
    contextTop.current = y;
    if (!scrollToContext.current) return;
    scrollToContext.current = false;
    scroll.current?.scrollTo({ y, animated: false });
  };
  const told = useRef(false);
  useEffect(() => {
    if (told.current === shown) return;
    told.current = shown;
    send(chat, { type: 'sessionDetailsVisible', visible: shown });
  }, [chat, shown]);
  // Leaving the chat with the sheet open takes the panel off screen too.
  useEffect(
    () => () => {
      if (told.current) send(chat, { type: 'sessionDetailsVisible', visible: false });
    },
    [chat],
  );
  const act = (action: unknown) => {
    if (str(action, 'type') === 'sessionDetailsOpen') onClose();
    send(chat, action);
  };
  const error = str(details, 'error');
  // The core's tab names, by place: the first is the session and its Context card, the second the meter's details.
  const tabNames = arr(details?.tabs).map((entry) => str(entry, 'label'));
  const tabName = (key: DetailsTab, index: number): string => tabNames[index] || SESSION_DETAILS_TABS[key];
  const compact = () => {
    onClose();
    send(chat, { type: 'contextCompact' });
  };
  return (
    <Sheet
      visible={shown}
      onClose={onClose}
      title={SESSION_DETAILS_TITLE}
      maxHeight="85%"
      {...(onDismissed !== undefined ? { onDismissed } : {})}
    >
      <View style={styles.tabs} accessibilityRole="tablist">
        {(Object.keys(SESSION_DETAILS_TABS) as DetailsTab[]).map((key, index) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={[styles.tab, tab === key ? styles.tabOn : null]}
          >
            <Text style={[styles.tabText, tab === key ? styles.tabTextOn : null]} numberOfLines={1}>
              {tabName(key, index)}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.cards}>
        {error.length > 0 ? <Text style={styles.error}>{error}</Text> : null}
        {/* The first tab stays mounted under the second, so its scroll and its Context card's place are kept. */}
        <View style={[styles.cards, styles.tabPage, tab === 'overview' ? null : styles.hidden]}>
          {arr(details?.sections).map((section, index) => (
            <View
              key={str(section, 'id') || String(index)}
              onLayout={
                str(section, 'id') === 'context'
                  ? (event: LayoutChangeEvent) => contextLaidOut(event.nativeEvent.layout.y)
                  : undefined
              }
            >
              <SectionCard
                chat={chat}
                section={section}
                details={details}
                act={act}
                onCompact={compact}
              />
            </View>
          ))}
        </View>
        {tab === 'usage' ? <UsageTab usage={obj(details?.usage)} onChooseDetails={onChooseDetails} /> : null}
      </ScrollView>
    </Sheet>
  );
}

/** The fold of a card or a list inside one eases open and shut, as the desktop's folds do. */
function useEaseOnChange(value: boolean): void {
  const last = useRef(value);
  if (last.current !== value) {
    last.current = value;
    LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
  }
}

type Act = (action: unknown) => void;

function SectionCard({
  chat,
  section,
  details,
  act,
  onCompact,
}: {
  chat: RustChat;
  section: unknown;
  details: JsonRecord | null;
  act: Act;
  onCompact: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const id = str(section, 'id');
  // A card the core pins open (Context, Agent) has no fold; nor does one with nothing to fold.
  const foldable = obj(section)?.foldable !== false && !isTrue(section, 'pinnedOpen');
  const collapsed = foldable && isTrue(section, 'collapsed');
  useEaseOnChange(collapsed);
  const fields = obj(section) ?? {};
  let trailing: ReactNode = null;
  if (id === 'context' && obj(fields.refresh) !== null) {
    trailing = <RefreshButton refreshing={isTrue(section, 'refreshing')} onPress={() => act(fields.refresh)} />;
  } else if (id === 'connectors' && obj(fields.manage) !== null) {
    trailing = (
      <Text accessibilityRole="button" style={styles.link} onPress={() => act(fields.manage)} suppressHighlighting>
        Manage
      </Text>
    );
  } else if (str(section, 'meta').length > 0) {
    trailing = <Text style={styles.meta}>{str(section, 'meta')}</Text>;
  }
  return (
    <View accessibilityLabel={str(section, 'title')} style={styles.card}>
      <View style={styles.cardHeader}>
        <Pressable
          disabled={!foldable}
          accessibilityRole={foldable ? 'button' : 'header'}
          {...(foldable ? { accessibilityState: { expanded: !collapsed } } : {})}
          style={styles.cardTitle}
          onPress={() => send(chat, { type: 'sessionDetailsSection', section: id })}
        >
          {foldable ? <FoldChevron open={!collapsed} size={13} color={P.cardMuted} /> : <View style={{ width: 13 }} />}
          <Text style={styles.title} numberOfLines={1}>
            {str(section, 'title')}
          </Text>
        </Pressable>
        {trailing}
      </View>
      {id === 'context' ? <ContextSummary section={fields} details={details} /> : null}
      {collapsed ? null : (
        <SectionBody
          id={id}
          section={fields}
          details={details}
          act={act}
          onCompact={onCompact}
        />
      )}
    </View>
  );
}

function SectionBody({
  id,
  section,
  details,
  act,
  onCompact,
}: {
  id: string;
  section: JsonRecord;
  details: JsonRecord | null;
  act: Act;
  onCompact: () => void;
}) {
  if (isTrue(section, 'loading')) return <Skeleton rows={num(section, 'skeletonRows') ?? 2} />;
  switch (id) {
    case 'context':
      return <ContextBody section={section} act={act} onCompact={onCompact} />;
    case 'tasks':
      return <TasksBody section={section} act={act} />;
    case 'connectors':
      return <ConnectorsBody section={section} act={act} />;
    case 'skills':
      return <SkillsBody section={section} act={act} />;
    case 'changes':
      return <ChangesBody section={section} act={act} />;
    case 'background':
      return <BackgroundBody section={section} act={act} />;
    default:
      return <PlainRows rows={arr(section.rows)} act={act} />;
  }
}

/** The second tab: the core's cards of the context meter's details (`sessionDetails.usage`), then Choose details. */
function UsageTab({ usage, onChooseDetails }: { usage: JsonRecord | null; onChooseDetails?: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const cards = arr(usage?.cards);
  const choose = obj(usage?.chooseDetails);
  return (
    <View style={[styles.cards, styles.tabPage]}>
      {cards.length === 0 && str(usage, 'empty').length > 0 ? <Text style={styles.empty}>{str(usage, 'empty')}</Text> : null}
      {cards.map((card, index) => (
        <View key={str(card, 'id') || String(index)} accessibilityLabel={str(card, 'title')} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.title} numberOfLines={1}>
              {str(card, 'title')}
            </Text>
          </View>
          <View style={styles.rows}>
            {arr(obj(card)?.rows).map((row, rowIndex) => (
              <View key={str(row, 'id') || String(rowIndex)} style={styles.row}>
                <Text style={styles.rowText} numberOfLines={1}>
                  {str(row, 'label')}
                </Text>
                <Text style={styles.detail} numberOfLines={1}>
                  {str(row, 'value')}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
      {choose !== null && onChooseDetails !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={str(choose, 'label')}
          onPress={onChooseDetails}
          style={({ pressed }) => [styles.row, styles.choose, pressed ? styles.rowPressed : null]}
        >
          <Text style={[styles.rowText, styles.mutedText]}>{str(choose, 'label')}</Text>
          <Glyph name="pencil" size={15} color={P.cardMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The glyph of an Environment row (`icon` in the core's rows). */
const ROW_ICONS: Record<string, GlyphName> = {
  laptop: 'device-desktop',
  box: 'stack',
  folder: 'folder',
  user: 'user',
  memory: 'server',
  agent: 'robot',
};

/** Environment and Memory files: an icon or nothing, the text, a badge, a detail; a row with an action opens it. */
function PlainRows({ rows, act }: { rows: unknown[]; act: Act }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={styles.rows}>
      {rows.map((row, index) => {
        const icon = str(row, 'icon');
        const glyph = ROW_ICONS[icon];
        const badge = str(row, 'badge');
        const detail = str(row, 'detail');
        const action = obj(row)?.action;
        const link = isTrue(row, 'link') && obj(action) !== null;
        return (
          <Pressable
            key={`${index}:${str(row, 'text')}`}
            disabled={!link}
            accessibilityRole={link ? 'link' : 'text'}
            onPress={() => act(action)}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            {icon === 'branch' ? (
              <GitBranchGlyph size={14} color={P.cardMuted} />
            ) : glyph !== undefined ? (
              <Glyph name={glyph} size={14} color={P.cardMuted} />
            ) : null}
            <Text style={[styles.rowText, link ? styles.linkText : null]} numberOfLines={1} ellipsizeMode="middle">
              {str(row, 'text')}
            </Text>
            {badge.length > 0 ? <Text style={styles.badge}>{badge}</Text> : null}
            {detail.length > 0 ? <Text style={styles.detail}>{detail}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The colour of a context category or a status (the desktop's `swatch` in `cards.rs`). */
function swatch(key: string, P: TranscriptTheme): string {
  switch (key) {
    case 'messages':
      return '#4f8cff';
    case 'memory':
      return '#2fbf8f';
    case 'skills':
      return '#b48cff';
    case 'mcp':
      return '#e0a43a';
    case 'agents':
      return '#e879a6';
    case 'since':
      return 'rgba(79, 140, 255, 0.45)';
    case 'buffer':
      return P.mutedInk(0.35);
    case 'free':
      return P.border;
    case 'connected':
    case 'done':
      return '#3fb950';
    case 'pending':
    case 'needsAuth':
    case 'running':
      return '#f5a524';
    case 'failed':
      return '#f0605a';
    default:
      return P.muted;
  }
}

/**
 * The Context card's usage line (percentage and tokens) and its overall usage bar, under the card's
 * title whether the card is folded or not; the fold holds the breakdown.
 *
 * CDXC:SessionDetails 2026-11-12 DECISION:
 * User: the Context card opens folded, and folded it still shows its usage bar under the title, so
 * usage reads at a glance; unfolding shows the breakdown. The core folds Context by default
 * (`gx-chat-core` `session_details/state.rs` `FOLDED_BY_DEFAULT`) and remembers the user's unfold.
 */
function ContextSummary({ section, details }: { section: JsonRecord; details: JsonRecord | null }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const percentLabel = str(section, 'percentLabel');
  const reading = percentLabel.length === 0 && isTrue(details, 'loading');
  const tokens = str(section, 'tokensLabel');
  return (
    <View style={styles.rows}>
      <View style={styles.summary}>
        {reading ? (
          <SkeletonBar width="40%" />
        ) : (
          <Text style={styles.summaryText} numberOfLines={1}>
            {percentLabel.length > 0 ? percentLabel : 'No usage reported yet'}
          </Text>
        )}
        {tokens.length > 0 ? <Text style={styles.detail}>{tokens}</Text> : null}
      </View>
      <View style={styles.bar}>
        {arr(section.segments).map((segment, index) => {
          const fraction = num(segment, 'fraction') ?? 0;
          return fraction > 0 ? (
            <View
              key={index}
              style={{ width: `${Math.min(100, fraction * 100)}%`, backgroundColor: swatch(str(segment, 'color'), P) }}
            />
          ) : null;
        })}
      </View>
    </View>
  );
}

function ContextBody({
  section,
  act,
  onCompact,
}: {
  section: JsonRecord;
  act: Act;
  onCompact: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const messages = arr(section.messages);
  const messagesOpen = isTrue(section, 'messagesOpen');
  useEaseOnChange(messagesOpen);
  const status = str(section, 'status');
  const skeletonRows = num(section, 'skeletonRows') ?? 0;
  return (
    <View style={styles.rows}>
      {skeletonRows > 0 ? <Skeleton rows={skeletonRows} /> : null}
      {arr(section.rows).map((row, index) => {
        const id = str(row, 'id');
        const folds = id === 'messages' && messages.length > 0;
        const percent = str(row, 'percent');
        return (
          <View key={`${index}:${id}`}>
            <Pressable
              disabled={!folds}
              accessibilityRole={folds ? 'button' : 'text'}
              {...(folds ? { accessibilityState: { expanded: messagesOpen } } : {})}
              onPress={() => act({ type: 'sessionDetailsList', list: 'messages' })}
              style={({ pressed }) => [
                styles.row,
                isTrue(row, 'dim') ? styles.dim : null,
                pressed ? styles.rowPressed : null,
              ]}
            >
              <View style={[styles.swatch, { backgroundColor: swatch(str(row, 'color'), P) }]} />
              <Text style={styles.rowText} numberOfLines={1}>
                {str(row, 'label')}
              </Text>
              {folds ? (
                <Glyph name={messagesOpen ? 'chevron-up' : 'chevron-down'} size={12} color={P.cardMuted} />
              ) : null}
              <Text style={styles.detail}>
                {percent.length > 0 ? `${str(row, 'tokens')}  ${percent}` : str(row, 'tokens')}
              </Text>
            </Pressable>
            {folds && messagesOpen
              ? messages.map((part, partIndex) => (
                  <View key={partIndex} style={[styles.row, styles.subRow]}>
                    <Text style={[styles.rowText, styles.mutedText]} numberOfLines={1}>
                      {str(part, 'label')}
                    </Text>
                    <Text style={styles.detail}>{str(part, 'tokens')}</Text>
                  </View>
                ))
              : null}
          </View>
        );
      })}
      {arr(section.deferred).map((row, index) => (
        <View
          key={`deferred:${index}`}
          accessibilityHint="Loaded only when Claude needs them; not in the context until then."
          style={[styles.row, styles.dim]}
        >
          <View style={[styles.swatch, styles.hollowSwatch, { borderColor: P.cardMuted }]} />
          <Text style={styles.rowText} numberOfLines={1}>
            {str(row, 'label')}
          </Text>
          <Text style={styles.detail}>{str(row, 'tokens')}</Text>
        </View>
      ))}
      {status.length > 0 ? (
        <Text style={[styles.status, isTrue(section, 'statusError') ? { color: P.error } : null]}>{status}</Text>
      ) : null}
      {obj(section.compact) !== null ? <CompactButton compact={obj(section.compact)!} onCompact={onCompact} /> : null}
    </View>
  );
}

/** The core's Compact context on the Context card (the meter's), with why it cannot run when it cannot. */
function CompactButton({ compact, onCompact }: { compact: JsonRecord; onCompact: () => void }) {
  const styles = useStyles();
  const disabled = isTrue(compact, 'disabled');
  const reason = str(compact, 'reason');
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Compact context"
        disabled={disabled}
        onPress={onCompact}
        style={({ pressed }) => [
          styles.button,
          pressed ? styles.buttonPressed : null,
          disabled ? styles.disabled : null,
        ]}
      >
        <Text style={styles.buttonText}>Compact context</Text>
      </Pressable>
      {disabled && reason.length > 0 ? <Text style={styles.status}>{reason}</Text> : null}
    </>
  );
}

function RefreshButton({ refreshing, onPress }: { refreshing: boolean; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={refreshing ? 'Counting…' : 'Refresh Context Breakdown'}
      disabled={refreshing}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed ? styles.rowPressed : null]}
    >
      {refreshing ? <Spinner size={13} color={P.cardMuted} /> : <Glyph name="refresh" size={14} color={P.cardMuted} />}
    </Pressable>
  );
}

/** The Tasks pill's rows (`agent_tasks.rs`), drawn as its sheet draws them, and its "Show more". */
function TasksBody({ section, act }: { section: JsonRecord; act: Act }) {
  const styles = useStyles();
  const fold = str(section, 'foldLabel');
  return (
    <View style={styles.rows}>
      {arr(section.rows).map((row, index) => (
        <TaskRow key={str(row, 'id') || String(index)} row={row} />
      ))}
      {fold.length > 0 && obj(section.foldAction) !== null ? (
        <Text accessibilityRole="button" style={styles.fold} onPress={() => act(section.foldAction)}>
          {fold}
        </Text>
      ) : null}
    </View>
  );
}

function StatusDot({ status }: { status: string }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return <View style={[styles.dot, { backgroundColor: swatch(status, P) }]} />;
}

function ConnectorsBody({ section, act }: { section: JsonRecord; act: Act }) {
  const styles = useStyles();
  return (
    <View style={styles.rows}>
      {arr(section.groups).map((group, groupIndex) => {
        const rows = arr(obj(group)?.rows);
        return (
          <View key={groupIndex} style={styles.group}>
            <Text style={styles.groupTitle}>{str(group, 'title')}</Text>
            {rows.length === 0 ? <Text style={styles.empty}>{str(group, 'empty') || 'None'}</Text> : null}
            {rows.map((row, index) => {
              const action = obj(row)?.action;
              const detail = str(row, 'detail');
              return (
                <Pressable
                  key={`${index}:${str(row, 'text')}`}
                  disabled={obj(action) === null}
                  onPress={() => act(action)}
                  style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                >
                  <StatusDot status={str(row, 'status')} />
                  <Text style={styles.rowText} numberOfLines={1}>
                    {str(row, 'text')}
                  </Text>
                  {detail.length > 0 ? <Text style={styles.detail}>{detail}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/** A skill row: a link when it opens (a home skill in its SKILL.md, a project or plugin skill's file). */
function SkillRow({ row, act }: { row: unknown; act: Act }) {
  const styles = useStyles();
  const action = obj(row)?.action;
  const link = isTrue(row, 'link') && obj(action) !== null;
  return (
    <Pressable
      disabled={!link}
      accessibilityRole={link ? 'link' : 'text'}
      accessibilityHint={str(row, 'tooltip') || undefined}
      onPress={() => act(action)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Text style={[styles.rowText, link ? styles.linkText : styles.mutedText]} numberOfLines={1}>
        {str(row, 'text')}
      </Text>
    </Pressable>
  );
}

function SkillsBody({ section, act }: { section: JsonRecord; act: Act }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const used = arr(section.used);
  const usedEmpty = str(section, 'usedEmpty');
  const allOpen = isTrue(section, 'allOpen');
  useEaseOnChange(allOpen);
  return (
    <View style={styles.rows}>
      {used.map((row, index) => (
        <SkillRow key={`used:${index}`} row={row} act={act} />
      ))}
      {used.length === 0 && usedEmpty.length > 0 ? <Text style={styles.empty}>{usedEmpty}</Text> : null}
      {arr(section.all).length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: allOpen }}
          onPress={() => act(section.allToggle)}
          style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        >
          <Text style={[styles.rowText, styles.mutedText]} numberOfLines={1}>
            {str(section, 'allLabel')}
          </Text>
          <Text style={styles.link}>{allOpen ? 'Hide' : 'Show'}</Text>
          <Glyph name={allOpen ? 'chevron-up' : 'chevron-down'} size={12} color={P.cardMuted} />
        </Pressable>
      ) : null}
      {allOpen
        ? arr(section.all).map((row, index) => (
            <View key={`all:${index}`} style={styles.subRowIndent}>
              <SkillRow row={row} act={act} />
            </View>
          ))
        : null}
    </View>
  );
}

/**
 * The branch's changes: the line opens the phone's Changes view (the core's `reviewChanges`),
 * which lists the files and opens each one's diff. Its View PR button opens the pull request.
 */
function ChangesBody({ section, act }: { section: JsonRecord; act: Act }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const empty = isTrue(section, 'empty');
  const button = obj(section.button);
  const buttonAction = obj(button?.action);
  // Commit and Create PR open the desktop's Git menu; the phone's Changes view is read-only.
  const drawButton = button !== null && buttonAction !== null && str(buttonAction, 'target') === 'url';
  return (
    <View style={styles.rows}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Review the changes"
        onPress={() => act(section.action)}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      >
        {empty ? null : (
          <>
            <Text style={[styles.count, { color: P.diff.added }]}>{str(section, 'additions')}</Text>
            <Text style={[styles.count, { color: P.diff.removed }]}>{str(section, 'deletions')}</Text>
          </>
        )}
        <Text style={[styles.rowText, styles.mutedText]} numberOfLines={1}>
          {str(section, 'detail')}
        </Text>
        <Glyph name="chevron-right" size={13} color={P.cardMuted} />
      </Pressable>
      {drawButton ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => act(buttonAction)}
          style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
        >
          <Text style={styles.buttonText}>{str(button, 'label')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BackgroundBody({ section, act }: { section: JsonRecord; act: Act }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const finished = arr(section.finished);
  const finishedOpen = isTrue(section, 'finishedOpen');
  useEaseOnChange(finishedOpen);
  return (
    <View style={styles.rows}>
      {arr(section.running).map((row, index) => {
        const stop = obj(row)?.stop;
        const stopping = isTrue(row, 'stopping');
        const elapsed = str(row, 'elapsed');
        return (
          <View key={str(row, 'id') || String(index)} style={styles.row}>
            <Glyph name={str(row, 'kind') === 'monitor' ? 'eye-off' : 'terminal-2'} size={14} color={P.cardMuted} />
            <Text style={styles.rowText} numberOfLines={1}>
              {str(row, 'text')}
            </Text>
            {elapsed.length > 0 ? <Text style={styles.detail}>{elapsed}</Text> : null}
            {obj(stop) !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={stopping ? 'Stopping…' : 'Stop this command'}
                disabled={stopping}
                hitSlop={8}
                onPress={() => act(stop)}
                style={({ pressed }) => [styles.iconButton, pressed ? styles.rowPressed : null]}
              >
                {stopping ? (
                  <Spinner size={12} color={P.cardMuted} />
                ) : (
                  <Glyph name="player-stop" size={13} color={P.error} />
                )}
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {finished.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: finishedOpen }}
          onPress={() => act(section.finishedToggle)}
          style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        >
          <Text style={[styles.rowText, styles.mutedText]}>{str(section, 'finishedLabel')}</Text>
          <Text style={styles.link}>{finishedOpen ? 'Hide' : 'Show'}</Text>
          <Glyph name={finishedOpen ? 'chevron-up' : 'chevron-down'} size={12} color={P.cardMuted} />
        </Pressable>
      ) : null}
      {finishedOpen
        ? finished.map((row, index) => (
            <View key={`finished:${index}`} style={[styles.row, styles.subRowIndent]}>
              <StatusDot status={str(row, 'status')} />
              <Text style={styles.rowText} numberOfLines={1}>
                {str(row, 'text')}
              </Text>
              <Text style={styles.detail}>{str(row, 'detail')}</Text>
            </View>
          ))
        : null}
    </View>
  );
}

/** The loading shimmer: rows of bars pulsing in the chat's skeleton tint (desktop `skeleton_rows`). */
function Skeleton({ rows }: { rows: number }) {
  const styles = useStyles();
  return (
    <View style={styles.rows}>
      {Array.from({ length: Math.max(1, Math.min(12, rows)) }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonBar width={`${SKELETON_WIDTHS[index % SKELETON_WIDTHS.length]}%`} />
        </View>
      ))}
    </View>
  );
}

const SKELETON_WIDTHS = [72, 54, 86, 63, 78, 48] as const;
const SKELETON_PULSE_MS = 1400;

function SkeletonBar({ width }: { width: `${number}%` }) {
  const styles = useStyles();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const half = SKELETON_PULSE_MS / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: half, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[styles.skeletonBar, { width, opacity: pulse }]} />;
}

const ROW_HEIGHT = 30;

const useStyles = themedStyles((P) => ({
  scroll: { flexGrow: 0 },
  tabs: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 2,
    borderRadius: 9,
    backgroundColor: P.ink(0.06),
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 30, borderRadius: 7 },
  tabOn: { backgroundColor: P.ink(0.12) },
  tabText: { color: P.cardMuted, fontSize: 13 },
  tabTextOn: { color: P.foreground, fontWeight: '600' },
  /** A tab's cards inside the list: the list's own padding is already around them. */
  tabPage: { paddingHorizontal: 0, paddingBottom: 0 },
  hidden: { display: 'none' },
  choose: { paddingHorizontal: 4 },
  cards: { paddingHorizontal: 12, paddingBottom: 8, gap: 10 },
  error: { color: P.error, fontSize: PROSE_SIZE, paddingHorizontal: 4 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: P.menuBorder,
    backgroundColor: P.cardBackground,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  cardTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  title: { flexShrink: 1, color: P.foreground, fontSize: 14, fontWeight: '600' },
  meta: { color: P.cardMuted, fontSize: 12 },
  link: { color: P.link.url, fontSize: 13 },
  rows: { paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: ROW_HEIGHT, borderRadius: 6 },
  rowPressed: { backgroundColor: P.pressedFill },
  subRow: { paddingLeft: 18 },
  subRowIndent: { paddingLeft: 12 },
  rowText: { flex: 1, color: P.foreground, fontSize: 13 },
  mutedText: { color: P.cardMuted },
  linkText: { color: P.link.url },
  detail: { color: P.cardMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  badge: {
    color: P.cardMuted,
    fontSize: 11,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: P.menuBorder,
    overflow: 'hidden',
  },
  dim: { opacity: 0.6 },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 26 },
  summaryText: { flexShrink: 1, color: P.foreground, fontSize: 14, fontWeight: '600' },
  bar: {
    flexDirection: 'row',
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: P.border,
    marginTop: 4,
    marginBottom: 6,
  },
  swatch: { width: 9, height: 9, borderRadius: 2 },
  hollowSwatch: { backgroundColor: 'transparent', borderWidth: 1 },
  status: { color: P.cardMuted, fontSize: 12, paddingTop: 6 },
  iconButton: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fold: { color: P.cardMuted, fontSize: 13, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  group: { paddingTop: 4 },
  groupTitle: { color: P.mutedInk(0.7), fontSize: 11, fontWeight: '600', paddingVertical: 4 },
  empty: { color: P.cardMuted, fontSize: 13, paddingVertical: 4 },
  count: { fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '500' },
  button: {
    alignSelf: 'flex-start',
    marginTop: 6,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.neutralFill,
  },
  buttonPressed: { backgroundColor: P.neutralFillPressed },
  buttonText: { color: P.primary, fontSize: 13 },
  disabled: { opacity: 0.5 },
  ringPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.ink(0.1),
  },
  ringPillPressed: { backgroundColor: P.ink(0.08) },
  ringLabel: { color: P.cardMuted, fontSize: 13, lineHeight: 19, fontVariant: ['tabular-nums'] },
  skeletonRow: { height: ROW_HEIGHT, justifyContent: 'center' },
  skeletonBar: { height: 10, borderRadius: 5, backgroundColor: P.ink(0.12) },
}));
