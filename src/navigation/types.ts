import type { AddProjectSourceId } from '../addProject/client';

/** Root native-stack route map. */
export type RootStackParamList = {
  Welcome: undefined;
  Sessions: undefined;
  Machines: undefined;
  MachineForm: { machineId?: string } | undefined;
  Terminal: { sessionKey: string; machineId: string; title?: string };
  Settings: undefined;
  ExtraKeysEditor: undefined;
  AgentHotkeysEditor: undefined;
  /** Add Project step 1: pick a source on an already-chosen machine. */
  AddProjectSource: { machineId: string };
  /** Add Project local branch: type or browse a folder, then register it. */
  AddProjectLocal: { machineId: string };
  /** Add Project clone branch: enter a URL or a provider repository path. */
  AddProjectRepository: { machineId: string; source: AddProjectSourceId };
  /** Add Project clone branch: choose where the repository is cloned to. */
  AddProjectDestination: {
    machineId: string;
    remoteUrl: string;
    repositoryTitle: string;
    repositoryUrl: string;
  };
};
