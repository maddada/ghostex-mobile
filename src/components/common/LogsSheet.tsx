/**
 * Logs bottom sheet, opened from the Sessions ☰ menu, the Connections sheet and Settings › Connection: the
 * in-app event log (appLog.ts) as selectable timestamped lines, newest last,
 * with a Copy button that puts the full plain-text log on the clipboard, Export, which shares it as a .txt file
 * (logExport.ts), and Send to developer, which opens its review step (SendLogsReview.tsx) in the same sheet and is the
 * only path that files a GitHub issue. Half folded like a laptop it starts below the fold and the log scrolls inside.
 *
 * CDXC:RemoteMachines 2026-11-13 DECISION: the Connections sheet's Send logs opens Export (the share sheet with the
 * file), not the GitHub review: Sebastian wants a file he can save or send. The sheet opens under it so a failed
 * export says "Couldn't export" on its button.
 */

import { useMemo, useEffect, useRef, useState } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useFoldSheetMaxHeight } from './foldAvoidance';
import { useVerticalBarSpace } from './verticalBar/VerticalBarArea';
import * as Clipboard from 'expo-clipboard';

import { formatAppLog, formatLogTime, logEntryText, useAppLogStore } from '../../app/appLog';
import { LogsCopy, SendLogsCopy } from '../../copy';
import SendLogsReview from './SendLogsReview';
import { exportLogs } from '../../feedback/logExport';
import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export type LogsSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Starts Export as it opens (the Connections sheet's Send logs). */
  exportNow?: boolean;
};

const SHOWN_LINES = 300;
/** The Modal's fade takes about 300 ms. */
const EXPORT_ON_OPEN_DELAY_MS = 450;

export default function LogsSheet({ visible, onClose, exportNow = false }: LogsSheetProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const bar = useVerticalBarSpace();
  const foldMaxHeight = useFoldSheetMaxHeight({ avoidsKeyboard: false });
  const entries = useAppLogStore((state) => state.entries);
  const [copied, setCopied] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  // The sheet draws the newest lines only; Copy, Export and Send take the whole kept log.
  const shown = entries.length > SHOWN_LINES ? entries.slice(-SHOWN_LINES) : entries;
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      if (exportTimer.current !== null) clearTimeout(exportTimer.current);
    },
    [],
  );

  const copyLog = (): void => {
    void Clipboard.setStringAsync(formatAppLog(entries)).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  const exportLog = (): void => {
    if (exporting) return;
    setExporting(true);
    setExportFailed(false);
    void exportLogs(entries)
      .catch(() => {
        // The button says so for a moment instead of looking like it did nothing.
        setExportFailed(true);
        if (exportTimer.current !== null) clearTimeout(exportTimer.current);
        exportTimer.current = setTimeout(() => setExportFailed(false), 3000);
      })
      .finally(() => setExporting(false));
  };

  const exportedOnOpen = useRef(false);
  useEffect(() => {
    if (!exportNow || !visible || exportedOnOpen.current) return;
    // After the sheet's own fade-in: iOS shows the share sheet only from a screen that is done presenting.
    const timer = setTimeout(() => {
      exportedOnOpen.current = true;
      exportLog();
    }, EXPORT_ON_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
    // Once per opening; `exportLog` reads the entries of the moment it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportNow, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[styles.backdrop, bar.padding]} onPress={onClose}>
          <Pressable
            style={[styles.sheet, foldMaxHeight !== undefined && { maxHeight: foldMaxHeight }]}
            onPress={(event) => event.stopPropagation()}
          >
            {reviewing ? (
              <SendLogsReview onCancel={() => setReviewing(false)} onDone={onClose} />
            ) : (
              <>
                <View style={styles.headerRow}>
                  <Text style={styles.title}>Logs</Text>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.copyButton, pressed && styles.copyButtonPressed]}
                    disabled={entries.length === 0}
                    onPress={copyLog}
                  >
                    <Text style={[styles.copyButtonLabel, entries.length === 0 ? styles.copyButtonDisabled : null]}>
                      {copied ? 'Copied' : 'Copy'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.copyButton, styles.sendButton, pressed && styles.copyButtonPressed]}
                    disabled={entries.length === 0 || exporting}
                    onPress={exportLog}
                  >
                    <Text style={[styles.copyButtonLabel, entries.length === 0 ? styles.copyButtonDisabled : null]}>
                      {exporting ? LogsCopy.exporting : exportFailed ? LogsCopy.exportFailed : LogsCopy.export}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.copyButton, styles.sendButton, pressed && styles.copyButtonPressed]}
                    disabled={entries.length === 0}
                    onPress={() => setReviewing(true)}
                  >
                    <Text style={[styles.copyButtonLabel, entries.length === 0 ? styles.copyButtonDisabled : null]}>
                      {SendLogsCopy.button}
                    </Text>
                  </Pressable>
                </View>
                <Text style={styles.subtitle}>
                  {entries.length > shown.length
                    ? LogsCopy.subtitleNewest(shown.length, entries.length)
                    : 'Recent connection and status events on this phone.'}
                </Text>
                <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                  {entries.length === 0 ? (
                    <Text style={styles.emptyText}>No log entries yet.</Text>
                  ) : (
                    shown.map((entry, index) => (
                      <View key={`${entry.at}-${index}`} style={styles.row}>
                        <Text style={styles.rowTime}>{formatLogTime(entry.at)}</Text>
                        <Text selectable style={styles.rowMessage}>
                          {logEntryText(entry)}
                        </Text>
                      </View>
                    ))
                  )}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  fill: {
    flex: 1,
  },
  sendButton: {
    marginLeft: 8,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: appearance.background,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    paddingTop: 14,
    paddingBottom: 24,
    paddingHorizontal: 12,
    maxHeight: '80%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  title: {
    flex: 1,
    color: appearance.foreground,
    fontSize: 15,
    fontWeight: 'bold',
  },
  copyButton: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: GhostexRadii.row,
    backgroundColor: appearance.neutralFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyButtonPressed: {
    backgroundColor: appearance.neutralFillPressed,
  },
  copyButtonLabel: {
    color: appearance.foreground,
    fontSize: 12,
    fontWeight: '600',
  },
  copyButtonDisabled: {
    opacity: 0.4,
  },
  subtitle: {
    color: appearance.muted,
    fontSize: 12,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  list: {
    marginTop: 10,
  },
  listContent: {
    gap: 4,
    paddingBottom: 4,
  },
  emptyText: {
    color: appearance.muted,
    fontSize: 12,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    gap: 8,
  },
  rowTime: {
    color: appearance.muted,
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  rowMessage: {
    flex: 1,
    color: appearance.foreground,
    fontSize: 11,
    lineHeight: 16,
  },
});
