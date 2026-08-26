/**
 * Non-session drawer row renderers, cloned from the desktop gpui reference
 * sidebar (packages/core-ui/styles/hierarchy-panels.css + group-panels.css branched
 * skin): SECTION_LABEL ("Quick"/"Projects"), collection headers and their
 * colored rails, project headers with the identity icon plus the terminal /
 * agent split / actions buttons, empty rows, named-group headers, the
 * in-project Browser / Pinned / Sessions kind disclosures, and MACHINE_HEADER.
 *
 * Row text is weight 300 because the desktop reference layout forces
 * `font-weight: 300 !important` globally; the collection and project titles
 * are the documented exceptions (800 and 700 in hierarchy-panels.css), which
 * is the only thing separating them from a session title of the same size.
 */

import { useRef, type ReactNode, type RefObject } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import { COMMAND_ICONS, PROJECT_FALLBACK_ICONS } from '../../assets/tablerIcons.generated';
import {
  resolveAgentIconId,
  type GhostexAgentLauncher,
  type GhostexProjectIcon,
  type GhostexQuickAction,
} from '../../contract/mobileSummary';
import { GhostexPalette, mixHexColors, SidebarPalette } from '../../theme/palette';
import type { MenuAnchor } from './ContextMenu';
import {
  CaretRightGlyph,
  ChevronDownGlyph,
  ChevronRightGlyph,
  MoreGlyph,
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

// ---------------------------------------------------------------------------
// Branched project rails (desktop `[data-project-group-style="branched"]` in
// packages/core-ui/styles/hierarchy-panels.css). A collection is marked by a 2dp rail in
// its own color at 18%, with a short horizontal branch reaching from that rail
// to each member project's header; nested cards carry no border or fill of
// their own. Top-level projects show the same branch marker derived from their
// workspace theme color without inventing a parent rail.
//
// The desktop draws both with negatively-offset ::before pseudo-elements. RN
// gives no reliable cross-platform guarantee for a child painted outside its
// parent's box, so the branch is real layout here: a fixed-width leading column
// beside the card, which lands on the same pixels without any overflow.
// ---------------------------------------------------------------------------

/** Rail + branch width, and the gutter each reserves. */
export const PROJECT_RAIL_WIDTH = ds(2);
export const COLLECTION_BRANCH_WIDTH = ds(18);
export const TOP_LEVEL_BRANCH_WIDTH = ds(13);
/** Vertical center of a project header row, where its branch meets the card. */
const PROJECT_HEADER_CENTER = ds(15);

/** Collection rail / branch color: the collection color at 18% over the page. */
export function projectRailColor(color: string, sidebarBackground: string): string {
  if (color === 'transparent') {
    return mixHexColors(SidebarPalette.FOREGROUND, sidebarBackground, 18);
  }
  return mixHexColors(color, sidebarBackground, 18);
}

/** Collection header chip fill: the collection color at 18%. */
export function collectionHeaderTint(color: string, sidebarBackground: string): string {
  return projectRailColor(color, sidebarBackground);
}

/**
 * The leading column that carries one project's branch. `trailingGap` keeps the
 * line from touching the project icon, matching the desktop's 4px stop-short.
 */
export function ProjectBranch({
  color,
  width,
}: {
  color: string;
  width: number;
}) {
  return (
    <View style={{ width }}>
      <View
        style={[
          branchStyles.line,
          { backgroundColor: color, right: ds(4), top: PROJECT_HEADER_CENTER - ds(1) },
        ]}
      />
    </View>
  );
}

const branchStyles = StyleSheet.create({
  line: {
    position: 'absolute',
    left: 0,
    height: ds(2),
  },
});

// ---------------------------------------------------------------------------
// Project identity icon, mirroring SidebarV2ProjectIcon's resolution chain:
// a user-attached image, then the icon the project's own repository ships,
// then a typed Tabler glyph, then the folder / worktree fallback.
// ---------------------------------------------------------------------------

/** Default glyph tint: the same muted header color the desktop glyph uses. */
const PROJECT_GLYPH_COLOR = mixHexColors(SidebarPalette.FOREGROUND, SidebarPalette.MUTED, 72);

export function ProjectIcon({
  icon,
  size = ds(16),
}: {
  icon: GhostexProjectIcon;
  size?: number;
}) {
  const imageUri =
    icon.imageDataUrl.length > 0
      ? icon.imageDataUrl
      : icon.discoveredIconDataUrl.length > 0
        ? icon.discoveredIconDataUrl
        : '';
  if (imageUri.length > 0) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={{ width: size, height: size, borderRadius: ds(3) }}
        resizeMode="contain"
      />
    );
  }
  const Glyph =
    (icon.glyph.length > 0 ? COMMAND_ICONS[icon.glyph] : undefined) ??
    PROJECT_FALLBACK_ICONS[icon.isWorktree ? 'worktree' : 'folder'];
  const color = icon.glyphColor.length > 0 ? icon.glyphColor : PROJECT_GLYPH_COLOR;
  return <Glyph size={size} color={color} strokeWidth={1.8} />;
}

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
// Header square buttons (desktop .group-add-button): 22×22, radius 6, neutral
// card fill and 14dp icon. The agent split-button is a 24+17 joined pair.
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
    backgroundColor: 'rgba(200,205,213,0.10)',
    borderColor: 'rgba(200,205,213,0.28)',
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
// MACHINE_HEADER: muted 12dp ALL-CAPS; " …" suffix when collapsed, collapsed
// status counts, and an always-visible trailing overflow button (mobile-only
// multi-machine construct, kept from the previous drawer).
// ---------------------------------------------------------------------------

export function MachineHeaderRow({
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
      style={machineHeaderStyles.row}
      onPress={onPress}
      onLongPress={() => measurePress(rowRef, onMenu)}
    >
      <Text style={machineHeaderStyles.title} numberOfLines={1}>
        {`${title.toUpperCase()}${collapsed ? ' …' : ''}`}
      </Text>
      <View style={machineHeaderStyles.trailing}>
        {collapsed ? (
          <StatusCountPills
            workingCount={workingCount}
            attentionCount={attentionCount}
            awakeCount={awakeCount}
          />
        ) : null}
        <HeaderButton accessibilityLabel={`${title} options`} onAnchorPress={onMenu}>
          <MoreGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
        </HeaderButton>
      </View>
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
    alignItems: 'flex-end',
    flexDirection: 'row',
  },
  title: {
    color: GhostexPalette.MUTED,
    fontSize: ds(12),
    fontWeight: '300',
    letterSpacing: 0.9,
    minWidth: 0,
    flexShrink: 1,
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: ds(8),
    marginStart: 'auto',
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
  workingCount,
  attentionCount,
  awakeCount,
  first,
  onToggle,
  onCreate,
  onMenu,
}: {
  title: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
  awakeCount: number;
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
      <View style={sectionStyles.trailing}>
        {collapsed ? (
          <StatusCountPills
            workingCount={workingCount}
            attentionCount={attentionCount}
            awakeCount={awakeCount}
          />
        ) : null}
        <View style={sectionStyles.actions}>
          {onCreate !== undefined ? (
            <HeaderButton accessibilityLabel={`Create a session in ${title}`} onPress={onCreate}>
              <TerminalGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
            </HeaderButton>
          ) : null}
        </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(2),
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: ds(8),
    marginStart: 'auto',
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
    fontSize: ds(15.55),
    fontWeight: '800',
    letterSpacing: 0.2,
    lineHeight: ds(20),
  },
});

// ---------------------------------------------------------------------------
// PROJECT_HEADER (desktop project card .group-head): flat 30dp row at the top
// of the card — project identity icon, 15.55dp/700 title, collapsed count pills,
// and (expanded) the desktop button cluster: Show less chevron, Actions,
// Create Terminal, and the agent split-button. The always-visible overflow
// button and a long-press both open the project menu (desktop right-click).
// ---------------------------------------------------------------------------

export function ProjectHeaderRow({
  title,
  icon,
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
  /** Project identity, ranked by ProjectIcon like the desktop header does. */
  icon: GhostexProjectIcon;
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
      <View style={projectHeaderStyles.icon}>
        <ProjectIcon icon={icon} />
      </View>
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
        <HeaderButton accessibilityLabel={`${title} options`} onAnchorPress={onMenu}>
          <MoreGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
        </HeaderButton>
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
    borderRadius: ds(5),
    gap: ds(10),
  },
  rowPressed: {
    backgroundColor: 'rgba(200,205,213,0.06)',
  },
  icon: {
    width: ds(16),
    height: ds(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * Desktop project titles share the session row's type size and differ only in
   * weight (hierarchy-panels.css: 15.55px / 700, letter-spacing 0.01em), so the
   * hierarchy never relies on smaller text.
   */
  title: {
    flexShrink: 1,
    color: TITLE_COLOR,
    fontSize: ds(15.55),
    fontWeight: '700',
    letterSpacing: 0.2,
    lineHeight: ds(20),
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
// light muted title, trailing "(count)" when collapsed, and an always-visible
// overflow button. Long-press also opens the group menu (desktop right-click).
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
        {title}
      </Text>
      <View style={groupHeaderStyles.trailing}>
        {collapsed ? <Text style={groupHeaderStyles.count}>({count})</Text> : null}
        <HeaderButton accessibilityLabel={`${title} options`} onAnchorPress={onMenu}>
          <MoreGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
        </HeaderButton>
      </View>
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
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: ds(6),
    marginStart: 'auto',
  },
  count: {
    color: SidebarPalette.MUTED,
    fontSize: ds(13),
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.16,
  },
});

// ---------------------------------------------------------------------------
// SESSION_KIND_LABEL: desktop .session-kind-toggle — an uppercase 8dp/500
// label at 34% foreground with a trailing chevron that rotates to 90deg when
// its kind is expanded. The desktop hit target is limited to the label's own
// content width (`width: max-content`); the phone keeps that but pads the
// touch area vertically so the 10dp text is still tappable.
// ---------------------------------------------------------------------------

export function SessionKindLabelRow({
  label,
  collapsed,
  onPress,
}: {
  label: string;
  collapsed: boolean;
  onPress: () => void;
}) {
  return (
    <View style={kindLabelStyles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        hitSlop={{ top: ds(4), bottom: ds(4), left: ds(6), right: ds(10) }}
        style={({ pressed }) => [
          kindLabelStyles.button,
          pressed ? kindLabelStyles.buttonPressed : null,
        ]}
        onPress={onPress}
      >
        <Text style={kindLabelStyles.label} numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
        <ChevronRightGlyph size={ds(12)} color={KIND_LABEL_COLOR} rotated={!collapsed} />
      </Pressable>
    </View>
  );
}

/** Desktop color-mix(fg 34%, transparent) for the kind label + chevron. */
const KIND_LABEL_COLOR = 'rgba(200,205,213,0.34)';

const kindLabelStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingTop: ds(3),
    paddingLeft: ds(5),
    paddingRight: ds(10),
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(5),
    borderRadius: ds(3),
  },
  buttonPressed: {
    opacity: 0.6,
  },
  label: {
    color: KIND_LABEL_COLOR,
    fontSize: ds(8),
    fontWeight: '500',
    letterSpacing: ds(8) * 0.04,
    lineHeight: ds(14),
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
