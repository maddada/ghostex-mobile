/**
 * 2-row keyboard accessory bar (terminal-screen.md §2).
 * - Fixed 88 height, terminal-background fill, trailing text-editor/dismiss
 *   controls + either 2 rows × 7 equal key pills or a Termux-style composer.
 * - Modifier latching: tap for one-shot; long-press to lock until tapped again.
 *   One-shot and locked states use distinct colors.
 * - Repeat-on-hold for arrows/Home/End/PGUP/PGDN: fires once on press-in,
 *   then after 350ms repeats every 50ms until press-out/cancel; repeats reuse
 *   the modifiers captured on the initial press.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { GhostexNative, type KeyModifiers, type TerminalKey } from '../../../modules/ghostex-native/src';
import { useSettingsStore } from '../../settings/store';
import {
  resolveExtraKeysLayout,
  useExtraKeysStore,
  type ResolvedExtraKey,
} from '../../settings/extraKeys';
import { agentKeyPage, EXTRA_KEYS_PAGE, type KeyPageItem } from './keyBarPages';
import { GhostexPalette } from '../../theme/palette';
import {
  ArrowIcon,
  KeyboardDismissIcon,
  PencilIcon,
  ReturnIcon,
  SendIcon,
} from './icons';

export const KEY_BAR_HEIGHT = 88;
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 50;
const MODIFIER_ACTIVE_BG = '#007AFF';
const MODIFIER_LOCKED_BG = '#AF52DE';
const MODIFIER_LONG_PRESS_MS = 450;
const PAGE_HINT_LONG_PRESS_MS = 350;
const PAGE_HINT_TIMEOUT_MS = 3500;
/** Empty-state line keeping the hint slot's height stable while a page is open. */
const PAGE_HINT_PLACEHOLDER = 'Hold a key to see what it does';

type ModifierId = 'ctrl' | 'alt' | 'shift';
type ModifierMode = 'off' | 'oneShot' | 'locked';
type ModifierState = Record<ModifierId, ModifierMode>;

const NO_MODIFIERS: ModifierState = { ctrl: 'off', alt: 'off', shift: 'off' };

function modifierPayload(state: ModifierState): KeyModifiers {
  return {
    ctrl: state.ctrl !== 'off',
    alt: state.alt !== 'off',
    shift: state.shift !== 'off',
    ctrlLocked: state.ctrl === 'locked',
    altLocked: state.alt === 'locked',
    shiftLocked: state.shift === 'locked',
  };
}

function retainLockedModifiers(state: ModifierState): ModifierState {
  return {
    ctrl: state.ctrl === 'locked' ? 'locked' : 'off',
    alt: state.alt === 'locked' ? 'locked' : 'off',
    shift: state.shift === 'locked' ? 'locked' : 'off',
  };
}

/** Short platform-native tick on every key-bar press (settings.keyBarHapticsEnabled). */
function clickHaptic(): void {
  if (!useSettingsStore.getState().settings.keyBarHapticsEnabled) return;
  const feedback =
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap)
      : Haptics.selectionAsync();
  void feedback.catch(() => {});
}

/**
 * Distinct, crisp second click when a held modifier locks into its persistent state,
 * so the user can feel Ctrl/Alt/Shift arming without watching the pill color.
 */
function lockHaptic(): void {
  if (!useSettingsStore.getState().settings.keyBarHapticsEnabled) return;
  const feedback =
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  void feedback.catch(() => {});
}

/** Rendered key model: the user-editable layout from the extra-keys store. */
type KeyBarItem = ResolvedExtraKey;

/** Toggle pages opened by the base bar's PGUP/PGDN pills (keyBarPages.ts). */
type KeyBarPage = 'none' | 'extra' | 'agent';

export type TerminalKeyBarProps = {
  sessionKey: string;
  /** Resolved agent icon id of the shown session ('' / 'terminal' when none). */
  agentId: string;
  onDismissKeyboard: () => void;
};

export default function TerminalKeyBar({
  sessionKey,
  agentId,
  onDismissKeyboard,
}: TerminalKeyBarProps) {
  const layout = useExtraKeysStore((state) => state.layout);
  const [row1 = [], row2 = []] = resolveExtraKeysLayout(layout);
  const [modifiers, setModifiers] = useState<ModifierState>(NO_MODIFIERS);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorText, setEditorText] = useState('');
  const [page, setPage] = useState<KeyBarPage>('none');
  const [pageHint, setPageHint] = useState<string | null>(null);
  const agentPage = agentKeyPage(agentId);
  // A tab switch to an agent without hotkeys drops a stale open agent page.
  const activePage = page === 'agent' && agentPage === null ? 'none' : page;
  const pageRows = activePage === 'extra' ? EXTRA_KEYS_PAGE : activePage === 'agent' ? agentPage : null;
  const repeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pageHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPageHint = useCallback((hint: string): void => {
    if (pageHintTimer.current !== null) clearTimeout(pageHintTimer.current);
    setPageHint(hint);
    pageHintTimer.current = setTimeout(() => setPageHint(null), PAGE_HINT_TIMEOUT_MS);
  }, []);

  useEffect(
    () => () => {
      if (pageHintTimer.current !== null) clearTimeout(pageHintTimer.current);
    },
    [],
  );

  const clearRepeat = useCallback((): void => {
    if (repeatTimer.current !== null) {
      clearTimeout(repeatTimer.current);
      repeatTimer.current = null;
    }
    if (repeatInterval.current !== null) {
      clearInterval(repeatInterval.current);
      repeatInterval.current = null;
    }
  }, []);

  useEffect(() => clearRepeat, [clearRepeat]);

  const clearModifiers = useCallback((): void => {
    setModifiers(NO_MODIFIERS);
    void GhostexNative.setKeyModifiers(sessionKey, modifierPayload(NO_MODIFIERS)).catch(
      () => undefined,
    );
  }, [sessionKey]);

  useEffect(() => {
    clearModifiers();
    setEditorVisible(false);
    setEditorText('');
    setPage('none');
    setPageHint(null);
    const subscription = GhostexNative.addListener('onKeyModifiersConsumed', (event) => {
      if (event.sessionKey === sessionKey) {
        setModifiers((current) => retainLockedModifiers(current));
      }
    });
    return () => {
      subscription.remove();
      void GhostexNative.setKeyModifiers(sessionKey, modifierPayload(NO_MODIFIERS)).catch(
        () => undefined,
      );
    };
  }, [clearModifiers, sessionKey]);

  const sendKey = useCallback(
    (key: TerminalKey, mods: KeyModifiers): void => {
      void GhostexNative.sendKey(sessionKey, key, mods).catch(() => {
        // The native entry may be closed/failed; overlays surface that state.
      });
    },
    [sessionKey],
  );

  /** Apply every active modifier, send once, retain only long-press locks. */
  const sendItemKeyOnce = (item: Extract<KeyBarItem, { kind: 'key' }>): KeyModifiers => {
    clickHaptic();
    const mods: KeyModifiers = {
      ctrl: item.mods?.ctrl === true || modifiers.ctrl !== 'off',
      alt: item.mods?.alt === true || modifiers.alt !== 'off',
      shift: item.mods?.shift === true || modifiers.shift !== 'off',
    };
    setModifiers((current) => retainLockedModifiers(current));
    sendKey(item.key, mods);
    return mods;
  };

  const handleKeyPressIn = (item: Extract<KeyBarItem, { kind: 'key' }>): void => {
    clearRepeat();
    const mods = sendItemKeyOnce(item);
    if (item.repeatable === true) {
      repeatTimer.current = setTimeout(() => {
        repeatTimer.current = null;
        repeatInterval.current = setInterval(() => sendKey(item.key, mods), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    }
  };

  const handleTextActionPress = (item: Extract<KeyBarItem, { kind: 'text' }>): void => {
    clearRepeat();
    clickHaptic();
    setModifiers((current) => retainLockedModifiers(current));
    void GhostexNative.sendText(sessionKey, item.text)
      .then(() => {
        if (item.sendEnter) {
          void GhostexNative.sendKey(sessionKey, 'enter', {}).catch(() => undefined);
        }
      })
      .catch(() => {
        // The native entry may be closed/failed; overlays surface that state.
      });
  };

  const setModifierMode = (modifier: ModifierId, longPress: boolean): void => {
    // Lock-in gets the distinct buzz; taps and unlocks get the plain tick.
    if (longPress && modifiers[modifier] !== 'locked') lockHaptic();
    else clickHaptic();
    setModifiers((current) => {
      const currentMode = current[modifier];
      const nextMode: ModifierMode = longPress
        ? currentMode === 'locked'
          ? 'off'
          : 'locked'
        : currentMode === 'off'
          ? 'oneShot'
          : 'off';
      const next = { ...current, [modifier]: nextMode };
      void GhostexNative.setKeyModifiers(sessionKey, modifierPayload(next)).catch(
        () => undefined,
      );
      return next;
    });
  };

  const toggleEditor = (): void => {
    clearRepeat();
    clearModifiers();
    setEditorVisible((current) => {
      if (current) {
        setTimeout(() => {
          void GhostexNative.focusTerminal(sessionKey).catch(() => undefined);
        }, 0);
      }
      return !current;
    });
  };

  const submitEditor = (): void => {
    if (editorText.length === 0) {
      sendKey('enter', {});
    } else {
      void GhostexNative.sendText(sessionKey, editorText).catch(() => {
        // The terminal state overlay owns connection errors.
      });
    }
    setEditorText('');
  };

  const handleEditorKeyPress = (key: string): void => {
    // Once the draft is empty, editing keys retain their terminal meaning.
    // Software and hardware keyboards emit repeated key-press events while held.
    if (editorText.length !== 0) return;
    if (key === 'Backspace') sendKey('backspace', {});
    if (key === 'Delete') sendKey('delete', {});
  };

  // pageToggles: only the base rows turn PGUP/PGDN into page toggles; inside
  // an open page those pills stay real PgUp/PgDn keys.
  const renderItem = (item: KeyBarItem, pageToggles = false) => {
    if (
      pageToggles &&
      item.kind === 'key' &&
      (item.key === 'pageUp' || (item.key === 'pageDown' && agentPage !== null))
    ) {
      const target: KeyBarPage = item.key === 'pageUp' ? 'extra' : 'agent';
      const active = activePage === target;
      return (
        <View key={item.id} style={styles.cell}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={target === 'extra' ? 'Extra keys' : 'Agent hotkeys'}
            accessibilityState={{ selected: active }}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => {
              clearRepeat();
              clickHaptic();
              setPageHint(null);
              setPage(active ? 'none' : target);
            }}
          >
            <Text style={[styles.pillLabel, active && styles.pillLabelActive]} numberOfLines={1}>
              {target === 'extra' ? 'MORE' : 'AGENT'}
            </Text>
          </Pressable>
        </View>
      );
    }
    if (item.kind === 'modifier') {
      const mode = modifiers[item.modifier];
      const active = mode !== 'off';
      const locked = mode === 'locked';
      return (
        <View key={item.id} style={styles.cell}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityHint="Tap for one key, or hold to lock until tapped again"
            delayLongPress={MODIFIER_LONG_PRESS_MS}
            style={[
              styles.pill,
              styles.modifierPill,
              active && styles.pillActive,
              locked && styles.pillLocked,
            ]}
            onPress={() => setModifierMode(item.modifier, false)}
            onLongPress={() => setModifierMode(item.modifier, true)}
          >
            <Text style={[styles.pillLabel, active && styles.pillLabelActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        </View>
      );
    }
    if (item.kind === 'text') {
      return (
        <View key={item.id} style={styles.cell}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.label}
            style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
            onPress={() => handleTextActionPress(item)}
          >
            <Text style={styles.pillLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View key={item.id} style={styles.cell}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.returnGlyph === true ? 'New line' : item.label}
          style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
          onPressIn={() => handleKeyPressIn(item)}
          onPressOut={clearRepeat}
        >
          {item.arrow !== undefined ? (
            <ArrowIcon direction={item.arrow} size={14} color={GhostexPalette.MUTED} />
          ) : item.returnGlyph === true ? (
            <ReturnIcon size={15} color={GhostexPalette.MUTED} />
          ) : (
            <Text style={styles.pillLabel} numberOfLines={1}>
              {item.label}
            </Text>
          )}
        </Pressable>
      </View>
    );
  };

  /**
   * Page pills send on release and explain themselves on hold — so page keys
   * deliberately have no repeat-on-hold; the hold gesture belongs to the hint.
   */
  const renderPageItem = (item: KeyPageItem) => {
    if (item.kind === 'modifier') return renderItem(item);
    return (
      <View key={item.id} style={styles.cell}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.description}
          accessibilityHint="Hold to see what this key does"
          delayLongPress={PAGE_HINT_LONG_PRESS_MS}
          style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
          onPress={() => {
            clearRepeat();
            if (item.kind === 'text') handleTextActionPress(item);
            else sendItemKeyOnce(item);
          }}
          onLongPress={() => showPageHint(`${item.label}  —  ${item.description}`)}
        >
          <Text style={styles.pillLabel} numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View>
      {!editorVisible && pageRows !== null ? (
        <View style={styles.pagePanel}>
          <Text
            style={[styles.pageHint, pageHint === null && styles.pageHintPlaceholder]}
            numberOfLines={1}
          >
            {pageHint ?? PAGE_HINT_PLACEHOLDER}
          </Text>
          {pageRows.map((row, rowIndex) => (
            <View key={`page-row-${rowIndex}`} style={styles.pageRow}>
              {row.map(renderPageItem)}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.bar}>
        {editorVisible ? (
        <View style={styles.editorContainer}>
          <TextInput
            autoFocus
            accessibilityLabel="Terminal text editor"
            autoCapitalize="none"
            autoCorrect
            keyboardType="default"
            multiline
            placeholder="Type text to send to the terminal"
            placeholderTextColor={GhostexPalette.MUTED}
            selectionColor="rgba(125,211,252,0.45)"
            spellCheck
            style={styles.editor}
            submitBehavior="newline"
            value={editorText}
            onChangeText={setEditorText}
            onKeyPress={(event) => handleEditorKeyPress(event.nativeEvent.key)}
          />
        </View>
      ) : (
        <View style={styles.rows}>
          <View style={styles.row}>{row1.map((item) => renderItem(item, true))}</View>
          <View style={styles.row}>{row2.map((item) => renderItem(item, true))}</View>
        </View>
      )}
        <View style={styles.trailingCluster}>
          <View style={styles.separator} />
          <View style={styles.trailingButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editorVisible ? 'Show terminal keys' : 'Open text editor'}
            accessibilityState={{ selected: editorVisible }}
            style={[styles.trailingButton, editorVisible && styles.trailingButtonActive]}
            onPress={toggleEditor}
          >
            <PencilIcon
              size={16}
              color={editorVisible ? '#FFFFFF' : GhostexPalette.FOREGROUND}
            />
          </Pressable>
          {editorVisible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                editorText.length === 0 ? 'Send Enter to terminal' : 'Insert text into terminal'
              }
              style={styles.trailingButton}
              onPress={submitEditor}
            >
              {editorText.length === 0 ? (
                <SendIcon size={16} color={GhostexPalette.FOREGROUND} />
              ) : (
                <ArrowIcon direction="up" size={16} color={GhostexPalette.FOREGROUND} />
              )}
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss keyboard"
              style={styles.trailingButton}
              onPress={onDismissKeyboard}
            >
              <KeyboardDismissIcon size={16} color={GhostexPalette.FOREGROUND} />
            </Pressable>
          )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: KEY_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  /** Toggle page above the bar (fixed-height rows, same pill styling). */
  pagePanel: {
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
    paddingTop: 7,
    paddingHorizontal: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    paddingBottom: 7,
  },
  pageRow: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  /** Fixed-height hold-to-explain line, so hints never shift the layout. */
  pageHint: {
    height: 16,
    fontSize: 11,
    lineHeight: 15,
    color: GhostexPalette.FOREGROUND,
    paddingHorizontal: 2,
  },
  pageHintPlaceholder: {
    color: GhostexPalette.MUTED,
    opacity: 0.55,
  },
  trailingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    gap: 8,
  },
  trailingButtons: {
    height: KEY_BAR_HEIGHT,
    justifyContent: 'center',
    gap: 6,
  },
  trailingButton: {
    width: 36,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  trailingButtonActive: {
    backgroundColor: MODIFIER_ACTIVE_BG,
  },
  separator: {
    width: 1,
    height: 60,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  rows: {
    flex: 1,
    paddingTop: 7,
    paddingBottom: 7,
    paddingRight: 10,
    paddingLeft: 10,
    gap: 6,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cell: {
    flex: 1,
  },
  pill: {
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  modifierPill: {
    paddingHorizontal: 2,
  },
  pillPressed: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pillActive: {
    backgroundColor: MODIFIER_ACTIVE_BG,
    borderColor: 'transparent',
  },
  pillLocked: {
    backgroundColor: MODIFIER_LOCKED_BG,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  pillLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
    color: GhostexPalette.MUTED,
  },
  pillLabelActive: {
    color: '#FFFFFF',
  },
  editorContainer: {
    flex: 1,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 10,
  },
  editor: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    textAlignVertical: 'top',
  },
});
