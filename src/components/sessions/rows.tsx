/**
 * Non-session drawer row renderers, cloned from the desktop gpui reference
 * sidebar (sidebar/styles/hierarchy-panels.css + group-panels.css layered
 * skin): SECTION_LABEL ("Quick"/"Projects"), collection panel headers, project
 * card headers with the terminal / agent split / actions buttons, empty rows,
 * named-group headers, and MACHINE_HEADER. Every text weight is 300 because
 * the desktop reference layout forces `font-weight: 300 !important` globally.
 */

import { useRef, type ReactNode, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import {
  resolveAgentIconId,
  type GhostexAgentLauncher,
  type GhostexQuickAction,
} from '../../contract/mobileSummary';
import { GhostexPalette, mixHexColors, SidebarPalette } from '../../theme/palette';
import type { MenuAnchor } from './ContextMenu';
import {
  CaretRightGlyph,
  ChevronDownGlyph,
  PlayGlyph,
  TerminalGlyph,
  WorldGlyph,
} from './icons';

/** Desktop sidebar background (--app-background). */
export const SIDEBAR_BACKGROUND = '#0E0E0E';

/**
 * Sessions-list density scale: every font/control/spacing in the drawer list
 * renders 25% larger than the desktop pixel values (user preference). The
 * page header (Ghostex title row, status line) stays unscaled.
 */
export const DRAWER_SCALE = 1.25;

/** Scale a desktop dp value by DRAWER_SCALE, rounded to half-dp. */
export function ds(value: number): number {
  return Math.round(value * DRAWER_SCALE * 2) / 2;
}

/** Neutral expanded-group fill: mix(sidebar bg 96%, black 4%). */
export function expandedGroupBackground(sidebarBackground: string): string {
  return mixHexColors(sidebarBackground, '#000000', 96);
}

/** Collection panel fill: mix(color 5%, neutral expanded-group fill). */
export function collectionPanelBackground(
  color: string,
  sidebarBackground: string = SIDEBAR_BACKGROUND,
): string {
  const expandedBackground = expandedGroupBackground(sidebarBackground);
  if (color === 'transparent') return expandedBackground;
  return mixHexColors(color, expandedBackground, 5);
}

/**
 * Collection panel border: mix(color 28%, mix(fg 14%, sidebar bg)). The 14%
 * neutral base keeps a visible outline even for the transparent group color.
 */
export function collectionPanelBorder(
  color: string,
  sidebarBackground: string = SIDEBAR_BACKGROUND,
  sidebarForeground: string = SidebarPalette.FOREGROUND,
): string {
  const base = mixHexColors(sidebarForeground, sidebarBackground, 14);
  if (color === 'transparent') return base;
  return mixHexColors(color, base, 28);
}

/**
 * Project card fill: foreground at 4.5% over the surface beneath it. Keeping
 * this translucent matches CSS color-mix(..., transparent), including cards
 * nested inside a collection panel.
 */
export const PROJECT_CARD_BACKGROUND = 'rgba(200,205,213,0.045)';

/** Project card border: foreground at 13%, matching the current gpui card. */
export const PROJECT_CARD_BORDER = 'rgba(200,205,213,0.13)';

/** Header/collection title color: mix(fg 92%, white 8%). */
const TITLE_COLOR = mixHexColors(SidebarPalette.FOREGROUND, '#FFFFFF', 92);

/** Section label color: fg at 52%. */
const SECTION_LABEL_COLOR = 'rgba(200,205,213,0.52)';

/** Agent-launcher glyph base color: mix(fg 62%, muted 38%). */
const AGENT_LAUNCHER_ICON_COLOR = mixHexColors(
  SidebarPalette.FOREGROUND,
  SidebarPalette.MUTED,
  62,
);

// ---------------------------------------------------------------------------
// Collapsed status-count pills (desktop .group-collapsed-status-count):
// 6dp glowing dot + 10dp tabular count. Working (amber) first, then attention
// (blue); awake (grey, NO dot in the current skin) only when neither exists.
// ---------------------------------------------------------------------------

function StatusCountPill({
  count,
  color,
  dim,
  showDot,
}: {
  count: number;
  color: string;
  dim?: boolean;
  showDot: boolean;
}) {
  return (
    <View style={[pillStyles.pill, dim === true ? pillStyles.pillDim : null]}>
      {showDot ? (
        <View style={[pillStyles.dotHalo, { backgroundColor: `${color}1F` }]}>
          <View style={[pillStyles.dot, { backgroundColor: color }]} />
        </View>
      ) : null}
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
        <StatusCountPill count={workingCount} color={SidebarPalette.PILL_WORKING} showDot />
      ) : null}
      {attentionCount > 0 ? (
        <StatusCountPill count={attentionCount} color={SidebarPalette.PILL_ATTENTION} showDot />
      ) : null}
      {!hasActionStatus && awakeCount > 0 ? (
        <StatusCountPill count={awakeCount} color={SidebarPalette.PILL_AWAKE} dim showDot={false} />
      ) : null}
    </View>
  );
}

const pillStyles = StyleSheet.create({
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(6),
    marginStart: 'auto',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(3),
  },
  pillDim: {
    opacity: 0.7,
  },
  dotHalo: {
    width: ds(12),
    height: ds(12),
    borderRadius: ds(6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: ds(6),
    height: ds(6),
    borderRadius: ds(3),
  },
  count: {
    fontSize: ds(10),
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    lineHeight: ds(12),
  },
});

// ---------------------------------------------------------------------------
// Header square buttons (desktop .group-add-button): 22×22, radius 6, card
// fill, blue-tinted 14dp icon. The agent split-button is a 24+17 joined pair.
// ---------------------------------------------------------------------------

function measurePress(
  ref: RefObject<View | null>,
  onAnchor: (anchor: MenuAnchor) => void,
): void {
  const node = ref.current;
  if (node === null) return;
  node.measureInWindow((x, y, width, height) => onAnchor({ x, y, width, height }));
}

function HeaderButton({
  accessibilityLabel,
  onPress,
  onAnchorPress,
  children,
}: {
  accessibilityLabel: string;
  onPress?: () => void;
  /** When set, the press measures the button and reports its window frame. */
  onAnchorPress?: (anchor: MenuAnchor) => void;
  children: ReactNode;
}) {
  const ref = useRef<View | null>(null);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={5}
      style={({ pressed }) => [buttonStyles.button, pressed ? buttonStyles.buttonPressed : null]}
      onPress={() => {
        if (onAnchorPress !== undefined) measurePress(ref, onAnchorPress);
        else onPress?.();
      }}
    >
      {children}
    </Pressable>
  );
}

function AgentSplitButton({
  primaryAgent,
  onLaunchPrimary,
  onOpenMenu,
}: {
  primaryAgent: GhostexAgentLauncher | null;
  onLaunchPrimary: () => void;
  onOpenMenu: (anchor: MenuAnchor) => void;
}) {
  const ref = useRef<View | null>(null);
  const iconId =
    primaryAgent === null
      ? 'terminal'
      : resolveAgentIconId(primaryAgent.icon, primaryAgent.name ?? primaryAgent.agentId);
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  return (
    <View ref={ref} style={buttonStyles.split}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          primaryAgent !== null ? `Create ${primaryAgent.name ?? primaryAgent.agentId}` : 'Create agent'
        }
        hitSlop={{ top: 5, bottom: 5, left: 5, right: 0 }}
        style={({ pressed }) => [
          buttonStyles.splitMain,
          pressed ? buttonStyles.buttonPressed : null,
        ]}
        onPress={onLaunchPrimary}
      >
        <Icon size={ds(14)} color={AGENT_LAUNCHER_ICON_COLOR} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select agent"
        hitSlop={{ top: 5, bottom: 5, left: 0, right: 5 }}
        style={({ pressed }) => [
          buttonStyles.splitToggle,
          pressed ? buttonStyles.buttonPressed : null,
        ]}
        onPress={() => measurePress(ref, onOpenMenu)}
      >
        <ChevronDownGlyph size={ds(13)} color={SidebarPalette.HEADER_BUTTON_ICON} />
      </Pressable>
    </View>
  );
}

const buttonStyles = StyleSheet.create({
  button: {
    width: ds(22),
    height: ds(22),
    borderRadius: ds(6),
    backgroundColor: SidebarPalette.HEADER_BUTTON_BG,
    borderWidth: 1,
    borderColor: SidebarPalette.HEADER_BUTTON_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: 'rgba(125,164,248,0.16)',
    borderColor: 'rgba(125,164,248,0.54)',
  },
  split: {
    flexDirection: 'row',
    height: ds(22),
  },
  splitMain: {
    width: ds(24),
    height: ds(22),
    borderTopLeftRadius: ds(6),
    borderBottomLeftRadius: ds(6),
    backgroundColor: SidebarPalette.HEADER_BUTTON_BG,
    borderWidth: 1,
    borderColor: SidebarPalette.HEADER_BUTTON_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitToggle: {
    width: ds(17),
    height: ds(22),
    borderTopRightRadius: ds(6),
    borderBottomRightRadius: ds(6),
    backgroundColor: SidebarPalette.HEADER_BUTTON_BG,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: SidebarPalette.HEADER_BUTTON_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ---------------------------------------------------------------------------
// MACHINE_HEADER: muted 12dp ALL-CAPS; " …" suffix when collapsed (mobile-only
// multi-machine construct, kept from the previous drawer).
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
    paddingLeft: ds(8),
    paddingTop: ds(18),
    paddingRight: ds(8),
    paddingBottom: ds(4),
    minHeight: ds(36),
    justifyContent: 'flex-end',
  },
  title: {
    color: GhostexPalette.MUTED,
    fontSize: ds(12),
    fontWeight: '300',
    letterSpacing: 0.9,
  },
});

// ---------------------------------------------------------------------------
// SECTION_LABEL (desktop .reference-sidebar-section-row): "Quick"/"Projects",
// 15.5dp light label at fg 52%, filled caret that rotates when expanded. The
// Quick row carries a trailing create-terminal button (desktop hover action).
// Long-press opens the section menu (desktop right-click).
// ---------------------------------------------------------------------------

export function SectionLabelRow({
  title,
  collapsed,
  first,
  onToggle,
  onCreate,
  onMenu,
}: {
  title: string;
  collapsed: boolean;
  /** First section after the status header uses the tighter top margin. */
  first: boolean;
  onToggle: () => void;
  onCreate?: () => void;
  onMenu?: (anchor: MenuAnchor) => void;
}) {
  const rowRef = useRef<View | null>(null);
  return (
    <View ref={rowRef} style={[sectionStyles.row, first ? sectionStyles.rowFirst : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
        style={sectionStyles.heading}
        onPress={onToggle}
        onLongPress={onMenu === undefined ? undefined : () => measurePress(rowRef, onMenu)}
      >
        <Text style={sectionStyles.title}>{title}</Text>
        <CaretRightGlyph size={ds(13)} color="#727982" rotated={!collapsed} />
      </Pressable>
      <View style={sectionStyles.actions}>
        {onCreate !== undefined ? (
          <HeaderButton accessibilityLabel={`Create a session in ${title}`} onPress={onCreate}>
            <TerminalGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
          </HeaderButton>
        ) : null}
      </View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ds(26),
    marginTop: ds(8),
    marginBottom: ds(10),
    paddingLeft: ds(13),
    paddingRight: ds(8),
  },
  rowFirst: {
    marginTop: ds(6),
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(6),
    flexShrink: 1,
  },
  title: {
    color: SECTION_LABEL_COLOR,
    fontSize: ds(15.5),
    fontWeight: '300',
    lineHeight: ds(18),
  },
  actions: {
    marginStart: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(2),
  },
});

// ---------------------------------------------------------------------------
// COLLECTION_HEADER (desktop layered-panel .project-collection-header): flat
// 30dp row inside the tinted panel — 20×24 caret slot with a 14dp filled
// caret, 13dp light title, collapsed count pills.
// ---------------------------------------------------------------------------

export function CollectionHeaderRow({
  title,
  collapsed,
  workingCount,
  attentionCount,
  awakeCount,
  onPress,
  onMenu,
}: {
  title: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
  awakeCount: number;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const rowRef = useRef<View | null>(null);
  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
      style={({ pressed }) => [
        collectionStyles.header,
        pressed ? collectionStyles.headerPressed : null,
      ]}
      onPress={onPress}
      onLongPress={() => measurePress(rowRef, onMenu)}
    >
      <View style={collectionStyles.caret}>
        <CaretRightGlyph size={ds(14)} color={TITLE_COLOR} rotated={!collapsed} />
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
    gap: ds(5),
    minHeight: ds(30),
    paddingLeft: ds(2),
    paddingRight: ds(8),
    borderTopLeftRadius: ds(4),
    borderTopRightRadius: ds(4),
  },
  headerPressed: {
    backgroundColor: 'rgba(200,205,213,0.05)',
  },
  caret: {
    width: ds(20),
    height: ds(24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: TITLE_COLOR,
    fontSize: ds(13),
    fontWeight: '300',
    letterSpacing: 0.16,
  },
});

// ---------------------------------------------------------------------------
// PROJECT_HEADER (desktop project card .group-head): flat 30dp row at the top
// of the card — 13dp light title (no leading icon), collapsed count pills,
// and (expanded) the desktop button cluster: Show less chevron, Actions,
// Create Terminal, and the agent split-button. Long-press opens the project
// menu (desktop right-click).
// ---------------------------------------------------------------------------

export function ProjectHeaderRow({
  title,
  collapsed,
  workingCount,
  attentionCount,
  awakeCount,
  hasActions,
  selectedActionType,
  primaryAgent,
  showSessionListCollapse,
  onToggle,
  onCreateTerminal,
  onLaunchPrimary,
  onOpenAgentMenu,
  onOpenActionsMenu,
  onCollapseSessionList,
  onMenu,
}: {
  title: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
  awakeCount: number;
  hasActions: boolean;
  /** actionType of the last-run quick action, for the actions-button glyph. */
  selectedActionType: 'browser' | 'terminal' | null;
  primaryAgent: GhostexAgentLauncher | null;
  /** True when the expanded list can collapse back to 6 rows (Show less). */
  showSessionListCollapse: boolean;
  onToggle: () => void;
  onCreateTerminal: () => void;
  onLaunchPrimary: () => void;
  onOpenAgentMenu: (anchor: MenuAnchor) => void;
  onOpenActionsMenu: (anchor: MenuAnchor) => void;
  onCollapseSessionList: () => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const rowRef = useRef<View | null>(null);
  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      style={({ pressed }) => [
        projectHeaderStyles.row,
        pressed ? projectHeaderStyles.rowPressed : null,
      ]}
      onPress={onToggle}
      onLongPress={() => measurePress(rowRef, onMenu)}
    >
      <Text style={projectHeaderStyles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={projectHeaderStyles.trailing}>
        {collapsed ? (
          <StatusCountPills
            workingCount={workingCount}
            attentionCount={attentionCount}
            awakeCount={awakeCount}
          />
        ) : (
          <View style={projectHeaderStyles.actions}>
            {showSessionListCollapse ? (
              <HeaderButton
                accessibilityLabel={`Show fewer sessions in ${title}`}
                onPress={onCollapseSessionList}
              >
                <ChevronDownGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} rotated />
              </HeaderButton>
            ) : null}
            {hasActions ? (
              <HeaderButton
                accessibilityLabel={`${title} actions`}
                onAnchorPress={onOpenActionsMenu}
              >
                {selectedActionType === 'browser' ? (
                  <WorldGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
                ) : (
                  <PlayGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
                )}
              </HeaderButton>
            ) : null}
            <HeaderButton
              accessibilityLabel={`Create a terminal in ${title}`}
              onPress={onCreateTerminal}
            >
              <TerminalGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
            </HeaderButton>
            {primaryAgent !== null ? (
              <AgentSplitButton
                primaryAgent={primaryAgent}
                onLaunchPrimary={onLaunchPrimary}
                onOpenMenu={onOpenAgentMenu}
              />
            ) : null}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const projectHeaderStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ds(30),
    paddingHorizontal: ds(8),
    paddingVertical: ds(2),
    borderTopLeftRadius: ds(4),
    borderTopRightRadius: ds(4),
    gap: ds(6),
  },
  rowPressed: {
    backgroundColor: 'rgba(200,205,213,0.06)',
  },
  title: {
    flexShrink: 1,
    color: TITLE_COLOR,
    fontSize: ds(13),
    fontWeight: '300',
    letterSpacing: 0.16,
    lineHeight: ds(18),
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    marginStart: 'auto',
    gap: ds(4),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(4),
  },
});

// ---------------------------------------------------------------------------
// PROJECT_EMPTY: card variant is the desktop dashed "No sessions" box; the
// Quick variant is the bare dark-gray "No Quick Sessions" line.
// ---------------------------------------------------------------------------

export function ProjectEmptyRow({ text, quick }: { text: string; quick: boolean }) {
  if (quick) {
    return (
      <View style={emptyStyles.quickRow}>
        <Text style={emptyStyles.quickText}>{text}</Text>
      </View>
    );
  }
  return (
    <View style={emptyStyles.cardRow}>
      <Text style={emptyStyles.cardText}>{text}</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  cardRow: {
    height: ds(38),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(125,164,248,0.44)',
  },
  cardText: {
    color: mixHexColors(SidebarPalette.MUTED, SidebarPalette.FOREGROUND, 82),
    fontSize: ds(12),
    fontWeight: '300',
    letterSpacing: 0.45,
  },
  quickRow: {
    marginTop: ds(8),
    paddingLeft: ds(18),
  },
  quickText: {
    color: '#444444',
    fontSize: ds(15.5),
    fontWeight: '300',
    lineHeight: ds(18),
  },
});

// ---------------------------------------------------------------------------
// GROUP_HEADER (named workspace session group inside a project card): caret +
// light muted title, "(count)" suffix when collapsed. Long-press opens the
// group menu (desktop right-click).
// ---------------------------------------------------------------------------

export function GroupHeaderRow({
  title,
  count,
  collapsed,
  onPress,
  onMenu,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const rowRef = useRef<View | null>(null);
  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      style={({ pressed }) => [
        groupHeaderStyles.row,
        pressed ? groupHeaderStyles.rowPressed : null,
      ]}
      onPress={onPress}
      onLongPress={() => measurePress(rowRef, onMenu)}
    >
      <CaretRightGlyph size={ds(12)} color={SidebarPalette.MUTED} rotated={!collapsed} />
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
    gap: ds(5),
    paddingLeft: ds(8),
    paddingRight: ds(8),
    minHeight: ds(28),
    borderRadius: ds(4),
  },
  rowPressed: {
    backgroundColor: 'rgba(200,205,213,0.06)',
  },
  title: {
    flexShrink: 1,
    color: SidebarPalette.MUTED,
    fontSize: ds(13),
    fontWeight: '300',
    letterSpacing: 0.16,
  },
});

// ---------------------------------------------------------------------------
// SESSION_LIST_TOGGLE: desktop renders "Show N more" as a session-styled row
// (15.5dp light title at 0.8 opacity, same 34dp geometry, no chevron).
// ---------------------------------------------------------------------------

export function SessionListToggleRow({
  label,
  quick,
  onPress,
}: {
  label: string;
  /** Quick rows use the flat title inset; card rows use the card inset. */
  quick: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        toggleStyles.row,
        quick ? toggleStyles.rowQuick : toggleStyles.rowCard,
        pressed ? toggleStyles.rowPressed : null,
      ]}
      onPress={onPress}
    >
      <Text style={toggleStyles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const toggleStyles = StyleSheet.create({
  row: {
    height: ds(34),
    justifyContent: 'center',
    opacity: 0.8,
    borderRadius: ds(5),
  },
  rowCard: {
    paddingLeft: ds(26),
  },
  rowQuick: {
    paddingLeft: ds(47),
  },
  rowPressed: {
    backgroundColor: 'rgba(200,205,213,0.06)',
  },
  label: {
    color: '#B4B8C0',
    fontSize: ds(15.5),
    fontWeight: '300',
    lineHeight: ds(20),
  },
});
