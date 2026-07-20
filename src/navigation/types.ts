/** Root native-stack route map. */
export type RootStackParamList = {
  Welcome: undefined;
  Sessions: undefined;
  Machines: undefined;
  MachineForm: { machineId?: string } | undefined;
  Terminal: { sessionKey: string; machineId: string; title?: string };
  Settings: undefined;
};
