/**
 * Settings › Connection: every computer with its live route and status, Auto-reconnect, the memory guard
 * (MemoryGuardRows.tsx), and Logs.
 *
 * CDXC:RemoteMachines 2026-11-12 DECISION:
 * User (Q2732 note): the route is not shown on the Sessions screen while things work; "when it's connected he can see
 * details in settings -> connection". Logs live here and in the ☰ menu (Q2737). The Tailscale reminder toggle went
 * with the amber notice it controlled (Q2740: a computer that can't connect shows its icon red instead).
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import LogsSheet from '../../components/common/LogsSheet';
import { linkStatusColor, LinkIcon } from '../../components/sessions/ConnectionsSheet';
import { useConnectionEntries } from '../../components/sessions/useConnectionEntries';
import { ConnectionsCopy } from '../../copy';
import { tailscaleOnPhone } from '../../machines/easyConnectRoute';
import { isMachineEnabled, useMachinesStore } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import { useAppearance } from '../../theme/useAppearance';
import { MemoryGuardRows } from './MemoryGuardRows';
import { SettingsSearchAnchor } from './search/SettingsSearchAnchor';
import { Caption, LinkRow, SectionHeader, SettingsScreenLayout, SettingToggle, useSettingsStyles } from './SettingsControls';

export default function ConnectionPage() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const appearance = useAppearance();
  const styles = useSettingsStyles();
  const saved = useMachinesStore((state) => state.machines);
  const machines = useMemo(() => saved.filter(isMachineEnabled), [saved]);
  const [tailscale, setTailscale] = useState<boolean | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  useEffect(() => {
    void tailscaleOnPhone().then(setTailscale);
  }, []);
  const entries = useConnectionEntries(machines, tailscale);

  return (
    <SettingsScreenLayout>
      <SectionHeader title={ConnectionsCopy.computers} />
      {entries.length === 0 ? <Caption>{ConnectionsCopy.noComputers}</Caption> : null}
      {entries.map((entry) => {
        const color = linkStatusColor(entry.status, appearance);
        const detail =
          entry.status === 'failed' && entry.tailscaleOff
            ? `${ConnectionsCopy.status.failed} · ${ConnectionsCopy.tailscaleOff}`
            : entry.status === 'connected'
              ? entry.route
              : `${ConnectionsCopy.status[entry.status]} · ${entry.route}`;
        return (
          <SettingsSearchAnchor key={entry.machine.id} label={entry.name}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${entry.name}, ${ConnectionsCopy.status[entry.status]}, ${entry.route}`}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => navigation.navigate('MachineForm', { machineId: entry.machine.id })}
            >
              <View style={{ marginRight: 10 }}>
                <LinkIcon entry={entry} size={18} color={color} />
              </View>
              <View style={styles.linkText}>
                <Text numberOfLines={1} style={styles.linkTitle}>
                  {entry.name}
                </Text>
                <Text numberOfLines={2} style={styles.linkDescription}>
                  {detail}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </SettingsSearchAnchor>
        );
      })}
      <SectionHeader title="Options" />
      <SettingToggle settingKey="autoReconnect" label="Auto-reconnect on disconnect" />
      <Caption>Reconnects when the connection to your computer drops, and reopens interrupted agent terminals.</Caption>
      <MemoryGuardRows />
      <SectionHeader title={ConnectionsCopy.troubleshooting} />
      <LinkRow
        title={ConnectionsCopy.logs}
        description="Recent connection and status events on this phone. Copy them, or send them to the developer."
        onPress={() => setLogsOpen(true)}
      />
      {logsOpen ? <LogsSheet visible onClose={() => setLogsOpen(false)} /> : null}
    </SettingsScreenLayout>
  );
}
