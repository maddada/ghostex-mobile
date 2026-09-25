/**
 * The model sheet's footer buttons and the choice list a button opens: desktop's button tray
 * (`model_menu/render.rs`, `render_model_traits`) and its side list (`model_menu/flyout.rs`). The
 * side list opens as a page of the sheet, so it stays on screen on a narrow phone.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { footerLines } from './modelMenuState';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

/** The glyph beside each value (`render.rs`: brain, chart bars, bolt, person). */
const BUTTON_GLYPHS: Record<string, GlyphName> = { reasoning: 'brain', context: 'chart-bar', fast: 'bolt', account: 'user' };

/** Fast mode reads as a switch: lit when on, dimmed when off (`render.rs`). */
function fastOn(setting: JsonRecord): boolean {
  return arr(setting.choices).some((choice) => isTrue(choice, 'selected') && str(choice, 'label') === 'On');
}

export function ModelMenuTray({
  buttons,
  disabled,
  sessionScope,
  onActivate,
}: {
  /** The footer buttons as drawn: the core's `traits`, the Reasoning one following the highlighted row. */
  buttons: JsonRecord[];
  /** The whole picker waits (`modelMenu.disabled`). */
  disabled: boolean;
  /** A long press is desktop's right-click (this session only), which only Claude's picker can do. */
  sessionScope: boolean;
  onActivate: (index: number, secondary: boolean) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  if (buttons.length === 0) return null;
  return (
    <View style={styles.tray}>
      {footerLines(buttons.map((setting, at) => ({ setting, at }))).map((line, lineIndex) => (
        <View key={lineIndex} style={styles.line}>
          {line.map(({ setting, at }) => {
            const icon = str(setting, 'icon');
            const glyph = BUTTON_GLYPHS[icon];
            const fast = icon === 'fast';
            const on = fast && fastOn(setting);
            const label = str(setting, 'label');
            const value = str(setting, 'valueLabel');
            const off = disabled || isTrue(setting, 'disabled');
            // Reasoning, Context Window and Fast keep their full width; other buttons give way (the user's decision in render.rs).
            const keepsWidth = icon === 'reasoning' || icon === 'context' || fast;
            return (
              <Pressable
                key={`${at}:${str(setting, 'id')}`}
                accessibilityRole="button"
                accessibilityLabel={value.length > 0 ? `${label}: ${value}` : label}
                accessibilityState={{ disabled: off }}
                disabled={off}
                onPress={() => onActivate(at, false)}
                {...(sessionScope ? { onLongPress: () => onActivate(at, true) } : {})}
                style={({ pressed }) => [
                  styles.button,
                  keepsWidth ? styles.keepsWidth : styles.givesWay,
                  pressed ? styles.lit : null,
                  off ? styles.off : null,
                ]}
              >
                {glyph !== undefined ? (
                  <View style={fast && !on ? styles.dimIcon : null}>
                    <Glyph name={glyph} size={16} color={on ? P.primary : P.ink(0.64)} />
                  </View>
                ) : (
                  <Text style={styles.buttonLabel} numberOfLines={1}>
                    {label}
                  </Text>
                )}
                <Text style={[styles.value, on ? styles.valueOn : fast ? styles.valueMuted : null]} numberOfLines={1}>
                  {value}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** A footer button's choices (`flyout.rs`): each with its Default tag and the selected one checked. */
export function ModelMenuChoices({
  setting,
  sessionScope,
  onChoose,
}: {
  setting: JsonRecord;
  sessionScope: boolean;
  onChoose: (choice: JsonRecord, secondary: boolean) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <ScrollView contentContainerStyle={styles.choices}>
      {arr(setting.choices).map((entry, index) => {
        const choice = obj(entry);
        if (choice === null) return null;
        return (
          <Pressable
            key={`${index}:${String(choice.value)}`}
            accessibilityRole="menuitem"
            accessibilityState={{ checked: isTrue(choice, 'selected') }}
            onPress={() => onChoose(choice, false)}
            {...(sessionScope ? { onLongPress: () => onChoose(choice, true) } : {})}
            style={({ pressed }) => [styles.choice, pressed ? styles.lit : null]}
          >
            <Text style={styles.choiceLabel} numberOfLines={1}>
              {str(choice, 'label')}
            </Text>
            {isTrue(choice, 'isDefault') ? <Text style={styles.defaultTag}>Default</Text> : null}
            {isTrue(choice, 'selected') ? <Glyph name="check" size={17} color={P.menuForeground} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = themedStyles((P) => ({
  tray: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: P.ink(0.08),
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  line: { flexDirection: 'row', gap: 4 },
  button: {
    flexGrow: 1,
    flexBasis: 'auto',
    height: 40,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
  },
  keepsWidth: { flexShrink: 0 },
  givesWay: { flexShrink: 1, minWidth: 0 },
  lit: { backgroundColor: P.ink(0.11) },
  off: { opacity: 0.42 },
  dimIcon: { opacity: 0.6 },
  buttonLabel: { color: P.ink(0.64), fontSize: 14, flexShrink: 0 },
  value: { color: P.menuForeground, fontSize: 14, flexShrink: 1, minWidth: 0 },
  valueOn: { color: P.primary },
  valueMuted: { color: P.ink(0.64) },
  choices: { paddingHorizontal: 8, paddingBottom: 8, gap: 2 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12, borderRadius: 8 },
  choiceLabel: { flex: 1, minWidth: 0, color: P.menuForeground, fontSize: 15 },
  defaultTag: { color: P.ink(0.64), fontSize: 12, fontWeight: '600' },
}));
