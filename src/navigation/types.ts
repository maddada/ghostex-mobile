import type { AddProjectSourceId } from '../addProject/client';

/**
 * Add/edit machine form params. `tailcatToken` prefills the Easy Connect
 * address when the scanner read a bare legacy address. `focus` opens the
 * editor with that field focused (Can't reach → Wrong password → Edit machine).
 */
export type MachineFormParams =
  | { machineId?: string; tailcatToken?: string; focus?: 'password' }
  | undefined;

/** Root native-stack route map. */
export type RootStackParamList = {
  /** First launch: shown only while no machine is saved. */
  Welcome: undefined;
  /** "How does your phone reach your computer?": Easy Connect vs Tailscale. */
  ConnectChoose: undefined;
  /**
   * One scanner for both pairing codes. `rePairMachineId` makes an Easy Connect
   * code replace that machine's address and key instead of adding a machine.
   */
  ScanCode: { rePairMachineId?: string } | undefined;
  /** The Tailscale (plain SSH over the tailnet) form: the manual "type the details" path. */
  TailscaleForm: MachineFormParams;
  /** End of setup: names the computer, the user and the live session count. */
  Connected: { machineId: string };
  /** The "Can't reach <computer>" checklist screen (registered once a machine exists). */
  CantReach: { machineId: string };
  /** Per-OS "turn on SSH access" instructions as a full screen. */
  SshAccessHelp: { platform?: 'macos' | 'windows' | 'linux' } | undefined;
  Sessions: undefined;
  Machines: undefined;
  /**
   * Add/edit form. `tailcatToken` prefills the Easy Connect address when the
   * scanner read a bare legacy address (the Advanced "Pairing address" row).
   */
  MachineForm: MachineFormParams;
  Terminal: { sessionKey: string; machineId: string; title?: string };
  /** Find Prompts: search every prompt this machine sent to an agent (`gx f`). */
  FindPrompts: { machineId: string };
  /** Web preview step 1: pick which of the computer's ports to forward. */
  WebPreviewPorts: { machineId: string };
  /**
   * Web preview: browse `localhost:<remotePort>` on the computer through an SSH
   * forward. `path` and `scheme` come from a followed link; they default to the
   * site root over http.
   */
  WebPreview: {
    machineId: string;
    remotePort: number;
    path?: string;
    scheme?: 'http' | 'https';
  };
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
