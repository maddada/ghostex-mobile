/**
 * Session search: the phone's counterpart of the desktop's Sessions search
 * (Quick Access, Sessions tab). A panel over the Sessions list with an
 * autofocused field and the matching sessions of every visible computer,
 * newest first under day headings; each row shows the session's tag or agent
 * glyph, its title, its project, how long ago it was used, and a dot that is
 * lit while it is awake. Tapping a row (or the keyboard's search key, which
 * opens the first row, as Enter does on the desktop) opens the session the way
 * tapping it in the list does. The matching rules live in
 * src/sessions/sessionSearch.ts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import {
  agentIconTint,
  resolveAgentIconId,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { resolveSessionTag } from '../../contract/sessionTags';
import { SessionCopy, SessionSearchCopy } from '../../copy';
import { useInventoryStore } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import {
  searchSessions,
  sessionSearchRelativeTime,
  type SessionSearchCandidate,
  type SessionSearchRow,
} from '../../sessions/sessionSearch';
import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import { ChevronLeftGlyph, SearchGlyph, XGlyph } from './icons';

export type SessionSearchSheetProps = {
  visible: boolean;
  /** The computers the Sessions list shows (hidden ones are never searched). */
  machines: readonly MachineRecord[];
  onOpen: (machine: MachineRecord, session: GhostexSession) => void;
  onClose: () => void;
};

/** Desktop Quick Access dark palette (apps/desktop/src/app/window/quick_access/palette.rs). */
const ROW_SELECTED = 'rgba(255,255,255,0.075)';
const GLYPH_TILE = 'rgba(255,255,255,0.07)';
const STATUS_DOT = 'rgba(255,255,255,0.20)';
const STATUS_DOT_OPEN = '#FFFFFF';

export default function SessionSearchSheet({
  visible,
  machines,
  onOpen,
  onClose,
}: SessionSearchSheetProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput | null>(null);
  const [query, setQuery] = useState('');
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  /*
   * Whether a transparent modal is resized for the keyboard differs between
   * Android builds (see useKeyboardMetrics), so the list keeps the keyboard's
   * height of room at its end: every result can be scrolled into view either way.
   */
  useEffect(() => {
    if (!visible) return undefined;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subscriptions = [
      Keyboard.addListener(showEvent, (event) => setKeyboardHeight(event.endCoordinates.height)),
      Keyboard.addListener(hideEvent, () => setKeyboardHeight(0)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
      setKeyboardHeight(0);
    };
  }, [visible]);

  const candidates = useMemo((): SessionSearchCandidate[] => {
    // The sheet stays mounted under the list; the 5s inventory poll need not rebuild results nobody sees.
    if (!visible) return [];
    const reporting = machines.filter(
      (machine) => inventoriesByMachineId[machine.id]?.summary != null,
    );
    return reporting.flatMap((machine) => {
      const summary = inventoriesByMachineId[machine.id]?.summary;
      if (summary == null) return [];
      const chatProjectIds = new Set(
        summary.projects.filter((project) => project.isChat === true).map((project) => project.projectId),
      );
      return summary.sessions.map((session) => {
        const project = chatProjectIds.has(session.projectId)
          ? SessionCopy.chatsTitle
          : session.projectName.trim();
        // The phone lists one computer at a time, so a result names its computer once there are several.
        const projectLabel =
          reporting.length > 1
            ? [project, machineDisplayLabel(machine)].filter((part) => part.length > 0).join(' · ')
            : project;
        return {
          machineId: machine.id,
          session,
          projectLabel,
          customSessionTags: summary.customSessionTags,
        };
      });
    });
  }, [visible, machines, inventoriesByMachineId]);

  const groups = useMemo(() => searchSessions(candidates, query), [candidates, query]);
  const sections = useMemo(
    () => groups.map((group) => ({ title: group.heading, data: group.rows })),
    [groups],
  );
  const firstKey = groups[0]?.rows[0]?.key;
  const nowMs = Date.now();

  const close = (): void => {
    setQuery('');
    onClose();
  };

  const open = (row: SessionSearchRow): void => {
    const machine = machines.find((entry) => entry.id === row.machineId);
    if (machine === undefined) return;
    setQuery('');
    onOpen(machine, row.session);
  };

  const renderRow = ({ item }: { item: SessionSearchRow }) => {
    const { session } = item;
    const tag = resolveSessionTag(session, item.customSessionTags);
    const iconId = resolveAgentIconId(
      session.agentIcon,
      session.agentName.length > 0 ? session.agentName : session.agent,
    );
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
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          item.projectLabel.length > 0 ? `${item.title}, ${item.projectLabel}` : item.title
        }
        style={({ pressed }) => [
          styles.row,
          pressed || item.key === firstKey ? styles.rowSelected : null,
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
        {time.length > 0 ? <Text style={styles.rowTime}>{time}</Text> : null}
        <View
          style={[
            styles.statusDot,
            { backgroundColor: session.isSleeping ? STATUS_DOT : STATUS_DOT_OPEN },
          ]}
        />
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
      onShow={() => inputRef.current?.focus()}
    >
      <View style={[styles.fill, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
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
                onChangeText={setQuery}
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
              {query.length > 0 ? (
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
            contentContainerStyle={[styles.listContent, { paddingBottom: 8 + keyboardHeight }]}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {query.trim().length > 0 ? SessionSearchCopy.noMatches : SessionSearchCopy.noSessions}
              </Text>
            }
          />
        </View>
      </View>
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
  empty: {
    color: SetupPalette.MUTED,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
