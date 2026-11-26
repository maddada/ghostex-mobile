/**
 * Group sessions by tags in the Unified list: a group's header (the entry's symbol in its colour, its name and its
 * count of top-level cards, on a band of its colour) and, with Group by project on, a project's heading inside a
 * group. Both are headings, not controls: they neither fold nor drag, and only a heading's "+" does something.
 *
 * The symbols and colours are the six states' of the approved status-groups design, the same as the desktop's
 * (apps/desktop/src/app/native_sidebar/unified/), whose dark colours are the card status marks' own; a light
 * appearance takes darker shades that keep the name 4.5:1 and the symbol 3:1 against the band.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GhostexCustomSessionTags, GhostexProjectIcon } from '../../../contract/mobileSummary';
import type { GroupColorToken, SessionGroupHeader as Header } from '../../../contract/unified/sessionGroups';
import { resolveSessionTag } from '../../../contract/sessionTags';
import { SessionGroupsCopy } from '../../../copy';
import { colorWithOpacity, SidebarPalette } from '../../../theme/palette';
import { PlusGlyph, TagGlyph } from '../icons';
import { ds, inkStyleSheets, inkWash, useSidebarInk, type SidebarInk } from '../rows';
import {
  AlertCircleGlyph,
  AlertTriangleGlyph,
  CircleDashedGlyph,
  HelpCircleGlyph,
  StatusCircleCheckGlyph,
  StatusCircleGlyph,
} from './glyphs';
import { RepoTile } from './UnifiedCard';

/** Each state colour, dark (the design's) and light. */
const GROUP_COLORS: Readonly<Record<GroupColorToken, { dark: string; light: string }>> = {
  '--failure': { dark: SidebarPalette.ROW_FAILED, light: '#C81E1E' },
  '--question': { dark: SidebarPalette.ROW_QUESTION, light: '#BE185D' },
  '--attention': { dark: SidebarPalette.ROW_ATTENTION, light: '#0369A1' },
  '--working': { dark: SidebarPalette.ROW_WORKING, light: '#8A5A00' },
  '--background-work': { dark: SidebarPalette.ROW_BACKGROUND_WORK, light: '#4B5563' },
};

/** Each status symbol of the design (its `assets.svg` id), drawn from the desktop's Tabler shapes. */
const STATUS_GLYPHS: Readonly<Record<string, typeof AlertTriangleGlyph>> = {
  'alert-triangle': AlertTriangleGlyph,
  'help-circle': HelpCircleGlyph,
  'alert-circle': AlertCircleGlyph,
  'circle-check': StatusCircleCheckGlyph,
  'circle-dashed': CircleDashedGlyph,
  'state-idle': StatusCircleGlyph,
};

export function groupColor(token: GroupColorToken, ink: SidebarInk): string {
  return ink.light ? GROUP_COLORS[token].light : GROUP_COLORS[token].dark;
}

/** The header's symbol: a status's own, a hand tag's icon, or the tag outline for No tag. */
function HeaderSymbol({
  header,
  catalog,
  color,
}: {
  header: Header;
  catalog: GhostexCustomSessionTags | undefined;
  color: string;
}) {
  const size = ds(16);
  if (header.kind === 'status') {
    const Glyph = STATUS_GLYPHS[header.symbol] ?? StatusCircleGlyph;
    return <Glyph size={size} color={color} />;
  }
  const Icon =
    header.kind === 'tag' ? (resolveSessionTag({ sessionTag: header.id }, catalog)?.Icon ?? TagGlyph) : TagGlyph;
  return <Icon size={size} color={color} />;
}

/** A group's header: a band of its colour with rules above and below, the symbol, the name and the count. */
export function SessionGroupHeader({
  header,
  catalog,
}: {
  header: Header;
  catalog: GhostexCustomSessionTags | undefined;
}) {
  const ink = useSidebarInk();
  const styles = groupStyles(ink);
  const color = groupColor(header.colorToken, ink);
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={SessionGroupsCopy.headerLabel(header.name, header.count)}
      style={[styles.band, { backgroundColor: colorWithOpacity(color, 8), borderColor: colorWithOpacity(color, 26) }]}
    >
      <HeaderSymbol header={header} catalog={catalog} color={color} />
      <Text style={styles.name}>{header.name}</Text>
      <Text style={styles.count}>{header.count}</Text>
    </View>
  );
}

/** A project's heading inside a group: its tile, name and "+" for a new session there, and its share of the count. */
export function SessionGroupProjectHeading({
  label,
  icon,
  count,
  onNew,
}: {
  label: string;
  icon: GhostexProjectIcon | null;
  count: number;
  onNew: () => void;
}) {
  const ink = useSidebarInk();
  const styles = groupStyles(ink);
  return (
    <View style={styles.project}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={SessionGroupsCopy.headerLabel(label, count)}
        style={styles.projectTitle}
      >
        <RepoTile icon={icon} label={label} />
        <Text numberOfLines={1} style={styles.projectLabel}>
          {label}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={SessionGroupsCopy.newSessionIn(label)}
        onPress={onNew}
        style={({ pressed }) => [styles.projectNew, pressed ? styles.projectNewPressed : null]}
      >
        <PlusGlyph size={ds(14)} color={ink.muted} />
      </Pressable>
      <Text style={styles.projectCount}>{count}</Text>
    </View>
  );
}

const groupStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    band: {
      marginTop: ds(6),
      minHeight: 36,
      paddingHorizontal: ds(9),
      paddingVertical: ds(6),
      flexDirection: 'row',
      alignItems: 'center',
      gap: ds(8),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    name: { flex: 1, minWidth: 0, color: ink.selectedText, fontSize: ds(13.5), fontWeight: '600' },
    count: { color: ink.selectedText, fontSize: ds(13), fontWeight: '700', fontVariant: ['tabular-nums'] },
    project: {
      marginLeft: ds(9),
      marginRight: ds(3),
      minHeight: 44,
      paddingLeft: ds(6),
      flexDirection: 'row',
      alignItems: 'center',
      gap: ds(6),
    },
    projectTitle: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: ds(6) },
    projectLabel: { flex: 1, minWidth: 0, color: ink.muted, fontSize: ds(13), fontWeight: '400' },
    projectNew: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    projectNewPressed: { backgroundColor: inkWash(ink, 0.06) },
    projectCount: { color: ink.muted, fontSize: ds(13), fontWeight: '300', paddingRight: ds(6) },
  }),
);
