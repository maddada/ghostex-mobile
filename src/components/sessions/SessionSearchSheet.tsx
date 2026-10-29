/**
 * Session search: the phone's counterpart of the desktop's Sessions search
 * (Quick Access, Sessions tab). A panel over the Sessions list with an
 * autofocused field and the matching sessions of every visible computer, open
 * and closed, newest first under day headings; each row shows the session's
 * tag or agent glyph, its title, its project, how long ago it was used (or
 * closed), and a dot: lit while awake, dim while asleep, a ring when closed.
 * Tapping an open row (or the keyboard's search key, which opens the first
 * row, as Enter does on the desktop) opens it the way tapping it in the list
 * does; tapping a closed row brings it back on its computer first. The
 * matching rules live in src/sessions/sessionSearch.ts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import { agentIconTint, resolveAgentArtId, type GhostexSession } from '../../contract/mobileSummary';
import { resolveSessionTag } from '../../contract/sessionTags';
import { SessionSearchCopy } from '../../copy';
import { useInventoryStore } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import { fetchClosedSessions } from '../../sessions/closedSessions';
import {
  searchSessions,
  sessionSearchRelativeTime,
  type ClosedSession,
  type SessionSearchRow,
  type SessionSearchSource,
} from '../../sessions/sessionSearch';
import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import { useKeyboardTop } from '../common/keyboard/keyboardFrame';
import KeyboardAvoidingContainer from '../common/keyboard/KeyboardAvoidingContainer';
import { ChevronLeftGlyph, SearchGlyph, XGlyph } from './icons';

export type SessionSearchSheetProps = {
  visible: boolean;
  /** The computers the Sessions list shows (hidden ones are never searched). */
  machines: readonly MachineRecord[];
  onOpen: (machine: MachineRecord, session: GhostexSession) => void;
  /** Bring a closed session back and open it; rejects with the message to show when it cannot. */
  onRestore: (machine: MachineRecord, session: ClosedSession) => Promise<void>;
  onClose: () => void;
};

/** Desktop Quick Access dark palette (apps/desktop/src/app/window/quick_access/palette.rs). */
const ROW_SELECTED = 'rgba(255,255,255,0.075)';
const GLYPH_TILE = 'rgba(255,255,255,0.07)';
const STATUS_DOT = 'rgba(255,255,255,0.20)';
const STATUS_DOT_OPEN = '#FFFFFF';
/** Each keystroke would be an SSH round trip per computer; wait for a pause in typing. */
const CLOSED_QUERY_DEBOUNCE_MS = 300;

export default function SessionSearchSheet({ visible, machines, onOpen, onRestore, onClose }: SessionSearchSheetProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInputInstance | null>(null);
  const [query, setQuery] = useState('');
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
  // The navigation bar's inset is under the keyboard while it is open; the panel ends right on top of it.
  const bottomInset = useKeyboardTop() === null ? insets.bottom : 0;
  const [closedByMachine, setClosedByMachine] = useState<Record<string, ClosedSession[]>>({});
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedFailures, setClosedFailures] = useState<string[]>([]);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const closedGeneration = useRef(0);

  // The computers that answered the inventory: only those can be reached for closed sessions too.
  const reporting = useMemo(
    () => (visible ? machines.filter((machine) => inventoriesByMachineId[machine.id]?.summary != null) : []),
    [visible, machines, inventoriesByMachineId],
  );
  const reportingIds = reporting.map((machine) => machine.id).join('\n');

  useEffect(() => {
    if (!visible) {
      closedGeneration.current += 1;
      setClosedByMachine({});
      setClosedFailures([]);
      setClosedLoading(false);
      return undefined;
    }
    const generation = ++closedGeneration.current;
    setClosedLoading(true);
    const timer = setTimeout(() => {
      const nowMs = Date.now();
      void Promise.all(
        reporting.map(async (machine) => {
          try {
            return { machine, sessions: await fetchClosedSessions(machine, query, nowMs) };
          } catch {
            return { machine, sessions: null };
          }
        }),
      ).then((answers) => {
        if (generation !== closedGeneration.current) return;
        const next: Record<string, ClosedSession[]> = {};
        const failures: string[] = [];
        for (const { machine, sessions } of answers) {
          if (sessions === null) failures.push(machineDisplayLabel(machine));
          else next[machine.id] = sessions;
        }
        setClosedByMachine(next);
        setClosedFailures(failures);
        setClosedLoading(false);
      });
    }, CLOSED_QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `reporting` changes on every inventory poll; refetch only when the computers or the query change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, query, reportingIds]);

  const sources = useMemo((): SessionSearchSource[] => {
    // The phone lists one computer at a time, so a result names its computer once there are several.
    const nameMachines = reporting.length > 1;
    return reporting.flatMap((machine) => {
      const summary = inventoriesByMachineId[machine.id]?.summary;
      if (summary == null) return [];
      return [
        {
          machineId: machine.id,
          machineLabel: nameMachines ? machineDisplayLabel(machine) : '',
          customSessionTags: summary.customSessionTags,
          open: summary.sessions.map((session) => ({
            session,
            projectLabel: session.projectName.trim(),
          })),
          closed: closedByMachine[machine.id] ?? [],
        },
      ];
    });
  }, [reporting, inventoriesByMachineId, closedByMachine]);

  const nowMs = Date.now();
  const groups = useMemo(() => searchSessions(sources, query, Date.now()), [sources, query]);
  const sections = useMemo(() => groups.map((group) => ({ title: group.heading, data: group.rows })), [groups]);
  const firstKey = groups[0]?.rows[0]?.key;

  const close = (): void => {
    if (restoringKey !== null) return;
    setQuery('');
    setRestoreError(null);
    onClose();
  };

  const open = (row: SessionSearchRow): void => {
    if (restoringKey !== null) return;
    const machine = machines.find((entry) => entry.id === row.machineId);
    if (machine === undefined) return;
    if (row.kind === 'open') {
      setQuery('');
      setRestoreError(null);
      onOpen(machine, row.session);
      return;
    }
    if (!row.closed.isRestorable) {
      setRestoreError(
        row.closed.restoreUnavailableReason.length > 0
          ? row.closed.restoreUnavailableReason
          : SessionSearchCopy.notRestorable,
      );
      return;
    }
    setRestoreError(null);
    setRestoringKey(row.key);
    void onRestore(machine, row.closed).then(
      () => {
        setRestoringKey(null);
        setQuery('');
      },
      (error: unknown) => {
        setRestoringKey(null);
        setRestoreError(SessionSearchCopy.restoreFailed(error instanceof Error ? error.message : String(error)));
      },
    );
  };

  const renderRow = ({ item }: { item: SessionSearchRow }) => {
    const tag = resolveSessionTag(item, item.customSessionTags);
    const iconId = resolveAgentArtId(item.agentIcon, item.agentName);
    const AgentIcon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
    // quick_access/sessions.rs `session_icon`: the tag, then the agent's colored logo, then the terminal glyph in a tile.
    const glyph =
      tag !== undefined ? (
        <View style={styles.glyphTile}>
          <tag.Icon size={14} color={tag.color} strokeWidth={1.9} />
        </View>
      ) : iconId === 'terminal' || iconId === 'browser' ? (
        <View style={styles.glyphTile}>
          <AgentIcon size={14} color={SetupPalette.FOREGROUND} />
        </View>
      ) : (
        <View style={styles.glyphImage}>
          <AgentIcon size={18} color={agentIconTint(iconId)} />
        </View>
      );
    const time = sessionSearchRelativeTime(item.timestamp, nowMs);
    const closed = item.kind === 'closed';
    const restoring = restoringKey === item.key;
    const label = [item.title, item.projectLabel, closed ? SessionSearchCopy.closedLabel : '']
      .filter((part) => part.length > 0)
      .join(', ');
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: restoring, disabled: closed && !item.closed.isRestorable }}
        style={({ pressed }) => [
          styles.row,
          pressed || restoring || (restoringKey === null && item.key === firstKey) ? styles.rowSelected : null,
          closed && !item.closed.isRestorable ? styles.rowUnavailable : null,
        ]}
        onPress={() => open(item)}
      >
        {glyph}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1} ellipsizeMode="tail">
            {item.title}
          </Text>
          {item.projectLabel.length > 0 ? (
            <Text style={styles.rowProject} numberOfLines={1} ellipsizeMode="tail">
              {item.projectLabel}
            </Text>
          ) : null}
        </View>
        {restoring ? (
          <>
            <Text style={styles.rowTime}>{SessionSearchCopy.restoring}</Text>
            <ActivityIndicator size="small" color={SetupPalette.MUTED} />
          </>
        ) : (
          <>
            {time.length > 0 ? <Text style={styles.rowTime}>{time}</Text> : null}
            <View
              style={
                item.kind === 'closed'
                  ? [styles.statusDot, styles.statusDotClosed]
                  : [styles.statusDot, { backgroundColor: item.session.isSleeping ? STATUS_DOT : STATUS_DOT_OPEN }]
              }
            />
          </>
        )}
      </Pressable>
    );
  };

  const footer =
    closedLoading || closedFailures.length > 0 ? (
      <Text style={styles.footer}>
        {closedLoading
          ? SessionSearchCopy.loadingClosed
          : SessionSearchCopy.closedUnavailable(closedFailures.join(', '))}
      </Text>
    ) : undefined;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
      onShow={() => inputRef.current?.focus()}
    >
      <KeyboardAvoidingContainer style={[styles.fill, { paddingTop: insets.top + 8, paddingBottom: bottomInset + 8 }]}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel={SessionSearchCopy.close}
          onPress={close}
        />
        <View style={styles.panel}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={SessionSearchCopy.close}
              hitSlop={8}
              style={styles.headerButton}
              onPress={close}
            >
              <ChevronLeftGlyph size={22} color={SetupPalette.FOREGROUND} />
            </Pressable>
            <View style={styles.field}>
              <SearchGlyph size={16} color={SetupPalette.MUTED} />
              <TextInput
                ref={inputRef}
                autoFocus
                value={query}
                onChangeText={(next) => {
                  setQuery(next);
                  setRestoreError(null);
                }}
                editable={restoringKey === null}
                placeholder={SessionSearchCopy.placeholder}
                placeholderTextColor={SetupPalette.DIM}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="search"
                submitBehavior="blurAndSubmit"
                onSubmitEditing={() => {
                  const first = groups[0]?.rows[0];
                  if (first !== undefined) open(first);
                }}
              />
              {query.length > 0 && restoringKey === null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={SessionSearchCopy.clear}
                  hitSlop={8}
                  onPress={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                >
                  <XGlyph size={16} color={SetupPalette.MUTED} />
                </Pressable>
              ) : null}
            </View>
          </View>
          {restoreError !== null ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {restoreError}
            </Text>
          ) : null}
          <SectionList
            sections={sections}
            keyExtractor={(row) => row.key}
            renderItem={renderRow}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeading} numberOfLines={1}>
                {section.title}
              </Text>
            )}
            stickySectionHeadersEnabled={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              closedLoading ? undefined : (
                <Text style={styles.empty}>
                  {query.trim().length > 0 ? SessionSearchCopy.noMatches : SessionSearchCopy.noSessions}
                </Text>
              )
            }
            ListFooterComponent={footer}
          />
        </View>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    paddingHorizontal: 10,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: SetupPalette.BACKDROP,
  },
  panel: {
    flexShrink: 1,
    maxHeight: '100%',
    backgroundColor: SetupPalette.PANEL,
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER_STRONG,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderBottomWidth: GhostexStrokeWidth,
    borderBottomColor: SetupPalette.BORDER,
  },
  headerButton: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flex: 1,
    minWidth: 0,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: SetupPalette.CARD,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: SetupPalette.FOREGROUND,
    fontSize: 15,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  sectionHeading: {
    color: SetupPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  rowSelected: {
    backgroundColor: ROW_SELECTED,
  },
  glyphTile: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: GLYPH_TILE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphImage: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
  },
  rowTitle: {
    flexShrink: 1,
    color: SetupPalette.FOREGROUND,
    fontSize: 14.5,
  },
  rowProject: {
    flexShrink: 8,
    color: SetupPalette.MUTED,
    fontSize: 12.5,
  },
  rowTime: {
    minWidth: 28,
    textAlign: 'right',
    color: SetupPalette.MUTED,
    fontSize: 12.5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  /** A closed session draws only the ring of the dot: nothing is running for it. */
  statusDotClosed: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  rowUnavailable: {
    opacity: 0.45,
  },
  footer: {
    color: SetupPalette.MUTED,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 12,
  },
  error: {
    color: SetupPalette.ERROR,
    fontSize: 13,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  empty: {
    color: SetupPalette.MUTED,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
