/**
 * One block of a sidebar extension's panel on the phone (contract/extensionPanels.ts): rows, an editable checklist, a
 * map, a progress bar, text, buttons and an empty state, drawn with the sessions list's own row geometry and ink
 * (rows.tsx). A map is always the indented tree here: the phone is narrower than the desktop's two-column map.
 *
 * Taps run the item's action; everything else an item offers (its own menu, a checklist item's Rename and Delete, a
 * project's or a session's usual menu) opens on a long press, never as an always-visible button.
 *
 * CDXC:Extensions 2026-11-14 SEE-ALSO: apps/desktop/src/app/native_sidebar/extension_panel/ (the desktop's blocks).
 */

import { useRef, useState, type ReactElement } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import type { MenuAnchor } from '../components/sessions/ContextMenu';
import { measureInWindow } from '../components/common/measureInWindow';
import { CircleCheckGlyph, PlusGlyph } from '../components/sessions/icons';
import {
  TOUCH_ROW_HEIGHT,
  ds,
  inkStyleSheets,
  inkWash,
  useSidebarInk,
  type SidebarInk,
} from '../components/sessions/rows';
import { SidebarPalette } from '../theme/palette';
import {
  TEXT_PREVIEW_LINES,
  parseText,
  type ChecklistItem,
  type PanelAction,
  type PanelBlock,
  type PanelDot,
  type PanelRow,
  type TextLine,
} from '../contract/extensionPanels';
import { PanelIcon } from './panelIcons';

/** Which extension, on which computer, a block belongs to. */
export type PanelPlace = {
  machineId: string;
  extensionId: string;
  granted: readonly string[];
  revision: number;
};

/** What the phone knows about a project or session an item names, from the computer's sessions list. */
export type PanelRefFacts = { title: string; dot: string | null };

export type PanelHandlers = {
  run: (place: PanelPlace, blockId: string, itemId: string | undefined, action: PanelAction) => void;
  /** Long press on a row or map item: its own menu, then the project's or session's menu. */
  rowMenu: (place: PanelPlace, blockId: string, row: PanelRow, anchor: MenuAnchor) => void;
  /** Long press on a checklist item: its own menu, then Rename and Delete while editable. */
  itemMenu: (place: PanelPlace, blockId: string, item: ChecklistItem, editable: boolean, anchor: MenuAnchor) => void;
  check: (place: PanelPlace, blockId: string, item: ChecklistItem, done: boolean) => void;
  add: (place: PanelPlace, blockId: string) => void;
  /** A tick the computer has not confirmed yet wins over the item's `done`. */
  done: (place: PanelPlace, blockId: string, item: ChecklistItem) => boolean;
  project: (place: PanelPlace, reference: string) => PanelRefFacts | null;
  session: (place: PanelPlace, reference: string) => PanelRefFacts | null;
};

const DOT_COLORS: Record<PanelDot, string> = {
  green: '#4ADE80',
  yellow: SidebarPalette.ROW_WORKING,
  red: SidebarPalette.ROW_FAILED,
  blue: SidebarPalette.ROW_ATTENTION,
  gray: '#64748B',
};

export default function PanelBlockView({
  block,
  place,
  handlers,
  heading = true,
}: {
  block: PanelBlock;
  place: PanelPlace;
  handlers: PanelHandlers;
  /** A section in the Projects list draws its heading like the list's own section headings. */
  heading?: boolean;
}): ReactElement {
  const ink = useSidebarInk();
  const styles = blockInkStyles(ink);
  const { body } = block;
  const trailing =
    body.type === 'checklist' && body.items.length > 0
      ? `${body.items.filter((item) => handlers.done(place, block.id, item)).length}/${body.items.length}`
      : null;
  // An empty block's title is its message.
  const title = heading && body.type !== 'empty' ? block.title : undefined;
  return (
    <View style={styles.block}>
      {title !== undefined ? (
        <View style={styles.heading} accessibilityRole="header">
          <Text style={styles.headingText} numberOfLines={1}>
            {title}
          </Text>
          {trailing !== null ? <Text style={styles.headingText}>{trailing}</Text> : null}
        </View>
      ) : null}
      {body.type === 'rows'
        ? body.items.map((row, index) => (
            <PanelRowView
              key={row.id ?? `row-${index}`}
              row={row}
              blockId={block.id}
              place={place}
              handlers={handlers}
            />
          ))
        : null}
      {body.type === 'checklist' ? (
        <>
          {body.items.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              editable={body.editable}
              blockId={block.id}
              place={place}
              handlers={handlers}
            />
          ))}
          {body.editable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add item"
              onPress={() => handlers.add(place, block.id)}
              style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
            >
              <View style={styles.slot}>
                <PlusGlyph size={ds(14)} color={ink.muted} />
              </View>
              <Text style={[styles.title, styles.mutedText]}>Add item</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {body.type === 'map' ? (
        <View>
          {body.root !== undefined ? (
            <View style={styles.row}>
              <View style={styles.slot}>
                <PanelIcon name={body.root.icon} size={ds(15)} color={ink.muted} />
              </View>
              <Text style={[styles.title, styles.strong]} numberOfLines={1}>
                {body.root.title}
              </Text>
              {body.root.subtitle !== undefined ? (
                <Text style={styles.trailing} numberOfLines={1}>
                  {body.root.subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}
          {body.groups.map((group, groupIndex) => (
            <View key={`${group.title}-${groupIndex}`} style={body.root !== undefined ? styles.indent : null}>
              <View style={styles.row}>
                <View style={styles.slot}>
                  <PanelIcon name={group.icon ?? 'folder'} size={ds(14)} color={ink.muted} />
                </View>
                <Text style={[styles.title, styles.mutedText]} numberOfLines={1}>
                  {group.title}
                </Text>
                {group.subtitle !== undefined ? (
                  <Text style={styles.trailing} numberOfLines={1}>
                    {group.subtitle}
                  </Text>
                ) : null}
              </View>
              <View style={styles.indent}>
                {group.items.map((row, index) => (
                  <PanelRowView
                    key={row.id ?? `item-${index}`}
                    row={row}
                    blockId={block.id}
                    place={place}
                    handlers={handlers}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {body.type === 'progress' ? <Progress value={body.value} max={body.max} label={body.label} ink={ink} /> : null}
      {body.type === 'text' ? <PanelText source={body.text} ink={ink} /> : null}
      {body.type === 'buttons' ? (
        <View style={styles.buttons}>
          {body.items.map((button, index) => (
            <Pressable
              key={button.id ?? `button-${index}`}
              accessibilityRole="button"
              onPress={() => handlers.run(place, block.id, button.id, button.action)}
              style={({ pressed }) => [
                styles.button,
                button.style === 'primary' ? styles.buttonPrimary : null,
                pressed ? styles.rowPressed : null,
              ]}
            >
              <PanelIcon name={button.icon} size={ds(13)} color={ink.text} />
              <Text style={styles.buttonText} numberOfLines={1}>
                {button.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {body.type === 'empty' ? (
        <View style={styles.empty}>
          <PanelIcon name={body.icon} size={ds(20)} color={ink.muted} />
          {block.title !== undefined ? <Text style={styles.emptyTitle}>{block.title}</Text> : null}
          {body.subtitle !== undefined ? <Text style={styles.emptySubtitle}>{body.subtitle}</Text> : null}
          {body.action !== undefined ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => handlers.run(place, block.id, undefined, body.action!)}
              style={({ pressed }) => [styles.button, pressed ? styles.rowPressed : null]}
            >
              <Text style={styles.buttonText}>Open</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A row of a rows block or an item of a map group; a `project` or `session` item shows the computer's own name and dot. */
function PanelRowView({
  row,
  blockId,
  place,
  handlers,
}: {
  row: PanelRow;
  blockId: string;
  place: PanelPlace;
  handlers: PanelHandlers;
}): ReactElement {
  const ink = useSidebarInk();
  const styles = blockInkStyles(ink);
  const ref = useRef<ViewInstance | null>(null);
  let title = row.title ?? '';
  let dot = row.dot !== undefined ? DOT_COLORS[row.dot] : null;
  let open: PanelAction | undefined;
  let missing = false;
  let isRef = false;
  if (row.project !== undefined) {
    isRef = true;
    const facts = handlers.project(place, row.project);
    if (facts === null) missing = true;
    else {
      title = row.title ?? facts.title;
      dot = facts.dot;
      open = { kind: 'openProject', project: row.project };
    }
    if (title.length === 0) title = row.project;
  } else if (row.session !== undefined) {
    isRef = true;
    const facts = handlers.session(place, row.session);
    if (facts === null) missing = true;
    else {
      title = row.title ?? facts.title;
      dot = facts.dot;
      open = { kind: 'focusSession', session: row.session };
    }
    if (title.length === 0) title = 'Session not found';
  }
  // A row's own action wins over opening what it names.
  const action = row.action ?? open;
  const hasMenu = row.menu !== undefined || (isRef && !missing);
  const icon = row.icon ?? (row.project !== undefined ? 'folder' : row.session !== undefined ? 'message' : undefined);
  const content = (
    <>
      <View style={styles.slot}>
        {dot !== null ? (
          <View style={[styles.dot, { backgroundColor: dot }]} />
        ) : (
          <PanelIcon name={icon} size={ds(14)} color={ink.muted} />
        )}
      </View>
      <View style={styles.texts}>
        <Text style={[styles.title, missing ? styles.mutedText : null]} numberOfLines={1}>
          {title}
        </Text>
        {row.subtitle !== undefined ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {row.subtitle}
          </Text>
        ) : null}
      </View>
      {row.badge !== undefined ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{row.badge}</Text>
        </View>
      ) : null}
      {row.trailing !== undefined ? (
        <Text style={styles.trailing} numberOfLines={1}>
          {row.trailing}
        </Text>
      ) : null}
    </>
  );
  if (action === undefined && !hasMenu) {
    return <View style={[styles.row, row.subtitle !== undefined ? styles.rowTall : null]}>{content}</View>;
  }
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityHint={hasMenu ? 'Touch and hold for more' : undefined}
      onPress={action === undefined ? undefined : () => handlers.run(place, blockId, row.id, action)}
      onLongPress={
        hasMenu ? () => measureInWindow(ref, (anchor) => handlers.rowMenu(place, blockId, row, anchor)) : undefined
      }
      style={({ pressed }) => [
        styles.row,
        row.subtitle !== undefined ? styles.rowTall : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

function ChecklistRow({
  item,
  editable,
  blockId,
  place,
  handlers,
}: {
  item: ChecklistItem;
  editable: boolean;
  blockId: string;
  place: PanelPlace;
  handlers: PanelHandlers;
}): ReactElement {
  const ink = useSidebarInk();
  const styles = blockInkStyles(ink);
  const ref = useRef<ViewInstance | null>(null);
  const done = handlers.done(place, blockId, item);
  const hasMenu = editable || item.menu !== undefined;
  // A tap ticks an editable item; on a read-only list it runs the item's action.
  const onPress = editable
    ? () => handlers.check(place, blockId, item, !done)
    : item.action !== undefined
      ? () => handlers.run(place, blockId, item.id, item.action!)
      : undefined;
  return (
    <Pressable
      ref={ref}
      accessibilityRole={editable ? 'checkbox' : 'button'}
      accessibilityState={{ checked: done }}
      accessibilityHint={hasMenu ? 'Touch and hold for more' : undefined}
      disabled={onPress === undefined && !hasMenu}
      onPress={onPress}
      onLongPress={
        hasMenu
          ? () => measureInWindow(ref, (anchor) => handlers.itemMenu(place, blockId, item, editable, anchor))
          : undefined
      }
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.slot}>
        {done ? <CircleCheckGlyph size={ds(15)} color={ink.muted} /> : <View style={styles.circle} />}
      </View>
      <Text style={[styles.title, done ? styles.doneText : null]} numberOfLines={2}>
        {item.text}
      </Text>
    </Pressable>
  );
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function Progress({
  value,
  max,
  label,
  ink,
}: {
  value: number;
  max: number;
  label?: string;
  ink: SidebarInk;
}): ReactElement {
  const styles = blockInkStyles(ink);
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const amount = max === 100 ? `${Math.round(fraction * 100)}%` : `${trimNumber(value)} of ${trimNumber(max)}`;
  return (
    <View
      style={styles.progress}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      accessibilityLabel={label ?? amount}
    >
      {/* The panel's label, or how far along it is when it gives none (never both: a label usually says the same). */}
      <Text style={[styles.progressLabel, label === undefined ? styles.mutedText : null]} numberOfLines={1}>
        {label ?? amount}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}

function PanelText({ source, ink }: { source: string; ink: SidebarInk }): ReactElement {
  const styles = blockInkStyles(ink);
  const [expanded, setExpanded] = useState(false);
  const lines = parseText(source);
  const truncated = !expanded && lines.length > TEXT_PREVIEW_LINES;
  const shown = truncated ? lines.slice(0, TEXT_PREVIEW_LINES) : lines;
  return (
    <View style={styles.text}>
      {shown.map((line, index) => (
        <TextLineView key={index} line={line} ink={ink} />
      ))}
      {truncated ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} hitSlop={ds(6)}>
          <Text style={[styles.paragraph, styles.mutedText]}>Show more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TextLineView({ line, ink }: { line: TextLine; ink: SidebarInk }): ReactElement {
  const styles = blockInkStyles(ink);
  if (line.kind === 'gap') return <View style={styles.gap} />;
  const spans = line.spans.map((span, index) => (
    <Text
      key={index}
      style={[
        span.bold ? styles.strong : null,
        span.italic ? styles.italic : null,
        span.code ? styles.code : null,
        span.link !== undefined ? styles.link : null,
      ]}
      onPress={span.link === undefined ? undefined : () => void Linking.openURL(span.link!).catch(() => {})}
    >
      {span.text}
    </Text>
  ));
  if (line.kind === 'bullet') {
    return (
      <View style={styles.bulletLine}>
        <Text style={[styles.paragraph, styles.mutedText]}>{line.number !== undefined ? `${line.number}.` : '•'}</Text>
        <Text style={[styles.paragraph, styles.bulletText]}>{spans}</Text>
      </View>
    );
  }
  return <Text style={styles.paragraph}>{spans}</Text>;
}

const blockInkStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    block: {
      paddingBottom: ds(8),
    },
    /* The list's section heading look (rows.tsx SessionKindLabelRow), in sentence case. */
    heading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: ds(6),
      height: ds(24),
      paddingLeft: ds(5),
      paddingRight: ds(6),
    },
    headingText: {
      color: ink.sectionLabel,
      fontSize: ds(12),
      fontWeight: '400',
      lineHeight: ds(16),
    },
    /* A session card's box (SessionRow): 44pt, 5px corners. */
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: TOUCH_ROW_HEIGHT,
      paddingLeft: ds(5),
      paddingRight: ds(6),
      gap: ds(8),
      borderRadius: ds(5),
    },
    rowTall: {
      paddingVertical: ds(4),
    },
    rowPressed: {
      backgroundColor: inkWash(ink, 0.06),
    },
    slot: {
      width: ds(16),
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      width: ds(7),
      height: ds(7),
      borderRadius: ds(3.5),
    },
    circle: {
      width: ds(12),
      height: ds(12),
      borderRadius: ds(6),
      borderWidth: 1.5,
      borderColor: ink.muted,
    },
    texts: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      flex: 1,
      color: ink.text,
      fontSize: ds(15.55),
      fontWeight: '300',
      lineHeight: ds(20),
    },
    strong: {
      fontWeight: '600',
    },
    italic: {
      fontStyle: 'italic',
    },
    mutedText: {
      color: ink.muted,
    },
    doneText: {
      color: ink.muted,
      textDecorationLine: 'line-through',
    },
    subtitle: {
      color: ink.muted,
      fontSize: ds(12.5),
      lineHeight: ds(16),
    },
    trailing: {
      flexShrink: 0,
      maxWidth: '40%',
      color: ink.muted,
      fontSize: ds(12.5),
      lineHeight: ds(16),
    },
    badge: {
      paddingHorizontal: ds(6),
      borderRadius: ds(8),
      backgroundColor: inkWash(ink, 0.1),
    },
    badgeText: {
      color: ink.text,
      fontSize: ds(11.5),
      lineHeight: ds(16),
    },
    /* A map's groups sit a step in from its root, and their items a step in from the group. */
    indent: {
      marginLeft: ds(12),
      paddingLeft: ds(6),
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: ink.threadLine,
    },
    buttons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: ds(6),
      paddingHorizontal: ds(5),
      paddingTop: ds(2),
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: ds(5),
      minHeight: ds(32),
      paddingHorizontal: ds(10),
      borderRadius: ds(6),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: inkWash(ink, 0.18),
    },
    buttonPrimary: {
      backgroundColor: inkWash(ink, 0.1),
    },
    buttonText: {
      color: ink.text,
      fontSize: ds(13),
      lineHeight: ds(17),
    },
    empty: {
      alignItems: 'center',
      gap: ds(6),
      paddingVertical: ds(14),
      paddingHorizontal: ds(10),
    },
    emptyTitle: {
      color: ink.text,
      fontSize: ds(14),
      fontWeight: '500',
      textAlign: 'center',
    },
    emptySubtitle: {
      color: ink.muted,
      fontSize: ds(12.5),
      lineHeight: ds(17),
      textAlign: 'center',
    },
    progress: {
      gap: ds(5),
      paddingHorizontal: ds(6),
      paddingVertical: ds(4),
    },
    progressLabel: {
      color: ink.text,
      fontSize: ds(12.5),
      lineHeight: ds(16),
    },
    track: {
      height: ds(4),
      borderRadius: ds(2),
      backgroundColor: inkWash(ink, 0.1),
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: ds(2),
      backgroundColor: inkWash(ink, 0.55),
    },
    text: {
      gap: ds(2),
      paddingHorizontal: ds(6),
    },
    paragraph: {
      color: ink.text,
      fontSize: ds(13.5),
      lineHeight: ds(19),
    },
    bulletLine: {
      flexDirection: 'row',
      gap: ds(6),
    },
    bulletText: {
      flex: 1,
    },
    code: {
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
      fontSize: ds(12.5),
      backgroundColor: inkWash(ink, 0.08),
    },
    link: {
      textDecorationLine: 'underline',
    },
    gap: {
      height: ds(8),
    },
  }),
);
