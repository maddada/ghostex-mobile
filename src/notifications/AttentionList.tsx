/**
 * The attention list (the notifications design, as a state inbox): what needs the user now, one row per session by
 * its live state, in the sections Needs you, Done and Failed, with account notices last (`attentionRows.ts`). A row
 * names agent · project, the session's title, the time and the state as word and glyph; never anything the agent
 * wrote. A tap opens the session (a question at its question card) and marks the session's unread rows read on the
 * computer, as the read state is shared with its bell, except its failure rows (`readOnOpen`): opening answers no
 * question and fixes no failure, so a Failed session stays under Failed. An account row
 * is only marked read. An ended session's row opens the "Session ended" sheet (Restore, Remove) instead of a dead
 * terminal. A long press opens the row's menu at the row: Open Session, and Mark as Done on a Failed row; an account
 * row keeps Mark as Read/Unread and Clear.
 * Half folded like a laptop the list ends above the fold, so no row, section title, notice or empty state is drawn on
 * the knick, at rest or while scrolling, and the lower half stays empty, as the Settings pages do: it is a section list
 * the fold frame keeps above the fold (`components/common/foldGap.tsx` runs only plain `FlatList`s across it).
 *
 * One component for the full screen (`AttentionListScreen`) and the attention-list pane (`src/panes/`): the
 * caller decides what opening a session means (`onOpenSession`: navigate to it, or open it in the pane beside). In a
 * pane (`pane`) the list reaches no side bar and keeps no laptop fold gap (the panes stand above that fold), and its
 * rows keep off a book fold by the pane's `controlInset`. Its body paints the appearance's page colour itself, so in a
 * pane (whose card is the terminal's black) its text stands on the colour its ink is made for, as on the full screen.
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
import { useLaptopFold } from '../components/common/verticalBar/laptopFold';
import { NO_BAR_INSETS } from '../components/common/verticalBar/layout';
import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import { agentIconTint, formatLastActive } from '../contract/mobileSummary';
import { NotificationsCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { enabledMachines, machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { PaneBarInset } from '../panes/geometry';
import { useSettingsStore } from '../settings/store';
import {
  ATTENTION_ROW_WASH,
  GhostexPalette,
  GhostexRadii,
  GhostexStrokeWidth,
  SidebarPalette,
  colorOver,
  colorWithOpacity,
  neutralButtonFills,
} from '../theme/palette';
import { readableSecondaryText } from '../theme/sidebarAppearance';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import {
  buildAttentionList,
  machineFeed,
  type AttentionInbox,
  type AttentionRow,
  type InboxSection,
  type ListKind,
  type MachineFeed,
} from './attentionRows';
import {
  markAttentionRowsRead,
  refreshAttentionFeeds,
  removeEndedRow,
  restoreEndedSession,
  updateAttentionFeed,
  useAttentionFeedStore,
} from './feedStore';
import { CloudOffGlyph, KindGlyph } from './icons';

/** What opening a row's session asks for. */
export type OpenSessionTarget = { machineId: string; sessionId: string; question: boolean };

/** How often the rows' "5m ago" moves on while the list is on screen. */
const CLOCK_TICK_MS = 30_000;

type StatusColors = { waiting: string; question: string; danger: string };
const STATUS_COLORS: StatusColors = {
  waiting: SidebarPalette.ROW_ATTENTION,
  question: SidebarPalette.ROW_QUESTION,
  danger: SidebarPalette.MENU_DANGER,
};

function kindColor(kind: ListKind, neutral: string, status: StatusColors): string {
  if (kind === 'waiting') return status.waiting;
  if (kind === 'question') return status.question;
  if (kind === 'approval' || kind === 'failed' || kind === 'sendFailed' || kind === 'resetExpiring') {
    return status.danger;
  }
  return neutral;
}

type RowInk = {
  light: boolean;
  foreground: string;
  muted: string;
  mutedGlyph: string;
  status: StatusColors;
};

function rowInks(appearance: Appearance): { plain: RowInk; emphasis: RowInk } {
  const make = (surfaces: readonly string[]): RowInk => ({
    light: appearance.light,
    foreground: appearance.foreground,
    muted: readableSecondaryText(appearance.muted, appearance.foreground, surfaces),
    mutedGlyph: appearance.mutedGlyph,
    status: {
      waiting: readableSecondaryText(STATUS_COLORS.waiting, appearance.foreground, surfaces),
      question: readableSecondaryText(STATUS_COLORS.question, appearance.foreground, surfaces),
      danger: readableSecondaryText(STATUS_COLORS.danger, appearance.foreground, surfaces),
    },
  });
  return {
    plain: make([appearance.card, appearance.cardActive]),
    emphasis: make([colorOver(ATTENTION_ROW_WASH, appearance.background), appearance.cardActive]),
  };
}

/** Drawn with the attention wash: what waits for the user, and an account notice not read yet. */
function emphasized(row: AttentionRow): boolean {
  return row.section === 'needsYou' || (row.account && !row.read);
}

type Notice = { key: string; text: string };

/**
 * The inbox of every enabled computer, a notice for each one whose feed cannot be read, and whether the list still
 * loads or no computer can be read at all.
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
    const enabled = enabledMachines({ machines });
    const shown: MachineFeed[] = [];
    const notices: Notice[] = [];
    let loading = false;
    for (const machine of enabled) {
      const feed = feeds[machine.id];
      const label = machineDisplayLabel(machine);
      if (feed === undefined || feed.status === 'loading') loading = true;
      else if (feed.status === 'legacy') notices.push({ key: machine.id, text: NotificationsCopy.tooOld(label) });
      else if (feed.status === 'unreachable') notices.push({ key: machine.id, text: NotificationsCopy.offline(label) });
      shown.push(machineFeed({ id: machine.id, label }, feed, inventories[machine.id], closed[machine.id] ?? []));
    }
    // Until the removed sessions are loaded no Done or Failed row shows, whether its computer answers or not, so a
    // removed one never flashes up there.
    const inbox = buildAttentionList(shown, settingsLoaded ? new Set(removedKeys) : null);
    const failing = enabled.find((machine) => feeds[machine.id]?.status === 'unreachable');
    const unreachable =
      failing !== undefined && notices.length === enabled.length ? machineDisplayLabel(failing) : null;
    return { inbox, notices, loading, unreachable };
  }, [feeds, closed, machines, inventories, settingsLoaded, removedKeys]);
}

function rowTime(row: AttentionRow, now: Date): string | null {
  return row.at.length > 0 ? formatLastActive(row.at, now) : null;
}

function RowContent({ row, now, ink }: { row: AttentionRow; now: Date; ink: RowInk }) {
  const Icon = AGENT_ICONS[row.agentIconId] ?? AGENT_ICONS.terminal;
  const strong = emphasized(row);
  // The status colours and the dimmer ink of a plain row read on the dark rows only: on a light row identity and state
  // word take the ink's foreground, and the glyph keeps the state's colour.
  const whoColor = !strong && !ink.light ? SidebarPalette.FOREGROUND : ink.foreground;
  const neutral = row.ended !== null ? ink.muted : kindColor(row.kind, ink.muted, ink.status);
  const wordColor = ink.light ? ink.foreground : neutral;
  const detail = row.machineLabel !== null ? `${row.detail} · ${row.machineLabel}` : row.detail;
  const time = rowTime(row, now);
  const word = row.lastKnown ? `${row.label} · ${NotificationsCopy.lastKnown}` : row.label;
  return (
    <>
      <View style={styles.tile}>
        <Icon size={20} color={agentIconTint(row.agentIconId)} />
      </View>
      <View style={styles.text}>
        <View style={styles.firstLine}>
          <Text style={[styles.who, { color: whoColor }, strong && styles.whoStrong]} numberOfLines={1}>
            {row.who}
          </Text>
          {time !== null ? <Text style={[styles.time, { color: ink.muted }]}>{time}</Text> : null}
        </View>
        {detail.length > 0 ? (
          <Text style={[styles.detail, { color: ink.muted }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
        <View style={styles.kind}>
          <KindGlyph
            kind={row.ended !== null ? 'ended' : row.kind}
            size={14}
            color={row.ended !== null ? ink.mutedGlyph : kindColor(row.kind, ink.mutedGlyph, STATUS_COLORS)}
          />
          <Text style={[styles.kindText, { color: wordColor }, strong && styles.kindStrong]}>{word}</Text>
        </View>
      </View>
    </>
  );
}

function rowLabel(row: AttentionRow, now: Date): string {
  const parts = [row.account && !row.read ? NotificationsCopy.rowUnread : null, `${row.who}, ${row.label}.`];
  if (row.detail.length > 0) parts.push(`${row.detail}.`);
  if (row.machineLabel !== null) parts.push(`${row.machineLabel}.`);
  if (row.lastKnown) parts.push(`${NotificationsCopy.lastKnown}.`);
  const time = rowTime(row, now);
  if (time !== null) parts.push(`${time}.`);
  return parts.filter((part) => part !== null).join(' ');
}

/** Memoized: the list re-renders on every feed or session-list read, a row only when its own data changes. */
const Row = memo(function Row({
  row,
  now,
  appearance,
  ink,
  held,
  onOpen,
  onHold,
}: {
  row: AttentionRow;
  now: Date;
  appearance: Appearance;
  ink: RowInk;
  held: boolean;
  onOpen: (row: AttentionRow) => void;
  onHold: (row: AttentionRow, frame: MenuAnchor) => void;
}) {
  const ref = useRef<ViewInstance | null>(null);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={rowLabel(row, now)}
      accessibilityHint={row.account ? undefined : NotificationsCopy.openSession}
      testID={`attention-row-${row.id}`}
      onPress={() => onOpen(row)}
      onLongPress={() => measureInWindow(ref, (frame) => onHold(row, frame))}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: appearance.card, borderColor: appearance.border },
        emphasized(row) && styles.rowEmphasis,
        (pressed || held) && { backgroundColor: appearance.cardActive },
      ]}
    >
      <RowContent row={row} now={now} ink={ink} />
    </Pressable>
  );
});

function EmptyState({
  icon,
  title,
  text,
  appearance,
  fill,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  appearance: Appearance;
  /** The whole list's empty state fills the page; Needs you's own stands in its section. */
  fill: boolean;
}) {
  return (
    <View style={[styles.empty, fill && styles.emptyFill]}>
      {icon}
      <Text style={[styles.emptyTitle, { color: appearance.foreground }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: appearance.muted }]}>{text}</Text>
    </View>
  );
}

type Section = { key: InboxSection; title: string; data: AttentionRow[] };

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

/**
 * The "Session ended" sheet of an ended session's row: Restore (when the computer can restore it) and Remove, which
 * asks first. While the restore runs it says so and offers Close, not Cancel: the phone cannot stop a restore the
 * computer started, so closing only hides the sheet and the result still applies. A failed restore offers Try Again.
 */
function EndedSheet({
  row,
  onClose,
  appearance,
}: {
  row: AttentionRow | null;
  onClose: () => void;
  appearance: Appearance;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const restore = useAttentionFeedStore((state) => (row === null ? undefined : state.restores[row.key]));
  const ended = row?.ended ?? null;
  const danger = { rest: appearance.dangerFill, pressed: appearance.dangerFillPressed };
  const neutral = neutralButtonFills(appearance.light);
  const close = useCallback(() => {
    setConfirmRemove(false);
    onClose();
  }, [onClose]);
  const startRestore = useCallback(() => {
    if (row === null || ended === null) return;
    void restoreEndedSession(row.machineId, ended).then((restored) => {
      if (restored) close();
    });
  }, [row, ended, close]);

  let title: string;
  let body: ReactNode = null;
  let buttons: ReactNode;
  if (row === null || ended === null) {
    title = '';
    buttons = null;
  } else if (confirmRemove) {
    title = NotificationsCopy.ended.removeTitle;
    body = <Text style={[styles.sheetText, { color: appearance.muted }]}>{NotificationsCopy.ended.removeText}</Text>;
    buttons = (
      <>
        <SheetButton
          label={NotificationsCopy.ended.remove}
          fills={danger}
          ink={appearance.danger}
          onPress={() => {
            removeEndedRow(row.machineId, row.sessionId);
            close();
          }}
        />
        <SheetButton
          label={NotificationsCopy.cancel}
          fills={neutral}
          ink={appearance.foreground}
          onPress={() => setConfirmRemove(false)}
        />
      </>
    );
  } else if (restore === 'running') {
    title = NotificationsCopy.ended.restoringTitle;
    body = (
      <Text accessibilityLiveRegion="polite" style={[styles.sheetText, { color: appearance.muted }]}>
        {NotificationsCopy.ended.restoringText}
      </Text>
    );
    buttons = (
      <SheetButton label={NotificationsCopy.close} fills={neutral} ink={appearance.foreground} onPress={close} />
    );
  } else if (restore === 'failed') {
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
        <SheetButton label={NotificationsCopy.close} fills={neutral} ink={appearance.foreground} onPress={close} />
      </>
    );
  } else {
    title = NotificationsCopy.ended.title;
    body = (
      <>
        {row.detail.length > 0 ? (
          <Text style={[styles.sheetText, { color: appearance.foreground }]} numberOfLines={2}>
            {row.detail}
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
        <SheetButton
          label={NotificationsCopy.ended.remove}
          fills={danger}
          ink={appearance.danger}
          onPress={() => setConfirmRemove(true)}
        />
        <SheetButton label={NotificationsCopy.close} fills={neutral} ink={appearance.foreground} onPress={close} />
      </>
    );
  }

  return (
    <BottomSheet visible={row !== null && ended !== null} onClose={close}>
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
  const { inbox, notices, loading, unreachable } = useAttentionInbox();
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState<{ row: AttentionRow; frame: MenuAnchor } | null>(null);
  const [endedRow, setEndedRow] = useState<AttentionRow | null>(null);
  const [failed, setFailed] = useState(false);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const report = useCallback((done: Promise<boolean>) => {
    void done.then((ok) => setFailed(!ok));
  }, []);

  const open = useCallback(
    (row: AttentionRow) => {
      setMenu(null);
      if (row.account) {
        if (!row.read) report(updateAttentionFeed(row.machineId, { action: 'markRead', notificationId: row.id }));
        return;
      }
      if (row.ended !== null) {
        setEndedRow(row);
        return;
      }
      if (row.unreadIds.length > 0) report(markAttentionRowsRead(row.machineId, row.unreadIds));
      onOpenSession({ machineId: row.machineId, sessionId: row.sessionId, question: row.kind === 'question' });
    },
    [onOpenSession, report],
  );

  const hold = useCallback((row: AttentionRow, frame: MenuAnchor) => setMenu({ row, frame }), []);

  const pull = useCallback(() => {
    setPulling(true);
    void refreshAttentionFeeds().finally(() => setPulling(false));
  }, []);

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
    if (row.account) {
      const update = (action: 'markRead' | 'markUnread' | 'dismiss') =>
        report(updateAttentionFeed(row.machineId, { action, notificationId: row.id }));
      return [
        row.read
          ? item('unread', NotificationsCopy.markUnread, () => update('markUnread'))
          : item('read', NotificationsCopy.markRead, () => update('markRead')),
        item('clear', NotificationsCopy.clear, () => update('dismiss'), true),
      ];
    }
    const items = [item('open', NotificationsCopy.openSession, () => open(row))];
    if (row.section === 'failed') {
      items.push(
        item('done', NotificationsCopy.markDone, () => report(markAttentionRowsRead(row.machineId, row.stateIds))),
      );
    }
    return items;
  }, [menu, open, report]);

  const nothing =
    inbox.needsYou.length + inbox.done.length + inbox.failed.length + inbox.accounts.length === 0;
  // Needs you always stands first, saying "Nothing needs you" while it is empty; the other sections only with rows.
  // Its title says "last known" while one of its waits comes from a computer that cannot be reached now, as the
  // bell's number does. With nothing at all while the list loads or no computer can be read, the list's own state
  // shows instead.
  const ordered: Section[] = [
    {
      key: 'needsYou',
      title: inbox.needsYou.some((row) => row.lastKnown)
        ? NotificationsCopy.section.needsYouLastKnown
        : NotificationsCopy.section.needsYou,
      data: inbox.needsYou,
    },
    { key: 'done', title: NotificationsCopy.section.done, data: inbox.done },
    { key: 'failed', title: NotificationsCopy.section.failed, data: inbox.failed },
    { key: 'accounts', title: NotificationsCopy.section.accounts, data: inbox.accounts },
  ];
  const sections =
    nothing && (unreachable !== null || loading)
      ? []
      : ordered.filter((section) => section.key === 'needsYou' || section.data.length > 0);

  const heldKey = menu?.row.key ?? null;
  const renderItem = useCallback(
    ({ item }: SectionListRenderItemInfo<AttentionRow, Section>) => (
      <Row
        row={item}
        now={now}
        appearance={appearance}
        ink={emphasized(item) ? inks.emphasis : inks.plain}
        held={heldKey === item.key}
        onOpen={open}
        onHold={hold}
      />
    ),
    [now, appearance, inks, heldKey, open, hold],
  );
  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<AttentionRow, Section> }) => (
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: appearance.muted }]}>
        {section.title}
      </Text>
    ),
    [appearance],
  );
  const renderSectionFooter = useCallback(
    ({ section }: { section: SectionListData<AttentionRow, Section> }) =>
      section.key === 'needsYou' && section.data.length === 0 ? (
        <EmptyState
          icon={<KindGlyph kind="finished" size={24} color={appearance.mutedGlyph} />}
          title={NotificationsCopy.emptyTitle}
          text={NotificationsCopy.emptyText}
          appearance={appearance}
          fill={false}
        />
      ) : null,
    [appearance],
  );

  const header = (
    <>
      {notices.map((notice) => (
        <View key={notice.key} accessibilityRole="alert" style={[styles.notice, { backgroundColor: appearance.card }]}>
          <CloudOffGlyph size={16} color={appearance.mutedGlyph} />
          <Text style={[styles.noticeText, { color: appearance.muted }]}>{notice.text}</Text>
        </View>
      ))}
      {failed ? (
        <Text accessibilityRole="alert" style={[styles.failed, { color: failedInk }]}>
          {NotificationsCopy.actionFailed}
        </Text>
      ) : null}
    </>
  );
  const empty =
    unreachable !== null ? (
      <EmptyState
        icon={<CloudOffGlyph size={32} color={appearance.mutedGlyph} />}
        title={NotificationsCopy.cantLoadTitle}
        text={NotificationsCopy.cantLoadText(unreachable)}
        appearance={appearance}
        fill
      />
    ) : (
      <Text style={[styles.loading, { color: appearance.muted }]}>{NotificationsCopy.loading}</Text>
    );

  return (
    <>
      <FoldListFrame fold={pane === undefined ? laptopFold : null}>
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          renderSectionFooter={renderSectionFooter}
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
        title={menu?.row.who ?? ''}
        subtitle={menu?.row.detail}
        items={menuItems}
        onClose={() => setMenu(null)}
        rowAnchor={menu?.frame}
        lifted={
          menu === null
            ? undefined
            : {
                content: (
                  <View style={styles.liftedRow}>
                    <RowContent row={menu.row} now={now} ink={inks.plain} />
                  </View>
                ),
                accessibilityLabel: rowLabel(menu.row, now),
                onPress: () => open(menu.row),
              }
        }
      />
      <EndedSheet row={endedRow} onClose={() => setEndedRow(null)} appearance={appearance} />
    </>
  );
}

function RowGap() {
  return <View style={styles.rowGap} />;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 12, paddingBottom: 28, flexGrow: 1 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
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
  rowEmphasis: {
    // The desktop bell's attention-blue wash and border on what waits for the user.
    backgroundColor: ATTENTION_ROW_WASH,
    borderColor: colorWithOpacity(SidebarPalette.ROW_ATTENTION, 38),
  },
  liftedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12 },
  tile: {
    width: 34,
    height: 34,
    borderRadius: GhostexRadii.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GhostexPalette.NEUTRAL_FILL,
  },
  text: { flex: 1, minWidth: 0, gap: 3 },
  firstLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  who: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '500' },
  whoStrong: { fontWeight: '700' },
  time: { fontSize: 12, fontVariant: ['tabular-nums'] },
  detail: { fontSize: 13, lineHeight: 18 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  kindStrong: { fontWeight: '600' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 24, paddingVertical: 20 },
  emptyFill: { flex: 1, minHeight: 260 },
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
  failed: { fontSize: 13, paddingHorizontal: 4, marginBottom: 8 },
  sheet: { gap: 10, paddingHorizontal: 4 },
  sheetTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  sheetText: { fontSize: 14, textAlign: 'center' },
  sheetButton: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetButtonText: { fontSize: 16, fontWeight: '600' },
});
