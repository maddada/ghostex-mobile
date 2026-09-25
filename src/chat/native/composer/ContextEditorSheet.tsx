/**
 * Context details (`context_editor/`): which context rows show under the meter, and which are
 * starred onto the status line. Every change is the action desktop sends (`contextQuery`,
 * `contextShown`, `contextStar`, `contextReorder`, `contextReset`, `contextSave`, `contextCancel`);
 * the core keeps the edit until Save. Dragging a row's grip, or a status line chip, moves it onto
 * the row or chip it is dropped on (`contextReorder`), as desktop's drag and drop does.
 */

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import { Glyph } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';

export function ContextEditorSheet({ editor, dispatch }: { editor: JsonRecord | null; dispatch: (action: UserAction) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [query, setQuery] = useState('');
  const open = editor !== null;
  useEffect(() => {
    if (open) setQuery(str(editor, 'query'));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const saving = isTrue(editor, 'saving');
  const starred = arr(editor?.starred);
  const error = str(editor, 'error');
  const [dragging, setDragging] = useState(false);
  return (
    <Sheet visible={open} onClose={() => dispatch({ type: 'contextCancel' })} title="Context details" maxHeight="90%">
      <View style={styles.search}>
        <Glyph name="search" size={16} color={P.muted} />
        <TextInput
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            dispatch({ type: 'contextQuery', query: next });
          }}
          placeholder="Search rows"
          placeholderTextColor={P.placeholder}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} scrollEnabled={!dragging}>
        <DragLockContext.Provider value={setDragging}>
        <Text style={styles.description}>{str(editor, 'description')}</Text>
        {arr(editor?.groups).map((group) => (
          <View key={str(group, 'id')} style={styles.group}>
            <Text style={styles.groupLabel}>{str(group, 'label').toUpperCase()}</Text>
            <ReorderList
              ids={arr(obj(group)?.rows).map((row) => str(row, 'id'))}
              disabled={saving}
              onMove={(from, to) => dispatch({ type: 'contextReorder', group: str(group, 'id'), from, to })}
            >
            {arr(obj(group)?.rows).map((row) => {
              const id = str(row, 'id');
              const label = str(row, 'label');
              const starredRow = isTrue(row, 'starred');
              const shown = isTrue(row, 'shown');
              return (
                <ReorderItem key={id} id={id} label={label} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {label}
                    </Text>
                    <Text style={styles.rowDescription} numberOfLines={2}>
                      {str(row, 'description')}
                    </Text>
                  </View>
                  <Text style={styles.sample} numberOfLines={1}>
                    {str(row, 'sample') || '—'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${starredRow ? 'Unstar' : 'Star'} ${label}`}
                    disabled={saving}
                    hitSlop={6}
                    onPress={() => dispatch({ type: 'contextStar', id })}
                    style={styles.star}
                  >
                    <Glyph name={starredRow ? 'star-filled' : 'star'} size={17} color={starredRow ? P.star : P.muted} />
                  </Pressable>
                  <Switch
                    accessibilityLabel={`Show ${label}`}
                    value={shown}
                    disabled={saving}
                    onValueChange={(next) => dispatch({ type: 'contextShown', id, shown: next })}
                  />
                </ReorderItem>
              );
            })}
            </ReorderList>
          </View>
        ))}
        <View style={styles.statusLine}>
          <View style={styles.statusHeader}>
            <Text style={styles.groupLabel}>STATUS LINE</Text>
            <Text style={styles.rowDescription}>{starred.length === 0 ? 'Star rows above to show them under the chat box.' : ''}</Text>
          </View>
          <ReorderList
            ids={starred.map((row) => str(row, 'id'))}
            disabled={saving}
            onMove={(from, to) => dispatch({ type: 'contextReorder', group: 'starred', from, to })}
            style={styles.chips}
          >
            {starred.map((row) => (
              <ReorderItem key={str(row, 'id')} id={str(row, 'id')} label={str(row, 'label')} style={styles.chip}>
                <Text style={styles.chipText}>{str(row, 'label')}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Unstar ${str(row, 'label')}`}
                  disabled={saving}
                  hitSlop={8}
                  onPress={() => dispatch({ type: 'contextStar', id: str(row, 'id') })}
                >
                  <Glyph name="x" size={11} color={P.muted} />
                </Pressable>
              </ReorderItem>
            ))}
          </ReorderList>
        </View>
        {error.length > 0 ? <Text style={styles.error}>{error}</Text> : null}
        </DragLockContext.Provider>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => dispatch({ type: 'contextReset' })} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Reset to recommended</Text>
        </Pressable>
        <View style={styles.footerRight}>
          <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'contextCancel' })} style={styles.button}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => dispatch({ type: 'contextSave' })} style={[styles.button, styles.primary, saving ? styles.dim : null]}>
            <Text style={styles.primaryText}>Save</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

type Frame = { x: number; y: number; width: number; height: number };

type ReorderContextValue = {
  disabled: boolean;
  frames: Map<string, Frame>;
  drop: (id: string, dx: number, dy: number) => void;
};

const ReorderContext = React.createContext<ReorderContextValue | null>(null);

/** Holds the sheet's scrolling still while a grip drags, so a vertical drag on iOS cannot turn into a scroll that cancels the reorder. */
const DragLockContext = React.createContext<((dragging: boolean) => void) | null>(null);

/**
 * One group of reorderable rows or chips. Each item records its frame in this container, and a
 * grip dropped over another item moves it there (`contextReorder` with the two ids).
 */
function ReorderList({
  ids,
  disabled,
  onMove,
  style,
  children,
}: {
  ids: string[];
  disabled: boolean;
  onMove: (from: string, to: string) => void;
  style?: object;
  children: ReactNode;
}) {
  const frames = useRef(new Map<string, Frame>()).current;
  const latest = useRef({ ids, onMove });
  latest.current = { ids, onMove };
  const value = useRef<ReorderContextValue>({
    disabled,
    frames,
    drop: (id, dx, dy) => {
      const from = frames.get(id);
      if (from === undefined) return;
      const x = from.x + from.width / 2 + dx;
      const y = from.y + from.height / 2 + dy;
      const target = latest.current.ids.find((candidate) => {
        const frame = frames.get(candidate);
        return frame !== undefined && x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
      });
      if (target !== undefined && target !== id) latest.current.onMove(id, target);
    },
  }).current;
  value.disabled = disabled;
  return (
    <ReorderContext.Provider value={value}>
      <View style={style}>{children}</View>
    </ReorderContext.Provider>
  );
}

function ReorderItem({ id, label, style, children }: { id: string; label: string; style: object; children: ReactNode }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const context = React.useContext(ReorderContext);
  const lockScroll = React.useContext(DragLockContext);
  const offset = useRef(new Animated.ValueXY()).current;
  const [dragging, setDraggingState] = useState(false);
  const latest = useRef({ id, context, lockScroll });
  latest.current = { id, context, lockScroll };
  const setDragging = (next: boolean): void => {
    setDraggingState(next);
    latest.current.lockScroll?.(next);
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.context?.disabled !== true,
      onMoveShouldSetPanResponder: () => latest.current.context?.disabled !== true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => setDragging(true),
      onPanResponderMove: Animated.event([null, { dx: offset.x, dy: offset.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gesture) => {
        offset.setValue({ x: 0, y: 0 });
        setDragging(false);
        latest.current.context?.drop(latest.current.id, gesture.dx, gesture.dy);
      },
      onPanResponderTerminate: () => {
        offset.setValue({ x: 0, y: 0 });
        setDragging(false);
      },
    })
  ).current;
  return (
    <Animated.View
      onLayout={(event) => context?.frames.set(id, event.nativeEvent.layout)}
      style={[style, dragging ? styles.dragging : null, { transform: offset.getTranslateTransform(), zIndex: dragging ? 2 : 0 }]}
    >
      <View {...responder.panHandlers} style={styles.grip} accessibilityRole="adjustable" accessibilityLabel={`Reorder ${label}`}>
        <Glyph name="grip-vertical" size={14} color={P.muted} strokeWidth={1.8} />
      </View>
      {children}
    </Animated.View>
  );
}

const useStyles = themedStyles((P) => ({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: P.composerBackground,
    borderWidth: 1,
    borderColor: P.composerBorder,
  },
  searchInput: { flex: 1, color: P.foreground, fontSize: 15, paddingVertical: 0 },
  content: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  description: { color: P.muted, fontSize: 13, lineHeight: 18 },
  group: { gap: 2 },
  groupLabel: { color: P.mutedInk(0.75), fontSize: 11, fontWeight: '600', letterSpacing: 0.6, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { color: P.foreground, fontSize: 14 },
  rowDescription: { color: P.muted, fontSize: 12 },
  sample: { color: P.muted, fontSize: 12, maxWidth: 80 },
  star: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  statusLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.menuBorder, paddingTop: 10, gap: 6 },
  statusHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 8, borderWidth: 1, borderColor: P.border },
  chipText: { color: P.foreground, fontSize: 12.5 },
  grip: { width: 18, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  dragging: { backgroundColor: P.menu, opacity: 0.9 },
  error: { color: P.error, fontSize: 13 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: P.menuBorder,
  },
  footerRight: { flexDirection: 'row', gap: 8 },
  textButton: { height: 38, justifyContent: 'center' },
  textButtonLabel: { color: P.muted, fontSize: 13 },
  button: { height: 38, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: P.menuBorder, justifyContent: 'center' },
  buttonText: { color: P.foreground, fontSize: 14 },
  primary: { backgroundColor: P.send.fill, borderColor: P.send.fill },
  primaryText: { color: P.send.ink, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.5 },
}));
