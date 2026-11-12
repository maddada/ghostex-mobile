/**
 * A computer's page (Machines > a computer, Sessions' Remote Settings): whether it is connected and how, its
 * Approvals, the devices that can reach it, then four rows (name and Sessions tab, Ghostex updates, agents and
 * tools, Advanced) that each open a short page, and Remove at the bottom. Nothing on it is saved with a button.
 * CDXC:RemotePairing 2026-11-10 in copy.ts (`ComputerPageCopy`) has the user's pick.
 */

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import ConfirmDialog from '../../components/common/ConfirmDialog';
import { SwitchRow } from '../../components/common/SwitchRow';
import { useScrollToBarEdges } from '../../components/common/verticalBar/VerticalBarArea';
import { ChevronRightGlyph } from '../../components/onboarding/SetupIcons';
import { SetupButton, StatusDot } from '../../components/onboarding/SetupPrimitives';
import { ApprovalsCopy, ComputerPageCopy, EditMachineCopy, SshPairingCopy } from '../../copy';
import DemoMachineForm from '../../demo/DemoMachineForm';
import { isDemoMachine } from '../../demo/identity';
import { useInventoryStore } from '../../inventory/store';
import { APP_UPDATE_FRESH_MS, appUpdateCardLine, appUpdateView, refreshAppUpdate, useAppUpdateStore } from '../../machines/appUpdate';
import { easyConnectRouteName, useEasyConnectPath } from '../../machines/easyConnectPath';
import { useMachineRoutes } from '../../machines/easyConnectRoute';
import { refreshMachineTools, useMachineToolsStore } from '../../machines/machineTools';
import { agentCliRow, toolRow } from '../../machines/machineToolsView';
import { removeComputerFromPhone } from '../../machines/removeComputer';
import { signsInOverSsh, startSshPairing, useSshPairings } from '../../machines/sshPairing';
import { isMachineEnabled, useMachinesStore, type MachineRecord } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import { useRemovalAsksComputer } from '../../notifications/pushStore';
import { approvalMode, listApprovals, setRequirePresence, usePlainApprovals } from '../../security/approvals';
import { useAppearance } from '../../theme/useAppearance';
import { machineCardStatus, machineCardTitle } from '../machines-screen/machineCardModel';
import PairedDevicesSection from './PairedDevicesSection';
import { FormSection } from './SectionBoundary';
import { useFormStyles } from './styles';

/** "Connected now": the computer answered within the last 3 minutes. */
const CONNECTED_NOW_WINDOW_MS = 3 * 60 * 1000;

export type MachineFormSection = 'name' | 'updates' | 'tools' | 'advanced';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'MachineForm'>;

export default function ComputerPage({ navigation, machineId }: { navigation: Navigation; machineId: string }) {
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);
  /**
   * Set once the computer is gone. Navigation waits for the next commit because App.tsx swaps the navigator's
   * route set when the last computer is removed (Welcome replaces Sessions and Machines).
   */
  const [removed, setRemoved] = useState<'no' | 'someRemain' | 'noneRemain'>('no');
  useEffect(() => {
    if (removed === 'no') return;
    if (removed === 'noneRemain') {
      navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'Sessions' }] });
  }, [navigation, removed]);
  const noteRemoved = () => setRemoved(useMachinesStore.getState().machines.length === 0 ? 'noneRemain' : 'someRemain');

  if (removed !== 'no' || machine === null) return <SafeAreaView style={{ flex: 1 }} edges={['bottom']} />;
  if (isDemoMachine(machine)) return <DemoMachineForm onRemoved={noteRemoved} />;
  return <ComputerPageBody navigation={navigation} machine={machine} onRemoved={noteRemoved} />;
}

function ComputerPageBody({
  navigation,
  machine,
  onRemoved,
}: {
  navigation: Navigation;
  machine: MachineRecord;
  onRemoved: () => void;
}) {
  const appearance = useAppearance();
  const formStyles = useFormStyles();
  const edges = useScrollToBarEdges(formStyles.scroll);
  const copy = ComputerPageCopy;
  const inventory = useInventoryStore((state) => state.inventoriesByMachineId[machine.id]);
  const status = machineCardStatus(machine, inventory);
  const easyConnect = machine.transport === 'tailcat';
  const reachable = isMachineEnabled(machine) && inventory?.lastError === null && inventory.summary !== null;
  const connectedNow =
    reachable &&
    machine.lastConnectedAt !== null &&
    Date.now() - new Date(machine.lastConnectedAt).getTime() < CONNECTED_NOW_WINDOW_MS;
  // A Tailscale computer that also has Easy Connect, and the route it is on now (`easyConnectRoute.ts`).
  const twoRoutes = !easyConnect && machine.easyConnectPairedAt !== undefined;
  const liveRoute = useMachineRoutes((state) => state.active[machine.id]);
  const viaEasyConnect = easyConnect || (twoRoutes && liveRoute === 'easyConnect');
  const easyConnectOffered = useSshPairings((state) => state.easyConnectOffered[machine.id] === true);
  const path = useEasyConnectPath(machine.id, connectedNow && viaEasyConnect);
  const update = useAppUpdateStore((state) => state.byMachineId[machine.id]);
  const tools = useMachineToolsStore((state) => state.byMachineId[machine.id]);
  const sshPairing = useSshPairings((state) => state.pairings[machine.id]);
  const plainApprovals = usePlainApprovals((state) => state.plain[machine.id] === true);
  const removalAsksComputer = useRemovalAsksComputer();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [requirePresence, setRequirePresenceShown] = useState<boolean | null>(null);
  const [requirePresenceError, setRequirePresenceError] = useState<string | null>(null);
  const name = machineCardTitle(machine);

  useLayoutEffect(() => {
    navigation.setOptions({ title: name });
  }, [navigation, name]);

  // Its Ghostex version, agent CLIs and tools, for the rows below; and what waits for approval.
  useEffect(() => {
    if (!reachable) return;
    refreshAppUpdate(machine, { ifOlderThanMs: APP_UPDATE_FRESH_MS });
    void refreshMachineTools(machine, { ifOlderThanMs: APP_UPDATE_FRESH_MS });
    let live = true;
    listApprovals(machine)
      .then((requests) => {
        if (live) setWaiting(requests.length);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // The record's identity does not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachable, machine.id]);

  // The computer's "Require Face ID to approve" switch, read when the page opens (null until read).
  useEffect(() => {
    if (!plainApprovals) return;
    let live = true;
    approvalMode(machine)
      .then((mode) => {
        if (live) setRequirePresenceShown(mode.requirePresence);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plainApprovals, machine.id]);
  const changeRequirePresence = (on: boolean) => {
    setRequirePresenceShown(on);
    setRequirePresenceError(null);
    setRequirePresence(machine, on).catch((error: unknown) => {
      setRequirePresenceShown(!on);
      setRequirePresenceError(
        `${ApprovalsCopy.requirePresenceFailed}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  const how = viaEasyConnect
    ? path === null
      ? copy.easyConnect
      : copy.easyConnectRoute(easyConnectRouteName(path))
    : copy.tailscale(machine.host);
  const dotColor =
    status === 'connected' ? appearance.connected : status === 'failed' ? appearance.danger : appearance.muted;

  const updateLine = (() => {
    if (update === undefined) return reachable ? copy.rows.updatesReading : copy.rows.updatesUnknown;
    const view = appUpdateView(update);
    const line = appUpdateCardLine(view) ?? copy.rows.updatesReading;
    return view.autoUpdate === true ? `${line} · ${copy.rows.updatesByItself}` : line;
  })();
  const toolUpdates =
    tools === undefined
      ? 0
      : [...(tools.agents.data ?? []).map(agentCliRow), ...(tools.tools.data ?? []).map(toolRow)].filter(
          (row) => row.action?.operation === 'update',
        ).length;
  const showsApprovals = easyConnect || machine.deviceId !== undefined || plainApprovals;

  const moreRows: { key: string; label: string; detail: string; onPress: () => void }[] = [
    {
      key: 'name',
      label: easyConnect ? copy.rows.name.easyConnect : copy.rows.name.tailscale,
      detail: `${name} · ${isMachineEnabled(machine) ? copy.rows.shown : copy.rows.hidden}`,
      onPress: () => navigation.navigate('MachineForm', { machineId: machine.id, section: 'name' }),
    },
    {
      key: 'updates',
      label: copy.rows.updates,
      detail: updateLine,
      onPress: () => navigation.navigate('MachineForm', { machineId: machine.id, section: 'updates' }),
    },
    {
      key: 'tools',
      label: copy.rows.tools,
      detail: toolUpdates > 0 ? copy.rows.toolsUpdates(toolUpdates) : copy.rows.toolsNone,
      onPress: () => navigation.navigate('MachineForm', { machineId: machine.id, section: 'tools' }),
    },
    {
      key: 'advanced',
      label: copy.rows.advanced,
      detail: easyConnect ? copy.rows.advancedEasyConnect : copy.rows.advancedTailscale,
      onPress: () => navigation.navigate('MachineForm', { machineId: machine.id, section: 'advanced' }),
    },
  ];

  return (
    <SafeAreaView style={formStyles.page} edges={['bottom']}>
      <ScrollView style={edges.scroll} contentContainerStyle={[formStyles.scroll, edges.content]}>
        {inventory?.lastError !== undefined && inventory.lastError !== null ? (
          <View style={formStyles.errorCallout}>
            <Text style={formStyles.errorCalloutText}>
              {EditMachineCopy.errorPrefix(name)}
              {inventory.lastError}{' '}
              <Text style={formStyles.link} onPress={() => navigation.navigate('CantReach', { machineId: machine.id })}>
                {EditMachineCopy.whatCanICheck}
              </Text>
            </Text>
          </View>
        ) : null}

        <View style={formStyles.rowsCard}>
          <View style={[formStyles.row, formStyles.rowFirst]}>
            <View style={formStyles.rowMain}>
              <View style={styles.statusLine}>
                <StatusDot color={dotColor} />
                <Text style={formStyles.rowLabel}>{copy.status[status]}</Text>
              </View>
              <Text style={formStyles.rowDetail}>{how}</Text>
            </View>
          </View>
        </View>

        {twoRoutes ? (
          <>
            <Text style={formStyles.sectionLabel}>{copy.routes.label}</Text>
            <View style={formStyles.rowsCard}>
              <View style={[formStyles.row, formStyles.rowFirst]}>
                <View style={formStyles.rowMain}>
                  <View style={styles.statusLine}>
                    <StatusDot color={connectedNow && liveRoute === 'tailscale' ? appearance.connected : appearance.muted} />
                    <Text style={formStyles.rowLabel}>{copy.routes.tailscale}</Text>
                  </View>
                  <Text style={formStyles.rowDetail}>
                    {copy.routes.tailscaleDetail(machine.host, connectedNow && liveRoute === 'tailscale')}
                  </Text>
                </View>
              </View>
              <View style={formStyles.row}>
                <View style={formStyles.rowMain}>
                  <View style={styles.statusLine}>
                    <StatusDot color={connectedNow && liveRoute === 'easyConnect' ? appearance.connected : appearance.muted} />
                    <Text style={formStyles.rowLabel}>{copy.routes.easyConnect}</Text>
                  </View>
                  <Text style={formStyles.rowDetail}>{copy.routes.easyConnectDetail(connectedNow && liveRoute === 'easyConnect')}</Text>
                </View>
              </View>
            </View>
          </>
        ) : null}

        {/* The way to ask again for Easy Connect after a request that was denied, lapsed or hidden. */}
        {!twoRoutes && !easyConnect && easyConnectOffered && signsInOverSsh(machine) ? (
          <View style={formStyles.rowsCard}>
            <View style={[formStyles.row, formStyles.rowFirst]}>
              <View style={formStyles.rowMain}>
                <Text style={formStyles.rowLabel}>{copy.routes.add.label}</Text>
                <Text style={formStyles.rowDetail}>{copy.routes.add.detail(name)}</Text>
              </View>
              <SetupButton
                small
                label={copy.routes.add.button}
                onPress={() => void startSshPairing(machine, { auto: false, easyConnect: true })}
              />
            </View>
          </View>
        ) : null}

        {/* CDXC:RemotePairing 2026-11-09: where a hidden pairing card comes back. Shown while this phone isn't
            approved on this computer (it signs in over SSH and has no device id there); Show brings the card back
            and asks again when the last request lapsed. */}
        {signsInOverSsh(machine) && machine.deviceId === undefined && sshPairing !== undefined ? (
          <View style={formStyles.rowsCard}>
            <View style={[formStyles.row, formStyles.rowFirst]}>
              <View style={formStyles.rowMain}>
                <Text style={formStyles.rowLabel}>{SshPairingCopy.rowLabel}</Text>
                <Text style={formStyles.rowDetail}>{SshPairingCopy.rowDetail(sshPairing.computer)}</Text>
              </View>
              <SetupButton small label={SshPairingCopy.rowShow} onPress={() => void startSshPairing(machine, { auto: false })} />
            </View>
          </View>
        ) : null}

        {/* GitHub #495: requests on this computer that only its owner may allow (CDXC:Security 2026-11-10 in
            `security/approvals.ts` for who sees the switch). */}
        {showsApprovals ? (
          <View style={formStyles.rowsCard}>
            <PageRow
              first
              label={copy.approvals}
              detail={
                waiting === null ? copy.approvalsUnknown : waiting === 0 ? copy.approvalsNone : copy.approvalsWaiting(waiting)
              }
              onPress={() => navigation.navigate('Approvals', { machineId: machine.id })}
            />
            {plainApprovals && requirePresence !== null ? (
              <SwitchRow
                value={requirePresence}
                onValueChange={changeRequirePresence}
                label={ApprovalsCopy.requirePresence(Platform.OS === 'ios')}
                style={formStyles.row}
              >
                <View style={formStyles.rowMain}>
                  <Text style={formStyles.rowLabel}>{ApprovalsCopy.requirePresence(Platform.OS === 'ios')}</Text>
                  <Text style={formStyles.rowDetail}>
                    {requirePresenceError ?? copy.requirePresenceDetail(Platform.OS === 'ios')}
                  </Text>
                </View>
                <Switch
                  value={requirePresence}
                  onValueChange={changeRequirePresence}
                  trackColor={{ false: appearance.cardActive, true: appearance.accent }}
                  thumbColor={appearance.foreground}
                />
              </SwitchRow>
            ) : null}
          </View>
        ) : null}

        {easyConnect ? (
          <FormSection name="machine-form:paired-devices">
            <PairedDevicesSection machine={machine} reachable={reachable} />
          </FormSection>
        ) : null}

        <Text style={formStyles.sectionLabel}>{copy.moreLabel}</Text>
        <View style={formStyles.rowsCard}>
          {moreRows.map((row, index) => (
            <PageRow key={row.key} first={index === 0} label={row.label} detail={row.detail} onPress={row.onPress} />
          ))}
        </View>

        <View style={formStyles.divider} />
        <Pressable accessibilityRole="button" style={styles.removeButton} onPress={() => setRemoveOpen(true)}>
          <Text style={[styles.removeLabel, formStyles.danger]}>{EditMachineCopy.remove.button}</Text>
        </Pressable>
      </ScrollView>

      <ConfirmDialog
        visible={removeOpen}
        title={EditMachineCopy.remove.title}
        body={EditMachineCopy.remove.body(name, removalAsksComputer)}
        confirmLabel={EditMachineCopy.remove.confirm}
        destructive
        onConfirm={() => {
          setRemoveOpen(false);
          void removeComputerFromPhone(machine.id).then(onRemoved);
        }}
        onCancel={() => setRemoveOpen(false)}
      />
    </SafeAreaView>
  );
}

/** A row that opens a page: label, one line of state, and a chevron. */
function PageRow({
  label,
  detail,
  first = false,
  onPress,
}: {
  label: string;
  detail: string;
  first?: boolean;
  onPress: () => void;
}) {
  const appearance = useAppearance();
  const formStyles = useFormStyles();
  const pressedStyle = useMemo(() => ({ backgroundColor: appearance.cardActive }), [appearance]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [formStyles.row, first ? formStyles.rowFirst : null, pressed ? pressedStyle : null]}
    >
      <View style={formStyles.rowMain}>
        <Text style={formStyles.rowLabel}>{label}</Text>
        <Text style={formStyles.rowDetail} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <ChevronRightGlyph size={16} color={appearance.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  removeButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  removeLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
