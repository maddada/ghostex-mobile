/**
 * PLACEHOLDER machine editor (sessions-drawer.md §4 merged with the VVTerm
 * add-server form, onboarding.md §2). Minimal fields wired to the machines
 * store so add/edit works end-to-end; the full form is a follow-up agent's job.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MachineCopy } from '../copy';
import { useMachinesStore, type MachineValidationErrors } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'MachineForm'>;

export default function MachineFormScreen({ navigation, route }: Props) {
  const machineId = route.params?.machineId ?? null;
  const machines = useMachinesStore((state) => state.machines);
  const addMachine = useMachinesStore((state) => state.addMachine);
  const updateMachine = useMachinesStore((state) => state.updateMachine);
  const existing = machineId === null ? null : machines.find((m) => m.id === machineId) ?? null;

  const [name, setName] = useState(existing?.name ?? '');
  const [host, setHost] = useState(existing?.host ?? '');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [port, setPort] = useState(existing === null ? '22' : String(existing.port));
  const [savePassword, setSavePassword] = useState(existing?.savePassword ?? false);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<MachineValidationErrors | null>(null);

  const save = async (): Promise<void> => {
    const input = { name, host, username, port, savePassword, password };
    const result =
      existing === null ? await addMachine(input) : await updateMachine(existing.id, input);
    if (result.ok) {
      navigation.goBack();
      return;
    }
    setErrors(result.errors);
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.body}>{MachineCopy.editor.body}</Text>
        <TextInput
          style={styles.input}
          placeholder="Display name"
          placeholderTextColor={GhostexPalette.MUTED}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Tailscale host or IP"
          placeholderTextColor={GhostexPalette.MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          value={host}
          onChangeText={setHost}
        />
        <TextInput
          style={styles.input}
          placeholder="SSH username"
          placeholderTextColor={GhostexPalette.MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="SSH port"
          placeholderTextColor={GhostexPalette.MUTED}
          keyboardType="number-pad"
          value={port}
          onChangeText={setPort}
        />
        {errors?.port !== undefined ? <Text style={styles.error}>{errors.port}</Text> : null}
        <Text style={styles.body}>{MachineCopy.editor.passwordBody}</Text>
        <TextInput
          style={styles.input}
          placeholder={
            existing === null ? MachineCopy.editor.passwordHintNew : MachineCopy.editor.passwordHintEdit
          }
          placeholderTextColor={GhostexPalette.MUTED}
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
        />
        <Pressable style={styles.checkboxRow} onPress={() => setSavePassword(!savePassword)}>
          <Switch value={savePassword} onValueChange={setSavePassword} />
          <Text style={styles.checkboxLabel}>{MachineCopy.editor.savePasswordCheckbox}</Text>
        </Pressable>
        {errors?.password !== undefined ? <Text style={styles.error}>{errors.password}</Text> : null}
        {errors?.duplicate !== undefined ? <Text style={styles.error}>{errors.duplicate}</Text> : null}
        {errors !== null ? <Text style={styles.error}>{errors.general}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.saveButton} onPress={() => void save()}>
          <Text style={styles.saveLabel}>{existing === null ? 'Add' : 'Save'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  form: {
    padding: 12,
    gap: 10,
  },
  body: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
  },
  input: {
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    color: GhostexPalette.FOREGROUND,
    paddingHorizontal: 12,
    height: 44,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkboxLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    flex: 1,
  },
  error: {
    color: GhostexPalette.DANGER,
    fontSize: 12,
  },
  saveButton: {
    marginTop: 8,
    height: 44,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
  },
});
