/**
 * The Connection block of an Easy Connect machine on Edit machine
 * (`.connection-easy-connect` in mobile-08-edit-machine.html): nothing to type,
 * just "Paired as <user> · <date> · connected now", then "direct" or "via relay …" once the
 * app build can tell (`easyConnectPath.ts`), and a Re-pair button that opens the scanner with
 * `rePairMachineId`.
 */

import { useAppearance } from '../../theme/useAppearance';
import { StyleSheet, Text, View } from 'react-native';

import { SetupButton, StatusDot } from '../../components/onboarding/SetupPrimitives';
import { EditMachineCopy } from '../../copy';
import { easyConnectRouteName, useEasyConnectPath } from '../../machines/easyConnectPath';
import type { MachineRecord } from '../../machines/store';

import { formatShortDate } from './dates';
import { useFormStyles } from './styles';

export default function EasyConnectSummary({
  machine,
  connectedNow,
  onRePair,
}: {
  machine: MachineRecord;
  connectedNow: boolean;
  onRePair: () => void;
}) {
  const appearance = useAppearance();
  const formStyles = useFormStyles();
  const copy = EditMachineCopy.easyConnect;
  const parts = [copy.pairedAs(machine.username)];
  if (machine.pairedAt !== undefined) parts.push(formatShortDate(machine.pairedAt));
  parts.push(connectedNow ? copy.connectedNow : copy.notConnected);
  const path = useEasyConnectPath(machine.id, connectedNow);
  if (path !== null) parts.push(easyConnectRouteName(path));
  return (
    <View style={[formStyles.row, formStyles.rowFirst]}>
      <View style={formStyles.rowMain}>
        <View style={styles.labelRow}>
          <StatusDot color={connectedNow ? appearance.connected : appearance.muted} />
          <Text style={formStyles.rowLabel}>{copy.title}</Text>
        </View>
        <Text style={formStyles.rowDetail}>{parts.join(' · ')}</Text>
      </View>
      <SetupButton small label={copy.rePair} onPress={onRePair} />
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
