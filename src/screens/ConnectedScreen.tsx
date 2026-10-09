import { execRemoteCommand } from '../remote/commands';
/**
 * Connected (docs/2026-09-03/mobile-setup/mobile-05-connected.html): end of
 * setup. Names the computer and the user, reads the Ghostex version and the
 * live session count from the first inventory load so the user knows the
 * connection is real, states the one expectation behind most support
 * questions (the computer has to be awake), then hands off to Sessions.
 */

import { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { AlertTriangleGlyph, CheckGlyph, InfoGlyph, LoaderGlyph } from '../components/onboarding/SetupIcons';
import {
  SetupButton,
  SetupCallout,
  SetupRow,
  SetupRows,
  StatusDot,
  setupText,
} from '../components/onboarding/SetupPrimitives';
import { countSessions } from '../contract/grouping';
import { ConnectedCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexStrokeWidth, SetupPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Connected'>;

const VERSION_COMMAND = 'ghostex server version';
const VERSION_TIMEOUT_MS = 15000;

type FirstLoad =
  | { kind: 'loading' }
  | { kind: 'loaded'; version: string; total: number; working: number }
  /** The inventory store's summarized failure text for this machine. */
  | { kind: 'failed'; message: string };

/** `ghostex server version` prints the version on its own line; ignore shell noise around it. */
function parseVersion(stdout: string): string | null {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^v?\d+\.\d+/u.test(lines[index])) return lines[index].replace(/^v/u, '');
  }
  return null;
}

async function loadFirstInventory(machine: MachineRecord): Promise<FirstLoad> {
  const inventory = useInventoryStore.getState();
  await inventory.refreshMachine(machine);
  const loaded = useInventoryStore.getState().inventoriesByMachineId[machine.id];
  if (loaded === undefined || loaded.summary === null) {
    return { kind: 'failed', message: loaded?.lastError ?? ConnectedCopy.unavailable };
  }
  if (loaded.lastError !== null) return { kind: 'failed', message: loaded.lastError };
  const counts = countSessions(loaded.summary.sessions);
  return {
    kind: 'loaded',
    version: await readGhostexVersion(machine),
    total: loaded.summary.sessions.length,
    working: counts.workingCount,
  };
}

/**
 * `ghostex server version` over the machine's live connection. The inventory
 * already proved the connection, so any failure here is the CLI's own text
 * (or "Ghostex CLI not found" when the login shell cannot resolve `ghostex`).
 */
async function readGhostexVersion(machine: MachineRecord): Promise<string> {
  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await execRemoteCommand(machine.id, VERSION_COMMAND, VERSION_TIMEOUT_MS);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (/command not found|not found|No such file/iu.test(output)) return ConnectedCopy.cliNotFound;
  if (result.exitCode !== 0) return output.length > 0 ? output : ConnectedCopy.versionFailed(result.exitCode);
  return parseVersion(result.stdout) ?? (output.length > 0 ? output : ConnectedCopy.versionFailed(0));
}

export default function ConnectedScreen({ navigation, route }: Props) {
  const { machineId } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);
  const [firstLoad, setFirstLoad] = useState<FirstLoad>({ kind: 'loading' });

  useEffect(() => {
    if (machine === null) return;
    let cancelled = false;
    void loadFirstInventory(machine).then((result) => {
      if (!cancelled) setFirstLoad(result);
    });
    return () => {
      cancelled = true;
    };
    // The record's identity fields do not change while this screen is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  const openSessions = (): void => {
    useMachinesStore.getState().selectMachine(machineId);
    navigation.reset({ index: 0, routes: [{ name: 'Sessions' }] });
  };

  if (machine === null) {
    return <SafeAreaView style={styles.container} edges={['top', 'bottom']} />;
  }

  const easyConnect = machine.transport === 'tailcat';
  const name = machine.name.length > 0 ? machine.name : machine.username;
  const connectionValue = easyConnect ? ConnectedCopy.easyConnect : ConnectedCopy.tailscale(machine.host);
  const valueFor = (loaded: (load: Extract<FirstLoad, { kind: 'loaded' }>) => string): string => {
    if (firstLoad.kind === 'loading') return ConnectedCopy.checking;
    if (firstLoad.kind === 'failed') return ConnectedCopy.unavailable;
    return loaded(firstLoad);
  };
  const failure = firstLoad.kind === 'failed' ? firstLoad.message : null;
  const dotColor =
    firstLoad.kind === 'loaded' ? SetupPalette.OK : firstLoad.kind === 'failed' ? SetupPalette.ERROR : SetupPalette.DIM;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.body}>
        {firstLoad.kind === 'loading' ? (
          <View style={styles.hero}>
            <View style={[styles.mark, styles.markNeutral]}>
              <LoaderGlyph size={36} color={SetupPalette.MUTED} strokeWidth={2.2} />
            </View>
            <View>
              <Text style={[setupText.titleLg, setupText.center]}>{ConnectedCopy.connectingTitle(name)}</Text>
              <Text style={[setupText.lede, setupText.center, styles.lede]}>{ConnectedCopy.connectingLede}</Text>
            </View>
          </View>
        ) : firstLoad.kind === 'failed' ? (
          <View style={styles.hero}>
            <View style={[styles.mark, styles.markFailed]}>
              <AlertTriangleGlyph size={36} color={SetupPalette.WARN} strokeWidth={2.2} />
            </View>
            <View>
              <Text style={[setupText.titleLg, setupText.center]}>{ConnectedCopy.failedTitle(name)}</Text>
              <Text style={[setupText.lede, setupText.center, styles.lede]}>{ConnectedCopy.failedLede}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.hero}>
            <View style={styles.mark}>
              <CheckGlyph size={40} color={SetupPalette.OK} strokeWidth={2.2} />
            </View>
            <View>
              <Text style={[setupText.titleLg, setupText.center]}>{ConnectedCopy.title}</Text>
              <Text style={[setupText.lede, setupText.center, styles.lede]}>
                {ConnectedCopy.ledePrefix}
                <Text style={setupText.strong}>{name}</Text>
                {ConnectedCopy.ledeSuffix}
              </Text>
            </View>
          </View>
        )}

        <SetupRows>
          <SetupRow
            first
            label={ConnectedCopy.rows.connection}
            value={connectionValue}
            leading={<StatusDot color={dotColor} />}
          />
          <SetupRow mono label={ConnectedCopy.rows.runsAs} value={machine.username} />
          <SetupRow label={ConnectedCopy.rows.version} value={valueFor((load) => load.version)} />
          <SetupRow
            label={ConnectedCopy.rows.sessions}
            value={valueFor((load) => ConnectedCopy.sessionsValue(load.total, load.working))}
          />
        </SetupRows>
        {failure !== null ? (
          <View style={styles.failureBlock}>
            <Text style={styles.failure}>{failure}</Text>
            <SetupButton
              label={ConnectedCopy.whatCanICheck}
              onPress={() => navigation.navigate('CantReach', { machineId })}
            />
          </View>
        ) : null}

        <SetupCallout icon={<InfoGlyph size={16} color={SetupPalette.MUTED} />}>
          {easyConnect ? ConnectedCopy.calloutEasyConnect : ConnectedCopy.calloutTailscale}
        </SetupCallout>
      </View>

      <View style={styles.footer}>
        <SetupButton variant='primary' large label={ConnectedCopy.openSessions} onPress={openSessions} />
        <SetupButton
          label={ConnectedCopy.addAnother}
          onPress={() => navigation.navigate('ConnectChoose')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SetupPalette.PAGE,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: 24,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  hero: {
    alignItems: 'center',
    gap: 16,
  },
  mark: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(99,209,122,0.12)',
    borderWidth: GhostexStrokeWidth,
    borderColor: 'rgba(99,209,122,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markNeutral: {
    backgroundColor: SetupPalette.CARD,
    borderColor: SetupPalette.BORDER_STRONG,
  },
  markFailed: {
    backgroundColor: 'rgba(255,180,84,0.12)',
    borderColor: 'rgba(255,180,84,0.4)',
  },
  lede: {
    marginTop: 8,
  },
  failureBlock: {
    marginTop: -12,
    gap: 10,
  },
  failure: {
    color: SetupPalette.ERROR,
    fontSize: 12.5,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
  },
});
