/**
 * Result sheet for the Export Transcript agent action (plan 015 §6).
 *
 * The markdown file the daemon wrote lives on the MACHINE's filesystem, not on
 * the phone, so the sheet can only show its absolute path and offer the two
 * things that path is good for: handing it to a fresh agent conversation on
 * that same machine, or copying it so the user can mention it themselves.
 *
 * Presentation follows the app's other bottom sheets (ActionSheet/LogsSheet):
 * modal backdrop, sheet card, selectable monospace body, action rows.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export type ExportTranscriptSheetProps = {
  visible: boolean;
  /** Session the transcript was exported from — the sheet's subtitle. */
  sessionTitle: string;
  /** Absolute path of the exported markdown file on the machine. */
  path: string;
  /** Agent the follow-up conversation starts (empty hides that row). */
  agentLabel: string;
  /** True while the follow-up session is being created. */
  starting: boolean;
  /** Failure of the last in-sheet action, in the standard error copy. */
  error: string | null;
  onStartNewConversation: () => void;
  onClose: () => void;
};

const COPIED_RESET_MS = 2000;

export default function ExportTranscriptSheet({
  visible,
  sessionTitle,
  path,
  agentLabel,
  starting,
  error,
  onStartNewConversation,
  onClose,
}: ExportTranscriptSheetProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyPath = (): void => {
    void Clipboard.setStringAsync(path).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>Transcript Exported</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {sessionTitle}
          </Text>
          <ScrollView style={styles.pathBox} contentContainerStyle={styles.pathContent}>
            <Text selectable style={styles.path}>
              {path}
            </Text>
          </ScrollView>
          {error !== null && error.length > 0 ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.rows}>
            {agentLabel.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                disabled={starting}
                style={({ pressed }) => [
                  styles.row,
                  pressed ? styles.rowPressed : null,
                  starting ? styles.rowDisabled : null,
                ]}
                onPress={onStartNewConversation}
              >
                <Text style={styles.rowLabel}>
                  {starting ? 'Handing off…' : 'Handoff'}
                </Text>
                <Text style={styles.rowDetail}>
                  {`Opens a new ${agentLabel} session in this project with the transcript mentioned in its input, ready for your prompt. Nothing is sent for you.`}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
              onPress={copyPath}
            >
              <Text style={styles.rowLabel}>{copied ? 'Copied' : 'Copy path'}</Text>
              <Text style={styles.rowDetail}>The file stays on the machine that ran the agent.</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: GhostexPalette.BACKGROUND,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    paddingTop: 14,
    paddingBottom: 24,
    paddingHorizontal: 12,
    maxHeight: '80%',
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },
  subtitle: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  pathBox: {
    marginTop: 10,
    maxHeight: 120,
    borderRadius: GhostexRadii.input,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
  },
  pathContent: {
    padding: 10,
  },
  path: {
    color: GhostexPalette.FOREGROUND,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  error: {
    color: GhostexPalette.DANGER,
    fontSize: 12,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  rows: {
    marginTop: 10,
    gap: 6,
  },
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  rowPressed: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rowDetail: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 2,
  },
});
