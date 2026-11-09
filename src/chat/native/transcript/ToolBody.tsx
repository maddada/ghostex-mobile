/**
 * A tool's detail block (desktop `tool_body` in `tool_run.rs`), shared by the tool rows and the
 * tool-call card.
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTranscriptEnv } from './context';
import { Glyph } from './icons';
import { CODE_LINE, CODE_SIZE, MONO_FONT } from './theme';

/**
 * One labelled block of a tool's detail: verbatim monospaced text in a height-capped box, selectable
 * with a long press. A non-empty `copyText` puts the copy button for the whole call on its label row
 * (desktop `tool_run.rs`).
 */
export function ToolBody({
  label,
  content,
  failed,
  copyText,
}: {
  label: string | null;
  content: string;
  failed: boolean;
  copyText: string;
}) {
  // Tool call lines cut a long output at 12 lines instead of capping its box (`ToolCard.tsx`).
  const { theme, toolLines } = useTranscriptEnv();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [copyText]);
  return (
    <View style={styles.bodyGroup}>
      {label !== null || copyText.length > 0 ? (
        <View style={styles.bodyHeader}>
          <Text numberOfLines={1} style={[styles.bodyLabel, { color: theme.muted }]}>
            {label ?? ''}
          </Text>
          {copyText.length > 0 ? (
            <Pressable
              hitSlop={6}
              onPress={copy}
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied' : 'Copy tool call'}
              style={({ pressed }) => [styles.copyAction, pressed && { backgroundColor: theme.pressed }]}
            >
              <Glyph name={copied ? 'check' : 'copy'} size={14} color={theme.muted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <ScrollView
        nestedScrollEnabled
        style={[styles.bodyBox, toolLines === true && styles.bodyBoxUncapped, { backgroundColor: theme.input }]}
        contentContainerStyle={styles.bodyContent}
      >
        <Text selectable style={[styles.bodyText, { color: failed ? theme.error : theme.muted }]}>
          {content}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bodyGroup: { gap: 4, minWidth: 0 },
  bodyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 },
  bodyLabel: { fontSize: 12.25, flexShrink: 1 },
  copyAction: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  bodyBox: { maxHeight: 220.75, borderRadius: 6 },
  bodyBoxUncapped: { maxHeight: undefined },
  bodyContent: { paddingHorizontal: 10, paddingVertical: 8 },
  bodyText: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, lineHeight: CODE_LINE },
});
