/**
 * Mobile analytics hello.
 *
 * Every Ghostex analytics event is sent by the gxserver on the user's machine,
 * never by this app; see ANALYTICS.md in the main repo. Until 2026-09-03 the
 * only trace of a phone in that data was a keep-awake lease, which exists only
 * while a terminal tab is open and says nothing about the phone's OS, so the
 * question "how many people use the mobile app, on Android or iOS, at which
 * version" had no answer. This module sends one `ghostex client-hello` per
 * machine per hour after a successful inventory fetch, carrying exactly the OS
 * family, OS release, and app version. It is fire-and-forget: a machine whose
 * Ghostex predates the verb answers with a usage dump, and that is ignored.
 */

import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import {
  clientHelloCommand,
  loginShellCommand,
  type ClientHelloPlatform,
} from '../commands/ghostexCli';
import type { MachineConnectionTarget } from '../machines/credentials';

/** The daemon dedupes to one attach per client kind per hour; match it. */
const HELLO_INTERVAL_MS = 60 * 60 * 1000;
const HELLO_EXEC_TIMEOUT_MS = 10_000;

const lastHelloAtByMachineId = new Map<string, number>();

function currentPlatform(): ClientHelloPlatform | null {
  if (Platform.OS === 'ios') {
    return {
      os: 'ios',
      osVersion: Platform.constants.osVersion,
      appVersion: Application.nativeApplicationVersion ?? undefined,
    };
  }
  if (Platform.OS === 'android') {
    return {
      os: 'android',
      osVersion: Platform.constants.Release,
      appVersion: Application.nativeApplicationVersion ?? undefined,
    };
  }
  return null;
}

/**
 * Send the hello for `machine` unless one went out in the last hour. Never
 * throws and never blocks the caller; the SSH client is already connected
 * because this runs right after a successful inventory fetch.
 */
export function reportClientHello(machine: MachineConnectionTarget): void {
  const platform = currentPlatform();
  if (platform === null) return;
  const now = Date.now();
  const last = lastHelloAtByMachineId.get(machine.id);
  if (last !== undefined && now - last < HELLO_INTERVAL_MS) return;
  // Stamp before the exec so a failing machine is asked once an hour, not once per poll.
  lastHelloAtByMachineId.set(machine.id, now);
  void GhostexNative.exec(
    machine.id,
    loginShellCommand(clientHelloCommand(platform)),
    HELLO_EXEC_TIMEOUT_MS,
  ).catch(() => undefined);
}
