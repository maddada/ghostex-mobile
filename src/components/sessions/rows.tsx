/**
 * Non-session drawer row renderers (sessions-drawer.md §2):
 * MACHINE_HEADER, PROJECT_HEADER, PROJECT_AGENTS_ROW, PROJECT_EMPTY,
 * GROUP_HEADER, SESSION_LIST_TOGGLE. Sizes/paddings quoted from the spec.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import {
  agentIconTint,
  resolveAgentIconId,
  type GhostexAgentLauncher,
  type GhostexQuickAction,
} from '../../contract/mobileSummary';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { MoreGlyph, PlusGlyph } from './icons';

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
// PROJECT_HEADER: padding 6/14/6/6, minHeight 52; title 15sp bold weight 1;
// "+" 32×32 pill (bg BACKGROUND, BORDER stroke); ⋮ 32×32 pill (hidden for
// Chats); row tap toggles expand/collapse.
// ---------------------------------------------------------------------------

export function ProjectHeaderRow({
  title,
  showMenu,
  onToggle,
  onCreate,
  onMenu,
}: {
  title: string;
  showMenu: boolean;
  onToggle: () => void;
  onCreate: () => void;
  onMenu: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" style={projectHeaderStyles.row} onPress={onToggle}>
      <Text style={projectHeaderStyles.title} numberOfLines={1}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Create a session in ${title}`}
        style={projectHeaderStyles.pill}
        onPress={onCreate}
      >
        <PlusGlyph size={16} color={GhostexPalette.FOREGROUND} />
      </Pressable>
      {showMenu ? (
        <Pressable accessibilityRole="button" style={projectHeaderStyles.pill} onPress={onMenu}>
          <MoreGlyph size={16} color={GhostexPalette.FOREGROUND} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const projectHeaderStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    paddingTop: 14,
    paddingRight: 6,
    paddingBottom: 6,
    minHeight: 52,
    gap: 8,
  },
  title: {
    flex: 1,
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
  },
  pill: {
    width: 32,
    height: 32,
    borderRadius: GhostexRadii.pill,
    backgroundColor: GhostexPalette.BACKGROUND,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
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
    paddingBottom: 4,
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
    color: GhostexPalette.FOREGROUND,
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
    color: GhostexPalette.MUTED,
    fontSize: 12,
  },
});

// ---------------------------------------------------------------------------
// GROUP_HEADER: muted 13sp bold, padding 14/10/12/4; "{title}" or
// "{title} ({count})" when collapsed; tap toggles (in-memory).
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
      <Text style={groupHeaderStyles.title} numberOfLines={1}>
        {collapsed ? `${title} (${count})` : title}
      </Text>
    </Pressable>
  );
}

const groupHeaderStyles = StyleSheet.create({
  row: {
    paddingLeft: 14,
    paddingTop: 10,
    paddingRight: 12,
    paddingBottom: 4,
  },
  title: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    fontWeight: 'bold',
  },
});

// ---------------------------------------------------------------------------
// SESSION_LIST_TOGGLE: muted 13sp "Show more"/"Show less".
// ---------------------------------------------------------------------------

export function SessionListToggleRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={toggleStyles.row} onPress={onPress}>
      <Text style={toggleStyles.label}>{label}</Text>
    </Pressable>
  );
}

const toggleStyles = StyleSheet.create({
  row: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  label: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
  },
});
