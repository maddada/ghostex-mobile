/**
 * Logs › Send to developer: the review step before the logs leave the phone (`feedback/logReport.ts` holds the
 * issue's text). It says what is included, what is replaced and what is never sent, that the issue is public, takes
 * an optional note and GitHub username, shows the exact text on request, and sends only on Send.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppLogStore } from '../../app/appLog';
import { SendLogsCopy } from '../../copy';
import { githubUsername } from '../../feedback/feedbackDraft';
import { feedbackRequest, sendFeedback } from '../../feedback/feedbackRelay';
import { logReport } from '../../feedback/logReport';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { SetupButton } from '../onboarding/SetupPrimitives';

/** The GitHub username Send Bug / Feedback last named (src/screens/FeedbackScreen.tsx). */
const GITHUB_USERNAME_KEY = 'feedback.githubUsername.v1';

type Sending =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; issueNumber: number; issueUrl: string }
  | { kind: 'failed'; message: string };

export default function SendLogsReview({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const entries = useAppLogStore((state) => state.entries);
  const [note, setNote] = useState('');
  const [username, setUsername] = useState('');
  const [showText, setShowText] = useState(false);
  const [sending, setSending] = useState<Sending>({ kind: 'idle' });

  useEffect(() => {
    void AsyncStorage.getItem(GITHUB_USERNAME_KEY)
      .then((stored) => {
        if (stored !== null) setUsername((current) => (current.length === 0 ? stored : current));
      })
      .catch(() => undefined);
  }, []);

  const name = githubUsername(username);
  const report = useMemo(
    () => logReport(entries, note, typeof name === 'string' ? name : null),
    [entries, note, name],
  );

  const send = (): void => {
    if (name === undefined) return;
    setSending({ kind: 'sending' });
    if (typeof name === 'string') void AsyncStorage.setItem(GITHUB_USERNAME_KEY, name).catch(() => undefined);
    void sendFeedback(feedbackRequest(report.title, report.body, [], name ?? ''))
      .then((issue) => setSending({ kind: 'sent', ...issue }))
      .catch((error: unknown) =>
        setSending({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
      );
  };

  if (sending.kind === 'sent') {
    return (
      <View style={styles.body}>
        <Text style={styles.title}>{SendLogsCopy.sent(sending.issueNumber)}</Text>
        <Text style={styles.lede}>{SendLogsCopy.sentDetail}</Text>
        <View style={styles.foot}>
          <SetupButton
            label={SendLogsCopy.openIssue}
            style={styles.footButton}
            onPress={() => void Linking.openURL(sending.issueUrl)}
          />
          <SetupButton variant="primary" label={SendLogsCopy.done} style={styles.footButton} onPress={onDone} />
        </View>
      </View>
    );
  }

  const row = (mark: 'in' | 'out', text: string, detail?: string) => (
    <View key={text} style={styles.item}>
      <Text style={[styles.mark, mark === 'in' ? { color: appearance.connected } : null]}>
        {mark === 'in' ? '✓' : '×'}
      </Text>
      <Text style={styles.itemText}>
        {text}
        {detail !== undefined ? <Text style={styles.itemDetail}> {detail}</Text> : null}
      </Text>
    </View>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        {SendLogsCopy.title}
      </Text>
      <Text style={styles.lede}>{SendLogsCopy.lede}</Text>
      <View style={styles.publicNote}>
        <Text style={styles.publicText}>{SendLogsCopy.public}</Text>
      </View>
      <View style={styles.items}>
        {row('in', SendLogsCopy.included.events, SendLogsCopy.lines(report.lineCount))}
        {row('in', SendLogsCopy.included.device)}
        {row('in', SendLogsCopy.included.routes)}
        {row('out', SendLogsCopy.replaced, SendLogsCopy.replacedDetail)}
        {row('out', SendLogsCopy.never, SendLogsCopy.neverDetail)}
      </View>
      <TextInput
        style={[styles.input, styles.note]}
        value={note}
        onChangeText={setNote}
        placeholder={SendLogsCopy.notePlaceholder}
        placeholderTextColor={appearance.muted}
        multiline
      />
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        placeholder={SendLogsCopy.usernamePlaceholder}
        placeholderTextColor={appearance.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {name === undefined ? <Text style={styles.error}>{SendLogsCopy.badUsername}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showText }}
        style={({ pressed }) => [styles.input, pressed ? { opacity: 0.7 } : null]}
        onPress={() => setShowText((shown) => !shown)}
      >
        <Text style={styles.toggleText}>{showText ? SendLogsCopy.hideText : SendLogsCopy.showText}</Text>
      </Pressable>
      {showText ? (
        <View style={styles.exact}>
          <Text selectable style={styles.exactTitle}>
            {report.title}
          </Text>
          <Text selectable style={styles.exactBody}>
            {report.body}
          </Text>
        </View>
      ) : null}
      {sending.kind === 'failed' ? <Text style={styles.error}>{sending.message}</Text> : null}
      <View style={styles.foot}>
        <SetupButton label={SendLogsCopy.cancel} style={styles.footButton} onPress={onCancel} />
        <SetupButton
          variant="primary"
          label={SendLogsCopy.send}
          style={styles.footButton}
          busy={sending.kind === 'sending'}
          disabled={name === undefined}
          onPress={send}
        />
      </View>
    </ScrollView>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    scroll: { flexGrow: 0 },
    body: { paddingHorizontal: 4, paddingBottom: 4 },
    title: { color: appearance.foreground, fontSize: 17, fontWeight: '700' },
    lede: { color: appearance.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
    publicNote: {
      marginTop: 10,
      borderRadius: GhostexRadii.row,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.card,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    publicText: { color: appearance.foreground, fontSize: 13, lineHeight: 18 },
    items: { marginTop: 10, gap: 6 },
    item: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    mark: { width: 12, color: appearance.muted, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    itemText: { flex: 1, color: appearance.foreground, fontSize: 13, lineHeight: 18 },
    itemDetail: { color: appearance.muted, fontSize: 12 },
    input: {
      marginTop: 10,
      minHeight: 40,
      borderRadius: GhostexRadii.row,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.input,
      color: appearance.foreground,
      paddingHorizontal: 10,
      paddingVertical: 9,
      fontSize: 14,
      justifyContent: 'center',
    },
    note: { minHeight: 64, textAlignVertical: 'top' },
    toggleText: { color: appearance.foreground, fontSize: 13 },
    exact: {
      marginTop: 8,
      borderRadius: GhostexRadii.row,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      padding: 10,
      gap: 6,
    },
    exactTitle: { color: appearance.foreground, fontSize: 12, fontWeight: '600' },
    exactBody: { color: appearance.muted, fontSize: 11, lineHeight: 15, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
    error: { color: appearance.danger, fontSize: 12, marginTop: 8 },
    foot: { flexDirection: 'row', gap: 8, marginTop: 14 },
    footButton: { flex: 1 },
  });
