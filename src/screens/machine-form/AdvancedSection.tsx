/**
 * The Advanced collapsible of the machine form. Tailscale (mobile-04): SSH
 * port, SSH key (generate / copy public key), Tailscale SSH switch, host key
 * with Reset. Easy Connect (mobile-08): pairing address (copy), Ghostex port,
 * this phone's key (copy public key), SSH port. Test connection deliberately
 * lives outside this component so it is tappable whether or not it is open.
 */

import { useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import Collapsible from '../../components/common/Collapsible';
import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { TailscaleFormCopy } from '../../copy';
import type { MachineTransport } from '../../machines/store';
import { SetupPalette } from '../../theme/palette';
import { formStyles } from './styles';
import { FormField } from './TailscaleFields';

export type AdvancedSectionProps = {
  transport: MachineTransport;
  editing: boolean;
  sshPort: string;
  onSshPortChange: (value: string) => void;
  sshPortError?: string;
  /** Public half of the phone's key, or null when there is none. */
  publicKey: string | null;
  /** Passphrase of an encrypted key; shown only while a key exists. */
  keyPassphrase: string;
  onKeyPassphraseChange: (value: string) => void;
  onGenerateKey: () => void;
  generatingKey: boolean;
  tailscaleSsh: boolean;
  onTailscaleSshChange: (value: boolean) => void;
  /** Null while the machine has no pinned identity to reset (unsaved form). */
  onResetHostKey: (() => Promise<void>) | null;
  /** Easy Connect only. */
  pairingAddress: string | null;
  gxserverPort: string;
  onGxserverPortChange: (value: string) => void;
  /** Ports the Browser tab forwards for this machine; null omits the row. */
  webPreviewPorts: string | null;
};

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const copy = (text: string): void => {
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    });
  };
  return [copied, copy];
}

/** `tc1q8w3v…8e3f`: enough of the address to recognise it, never the whole secret. */
function abbreviateAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

function Row({
  label,
  detail,
  mono = false,
  first = false,
  trailing,
  children,
}: {
  label: string;
  detail?: string;
  mono?: boolean;
  first?: boolean;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={[formStyles.row, first ? formStyles.rowFirst : null]}>
      <View style={formStyles.rowMain}>
        <Text style={formStyles.rowLabel}>{label}</Text>
        {detail !== undefined ? (
          <Text style={[formStyles.rowDetail, mono ? formStyles.rowDetailMono : null]}>{detail}</Text>
        ) : null}
        {children}
      </View>
      {trailing}
    </View>
  );
}

export default function AdvancedSection(props: AdvancedSectionProps) {
  const copy = TailscaleFormCopy.advanced;
  const easyConnect = props.transport === 'tailcat';
  return (
    <Collapsible title={copy.title} hint={easyConnect ? copy.hintEasyConnect : copy.hintTailscale}>
      {easyConnect ? <EasyConnectRows {...props} /> : <TailscaleRows {...props} />}
    </Collapsible>
  );
}

function SshPortField({ sshPort, onSshPortChange, sshPortError }: AdvancedSectionProps) {
  return (
    <FormField
      label={TailscaleFormCopy.advanced.sshPort}
      value={sshPort}
      onChangeText={onSshPortChange}
      error={sshPortError}
      mono
      keyboardType="number-pad"
    />
  );
}

function SshKeyRow({
  publicKey,
  editing,
  onGenerateKey,
  generatingKey,
  first = false,
}: AdvancedSectionProps & { first?: boolean }) {
  const copy = TailscaleFormCopy.advanced;
  const [copied, copyText] = useCopied();
  const hasKey = publicKey !== null && publicKey.length > 0;
  return (
    <Row
      first={first}
      label={copy.sshKey}
      detail={hasKey ? copy.sshKeyPresent : editing ? copy.sshKeyNoneEdit : copy.sshKeyNone}
      trailing={
        hasKey ? (
          <SetupButton small label={copied ? copy.copied : copy.copyPublicKey} onPress={() => copyText(publicKey)} />
        ) : (
          <SetupButton small label={copy.generate} busy={generatingKey} onPress={onGenerateKey} />
        )
      }
    />
  );
}

function HostKeyRow({ onResetHostKey }: AdvancedSectionProps) {
  const copy = TailscaleFormCopy.advanced;
  const [resetDone, setResetDone] = useState(false);
  const [resetting, setResetting] = useState(false);
  const reset = (): void => {
    if (onResetHostKey === null || resetting) return;
    setResetting(true);
    void onResetHostKey().then(
      () => {
        setResetting(false);
        setResetDone(true);
      },
      () => setResetting(false),
    );
  };
  const detail =
    onResetHostKey === null ? copy.hostKeyNewDetail : resetDone ? copy.hostKeyResetDone : copy.hostKeyPinned;
  return (
    <Row
      label={copy.hostKey}
      detail={detail}
      trailing={
        onResetHostKey === null ? (
          <Text style={formStyles.rowValue}>{copy.hostKeyNew}</Text>
        ) : (
          <SetupButton small label={copy.hostKeyReset} busy={resetting} onPress={reset} />
        )
      }
    />
  );
}

function TailscaleRows(props: AdvancedSectionProps) {
  const copy = TailscaleFormCopy.advanced;
  const hasKey = props.publicKey !== null && props.publicKey.length > 0;
  return (
    <>
      <SshPortField {...props} />
      <View style={formStyles.rowsCard}>
        <SshKeyRow {...props} first />
        {hasKey ? (
          <Row label={copy.passphrase}>
            <FormField
              label=""
              value={props.keyPassphrase}
              onChangeText={props.onKeyPassphraseChange}
              placeholder={copy.passphrasePlaceholder}
              secureTextEntry
            />
          </Row>
        ) : null}
        <Row
          label={copy.tailscaleSsh}
          detail={copy.tailscaleSshDetail}
          trailing={
            <Switch
              value={props.tailscaleSsh}
              onValueChange={props.onTailscaleSshChange}
              trackColor={{ false: SetupPalette.MUTED_BG, true: SetupPalette.ACCENT }}
              thumbColor={SetupPalette.FOREGROUND}
            />
          }
        />
        <HostKeyRow {...props} />
      </View>
    </>
  );
}

function EasyConnectRows(props: AdvancedSectionProps) {
  const copy = TailscaleFormCopy.advanced;
  const [addressCopied, copyAddress] = useCopied();
  const [keyCopied, copyKey] = useCopied();
  const address = props.pairingAddress ?? '';
  const hasKey = props.publicKey !== null && props.publicKey.length > 0;
  return (
    <>
      <View style={formStyles.rowsCard}>
        <Row
          first
          label={copy.pairingAddress}
          detail={address.length > 0 ? abbreviateAddress(address) : undefined}
          mono
          trailing={
            address.length > 0 ? (
              <SetupButton
                small
                label={addressCopied ? copy.copied : copy.copyAddress}
                onPress={() => copyAddress(address)}
              />
            ) : undefined
          }
        />
        <Row label={copy.ghostexPort} detail={copy.ghostexPortDetail}>
          <FormField
            label=""
            value={props.gxserverPort}
            onChangeText={props.onGxserverPortChange}
            mono
            keyboardType="number-pad"
          />
        </Row>
        <Row
          label={copy.phoneKey}
          detail={hasKey ? copy.phoneKeyDetail : copy.phoneKeyNone}
          trailing={
            hasKey ? (
              <SetupButton
                small
                label={keyCopied ? copy.copied : copy.copyPublicKey}
                onPress={() => copyKey(props.publicKey ?? '')}
              />
            ) : undefined
          }
        />
        {props.webPreviewPorts !== null ? (
          <Row
            label={copy.webPreviewPorts}
            detail={copy.webPreviewPortsDetail}
            trailing={<Text style={formStyles.rowValue}>{props.webPreviewPorts}</Text>}
          />
        ) : null}
      </View>
    </>
  );
}
