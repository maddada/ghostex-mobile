/**
 * 2-row keyboard accessory bar (terminal-screen.md §2).
 * - Fixed 88 height, terminal-background fill, trailing text-editor/dismiss
 *   controls + either 2 rows × 7 equal key pills or a Termux-style composer.
 * - Modifier latching: Ctrl/Alt/Shift toggle; the next non-modifier key sends
 *   with every latched modifier applied, then ALL latches reset (one-shot
 *   sticky semantics).
 * - Repeat-on-hold for arrows/Home/End/PGUP/PGDN: fires once on press-in,
 *   then after 350ms repeats every 50ms until press-out/cancel; repeats reuse
 *   the modifiers captured on the initial press.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GhostexNative, type KeyModifiers, type TerminalKey } from '../../../modules/ghostex-native/src';
import { GhostexPalette } from '../../theme/palette';
import {
  ArrowIcon,
  KeyboardDismissIcon,
  ReturnIcon,
  SendIcon,
  TextEditorIcon,
  type ArrowDirection,
} from './icons';

export const KEY_BAR_HEIGHT = 88;
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 50;
const MODIFIER_ACTIVE_BG = '#007AFF';

type ModifierId = 'ctrl' | 'alt' | 'shift';

type LatchState = Record<ModifierId, boolean>;

const NO_LATCHES: LatchState = { ctrl: false, alt: false, shift: false };

type KeyBarItem =
  | { id: string; kind: 'modifier'; label: string; modifier: ModifierId }
  | {
      id: string;
      kind: 'key';
      label?: string;
      arrow?: ArrowDirection;
      returnGlyph?: boolean;
      key: TerminalKey;
      /** Intrinsic modifiers (e.g. NEWLN = Ctrl-J), merged with latches. */
      mods?: KeyModifiers;
      repeatable?: boolean;
    };

/** Default layout, verbatim from the spec (§2). */
const ROW_1: KeyBarItem[] = [
  { id: 'esc', kind: 'key', label: 'ESC', key: 'escape' },
  { id: 'shift', kind: 'modifier', label: 'SHIFT', modifier: 'shift' },
  { id: 'newln', kind: 'key', returnGlyph: true, key: 'j', mods: { ctrl: true } },
  { id: 'home', kind: 'key', label: 'HOME', key: 'home', repeatable: true },
  { id: 'up', kind: 'key', arrow: 'up', key: 'up', repeatable: true },
  { id: 'end', kind: 'key', label: 'END', key: 'end', repeatable: true },
  { id: 'pgup', kind: 'key', label: 'PGUP', key: 'pageUp', repeatable: true },
];

const ROW_2: KeyBarItem[] = [
  { id: 'tab', kind: 'key', label: 'TAB', key: 'tab' },
  { id: 'ctrl', kind: 'modifier', label: 'CTRL', modifier: 'ctrl' },
  { id: 'alt', kind: 'modifier', label: 'ALT', modifier: 'alt' },
  { id: 'left', kind: 'key', arrow: 'left', key: 'left', repeatable: true },
  { id: 'down', kind: 'key', arrow: 'down', key: 'down', repeatable: true },
  { id: 'right', kind: 'key', arrow: 'right', key: 'right', repeatable: true },
  { id: 'pgdn', kind: 'key', label: 'PGDN', key: 'pageDown', repeatable: true },
];

export type TerminalKeyBarProps = {
  sessionKey: string;
  /** settings.keyboardButtonVisible: shows the trailing dismiss control. */
  showDismissButton: boolean;
  onDismissKeyboard: () => void;
};

export default function TerminalKeyBar({
  sessionKey,
  showDismissButton,
  onDismissKeyboard,
}: TerminalKeyBarProps) {
  const [latches, setLatches] = useState<LatchState>(NO_LATCHES);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorText, setEditorText] = useState('');
  const repeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setLatches(NO_LATCHES);
    void GhostexNative.setKeyModifiers(sessionKey, NO_LATCHES).catch(() => undefined);
  }, [sessionKey]);

  useEffect(() => {
    clearModifiers();
    setEditorVisible(false);
    setEditorText('');
    const subscription = GhostexNative.addListener('onKeyModifiersConsumed', (event) => {
      if (event.sessionKey === sessionKey) setLatches(NO_LATCHES);
    });
    return () => {
      subscription.remove();
      void GhostexNative.setKeyModifiers(sessionKey, NO_LATCHES).catch(() => undefined);
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

  const handleKeyPressIn = (item: Extract<KeyBarItem, { kind: 'key' }>): void => {
    clearRepeat();
    // Merge intrinsic mods with the latched one-shot modifiers, then reset.
    const mods: KeyModifiers = {
      ctrl: item.mods?.ctrl === true || latches.ctrl,
      alt: item.mods?.alt === true || latches.alt,
      shift: item.mods?.shift === true || latches.shift,
    };
    clearModifiers();
    sendKey(item.key, mods);
    if (item.repeatable === true) {
      repeatTimer.current = setTimeout(() => {
        repeatTimer.current = null;
        repeatInterval.current = setInterval(() => sendKey(item.key, mods), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    }
  };

  const toggleModifier = (modifier: ModifierId): void => {
    setLatches((current) => {
      const next = { ...current, [modifier]: !current[modifier] };
      void GhostexNative.setKeyModifiers(sessionKey, next).catch(() => undefined);
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

  const renderItem = (item: KeyBarItem) => {
    if (item.kind === 'modifier') {
      const active = latches[item.modifier];
      return (
        <View key={item.id} style={styles.cell}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.pill, styles.modifierPill, active && styles.pillActive]}
            onPress={() => toggleModifier(item.modifier)}
          >
            <Text style={[styles.pillLabel, active && styles.pillLabelActive]} numberOfLines={1}>
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

  return (
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
            selectionColor={GhostexPalette.FOREGROUND}
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
          <View style={styles.row}>{ROW_1.map(renderItem)}</View>
          <View style={styles.row}>{ROW_2.map(renderItem)}</View>
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
            <TextEditorIcon
              size={16}
              color={editorVisible ? '#FFFFFF' : GhostexPalette.FOREGROUND}
            />
          </Pressable>
          {editorVisible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send text to terminal"
              style={styles.trailingButton}
              onPress={submitEditor}
            >
              <SendIcon size={16} color={GhostexPalette.FOREGROUND} />
            </Pressable>
          ) : (
            showDismissButton && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss keyboard"
                style={styles.trailingButton}
                onPress={onDismissKeyboard}
              >
                <KeyboardDismissIcon size={16} color={GhostexPalette.FOREGROUND} />
              </Pressable>
            )
          )}
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
