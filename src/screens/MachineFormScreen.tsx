/**
 * Machine form, three shapes on one screen (docs/2026-09-03/mobile-setup/
 * mobile-04-tailscale.html and mobile-08-edit-machine.html):
 *
 * - Add over Tailscale (`TailscaleForm`, the manual "type the details" path):
 *   two prechecks, a scan shortcut, name / address / username / password,
 *   Advanced (port, SSH key, Tailscale SSH, host key), Test connection below
 *   Advanced, and Connect = save + select + Connected.
 * - Add over Easy Connect with a bare pairing address (`MachineForm` with
 *   `tailcatToken`, the legacy "paste the address" path from the scanner).
 * - Edit (`machineId`): name, a Connection block per transport (Easy Connect
 *   summary + Re-pair, or the Tailscale fields), Show in Sessions, Advanced,
 *   Test connection, then Remove with a name confirm.
 *
 * Sections live in ./machine-form/; this file owns the state and the save.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative, type SshConfig } from '../../modules/ghostex-native/src';
import { markManualDisconnect } from '../app/autoReconnect';
import PromptDialog from '../components/common/PromptDialog';
import { SetupButton, setupText } from '../components/onboarding/SetupPrimitives';
import SshAccessHelpSheet, { type SshOs } from '../components/onboarding/SshAccessHelpSheet';
import { EditMachineCopy, MachineCopy, TailscaleFormCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import {
  getPassphrase,
  getPublicKey,
  getSshKey,
  getTailcatToken,
  resolvePassword,
  setPassphrase,
  setPublicKey,
  setSshKey,
} from '../machines/credentials';
import {
  TAILCAT_TOKEN_PREFIX,
  isMachineEnabled,
  tailcatSyntheticHost,
  useMachinesStore,
  type MachineInput,
  type MachineTransport,
  type MachineValidationErrors,
} from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useSpacesStore } from '../spaces/store';
import { useWebPreviewStore } from '../webPreview/store';
import { SetupPalette } from '../theme/palette';
import AdvancedSection from './machine-form/AdvancedSection';
import EasyConnectSummary from './machine-form/EasyConnectSummary';
import PrecheckList from './machine-form/PrecheckList';
import { formStyles } from './machine-form/styles';
import TailscaleFields, { NameField, PairingAddressField, FormField } from './machine-form/TailscaleFields';
import { TEST_MACHINE_ID, type ConnectionTestPlan } from './machine-form/testConnection';
import TestConnectionButton, { useTestState } from './machine-form/TestConnectionButton';

type Props = NativeStackScreenProps<RootStackParamList, 'MachineForm' | 'TailscaleForm'>;

/** "Connected now" on the Easy Connect summary: the machine answered within the last 3 minutes. */
const CONNECTED_NOW_WINDOW_MS = 3 * 60 * 1000;

function parsePort(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}

export default function MachineFormScreen({ navigation, route }: Props) {
  const machineId = route.params?.machineId ?? null;
  const scannedToken = route.params?.tailcatToken;
  const machines = useMachinesStore((state) => state.machines);
  const addMachine = useMachinesStore((state) => state.addMachine);
  const updateMachine = useMachinesStore((state) => state.updateMachine);
  const removeMachine = useMachinesStore((state) => state.removeMachine);
  const setMachineDisabled = useMachinesStore((state) => state.setMachineDisabled);
  const selectMachine = useMachinesStore((state) => state.selectMachine);
  const inventory = useInventoryStore((state) =>
    machineId === null ? undefined : state.inventoriesByMachineId[machineId],
  );
  const clearMachineInventory = useInventoryStore((state) => state.clearMachine);
  const clearMachineSpace = useSpacesStore((state) => state.clearMachine);
  const webPreviewPort = useWebPreviewStore((state) =>
    machineId === null ? undefined : state.lastPortByMachine[machineId],
  );
  const existing = machineId === null ? null : (machines.find((m) => m.id === machineId) ?? null);
  const editing = existing !== null;

  const [transport, setTransport] = useState<MachineTransport>(
    existing?.transport ?? (scannedToken !== undefined ? 'tailcat' : 'ssh'),
  );
  const easyConnect = transport === 'tailcat';
  const [name, setName] = useState(existing?.name ?? '');
  // A tailcat machine's stored host is a synthetic identity, never a real one.
  const [address, setAddress] = useState(existing?.transport === 'tailcat' ? '' : (existing?.host ?? ''));
  const [username, setUsername] = useState(existing?.username ?? '');
  const [password, setPassword] = useState('');
  const [sshPort, setSshPort] = useState(existing === null ? '22' : String(existing.port));
  const [tailcatToken, setTailcatToken] = useState(scannedToken ?? '');
  const [gxserverPort, setGxserverPort] = useState(
    existing?.gxserverPort === undefined ? '' : String(existing.gxserverPort),
  );
  const [tailscaleSsh, setTailscaleSsh] = useState(existing?.tailscaleSsh ?? false);
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKeyText] = useState<string | null>(null);
  const [keyPassphrase, setKeyPassphrase] = useState('');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [testState, setTestState, resetTest] = useTestState();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<MachineValidationErrors | null>(null);
  const [helpOs, setHelpOs] = useState<SshOs | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  /**
   * Set once the machine is gone. Navigation waits for the next commit because
   * App.tsx swaps the navigator's route set when the last machine is removed
   * (Welcome replaces Sessions/Machines), so a route named during the same
   * tick as the store update may not exist yet.
   */
  const [removed, setRemoved] = useState<'no' | 'someRemain' | 'noneRemain'>('no');

  // The Scan code screen hands a bare pairing address back through this
  // route's params (merge navigate), so a later scan updates the open form.
  useEffect(() => {
    if (scannedToken === undefined || scannedToken.length === 0) return;
    setTransport('tailcat');
    setTailcatToken(scannedToken);
    resetTest();
    // resetTest is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedToken]);

  // Edit mode: load the stored key and pairing address.
  useEffect(() => {
    if (machineId === null) return;
    let cancelled = false;
    void (async () => {
      const [key, storedPublicKey, storedToken, storedPassphrase] = await Promise.all([
        getSshKey(machineId),
        getPublicKey(machineId),
        getTailcatToken(machineId),
        getPassphrase(machineId),
      ]);
      if (cancelled) return;
      if (storedToken !== null && storedToken.length > 0) setTailcatToken(storedToken);
      if (key !== null && key.length > 0) setPrivateKey(key);
      if (storedPassphrase !== null && storedPassphrase.length > 0) setKeyPassphrase(storedPassphrase);
      if (storedPublicKey !== null && storedPublicKey.length > 0) setPublicKeyText(storedPublicKey);
    })();
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  const editField =
    <T,>(setter: (value: T) => void) =>
    (value: T): void => {
      setter(value);
      resetTest();
    };

  const parsedPort = parsePort(sshPort);
  const trimmedToken = tailcatToken.trim();
  const targetValid = easyConnect
    ? trimmedToken.length > 0 && trimmedToken.startsWith(TAILCAT_TOKEN_PREFIX)
    : address.trim().length > 0;
  const canSave = targetValid && username.trim().length > 0 && parsedPort !== null;
  const computerName = name.trim().length > 0 ? name.trim() : username.trim();

  const buildPlan = async (): Promise<ConnectionTestPlan> => {
    // Editing a saved tailcat machine tests against its real pinned identity;
    // an unsaved one gets a throwaway identity so a first-connect host key is
    // never pinned under an id that will not exist after save.
    const reusesPinnedIdentity = existing !== null && existing.transport === 'tailcat';
    const pinnedId = reusesPinnedIdentity ? existing.id : TEST_MACHINE_ID;
    const config: SshConfig = {
      host: easyConnect ? tailcatSyntheticHost(pinnedId) : address.trim(),
      port: parsedPort ?? 22,
      username: username.trim(),
    };
    if (easyConnect) config.tailcatToken = trimmedToken;
    if (tailscaleSsh) {
      config.authMethod = 'none';
    } else {
      if (privateKey.length > 0) {
        config.privateKey = privateKey;
        if (keyPassphrase.length > 0) config.passphrase = keyPassphrase;
      }
      // A blank field while editing keeps the stored password, so test with it.
      const effective =
        password.length > 0 ? password : existing !== null ? await resolvePassword(existing.id) : null;
      if (effective !== null && effective.length > 0) config.password = effective;
    }
    return {
      config,
      hasPassword: config.password !== undefined,
      throwawayPinnedHost: easyConnect && !reusesPinnedIdentity ? tailcatSyntheticHost(TEST_MACHINE_ID) : null,
      tailcat: easyConnect,
    };
  };

  const generateKey = async (): Promise<void> => {
    if (generatingKey) return;
    setGeneratingKey(true);
    try {
      const generated = await GhostexNative.generateSshKey('ed25519', 'ghostex-phone');
      setPrivateKey(generated.privateKey);
      setPublicKeyText(generated.publicKey);
      resetTest();
    } finally {
      setGeneratingKey(false);
    }
  };

  // Only a saved machine has a pinned identity to reset; an Easy Connect
  // machine's identity is its synthetic host, a Tailscale one is the address.
  const resetHostKey =
    existing === null
      ? null
      : easyConnect
        ? () => GhostexNative.resetHostKey(existing.host, existing.port)
        : () => GhostexNative.resetHostKey(address.trim(), parsedPort ?? existing.port);

  const save = async (): Promise<void> => {
    if (!canSave || saving) return;
    setSaving(true);
    setErrors(null);
    // A saved password is never wiped by turning on Tailscale SSH or adding a
    // key: the flag decides what is sent, the record keeps what the user typed.
    const input: MachineInput = {
      name: name.trim(),
      host: address.trim(),
      username: username.trim(),
      port: sshPort,
      savePassword: password.length > 0 || (existing?.savePassword ?? false),
      password,
      transport,
      tailcatToken: easyConnect ? trimmedToken : '',
      tailscaleSsh,
    };
    const parsedGxserverPort = parsePort(gxserverPort);
    if (easyConnect && parsedGxserverPort !== null) input.gxserverPort = parsedGxserverPort;
    const result = existing === null ? await addMachine(input) : await updateMachine(existing.id, input);
    if (!result.ok) {
      setErrors(result.errors);
      setSaving(false);
      return;
    }
    const id = result.machine.id;
    // The passphrase state was seeded from the store, so an untouched one is written back unchanged.
    await Promise.all([
      setSshKey(id, privateKey),
      setPassphrase(id, privateKey.length > 0 ? keyPassphrase : ''),
      setPublicKey(id, publicKey ?? ''),
    ]);
    if (existing === null) {
      selectMachine(id);
      navigation.navigate('Connected', { machineId: id });
      return;
    }
    navigation.goBack();
  };

  const remove = async (typedName: string): Promise<void> => {
    if (existing === null) return;
    const expected = existing.name.length > 0 ? existing.name : existing.username;
    if (typedName.trim() !== expected) {
      setRemoveError(EditMachineCopy.remove.mismatch);
      return;
    }
    setRemoveOpen(false);
    clearMachineInventory(existing.id);
    clearMachineSpace(existing.id);
    try {
      markManualDisconnect(existing.id);
      await GhostexNative.disconnect(existing.id);
    } catch {
      // Not connected is fine.
    }
    await removeMachine(existing.id);
    setRemoved(useMachinesStore.getState().machines.length === 0 ? 'noneRemain' : 'someRemain');
  };

  useEffect(() => {
    if (removed === 'no') return;
    if (removed === 'noneRemain') {
      // The same reset pattern ConnectedScreen uses for "Open sessions".
      navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
      return;
    }
    // Back to wherever the edit was opened from: the Machines list or Sessions.
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'Sessions' }] });
  }, [navigation, removed]);

  useLayoutEffect(() => {
    if (removed !== 'no') return;
    if (!editing) {
      navigation.setOptions({ title: easyConnect ? MachineCopy.editor.addTitle : TailscaleFormCopy.navTitle });
      return;
    }
    navigation.setOptions({
      title: existing.name.length > 0 ? existing.name : MachineCopy.editor.editTitle,
      headerRight: () => (
        <Pressable accessibilityRole="button" disabled={!canSave || saving} onPress={() => void save()}>
          <Text style={[setupText.accent, styles.headerAction, !canSave || saving ? setupText.dim : null]}>
            {EditMachineCopy.save}
          </Text>
        </Pressable>
      ),
    });
  });

  const connectedNow =
    existing !== null &&
    inventory?.lastError === null &&
    inventory.summary !== null &&
    existing.lastConnectedAt !== null &&
    Date.now() - new Date(existing.lastConnectedAt).getTime() < CONNECTED_NOW_WINDOW_MS;

  const advanced = (
    <AdvancedSection
      transport={transport}
      editing={editing}
      sshPort={sshPort}
      onSshPortChange={editField(setSshPort)}
      sshPortError={errors?.port}
      publicKey={publicKey}
      keyPassphrase={keyPassphrase}
      onKeyPassphraseChange={editField(setKeyPassphrase)}
      onGenerateKey={() => void generateKey()}
      generatingKey={generatingKey}
      tailscaleSsh={tailscaleSsh}
      onTailscaleSshChange={editField(setTailscaleSsh)}
      onResetHostKey={resetHostKey}
      pairingAddress={easyConnect ? trimmedToken : null}
      gxserverPort={gxserverPort}
      onGxserverPortChange={setGxserverPort}
      webPreviewPorts={webPreviewPort === undefined ? null : String(webPreviewPort)}
    />
  );

  const test = (
    <TestConnectionButton
      disabled={!canSave || saving}
      buildPlan={buildPlan}
      computerName={computerName}
      username={username.trim()}
      state={testState}
      onStateChange={setTestState}
    />
  );

  const showInSessionsRow =
    existing === null ? null : (
      <View style={[formStyles.row, easyConnect ? null : formStyles.rowFirst]}>
        <View style={formStyles.rowMain}>
          <Text style={formStyles.rowLabel}>{EditMachineCopy.showInSessions}</Text>
          <Text style={formStyles.rowDetail}>{EditMachineCopy.showInSessionsDetail}</Text>
        </View>
        <Switch
          value={isMachineEnabled(existing)}
          onValueChange={(shown) => setMachineDisabled(existing.id, !shown)}
          trackColor={{ false: SetupPalette.MUTED_BG, true: SetupPalette.ACCENT }}
          thumbColor={SetupPalette.FOREGROUND}
        />
      </View>
    );

  const tailscaleFields = (
    <TailscaleFields
      address={address}
      onAddressChange={editField(setAddress)}
      addressError={errors?.host ?? errors?.duplicate}
      username={username}
      onUsernameChange={editField(setUsername)}
      usernameError={errors?.username}
      password={password}
      onPasswordChange={editField(setPassword)}
      passwordError={errors?.password}
      editing={editing}
      passwordDisabled={tailscaleSsh}
      focusPassword={route.params?.focus === 'password'}
    />
  );

  const errorBanner =
    errors === null ? null : (
      <View style={formStyles.errorCallout}>
        <Text style={formStyles.errorCalloutText}>
          {[errors.tailcatToken, errors.port, errors.duplicate, errors.password].find(
            (message) => message !== undefined,
          ) ?? errors.general}
        </Text>
      </View>
    );

  if (removed !== 'no') {
    // The record is gone; never re-render its values as an add form while leaving.
    return <SafeAreaView style={formStyles.page} edges={['bottom']} />;
  }

  return (
    <SafeAreaView style={formStyles.page} edges={['bottom']}>
      <ScrollView contentContainerStyle={formStyles.scroll} keyboardShouldPersistTaps="handled">
        {existing !== null ? (
          <>
            {inventory?.lastError !== undefined && inventory.lastError !== null ? (
              <View style={formStyles.errorCallout}>
                <Text style={formStyles.errorCalloutText}>
                  {EditMachineCopy.errorPrefix(existing.name.length > 0 ? existing.name : existing.username)}
                  {inventory.lastError}{' '}
                  <Text
                    style={formStyles.link}
                    onPress={() => navigation.navigate('CantReach', { machineId: existing.id })}
                  >
                    {EditMachineCopy.whatCanICheck}
                  </Text>
                </Text>
              </View>
            ) : null}
            <NameField value={name} onChangeText={setName} hint={false} />
            <Text style={formStyles.sectionLabel}>
              {easyConnect ? EditMachineCopy.connectionLabel : EditMachineCopy.connectionTailscaleLabel}
            </Text>
            {easyConnect ? (
              <View style={formStyles.rowsCard}>
                <EasyConnectSummary
                  machine={existing}
                  connectedNow={connectedNow}
                  onRePair={() => navigation.navigate('ScanCode', { rePairMachineId: existing.id })}
                />
                {showInSessionsRow}
              </View>
            ) : (
              <>
                {tailscaleFields}
                <View style={formStyles.rowsCard}>{showInSessionsRow}</View>
              </>
            )}
            {advanced}
            {test}
            {errorBanner}
            <View style={formStyles.divider} />
            <Pressable
              accessibilityRole="button"
              style={styles.removeButton}
              onPress={() => {
                setRemoveError(null);
                setRemoveOpen(true);
              }}
            >
              <Text style={[styles.removeLabel, formStyles.danger]}>{EditMachineCopy.remove.button}</Text>
            </Pressable>
          </>
        ) : easyConnect ? (
          <>
            <NameField value={name} onChangeText={setName} />
            <FormField
              label={TailscaleFormCopy.fields.username}
              value={username}
              onChangeText={editField(setUsername)}
              placeholder={TailscaleFormCopy.fields.usernamePlaceholder}
              error={errors?.username}
              mono
            />
            <PairingAddressField
              value={tailcatToken}
              onChangeText={editField(setTailcatToken)}
              error={errors?.tailcatToken}
            />
            {advanced}
            {test}
            {errorBanner}
          </>
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={setupText.eyebrow}>{TailscaleFormCopy.eyebrow}</Text>
              <Text style={setupText.titleLg}>{TailscaleFormCopy.title}</Text>
              <Text style={setupText.lede}>{TailscaleFormCopy.lede}</Text>
            </View>
            <Text style={formStyles.sectionLabel}>{TailscaleFormCopy.prechecksLabel}</Text>
            <PrecheckList onSelectOs={setHelpOs} currentOs={helpOs} />
            <Text style={formStyles.sectionLabel}>{TailscaleFormCopy.computerLabel}</Text>
            <SetupButton label={TailscaleFormCopy.scanInstead} onPress={() => navigation.navigate('ScanCode')} />
            <NameField value={name} onChangeText={setName} />
            {tailscaleFields}
            {advanced}
            {test}
            {errorBanner}
          </>
        )}
      </ScrollView>

      {existing === null ? (
        <View style={formStyles.footer}>
          <SetupButton
            variant="primary"
            large
            label={TailscaleFormCopy.connect}
            disabled={!canSave}
            busy={saving}
            onPress={() => void save()}
          />
        </View>
      ) : null}

      <SshAccessHelpSheet os={helpOs} onClose={() => setHelpOs(null)} />

      {existing !== null ? (
        <PromptDialog
          visible={removeOpen}
          title={EditMachineCopy.remove.title}
          body={EditMachineCopy.remove.body(existing.name.length > 0 ? existing.name : existing.username)}
          placeholder={EditMachineCopy.remove.placeholder}
          error={removeError}
          confirmLabel={EditMachineCopy.remove.confirm}
          onSubmit={(value) => void remove(value)}
          onCancel={() => setRemoveOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = {
  headerAction: { fontSize: 16, fontWeight: '600' as const },
  hero: { gap: 6 },
  removeButton: { paddingVertical: 12, alignItems: 'center' as const },
  removeLabel: { fontSize: 14, fontWeight: '600' as const },
};
