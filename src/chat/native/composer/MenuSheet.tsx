/**
 * The chat's row menus on the phone: More actions, the option pills' menus, the attach sheet. Rows
 * have the shape desktop's `show_chat_menu` draws (`option_menu/render.rs`): `heading`,
 * `separator`, `label` + `description` / `detail`, `checked`, `disabled`, `iconPath`, `icon` (an
 * agent mark), a `command` to run, `children` for a submenu (a pushed page here), and the two
 * panel rows `accounts` (the Accounts & limits panel) and `context` (the context window panel).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import { AccountsPanel } from './AccountsPanel';
import { ContextPanel } from './ContextPanel';
import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';

export type MenuRow = { [key: string]: unknown };

/** `titlebar/<name>.svg` to a glyph this file can draw, or null. */
export function glyphForIconPath(iconPath: unknown): GlyphName | null {
  if (typeof iconPath !== 'string') return null;
  const name = iconPath.replace(/^.*\//u, '').replace(/\.svg$/u, '');
  const aliases: Record<string, GlyphName> = { 'eye-filled': 'eye', loader2: 'loader', 'folder-open': 'folder', code: 'file' };
  const glyph = aliases[name] ?? name;
  return isGlyph(glyph) ? glyph : null;
}

const KNOWN_GLYPHS = new Set<string>([
  'dots', 'list-details', 'list-check', 'note', 'stack-push', 'paperclip', 'terminal-2', 'arrow-up', 'refresh', 'pencil',
  'trash', 'loader', 'x', 'check', 'file-text', 'file', 'folder', 'photo', 'camera', 'eye', 'eye-off', 'leaf', 'clock',
  'clock-check', 'layout-columns', 'file-export', 'git-branch', 'moon', 'switch-horizontal', 'maximize', 'minimize',
  'settings', 'copy', 'star', 'search', 'link', 'bolt', 'map', 'brain', 'arrow-back-up', 'sparkles',
]);

function isGlyph(name: string): name is GlyphName {
  return KNOWN_GLYPHS.has(name);
}

type Page = { title?: string; rows: MenuRow[] };

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
};

export function MenuSheet({ rows, title, onClose, onCommand, header, onDismissed }: MenuSheetProps) {
  const styles = useStyles();
  const [stack, setStack] = useState<Page[]>([]);
  useEffect(() => {
    setStack([]);
  }, [rows]);
  const page: Page | null = stack.length > 0 ? stack[stack.length - 1]! : rows !== null ? { title, rows } : null;
  const rootIsPanel = page !== null && page.rows.length === 1 && (obj(page.rows[0])?.accounts !== undefined || obj(page.rows[0])?.context !== undefined);

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
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={rootIsPanel ? styles.panelContent : styles.content}>
          {stack.length === 0 ? header : null}
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

function MenuRowView({
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
  const accounts = obj(row.accounts);
  if (accounts !== null) return <AccountsPanel panel={accounts} onCommand={(command, keep) => onRun(command, keep)} />;
  const context = obj(row.context);
  if (context !== null) return <ContextPanel context={context} onCommand={(command) => onRun(command, false)} />;
  const label = str(row, 'label');
  if (isTrue(row, 'heading')) {
    const description = str(row, 'description');
    return (
      <View style={styles.heading}>
        <Text style={styles.headingText}>{label}</Text>
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
  const glyph = glyphForIconPath(row.iconPath);
  const AgentIcon = typeof row.icon === 'string' ? AGENT_ICONS[row.icon] : undefined;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ disabled, checked }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        if (children !== null) onOpen({ title: label, rows: children });
        else if (command !== null) onRun(command, isTrue(row, 'keepOpen'));
      }}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null, disabled ? styles.rowDisabled : null]}
    >
      {glyph !== null ? (
        <Glyph name={glyph} size={17} color={P.primary} />
      ) : AgentIcon !== undefined ? (
        <AgentIcon size={17} color={P.primary} />
      ) : null}
      <View style={styles.rowText}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        {description.length > 0 ? (
          <Text style={styles.description} numberOfLines={3}>
            {description}
          </Text>
        ) : null}
      </View>
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

/** The rows under a heading, keyed for React, for callers that build menus from arrays. */
export function rowsOf(value: unknown): MenuRow[] {
  return arr(value).filter((row): row is MenuRow => obj(row) !== null);
}

const useStyles = themedStyles((P) => ({
  content: { paddingHorizontal: 8, paddingBottom: 8 },
  panelContent: { paddingHorizontal: 16, paddingBottom: 12 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: P.menuBorder, marginVertical: 6, marginHorizontal: 8 },
  heading: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, gap: 2 },
  headingText: { color: P.muted, fontSize: 12, fontWeight: '600' },
  headingDescription: { color: P.muted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  rowPressed: { backgroundColor: P.controlPressed },
  rowDisabled: { opacity: 0.45 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: P.foreground, fontSize: 15 },
  description: { color: P.muted, fontSize: 12.5, lineHeight: 17 },
  detail: { color: P.muted, fontSize: 13, maxWidth: 140 },
}));
