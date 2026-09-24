/**
 * "Another saved draft is available" (`composer.rs`, React's `session-chat-draft-conflict.tsx`):
 * a draft from another device is offered, never written over what is typed. Tapping the document
 * glyph previews it (desktop shows the same preview in the glyph's tooltip).
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { IncomingDraft } from '../../rust/document';
import { Glyph } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function IncomingDraftBar({ draft, dispatch }: { draft: IncomingDraft; dispatch: (action: UserAction) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [preview, setPreview] = useState(false);
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Preview the saved draft"
          hitSlop={6}
          onPress={() => setPreview(!preview)}
          style={({ pressed }) => [styles.glyph, pressed || preview ? styles.pressed : null]}
        >
          <Glyph name="file-text" size={15} color={P.muted} />
        </Pressable>
        <Text style={styles.text} numberOfLines={1}>
          Another saved draft is available
        </Text>
        <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'useIncomingDraft' })} style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}>
          <Text style={styles.buttonText}>Use</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'dismissIncomingDraft' })} style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}>
          <Text style={styles.buttonText}>Dismiss</Text>
        </Pressable>
      </View>
      {preview ? (
        <Text style={styles.preview} numberOfLines={8}>
          {draft.content.slice(0, 600)}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  wrap: { gap: 6 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  glyph: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: P.border },
  text: { flex: 1, color: P.primary, fontSize: 13 },
  button: { paddingHorizontal: 10, height: 30, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: P.border },
  buttonText: { color: P.primary, fontSize: 13 },
  preview: { color: P.muted, fontSize: 12.5, lineHeight: 18, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: P.border, backgroundColor: P.composerBackground },
}));
