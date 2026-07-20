/**
 * 2-row keyboard accessory bar (terminal-screen.md §2).
 * - Fixed 88 height, terminal-background fill, leading dismiss-keyboard
 *   cluster + 2 rows × 7 equal columns of key pills.
 * - Modifier latching: Ctrl/Alt/Shift toggle; the next non-modifier key sends
 *   with every latched modifier applied, then ALL latches reset (one-shot
 *   sticky semantics).
 * - Repeat-on-hold for arrows/Home/End/PGUP/PGDN: fires once on press-in,
 *   then after 350ms repeats every 50ms until press-out/cancel; repeats reuse
 *   the modifiers captured on the initial press.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GhostexNative, type KeyModifiers, type TerminalKey } from '../../../modules/ghostex-native/src';
import { GhostexPalette } from '../../theme/palette';
import { ArrowIcon, KeyboardDismissIcon, type ArrowDirection } from './icons';

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
      key: TerminalKey;
      /** Intrinsic modifiers (e.g. NEWLN = Ctrl-J), merged with latches. */
      mods?: KeyModifiers;
      repeatable?: boolean;
    };

/** Default layout, verbatim from the spec (§2). */
const ROW_1: KeyBarItem[] = [
  { id: 'esc', kind: 'key', label: 'ESC', key: 'escape' },
  { id: 'shift', kind: 'modifier', label: 'SHIFT', modifier: 'shift' },
  { id: 'newln', kind: 'key', label: 'NEWLN', key: 'j', mods: { ctrl: true } },
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
  /** settings.keyboardButtonVisible: shows the leading dismiss cluster. */
  showDismissButton: boolean;
  onDismissKeyboard: () => void;
};

export default function TerminalKeyBar({
  sessionKey,
  showDismissButton,
  onDismissKeyboard,
}: TerminalKeyBarProps) {
  const [latches, setLatches] = useState<LatchState>(NO_LATCHES);
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
    setLatches(NO_LATCHES);
    sendKey(item.key, mods);
    if (item.repeatable === true) {
      repeatTimer.current = setTimeout(() => {
        repeatTimer.current = null;
        repeatInterval.current = setInterval(() => sendKey(item.key, mods), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    }
  };

  const toggleModifier = (modifier: ModifierId): void => {
    setLatches((current) => ({ ...current, [modifier]: !current[modifier] }));
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
            <Text
              style={[styles.pillLabel, active && styles.pillLabelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
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
          style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
          onPressIn={() => handleKeyPressIn(item)}
          onPressOut={clearRepeat}
        >
          {item.arrow !== undefined ? (
            <ArrowIcon direction={item.arrow} size={14} color={GhostexPalette.MUTED} />
          ) : (
            <Text
              style={styles.pillLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
              {item.label}
            </Text>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.bar}>
      {showDismissButton && (
        <View style={styles.leadingCluster}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
            style={styles.dismissButton}
            onPress={onDismissKeyboard}
          >
            <KeyboardDismissIcon size={16} color={GhostexPalette.FOREGROUND} />
          </Pressable>
          <View style={styles.separator} />
        </View>
      )}
      <View style={[styles.rows, showDismissButton ? styles.rowsAfterSeparator : styles.rowsFlush]}>
        <View style={styles.row}>{ROW_1.map(renderItem)}</View>
        <View style={styles.row}>{ROW_2.map(renderItem)}</View>
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
  leadingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    gap: 8,
  },
  dismissButton: {
    width: 36,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  separator: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  rows: {
    flex: 1,
    paddingTop: 7,
    paddingBottom: 7,
    paddingRight: 10,
    gap: 6,
  },
  rowsAfterSeparator: {
    paddingLeft: 10,
  },
  rowsFlush: {
    paddingLeft: 12,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cell: {
    flex: 1,
  },
  pill: {
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  modifierPill: {
    paddingHorizontal: 8,
  },
  pillPressed: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pillActive: {
    backgroundColor: MODIFIER_ACTIVE_BG,
    borderColor: 'transparent',
  },
  pillLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: GhostexPalette.MUTED,
  },
  pillLabelActive: {
    color: '#FFFFFF',
  },
});
