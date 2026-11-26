import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type ViewInstance,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { measureInWindow } from '../../components/common/measureInWindow';
import ContextMenu from '../../components/sessions/ContextMenu';
import { MenuGlyph } from '../../components/sessions/icons';
import { useSidebarInk } from '../../components/sessions/rows';
import {
  AlertCircleGlyph,
  AlertTriangleGlyph,
  CircleDashedGlyph,
  HelpCircleGlyph,
  StatusCircleCheckGlyph,
  StatusCircleGlyph,
} from '../../components/sessions/unified/glyphs';
import { groupColor } from '../../components/sessions/unified/groupHeaders';
import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import { EMPTY_CUSTOM_SESSION_TAGS } from '../../contract/mobileSummary/model';
import {
  isStatusTagId,
  listedTagItems,
  moveHeldTagItem,
  normalizeTagListItems,
  storedTagListItems,
  type StatusTagId,
  type TagListItem,
} from '../../contract/sessionTagList';
import { SESSION_TAG_SECTIONS } from '../../contract/sessionTags';
import { STATUS_GROUP_LOOK } from '../../contract/unified/sessionGroups';
import { SessionGroupsCopy } from '../../copy';
import { setSidebarSetting } from '../../settingsSync/settingsSync';
import { currentSidebarOrganization } from '../../settingsSync/sidebarOrganization';
import { useAppearance } from '../../theme/useAppearance';
import { SettingsSection } from './SectionBoundary';
import { Caption, SectionHeader, ToggleRow, useSettingsStyles } from './SettingsControls';
import { cancelTagDrag, dropTag, liftTag, type RowFrame, type TagDragDeps, type TagDragState } from './sessionTagDrag';

const BUILTIN_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SESSION_TAG_SECTIONS.flatMap((section) => section.options.map((option) => [option.value, option.label])),
);

const STATUS_GLYPHS: Readonly<Record<StatusTagId, typeof AlertTriangleGlyph>> = {
  'status-needs-you': AlertTriangleGlyph,
  'status-question': HelpCircleGlyph,
  'status-error': AlertCircleGlyph,
  'status-finished': StatusCircleCheckGlyph,
  'status-working': CircleDashedGlyph,
  'status-idle': StatusCircleGlyph,
};

/** A hold on the handle before it lifts its row, so a quick swipe still scrolls the page and a tap opens the menu. */
const LIFT_HOLD_MS = 250;

/** VoiceOver's two moves on a row and its handle; the menu also offers Move to top. */
const MOVE_ACTIONS = [
  { name: 'moveUp', label: SessionGroupsCopy.tags.moveUp },
  { name: 'moveDown', label: SessionGroupsCopy.tags.moveDown },
];

/**
 * Settings › Sidebar & Sessions › Session Tags: the desktop's Tag filter list (`sidebarSessionTagListItems`), one
 * switch per entry in the list's order, synced with the computers. A tag switched off leaves the Tag As menu and the
 * tag filter (it is hidden and disabled, as the desktop's two buttons together); adding, renaming and deleting tags
 * stay on the computer. While Group sessions by tags is on, the six status entries are listed too, each with its
 * symbol and a "Status" caption.
 *
 * Each row has a handle beside its switch: dragged, it moves the row; tapped, it offers Move Up, Move Down and Move to
 * top, which VoiceOver also offers on the row. Every move saves the whole held list with the entry moved, each entry
 * keeping its switches; the entries the page does not list (the separators, the status entries while grouping is off,
 * and custom tags or separators the selected computer's catalog lacks, which another computer may still know) keep
 * their places in it. A drag let go outside the list, cancelled by the system, or started on a list that has changed
 * since writes nothing.
 */
export function SessionTagsSection({
  items,
  summary,
  grouping,
}: {
  items: unknown[] | null;
  summary: GhostexMobileSummary | null;
  /** Group sessions by tags is on: the status entries are listed. */
  grouping: boolean;
}) {
  const appearance = useAppearance();
  const ink = useSidebarInk();
  const catalog = summary?.customSessionTags ?? EMPTY_CUSTOM_SESSION_TAGS;
  const known = summary === null ? null : catalog;
  const list = normalizeTagListItems(items, known);
  const listed = listedTagItems(list, grouping);
  const listRef = useRef<ViewInstance | null>(null);
  const frames = useRef(new Map<string, RowFrame>());
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  /** The drag under way, changed only by the gesture's events (sessionTagDrag.ts). */
  const dragState = useRef<TagDragState>({ lifted: null });
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const label = (item: TagListItem): string =>
    isStatusTagId(item.id)
      ? SessionGroupsCopy.status[item.id]
      : item.kind === 'untagged'
        ? SessionGroupsCopy.noTag
        : (BUILTIN_LABELS[item.id] ?? catalog.tags[item.id]?.name ?? item.id);
  const setShown = (id: string, shown: boolean) =>
    setSidebarSetting(
      'sidebarSessionTagListItems',
      storedTagListItems(list.map((item) => (item.id === id ? { ...item, enabled: shown, visible: shown } : item))),
    );
  const move = (item: TagListItem, position: number): void => {
    const next = moveHeldTagItem(items, known, item.id, position, grouping);
    if (next === null) return;
    setSidebarSetting('sidebarSessionTagListItems', next);
    AccessibilityInfo.announceForAccessibility(SessionGroupsCopy.tags.moved(label(item), position + 1));
  };
  const onAction = (item: TagListItem, at: number) => (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'moveUp') move(item, at - 1);
    else if (event.nativeEvent.actionName === 'moveDown') move(item, at + 1);
  };

  const dragDeps: TagDragDeps = {
    // The list the stores hold at the event, which a drop compares with the one its drag started on.
    readHeld: () => currentSidebarOrganization(summary).sidebarSessionTagListItems,
    catalog: known,
    grouping,
    write: (next) => setSidebarSetting('sidebarSessionTagListItems', next),
    announce: (item, position) =>
      AccessibilityInfo.announceForAccessibility(SessionGroupsCopy.tags.moved(label(item), position + 1)),
  };
  const drop = (item: TagListItem, finger: { x: number; y: number }): void => {
    setDrag(null);
    // The list's frame now, in the finger's window coordinates, so the page's scroll counts.
    measureInWindow(listRef, (frame) => dropTag(dragState.current, dragDeps, item.id, finger, frame, frames.current));
  };
  const cancel = (): void => {
    cancelTagDrag(dragState.current);
    setDrag(null);
  };

  const menuItem = listed.find((item) => item.id === menuFor) ?? null;
  const menuAt = menuItem === null ? -1 : listed.indexOf(menuItem);
  const menuMove = (position: number) => () => {
    setMenuFor(null);
    if (menuItem !== null) move(menuItem, position);
  };

  return (
    <SettingsSection name="settings:sessions-list:session-tags">
      <SectionHeader title="Session Tags" />
      <Caption>{SessionGroupsCopy.tags.reorderCaption}</Caption>
      {grouping ? <Caption>{SessionGroupsCopy.tags.statusCaption}</Caption> : null}
      <Caption>{SessionGroupsCopy.tags.syncCaption}</Caption>
      <View ref={listRef} collapsable={false}>
        {listed.map((item, at) => {
          const name = label(item);
          const dy = drag !== null && drag.id === item.id ? drag.dy : null;
          const Glyph = isStatusTagId(item.id) ? STATUS_GLYPHS[item.id] : null;
          const color = isStatusTagId(item.id) ? groupColor(STATUS_GROUP_LOOK[item.id].colorToken, ink) : null;
          return (
            <View
              key={item.id}
              onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout;
                frames.current.set(item.id, { y, height });
              }}
              style={[styles.row, dy === null ? null : [styles.lifted, { transform: [{ translateY: dy }] }]]}
            >
              <ReorderHandle
                label={SessionGroupsCopy.tags.handleLabel(name, at + 1, listed.length)}
                color={appearance.mutedGlyph}
                onOpenMenu={() => setMenuFor(item.id)}
                onAccessibilityAction={onAction(item, at)}
                onLift={() => {
                  liftTag(dragState.current, dragDeps, item.id);
                  setDrag({ id: item.id, dy: 0 });
                }}
                onMove={(dy) => setDrag((was) => (was === null || was.id !== item.id ? was : { ...was, dy }))}
                onDrop={(finger) => drop(item, finger)}
                onCancel={cancel}
              />
              <View style={styles.toggle}>
                <ToggleRow
                  label={name}
                  detail={item.kind === 'status' ? SessionGroupsCopy.statusCaption : undefined}
                  icon={Glyph === null || color === null ? undefined : <Glyph size={18} color={color} />}
                  value={item.enabled && item.visible}
                  onValueChange={(next) => setShown(item.id, next)}
                  accessibilityActions={MOVE_ACTIONS}
                  onAccessibilityAction={onAction(item, at)}
                />
              </View>
            </View>
          );
        })}
      </View>
      {menuItem !== null ? (
        <ContextMenu
          visible
          title={SessionGroupsCopy.tags.menuTitle(label(menuItem), menuAt + 1)}
          items={[
            {
              kind: 'item',
              key: 'up',
              label: SessionGroupsCopy.tags.moveUp,
              disabled: menuAt <= 0,
              onPress: menuMove(menuAt - 1),
            },
            {
              kind: 'item',
              key: 'down',
              label: SessionGroupsCopy.tags.moveDown,
              disabled: menuAt >= listed.length - 1,
              onPress: menuMove(menuAt + 1),
            },
            {
              kind: 'item',
              key: 'top',
              label: SessionGroupsCopy.tags.moveToTop,
              disabled: menuAt <= 0,
              onPress: menuMove(0),
            },
            { kind: 'separator', key: 'done-separator' },
            { kind: 'item', key: 'done', label: SessionGroupsCopy.tags.done, onPress: () => setMenuFor(null) },
          ]}
          onClose={() => setMenuFor(null)}
        />
      ) : null}
    </SettingsSection>
  );
}

/**
 * A row's 44 × 44 pt handle, apart from its switch: a tap opens the move menu, a hold then drag moves the row. The
 * pan runs its callbacks on the JS thread (a handful of state changes per drag, as the terminal tabs' drag).
 */
function ReorderHandle({
  label,
  color,
  onOpenMenu,
  onAccessibilityAction,
  onLift,
  onMove,
  onDrop,
  onCancel,
}: {
  label: string;
  color: string;
  onOpenMenu: () => void;
  onAccessibilityAction: (event: AccessibilityActionEvent) => void;
  onLift: () => void;
  onMove: (dy: number) => void;
  onDrop: (finger: { x: number; y: number }) => void;
  onCancel: () => void;
}) {
  const settingsStyles = useSettingsStyles();
  const pan = usePanGesture({
    activateAfterLongPress: LIFT_HOLD_MS,
    runOnJS: true,
    onActivate: onLift,
    onUpdate: (event) => onMove(event.translationY),
    onDeactivate: (event) => (event.canceled ? onCancel() : onDrop({ x: event.absoluteX, y: event.absoluteY })),
    // A touch the system took: the row goes back and nothing is written (nothing once the drop above ended it).
    onFinalize: onCancel,
  });
  return (
    <GestureDetector gesture={pan}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={MOVE_ACTIONS}
        onAccessibilityAction={onAccessibilityAction}
        onPress={onOpenMenu}
        style={({ pressed }) => [styles.handle, pressed ? settingsStyles.rowPressed : null]}
      >
        <MenuGlyph size={18} color={color} />
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lifted: { zIndex: 1, opacity: 0.92 },
  handle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  toggle: { flex: 1, minWidth: 0 },
});
