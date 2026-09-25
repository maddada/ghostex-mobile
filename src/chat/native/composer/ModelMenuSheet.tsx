/**
 * The merged model pill's picker on the phone: the GPUI model pop-up (`option_menu/model_menu/`)
 * as a bottom sheet. Top to bottom, as desktop stacks the card: the agent tabs, the Not applied
 * line, the model rows, the footer buttons (reasoning, context window, fast mode and the agent's
 * other options), then the buttons that apply the highlighted model where desktop has its key
 * reminder.
 *
 * Everything drawn comes from the core's `modelMenu`, and every gesture is the action desktop
 * sends (`modelMenuView`, `modelMenuPick`, `modelMenuFavorite`, `modelMenuTrait`). This file owns
 * only what desktop's `ModelMenuState` owns: the highlighted row, the reasoning levels picked this
 * visit, and the open choice list.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import type { UserAction } from '../../rust/actions';
import { agentAccent } from './agentColors';
import { Glyph } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { effortFor, reasoningFor } from './modelMenuState';
import { ModelMenuChoices, ModelMenuTray } from './ModelMenuTray';
import { Sheet } from './Sheet';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

/** How long after opening or a tab switch the highlighted row's first layout scrolls it into view. */
const SCROLL_WINDOW_MS = 600;

/**
 * CDXC:SessionChat 2026-09-25 DECISION:
 * User: "please make the chat view model switcher match the one we have in gpui chat view now (search is gone for example)". The phone sheet draws the GPUI pop-up's tabs, model rows, footer buttons and Not applied line, and has no search field. This supersedes the phone's own layout with a search field, named tabs and a description under each model.
 * SEE-ALSO: apps/desktop/src/app/native_chat/option_menu/model_menu/ (the GPUI pop-up), packages/gx-chat-core/src/menus/picker/ (what it shows), and CDXC:Mobile 2026-09-24 in apps/mobile/views/chat/session-chat.css (no hotkey chips or key reminder on the phone, which also leaves out the footer buttons' hotkey letters).
 */
export function ModelMenuSheet({
  menu,
  visible,
  ownProvider,
  onClose,
  dispatch,
}: {
  menu: JsonRecord | null;
  visible: boolean;
  /**
   * `modelMenuContext.provider`: the agent a pick changes in place; any other agent's row hands off
   * or switches a draft. Every tab shows: a started session's pick of another agent's model is the
   * core's `handoffToModel`, which the chat screen performs with its Handoff / Export sheet
   * (`HandoffSheet.tsx`).
   */
  ownProvider: string;
  onClose: () => void;
  dispatch: (action: UserAction) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { height } = useWindowDimensions();
  /** The highlighted row's key; null is the tab's selected row, else its first (`selected_row`). */
  const [cursor, setCursor] = useState<string | null>(null);
  /** Levels the chips (or the Reasoning list) moved to this visit, by row key (`model_efforts`). */
  const [efforts, setEfforts] = useState<Record<string, string>>({});
  /** The footer button whose choices are open. */
  const [openButton, setOpenButton] = useState<number | null>(null);
  /** The row whose description the info button opened. */
  const [about, setAbout] = useState<string | null>(null);
  const list = useRef<ScrollView>(null);
  const scrollUntil = useRef(0);

  useEffect(() => {
    if (!visible) return;
    // Every visit starts on the session's own agent with an empty search (state.rs, `show_model_menu`).
    setCursor(null);
    setEfforts({});
    setOpenButton(null);
    setAbout(null);
    scrollUntil.current = Date.now() + SCROLL_WINDOW_MS;
    dispatch({ type: 'modelMenuView', tab: null, query: '' });
  }, [visible, dispatch]);

  const tab = str(menu, 'tab');
  useEffect(() => {
    // Another tab starts on its selected row (state.rs, `model_menu_changed`).
    setCursor(null);
    setAbout(null);
    scrollUntil.current = Date.now() + SCROLL_WINDOW_MS;
  }, [tab]);

  // The picker goes away with the document's `modelMenu`, as desktop closes its card.
  useEffect(() => {
    if (visible && menu === null) onClose();
  }, [visible, menu, onClose]);

  const disabled = isTrue(menu, 'disabled');
  const sessionScope = isTrue(menu, 'sessionScope');
  const handoffTabs = new Set(
    arr(menu?.tabs)
      .filter((entry) => isTrue(entry, 'handoff'))
      .map((entry) => str(entry, 'id'))
  );
  const tabs = arr(menu?.tabs)
    .map(obj)
    .filter((entry): entry is JsonRecord => entry !== null);
  const rows = arr(menu?.rows)
    .map(obj)
    .filter((row): row is JsonRecord => row !== null);
  const highlighted = rows.find((row) => str(row, 'key') === cursor) ?? rows.find((row) => isTrue(row, 'selected')) ?? rows[0] ?? null;
  const highlightedKey = highlighted === null ? null : str(highlighted, 'key');
  const buttons = arr(menu?.traits)
    .map(obj)
    .filter((entry): entry is JsonRecord => entry !== null)
    .map((setting) => reasoningFor(setting, highlighted, highlighted === null ? null : effortFor(highlighted, efforts)));
  const open = openButton === null ? undefined : buttons[openButton];
  // A button that went away with a new document takes its open list with it.
  useEffect(() => {
    if (openButton !== null && open === undefined) setOpenButton(null);
  }, [openButton, open]);
  const error = str(menu, 'error');
  const emptyText = str(menu, 'emptyText');
  const listHeight = Math.min(340, Math.round(height * 0.4));

  /** Desktop's Enter (`secondary`, this session) and Shift+Enter (the default): the highlighted row with its level, then close. */
  const apply = (secondary: boolean): void => {
    if (disabled || highlighted === null) return;
    const action: UserAction = { type: 'modelMenuPick', key: str(highlighted, 'key'), secondary };
    if (arr(highlighted.efforts).length > 0) action.effort = effortFor(highlighted, efforts);
    dispatch(action);
    onClose();
  };

  /** A button with at most two values flips to the other one; a longer list opens (`activate_model_button`). */
  const activate = (index: number, secondary: boolean): void => {
    const setting = buttons[index];
    if (setting === undefined || disabled || isTrue(setting, 'disabled')) return;
    const toggle = obj(setting.toggle);
    if (toggle === null) {
      if (arr(setting.choices).length > 0) setOpenButton(index);
      return;
    }
    dispatch({
      type: 'modelMenuTrait',
      id: str(setting, 'id'),
      value: (toggle.value ?? null) as never,
      exitPlan: toggle.exitPlan === true,
      secondary,
    });
  };

  /**
   * A choice applies and only the list closes (`choose_model_flyout`). The Reasoning list follows
   * the highlighted row: for any model but the one in use it only sets the level that row's pick
   * will carry.
   */
  const choose = (setting: JsonRecord, choice: JsonRecord, secondary: boolean): void => {
    const browse = str(setting, 'browse');
    if (browse.length > 0 && typeof choice.value === 'string') {
      const value = choice.value;
      setEfforts((current) => ({ ...current, [browse]: value }));
      if (!isTrue(setting, 'browseCurrent')) {
        setOpenButton(null);
        return;
      }
    }
    dispatch({
      type: 'modelMenuTrait',
      id: str(setting, 'id'),
      value: (choice.value ?? null) as never,
      exitPlan: choice.exitPlan === true,
      secondary,
    });
    setOpenButton(null);
  };

  const highlight = (key: string): void => {
    scrollUntil.current = 0;
    if (key !== highlightedKey) setAbout(null);
    setCursor(key);
  };

  return (
    <Sheet
      visible={visible && menu !== null}
      onClose={onClose}
      {...(open !== undefined ? { title: str(open, 'label'), onBack: () => setOpenButton(null) } : {})}
      maxHeight="90%"
    >
      {open !== undefined ? <ModelMenuChoices setting={open} sessionScope={sessionScope} onChoose={(choice, secondary) => choose(open, choice, secondary)} /> : null}
      {/* Kept mounted under an open list, so coming back keeps the list where it was scrolled. */}
      <View style={open !== undefined ? styles.hidden : null}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map((entry) => {
            const id = str(entry, 'id');
            const name = str(entry, 'name');
            const active = isTrue(entry, 'active');
            const handoff = isTrue(entry, 'handoff');
            const icon = str(entry, 'icon');
            const Icon = icon.length > 0 ? AGENT_ICONS[icon] : undefined;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                // Only another agent's tab carries the handoff badge (the user's decision in render.rs); its label says what a pick does.
                accessibilityLabel={handoff ? `${name}: picking a model hands off to ${name}` : name}
                onPress={() => dispatch({ type: 'modelMenuView', tab: id })}
                style={({ pressed }) => [styles.tab, pressed && !active ? styles.tabPressed : null]}
              >
                <View style={active ? null : styles.tabIdle}>
                  {Icon !== undefined ? (
                    <Icon size={19} color={agentAccent(icon, P.light)} />
                  ) : (
                    <Glyph name="star-filled" size={18} color={active ? P.menuForeground : P.ink(0.64)} />
                  )}
                </View>
                {handoff ? (
                  <View style={styles.handoff}>
                    <Glyph name="switch-horizontal" size={10} color={P.ink(0.64)} strokeWidth={2.4} />
                  </View>
                ) : null}
                {active ? <View style={styles.underline} /> : null}
              </Pressable>
            );
          })}
        </View>
        {error.length > 0 ? (
          // A choice the agent's own list could not offer is said here, where it was made.
          <View style={styles.error}>
            <Text style={styles.errorTitle}>Not applied</Text>
            <Text style={styles.errorText} numberOfLines={2}>
              {error}
            </Text>
          </View>
        ) : null}
        <ScrollView
          ref={list}
          style={[styles.list, { height: listHeight }, disabled ? styles.waiting : null]}
          contentContainerStyle={styles.listContent}
        >
          {rows.length === 0 ? <Text style={styles.empty}>{emptyText}</Text> : null}
          {rows.map((row) => {
            const key = str(row, 'key');
            const label = str(row, 'label');
            const icon = str(row, 'icon');
            const Icon = isTrue(row, 'showAgent') && icon.length > 0 ? AGENT_ICONS[icon] : undefined;
            const description = str(row, 'description').trim();
            const selected = isTrue(row, 'selected');
            const active = key === highlightedKey;
            const favorite = isTrue(row, 'favorite');
            const levels = active ? arr(row.efforts).map(obj).filter((level): level is JsonRecord => level !== null) : [];
            const level = active ? effortFor(row, efforts) : '';
            return (
              <Pressable
                key={key}
                accessibilityRole="menuitem"
                accessibilityLabel={label}
                accessibilityState={{ checked: selected, selected: active }}
                onPress={() => highlight(key)}
                onLayout={(event) => {
                  if (!active || Date.now() > scrollUntil.current) return;
                  scrollUntil.current = 0;
                  list.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 8), animated: false });
                }}
                style={[styles.row, selected ? styles.rowSelected : active ? styles.rowActive : null]}
              >
                <View style={styles.rowLine}>
                  <View style={styles.rowBody}>
                    {Icon !== undefined ? <Icon size={16} color={agentAccent(icon, P.light)} /> : null}
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {label}
                    </Text>
                  </View>
                  {/* The description is not written beside the model (the user's decision in render.rs); the highlighted row's info button shows it. */}
                  {active && description.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`About ${label}`}
                      accessibilityState={{ expanded: about === key }}
                      hitSlop={6}
                      onPress={() => setAbout((current) => (current === key ? null : key))}
                      style={({ pressed }) => [styles.rowButton, pressed || about === key ? styles.rowButtonPressed : null]}
                    >
                      <Glyph name="info-circle" size={16} color={P.ink(0.64)} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={favorite ? 'Remove star' : 'Star'}
                    hitSlop={6}
                    onPress={() => dispatch({ type: 'modelMenuFavorite', key })}
                    style={({ pressed }) => [styles.rowButton, pressed ? styles.rowButtonPressed : null]}
                  >
                    <Glyph name={favorite ? 'star-filled' : 'star'} size={16} color={favorite ? P.star : P.ink(0.64)} />
                  </Pressable>
                </View>
                {active && about === key && description.length > 0 ? <Text style={styles.description}>{description}</Text> : null}
                {levels.length > 0 ? (
                  <View style={styles.levels} accessibilityRole="radiogroup" accessibilityLabel={`Reasoning for ${label}`}>
                    <Glyph name="brain" size={15} color={P.ink(0.64)} />
                    {levels.map((entry) => {
                      const value = str(entry, 'value');
                      const on = value === level;
                      return (
                        <Pressable
                          key={value}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          onPress={() => setEfforts((current) => ({ ...current, [key]: value }))}
                          style={({ pressed }) => [styles.level, on ? styles.levelOn : pressed ? styles.levelPressed : null]}
                        >
                          <Text style={[styles.levelText, on ? styles.levelTextOn : null]}>{str(entry, 'label')}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <ModelMenuTray buttons={buttons} disabled={disabled} sessionScope={sessionScope} onActivate={activate} />
        <ApplyBar menu={menu} row={highlighted} ownProvider={ownProvider} handoff={highlighted !== null && handoffTabs.has(str(highlighted, 'provider'))} disabled={disabled} onApply={apply} />
      </View>
    </Sheet>
  );
}

/**
 * CDXC:SessionChat 2026-09-25 WHY:
 * The desktop pop-up is driven from the keyboard (keys.rs DECISION): Up and Down move the highlight, Left and Right move its reasoning level, Enter uses the model and level in this session and Shift+Enter saves them as the agent's default. A phone has no such keys, so a tap on a row only highlights it, the level chips under it are Left and Right, and these buttons are Enter and Shift+Enter. Where the agent cannot apply a pick to one session (every agent but Claude, `sessionScope`), both keys save the default, so one Apply button stands for them with the core's `scopeHint`; another agent's row hands off (a draft switches agent), which one button names.
 */
function ApplyBar({
  menu,
  row,
  ownProvider,
  handoff,
  disabled,
  onApply,
}: {
  menu: JsonRecord | null;
  row: JsonRecord | null;
  ownProvider: string;
  handoff: boolean;
  disabled: boolean;
  onApply: (secondary: boolean) => void;
}) {
  const styles = useStyles();
  if (row === null) return null;
  const own = str(row, 'provider') === ownProvider;
  const agent = str(row, 'agentName');
  const hint = own && !isTrue(menu, 'sessionScope') ? str(menu, 'scopeHint') : '';
  const button = (label: string, secondary: boolean, primary: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onApply(secondary)}
      style={({ pressed }) => [styles.apply, primary ? styles.applyPrimary : styles.applySecondary, pressed ? styles.applyPressed : null, disabled ? styles.applyOff : null]}
    >
      <Text style={[styles.applyText, primary ? styles.applyTextPrimary : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={styles.applyBar}>
      {hint.length > 0 ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.applyRow}>
        {!own ? (
          button(handoff ? `Hand off to ${agent}` : `Switch to ${agent}`, true, true)
        ) : isTrue(menu, 'sessionScope') ? (
          <>
            {button('Save as default', false, false)}
            {button('Use in this session', true, true)}
          </>
        ) : (
          button('Apply', false, true)
        )}
      </View>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  hidden: { display: 'none' },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: P.ink(0.08),
  },
  tab: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabPressed: { backgroundColor: P.ink(0.06) },
  tabIdle: { opacity: 0.72 },
  handoff: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: P.menu,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The 44pt tab sits centred in the 48pt bar, so 2pt below it is the bar's own hairline.
  underline: { position: 'absolute', left: 8, right: 8, bottom: -2, height: 2, borderRadius: 1, backgroundColor: P.controlPrimary },
  error: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.ink(0.08) },
  errorTitle: { color: P.ink(0.64), fontSize: 12 },
  errorText: { color: P.menuForeground, fontSize: 13, lineHeight: 18, marginTop: 2 },
  list: { flexGrow: 0, backgroundColor: P.ink(0.02) },
  // Picks wait while the agent cannot take one; the rows say so by dimming.
  waiting: { opacity: 0.5 },
  listContent: { padding: 6, gap: 2 },
  empty: { color: P.ink(0.64), fontSize: 14, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 28 },
  // The selected row's ring is a border every row reserves, so rows keep one height.
  row: { borderRadius: 8, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 10, paddingVertical: 4, minHeight: 46, justifyContent: 'center' },
  rowSelected: { backgroundColor: P.ink(0.11), borderColor: P.ink(0.09) },
  rowActive: { backgroundColor: P.ink(0.05) },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  rowBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { flexShrink: 1, color: P.menuForeground, fontSize: 15, fontWeight: '500' },
  rowButton: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowButtonPressed: { backgroundColor: P.ink(0.08) },
  description: { color: P.ink(0.64), fontSize: 13, lineHeight: 18, paddingBottom: 6, paddingRight: 8 },
  levels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 2, paddingBottom: 8 },
  level: { height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: P.ink(0.12), justifyContent: 'center' },
  levelOn: { backgroundColor: P.ink(0.14), borderColor: P.ink(0.26) },
  levelPressed: { backgroundColor: P.ink(0.06) },
  levelText: { color: P.ink(0.64), fontSize: 13 },
  levelTextOn: { color: P.menuForeground, fontWeight: '600' },
  applyBar: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.ink(0.08), paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  hint: { color: P.ink(0.64), fontSize: 12, lineHeight: 16, paddingHorizontal: 4 },
  applyRow: { flexDirection: 'row', gap: 8 },
  apply: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  applyPrimary: { backgroundColor: P.send.fill },
  applySecondary: { borderWidth: 1, borderColor: P.menuBorder },
  applyPressed: { opacity: 0.8 },
  applyOff: { opacity: 0.42 },
  applyText: { color: P.menuForeground, fontSize: 15, fontWeight: '600' },
  applyTextPrimary: { color: P.send.ink },
}));
