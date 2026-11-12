/**
 * The Notifications list, drawn as the desktop's Notifications panel (`titlebar_notifications_panel.rs` in the Ghostex
 * repo; the rules in `feedPanel.ts`, CDXC:Notifications 2026-11-12): the header actions Mark all read and
 * Clear all; then the computer's feed rows in two groups, Unread and Read, newest first. A row is the desktop's card:
 * the agent's icon (or the kind's) in a square tile, the bold title with the computer's chip (with several computers)
 * and the time, a two-line body, and "project · kind" as its footer, with the blue accent wash while unread (red for an
 * approval, a failure, a message not sent and an expiring reset), dimmed once read.
 *
 * Touch stands in for the desktop's hover and right click: the card's check is always shown (the desktop shows it on
 * hover): on an unread card it marks the card read, on a read card it clears it; an open approval has none, as on the
 * desktop. The card's ⋯, or a long press, opens its menu: Open Session, Mark as Read or Unread (the desktop's right
 * click) and Clear. A tap opens the session and marks the card read, as a click does; an account or security row is
 * only marked read, as a remote computer's is on the desktop; an ended session's card opens the "Session ended" sheet
 * (Restore) instead of a dead terminal. Every change goes to the computer that owns the row, so it is the same on every
 * device.
 *
 * Half folded like a laptop the list ends above the fold, so no row, section title, notice or empty state is drawn on
 * the knick, as the Settings pages do (`components/common/foldGap.tsx` runs only plain `FlatList`s across it).
 *
 * One component for the full screen (`AttentionListScreen`) and the attention-list pane (`src/panes/`): the caller
 * decides what opening a session means (`onOpenSession`). In a pane (`pane`) the list reaches no side bar and keeps no
 * laptop fold gap, and its rows keep off a book fold by the pane's `controlInset`. Its body paints the appearance's
 * page colour itself, so in a pane its text stands on the colour its ink is made for.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  type SectionListData,
  type SectionListRenderItemInfo,
  type ViewInstance,
} from 'react-native';

import { AGENT_ICONS } from '../assets/agentIcons.generated';
import BottomSheet from '../components/common/BottomSheet';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '../components/sessions/ContextMenu';
import { FoldListFrame } from '../components/common/foldGap';
import { measureInWindow } from '../components/common/measureInWindow';
import { MoreGlyph } from '../components/sessions/icons';
import { useLaptopFold } from '../components/common/verticalBar/laptopFold';
import { NO_BAR_INSETS } from '../components/common/verticalBar/layout';
import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import { agentIconTint, resolveAgentIconId } from '../contract/mobileSummary';
import { NotificationsCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { enabledMachines, machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { PaneBarInset } from '../panes/geometry';
import type { ClosedSession } from '../sessions/sessionSearch';
import { useSettingsStore } from '../settings/store';
import {
  ATTENTION_ROW_WASH,
  GhostexRadii,
  GhostexStrokeWidth,
  SidebarPalette,
  colorOver,
  colorWithOpacity,
  neutralButtonFills,
} from '../theme/palette';
import { readableSecondaryText } from '../theme/sidebarAppearance';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import { sessionKey, type AttentionInbox } from './attentionRows';
import { attentionInboxOf, type Notice } from './attentionInbox';
import {
  feedRelativeTime,
  feedRowCanBeDone,
  feedRowMeta,
  feedRowOpensNothing,
  feedRowTitle,
  feedRowUrgent,
  type PanelRow,
} from './feedPanel';
import {
  changeEveryFeed,
  changeFeedRow,
  refreshAttentionFeeds,
  restoreEndedSession,
  useAttentionFeedStore,
} from './feedStore';
import { CloudOffGlyph, feedKindGlyph, PanelGlyph, type PanelGlyphName } from './icons';
import { useFeedPanel } from './useFeedPanel';

/** What opening a row's session asks for. */
export type OpenSessionTarget = { machineId: string; sessionId: string; question: boolean };

/** The unread card's accent wash, as strong as the list's attention wash (`ATTENTION_ROW_WASH`). */
const ROW_WASH_OPACITY = 9;

/** How often the cards' "5m" moves on while the list is on screen. */
const CLOCK_TICK_MS = 30_000;

/** The card's check and ⋯: the desktop's 22pt check, grown to a comfortable touch size. */
const CARD_BUTTON_SIZE = 28;
const CARD_BUTTON_GAP = 6;

type RowInk = { foreground: string; muted: string; attention: string; danger: string };

function rowInks(appearance: Appearance): { plain: RowInk; emphasis: RowInk } {
  const make = (surfaces: readonly string[]): RowInk => ({
    foreground: appearance.foreground,
    muted: readableSecondaryText(appearance.muted, appearance.foreground, surfaces),
    attention: readableSecondaryText(SidebarPalette.ROW_ATTENTION, appearance.foreground, surfaces),
    danger: readableSecondaryText(SidebarPalette.MENU_DANGER, appearance.foreground, surfaces),
  });
  return {
    plain: make([appearance.card, appearance.cardActive]),
    emphasis: make([
      colorOver(ATTENTION_ROW_WASH, appearance.background),
      colorOver(colorWithOpacity(SidebarPalette.ROW_APPROVAL, ROW_WASH_OPACITY), appearance.background),
      appearance.cardActive,
    ]),
  };
}

function accentOf(row: PanelRow): string {
  return feedRowUrgent(row) ? SidebarPalette.ROW_APPROVAL : SidebarPalette.ROW_ATTENTION;
}

/**
 * The enabled computers' notices (one too old to share its notifications), whether the list still loads, and the
 * computer named when none can be read; with the inbox, which says which waiting sessions have a question (a tap on
 * such a card opens the question card).
 */
export function useAttentionInbox(): {
  inbox: AttentionInbox;
  notices: Notice[];
  loading: boolean;
  unreachable: string | null;
} {
  const feeds = useAttentionFeedStore((state) => state.feeds);
  const closed = useAttentionFeedStore((state) => state.closed);
  const machines = useMachinesStore((state) => state.machines);
  const inventories = useInventoryStore((state) => state.inventoriesByMachineId);
  const settingsLoaded = useSettingsStore((state) => state.hydrated);
  const removedKeys = useSettingsStore((state) => state.settings.attentionRemovedSessions);
  return useMemo(() => {
    const { inbox, loadingIds, legacyIds, unreachableIds } = attentionInboxOf({
      feeds,
      closed,
      machines,
      inventories,
      settingsLoaded,
      removedKeys,
    });
    const enabled = enabledMachines({ machines });
    const notices: Notice[] = [];
    for (const machine of enabled) {
      if (legacyIds.includes(machine.id)) {
        notices.push({ key: machine.id, text: NotificationsCopy.tooOld(machineDisplayLabel(machine)) });
      }
    }
    const failing = enabled.find((machine) => unreachableIds.includes(machine.id));
    const unreachable =
      failing !== undefined && legacyIds.length + unreachableIds.length === enabled.length
        ? machineDisplayLabel(failing)
        : null;
    return { inbox, notices, loading: loadingIds.length > 0, unreachable };
  }, [feeds, closed, machines, inventories, settingsLoaded, removedKeys]);
}

/** The sessions whose wait is a question, by `sessionKey`: opening their card opens the question card. */
function questionKeys(inbox: AttentionInbox): Set<string> {
  return new Set(inbox.needsYou.filter((row) => row.kind === 'question').map((row) => row.key));
}

/** The agent's own logo when the row names one the phone draws, else the kind's icon (as the desktop's tile). */
function TileIcon({ row, appearance }: { row: PanelRow; appearance: Appearance }) {
  const iconId = row.agentName.length > 0 ? resolveAgentIconId(undefined, row.agentName) : null;
  const Icon = iconId !== null && (iconId !== 'terminal' || row.agentName === 'terminal') ? AGENT_ICONS[iconId] : null;
  if (Icon !== undefined && Icon !== null && iconId !== null) {
    return <Icon size={18} color={agentIconTint(iconId)} />;
  }
  return <PanelGlyph name={feedKindGlyph(row.kind)} size={18} color={colorWithOpacity(appearance.foreground, 84)} />;
}

function MachineChip({ label, appearance }: { label: string; appearance: Appearance }) {
  return (
    <View
      style={[
        styles.chip,
        {
          borderColor: colorWithOpacity(appearance.foreground, 16),
          backgroundColor: colorWithOpacity(appearance.foreground, 7),
        },
      ]}
    >
      <PanelGlyph name="deviceDesktop" size={12} color={colorWithOpacity(appearance.foreground, 80)} />
      <Text style={[styles.chipText, { color: colorWithOpacity(appearance.foreground, 80) }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function RowContent({
  row,
  now,
  ink,
  appearance,
  trailing,
}: {
  row: PanelRow;
  now: number;
  ink: RowInk;
  appearance: Appearance;
  /** The card's ⋯ and check, at the end of the footer's line. */
  trailing?: ReactNode;
}) {
  const unread = !row.read;
  const accent = accentOf(row);
  const time = feedRelativeTime(row.createdAt, now);
  // The footer takes the card's accent while unread, as on the desktop, moved toward the text colour until it reads.
  const footerColor = !unread ? ink.muted : feedRowUrgent(row) ? ink.danger : ink.attention;
  return (
    <>
      <View
        style={[
          styles.tile,
          { backgroundColor: unread ? colorWithOpacity(accent, 16) : colorWithOpacity(appearance.foreground, 10) },
        ]}
      >
        <TileIcon row={row} appearance={appearance} />
      </View>
      <View style={styles.text}>
        <View style={styles.firstLine}>
          <Text testID="attention-card-title" style={[styles.title, { color: ink.foreground }]} numberOfLines={1}>
            {feedRowTitle(row)}
          </Text>
          {row.machineLabel !== null ? <MachineChip label={row.machineLabel} appearance={appearance} /> : null}
          {time.length > 0 ? (
            <Text testID="attention-card-time" style={[styles.time, { color: ink.muted }]}>
              {time}
            </Text>
          ) : null}
        </View>
        {(row.body ?? '').length > 0 ? (
          <Text testID="attention-card-body" style={[styles.body, { color: ink.muted }]} numberOfLines={2}>
            {row.body}
          </Text>
        ) : null}
        <View style={styles.footerLine}>
          <Text testID="attention-card-footer" style={[styles.footer, { color: footerColor }]} numberOfLines={1}>
            {feedRowMeta(row)}
          </Text>
          {trailing}
        </View>
      </View>
    </>
  );
}

/** What the card shows, in its order, with the read state in words (VoiceOver hears no colour). */
function rowLabel(row: PanelRow, now: number): string {
  const parts = [row.read ? null : NotificationsCopy.rowUnread, `${feedRowTitle(row)}.`];
  if (row.machineLabel !== null) parts.push(`${row.machineLabel}.`);
  if ((row.body ?? '').length > 0) parts.push(sentence(row.body ?? ''));
  parts.push(sentence(feedRowMeta(row)));
  const time = feedRelativeTime(row.createdAt, now);
  if (time.length > 0) parts.push(`${time}.`);
  return parts.filter((part) => part !== null).join(' ');
}

/** A sentence of the spoken label: the text with a full stop, unless it ends in its own punctuation. */
function sentence(text: string): string {
  return /[.?!…]$/.test(text) ? text : `${text}.`;
}

function CardButton({
  label,
  testID,
  fill,
  border,
  pressedFill,
  onPress,
  children,
}: {
  label: string;
  testID: string;
  fill: string;
  border: string;
  pressedFill: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cardButton,
        { borderColor: border, backgroundColor: pressed ? pressedFill : fill },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Memoized: the list re-renders on every feed read, a card only when its own data changes. */
const Row = memo(function Row({
  row,
  now,
  appearance,
  ink,
  held,
  onOpen,
  onCheck,
  onMenu,
}: {
  row: PanelRow;
  now: number;
  appearance: Appearance;
  ink: RowInk;
  held: boolean;
  onOpen: (row: PanelRow) => void;
  onCheck: (row: PanelRow) => void;
  onMenu: (row: PanelRow, frame: MenuAnchor) => void;
}) {
  const ref = useRef<ViewInstance | null>(null);
  const unread = !row.read;
  const accent = accentOf(row);
  const check = feedRowCanBeDone(row);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={rowLabel(row, now)}
      accessibilityHint={feedRowOpensNothing(row) ? undefined : NotificationsCopy.openSession}
      testID={`attention-row-${row.id}`}
      onPress={() => onOpen(row)}
      onLongPress={() => measureInWindow(ref, (frame) => onMenu(row, frame))}
      style={({ pressed }) => [
        styles.row,
        unread
          ? {
              backgroundColor: colorWithOpacity(accent, ROW_WASH_OPACITY),
              borderColor: colorWithOpacity(accent, 30),
            }
          : [styles.rowRead, { backgroundColor: appearance.card, borderColor: appearance.border }],
        (pressed || held) && { backgroundColor: appearance.cardActive, opacity: 1 },
      ]}
    >
      <RowContent
        row={row}
        now={now}
        ink={ink}
        appearance={appearance}
        trailing={
      <View style={styles.cardButtons}>
        <CardButton
          label={NotificationsCopy.feed.rowMenu}
          testID={`attention-row-menu-${row.id}`}
          fill={colorWithOpacity(appearance.foreground, 8)}
          border={colorWithOpacity(appearance.foreground, 14)}
          pressedFill={colorWithOpacity(appearance.foreground, 20)}
          onPress={() => measureInWindow(ref, (frame) => onMenu(row, frame))}
        >
          <MoreGlyph size={15} color={colorWithOpacity(appearance.foreground, 85)} />
        </CardButton>
        {check ? (
          <CardButton
            label={unread ? NotificationsCopy.feed.checkRead : NotificationsCopy.feed.checkClear}
            testID={`attention-row-check-${row.id}`}
            fill={unread ? colorWithOpacity(accent, 18) : colorWithOpacity(appearance.foreground, 12)}
            border={unread ? colorWithOpacity(accent, 45) : colorWithOpacity(appearance.foreground, 16)}
            pressedFill={unread ? colorWithOpacity(accent, 32) : colorWithOpacity(appearance.foreground, 22)}
            onPress={() => onCheck(row)}
          >
            <PanelGlyph name="check" size={15} color={colorWithOpacity(appearance.foreground, 92)} />
          </CardButton>
        ) : null}
      </View>
        }
      />
    </Pressable>
  );
});

function EmptyState({
  icon,
  title,
  text,
  appearance,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  appearance: Appearance;
}) {
  return (
    <View style={styles.empty}>
      {icon}
      <Text style={[styles.emptyTitle, { color: appearance.foreground }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: appearance.muted }]}>{text}</Text>
    </View>
  );
}

/**
 * The panel's header actions (the desktop's "Mark all read", "Clear all"): equal shares of the row,
 * unfilled, divided by thin lines, an icon beside each label, dimmed while there is nothing to act on.
 */
function HeaderActions({
  appearance,
  actions,
}: {
  appearance: Appearance;
  actions: { key: string; label: string; glyph: PanelGlyphName; enabled: boolean; onPress: () => void }[];
}) {
  const line = colorWithOpacity(appearance.foreground, 12);
  return (
    <View style={[styles.actions, { borderColor: line }]}>
      {actions.map((action, index) => {
        const ink = colorWithOpacity(appearance.foreground, action.enabled ? 78 : 38);
        return (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: !action.enabled }}
            disabled={!action.enabled}
            testID={`notifications-${action.key}`}
            onPress={action.onPress}
            style={({ pressed }) => [
              styles.action,
              index > 0 && { borderLeftWidth: GhostexStrokeWidth, borderLeftColor: line },
              pressed && { backgroundColor: colorWithOpacity(appearance.foreground, 14) },
            ]}
          >
            <PanelGlyph name={action.glyph} size={15} color={ink} />
            <Text style={[styles.actionText, { color: ink }]} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SheetButton({
  label,
  fills,
  ink,
  onPress,
}: {
  label: string;
  fills: { rest: string; pressed: string };
  ink: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.sheetButton, { backgroundColor: pressed ? fills.pressed : fills.rest }]}
    >
      <Text style={[styles.sheetButtonText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

/** The ended session a card opened: the computer lists it as closed. */
type EndedTarget = { machineId: string; sessionId: string; title: string; ended: ClosedSession };

/**
 * The "Session ended" sheet of an ended session's card: Restore (when the computer can restore it) and Close. While
 * the restore runs it says so and offers Close, not Cancel: the phone cannot stop a restore the computer started, so
 * closing only hides the sheet and the result still applies. A failed restore offers Try Again. The card itself is
 * cleared with its check, as any other.
 */
function EndedSheet({
  target,
  onClose,
  appearance,
}: {
  target: EndedTarget | null;
  onClose: () => void;
  appearance: Appearance;
}) {
  const restore = useAttentionFeedStore((state) =>
    target === null ? undefined : state.restores[sessionKey(target.machineId, target.sessionId)],
  );
  const neutral = neutralButtonFills(appearance.light);
  const startRestore = useCallback(() => {
    if (target === null) return;
    void restoreEndedSession(target.machineId, target.ended).then((restored) => {
      if (restored) onClose();
    });
  }, [target, onClose]);

  let title = '';
  let body: ReactNode = null;
  let buttons: ReactNode = null;
  if (target !== null && restore === 'running') {
    title = NotificationsCopy.ended.restoringTitle;
    body = (
      <Text accessibilityLiveRegion="polite" style={[styles.sheetText, { color: appearance.muted }]}>
        {NotificationsCopy.ended.restoringText}
      </Text>
    );
    buttons = <SheetButton label={NotificationsCopy.close} fills={neutral} ink={appearance.foreground} onPress={onClose} />;
  } else if (target !== null && restore === 'failed') {
    title = NotificationsCopy.ended.failedTitle;
    body = (
      <Text accessibilityRole="alert" style={[styles.sheetText, { color: appearance.muted }]}>
        {NotificationsCopy.ended.failedText}
      </Text>
    );
    buttons = (
      <>
        <SheetButton
          label={NotificationsCopy.ended.tryAgain}
          fills={neutral}
          ink={appearance.foreground}
          onPress={startRestore}
        />
        <SheetButton label={NotificationsCopy.close} fills={neutral} ink={appearance.foreground} onPress={onClose} />
      </>
    );
  } else if (target !== null) {
    const { ended } = target;
    title = NotificationsCopy.ended.title;
    body = (
      <>
        {target.title.length > 0 ? (
          <Text style={[styles.sheetText, { color: appearance.foreground }]} numberOfLines={2}>
            {target.title}
          </Text>
        ) : null}
        <Text style={[styles.sheetText, { color: appearance.muted }]}>
          {ended.isRestorable || ended.restoreUnavailableReason.length === 0
            ? NotificationsCopy.ended.text
            : `${NotificationsCopy.ended.text} ${ended.restoreUnavailableReason}`}
        </Text>
      </>
    );
    buttons = (
      <>
        {ended.isRestorable ? (
          <SheetButton
            label={NotificationsCopy.ended.restore}
            fills={neutral}
            ink={appearance.foreground}
            onPress={startRestore}
          />
        ) : null}
        <SheetButton label={NotificationsCopy.close} fills={neutral} ink={appearance.foreground} onPress={onClose} />
      </>
    );
  }

  return (
    <BottomSheet visible={target !== null} onClose={onClose}>
      <View style={styles.sheet}>
        <Text accessibilityRole="header" style={[styles.sheetTitle, { color: appearance.foreground }]}>
          {title}
        </Text>
        {body}
        {buttons}
      </View>
    </BottomSheet>
  );
}

type Section = { key: 'unread' | 'read'; title: string; data: PanelRow[] };

export default function AttentionList({
  onOpenSession,
  pane,
}: {
  onOpenSession: (target: OpenSessionTarget) => void;
  /** Shown in a pane: how far its rows stay off the body's edges to keep off a book fold. */
  pane?: { controlInset: PaneBarInset };
}) {
  const appearance = useAppearance();
  const inks = useMemo(() => rowInks(appearance), [appearance]);
  // The failure line's red reads on the dark pages; on a light page it moves toward the text colour until it keeps 4.5:1.
  const failedInk = useMemo(
    () => readableSecondaryText(SidebarPalette.MENU_DANGER, appearance.foreground, [appearance.background]),
    [appearance],
  );
  // The list reaches under the iPhone Duo's side bar, its rows keep clear of it; not in a pane.
  const edges = useScrollToBarEdges(styles.content, pane === undefined ? null : NO_BAR_INSETS);
  const laptopFold = useLaptopFold();
  const panel = useFeedPanel();
  const { inbox, notices, loading, unreachable } = useAttentionInbox();
  const closed = useAttentionFeedStore((state) => state.closed);
  const questions = useMemo(() => questionKeys(inbox), [inbox]);
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState<{ row: PanelRow; frame: MenuAnchor } | null>(null);
  const [endedTarget, setEndedTarget] = useState<EndedTarget | null>(null);
  const [failed, setFailed] = useState(false);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const report = useCallback((done: Promise<boolean>) => {
    void done.then((ok) => setFailed(!ok));
  }, []);

  const change = useCallback(
    (row: PanelRow, action: 'markRead' | 'markUnread' | 'dismiss') =>
      report(changeFeedRow(row.machineId, { action, notificationId: row.id })),
    [report],
  );

  /** A tap: the card is marked read on its computer, then its session opens (as a click on the desktop). */
  const open = useCallback(
    (row: PanelRow, questionSessions: Set<string> = questions) => {
      setMenu(null);
      if (!row.read && feedRowCanBeDone(row)) change(row, 'markRead');
      if (feedRowOpensNothing(row)) return;
      const ended = closed[row.machineId]?.find((session) => session.sessionId === row.sessionId);
      if (ended !== undefined) {
        setEndedTarget({ machineId: row.machineId, sessionId: row.sessionId, title: feedRowTitle(row), ended });
        return;
      }
      onOpenSession({
        machineId: row.machineId,
        sessionId: row.sessionId,
        question: questionSessions.has(sessionKey(row.machineId, row.sessionId)),
      });
    },
    [questions, closed, change, onOpenSession],
  );

  /** The card's check: an unread card is marked read, a read card is cleared from the list. */
  const check = useCallback((row: PanelRow) => change(row, row.read ? 'dismiss' : 'markRead'), [change]);

  const showMenu = useCallback((row: PanelRow, frame: MenuAnchor) => setMenu({ row, frame }), []);

  const pull = useCallback(() => {
    setPulling(true);
    void refreshAttentionFeeds().finally(() => setPulling(false));
  }, []);

  const onlineMachines = useMemo(
    () => [...new Set([...panel.unread, ...panel.read].map((row) => row.machineId))],
    [panel],
  );

  const menuItems = useMemo((): ContextMenuItem[] => {
    if (menu === null) return [];
    const { row } = menu;
    const item = (key: string, label: string, run: () => void, destructive = false): ContextMenuItem => ({
      kind: 'item',
      key,
      label,
      destructive,
      onPress: () => {
        setMenu(null);
        run();
      },
    });
    const items: ContextMenuItem[] = [];
    if (!feedRowOpensNothing(row)) items.push(item('open', NotificationsCopy.openSession, () => open(row)));
    if (feedRowCanBeDone(row)) {
      items.push(
        row.read
          ? item('unread', NotificationsCopy.markUnread, () => change(row, 'markUnread'))
          : item('read', NotificationsCopy.markRead, () => change(row, 'markRead')),
        item('clear', NotificationsCopy.clear, () => change(row, 'dismiss'), true),
      );
    }
    return items;
  }, [menu, open, change]);

  const nothing = panel.unread.length + panel.read.length === 0;
  const sections: Section[] = [
    { key: 'unread' as const, title: NotificationsCopy.feed.unread, data: panel.unread },
    { key: 'read' as const, title: NotificationsCopy.feed.read, data: panel.read },
  ].filter((section) => section.data.length > 0);

  const heldKey = menu?.row.key ?? null;
  const renderItem = useCallback(
    ({ item }: SectionListRenderItemInfo<PanelRow, Section>) => (
      <Row
        row={item}
        now={now}
        appearance={appearance}
        ink={item.read ? inks.plain : inks.emphasis}
        held={heldKey === item.key}
        onOpen={open}
        onCheck={check}
        onMenu={showMenu}
      />
    ),
    [now, appearance, inks, heldKey, open, check, showMenu],
  );
  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<PanelRow, Section> }) => (
      <Text
        accessibilityRole="header"
        style={[
          styles.sectionTitle,
          { color: colorWithOpacity(appearance.foreground, 62) },
          section.key === 'read' && panel.unread.length > 0 && styles.sectionTitleAfter,
        ]}
      >
        {section.title}
      </Text>
    ),
    [appearance, panel.unread.length],
  );

  const header = (
    <>
      {notices.map((notice) => (
        <View key={notice.key} accessibilityRole="alert" style={[styles.notice, { backgroundColor: appearance.card }]}>
          <CloudOffGlyph size={16} color={appearance.mutedGlyph} />
          <Text style={[styles.noticeText, { color: appearance.muted }]}>{notice.text}</Text>
        </View>
      ))}
      {panel.offlineNotice !== null ? (
        <Text style={[styles.offline, { color: colorWithOpacity(appearance.foreground, 50) }]}>
          {panel.offlineNotice}
        </Text>
      ) : null}
      {failed ? (
        <Text accessibilityRole="alert" style={[styles.failed, { color: failedInk }]}>
          {NotificationsCopy.actionFailed}
        </Text>
      ) : null}
    </>
  );
  const empty =
    nothing && unreachable !== null ? (
      <EmptyState
        icon={<CloudOffGlyph size={32} color={appearance.mutedGlyph} />}
        title={NotificationsCopy.cantLoadTitle}
        text={NotificationsCopy.cantLoadText(unreachable)}
        appearance={appearance}
      />
    ) : nothing && loading ? (
      <Text style={[styles.loading, { color: appearance.muted }]}>{NotificationsCopy.loading}</Text>
    ) : (
      <EmptyState
        icon={<PanelGlyph name="bell" size={32} color={colorWithOpacity(appearance.foreground, 35)} />}
        title={NotificationsCopy.feed.emptyTitle}
        text={NotificationsCopy.feed.emptyText}
        appearance={appearance}
      />
    );

  return (
    <View style={[styles.scroll, { backgroundColor: appearance.background }]}>
      <View
        style={
          pane === undefined
            ? styles.actionsFrame
            : [
                styles.actionsFrame,
                {
                  paddingLeft: styles.actionsFrame.paddingHorizontal + pane.controlInset.left,
                  paddingRight: styles.actionsFrame.paddingHorizontal + pane.controlInset.right,
                },
              ]
        }
      >
        <HeaderActions
          appearance={appearance}
          actions={[
            {
              key: 'mark-all-read',
              label: NotificationsCopy.feed.markAllRead,
              glyph: 'check',
              enabled: panel.unreadCount > 0,
              onPress: () => report(changeEveryFeed(onlineMachines, 'markAllRead')),
            },
            {
              key: 'clear-all',
              label: NotificationsCopy.feed.clearAll,
              glyph: 'xmark',
              enabled: !nothing,
              onPress: () => report(changeEveryFeed(onlineMachines, 'clearAll')),
            },
          ]}
        />
      </View>
      <FoldListFrame fold={pane === undefined ? laptopFold : null}>
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          // The first batch fills the tallest window the app runs in (the unfolded Duo, about 13 rows plus the
          // section titles), so the list never opens with an empty lower part that fills a frame later.
          initialNumToRender={20}
          ItemSeparatorComponent={RowGap}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          style={[styles.scroll, { backgroundColor: appearance.background }, edges.scroll]}
          contentContainerStyle={[
            styles.content,
            edges.content,
            pane !== undefined && {
              paddingLeft: styles.content.padding + pane.controlInset.left,
              paddingRight: styles.content.padding + pane.controlInset.right,
            },
          ]}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={appearance.mutedGlyph} />}
        />
      </FoldListFrame>
      <ContextMenu
        visible={menu !== null}
        title={menu === null ? '' : feedRowTitle(menu.row)}
        subtitle={menu === null ? undefined : feedRowMeta(menu.row)}
        items={menuItems}
        onClose={() => setMenu(null)}
        rowAnchor={menu?.frame}
        lifted={
          menu === null
            ? undefined
            : {
                content: (
                  <View style={styles.liftedRow}>
                    <RowContent row={menu.row} now={now} ink={inks.plain} appearance={appearance} />
                  </View>
                ),
                accessibilityLabel: rowLabel(menu.row, now),
                onPress: () => open(menu.row),
              }
        }
      />
      <EndedSheet target={endedTarget} onClose={() => setEndedTarget(null)} appearance={appearance} />
    </View>
  );
}

function RowGap() {
  return <View style={styles.rowGap} />;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 12, paddingBottom: 28, flexGrow: 1 },
  actionsFrame: { paddingHorizontal: 12, paddingTop: 4 },
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 40,
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    overflow: 'hidden',
  },
  action: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4 },
  actionText: { fontSize: 13, flexShrink: 1 },
  // The desktop's UNREAD / READ headings: small, bold, capitals.
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 6,
    marginBottom: 9,
    paddingHorizontal: 4,
  },
  sectionTitleAfter: { marginTop: 16 },
  rowGap: { height: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: GhostexStrokeWidth,
  },
  // The desktop panel dims a read card.
  rowRead: { opacity: 0.72 },
  liftedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12 },
  tile: {
    width: 34,
    height: 34,
    borderRadius: GhostexRadii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0, gap: 6 },
  firstLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  time: { fontSize: 12, fontVariant: ['tabular-nums'] },
  chip: {
    flexShrink: 1,
    maxWidth: 140,
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: GhostexStrokeWidth,
  },
  chipText: { flexShrink: 1, fontSize: 11, fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  footerLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 16 },
  footer: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  // The check and the ⋯ end the footer's line, in the card's bottom-right corner where the desktop's check floats.
  cardButtons: { flexDirection: 'row', gap: CARD_BUTTON_GAP, marginVertical: -4 },
  cardButton: {
    width: CARD_BUTTON_SIZE,
    height: CARD_BUTTON_SIZE,
    borderRadius: 7,
    borderWidth: GhostexStrokeWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 24 },
  emptyTitle: { marginTop: 4, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 13, textAlign: 'center' },
  loading: { marginTop: 24, fontSize: 13, textAlign: 'center' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: GhostexRadii.card,
    marginBottom: 8,
  },
  noticeText: { flex: 1, fontSize: 13 },
  offline: { fontSize: 12.5, paddingHorizontal: 4, marginBottom: 8 },
  failed: { fontSize: 13, paddingHorizontal: 4, marginBottom: 8 },
  sheet: { gap: 10, paddingHorizontal: 4 },
  sheetTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  sheetText: { fontSize: 14, textAlign: 'center' },
  sheetButton: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetButtonText: { fontSize: 16, fontWeight: '600' },
});
