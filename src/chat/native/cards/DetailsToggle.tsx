/**
 * A card's Details toggle: a quiet "Details" text button that opens the terminal's own words (a notice's `details` and
 * `errorLines`, an API error's line) in a mono box on the card's row surface. Draws nothing when there is nothing to show.
 *
 * CDXC:SessionChat 2026-11-03 DECISION: User (Q1136): raw terminal output sits behind a Details toggle on the card, never in
 * its sentences; the desktop has the same toggle.
 * SEE-ALSO: apps/desktop/src/app/native_chat/tone_card.rs (`details_toggle`), server/src/session_chat_notice/types.rs (`details`).
 */

import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { MONO_FONT, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { FoldChevron } from '../transcript/foldChevron';

export function DetailsToggle({ lines }: { lines: ReadonlyArray<unknown> }) {
  const P = useTranscriptTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const text = lines
    .flatMap((line) => (typeof line === 'string' && line.trim() !== '' ? [line.trim()] : []))
    .join('\n');
  if (text === '') return null;
  return (
    <View style={styles.column}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide details' : 'Show details'}
        hitSlop={8}
        onPress={() => setOpen((value) => !value)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>Details</Text>
        <FoldChevron open={open} size={12} color={P.muted} />
      </Pressable>
      {open ? (
        <ScrollView style={styles.box} nestedScrollEnabled>
          <Text style={styles.mono} selectable>
            {text}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  column: { gap: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: 22 },
  toggleText: { color: P.muted, fontSize: 13 },
  box: {
    maxHeight: 240,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.controlBorder,
    backgroundColor: P.cardRow,
    padding: 10,
  },
  mono: { color: P.cardMuted, fontFamily: MONO_FONT, fontSize: 12, lineHeight: 17 },
}));
