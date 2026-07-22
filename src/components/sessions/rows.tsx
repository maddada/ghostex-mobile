/**
 * Non-session drawer row renderers, styled after the desktop gpui sidebar
 * (sidebar/styles/groups.css): MACHINE_HEADER, COLLECTION_HEADER,
 * PROJECT_HEADER, PROJECT_AGENTS_ROW, PROJECT_EMPTY, GROUP_HEADER,
 * SESSION_LIST_TOGGLE.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import {
  agentIconTint,
  resolveAgentIconId,
  type GhostexAgentLauncher,
  type GhostexQuickAction,
} from '../../contract/mobileSummary';
import {
  GhostexPalette,
  GhostexRadii,
  GhostexStrokeWidth,
  mixHexColors,
  SidebarPalette,
} from '../../theme/palette';
import {
  CaretRightGlyph,
  ChevronDownGlyph,
  FolderGlyph,
  FolderOpenGlyph,
  MessageCircleGlyph,
  MoreGlyph,
  PlusGlyph,
} from './icons';

/** Left rail color for rows inside a colored collection (desktop 72% mix). */
export function collectionRailColor(color: string): string {
  if (color === 'transparent') return 'rgba(255,255,255,0.18)';
  return mixHexColors(color, SidebarPalette.COLLECTION_SURFACE, 72);
}

// ---------------------------------------------------------------------------
// Collapsed status-count pills (desktop .group-collapsed-status-count):
// 6px glowing dot + 10sp weight-850 tabular count. Working (amber) first, then
// attention (blue); awake (grey) only when there is no working/attention.
// ---------------------------------------------------------------------------

function StatusCountPill({ count, color, dim }: { count: number; color: string; dim?: boolean }) {
  return (
    <View style={[pillStyles.pill, dim === true ? pillStyles.pillDim : null]}>
      <View style={[pillStyles.dotHalo, { backgroundColor: `${color}1F` }]}>
        <View style={[pillStyles.dot, { backgroundColor: color }]} />
      </View>
      <Text style={[pillStyles.count, { color }]}>{count}</Text>
    </View>
  );
}

export function StatusCountPills({
  workingCount,
  attentionCount,
  awakeCount,
}: {
  workingCount: number;
  attentionCount: number;
  awakeCount: number;
}) {
  const hasActionStatus = workingCount > 0 || attentionCount > 0;
  if (!hasActionStatus && awakeCount === 0) return null;
  return (
    <View style={pillStyles.cluster}>
      {workingCount > 0 ? (
        <StatusCountPill count={workingCount} color={SidebarPalette.PILL_WORKING} />
      ) : null}
      {attentionCount > 0 ? (
        <StatusCountPill count={attentionCount} color={SidebarPalette.PILL_ATTENTION} />
      ) : null}
      {!hasActionStatus && awakeCount > 0 ? (
        <StatusCountPill count={awakeCount} color={SidebarPalette.PILL_AWAKE} dim />
      ) : null}
    </View>
  );
}

const pillStyles = StyleSheet.create({
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginStart: 'auto',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  pillDim: {
    opacity: 0.7,
  },
  dotHalo: {
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  count: {
    fontSize: 10,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    lineHeight: 12,
  },
});

// ---------------------------------------------------------------------------
// MACHINE_HEADER: muted 12sp bold ALL-CAPS letterSpacing 0.06em, padding
// 8/18/8/4, minHeight 36; " …" suffix when collapsed; tap toggles collapse.
// ---------------------------------------------------------------------------

export function MachineHeaderRow({
  title,
  collapsed,
  onPress,
}: {
  title: string;
  collapsed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" style={machineHeaderStyles.row} onPress={onPress}>
      <Text style={machineHeaderStyles.title} numberOfLines={1}>
        {`${title.toUpperCase()}${collapsed ? ' …' : ''}`}
      </Text>
    </Pressable>
  );
}

const machineHeaderStyles = StyleSheet.create({
  row: {
    paddingLeft: 8,
    paddingTop: 18,
    paddingRight: 8,
    paddingBottom: 4,
    minHeight: 36,
    justifyContent: 'flex-end',
  },
  title: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.72,
  },
});

// ---------------------------------------------------------------------------
// COLLECTION_HEADER (desktop .project-collection-header): 30dp rounded header
// tinted with the collection color (16% over #141414, 38% border), caret that
// rotates when expanded, 11sp weight-650 title, collapsed count pills.
// ---------------------------------------------------------------------------

export function CollectionHeaderRow({
  title,
  color,
  collapsed,
  workingCount,
  attentionCount,
  awakeCount,
  onPress,
}: {
  title: string;
  color: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
  awakeCount: number;
  onPress: () => void;
}) {
  const hasColor = color !== 'transparent';
  const background = hasColor
    ? mixHexColors(color, SidebarPalette.COLLECTION_SURFACE, 16)
    : SidebarPalette.COLLECTION_SURFACE;
  const borderColor = hasColor ? `${color}61` : 'rgba(255,255,255,0.11)';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
      style={[collectionStyles.header, { backgroundColor: background, borderColor }]}
      onPress={onPress}
    >
      <View style={collectionStyles.caret}>
        <CaretRightGlyph size={14} color={SidebarPalette.FOREGROUND} rotated={!collapsed} />
      </View>
      <Text style={collectionStyles.title} numberOfLines={1}>
        {title}
      </Text>
      {collapsed ? (
        <StatusCountPills
          workingCount={workingCount}
          attentionCount={attentionCount}
          awakeCount={awakeCount}
        />
      ) : null}
    </Pressable>
  );
}

const collectionStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    marginTop: 3,
    marginBottom: 4,
    borderRadius: 6,
    borderWidth: 1,
    paddingLeft: 2,
    paddingRight: 8,
  },
  caret: {
    width: 20,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flexShrink: 1,
    color: SidebarPalette.FOREGROUND,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.28,
  },
});

// ---------------------------------------------------------------------------
// PROJECT_HEADER (desktop .group-head): leading folder (open/closed; chat
// bubble for Chats), ALL-CAPS 12sp weight-700 letterSpacing 0.12em title,
// collapsed status-count pills, compact create/menu buttons.
// ---------------------------------------------------------------------------

export function ProjectHeaderRow({
  title,
  collapsed,
  isChatCollection,
  workingCount,
  attentionCount,
  awakeCount,
  showMenu,
  onToggle,
  onCreate,
  onMenu,
}: {
  title: string;
  collapsed: boolean;
  isChatCollection: boolean;
  workingCount: number;
  attentionCount: number;
  awakeCount: number;
  showMenu: boolean;
  onToggle: () => void;
  onCreate: () => void;
  onMenu: () => void;
}) {
  const iconColor = SidebarPalette.GROUP_TITLE;
  return (
    <Pressable accessibilityRole="button" style={projectHeaderStyles.row} onPress={onToggle}>
      <View style={projectHeaderStyles.leadingIcon}>
        {isChatCollection ? (
          <MessageCircleGlyph size={15} color={iconColor} />
        ) : collapsed ? (
          <FolderGlyph size={15} color={iconColor} />
        ) : (
          <FolderOpenGlyph size={15} color={iconColor} />
        )}
      </View>
      <Text style={projectHeaderStyles.title} numberOfLines={1}>
        {title.toUpperCase()}
      </Text>
      {collapsed ? (
        <StatusCountPills
          workingCount={workingCount}
          attentionCount={attentionCount}
          awakeCount={awakeCount}
        />
      ) : null}
      <View style={projectHeaderStyles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Create a session in ${title}`}
          style={projectHeaderStyles.actionButton}
          onPress={onCreate}
        >
          <PlusGlyph size={14} color={SidebarPalette.MUTED} />
        </Pressable>
        {showMenu ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title} project menu`}
            style={projectHeaderStyles.actionButton}
            onPress={onMenu}
          >
            <MoreGlyph size={14} color={SidebarPalette.MUTED} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const projectHeaderStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    paddingRight: 2,
    paddingTop: 8,
    paddingBottom: 4,
    minHeight: 40,
    gap: 6,
  },
  leadingIcon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flexShrink: 1,
    color: SidebarPalette.GROUP_TITLE,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.44,
    lineHeight: 14,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginStart: 'auto',
    gap: 2,
  },
  actionButton: {
    width: 30,
    height: 30,
    borderRadius: GhostexRadii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ---------------------------------------------------------------------------
// PROJECT_AGENTS_ROW ("agents isle"): horizontal chip scroll; chip = pill,
// padding 10/6/10/6, minHeight 32, 15×15 tinted icon + 12sp label. Global
// agent chips first, then project quick actions.
// ---------------------------------------------------------------------------

function Chip({
  iconId,
  label,
  onPress,
}: {
  iconId: ReturnType<typeof resolveAgentIconId>;
  label: string;
  onPress: () => void;
}) {
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  return (
    <Pressable accessibilityRole="button" style={agentsRowStyles.chip} onPress={onPress}>
      <Icon size={15} color={agentIconTint(iconId)} />
      <Text style={agentsRowStyles.chipLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ProjectAgentsRow({
  agents,
  quickActions,
  onAgentPress,
  onQuickActionPress,
}: {
  agents: GhostexAgentLauncher[];
  quickActions: GhostexQuickAction[];
  onAgentPress: (agent: GhostexAgentLauncher) => void;
  onQuickActionPress: (action: GhostexQuickAction) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={agentsRowStyles.content}
    >
      {agents.map((agent) => (
        <Chip
          key={`agent:${agent.agentId}`}
          iconId={resolveAgentIconId(agent.icon, agent.name ?? agent.agentId)}
          label={agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId}
          onPress={() => onAgentPress(agent)}
        />
      ))}
      {quickActions.map((action, index) => (
        <Chip
          key={`action:${action.commandId ?? action.url ?? index}`}
          iconId={resolveAgentIconId(
            action.icon,
            action.actionType === 'browser' ? 'browser' : action.name,
          )}
          label={action.name !== undefined && action.name.length > 0 ? action.name : action.actionType}
          onPress={() => onQuickActionPress(action)}
        />
      ))}
    </ScrollView>
  );
}

const agentsRowStyles = StyleSheet.create({
  content: {
    gap: 6,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    borderRadius: GhostexRadii.pill,
    backgroundColor: GhostexPalette.BACKGROUND,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  chipLabel: {
    color: SidebarPalette.FOREGROUND,
    fontSize: 12,
  },
});

// ---------------------------------------------------------------------------
// PROJECT_EMPTY: muted 12sp text row.
// ---------------------------------------------------------------------------

export function ProjectEmptyRow({ text }: { text: string }) {
  return (
    <View style={emptyStyles.row}>
      <Text style={emptyStyles.text}>{text}</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  row: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: {
    color: SidebarPalette.MUTED,
    fontSize: 12,
  },
});

// ---------------------------------------------------------------------------
// GROUP_HEADER (named workspace session group): caret + muted 12sp bold title,
// "(count)" suffix when collapsed.
// ---------------------------------------------------------------------------

export function GroupHeaderRow({
  title,
  count,
  collapsed,
  onPress,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" style={groupHeaderStyles.row} onPress={onPress}>
      <CaretRightGlyph size={12} color={SidebarPalette.MUTED} rotated={!collapsed} />
      <Text style={groupHeaderStyles.title} numberOfLines={1}>
        {collapsed ? `${title} (${count})` : title}
      </Text>
    </Pressable>
  );
}

const groupHeaderStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 10,
    paddingTop: 8,
    paddingRight: 12,
    paddingBottom: 4,
    minHeight: 32,
  },
  title: {
    flexShrink: 1,
    color: SidebarPalette.MUTED,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});

// ---------------------------------------------------------------------------
// SESSION_LIST_TOGGLE: muted 12sp "Show more"/"Show less" reveal row.
// ---------------------------------------------------------------------------

export function SessionListToggleRow({
  label,
  collapsed,
  onPress,
}: {
  label: string;
  collapsed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" style={toggleStyles.row} onPress={onPress}>
      <ChevronDownGlyph size={13} color={SidebarPalette.MUTED} rotated={!collapsed} />
      <Text style={toggleStyles.label}>{label}</Text>
    </Pressable>
  );
}

const toggleStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 34,
  },
  label: {
    color: SidebarPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
});
