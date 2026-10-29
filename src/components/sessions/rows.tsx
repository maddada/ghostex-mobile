/**
 * Non-session drawer row renderers, cloned from the desktop gpui reference
 * sidebar (packages/core-ui/styles/hierarchy-panels.css + group-panels.css branched
 * skin): SECTION_LABEL ("Projects"), collection headers and their
 * colored rails, project headers with the identity icon plus the terminal /
 * agent split / actions buttons, empty rows, named-group headers, the
 * in-project Browser / Pinned / Sessions kind disclosures, and MACHINE_HEADER.
 *
 * Row text is weight 300 because the desktop reference layout forces
 * `font-weight: 300 !important` globally; the collection and project titles
 * are the documented exceptions (800 and 700 in hierarchy-panels.css), which
 * is the only thing separating them from a session title of the same size.
 */

import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import { COMMAND_ICONS } from '../../assets/tablerIcons.generated';
import {
  agentIconTint,
  resolveAgentArtId,
  type GhostexAgentLauncher,
  type GhostexProjectIcon,
} from '../../contract/mobileSummary';
import type { SectionStatusCounts } from '../../contract/grouping';
import { decodeBase64Utf8 } from '../../docs/remoteFiles';
import { GhostexPalette, mixHexColors, SidebarPalette } from '../../theme/palette';
import type { MenuAnchor } from './ContextMenu';
import {
  CaretRightGlyph,
  ChevronDownGlyph,
  ChevronRightGlyph,
  FolderGlyph,
  MoreGlyph,
  PlusGlyph,
  TerminalGlyph,
} from './icons';

/** The desktop sidebar's text and muted colors (appearance.rs, dark), which the phone's list draws with. */
export const SIDEBAR_TEXT = '#B4B8C0';
export const SIDEBAR_MUTED = '#7C828C';

/**
 * The phone's touch height for a session row and a project or group header: the desktop's 34 and 30
 * times DRAWER_SCALE fall under the 44pt a finger needs, so both are raised to it (approved design
 * docs/2026-10-21/phone-sessions-screen/sessions-like-sidebar.html).
 */
export const TOUCH_ROW_HEIGHT = 44;

/** Sessions page base surface (the resolved sidebar appearance paints over it). */
export const SIDEBAR_BACKGROUND = '#0B0B0B';

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

/**
 * CDXC:SessionStatus 2026-10-20 DECISION:
 * User: "make all the dots same size (pink one needs to be bigger a bit)". Every status dot is this size, the desktop's `STATUS_DOT_SIZE` (native_sidebar/status.rs): working, attention, question, background work and failed, on session rows, section headings and the overlapping tab stack. The project header's count badges (a 6dp legend dot beside a number) are not status dots.
 */
export const STATUS_DOT_SIZE = 8;

/** Neutral expanded-group fill: mix(sidebar bg 96%, black 4%). */
export function expandedGroupBackground(sidebarBackground: string): string {
  return mixHexColors(sidebarBackground, '#000000', 96);
}

// ---------------------------------------------------------------------------
// Branched project rails (desktop `[data-project-group-style="branched"]` in
// packages/core-ui/styles/hierarchy-panels.css). A collection is marked by a 2dp rail in
// its own color at 18%, with a short horizontal branch reaching from that rail
// to each member project's header; nested cards carry no border or fill of
// their own. A top-level project has no branch (the desktop's native sidebar
// draws none), so it starts at the list's left edge.
//
// The desktop draws both with negatively-offset ::before pseudo-elements. RN
// gives no reliable cross-platform guarantee for a child painted outside its
// parent's box, so the branch is real layout here: a fixed-width leading column
// beside the card, which lands on the same pixels without any overflow.
// ---------------------------------------------------------------------------

/** Rail + branch width, and the gutter each reserves. */
export const PROJECT_RAIL_WIDTH = ds(2);
export const COLLECTION_BRANCH_WIDTH = ds(18);
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
export function ProjectBranch({ color, width }: { color: string; width: number }) {
  return (
    <View style={{ width }}>
      <View style={[branchStyles.line, { backgroundColor: color, right: ds(4), top: PROJECT_HEADER_CENTER - ds(1) }]} />
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

/**
 * The SVG markup inside an `image/svg+xml` data URL, or null for any other URL.
 *
 * CDXC:Icons 2026-10-05 WHY: gxserver publishes a repository's `favicon.svg` as an SVG data URL (the desktop sidebar draws it), but RN's Image cannot decode SVG on Android and drew an empty box for such projects (mastro_ed). SVG icons go through react-native-svg instead, and any icon that still fails to load falls back to the folder glyph.
 */
function svgXmlFromDataUrl(uri: string): string | null {
  const match = /^data:image\/svg\+xml(;[^,]*)?,/i.exec(uri);
  if (match === null) return null;
  const payload = uri.slice(match[0].length);
  try {
    return /;base64/i.test(match[1] ?? '') ? decodeBase64Utf8(payload) : decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/** Default glyph tint: the same muted header color the desktop glyph uses. */
const PROJECT_GLYPH_COLOR = mixHexColors(SidebarPalette.FOREGROUND, SidebarPalette.MUTED, 72);

/**
 * The first letter of a name on a muted square, in the project icon's slot (desktop project_header.rs `letter_tile`: muted at 12%, the muted letter, 10px semibold, 3px corners).
 */
export function LetterTile({ title, size = ds(16) }: { title: string; size?: number }) {
  const letter = title.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[letterStyles.tile, { width: size, height: size }]}>
      <Text style={letterStyles.letter}>{letter}</Text>
    </View>
  );
}

const letterStyles = StyleSheet.create({
  tile: {
    borderRadius: ds(3),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,130,140,0.12)',
  },
  letter: {
    color: SIDEBAR_MUTED,
    fontSize: ds(10),
    lineHeight: ds(16),
    fontWeight: '600',
  },
});

/**
 * A project's icon: its image, the icon its repository ships, a typed glyph, else the first letter of
 * its name (desktop CDXC:Icons 2026-09-24, which replaced the folder for a project with no icon).
 */
export function ProjectIcon({
  icon,
  title,
  size = ds(16),
}: {
  icon: GhostexProjectIcon;
  title: string;
  size?: number;
}) {
  const imageUri =
    icon.imageDataUrl.length > 0
      ? icon.imageDataUrl
      : icon.discoveredIconDataUrl.length > 0
        ? icon.discoveredIconDataUrl
        : '';
  const [failedUri, setFailedUri] = useState('');
  const svgXml = useMemo(() => svgXmlFromDataUrl(imageUri), [imageUri]);
  if (imageUri.length > 0 && failedUri !== imageUri) {
    if (svgXml !== null) {
      return (
        <View style={{ width: size, height: size, borderRadius: ds(3), overflow: 'hidden' }}>
          <SvgXml xml={svgXml} width={size} height={size} onError={() => setFailedUri(imageUri)} />
        </View>
      );
    }
    return (
      <Image
        source={{ uri: imageUri }}
        style={{ width: size, height: size, borderRadius: ds(3) }}
        resizeMode="contain"
        onError={() => setFailedUri(imageUri)}
      />
    );
  }
  const Glyph = icon.glyph.length > 0 ? COMMAND_ICONS[icon.glyph] : undefined;
  if (Glyph === undefined) return <LetterTile title={title} size={size} />;
  const color = icon.glyphColor.length > 0 ? icon.glyphColor : PROJECT_GLYPH_COLOR;
  return <Glyph size={size} color={color} strokeWidth={1.8} />;
}

/** Section label color: fg at 52%. */
const SECTION_LABEL_COLOR = 'rgba(200,205,213,0.52)';

// ---------------------------------------------------------------------------
// Collapsed header status, drawn as the desktop sidebar draws it
// (ProjectStatusCounts, CollectionStatusCounts, SectionStatusDots).
// ---------------------------------------------------------------------------

/** Desktop sidebar text color (appearance.rs `foreground`, dark). */
const HEADER_STATUS_TEXT = '#B4B8C0';

export type HeaderStatusCounts = {
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  /** Sessions waiting for approval: the red count (project_status.rs). */
  approvalCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
};

function ProjectStatusBadge({ count, dotColor }: { count: number; dotColor: string | null }) {
  return (
    <View style={statusStyles.badge}>
      {dotColor !== null ? <View style={[statusStyles.badgeDot, { backgroundColor: dotColor }]} /> : null}
      <Text style={statusStyles.count}>{count}</Text>
    </View>
  );
}

/**
 * apps/desktop/src/app/native_sidebar/project_status.rs `project_status`, collapsed branch.
 *
 * CDXC:SessionStatus 2026-09-25 DECISION:
 * User: "Please make the indicators for sessions status in the RN session list match gpui one exactly". A collapsed header shows the desktop header's status in its order and sizes: project, user-made group and Quick headers use project_status.rs (a 6dp dot and the number in the sidebar text color: orange working, blue attention, pink question, grey background work when nothing works, then a dotless awake count when nothing works or waits); collection headers use collections.rs (the numbers alone, in those colors); in-project section headings use sections.rs (8dp dots: orange, blue, grey, pink question, a hollow ring when the selected session is inside, then the section's count at the right edge). The orange is the desktop's one working color. This supersedes the phone's haloed #F8AD07 and #95D7F6 count pills and the named group's "(count)".
 */
export function ProjectStatusCounts({
  workingCount,
  attentionCount,
  questionCount,
  approvalCount,
  backgroundWorkCount,
  awakeCount,
}: HeaderStatusCounts) {
  if (workingCount === 0 && attentionCount === 0 && questionCount === 0 && approvalCount === 0 && awakeCount === 0) {
    return null;
  }
  return (
    <View style={statusStyles.projectCluster}>
      {workingCount > 0 ? <ProjectStatusBadge count={workingCount} dotColor={SidebarPalette.ROW_WORKING} /> : null}
      {attentionCount > 0 ? (
        <ProjectStatusBadge count={attentionCount} dotColor={SidebarPalette.ROW_ATTENTION} />
      ) : null}
      {questionCount > 0 ? <ProjectStatusBadge count={questionCount} dotColor={SidebarPalette.ROW_QUESTION} /> : null}
      {approvalCount > 0 ? <ProjectStatusBadge count={approvalCount} dotColor={SidebarPalette.ROW_APPROVAL} /> : null}
      {workingCount === 0 && backgroundWorkCount > 0 ? (
        <ProjectStatusBadge count={backgroundWorkCount} dotColor={SidebarPalette.ROW_BACKGROUND_WORK} />
      ) : null}
      {workingCount === 0 && attentionCount === 0 && questionCount === 0 && approvalCount === 0 && awakeCount > 0 ? (
        <ProjectStatusBadge count={awakeCount} dotColor={null} />
      ) : null}
    </View>
  );
}

/** apps/desktop/src/app/native_sidebar/collections.rs: a collapsed collection's colored numbers. */
function CollectionStatusCounts({
  workingCount,
  attentionCount,
  questionCount,
  approvalCount,
  backgroundWorkCount,
  awakeCount,
}: HeaderStatusCounts) {
  const counts: { key: string; count: number; color: string }[] = [];
  if (workingCount > 0) counts.push({ key: 'working', count: workingCount, color: SidebarPalette.ROW_WORKING });
  if (attentionCount > 0) {
    counts.push({ key: 'attention', count: attentionCount, color: SidebarPalette.ROW_ATTENTION });
  }
  if (questionCount > 0) counts.push({ key: 'question', count: questionCount, color: SidebarPalette.ROW_QUESTION });
  if (approvalCount > 0) counts.push({ key: 'approval', count: approvalCount, color: SidebarPalette.ROW_APPROVAL });
  if (workingCount === 0 && backgroundWorkCount > 0) {
    counts.push({ key: 'background', count: backgroundWorkCount, color: SidebarPalette.ROW_BACKGROUND_WORK });
  }
  if (workingCount === 0 && attentionCount === 0 && questionCount === 0 && approvalCount === 0 && awakeCount > 0) {
    counts.push({ key: 'awake', count: awakeCount, color: HEADER_STATUS_TEXT });
  }
  if (counts.length === 0) return null;
  return (
    <View style={statusStyles.collectionCluster}>
      {counts.map((entry) => (
        <Text key={entry.key} style={[statusStyles.count, { color: entry.color }]}>
          {entry.count}
        </Text>
      ))}
    </View>
  );
}

/** apps/desktop/src/app/native_sidebar/sections.rs: a collapsed section heading's dots. */
function SectionStatusDots({ status, active }: { status: SectionStatusCounts; active: boolean }) {
  const dots: { key: string; color: string }[] = [];
  if (status.workingCount > 0) dots.push({ key: 'working', color: SidebarPalette.ROW_WORKING });
  if (status.attentionCount > 0) dots.push({ key: 'attention', color: SidebarPalette.ROW_ATTENTION });
  if (status.workingCount === 0 && status.backgroundWorkCount > 0) {
    dots.push({ key: 'background', color: SidebarPalette.ROW_BACKGROUND_WORK });
  }
  if (status.questionCount > 0) dots.push({ key: 'question', color: SidebarPalette.ROW_QUESTION });
  if (status.approvalCount > 0) dots.push({ key: 'approval', color: SidebarPalette.ROW_APPROVAL });
  if (dots.length === 0 && !active) return null;
  return (
    <View style={statusStyles.sectionDots}>
      {dots.map((dot) => (
        <View key={dot.key} style={[statusStyles.sectionDot, { backgroundColor: dot.color }]} />
      ))}
      {active ? <View style={statusStyles.activeRing} /> : null}
    </View>
  );
}

const statusStyles = StyleSheet.create({
  projectCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(7),
    marginStart: 'auto',
  },
  collectionCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(5),
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(3),
  },
  badgeDot: {
    width: ds(6),
    height: ds(6),
    borderRadius: 999,
  },
  count: {
    color: HEADER_STATUS_TEXT,
    fontSize: ds(10),
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    lineHeight: ds(12),
  },
  sectionDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(4),
  },
  sectionDot: {
    width: ds(STATUS_DOT_SIZE),
    height: ds(STATUS_DOT_SIZE),
    borderRadius: 999,
  },
  /* sections.rs: 9px hollow ring, 1.5px #a3a3a3 border. */
  activeRing: {
    width: ds(9),
    height: ds(9),
    borderRadius: 999,
    borderWidth: ds(1.5),
    borderColor: '#A3A3A3',
  },
});

// ---------------------------------------------------------------------------
// Header buttons (desktop project_header.rs actions, times DRAWER_SCALE): 22×22
// faces 2px apart with 4px corners and 14px muted glyphs, no fill at rest; the
// desktop's hover fill (#808080 at 12%) is the phone's pressed state. The agent
// split is 24 + 17 with the chevron pulled 2px left so the halves touch. Each
// touch area is the header's full 44pt height but only as wide as its button.
// ---------------------------------------------------------------------------

function measurePress(ref: RefObject<ViewInstance | null>, onAnchor: (anchor: MenuAnchor) => void): void {
  const node = ref.current;
  if (node === null) return;
  node.measureInWindow((x, y, width, height) => onAnchor({ x, y, width, height }));
}

type FaceShape = 'whole' | 'start' | 'end';

function faceRadius(shape: FaceShape) {
  return shape === 'start' ? buttonStyles.faceStart : shape === 'end' ? buttonStyles.faceEnd : buttonStyles.faceWhole;
}

function HeaderButton({
  accessibilityLabel,
  onPress,
  onAnchorPress,
  width = ds(22),
  shape = 'whole',
  children,
}: {
  accessibilityLabel: string;
  onPress?: () => void;
  /** When set, the press measures the button and reports its window frame. */
  onAnchorPress?: (anchor: MenuAnchor) => void;
  width?: number;
  shape?: FaceShape;
  children: ReactNode;
}) {
  const ref = useRef<ViewInstance | null>(null);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[buttonStyles.touch, { width }, shape === 'end' ? buttonStyles.touchEnd : null]}
      onPress={() => {
        if (onAnchorPress !== undefined) measurePress(ref, onAnchorPress);
        else onPress?.();
      }}
    >
      {({ pressed }) => (
        <View style={[buttonStyles.face, faceRadius(shape), pressed ? buttonStyles.facePressed : null]}>
          {children}
        </View>
      )}
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
  const iconId =
    primaryAgent === null
      ? 'terminal'
      : resolveAgentArtId(primaryAgent.icon, primaryAgent.name ?? primaryAgent.agentId);
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  return (
    <>
      <HeaderButton
        accessibilityLabel={
          primaryAgent !== null ? `Create ${primaryAgent.name ?? primaryAgent.agentId}` : 'Create agent'
        }
        width={ds(24)}
        shape="start"
        onPress={onLaunchPrimary}
      >
        {/* The agent's own colored logo, as gx-core `colored_agent_logo` gives the desktop's split. */}
        <Icon size={ds(14)} color={agentIconTint(iconId)} />
      </HeaderButton>
      <HeaderButton accessibilityLabel="Select agent" width={ds(17)} shape="end" onAnchorPress={onOpenMenu}>
        <ChevronDownGlyph size={ds(14)} color={SIDEBAR_MUTED} />
      </HeaderButton>
    </>
  );
}

const buttonStyles = StyleSheet.create({
  touch: {
    height: TOUCH_ROW_HEIGHT,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  /* The chevron half reaches 2px back under the agent half so the two faces touch. */
  touchEnd: {
    marginLeft: -ds(2),
  },
  face: {
    height: ds(22),
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceWhole: {
    borderRadius: ds(4),
  },
  faceStart: {
    borderTopLeftRadius: ds(4),
    borderBottomLeftRadius: ds(4),
  },
  faceEnd: {
    borderTopRightRadius: ds(4),
    borderBottomRightRadius: ds(4),
  },
  facePressed: {
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(2),
    flexShrink: 0,
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
  questionCount,
  approvalCount,
  backgroundWorkCount,
  awakeCount,
  onPress,
  onMenu,
}: {
  title: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  approvalCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const rowRef = useRef<ViewInstance | null>(null);
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
          <ProjectStatusCounts
            workingCount={workingCount}
            attentionCount={attentionCount}
            questionCount={questionCount}
            approvalCount={approvalCount}
            backgroundWorkCount={backgroundWorkCount}
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
// SECTION_LABEL (desktop .reference-sidebar-section-row): "Projects",
// 15.5dp light label at fg 52%, filled caret that rotates when expanded.
// Long-press opens the section menu (desktop right-click).
// ---------------------------------------------------------------------------

export function SectionLabelRow({
  title,
  collapsed,
  workingCount,
  attentionCount,
  questionCount,
  approvalCount,
  backgroundWorkCount,
  awakeCount,
  first,
  onToggle,
  onMenu,
  onMoreMenu,
}: {
  title: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  approvalCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
  /** First section after the status header uses the tighter top margin. */
  first: boolean;
  /** Omitted by sections that are always open, which then draw no caret. */
  onToggle?: () => void;
  onMenu?: (anchor: MenuAnchor) => void;
  /** Trailing "⋮" button; the section's discoverable action menu. */
  onMoreMenu?: (anchor: MenuAnchor) => void;
}) {
  const rowRef = useRef<ViewInstance | null>(null);
  return (
    <View ref={rowRef} style={[sectionStyles.row, first ? sectionStyles.rowFirst : null]}>
      <Pressable
        accessibilityRole={onToggle === undefined ? 'header' : 'button'}
        accessibilityLabel={onToggle === undefined ? title : `${collapsed ? 'Expand' : 'Collapse'} ${title}`}
        style={sectionStyles.heading}
        onPress={onToggle}
        onLongPress={onMenu === undefined ? undefined : () => measurePress(rowRef, onMenu)}
      >
        <Text style={sectionStyles.title}>{title}</Text>
        {onToggle !== undefined ? <CaretRightGlyph size={ds(13)} color="#727982" rotated={!collapsed} /> : null}
      </Pressable>
      <View style={sectionStyles.trailing}>
        {collapsed ? (
          <ProjectStatusCounts
            workingCount={workingCount}
            attentionCount={attentionCount}
            questionCount={questionCount}
            approvalCount={approvalCount}
            backgroundWorkCount={backgroundWorkCount}
            awakeCount={awakeCount}
          />
        ) : null}
        <View style={sectionStyles.actions}>
          {onMoreMenu !== undefined ? (
            <HeaderButton accessibilityLabel={`${title} options`} onAnchorPress={onMoreMenu}>
              <MoreGlyph size={ds(14)} color={SidebarPalette.HEADER_BUTTON_ICON} />
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
// The selected card (desktop appearance.rs `session_selected` and decorations.rs
// `session_outline`): a 12% white fill, a 1px white-8% hairline and a faint 1px
// highlight 5px in from each side at the top. A session row, and a collapsed
// project, group or project group holding the open session, carry it.
// ---------------------------------------------------------------------------

/** The selected fill over `surface`, solid so a dot's ring can match it. */
export function selectedFill(surface: string): string {
  return mixHexColors('#FFFFFF', surface, 12);
}

/** The hairline and top highlight drawn over a selected card; `radius` is the card's own. */
export function SelectedCardOutline({ radius = ds(5) }: { radius?: number }) {
  return (
    <>
      <View pointerEvents="none" style={[selectedStyles.outline, { borderRadius: radius }]} />
      <View pointerEvents="none" style={selectedStyles.highlight} />
    </>
  );
}

const selectedStyles = StyleSheet.create({
  outline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  highlight: {
    position: 'absolute',
    top: 1,
    left: ds(5),
    right: ds(5),
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
});

/** Selected text (sessions.rs: #D8D8D8 on a focused or visible row). */
export const SELECTED_TEXT = '#D8D8D8';

// ---------------------------------------------------------------------------
// COLLECTION_HEADER (desktop native_sidebar/collections.rs): a full-width band
// in the project group's color at 18% (drawn by the screen with the rail), the
// light name and no chevron; closed, its numbers in their status colors.
//
// CDXC:Projects 2026-10-27 SEE-ALSO: the 2026-09-19 decision in apps/desktop/src/app/native_sidebar/collections.rs (no chevron on a project group's header); the phone follows it in the approved design docs/2026-10-21/phone-sessions-screen/sessions-like-sidebar.html.
// ---------------------------------------------------------------------------

export function CollectionHeaderRow({
  title,
  collapsed,
  containsActive,
  workingCount,
  attentionCount,
  questionCount,
  approvalCount,
  backgroundWorkCount,
  awakeCount,
  onPress,
  onMenu,
}: {
  title: string;
  collapsed: boolean;
  containsActive: boolean;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  approvalCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const rowRef = useRef<ViewInstance | null>(null);
  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={title}
      style={({ pressed }) => [
        collectionStyles.header,
        containsActive ? collectionStyles.headerActive : null,
        pressed ? collectionStyles.headerPressed : null,
      ]}
      onPress={onPress}
      onLongPress={() => measurePress(rowRef, onMenu)}
    >
      {containsActive ? <SelectedCardOutline /> : null}
      <Text style={collectionStyles.title} numberOfLines={1}>
        {title}
      </Text>
      {collapsed ? (
        <CollectionStatusCounts
          workingCount={workingCount}
          attentionCount={attentionCount}
          questionCount={questionCount}
          approvalCount={approvalCount}
          backgroundWorkCount={backgroundWorkCount}
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
    height: TOUCH_ROW_HEIGHT,
    paddingHorizontal: ds(8),
  },
  headerActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: ds(5),
  },
  headerPressed: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: SIDEBAR_TEXT,
    fontSize: ds(15.55),
    fontWeight: '300',
    lineHeight: ds(20),
  },
});

// ---------------------------------------------------------------------------
// The header box a project and a user-made session group share (desktop
// project_header.rs): 30px tall (44pt here), 5px corners, the chevron in an
// 18px slot inside the box's left edge (a tap on it is the row's tap), a 16px
// icon, a 10px gap and the light name. The box reaches 15px left of where its
// parent places rows, so its icon lines up with the rows' agent icons.
// ---------------------------------------------------------------------------

/** How far a header box reaches left of its block (desktop `PROJECT_HEADER_CHEVRON_INSET`). */
export const HEADER_CHEVRON_INSET = ds(15);

function SidebarHeaderBox({
  title,
  leading,
  collapsed,
  containsActive,
  onToggle,
  onMenu,
  children,
}: {
  title: string;
  leading: ReactNode;
  collapsed: boolean;
  containsActive: boolean;
  onToggle: () => void;
  onMenu: (anchor: MenuAnchor) => void;
  /** What sits after the name: closed, the counts; open, the buttons. */
  children: ReactNode;
}) {
  const rowRef = useRef<ViewInstance | null>(null);
  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={title}
      style={({ pressed }) => [
        headerBoxStyles.row,
        containsActive ? headerBoxStyles.rowActive : null,
        pressed && !containsActive ? headerBoxStyles.rowPressed : null,
      ]}
      onPress={onToggle}
      onLongPress={() => measurePress(rowRef, onMenu)}
    >
      {containsActive ? <SelectedCardOutline /> : null}
      <View pointerEvents="none" style={headerBoxStyles.chevron}>
        <ChevronRightGlyph size={ds(16)} color={SIDEBAR_MUTED} rotated={!collapsed} />
      </View>
      <View style={headerBoxStyles.icon}>{leading}</View>
      <Text style={headerBoxStyles.title} numberOfLines={1}>
        {title}
      </Text>
      {children}
    </Pressable>
  );
}

const headerBoxStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TOUCH_ROW_HEIGHT,
    marginLeft: -HEADER_CHEVRON_INSET,
    marginRight: ds(3),
    paddingLeft: ds(5 + 18),
    paddingRight: ds(6),
    gap: ds(10),
    borderRadius: ds(5),
  },
  rowActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chevron: {
    position: 'absolute',
    left: 0,
    top: (TOUCH_ROW_HEIGHT - ds(16)) / 2,
  },
  icon: {
    width: ds(16),
    height: ds(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: SIDEBAR_TEXT,
    fontSize: ds(15.55),
    fontWeight: '300',
    lineHeight: ds(20),
  },
});

// ---------------------------------------------------------------------------
// PROJECT_HEADER (desktop native_sidebar/project_header.rs, gx-core
// sidebar_menu/header.rs). A phone can't hover, so an open project always
// shows the buttons the desktop shows on hover, in its order: ⋯ menu, New
// terminal, and the agent split (last-used agent plus its picker). A closed
// project shows only its counts, as the desktop does at rest; a long press
// opens the menu either way.
//
// CDXC:Sessions 2026-10-08 DECISION:
// User: "move almost all of the buttons that appear next to an expanded project into the 3 dots menu; just keep the agent picker one and the new agent one."
// CDXC:Sessions 2026-10-20 DECISION:
// User: "add to the left of the 'select agent' combined button a button to start a terminal in that project ... i want it back at top level for each project header", and the phone follows the desktop (confirmed Q356). New Terminal is a header button again, before the agent split; Create Terminal stays in the menu. This supersedes the 2026-10-08 decision for that one button.
// CDXC:Sessions 2026-10-27 DECISION:
// User approved the phone Sessions screen "drawn like the desktop sidebar" (design A, docs/2026-10-21/phone-sessions-screen/sessions-like-sidebar.html): the project name is light like a row, the header buttons have no fill or border at rest, and the ⋯ button shows only while the project is open, since a closed project shows its counts there.
// ---------------------------------------------------------------------------

export function ProjectHeaderRow({
  title,
  icon,
  collapsed,
  containsActive,
  workingCount,
  attentionCount,
  questionCount,
  approvalCount,
  backgroundWorkCount,
  awakeCount,
  primaryAgent,
  onToggle,
  onLaunchPrimary,
  onCreateTerminal,
  onOpenAgentMenu,
  onMenu,
}: {
  title: string;
  /** Project identity, ranked by ProjectIcon like the desktop header does. */
  icon: GhostexProjectIcon;
  collapsed: boolean;
  /** Collapsed with the open session inside. */
  containsActive: boolean;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  approvalCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
  primaryAgent: GhostexAgentLauncher | null;
  onToggle: () => void;
  onLaunchPrimary: () => void;
  onCreateTerminal: () => void;
  onOpenAgentMenu: (anchor: MenuAnchor) => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  return (
    <SidebarHeaderBox
      title={title}
      leading={<ProjectIcon icon={icon} title={title} />}
      collapsed={collapsed}
      containsActive={containsActive}
      onToggle={onToggle}
      onMenu={onMenu}
    >
      {collapsed ? (
        <ProjectStatusCounts
          workingCount={workingCount}
          attentionCount={attentionCount}
          questionCount={questionCount}
          approvalCount={approvalCount}
          backgroundWorkCount={backgroundWorkCount}
          awakeCount={awakeCount}
        />
      ) : (
        <View style={buttonStyles.actions}>
          <HeaderButton accessibilityLabel={`${title} options`} onAnchorPress={onMenu}>
            <MoreGlyph size={ds(14)} color={SIDEBAR_MUTED} />
          </HeaderButton>
          <HeaderButton accessibilityLabel={`New terminal in ${title}`} onPress={onCreateTerminal}>
            <TerminalGlyph size={ds(14)} color={SIDEBAR_MUTED} />
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
    </SidebarHeaderBox>
  );
}

// ---------------------------------------------------------------------------
// PROJECT_EMPTY: an open project with no sessions (desktop native_sidebar/rows.rs):
// a "New Session" row in the session-row geometry whose tap opens a terminal.
// ---------------------------------------------------------------------------

export function ProjectEmptyRow({ text, onPress }: { text: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [emptyStyles.row, pressed ? emptyStyles.rowPressed : null]}
      onPress={onPress}
    >
      <Text style={emptyStyles.text} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

const emptyStyles = StyleSheet.create({
  row: {
    height: TOUCH_ROW_HEIGHT,
    justifyContent: 'center',
    paddingLeft: ds(26),
    borderRadius: ds(5),
  },
  rowPressed: {
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  text: {
    color: SIDEBAR_TEXT,
    fontSize: ds(15.55),
    fontWeight: '300',
    lineHeight: ds(20),
  },
});

// ---------------------------------------------------------------------------
// GROUP_HEADER: a user-made session group, drawn with the project header box
// (desktop project_header.rs for a group with an owner): a folder in the icon
// slot, the light name, closed its counts, open its ⋯ menu and a "+" that opens
// a terminal in the group (gx-core header.rs "Create a Terminal").
//
// CDXC:Icons 2026-10-27 SEE-ALSO: the 2026-10-24 decision in apps/desktop/src/app/native_sidebar/project_header.rs ("Keep the folder" for a session group's header); the phone draws the same folder.
// ---------------------------------------------------------------------------

export function GroupHeaderRow({
  title,
  collapsed,
  containsActive,
  status,
  onPress,
  onMenu,
  onCreateTerminal,
}: {
  title: string;
  collapsed: boolean;
  containsActive: boolean;
  status: HeaderStatusCounts;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
  onCreateTerminal?: () => void;
}) {
  return (
    <SidebarHeaderBox
      title={title}
      leading={<FolderGlyph size={ds(16)} color={SIDEBAR_MUTED} />}
      collapsed={collapsed}
      containsActive={containsActive}
      onToggle={onPress}
      onMenu={onMenu}
    >
      {collapsed ? (
        <ProjectStatusCounts
          workingCount={status.workingCount}
          attentionCount={status.attentionCount}
          questionCount={status.questionCount}
          approvalCount={status.approvalCount}
          backgroundWorkCount={status.backgroundWorkCount}
          awakeCount={status.awakeCount}
        />
      ) : (
        <View style={buttonStyles.actions}>
          <HeaderButton accessibilityLabel={`${title} options`} onAnchorPress={onMenu}>
            <MoreGlyph size={ds(14)} color={SIDEBAR_MUTED} />
          </HeaderButton>
          {onCreateTerminal !== undefined ? (
            <HeaderButton accessibilityLabel={`New terminal in ${title}`} onPress={onCreateTerminal}>
              <PlusGlyph size={ds(14)} color={SIDEBAR_MUTED} />
            </HeaderButton>
          ) : null}
        </View>
      )}
    </SidebarHeaderBox>
  );
}

// ---------------------------------------------------------------------------
// SESSION_KIND_LABEL (desktop native_sidebar/sections.rs): PINNED, SESSIONS,
// DRAFTS, PARKED or BROWSER in 12px light caps at #D8D8D8 34%, 20px tall (25pt
// here), as wide as a session card with its 5px/6px side padding. The desktop
// shows a chevron only on hover; at rest a collapsed heading shows its status
// dots (and a ring when the open session is inside) and its count at the right.
// A tap folds it; the Parked heading's long press opens its menu.
// ---------------------------------------------------------------------------

export function SessionKindLabelRow({
  label,
  collapsed,
  status,
  active,
  onPress,
  onMenu,
}: {
  label: string;
  collapsed: boolean;
  /** sections.rs: the dots and the count show only while the section is collapsed. */
  status: SectionStatusCounts;
  /** The selected session is one of this section's. */
  active: boolean;
  onPress: () => void;
  /** Long press: the heading's menu. Only the Parked heading has one. */
  onMenu?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={`${label} section`}
      hitSlop={{ top: ds(4), bottom: ds(4) }}
      style={({ pressed }) => [kindLabelStyles.row, pressed ? kindLabelStyles.rowPressed : null]}
      onPress={onPress}
      onLongPress={onMenu}
    >
      <Text style={kindLabelStyles.label} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      {collapsed ? (
        <>
          <SectionStatusDots status={status} active={active} />
          <View style={kindLabelStyles.spacer} />
          <Text style={kindLabelStyles.label}>{status.count}</Text>
        </>
      ) : null}
    </Pressable>
  );
}

const kindLabelStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(5),
    height: ds(20),
    paddingLeft: ds(5),
    paddingRight: ds(6),
    borderRadius: ds(5),
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  spacer: {
    flex: 1,
  },
  label: {
    color: 'rgba(216,216,216,0.34)',
    fontSize: ds(12),
    fontWeight: '300',
    letterSpacing: ds(12) * 0.02,
    lineHeight: ds(16),
  },
});

// ---------------------------------------------------------------------------
// A quiet session-styled text row (a coordinator's "N older threads"): 15.5dp
// light title at 0.8 opacity, same 34dp geometry, no chevron.
// ---------------------------------------------------------------------------

/**
 * The pieces of the tree lines that run past a row (coordinatorTree.ts `RowNesting.passingLines`, one
 * bit per level), each straight down beside the row `height` tall; desktop
 * `native_sidebar/threads.rs` `passing_lines`. `levelLeft` places a level's line in the row.
 *
 * CDXC:Coordinators 2026-10-25 WHY: the row a line starts from can be far above the rows it passes, so
 * each row draws its own piece of every line passing it; a piece starts 1dp up inside the row above,
 * which draws the same line there, so two pieces meet without the seam rows drawn apart showed.
 */
export function PassingThreadLines({
  lines,
  levelLeft,
  height,
}: {
  lines: number;
  levelLeft: (level: number) => number;
  height: number;
}) {
  if (lines === 0) return null;
  const pieces: ReactNode[] = [];
  for (let level = 1; 1 << level <= lines; level += 1) {
    if ((lines & (1 << level)) === 0) continue;
    pieces.push(
      <View
        key={level}
        pointerEvents="none"
        style={[passingStyles.piece, { left: levelLeft(level), height: height + ds(1) }]}
      />,
    );
  }
  return <>{pieces}</>;
}

const passingStyles = StyleSheet.create({
  piece: {
    position: 'absolute',
    top: -ds(1),
    width: ds(1),
    backgroundColor: SidebarPalette.ROW_THREAD_LINE,
  },
});

export function SessionListToggleRow({
  label,
  threadDepth,
  passingLines = 0,
  onPress,
}: {
  label: string;
  /**
   * A coordinator's "N older threads" row: the tree level its title lines up with (the thread
   * rows' THREAD_INDENT in SessionRow.tsx), drawn smaller and quieter than "Show N more".
   */
  threadDepth?: number;
  /** On a coordinator's "N older threads" row: the tree lines that run past it. */
  passingLines?: number;
  onPress: () => void;
}) {
  const thread = threadDepth !== undefined;
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        toggleStyles.row,
        toggleStyles.rowCard,
        threadDepth !== undefined ? [toggleStyles.rowThread, { paddingLeft: ds(26) + ds(threadDepth * 16) }] : null,
        pressed ? toggleStyles.rowPressed : null,
      ]}
      onPress={onPress}
    >
      {/* Where a thread row in a card places its line (SessionRow.tsx `ThreadConnector`), term by term. */}
      <PassingThreadLines
        lines={passingLines}
        levelLeft={(level) => ds(5) + ds(level * 16) - ds(16) + ds(7)}
        height={ds(26)}
      />
      <Text style={[toggleStyles.label, thread ? toggleStyles.labelThread : null]} numberOfLines={1}>
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
  rowPressed: {
    backgroundColor: 'rgba(200,205,213,0.06)',
  },
  rowThread: {
    height: ds(26),
  },
  label: {
    color: '#B4B8C0',
    fontSize: ds(15.5),
    fontWeight: '300',
    lineHeight: ds(20),
  },
  labelThread: {
    fontSize: ds(13),
    lineHeight: ds(17),
  },
});
