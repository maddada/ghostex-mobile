/**
 * What the working row's pills open (`ChatPills.tsx`): a coordinator's threads
 * (`coordinatorThreadsPanel`, desktop `coordinator_threads.rs`), the agent's task plan
 * (`agentTasksPanel`, desktop `agent_tasks.rs`) and the Subagents list (`agentFleetStrip`, desktop
 * `agent_fleet.rs`), each the body of the pill's sheet. Rows, labels, clocks, counters and the folds
 * come from the core; these only lay them out.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import { SidebarPalette } from '../../../theme/palette';
import { CoordinatorGlyph } from '../../../components/sessions/icons';
import { AgentMark } from './agentMark';
import { Glyph, type GlyphName } from './icons';
import { arr, asJson, isTrue, num, obj, str } from './json';
import { PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { PulseDot, Spinner } from './primitives';
import { remoteWorkerComputer, remoteWorkerNotice } from './remoteWorker';
import { ComputerIconGlyph } from '../../../components/sessions/ComputerIconGlyph';
import { useServerComputerDrawing } from '../transcript/mentionedSession';
import { showAlert } from '../../../components/common/dialog/alert';

/** A sheet's first line under its title: the panel's muted detail and an optional ornament. */
function MenuMeta({ meta, trailing }: { meta: string; trailing?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.menuMeta}>
      <Text style={styles.meta} numberOfLines={1}>
        {meta}
      </Text>
      {trailing}
    </View>
  );
}

/** The Tasks pill's sheet: what the Tasks panel above the composer showed. */
export function AgentTasksMenu({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const styles = useStyles();
  const panel = obj(document.agentTasksPanel);
  if (panel === null) return null;
  const percent = Math.max(0, Math.min(100, num(panel, 'percent') ?? 0));
  const nextStep = (num(panel, 'doneStep') ?? 0) + 1;
  const fold = str(panel, 'foldLabel');
  return (
    <View accessibilityLabel="Agent tasks" style={styles.menu}>
      <MenuMeta
        meta={str(panel, 'meta')}
        trailing={
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${percent}%` }]} />
          </View>
        }
      />
      <ScrollView style={styles.menuRows} contentContainerStyle={styles.rows} nestedScrollEnabled>
        {arr(panel.rows).map((row, index) => (
          <TaskRow key={str(row, 'id') || String(index)} row={row} />
        ))}
      </ScrollView>
      {/* The fold is a text line, not a button (a desktop user decision in agent_tasks.rs). */}
      {fold.length > 0 ? (
        <Text
          accessibilityRole="button"
          style={styles.fold}
          onPress={() => chat.dispatch({ type: 'toggleAgentTasksCompleted', step: nextStep })}
        >
          {fold}
        </Text>
      ) : null}
    </View>
  );
}

export function TaskRow({ row }: { row: unknown }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const group = str(row, 'group') || 'pending';
  const blocked = str(row, 'blockedLabel');
  return (
    <View accessibilityLabel={str(row, 'title')} style={styles.taskRow}>
      <View style={styles.taskMarker}>
        {group === 'in_progress' ? (
          <Spinner size={13} color={P.controlPrimary} />
        ) : group === 'completed' ? (
          <Glyph name="circle-check" size={13} color={P.primary} />
        ) : (
          <Glyph name="circle-dashed" size={13} color={P.muted} />
        )}
      </View>
      <Text style={[styles.taskSubject, group === 'completed' && styles.taskDone]} numberOfLines={1}>
        {str(row, 'subject')}
      </Text>
      {blocked.length > 0 ? <Text style={styles.blocked}>{blocked}</Text> : null}
    </View>
  );
}

/** The sidebar's working colour and the amber of the "Needs your approval" tag (desktop `coordinator_threads.rs`). */
const THREAD_WORKING = '#c68a06';
/** Calm blue-grey for threads paused on a usage limit (`HOLD_COLOR` on desktop). */
const THREAD_PAUSED = '#7fa1c4';
/**
 * A worker waiting for approval: its dot and its "Needs your approval" tag take the sidebar's red
 * approval dot, as the sheet's header does (desktop `coordinator_threads.rs`, the user's 2026-11-05
 * words there).
 */
const THREAD_APPROVAL = SidebarPalette.ROW_APPROVAL;

/**
 * The sidebar's colour for what a pill's sheet waits on (gx-chat-core `ChatPill.waiting`; the
 * Threads pill and this sheet's header): its red approval dot or its pink question dot (desktop
 * `chat_pills.rs` `waiting_color`).
 */
export function waitingColor(waiting: string): string | null {
  if (waiting === 'approval') return SidebarPalette.ROW_APPROVAL;
  if (waiting === 'question') return SidebarPalette.ROW_QUESTION;
  if (waiting === 'signIn' || waiting === 'usageLimit') return THREAD_WORKING;
  return null;
}

const NEEDS_APPROVAL_LABEL = 'Needs your approval';

/**
 * The Threads pill's sheet (`coordinatorThreadsPanel`, desktop `coordinator_threads.rs`): one list of
 * a coordinator's threads, working ones first. Order, labels and the steps ("Show recent", "N more")
 * come from the core; a row opens that thread through the `openCoordinatorThread` host action and
 * closes the sheet (`onDone`).
 */
export function CoordinatorThreadsMenu({
  chat,
  document,
  onDone,
}: {
  chat: RustChat;
  document: ChatDocument;
  onDone: () => void;
}) {
  const styles = useStyles();
  const panel = obj(document.coordinatorThreadsPanel);
  if (panel === null) return null;
  const moreLabel = str(panel, 'moreLabel');
  const moreStep = typeof panel.moreStep === 'number' ? panel.moreStep : 0;
  const emptyLabel = str(panel, 'emptyLabel');
  // The pill's waiting colour (ChatPills.tsx `waitingColor`): red for an approval, pink for a question.
  const headerWaiting = waitingColor(
    isTrue(panel, 'attention') ? 'approval' : isTrue(panel, 'question') ? 'question' : '',
  );
  return (
    <View accessibilityLabel="Coordinator workers" style={styles.menu}>
      <MenuMeta
        meta={str(panel, 'meta')}
        trailing={
          headerWaiting !== null ? <View style={[styles.threadDot, { backgroundColor: headerWaiting }]} /> : undefined
        }
      />
      <ScrollView style={styles.menuRows} contentContainerStyle={styles.rows} nestedScrollEnabled>
        {arr(panel.rows).map((row, index) => (
          <ThreadRow key={str(row, 'key') || String(index)} row={row} chat={chat} onDone={onDone} />
        ))}
        {emptyLabel.length > 0 ? <Text style={styles.threadsEmpty}>{emptyLabel}</Text> : null}
      </ScrollView>
      {moreLabel.length > 0 ? (
        <Text
          accessibilityRole="button"
          accessibilityLabel={
            moreStep === 0 ? 'Show fewer workers' : moreStep === 1 ? 'Show recent workers' : `Show ${moreLabel} workers`
          }
          style={styles.threadsFold}
          onPress={() => chat.dispatch({ type: 'toggleCoordinatorThreadsMore', step: moreStep })}
        >
          {moreLabel}
        </Text>
      ) : null}
    </View>
  );
}

function ThreadRow({ row, chat, onDone }: { row: unknown; chat: RustChat; onDone: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const title = str(row, 'title');
  // Two lines, as on the desktop: the title line (with its work item refs) and the stats line, in
  // place of its newest chat words (gx-chat-core `RowStat`, CDXC:Coordinators 2026-11-18: "no need
  // for the last message to be sent here at all"; Q3974, the phone follows the desktop). Its work
  // item's Now line shows on a long press, the phone's hover ("i want all workers to be 2 lines
  // always", the desktop's coordinator_threads.rs); a tap still opens the worker.
  const nowLine = str(row, 'nowLine');
  const [nowShown, setNowShown] = useState(false);
  const [itemShown, setItemShown] = useState<string | null>(null);
  const openItem = arr(obj(row)?.items).find((item) => str(item, 'ref') === itemShown) ?? null;
  const branch = str(row, 'branch');
  // A worker on another computer: the phone cannot open it, so a tap says where it runs.
  const computer = remoteWorkerComputer(row);
  const status = str(row, 'status');
  const isPaused = status === 'paused' && !isTrue(row, 'working') && !isTrue(row, 'needsApproval');
  const showApprovalTag = !isPaused && isTrue(row, 'needsApproval');
  const openThread = () => {
    if (computer !== null) {
      const notice = remoteWorkerNotice(computer);
      showAlert(notice.title, notice.message);
      return;
    }
    chat.dispatch({
      type: 'openCoordinatorThread',
      projectId: str(row, 'projectId'),
      sessionId: str(row, 'sessionId'),
    });
    onDone();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={computer !== null ? `Worker ${title}, runs on ${computer}` : `Open worker ${title}`}
      accessibilityHint={nowLine.length > 0 ? 'Long press to show where its work item stands' : undefined}
      onPress={openThread}
      onLongPress={nowLine.length > 0 ? () => setNowShown((was) => !was) : undefined}
      style={styles.threadRow}
    >
      <View style={styles.taskMarker}>
        {status === 'working' || isTrue(row, 'working') ? (
          <View style={[styles.threadDot, { backgroundColor: THREAD_WORKING }]} />
        ) : status === 'approval' || (!isPaused && isTrue(row, 'needsApproval')) ? (
          <View style={[styles.threadDot, { backgroundColor: THREAD_APPROVAL }]} />
        ) : status === 'question' ? (
          <View style={[styles.threadDot, { backgroundColor: SidebarPalette.ROW_QUESTION }]} />
        ) : isPaused ? (
          <Glyph name="player-pause" size={12} color={THREAD_PAUSED} />
        ) : (
          <Glyph name="circle-check" size={12} color={P.muted} />
        )}
      </View>
      <View style={styles.threadText}>
        <View style={styles.threadTitleLine}>
          <WorkerPill row={row} title={title} remote={computer !== null} />
          {showApprovalTag ? (
            <Text style={styles.approvalTag}>{NEEDS_APPROVAL_LABEL}</Text>
          ) : null}
          <WorkItemRefs row={row} shown={itemShown} onToggle={setItemShown} />
        </View>
        <ThreadStats row={row} branch={branch} hideApprovalStat={showApprovalTag} />
        {nowShown && nowLine.length > 0 ? (
          <View style={[styles.itemCard, styles.rowCard]}>
            <Text style={styles.itemCardText}>{nowLine}</Text>
          </View>
        ) : null}
        {openItem !== null ? (
          <View style={styles.rowCard}>
            <WorkItemCard item={openItem} chat={chat} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The icon of a Workers row's stats piece (desktop `coordinator_threads.rs` `stat_icon`). */
const STAT_GLYPHS: Record<string, GlyphName> = {
  reading: 'file-search',
  web: 'world',
  editing: 'pencil-code',
  building: 'package',
  testing: 'test-pipe',
  command: 'terminal-2',
  agent: 'robot',
  planning: 'list-check',
  thinking: 'bulb',
  approval: 'shield-check',
  question: 'help-circle',
  signIn: 'alert-triangle',
  usageLimit: 'clock',
  waitingReset: 'clock',
  stalled: 'alert-circle',
  untested: 'flask',
  delivered: 'mail-check',
  finished: 'circle-check',
  files: 'pencil',
};

/**
 * "Building · 46 tool calls · 3 files": the row's phase in its muted text, then its turn's counts
 * in the quieter grey, each after its icon, and the worktree branch when it has one.
 */
function ThreadStats({
  row,
  branch,
  hideApprovalStat = false,
}: {
  row: unknown;
  branch: string;
  hideApprovalStat?: boolean;
}) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  const stats = arr(obj(row)?.stats).filter(
    (stat) => !(hideApprovalStat && str(stat, 'kind') === 'approval'),
  );
  if (stats.length === 0 && branch.length === 0) return null;
  return (
    <View style={styles.statsLine}>
      {stats.map((stat, index) => {
        const kind = str(stat, 'kind');
        const iconColor =
          kind === 'stalled' ? THREAD_WORKING : kind === 'delivered' ? '#2fa865' : theme.muted;
        return (
          <View key={`${kind}-${index}`} style={[styles.stat, index === 0 && styles.statPhase]}>
            <Glyph name={STAT_GLYPHS[kind] ?? 'tool'} size={12} color={iconColor} />
            <Text style={index === 0 ? styles.statPhaseText : styles.statText} numberOfLines={1}>
              {str(stat, 'label')}
            </Text>
          </View>
        );
      })}
      {branch.length > 0 ? (
        <Text style={[styles.statText, styles.statBranch]} numberOfLines={1}>
          {branch}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A worker's name as the session pill a mention draws (`SessionPill`): its agent's logo when the core
 * names it, its title, and the computer's icon for a worker on another computer (the name is in the
 * row's label and the notice a tap gives). The row's own dot left of it is its state, so the pill
 * has none.
 *
 * CDXC:SessionChat 2026-11-13 DECISION: User, answering the session-mention design page: Q3063 "the same look spreads to message cards and the Workers popover, where they name a session", and Q3060's "for a session on another computer, show only that computer's icon, not its whole name". Supersedes the plain title followed by the computer's name.
 */
function WorkerPill({ row, title, remote }: { row: unknown; title: string; remote: boolean }) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  const icon = str(row, 'agentIcon');
  const coordinator = isTrue(row, 'coordinator');
  // That computer's own icon (CDXC:SessionChat 2026-11-14, `SessionPill`).
  const computerDrawing = useServerComputerDrawing(remote ? str(row, 'serverId') : '');
  return (
    <View style={styles.workerPill}>
      {coordinator ? (
        <CoordinatorGlyph size={12} color={theme.light ? '#000000' : SidebarPalette.ROW_COORDINATOR_CROWN} />
      ) : icon.length > 0 ? (
        <AgentMark icon={icon} size={12} />
      ) : null}
      <Text style={styles.threadTitle} numberOfLines={1}>
        {title}
      </Text>
      {remote ? <ComputerIconGlyph drawing={computerDrawing} size={11} color={theme.muted} /> : null}
    </View>
  );
}

/**
 * A worker row's work items (gx-chat-core `coordinator_threads.rs` `attach_items`, where the user's
 * decision lives, CDXC:Coordinators 2026-11-13): a ref per item after the worker's name, two then
 * "+N", the finished ones dimmed, as the desktop draws them. A tap shows the item's card under the
 * row (Q3022), whose Show in Work opens the Work sheet at it (`jumpToWorkCard`; NativeChatScreen
 * turns the focus into the sheet). They sat on a line of their own under the row until every row
 * became two lines (CDXC:Coordinators 2026-11-18). A thread on no item shows nothing.
 */
function WorkItemRefs({
  row,
  shown,
  onToggle,
}: {
  row: unknown;
  shown: string | null;
  onToggle: (reference: string | null) => void;
}) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  const items = arr(obj(row)?.items);
  if (items.length === 0) return null;
  const more = str(row, 'moreItems');
  return (
    <View style={styles.itemsLine}>
      {items.map((item) => {
        const reference = str(item, 'ref');
        return (
          <Pressable
            key={reference}
            accessibilityRole="button"
            accessibilityLabel={`${reference} ${str(item, 'title')}, show its card`}
            accessibilityState={{ expanded: shown === reference }}
            onPress={() => onToggle(shown === reference ? null : reference)}
            hitSlop={6}
            style={[
              styles.itemRefPill,
              shown === reference ? styles.itemPillOpen : null,
              isTrue(item, 'done') ? styles.itemPillDone : null,
            ]}
          >
            <Glyph name="layout-board-split" size={12} color={theme.reference.board} />
            <Text style={styles.itemRefText}>{reference}</Text>
          </Pressable>
        );
      })}
      {more.length > 0 ? (
        <Text style={styles.itemMore} accessibilityLabel={str(row, 'moreItemsTooltip')}>
          {more}
        </Text>
      ) : null}
    </View>
  );
}

/** A work item pill's card: its title, status and steps, where it stands, its open asks and the thread's last report. */
function WorkItemCard({ item, chat }: { item: unknown; chat: RustChat }) {
  const styles = useStyles();
  const status = [str(item, 'statusLabel'), str(item, 'steps')].filter((part) => part.length > 0).join(' · ');
  const now = str(item, 'now');
  const report = str(item, 'report');
  const command = obj(item)?.command;
  return (
    <View style={styles.itemCard}>
      <Text style={styles.itemCardTitle}>
        <Text style={styles.itemRef}>{str(item, 'ref')} </Text>
        {str(item, 'title')}
      </Text>
      {status.length > 0 ? <Text style={styles.itemCardMuted}>{status}</Text> : null}
      {now.length > 0 ? <Text style={styles.itemCardText}>{now}</Text> : null}
      {arr(obj(item)?.asks).map((ask, index) => (
        <Text key={str(ask, 'tag') || String(index)} style={styles.itemCardText}>
          {str(ask, 'tag').length > 0 ? <Text style={styles.itemCardMuted}>{str(ask, 'tag')} </Text> : null}
          {str(ask, 'text')}
        </Text>
      ))}
      {report.length > 0 ? (
        <Text style={styles.itemCardText}>
          <Text style={styles.itemCardMuted}>Last report · </Text>
          {report}
        </Text>
      ) : null}
      {obj(command) !== null ? (
        <Text
          accessibilityRole="button"
          style={styles.itemCardAction}
          onPress={() => chat.dispatch(command as UserAction)}
        >
          Show in Work
        </Text>
      ) : null}
    </View>
  );
}

/** The `openSubagent` action a fleet row's links send; a self row is plain text. */
export function subagentOpenAction(target: unknown): UserAction | null {
  const value = obj(target);
  if (value === null || value.self === true) return null;
  const selector = str(value, 'selector');
  if (selector.length === 0) return null;
  return {
    type: 'openSubagent',
    selector,
    name: asJson(value.name),
    agentType: asJson(value.agentType),
    task: asJson(value.task),
    model: asJson(value.model),
    effort: asJson(value.effort),
  } as UserAction;
}

/**
 * The Subagents pill's sheet: what the Subagents strip above the composer listed. A row's link hands its
 * `openSubagent` to the sheet's owner (`onOpen`), which closes the sheet and opens the subagent's
 * transcript once the sheet's modal has gone (`PillMenuSheet`).
 */
export function AgentFleetMenu({ document, onOpen }: { document: ChatDocument; onOpen: (action: UserAction) => void }) {
  const styles = useStyles();
  const strip = obj(document.agentFleetStrip);
  if (strip === null) return null;
  const stale = isTrue(strip, 'stale');
  const rows = arr(strip.rows);
  // Every task starts at the same x whatever the names above it are (desktop measures the widest
  // label; this estimates it from the medium glyph width, 7pt at 12pt scaled to the chat's text size),
  // capped at 140pt at that size.
  const nameWidth = Math.min(
    140 * (PROSE_SIZE / 12),
    Math.max(...rows.map((row) => str(row, 'modelLabel').length), 1) * 7 * (PROSE_SIZE / 12) + 2,
  );
  return (
    <View accessibilityLabel="Subagents" style={styles.menu}>
      <MenuMeta meta={str(strip, 'countLabel')} />
      {stale ? (
        <Text accessibilityRole="text" style={styles.stale}>
          Subagent status unavailable
        </Text>
      ) : null}
      <ScrollView style={styles.menuRows} contentContainerStyle={styles.rows} nestedScrollEnabled>
        {rows.map((row, index) => (
          <FleetRow key={str(row, 'key') || String(index)} row={row} nameWidth={nameWidth} onOpen={onOpen} />
        ))}
      </ScrollView>
    </View>
  );
}

function FleetRow({
  row,
  nameWidth,
  onOpen,
}: {
  row: unknown;
  nameWidth: number;
  onOpen: (action: UserAction) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const open = subagentOpenAction(row);
  const working = isTrue(row, 'working');
  const status = str(row, 'statusText');
  // "Done" or "Idle" from the core, empty while the child works or the roster is stale.
  const state = str(row, 'stateLabel');
  const nested = num(row, 'nested') ?? 0;
  const press = open === null ? undefined : () => onOpen(open);
  return (
    <View style={styles.fleetRow}>
      <PulseDot size={6} color={working ? P.controlPrimary : P.mutedInk(0.5)} active={working} />
      <Text
        style={[styles.fleetName, { width: nameWidth }]}
        numberOfLines={1}
        onPress={press}
        accessibilityRole={press ? 'link' : undefined}
        accessibilityLabel={press ? `View ${str(row, 'modelLabel')}'s transcript` : undefined}
      >
        {str(row, 'modelLabel')}
      </Text>
      <View style={styles.fleetWork}>
        {/* The separator leads the status cell so it aligns across rows (agent_fleet.rs). */}
        {isTrue(row, 'marker') ? <Text style={styles.fleetMarker}>‣</Text> : null}
        {state.length > 0 ? <Text style={styles.fleetIdle}>{state}</Text> : null}
        {status.length > 0 ? (
          <Text style={styles.fleetStatus} numberOfLines={1} onPress={press}>
            {status}
          </Text>
        ) : null}
        {nested > 0 ? (
          <Text style={styles.nested} accessibilityLabel={str(row, 'nestedTitle')}>
            {`+${nested}`}
          </Text>
        ) : null}
      </View>
      <Text style={styles.hint}>{str(row, 'tokens')}</Text>
      <Text style={styles.hint}>{str(row, 'separator')}</Text>
      <Text style={styles.hint}>{str(row, 'elapsedLabel')}</Text>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  /** A sheet's body under its title row (`Sheet`), the rows taking what the sheet's height leaves. */
  menu: {
    flexShrink: 1,
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  menuMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuRows: {
    flexShrink: 1,
  },
  /** The header's muted detail, the title's size (desktop `panel_card.rs`). */
  meta: {
    flex: 1,
    minWidth: 0,
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  bar: {
    alignSelf: 'center',
    width: 48,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: P.ink(0.1),
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: P.controlPrimary,
  },
  rows: {
    gap: 6,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskMarker: {
    width: 13,
    height: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskSubject: {
    flexShrink: 1,
    color: P.prose,
    fontSize: PROSE_SIZE,
  },
  taskDone: {
    color: P.cardMuted,
    textDecorationLine: 'line-through',
  },
  blocked: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
  },
  fold: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  stale: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  fleetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fleetName: {
    color: P.foreground,
    fontSize: PROSE_SIZE,
    fontWeight: '500',
  },
  fleetWork: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fleetMarker: {
    color: P.prose,
    fontSize: PROSE_SIZE,
  },
  fleetIdle: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  fleetStatus: {
    flexShrink: 1,
    color: P.prose,
    fontSize: PROSE_SIZE,
  },
  nested: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: P.ink(0.08),
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
    fontVariant: ['tabular-nums'],
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  threadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  threadText: {
    flex: 1,
    minWidth: 0,
  },
  threadTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  /** A worker's name as a session pill (`WorkerPill`, `SessionPill`'s frame). */
  workerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: 4,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: P.ink(0.14),
    backgroundColor: P.ink(0.03),
  },
  threadTitle: {
    flexShrink: 1,
    color: P.foreground,
    fontSize: PROSE_SIZE - 1,
    fontWeight: '500',
  },
  /** A worker's stats line (`ThreadStats`): the phase, then the counts. */
  statsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    overflow: 'hidden',
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  statPhase: {
    flexShrink: 1,
    minWidth: 0,
  },
  statPhaseText: {
    flexShrink: 1,
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
  },
  statText: {
    color: P.muted,
    fontSize: PROSE_SIZE - 2,
  },
  statBranch: {
    flexShrink: 1,
  },
  /** A ref after the worker's name (`WorkItemRefs`): the board icon and "W645", as on the desktop. */
  itemRefPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 22,
    paddingHorizontal: 3,
    borderRadius: 5,
  },
  itemRefText: {
    color: P.muted,
    fontSize: PROSE_SIZE - 2,
  },
  /** The card a long press (the Now line) or a ref's tap opens under the row. */
  rowCard: {
    marginTop: 6,
  },
  /** A worker's work item refs on its title line, and the card a tap opens (desktop `item_refs`). */
  itemsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 2,
  },
  itemPillOpen: {
    backgroundColor: P.ink(0.08),
  },
  itemPillDone: {
    opacity: 0.55,
  },
  itemRef: {
    color: P.foreground,
    fontSize: PROSE_SIZE - 2,
    fontWeight: '600',
  },
  itemMore: {
    color: P.muted,
    fontSize: PROSE_SIZE - 2,
  },
  itemCard: {
    gap: 4,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.cardPanel,
  },
  itemCardTitle: {
    color: P.foreground,
    fontSize: PROSE_SIZE - 1,
    fontWeight: '600',
  },
  itemCardText: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
  },
  itemCardMuted: {
    color: P.muted,
    fontSize: PROSE_SIZE - 2,
  },
  itemCardAction: {
    alignSelf: 'flex-start',
    marginTop: 2,
    color: P.foreground,
    fontSize: PROSE_SIZE - 1,
    fontWeight: '600',
  },
  /** The Threads sheet's "N more" step and empty line, the summary line's size. */
  threadsFold: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  threadsEmpty: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  approvalTag: {
    paddingHorizontal: 5,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    color: THREAD_APPROVAL,
    fontSize: PROSE_SIZE - 2,
  },
}));
