/**
 * Removing a computer from this phone, from its page or the Machines list: its cached lists go, the computer is
 * asked to stop its push notifications while its record and link still exist (a bounded wait; an unreachable
 * computer is removed anyway), the connection closes, then the record and its saved keys are deleted.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { markManualDisconnect } from '../app/autoReconnect';
import { useInventoryStore } from '../inventory/store';
import { unregisterBeforeRemoval } from '../notifications/pushStore';
import { useSpacesStore } from '../spaces/store';
import { useWorkspacesStore } from '../workspaces/store';
import { useMachinesStore } from './store';

export async function removeComputerFromPhone(machineId: string): Promise<void> {
  useInventoryStore.getState().clearMachine(machineId);
  useSpacesStore.getState().clearMachine(machineId);
  useWorkspacesStore.getState().clearMachine(machineId);
  await unregisterBeforeRemoval(machineId);
  try {
    markManualDisconnect(machineId);
    await GhostexNative.disconnect(machineId);
  } catch {
    // Not connected is fine.
  }
  await useMachinesStore.getState().removeMachine(machineId);
}
