/**
 * The chat's row menus on the phone: More actions, the option pills' menus, the attach sheet. Rows
 * have the shape desktop's `show_chat_menu` draws (`option_menu/render.rs`): `heading`,
 * `separator`, `label` + `description` / `detail` / `badge` (a count circle after the label), `info` (an (i) at the
 * row's end, or a heading's, that shows its text on a tap without running the row), `checked`, `disabled`, `destructive` (label and glyph in the error colour), `iconPath`, `icon` (an
 * agent mark), a `command` to run, `children` for a submenu (a pushed page here), the two
 * panel rows `accounts` (the Accounts & limits panel) and `context` (the context window panel), and `tiles`, the quick
 * row of the one session menu (session-menu/layout.ts): its rows side by side, each an icon over a label of up to two
 * lines. A row may also carry `iconColor` (a tag's colour), and an icon id this file has no glyph for is drawn from the
 * session menus' shared map (session-menu/glyphs.tsx).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import { AccountsPanel } from './AccountsPanel';
import { ContextPanel } from './ContextPanel';
import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str } from './json';
import { themedStyles, useTranscriptTheme, type TranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';
import { sessionMenuIcon } from '../../../session-menu/glyphs';
import { InfoHint } from '../transcript/InfoHint';

export type MenuRow = { [key: string]: unknown };

/** `titlebar/<name>.svg` to a glyph this file can draw, or null. */
export function glyphForIconPath(iconPath: unknown): GlyphName | null {
  if (typeof iconPath !== 'string') return null;
  const name = iconPath.replace(/^.*\//u, '').replace(/\.svg$/u, '');
  const aliases: Record<string, GlyphName> = {
    'eye-filled': 'eye',
    loader2: 'loader',
    code: 'file',
  };
  const glyph = aliases[name] ?? name;
  return isGlyph(glyph) ? glyph : null;
}

const KNOWN_GLYPHS = new Set<string>([
  'headset',
  'dots',
  'list-details',
  'list-check',
  'note',
  'stack-push',
  'paperclip',
  'terminal-2',
  'arrow-up',
  'refresh',
  'pencil',
  'trash',
  'loader',
  'x',
  'check',
  'file-text',
  'file',
  'folder',
  'folder-open',
  'git-fork',
  'git-branch',
  'plus',
  'stack',
  'photo',
  'camera',
  'eye',
  'eye-off',
  'leaf',
  'message-circle',
  'clock',
  'clock-check',
  'layout-columns',
  'file-export',
  'git-branch',
  'moon',
  'switch-horizontal',
  'maximize',
  'minimize',
  'settings',
  'copy',
  'hash',
  'quote',
  'star',
  'star-filled',
  'cloud',
  'search',
  'link',
  'bolt',
  'map',
  'brain',
  'book',
  'arrow-back-up',
  'sparkles',
  'blockquote',
  'world',
  'share',
  'microphone',
  'player-stop',
  'volume',
  'player-play',
  'mode-advance',
  'mode-pause',
  'file-diff',
  'logout',
  'axe',
  'robot',
  'folders',
  'edit',
  'history',
  'circle-half',
  'adjustments-horizontal',
  'arrows-diagonal-minimize',
  'wand',
  'puzzle',
  'terminal',
  'file-down',
  'file-up',
  'alarm-off',
]);

function isGlyph(name: string): name is GlyphName {
  return KNOWN_GLYPHS.has(name);
}

type Page = { title?: string; rows: MenuRow[] };

/**
 * A search over a sheet's rows (the bar's branch and worktree lists): a field above them that keeps
 * the rows whose label holds what is typed and the headings of the sections still showing. With
 * `create` (This folder's branch), a name no row is called adds "Create <name> from <from>", whose
 * command carries the name as `folderBranch` (gx-chat-core `menus/folder_branch.rs`).
 */
export type MenuSearch = { placeholder: string; create?: { from: string; command: MenuRow } | null };

export function searchRows(rows: MenuRow[], query: string, create: MenuSearch['create']): MenuRow[] {
  const typed = query.trim();
  const needle = typed.toLowerCase();
  if (needle.length === 0) return rows;
  const kept: MenuRow[] = [];
  let heading: MenuRow | null = null;
  for (const row of rows) {
    if (isTrue(row, 'heading')) {
      heading = row;
      continue;
    }
    if (!str(row, 'label').toLowerCase().includes(needle)) continue;
    if (heading !== null) {
      kept.push(heading);
      heading = null;
    }
    kept.push(row);
  }
  const exact = kept.some((row) => !isTrue(row, 'heading') && str(row, 'label') === typed);
  if (create && !exact && !/\s/u.test(typed)) {
    kept.push({
      label: `Create ${typed} from ${create.from}`,
      iconPath: 'titlebar/plus.svg',
      command: { ...create.command, folderBranch: typed },
    });
  }
  return kept;
}

export type MenuSheetProps = {
  /** Null closes the sheet. */
  rows: MenuRow[] | null;
  title?: string;
  onClose: () => void;
  /** Runs a row's command. Return true to keep the sheet open. */
  onCommand: (command: MenuRow) => boolean | void;
  /** Extra content above the rows (the attach sheet's source buttons). */
  header?: ReactNode;
  /** iOS: the sheet finished going away (see `Sheet`). */
  onDismissed?: () => void;
  /** A search field over the rows (`MenuSearch`). */
  search?: MenuSearch | null;
};

export function MenuSheet({ rows, title, onClose, onCommand, header, onDismissed, search }: MenuSheetProps) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [stack, setStack] = useState<Page[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    setStack([]);
    setQuery('');
  }, [rows]);
  const searched = useMemo(
    () => (rows !== null && search ? searchRows(rows, query, search.create ?? null) : rows),
    [rows, query, search],
  );
  const page: Page | null =
    stack.length > 0 ? stack[stack.length - 1]! : searched !== null ? { title, rows: searched } : null;
  const rootIsPanel =
    page !== null &&
    page.rows.length === 1 &&
    (obj(page.rows[0])?.accounts !== undefined || obj(page.rows[0])?.context !== undefined);

  const run = (command: MenuRow, keepOpen: boolean): void => {
    const keep = onCommand(command) === true || keepOpen;
    if (!keep) onClose();
  };

  return (
    <Sheet
      visible={page !== null}
      onClose={onClose}
      {...(onDismissed !== undefined ? { onDismissed } : {})}
      {...(page?.title !== undefined ? { title: page.title } : {})}
      {...(stack.length > 0 ? { onBack: () => setStack(stack.slice(0, -1)) } : {})}
    >
      {page !== null ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={rootIsPanel ? styles.panelContent : styles.content}
        >
          {stack.length === 0 ? header : null}
          {stack.length === 0 && search ? (
            <TextInput
              accessibilityLabel={search.placeholder}
              placeholder={search.placeholder}
              placeholderTextColor={P.muted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              style={styles.search}
            />
          ) : null}
          {stack.length === 0 && search && page.rows.length === 0 ? <Text style={styles.empty}>No matches</Text> : null}
          {page.rows.map((row, index) => (
            <MenuRowView
              key={`${index}:${str(row, 'id') || str(row, 'label')}`}
              row={row}
              onRun={run}
              onOpen={(child) => setStack([...stack, child])}
            />
          ))}
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

export function MenuRowView({
  row,
  onRun,
  onOpen,
}: {
  row: MenuRow;
  onRun: (command: MenuRow, keepOpen: boolean) => void;
  onOpen: (page: Page) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  if (isTrue(row, 'separator')) return <View style={styles.separator} />;
  if (Array.isArray(row.tiles)) return <MenuTilesView tiles={rowsOf(row.tiles)} onRun={onRun} onOpen={onOpen} />;
  const accounts = obj(row.accounts);
  if (accounts !== null) return <AccountsPanel panel={accounts} onCommand={(command, keep) => onRun(command, keep)} />;
  const context = obj(row.context);
  if (context !== null) return <ContextPanel context={context} onCommand={(command) => onRun(command, false)} />;
  const label = str(row, 'label');
  const destructive = isTrue(row, 'destructive');
  if (isTrue(row, 'heading')) {
    const description = str(row, 'description');
    const headingInfo = str(row, 'info');
    return (
      <View style={styles.heading}>
        <View style={styles.headingLine}>
          <Text style={[styles.headingText, styles.labelText]}>{label}</Text>
          {headingInfo.length > 0 ? <InfoHint hint={headingInfo} style={styles.info} /> : null}
        </View>
        {description.length > 0 ? <Text style={styles.headingDescription}>{description}</Text> : null}
      </View>
    );
  }
  const children = Array.isArray(row.children) ? (row.children as MenuRow[]) : null;
  const command = obj(row.command);
  const disabled = isTrue(row, 'disabled') || (children === null && command === null);
  const checked = row.checked === true;
  const description = str(row, 'description');
  const detail = typeof row.detail === 'string' ? row.detail : '';
  const badge = str(row, 'badge');
  const info = str(row, 'info');
  const glyph = glyphForIconPath(row.iconPath);
  const sharedIcon = menuRowSharedIcon(row, glyph, destructive ? P.error : P.primary, 17);
  // A trigger character (`/`, `@`, `+`) in the icon's place: the key that opens the picker.
  const character = str(row, 'character');
  const AgentIcon = typeof row.icon === 'string' ? AGENT_ICONS[row.icon] : undefined;
  // A lifecycle dot instead of a glyph (the fork branch list), tinted as `branch_dot_color` does.
  const dot = typeof row.dot === 'string' ? row.dot : null;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ disabled, checked }}
      accessibilityLabel={label}
      // VoiceOver reads the row as one element, so its (i) text is the row's hint.
      {...(info.length > 0 ? { accessibilityHint: info.replace(/\n/gu, ' ') } : {})}
      disabled={disabled}
      onPress={() => {
        if (children !== null) onOpen({ title: label, rows: children });
        else if (command !== null) onRun(command, isTrue(row, 'keepOpen'));
      }}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null, disabled ? styles.rowDisabled : null]}
    >
      {character.length > 0 ? (
        <Text style={styles.character} accessibilityElementsHidden importantForAccessibility="no">
          {character}
        </Text>
      ) : sharedIcon !== undefined ? (
        sharedIcon
      ) : glyph !== null ? (
        <Glyph name={glyph} size={17} color={destructive ? P.error : P.primary} />
      ) : AgentIcon !== undefined ? (
        <AgentIcon size={17} color={P.primary} />
      ) : null}
      {dot !== null ? <View style={[styles.dot, { backgroundColor: branchDotColor(dot, P) }]} /> : null}
      <View style={styles.rowText}>
        <View style={styles.labelLine}>
          <Text style={[styles.label, styles.labelText, destructive ? { color: P.error } : null]} numberOfLines={2}>
            {label}
          </Text>
          {badge.length > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {description.length > 0 ? (
          <Text style={styles.description} numberOfLines={3}>
            {description}
          </Text>
        ) : null}
      </View>
      {info.length > 0 ? <InfoHint hint={info} style={styles.info} /> : null}
      {detail.length > 0 ? (
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      {checked ? <Glyph name="check" size={17} color={P.foreground} /> : null}
      {children !== null ? <Glyph name="chevron-right" size={16} color={P.muted} /> : null}
    </Pressable>
  );
}

/**
 * The glyph of a row whose icon this file cannot draw, or a tag row (its colour and its tag's glyph), from the session
 * menus' shared map; undefined leaves the row to this file's own glyphs.
 */
function menuRowSharedIcon(row: MenuRow, glyph: GlyphName | null, color: string, size: number): ReactNode | undefined {
  const iconColor = typeof row.iconColor === 'string' ? row.iconColor : undefined;
  if (glyph !== null && iconColor === undefined) return undefined;
  if (typeof row.iconPath !== 'string') return undefined;
  const name = row.iconPath.replace(/^.*\//u, '').replace(/\.svg$/u, '');
  return sessionMenuIcon(name, { size, color, ...(iconColor !== undefined ? { iconColor } : {}) });
}

/**
 * From this font scale on, the tiles show their icons only, as the session card's quick row does
 * (components/sessions/ContextMenu.tsx `QUICK_ICONS_ONLY_FONT_SCALE`); VoiceOver and TalkBack still read each label.
 */
const TILES_ICONS_ONLY_FONT_SCALE = 1.3;

/** The quick row of tiles (Rename, Files & Links, Side Chat…): side by side, an icon over a label of up to two lines. */
function MenuTilesView({
  tiles,
  onRun,
  onOpen,
}: {
  tiles: MenuRow[];
  onRun: (command: MenuRow, keepOpen: boolean) => void;
  onOpen: (page: Page) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { fontScale } = useWindowDimensions();
  const iconsOnly = fontScale >= TILES_ICONS_ONLY_FONT_SCALE;
  return (
    <View style={styles.tiles}>
      {tiles.map((tile, index) => {
        const label = str(tile, 'label');
        const children = Array.isArray(tile.children) ? (tile.children as MenuRow[]) : null;
        const command = obj(tile.command);
        const disabled = isTrue(tile, 'disabled') || (children === null && command === null);
        const checked = tile.checked === true;
        const glyph = glyphForIconPath(tile.iconPath);
        const icon =
          menuRowSharedIcon(tile, glyph, P.primary, 18) ??
          (glyph !== null ? <Glyph name={glyph} size={18} color={P.primary} /> : null);
        return (
          <Pressable
            key={`${index}:${label}`}
            accessibilityRole="menuitem"
            accessibilityState={{ disabled, checked }}
            accessibilityLabel={label}
            disabled={disabled}
            onPress={() => {
              if (children !== null) onOpen({ title: label, rows: children });
              else if (command !== null) onRun(command, isTrue(tile, 'keepOpen'));
            }}
            style={({ pressed }) => [
              styles.tile,
              iconsOnly ? styles.tileIconOnly : null,
              checked ? styles.tileChecked : null,
              pressed ? styles.tilePressed : null,
              disabled ? styles.rowDisabled : null,
            ]}
          >
            {icon}
            {iconsOnly ? null : (
              <Text style={styles.tileLabel} numberOfLines={2}>
                {label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A fork branch's lifecycle tone (`branch_dot_color` in desktop's `fork_branches.rs`). */
export function branchDotColor(tone: string, P: TranscriptTheme): string {
  if (tone === 'running') return '#10b981';
  return P.mutedInk(tone === 'sleeping' ? 0.6 : 0.35);
}

/** The rows under a heading, keyed for React, for callers that build menus from arrays. */
export function rowsOf(value: unknown): MenuRow[] {
  return arr(value).filter((row): row is MenuRow => obj(row) !== null);
}

const useStyles = themedStyles((P) => ({
  content: { paddingHorizontal: 8, paddingBottom: 8 },
  search: {
    marginHorizontal: 4,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: P.menuBorder,
    color: P.foreground,
    fontSize: 15,
  },
  empty: { color: P.muted, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  panelContent: { paddingHorizontal: 16, paddingBottom: 12 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: P.menuBorder,
    marginVertical: 6,
    marginHorizontal: 8,
  },
  heading: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, gap: 2 },
  headingLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headingText: { color: P.muted, fontSize: 12, fontWeight: '600' },
  headingDescription: { color: P.muted, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  rowPressed: { backgroundColor: P.controlPressed },
  // The quick row, styled like the session card's (components/sessions/ContextMenu.tsx `quickRow`).
  tiles: { flexDirection: 'row', gap: 6, paddingHorizontal: 4, paddingTop: 2, paddingBottom: 6 },
  tile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: P.controlPressed,
  },
  tileIconOnly: { paddingVertical: 12 },
  tileChecked: { borderWidth: StyleSheet.hairlineWidth, borderColor: P.menuBorder },
  tilePressed: { opacity: 0.7 },
  tileLabel: { color: P.foreground, fontSize: 12, lineHeight: 15, textAlign: 'center' },
  rowDisabled: { opacity: 0.45 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: P.foreground, fontSize: 15 },
  labelLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelText: { flexShrink: 1 },
  // The composer toolbar's count badge (NativeComposer `badge`), in line after the label.
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: P.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: P.background, fontSize: 11, lineHeight: 13, fontWeight: '600' },
  description: { color: P.muted, fontSize: 12.5, lineHeight: 17 },
  detail: { color: P.muted, fontSize: 13, maxWidth: 140 },
  info: { alignSelf: 'center' },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  character: { width: 17, color: P.primary, fontSize: 18, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
}));
