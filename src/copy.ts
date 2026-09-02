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
  /** Desktop parity: project cards say exactly "No sessions". */
  emptyProjectRow: 'No sessions',
  /** Desktop parity: empty Quick section body. */
  emptyQuickRow: 'No Quick Sessions',
  showMore: 'Show more',
  showLess: 'Show less',
  /** Desktop session-styled reveal row: "Show 4 more". */
  showCountMore: (count: number) => `Show ${count} more`,
  chatsTitle: 'Chats',
  /** Desktop reference sidebar section labels. */
  quickSectionTitle: 'Quick',
  projectsSectionTitle: 'Projects',
  /**
   * Desktop in-project kind disclosures (session-group-section.tsx renders
   * these as Browser / Pinned / Sessions above the first row of each kind).
   */
  browserKindLabel: 'Browser',
  pinnedKindLabel: 'Pinned',
  sessionsKindLabel: 'Sessions',
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
  outdatedForFeature:
    "This machine's Ghostex is too old for this feature. Update Ghostex on the machine, then try again.",
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
  /** Tailcat pairing-QR camera scanner, opened from the token field. */
  scanner: {
    buttonLabel: 'Scan',
    buttonAccessibilityLabel: 'Scan the tailcat pairing QR code',
    title: 'Scan pairing code',
    cancel: 'Cancel',
    aimHint:
      'Point the camera at the QR code in Ghostex on your computer, under Settings → Remote → Tailcat.',
    foreignCode: 'That code is not a tailcat pairing token. Keep the pairing QR code in frame.',
    deniedTitle: 'Camera access is off',
    deniedRetry: 'Ghostex needs the camera to read the pairing QR code.',
    deniedSettings:
      'Allow camera access for Ghostex in Settings, then come back and scan the pairing QR code.',
    allowButton: 'Allow camera',
    openSettingsButton: 'Open Settings',
  },
  validation: {
    port: 'Use a port from 1 to 65535.',
    duplicate: 'This SSH target is already saved.',
    savePasswordWithoutPassword: 'Enter a password or uncheck Save password.',
    general: 'Fix the highlighted machine details.',
    emptyPassword: 'Enter the SSH password.',
    tailcatTokenEmpty: 'Paste the tailcat pairing token for this machine.',
    tailcatTokenPrefix: 'A tailcat pairing token starts with "tc".',
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

/**
 * Add Project flow copy,
 * adapted to Ghostex mobile: the machine is chosen by the entry-point context
 * menu, and there is no in-app source-control settings screen to deep-link to.
 */
export const AddProjectCopy = {
  sourceTitle: 'Add Project',
  localTitle: 'Local folder',
  destinationTitle: 'Clone destination',
  machineLine: (label: string) => `Adding a project on ${label}.`,
  machineMissing: 'This machine is no longer saved on this device.',
  sourcesSection: 'Choose a source',
  localRowTitle: 'Local folder',
  localRowDescription: 'Browse a folder on disk',
  browseSection: 'Browse folders',
  browseEmpty: 'No folders here.',
  parentRow: '..',
  pathLabel: 'Project path',
  pathPlaceholder: '~/projects/my-app',
  addButton: 'Add project',
  createAndAddButton: 'Create & add project',
  createHint: 'This folder does not exist yet and will be created.',
  duplicateTitle: 'Project already exists',
  duplicateBody: (title: string) => `${title} is already open on this machine.`,
  repositorySection: 'Repository',
  urlPlaceholder: 'https://github.com/org/repo.git',
  repositoryPlaceholder: (label: string, hint: string) => `${label} repository (${hint})`,
  continueButton: 'Continue',
  lookupButton: 'Lookup repository',
  destinationSection: 'Select where to clone',
  destinationPreview: (path: string) => `Clones into ${path}`,
  cloneButton: 'Clone project',
  cloningButton: 'Cloning…',
  discoveryPending: 'Checking which hosting CLIs this machine can clone with…',
  providerUnavailableHint: 'Provider status unavailable on this machine.',
  providerUnauthenticatedHint: (label: string) => `${label} is not signed in on this machine.`,
  setupRequired: 'Setup required',
  emptyPathError: 'Enter a project path.',
  emptyRepositoryError: 'Enter a repository.',
  emptyUrlError: 'Enter a Git clone URL.',
} as const;

/** Rename prompt copy, sessions-drawer.md §2. */
export const RenameCopy = {
  title: 'Rename session',
  body: 'This updates the session title in Ghostex on the connected Mac.',
  inputHint: 'Session title',
  emptyTitleError: 'Enter a session title.',
} as const;

/**
 * Session note prompt copy. The body says "conversation", not "session",
 * because that is literally what the note is attached to: it survives closing
 * the session and resuming the same agent thread later.
 */
export const SessionNoteCopy = {
  title: 'Session note',
  body: 'Attached to this agent conversation, so it comes back when you resume it. Clear the text to remove the note.',
  inputHint: "What's next in this thread…",
} as const;

/**
 * Web preview copy: forwarding a port the computer is listening on and browsing
 * it on the phone. The user's mental model is the computer's own address bar,
 * so every string here names `localhost:<port>` on the computer and never the
 * phone-side forwarded port or the machine id.
 */
export const WebPreviewCopy = {
  menuLabel: 'Web Preview',
  pickerTitle: 'Web Preview',
  previewTitle: 'Web Preview',
  /** Picker intro; `label` is the machine's display label, never its id. */
  pickerIntro: (label: string) => `Open a web app running on ${label} in a preview here on the phone.`,
  manualSection: 'Port',
  manualPlaceholder: '3000',
  manualHint: 'Enter the port your web app listens on, as you would open it on the computer.',
  openButton: 'Open',
  invalidPort: 'Use a port from 1 to 65535.',
  listeningSection: 'Listening now',
  listeningLoading: 'Asking the computer which ports are listening…',
  listeningEmpty: 'Nothing is listening on the computer right now.',
  refreshButton: 'Refresh',
  /** Row title: exactly what the same page would be at on the computer. */
  portRowTitle: (port: number) => `localhost:${port}`,
  portRowUnknownCommand: 'Unknown process',
  listeningFailedTitle: 'Could not list the computer’s ports',
  listeningFailedHint: 'Enter the port above to open it anyway.',
  oldCli:
    'The computer’s ghostex CLI is too old to list ports. Update Ghostex on the computer, or enter a port manually.',
  machineMissing: 'This machine is no longer saved on this device.',
  connecting: (port: number) => `Forwarding localhost:${port} from the computer…`,
  errorTitle: 'Web preview needs attention',
  notListening: (port: number) => `Nothing is listening on port ${port} on the computer.`,
  notListeningHint: 'Start the web app on the computer, then tap Retry.',
  forwardingProhibited:
    'The computer’s SSH server does not allow port forwarding. Set AllowTcpForwarding yes in its sshd config, then tap Retry.',
  connectionLost: 'The SSH connection to the computer dropped, so the forwarded port closed.',
  connectionLostHint: 'Tap Retry to reconnect and forward the port again.',
  /**
   * A page on a forwarded port that would not load. The tunnel is plain TCP, so
   * an https address only works when the computer's server actually speaks TLS
   * on that port — the preview cannot tell the two causes apart from here, so
   * both are named.
   */
  httpsTunnelFailed: (port: number) =>
    `Could not load https://localhost:${port} — the tunnel carries the connection as-is, so check that the server speaks HTTPS on that port.`,
  forwardedPageFailed: (port: number) => `Could not load localhost:${port} from the computer.`,
  /** A page the preview followed off the computer and onto the open web. */
  externalPageFailed: (url: string) => `Could not load ${url}.`,
  externalPageFailedHint: 'Check this phone’s internet connection, then tap Retry.',
  retryButton: 'Retry',
  closeLabel: 'Close preview',
  backLabel: 'Back',
  forwardLabel: 'Forward',
  reloadLabel: 'Reload',
  openInBrowserLabel: 'Open in browser',
  openInBrowserFailed: 'No app on this phone could open that address.',
} as const;
