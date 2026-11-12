import type { AddProjectSourceId } from '../addProject/client';
import type { ContextSession } from '../files/sessionContext';
import type { SettingsPageId } from '../screens/settings/pages';
import type { SettingsSearchFocus } from '../screens/settings/search/SettingsSearchAnchor';

/**
 * Add/edit machine form params. `tailcatToken` prefills the Easy Connect
 * address when the scanner read a bare legacy address. `focus` opens the
 * editor with that field focused (Can't reach → Wrong password → Edit machine).
 * `machineId` alone opens that computer's page; with `section`, one part of its settings.
 */
export type MachineFormParams =
  | {
      machineId?: string;
      tailcatToken?: string;
      focus?: 'password';
      /** One part of a saved computer's settings; without it a saved computer opens on its page (ComputerPage). */
      section?: 'name' | 'updates' | 'tools' | 'advanced';
    }
  | undefined;

/** Root native-stack route map. */
export type RootStackParamList = {
  /** First launch: shown only while no machine is saved. */
  Welcome: undefined;
  /** Add a computer: the connect steps, Scan the code, and the other ways (the old chooser's route). */
  ConnectChoose: undefined;
  /**
   * One scanner for both pairing codes. `rePairMachineId` makes an Easy Connect
   * code replace that machine's address and key instead of adding a machine.
   * `incomingCode` is a pairing link the system camera opened the app with
   * (src/app/deepLinks.ts); `at` tells two openings of the same link apart.
   */
  ScanCode:
    | {
        rePairMachineId?: string;
        incomingCode?: { payload: string; at: number };
        /** Opened by the 11.0.1 security notice: the computers to pair again, first one re-paired (src/app/securityNotice.ts). */
        securityNotice?: { computers: string[] };
        /** "Paste a code" (Other ways to connect): open on the paste sheet; the camera is asked for only after it closes. */
        startWith?: 'paste';
      }
    | undefined;
  /** The Tailscale (plain SSH over the tailnet) form: the manual "type the details" path. */
  TailscaleForm: MachineFormParams;
  /** The "Can't reach <computer>" checklist screen (registered once a machine exists). */
  CantReach: { machineId: string };
  /** Per-OS "turn on SSH access" instructions as a full screen. */
  SshAccessHelp: { platform?: 'macos' | 'windows' | 'linux' } | undefined;
  Sessions: undefined;
  /** The voice agent's conversation screen (the top bar's Voice button, the "Voice mode on" notification). */
  Voice: undefined;
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
    | {
        remotePort: number;
        path?: string;
        scheme?: 'http' | 'https';
        /** The loopback host the link named (`localhost` when absent), which the computer dials. */
        host?: string;
        url?: never;
      }
    | { url: string; remotePort?: never; path?: never; scheme?: never; host?: never }
  );
  /**
   * Files: a project's file browser, the whole project folder by folder with search, Recently changed on top.
   * `session`: the agent session it was opened from (the terminal screen's menu), which Add to Session Context
   * fills; absent when opened from a project's menu.
   */
  Docs: {
    machineId: string;
    projectId: string;
    projectName: string;
    projectPath: string;
    session?: ContextSession;
  };
  /** A project's Changes, read-only: its diff against main or HEAD, as the desktop Changes tab shows it. */
  Changes: { machineId: string; projectId: string; projectName: string };
  /**
   * One file from the computer, by absolute path. `fragment` scrolls to an anchor
   * (a link such as `other.md#setup`). Files uses the same viewer for rendered documents, source and metadata.
   */
  DocViewer: {
    machineId: string;
    path: string;
    fragment?: string;
    /** The session's project, whose file link streams a video or audio file (`docs/mediaStream.ts`). */
    projectId?: string;
    /** Opened from Files: the file's path in the project, which Share… fetches. */
    entryPath?: string;
    /** Opened from Files: the listed size; null when unknown. Enables the browser's preview policy. */
    size?: number | null;
    /** Opened from Files from an agent session: the session Add to Session Context fills. */
    session?: ContextSession;
  };
  /**
   * Send Bug / Feedback; `machineId` is the computer the "Collect more data with an agent" switch uses,
   * `crashReportId` a stored crash report to attach (the next-launch crash prompt), `collectWithAgent`
   * starts with that switch on (the chat's Copy Report).
   */
  Feedback: { machineId?: string; crashReportId?: string; collectWithAgent?: boolean } | undefined;
  /** Settings home: the list of Settings pages. */
  Settings: undefined;
  /**
   * One Settings page, including Notifications, Live Activity, Short replies and Licences.
   * `listOffset`: in two columns, where the Settings list stood when a row opened this page, so the
   * list this screen draws starts there. `focus`: opened from a Settings search result, the row it scrolls to and
   * flashes.
   */
  SettingsPage: { page: SettingsPageId; listOffset?: number; focus?: SettingsSearchFocus };
  /** Notifications: the attention list, what needs the user on every computer (the bell on the Sessions screen). */
  AttentionList: undefined;
  /**
   * Usage: the usage meters of a computer's Claude and Codex accounts, full screen (a usage pane's content when the
   * Duo folds).
   */
  Usage: { machineId: string };
  /** Approvals (GitHub #495): the requests waiting on a computer for its owner, approved with Face ID / fingerprint. */
  Approvals: { machineId: string };
  ExtraKeysEditor: undefined;
  AgentHotkeysEditor: undefined;
  /** Settings > Keyboard > Pad keys: what the Befehlspad's nine positions do. */
  CommandPadKeysEditor: undefined;
  /** Settings › Licences: one component's licence texts, by the `name` and `version` of its notices entry. */
  LicenceNotice: { name: string; version: string };
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
