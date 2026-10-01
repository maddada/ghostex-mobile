/**
 * The two panels pinned above the composer: the agent's task plan (`agentTasksPanel`, desktop
 * `agent_tasks.rs`) and the Subagents strip (`agentFleetStrip`, desktop `agent_fleet.rs`). Rows,
 * labels, clocks, counters and both folds come from the core; the panels only lay them out.
 */

import { Pressable, ScrollView, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import { useSettingsStore } from '../../../settings/store';
import { Glyph } from './icons';
import { arr, asJson, isTrue, num, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { CardHeader, PulseDot, Spinner, StatusCard } from './primitives';

export function AgentTasksPanel({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const styles = useStyles();
  const panel = obj(document.agentTasksPanel);
  if (panel === null) return null;
  const open = panel.collapsed !== true;
  const percent = Math.max(0, Math.min(100, num(panel, 'percent') ?? 0));
  const expanded = isTrue(panel, 'showCompleted');
  const fold = str(panel, 'foldLabel');
  const header = (
    <CardHeader
      icon="list-check"
      title="Tasks"
      titleAddon={
        <Text style={styles.meta} numberOfLines={1}>
          {str(panel, 'meta')}
        </Text>
      }
      trailing={
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${percent}%` }]} />
        </View>
      }
      chevron={open ? 'open' : 'closed'}
      hasBody={open}
      accessibilityLabel={open ? 'Hide tasks' : 'Show tasks'}
      onPress={() => chat.dispatch({ type: 'toggleAgentTasks', open: !open })}
    />
  );
  const body = open
    ? [
        <ScrollView key="rows" style={styles.taskRows} contentContainerStyle={styles.rows} nestedScrollEnabled>
          {arr(panel.rows).map((row, index) => (
            <TaskRow key={str(row, 'id') || String(index)} row={row} />
          ))}
        </ScrollView>,
        // The fold is a text line, not a button (a desktop user decision in agent_tasks.rs).
        fold.length > 0 ? (
          <Text
            key="fold"
            accessibilityRole="button"
            style={styles.fold}
            onPress={() => chat.dispatch({ type: 'toggleAgentTasksCompleted', expanded: !expanded })}
          >
            {fold}
          </Text>
        ) : null,
      ]
    : [];
  return (
    <View accessibilityLabel="Agent tasks" style={styles.fill}>
      <StatusCard header={header} body={body} />
    </View>
  );
}

function TaskRow({ row }: { row: unknown }) {
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

/** The sidebar's colours for a thread that waits on someone and one that works (desktop `coordinator_threads.rs`). */
const THREAD_WAITING = '#95d7f6';
const THREAD_WORKING = '#c68a06';

/**
 * A coordinator's Threads panel (`coordinatorThreadsPanel`, desktop `coordinator_threads.rs`): its
 * threads grouped by what they need. Groups, labels and the done fold come from the core; a row
 * opens that thread through the `openCoordinatorThread` host action.
 */
export function CoordinatorThreadsPanel({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const styles = useStyles();
  const panel = obj(document.coordinatorThreadsPanel);
  if (panel === null) return null;
  const open = panel.collapsed !== true;
  const showDone = isTrue(panel, 'showDone');
  const doneLabel = str(panel, 'doneLabel');
  const header = (
    <CardHeader
      icon="users"
      title="Threads"
      titleAddon={
        <Text style={styles.meta} numberOfLines={1}>
          {str(panel, 'meta')}
        </Text>
      }
      trailing={isTrue(panel, 'attention') ? <View style={[styles.threadDot, { backgroundColor: THREAD_WAITING }]} /> : undefined}
      chevron={open ? 'open' : 'closed'}
      hasBody={open}
      accessibilityLabel={open ? 'Hide threads' : 'Show threads'}
      onPress={() => chat.dispatch({ type: 'toggleCoordinatorThreads', open: !open })}
    />
  );
  const body = open
    ? [
        <ScrollView key="rows" style={styles.threadRows} contentContainerStyle={styles.rows} nestedScrollEnabled>
          {arr(panel.groups).map((group, groupIndex) => (
            <View key={str(group, 'state') || String(groupIndex)} style={styles.rows}>
              <Text style={styles.threadGroup}>{str(group, 'label').toUpperCase()}</Text>
              {arr(obj(group)?.rows).map((row, index) => (
                <ThreadRow key={str(row, 'key') || String(index)} row={row} chat={chat} />
              ))}
            </View>
          ))}
        </ScrollView>,
        doneLabel.length > 0 ? (
          <Text
            key="done"
            accessibilityRole="button"
            style={styles.fold}
            onPress={() => chat.dispatch({ type: 'toggleCoordinatorThreadsDone', expanded: !showDone })}
          >
            {doneLabel}
          </Text>
        ) : null,
      ]
    : [];
  return (
    <View accessibilityLabel="Coordinator threads" style={styles.fill}>
      <StatusCard header={header} body={body} />
    </View>
  );
}

function ThreadRow({ row, chat }: { row: unknown; chat: RustChat }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const state = str(row, 'state') || 'finished';
  const title = str(row, 'title');
  const detail = str(row, 'detail');
  const branch = str(row, 'branch');
  const openThread = () =>
    chat.dispatch({
      type: 'openCoordinatorThread',
      projectId: str(row, 'projectId'),
      sessionId: str(row, 'sessionId'),
      lifecycleState: str(row, 'lifecycleState'),
    });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open thread ${title}`} onPress={openThread} style={styles.threadRow}>
      <View style={styles.taskMarker}>
        {state === 'waiting' || state === 'working' ? (
          <View style={[styles.threadDot, { backgroundColor: state === 'waiting' ? THREAD_WAITING : THREAD_WORKING }]} />
        ) : state === 'finished' ? (
          <Glyph name="check" size={13} color={P.primary} />
        ) : state === 'done' ? (
          <Glyph name="circle-check-filled" size={13} color={P.muted} />
        ) : (
          <View style={styles.pendingRing} />
        )}
      </View>
      <View style={styles.threadText}>
        <Text style={[styles.threadTitle, state === 'done' && styles.taskDone]} numberOfLines={1}>
          {title}
        </Text>
        {detail.length > 0 || branch.length > 0 ? (
          <Text style={styles.blocked} numberOfLines={1}>
            {[detail, branch].filter((part) => part.length > 0).join(' · ')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The fleet card's fold: the user's last choice, else expanded unless Simple mode (desktop `agent_fleet.rs`). */
function fleetOpen(strip: Record<string, unknown>, simple: boolean): boolean {
  return typeof strip.openOverride === 'boolean' ? strip.openOverride : !simple;
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

export function AgentFleetStrip({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const styles = useStyles();
  const simple = useSettingsStore((store) => store.settings.sessionChatSimpleMode);
  const strip = obj(document.agentFleetStrip);
  if (strip === null) return null;
  const stale = isTrue(strip, 'stale');
  const open = fleetOpen(strip, simple);
  const rows = arr(strip.rows);
  // Every task starts at the same x whatever the names above it are (desktop measures the widest
  // label; this estimates it from the 12pt medium glyph width), capped at 140pt.
  const nameWidth = Math.min(140, Math.max(...rows.map((row) => str(row, 'modelLabel').length), 1) * 7 + 2);
  const header = (
    <CardHeader
      icon="users"
      // "Subagents", without a hyphen or all caps (a desktop user decision in agent_fleet.rs).
      title="Subagents"
      titleAddon={
        <Text style={styles.meta} numberOfLines={1}>
          {str(strip, 'countLabel')}
        </Text>
      }
      chevron={open ? 'open' : 'closed'}
      hasBody={open}
      accessibilityLabel={open ? 'Minimize subagents' : 'Expand subagents'}
      onPress={() => chat.dispatch({ type: 'toggleAgentFleet', open: !open })}
    />
  );
  const body = open
    ? [
        stale ? (
          <Text key="stale" accessibilityRole="text" style={styles.stale}>
            Subagent status unavailable
          </Text>
        ) : null,
        <ScrollView key="rows" style={styles.fleetRows} contentContainerStyle={styles.rows} nestedScrollEnabled>
          {rows.map((row, index) => (
            <FleetRow key={str(row, 'key') || String(index)} row={row} stale={stale} chat={chat} nameWidth={nameWidth} />
          ))}
        </ScrollView>,
      ]
    : [];
  return (
    <View accessibilityLabel="Subagents" style={styles.fill}>
      <StatusCard header={header} body={body} />
    </View>
  );
}

function FleetRow({ row, stale, chat, nameWidth }: { row: unknown; stale: boolean; chat: RustChat; nameWidth: number }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const open = subagentOpenAction(row);
  const working = isTrue(row, 'working');
  const status = str(row, 'statusText');
  const nested = num(row, 'nested') ?? 0;
  const press = open === null ? undefined : () => chat.dispatch(open);
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
        {isTrue(row, 'idle') && !stale ? <Text style={styles.fleetIdle}>Idle</Text> : null}
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
  fill: {
    width: '100%',
  },
  meta: {
    flex: 1,
    minWidth: 0,
    color: P.cardMuted,
    fontSize: 12,
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
  taskRows: {
    maxHeight: 220,
  },
  fleetRows: {
    maxHeight: 180,
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
    fontSize: 12,
  },
  taskDone: {
    color: P.cardMuted,
    textDecorationLine: 'line-through',
  },
  blocked: {
    color: P.cardMuted,
    fontSize: 11,
  },
  fold: {
    color: P.cardMuted,
    fontSize: 12,
  },
  stale: {
    color: P.cardMuted,
    fontSize: 12,
  },
  fleetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fleetName: {
    color: P.foreground,
    fontSize: 12,
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
    fontSize: 12,
  },
  fleetIdle: {
    color: P.cardMuted,
    fontSize: 12,
  },
  fleetStatus: {
    flexShrink: 1,
    color: P.prose,
    fontSize: 12,
  },
  nested: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: P.ink(0.08),
    color: P.cardMuted,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    color: P.cardMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  threadRows: {
    maxHeight: 240,
  },
  threadGroup: {
    paddingTop: 4,
    color: P.cardMuted,
    fontSize: 10.5,
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
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
  threadTitle: {
    color: P.foreground,
    fontSize: 12,
  },
}));
