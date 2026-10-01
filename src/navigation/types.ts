import type { AddProjectSourceId } from '../addProject/client';
import type { SettingsPageId } from '../screens/settings/pages';

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
  /** One Find result in full, addressed by its stable prompt key. */
  FindPrompt: { machineId: string; promptKey: string };
  /** Web preview opening screen: enter an address or select a listening port. */
  WebPreviewPorts: { machineId: string };
  /** Browse a computer-side port through SSH, or an ordinary website directly. */
  WebPreview: { machineId: string } & (
    | { remotePort: number; path?: string; scheme?: 'http' | 'https'; url?: never }
    | { url: string; remotePort?: never; path?: never; scheme?: never }
  );
  /** A project's Docs: its Markdown and HTML files, by folder, as the desktop Docs view lists them. */
  Docs: { machineId: string; projectId: string; projectName: string; projectPath: string };
  /**
   * One Markdown or HTML file from the computer, by absolute path. `fragment` scrolls to an anchor
   * (a link such as `other.md#setup`).
   */
  DocViewer: { machineId: string; path: string; fragment?: string };
  /** Settings home: the list of Settings pages. */
  Settings: undefined;
  /** One Settings page (Theme, Chat, Terminal, Keyboard, Sounds, Connection, Updates, Advanced). */
  SettingsPage: { page: SettingsPageId };
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
