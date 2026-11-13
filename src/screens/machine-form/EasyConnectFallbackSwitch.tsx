/**
 * Fall back to Easy Connect, for one Tailscale or SSH computer: the saved answer (off until the person chooses,
 * with "Not chosen yet" under it), what it means now, and Ask again when the computer hasn't added this phone yet.
 * On the computer's page and on its card in the Connections sheet (CDXC:RemotePairing 2026-11-13 in
 * src/machines/easyConnectRoute.ts). Draws nothing for a computer that can't fall back.
 */

import { useEffect } from 'react';
import { Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { SwitchRow } from '../../components/common/SwitchRow';
import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { EasyConnectFallbackCopy } from '../../copy';
import { canFallBack, changeFallback } from '../../machines/easyConnectFallbackAsk';
import {
  easyConnectOnFor,
  fallbackChoice,
  useEasyConnectFallback,
  useEasyConnectOn,
} from '../../machines/easyConnectRoute';
import { addEasyConnect, useSshPairings } from '../../machines/sshPairing';
import type { MachineRecord } from '../../machines/store';
import { useAppearance } from '../../theme/useAppearance';
import { useFormStyles } from './styles';

export function EasyConnectFallbackSwitch({
  machine,
  name,
  containerStyle,
  style,
}: {
  machine: MachineRecord;
  /** The computer's name as the screen shows it. */
  name: string;
  /** Around the row (a card), drawn only when the row is. */
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const appearance = useAppearance();
  const formStyles = useFormStyles();
  const choice = useEasyConnectFallback((state) => state.choices[machine.id]);
  const offered = useSshPairings((state) => state.easyConnectOffered[machine.id] === true);
  const pairing = useSshPairings((state) => state.pairings[machine.id]);
  const easyConnectOn = easyConnectOnFor(
    useEasyConnectOn((state) => state.on[machine.id]),
    machine.easyConnectPairedAt,
  );
  useEffect(() => {
    void fallbackChoice(machine.id);
  }, [machine.id]);

  if (!canFallBack(machine, offered)) return null;
  const hasRoute = machine.easyConnectPairedAt !== undefined;
  const asking = pairing?.easyConnect === true && (pairing.phase === 'asking' || pairing.phase === 'pending');
  const on = choice === 'yes';
  const detail =
    choice === undefined
      ? EasyConnectFallbackCopy.undecided
      : !on
        ? EasyConnectFallbackCopy.off
        : easyConnectOn === false
          ? EasyConnectFallbackCopy.computerOff(name)
          : hasRoute
            ? EasyConnectFallbackCopy.on
            : asking
              ? EasyConnectFallbackCopy.waiting(name)
              : EasyConnectFallbackCopy.notAdded(name);
  const askAgain = on && !hasRoute && !asking && easyConnectOn !== false;

  return (
    <View style={containerStyle}>
      <SwitchRow
        value={on}
        onValueChange={(value) => changeFallback(machine, value)}
        label={EasyConnectFallbackCopy.label}
        style={style}
      >
        <View style={formStyles.rowMain}>
          <Text style={formStyles.rowLabel}>{EasyConnectFallbackCopy.label}</Text>
          <Text style={formStyles.rowDetail}>{detail}</Text>
          {askAgain ? (
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              <SetupButton
                small
                label={EasyConnectFallbackCopy.askAgain}
                onPress={() => void addEasyConnect(machine)}
              />
            </View>
          ) : null}
        </View>
        <Switch
          value={on}
          onValueChange={(value) => changeFallback(machine, value)}
          trackColor={{ false: appearance.cardActive, true: appearance.accent }}
          thumbColor={appearance.foreground}
        />
      </SwitchRow>
    </View>
  );
}
