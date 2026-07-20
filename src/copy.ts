/**
 * Centralized user-facing copy quoted verbatim from the specs:
 * - docs/specs/sessions-drawer.md (§§2,4,5,6)
 * - docs/specs/onboarding.md (§1)
 * Keep these strings exactly as specified; screens must import from here.
 */

export const WelcomeCopy = {
  headline: 'Welcome to Ghostex',
  subheadline: 'Your secure SSH terminal',
  continueButton: 'Continue',
} as const;

export const SessionCopy = {
  /** Row/menu title fallback when a session has no display title. */
  fallbackTitle: 'Ghostex Session',
  emptyProjectRow: 'No sessions yet. Tap + to create one.',
  showMore: 'Show more',
  showLess: 'Show less',
  chatsTitle: 'Chats',
  unknownRecency: 'Unknown',
  attachCommandCopied: 'Attach command copied',
} as const;

/** STATE_CARD copy + status lines, sessions-drawer.md §5. */
export const StateCardCopy = {
  noMachines: {
    title: 'Add your Mac',
    body: 'Add the macOS machine that runs Ghostex, Tailscale, SSH, and ZMX sessions.',
    actionHint: 'Open Machines, then tap Add, or open Tutorial from Machines.',
    status: 'Add a machine to connect to Ghostex over Tailscale.',
  },
  connecting: {
    title: 'Connecting',
    body: (label: string) =>
      `Opening SSH to ${label} and asking the Ghostex CLI for ZMX-backed sessions.`,
    actionHint: 'Keep Tailscale online on both devices.',
    status: (label: string) => `Connecting to ${label}...`,
    refreshingStatus: (label: string) => `Refreshing sessions on ${label}...`,
  },
  failure: {
    title: 'Connection needs attention',
    fallbackBody: 'Could not connect to the selected machine.',
    actionHint: 'Use Retry, Tailscale, Setup, or switch machines above.',
    refreshFailedStatus: (message: string) => `Session refresh failed: ${message}`,
  },
  empty: {
    title: 'No ZMX sessions yet',
    body: 'The machine is reachable, but the Ghostex CLI did not return any ZMX-backed sessions.',
    actionHint: 'Start or resume sessions in Ghostex on the remote machine, then tap Retry.',
  },
  success: {
    status: (label: string) => `Connected to ${label}`,
    emptyProjectsStatus: 'Connected. Active projects have no ZMX-backed sessions.',
  },
  initialStatus: 'Connect to a ZMX machine',
} as const;

/** Failure summarization copy map, sessions-drawer.md §5. */
export const FailureCopy = {
  hostKey:
    "SSH host key verification failed. Open Setup and reset this phone's saved host key for the machine, or confirm you are connecting to the right Mac.",
  permissionDeniedWithPassword:
    'SSH rejected the saved password. Update the saved machine password or choose another machine.',
  permissionDeniedWithoutPassword:
    'SSH needs a key or password. Open the machine settings and save a password, or configure SSH keys/Tailscale SSH.',
  refused:
    'The machine is reachable, but SSH refused the connection. Enable Remote Login on the Mac and confirm the saved SSH port.',
  unreachable:
    'Could not reach the machine. Open Tailscale and confirm both devices are online.',
  noCli:
    'Connected over SSH, but the Mac could not find the Ghostex CLI. Install Ghostex CLI and make sure ghostex is available in the SSH login shell.',
  oldCli:
    'Connected over SSH, but this Mac has an older Ghostex CLI. Update Ghostex so ghostex android-check --json is available.',
  persistenceNotZmx:
    'Ghostex is reachable, but Session persistence is not set to zmx. Open Ghostex Settings on the Mac and set Session persistence to zmx.',
  zmxMissing:
    'Ghostex is reachable, but ZMX is not available on the Mac. Install zmx and set Ghostex session persistence to zmx.',
  emptyOutput: 'Could not connect to the machine.',
  noJson: 'Ghostex CLI did not return JSON.',
  incompleteJson: 'Ghostex CLI returned incomplete JSON.',
} as const;

/** Machine list/editor copy, sessions-drawer.md §4. */
export const MachineCopy = {
  emptyCard: {
    title: 'No SSH machines yet',
    body: 'Add the Mac or workstation that runs Ghostex, Tailscale, SSH, and ZMX sessions.',
  },
  editor: {
    addTitle: 'Add a Mac or workstation',
    editTitle: 'Edit SSH machine',
    body: 'Ghostex Android connects over Tailscale SSH, then runs the Ghostex CLI on this machine to list and attach ZMX sessions.',
    passwordBody:
      'Leave the password empty to use SSH keys or Tailscale SSH. If entered without saving, it stays only in memory for this app run.',
    savePasswordCheckbox: 'Save password securely on this device',
    passwordHintNew: 'SSH password (optional)',
    passwordHintEdit: 'SSH password (leave blank to keep saved password)',
  },
  validation: {
    port: 'Use a port from 1 to 65535.',
    duplicate: 'This SSH target is already saved.',
    savePasswordWithoutPassword: 'Enter a password or uncheck Save password.',
    general: 'Fix the highlighted machine details.',
    emptyPassword: 'Enter the SSH password.',
  },
  card: {
    neverConnected: 'Never connected',
    lastConnected: (recency: string) => `Last connected ${recency}`,
    switchHint: 'Tap this card to switch to this machine.',
    selectedSuffix: ' · Selected',
  },
} as const;

/** Attach/creation progress copy, sessions-drawer.md §§5,6. */
export const ProgressCopy = {
  preparingAttach: (alias: string) => `Preparing SSH attach for ${alias}...`,
  attached: (alias: string, label: string) => `Attached to ${alias} on ${label}...`,
  creatingTerminal: (project: string) => `Creating a terminal in ${project}…`,
  creatingQuickSession: 'Creating a Quick session…',
  startingAgent: (agent: string, project: string) => `Starting ${agent} in ${project}…`,
  noStableProjectId:
    'This project has no stable project id, so agent sessions cannot be started here.',
  openedInBrowser: (name: string) => `Opened ${name} in the browser.`,
  restoringProject: (title: string) => `Restoring ${title}...`,
  restoredProject: (title: string) => `Restored ${title}.`,
} as const;

/** Rename prompt copy, sessions-drawer.md §2. */
export const RenameCopy = {
  title: 'Rename session',
  body: 'This updates the session title in Ghostex on the connected Mac.',
  inputHint: 'Session title',
  emptyTitleError: 'Enter a session title.',
} as const;
