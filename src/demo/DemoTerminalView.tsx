/**
 * A terminal that replays a bundled script and answers a few typed commands
 * locally. It does not open a PTY or an SSH channel.
 */

import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { DemoCopy } from './copy';
import { demoTerminalAnswer, demoTerminalScript } from './world';

type Props = {
  sessionId: string;
  style?: StyleProp<ViewStyle>;
};

export default function DemoTerminalView({ sessionId, style }: Props) {
  const script = useMemo(() => demoTerminalScript(sessionId), [sessionId]);
  const [shown, setShown] = useState(1);
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setShown(1);
    setExtra([]);
    setDraft('');
    const timer = setInterval(() => {
      setShown((count) => {
        if (count >= script.length) {
          clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, 140);
    return () => clearInterval(timer);
  }, [script]);

  const submit = (): void => {
    const command = draft;
    setDraft('');
    const answer = demoTerminalAnswer(command);
    const prompt = script[script.length - 1] ?? '$';
    setExtra((lines) => [...lines, command, ...(answer.length > 0 ? answer.split('\n') : []), prompt]);
  };

  const lines = [...script.slice(0, shown), ...extra];
  return (
    <View style={[styles.root, style]}>
      <Text style={styles.note}>{DemoCopy.terminalNote}</Text>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.output} selectable>
          {lines.join('\n')}
        </Text>
      </ScrollView>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={submit}
        placeholder="Type a command"
        placeholderTextColor="#8b93a7"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel="Terminal command"
      />
    </View>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1c1c1c' },
  note: { color: '#c8c2b4', fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingTop: 8 },
  scroll: { paddingHorizontal: 12, paddingVertical: 10 },
  output: { color: '#e8e6e3', fontFamily: mono, fontSize: 13, lineHeight: 18 },
  input: {
    color: '#e8e6e3',
    fontFamily: mono,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3a3a3a',
  },
});
