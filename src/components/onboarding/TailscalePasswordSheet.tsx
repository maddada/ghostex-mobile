/**
 * "One more thing: your computer password" sheet (mobile-03-scan.html,
 * `.tailscale-password-sheet`): shown after a Tailscale code is recognized.
 * The code filled in name, address and user; the sheet asks for the one thing
 * the computer cannot hand over, then saves the machine with the password in
 * the secure keystore.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ScanCopy } from '../../copy';
import { tailscaleCodeAddress, type TailscaleCode } from '../../machines/pairingCodes';
import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import BottomSheet from '../common/BottomSheet';
import { LockGlyph, ShieldGlyph } from './SetupIcons';
import { SetupButton, SetupRow, SetupRows, setupText } from './SetupPrimitives';

export type TailscalePasswordSheetProps = {
  code: TailscaleCode | null;
  busy: boolean;
  /** Save failure from the machines store, shown under the field. */
  error: string | null;
  onClose: () => void;
  onSave: (password: string) => void;
};

export default function TailscalePasswordSheet({
  code,
  busy,
  error,
  onClose,
  onSave,
}: TailscalePasswordSheetProps) {
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  // A new code is a new computer: never carry a typed password across scans.
  useEffect(() => {
    setPassword('');
    setTouched(false);
  }, [code]);
  const emptyError = touched && password.length === 0 ? ScanCopy.tailscalePassword.emptyPassword : null;

  const submit = (): void => {
    setTouched(true);
    if (password.length === 0) return;
    onSave(password);
  };

  return (
    <BottomSheet visible={code !== null} onClose={busy ? () => undefined : onClose}>
      {code !== null ? (
        <>
          <View style={styles.eyebrow}>
            <ShieldGlyph size={14} color={SetupPalette.MUTED} />
            <Text style={setupText.eyebrow}>{ScanCopy.tailscalePassword.eyebrow}</Text>
          </View>
          <Text style={[setupText.title, styles.title]}>{ScanCopy.tailscalePassword.title}</Text>
          <Text style={[setupText.lede, styles.lede]}>{ScanCopy.tailscalePassword.lede}</Text>
          <SetupRows panel style={styles.summary}>
            <SetupRow first compact label={ScanCopy.tailscalePassword.summary.computer} value={code.name} />
            <SetupRow
              compact
              mono
              label={ScanCopy.tailscalePassword.summary.address}
              value={tailscaleCodeAddress(code)}
            />
            <SetupRow compact mono label={ScanCopy.tailscalePassword.summary.username} value={code.user} />
          </SetupRows>
          <View style={styles.field}>
            <Text style={styles.label}>{ScanCopy.tailscalePassword.passwordLabel(code.user)}</Text>
            <View style={styles.inputRow}>
              <LockGlyph size={14} color={SetupPalette.DIM} />
              <TextInput
                style={styles.input}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                editable={!busy}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={submit}
                returnKeyType="go"
              />
            </View>
            {emptyError !== null || error !== null ? (
              <Text style={styles.error}>{error ?? emptyError}</Text>
            ) : null}
          </View>
          <SetupButton
            variant="primary"
            label={ScanCopy.tailscalePassword.button}
            busy={busy}
            onPress={submit}
            style={styles.button}
          />
          <Text style={[setupText.small, setupText.dim, setupText.center, styles.keyHint]}>
            {ScanCopy.tailscalePassword.keyHint}
          </Text>
        </>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    marginTop: 8,
  },
  lede: {
    marginTop: 8,
  },
  summary: {
    marginTop: 12,
  },
  field: {
    marginTop: 12,
    gap: 6,
  },
  label: {
    color: SetupPalette.MUTED,
    fontSize: 13,
  },
  inputRow: {
    height: 42,
    paddingHorizontal: 12,
    borderRadius: GhostexRadii.control,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER_STRONG,
    backgroundColor: SetupPalette.PAGE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    color: SetupPalette.FOREGROUND,
    fontSize: 15,
    paddingVertical: 0,
  },
  error: {
    color: SetupPalette.ERROR,
    fontSize: 12,
    lineHeight: 17,
  },
  button: {
    marginTop: 12,
  },
  keyHint: {
    marginTop: 8,
  },
});
