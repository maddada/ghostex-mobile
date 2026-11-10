/**
 * Pairing ends in the sessions list (the user's pick on the pairing page, Q2189): the computer just added is
 * remembered here so Sessions can say "Connected to <computer>" on top once it answers, and the screen that saved it
 * opens Sessions once that route exists (it is registered on the render after the first computer is saved, App.tsx).
 */

import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';

import { useMachinesStore } from './store';

type JustPairedState = {
  machineId: string | null;
  mark: (machineId: string) => void;
  clear: () => void;
};

export const useJustPairedStore = create<JustPairedState>((set) => ({
  machineId: null,
  mark: (machineId) => set({ machineId }),
  clear: () => set({ machineId: null }),
}));

type ResetsToSessions = { reset: (state: { index: number; routes: { name: 'Sessions' }[] }) => void };

/** `open(machineId)`: select the new computer and land on Sessions, its first line saying it is connected. */
export function useOpenSessionsAfterPairing(navigation: ResetsToSessions): (machineId: string) => void {
  const hasMachines = useMachinesStore((state) => state.machines.length > 0);
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    if (opened !== null && hasMachines) navigation.reset({ index: 0, routes: [{ name: 'Sessions' }] });
  }, [opened, hasMachines, navigation]);
  return useCallback((machineId: string) => {
    useMachinesStore.getState().selectMachine(machineId);
    useJustPairedStore.getState().mark(machineId);
    setOpened(machineId);
  }, []);
}
