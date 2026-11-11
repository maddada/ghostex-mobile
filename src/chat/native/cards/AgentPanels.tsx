/**
 * What the working row's pills open (`ChatPills.tsx`): a coordinator's threads
 * (`coordinatorThreadsPanel`, desktop `coordinator_threads.rs`), the agent's task plan
 * (`agentTasksPanel`, desktop `agent_tasks.rs`) and the Subagents list (`agentFleetStrip`, desktop
 * `agent_fleet.rs`), each the body of the pill's sheet. Rows, labels, clocks, counters and the folds
 * come from the core; these only lay them out.
 */

import type { ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import { SidebarPalette } from '../../../theme/palette';
import { Glyph } from './icons';
import { arr, asJson, isTrue, num, obj, str } from './json';
import { PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { PulseDot, Spinner } from './primitives';
import { remoteWorkerComputer, remoteWorkerNotice } from './remoteWorker';

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
          <Glyph name="circle-check-filled" size={13} color={P.primary} />
        ) : (
          <View style={styles.pendingRing} />
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
  const title = str(row, 'title');
  const detail = str(row, 'detail');
  const branch = str(row, 'branch');
  // A worker on another computer: the phone cannot open it, so a tap says where it runs.
  const computer = remoteWorkerComputer(row);
  const openThread = () => {
    if (computer !== null) {
      const notice = remoteWorkerNotice(computer);
      Alert.alert(notice.title, notice.message);
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
      onPress={openThread}
      style={styles.threadRow}
    >
      <View style={styles.taskMarker}>
        {isTrue(row, 'working') ? (
          <View style={[styles.threadDot, { backgroundColor: THREAD_WORKING }]} />
        ) : isTrue(row, 'needsApproval') ? (
          <View style={[styles.threadDot, { backgroundColor: THREAD_APPROVAL }]} />
        ) : (
          <View style={styles.pendingRing} />
        )}
      </View>
      <View style={styles.threadText}>
        <View style={styles.threadTitleLine}>
          <Text style={styles.threadTitle} numberOfLines={1}>
            {title}
          </Text>
          {isTrue(row, 'needsApproval') ? <Text style={styles.approvalTag}>{NEEDS_APPROVAL_LABEL}</Text> : null}
          {computer !== null ? (
            <Text style={styles.threadComputer} numberOfLines={1}>
              {computer}
            </Text>
          ) : null}
        </View>
        {detail.length > 0 || branch.length > 0 ? (
          <Text style={styles.threadDetail} numberOfLines={1}>
            {[detail, branch].filter((part) => part.length > 0).join(' · ')}
          </Text>
        ) : null}
      </View>
    </Pressable>
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
          <FleetRow
            key={str(row, 'key') || String(index)}
            row={row}
            nameWidth={nameWidth}
            onOpen={onOpen}
          />
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
  pendingRing: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: P.mutedInk(0.7),
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
  threadTitle: {
    flexShrink: 1,
    color: P.foreground,
    fontSize: PROSE_SIZE,
  },
  /** The computer a worker on another computer runs on, after its title: muted, like the branch. */
  threadComputer: {
    flexShrink: 0,
    maxWidth: 120,
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
  },
  /** One line under the title: muted, a step under it so the title still leads. */
  threadDetail: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
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
