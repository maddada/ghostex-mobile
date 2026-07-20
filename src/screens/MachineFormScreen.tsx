/**
 * Add/Edit machine form: VVTerm add-server structure (onboarding.md §2, §5)
 * merged with the Android password-save semantics (sessions-drawer.md §4).
 *
 * - Server: name, host + port row, username (blank → "root" on save).
 * - Authentication: Password / SSH Key / SSH Key + Passphrase, paste-or-generate
 *   key source, Android save-password checkbox wired to credentials.ts.
 * - Connection: optional Test Connection via GhostexNative.connect + disconnect.
 * - Save goes through the machines store (validation + password persistence),
 *   then key credentials are written per machine id. Does NOT auto-connect.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative, type SshConfig, type SshKeyType } from '../../modules/ghostex-native/src';
import SegmentedControl, { type SegmentOption } from '../components/onboarding/SegmentedControl';
import { MachineCopy } from '../copy';
import { summarizeFailure } from '../inventory/client';
import {
  getPassphrase,
  getPublicKey,
  getSshKey,
  resolvePassword,
  setPassphrase,
  setPublicKey,
  setSshKey,
} from '../machines/credentials';
import {
  useMachinesStore,
  type MachineInput,
  type MachineValidationErrors,
} from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'MachineForm'>;

type AuthMethod = 'password' | 'key' | 'keyPassphrase';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success' }
  | { kind: 'failure'; message: string };

const AUTH_METHOD_OPTIONS: readonly SegmentOption<AuthMethod>[] = [
  { value: 'password', label: 'Password' },
  { value: 'key', label: 'SSH Key' },
  { value: 'keyPassphrase', label: 'SSH Key + Passphrase' },
];

const ALGORITHM_OPTIONS: readonly SegmentOption<SshKeyType>[] = [
  { value: 'ed25519', label: 'Ed25519' },
  { value: 'rsa4096', label: 'RSA 4096' },
];

const SUCCESS_GREEN = '#22C55E';
const MONOSPACE = Platform.select({ ios: 'Menlo', default: 'monospace' });

function parsePort(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}

export default function MachineFormScreen({ navigation, route }: Props) {
  const machineId = route.params?.machineId ?? null;
  const machines = useMachinesStore((state) => state.machines);
  const addMachine = useMachinesStore((state) => state.addMachine);
  const updateMachine = useMachinesStore((state) => state.updateMachine);
  const existing = machineId === null ? null : machines.find((m) => m.id === machineId) ?? null;

  // Server section.
  const [name, setName] = useState(existing?.name ?? '');
  const [host, setHost] = useState(existing?.host ?? '');
  const [port, setPort] = useState(existing === null ? '22' : String(existing.port));
  const [username, setUsername] = useState(existing?.username ?? '');

  // Authentication section.
  const [method, setMethod] = useState<AuthMethod>('password');
  const [password, setPassword] = useState('');
  const [savePassword, setSavePassword] = useState(existing?.savePassword ?? false);
  const [privateKey, setPrivateKey] = useState('');
  const [keyPassphrase, setKeyPassphrase] = useState('');
  const [publicKey, setPublicKeyText] = useState<string | null>(null);

  // Inline generate panel.
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genName, setGenName] = useState('');
  const [genAlgorithm, setGenAlgorithm] = useState<SshKeyType>('ed25519');
  const [genPassphrase, setGenPassphrase] = useState('');
  const [genConfirm, setGenConfirm] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<MachineValidationErrors | null>(null);

  // Edit mode: infer the auth method from stored key credentials.
  useEffect(() => {
    if (machineId === null) return;
    let cancelled = false;
    void (async () => {
      const [key, passphrase, storedPublicKey] = await Promise.all([
        getSshKey(machineId),
        getPassphrase(machineId),
        getPublicKey(machineId),
      ]);
      if (cancelled) return;
      if (key !== null && key.length > 0) {
        setPrivateKey(key);
        if (passphrase !== null && passphrase.length > 0) {
          setKeyPassphrase(passphrase);
          setMethod('keyPassphrase');
        } else {
          setMethod('key');
        }
      }
      if (storedPublicKey !== null && storedPublicKey.length > 0) {
        setPublicKeyText(storedPublicKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  /** Any edit to a connection-affecting field invalidates the last test. */
  const resetTest = (): void => {
    setTestState((current) => (current.kind === 'idle' ? current : { kind: 'idle' }));
  };
  const editField =
    <T,>(setter: (value: T) => void) =>
    (value: T): void => {
      setter(value);
      resetTest();
    };

  const parsedPort = parsePort(port);
  const credentialsValid =
    method === 'password'
      ? true // Android semantics: password is optional (SSH keys / Tailscale SSH).
      : method === 'key'
        ? privateKey.trim().length > 0
        : privateKey.trim().length > 0 && keyPassphrase.length > 0;
  const canSave =
    name.trim().length > 0 && host.trim().length > 0 && parsedPort !== null && credentialsValid;
  const canTest = host.trim().length > 0 && parsedPort !== null && credentialsValid;

  const buildTestConfig = async (): Promise<{ config: SshConfig; hasPassword: boolean }> => {
    const config: SshConfig = {
      host: host.trim(),
      port: parsedPort ?? 22,
      username: username.trim().length > 0 ? username.trim() : 'root',
    };
    if (method === 'password') {
      // A blank field while editing keeps the stored password, so test with it.
      const effective =
        password.length > 0
          ? password
          : existing !== null
            ? await resolvePassword(existing.id)
            : null;
      if (effective !== null && effective.length > 0) config.password = effective;
    } else {
      config.privateKey = privateKey.trim();
      if (method === 'keyPassphrase') config.passphrase = keyPassphrase;
    }
    return { config, hasPassword: config.password !== undefined };
  };

  const runTest = async (): Promise<void> => {
    if (!canTest || testState.kind === 'testing') return;
    setTestState({ kind: 'testing' });
    const tempId = `machine-form-test-${Date.now()}`;
    try {
      const { config, hasPassword } = await buildTestConfig();
      try {
        await GhostexNative.connect(tempId, config);
        await GhostexNative.disconnect(tempId);
        setTestState({ kind: 'success' });
      } catch (error) {
        try {
          await GhostexNative.disconnect(tempId);
        } catch {
          // The test client may never have registered; nothing to clean up.
        }
        const message = error instanceof Error ? error.message : String(error);
        setTestState({ kind: 'failure', message: summarizeFailure(message, hasPassword) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestState({ kind: 'failure', message: summarizeFailure(message, false) });
    }
  };

  const runGenerate = async (): Promise<void> => {
    if (generating) return;
    if (genPassphrase !== genConfirm) {
      setGenError('Passphrases do not match.');
      return;
    }
    setGenError(null);
    setGenerating(true);
    try {
      const comment = genName.trim().replace(/\s+/g, '_');
      const generated = await GhostexNative.generateSshKey(
        genAlgorithm,
        comment,
        genPassphrase.length > 0 ? genPassphrase : undefined,
      );
      setPrivateKey(generated.privateKey);
      setPublicKeyText(generated.publicKey);
      if (genPassphrase.length > 0) {
        // An encrypted key needs its passphrase to connect.
        setKeyPassphrase(genPassphrase);
        setMethod('keyPassphrase');
      }
      resetTest();
    } catch (error) {
      setGenError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!canSave || saving) return;
    setSaving(true);
    setErrors(null);
    const input: MachineInput = {
      name: name.trim(),
      host: host.trim(),
      username: username.trim().length > 0 ? username.trim() : 'root',
      port,
      savePassword: method === 'password' ? savePassword : false,
      password: method === 'password' ? password : '',
    };
    const result =
      existing === null ? await addMachine(input) : await updateMachine(existing.id, input);
    if (!result.ok) {
      setErrors(result.errors);
      setSaving(false);
      return;
    }
    const id = result.machine.id;
    if (method === 'password') {
      // Switching to password auth clears any previously stored key material.
      await Promise.all([setSshKey(id, ''), setPassphrase(id, ''), setPublicKey(id, '')]);
    } else {
      await Promise.all([
        setSshKey(id, privateKey.trim()),
        setPassphrase(id, method === 'keyPassphrase' ? keyPassphrase : ''),
        setPublicKey(id, publicKey ?? ''),
      ]);
    }
    navigation.goBack();
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: existing === null ? 'Add Server' : MachineCopy.editor.editTitle,
      headerLeft: () => (
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => navigation.goBack()}>
          <Text style={headerStyles.cancel}>Cancel</Text>
        </Pressable>
      ),
      headerRight: () =>
        saving || testState.kind === 'testing' ? (
          <ActivityIndicator size="small" color={GhostexPalette.ACCENT} />
        ) : (
          <Pressable accessibilityRole="button" disabled={!canSave} onPress={() => void save()}>
            <Text style={[headerStyles.action, !canSave && headerStyles.actionDisabled]}>
              {existing === null ? 'Add' : 'Save'}
            </Text>
          </Pressable>
        ),
    });
  });

  const testDisabled = !canTest || testState.kind === 'testing';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionHeader}>Server</Text>
        <TextInput
          style={styles.input}
          placeholder="My Server"
          placeholderTextColor={GhostexPalette.MUTED}
          value={name}
          onChangeText={setName}
        />
        <View style={styles.hostRow}>
          <TextInput
            style={[styles.input, styles.hostInput]}
            placeholder="203.0.113.10"
            placeholderTextColor={GhostexPalette.MUTED}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            value={host}
            onChangeText={editField(setHost)}
          />
          <TextInput
            style={[styles.input, styles.portInput]}
            placeholder="22"
            placeholderTextColor={GhostexPalette.MUTED}
            keyboardType="number-pad"
            value={port}
            onChangeText={editField(setPort)}
          />
        </View>
        <TextInput
          style={styles.input}
          placeholder="root"
          placeholderTextColor={GhostexPalette.MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={editField(setUsername)}
        />

        <Text style={styles.sectionHeader}>Authentication</Text>
        <SegmentedControl
          options={AUTH_METHOD_OPTIONS}
          value={method}
          onChange={editField(setMethod)}
        />

        {method === 'password' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder={
                existing === null
                  ? MachineCopy.editor.passwordHintNew
                  : MachineCopy.editor.passwordHintEdit
              }
              placeholderTextColor={GhostexPalette.MUTED}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={editField(setPassword)}
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: savePassword }}
              style={styles.checkboxRow}
              onPress={() => setSavePassword(!savePassword)}
            >
              <View style={[styles.checkbox, savePassword && styles.checkboxChecked]}>
                {savePassword ? <Text style={styles.checkboxMark}>{'✓'}</Text> : null}
              </View>
              <Text style={styles.checkboxLabel}>{MachineCopy.editor.savePasswordCheckbox}</Text>
            </Pressable>
            <Text style={styles.footerText}>{MachineCopy.editor.passwordBody}</Text>
          </>
        ) : (
          <>
            <TextInput
              style={[styles.input, styles.keyInput]}
              placeholder="Paste an OpenSSH private key"
              placeholderTextColor={GhostexPalette.MUTED}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              value={privateKey}
              onChangeText={editField(setPrivateKey)}
            />
            {method === 'keyPassphrase' ? (
              <TextInput
                style={styles.input}
                placeholder="Optional"
                placeholderTextColor={GhostexPalette.MUTED}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={keyPassphrase}
                onChangeText={editField(setKeyPassphrase)}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={styles.borderedButton}
              onPress={() => setGenerateOpen(!generateOpen)}
            >
              <Text style={styles.borderedButtonLabel}>Generate New Key</Text>
            </Pressable>

            {generateOpen ? (
              <View style={styles.generatePanel}>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Personal MacBook, Work Key"
                  placeholderTextColor={GhostexPalette.MUTED}
                  value={genName}
                  onChangeText={setGenName}
                />
                <SegmentedControl
                  options={ALGORITHM_OPTIONS}
                  value={genAlgorithm}
                  onChange={setGenAlgorithm}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Passphrase (optional)"
                  placeholderTextColor={GhostexPalette.MUTED}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={genPassphrase}
                  onChangeText={setGenPassphrase}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm passphrase"
                  placeholderTextColor={GhostexPalette.MUTED}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={genConfirm}
                  onChangeText={setGenConfirm}
                />
                <Text style={styles.footerText}>
                  Protect your key with a passphrase. Leave empty for no protection.
                </Text>
                {genError !== null ? <Text style={styles.errorText}>{genError}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  style={[styles.primaryButton, generating && styles.buttonDisabled]}
                  disabled={generating}
                  onPress={() => void runGenerate()}
                >
                  {generating ? (
                    <ActivityIndicator size="small" color={GhostexPalette.ACCENT_FOREGROUND} />
                  ) : (
                    <Text style={styles.primaryButtonLabel}>Generate</Text>
                  )}
                </Pressable>
              </View>
            ) : null}

            {publicKey !== null ? (
              <View style={styles.publicKeyBlock}>
                <Text style={styles.footerText}>
                  {"Add this to your server's ~/.ssh/authorized_keys file:"}
                </Text>
                <View style={styles.publicKeyCard}>
                  <Text selectable style={styles.publicKeyText}>
                    {publicKey}
                  </Text>
                </View>
                <Text style={styles.footerText}>
                  Copy to clipboard is not available in this build. Long-press the key above to
                  select and copy it.
                </Text>
              </View>
            ) : null}
          </>
        )}

        <Text style={styles.sectionHeader}>Connection</Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.borderedButton, testDisabled && styles.buttonDisabled]}
          disabled={testDisabled}
          onPress={() => void runTest()}
        >
          {testState.kind === 'testing' ? (
            <View style={styles.testingRow}>
              <ActivityIndicator size="small" color={GhostexPalette.ACCENT} />
              <Text style={styles.borderedButtonLabel}>Testing...</Text>
            </View>
          ) : (
            <Text style={styles.borderedButtonLabel}>Test Connection</Text>
          )}
        </Pressable>
        {testState.kind === 'success' ? (
          <Text style={styles.successText}>{'✓'} Connection successful</Text>
        ) : null}
        {testState.kind === 'failure' ? (
          <Text style={styles.errorText}>{testState.message}</Text>
        ) : null}

        {errors !== null ? (
          <View style={styles.errorBanner}>
            {errors.port !== undefined ? <Text style={styles.errorText}>{errors.port}</Text> : null}
            {errors.duplicate !== undefined ? (
              <Text style={styles.errorText}>{errors.duplicate}</Text>
            ) : null}
            {errors.password !== undefined ? (
              <Text style={styles.errorText}>{errors.password}</Text>
            ) : null}
            <Text style={styles.errorText}>{errors.general}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const headerStyles = StyleSheet.create({
  cancel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 16,
  },
  action: {
    color: GhostexPalette.ACCENT,
    fontSize: 16,
    fontWeight: '600',
  },
  actionDisabled: {
    color: GhostexPalette.MUTED,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  form: {
    padding: 16,
    gap: 10,
  },
  sectionHeader: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
  },
  input: {
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    color: GhostexPalette.FOREGROUND,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 15,
  },
  hostRow: {
    flexDirection: 'row',
    gap: 10,
  },
  hostInput: {
    flex: 1,
  },
  portInput: {
    width: 76,
    textAlign: 'center',
  },
  keyInput: {
    height: 112,
    paddingTop: 12,
    textAlignVertical: 'top',
    fontFamily: MONOSPACE,
    fontSize: 12,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: GhostexPalette.ACCENT,
    borderColor: GhostexPalette.ACCENT,
  },
  checkboxMark: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    flex: 1,
  },
  footerText: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  borderedButton: {
    height: 44,
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  borderedButtonLabel: {
    color: GhostexPalette.ACCENT,
    fontSize: 15,
    fontWeight: '600',
  },
  primaryButton: {
    height: 44,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  testingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  generatePanel: {
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.CARD,
    padding: 12,
    gap: 10,
  },
  publicKeyBlock: {
    gap: 8,
  },
  publicKeyCard: {
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    padding: 12,
  },
  publicKeyText: {
    color: GhostexPalette.FOREGROUND,
    fontFamily: MONOSPACE,
    fontSize: 12,
    lineHeight: 17,
  },
  successText: {
    color: SUCCESS_GREEN,
    fontSize: 13,
  },
  errorText: {
    color: GhostexPalette.DANGER,
    fontSize: 12,
    lineHeight: 17,
  },
  errorBanner: {
    marginTop: 8,
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.DANGER,
    backgroundColor: 'rgba(232,92,92,0.08)',
    padding: 12,
    gap: 6,
  },
});
