/**
 * The Saved draft pill, pinned at the left of the pill strip (`PillsStrip.tsx`) while a draft of
 * this chat saved on another device or in the terminal is offered (`savedDraftPill`, gx-chat-core
 * extras/chat_pills.rs `saved_draft_pill`, where the user's decision lives). A tap opens its sheet:
 * the draft's first lines, then Dismiss and Use draft. It replaced the "Another saved draft is
 * available" row above the box. Desktop: `saved_draft_pill.rs`.
 */

import { Pressable, ScrollView, Text, View } from 'react-native';

import type { SavedDraftPill as SavedDraftPillState } from '../../rust/document';
import type { UserAction } from '../../rust/actions';
import { Glyph } from '../composer/icons';
import { Sheet } from '../composer/Sheet';
import { RIGHT_TO_LEFT_TEXT, startsRightToLeft } from '../transcript/markdown/textDirection';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { savedDraftLabel } from './savedDraft';

/** The ? pill's amber corner dot (`ChatPills.tsx` `ATTENTION_COLOR`, `QUESTION_PING.dotSize`, `DOT_TOP`, `DOT_RIGHT`). */
const ATTENTION_COLOR = '#f5a524';
const DOT_SIZE = 6;

/** The pill: the file icon and "Saved draft", "Draft" or nothing, by the box's `width`. */
export function SavedDraftPill({
  pill,
  width,
  open,
  onPress,
}: {
  pill: SavedDraftPillState;
  /** The chat box's width (the strip's), 0 before it is measured. */
  width: number;
  open: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const shape = savedDraftLabel(width);
  const label = shape === 'full' ? pill.label : shape === 'short' ? pill.shortLabel : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pill.ariaLabel}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        label === null && styles.iconOnly,
        (pressed || open) && styles.pillPressed,
      ]}
    >
      <View pointerEvents="none" style={styles.dot} />
      <Glyph name="file-text" size={12} color={P.cardMuted} />
      {label !== null ? (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The sheet the pill opens: the draft (scrolling when long), the hint, Dismiss and Use draft. */
export function SavedDraftSheet({
  pill,
  open,
  onClose,
  dispatch,
}: {
  pill: SavedDraftPillState | null | undefined;
  open: boolean;
  onClose: () => void;
  dispatch: (action: UserAction) => void;
}) {
  const styles = useStyles();
  const answer = (type: 'useIncomingDraft' | 'dismissIncomingDraft') => {
    onClose();
    dispatch({ type });
  };
  return (
    <Sheet visible={open && pill != null} onClose={onClose} title={pill ? `Saved draft · ${pill.detail}` : ''}>
      {pill ? (
        <View style={styles.body}>
          <ScrollView style={styles.preview} contentContainerStyle={styles.previewContent}>
            {/* One Text per line: each line that starts right to left sits against the right edge, as in the chat box. */}
            {pill.preview.split('\n').map((line, index) => (
              <Text
                key={index}
                style={[styles.previewText, startsRightToLeft(line) && RIGHT_TO_LEFT_TEXT]}
                selectable
              >
                {line.length > 0 ? line : ' '}
              </Text>
            ))}
          </ScrollView>
          {pill.hint.length > 0 ? <Text style={styles.hint}>{pill.hint}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => answer('dismissIncomingDraft')}
              style={({ pressed }) => [styles.button, styles.quiet, pressed && styles.quietPressed]}
            >
              <Text style={styles.quietText}>Dismiss</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => answer('useIncomingDraft')}
              style={({ pressed }) => [styles.button, styles.primary, pressed && styles.primaryPressed]}
            >
              <Text style={styles.primaryText}>Use draft</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
  /** The panel pills' shape (`ChatPills.tsx` `pill`), its label in the foreground. */
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.ink(0.1),
  },
  /** Icon alone, it keeps room on the right for the corner dot. */
  iconOnly: {
    paddingLeft: 7,
    paddingRight: 10,
  },
  pillPressed: {
    backgroundColor: P.ink(0.08),
  },
  dot: {
    position: 'absolute',
    top: 1,
    right: 2,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: ATTENTION_COLOR,
  },
  label: {
    color: P.foreground,
    fontSize: 11.5,
    lineHeight: 16,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  preview: {
    maxHeight: 220,
    borderRadius: 10,
    backgroundColor: P.ink(0.05),
  },
  previewContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  previewText: {
    color: P.foreground,
    fontSize: 14,
    lineHeight: 20,
  },
  hint: {
    color: P.cardMuted,
    fontSize: 12.5,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  button: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
  },
  quiet: {},
  quietPressed: {
    backgroundColor: P.ink(0.06),
  },
  quietText: {
    color: P.cardMuted,
    fontSize: 14,
  },
  primary: {
    backgroundColor: P.controlPrimary,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  primaryText: {
    color: P.background,
    fontSize: 14,
    fontWeight: '600',
  },
}));
