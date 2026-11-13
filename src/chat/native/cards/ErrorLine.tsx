/**
 * One problem said inside a card, a form or a sheet of the chat ("Couldn't save the answer",
 * "The link isn't valid"): a small rose alert mark beside the sentence in the card's calm text
 * colour, never a whole line of bright red. The chat's errors that stand on their own use the
 * tone cards (`ToneCard.tsx`, `ErrorCard.tsx`); this is for the sentence inside one.
 *
 * CDXC:Dictate 2026-11-13 DECISION: User: "make all of the other errors also look nice". The chat's and the chat box's error lines share this look instead of each drawing its sentence in its own red (#ef9999, #ef4444).
 */

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Glyph } from './icons';
import { useTranscriptTheme } from '../transcript/theme';

/** The tone cards' error hue (`notice-tone.json` `error`). */
export function errorHue(light: boolean): string {
  return light ? '#be123c' : '#fb7185';
}

export function ErrorLine({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  const P = useTranscriptTheme();
  return (
    <View style={[styles.row, style]} accessibilityRole="alert">
      <View style={styles.mark}>
        <Glyph name="alert-circle" size={14} color={errorHue(P.light)} />
      </View>
      <Text selectable style={[styles.text, { color: P.foreground }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  /** Centres the 14pt mark on the text's first 18pt line. */
  mark: { paddingTop: 2 },
  text: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
});
