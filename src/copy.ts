/**
 * Centralized user-facing copy quoted verbatim from the specs:
 * - docs/specs/sessions-drawer.md (§§2,4,5,6)
 * - docs/specs/onboarding.md (§1)
 * Keep these strings exactly as specified; screens must import from here.
 *
 * CDXC:Copy 2026-09-03:
 * User decision: Ghostex-owned user-facing copy in the desktop, web, and mobile apps uses no em dashes; use punctuation that preserves the sentence's natural reading instead.
 */

/**
 * Welcome (docs/2026-09-03/mobile-setup/mobile-01-welcome.html). Sells the three
 * things the phone can do and asks for one tap; none of the transport
 * vocabulary appears here.
 */
export const WelcomeCopy = {
  headline: 'Ghostex',
  subheadline: 'Your agents, from your pocket.',
  features: [
    {
      key: 'sessions',
      title: 'Watch and reply to sessions',
      description:
        'Claude, Codex and Gemini sessions running on your computer, with approvals and questions right on the phone.',
    },
    {
      key: 'terminal',
      title: 'Open a real terminal',
      description: "Attach to any session's terminal, with extra keys that make sense on a phone.",
    },
    {
      key: 'projects',
      title: 'Start new work',
      description: 'Add projects, clone repos and kick off sessions without opening the computer.',
    },
  ],
  connectButton: 'Connect your computer',
  footnote: 'Takes about a minute. Keep Ghostex open on your computer.',
} as const;

/** Choose how to connect (mobile-02-choose.html). */
export const ConnectChooseCopy = {
  eyebrow: 'Connect your computer',
  title: 'How does your phone reach your computer?',
  lede: 'Both work from anywhere, not just at home. You can add more computers later.',
  easyConnect: {
    title: 'Scan a code',
    tag: 'Recommended',
    subtitle: 'Uses Easy Connect, built into Ghostex. Nothing to install, nothing to type.',
    steps: [
      'On the computer, open the Ghostex menu → Mobile & Remote → Connect',
      'Point the phone at the code that appears',
    ],
    duration: 'About a minute',
    button: 'Scan code',
  },
  tailscale: {
    title: 'Use Tailscale',
    subtitle:
      'If Tailscale is already on this phone and the computer. Scan the Tailscale code from Settings → Remote, then enter your computer password.',
    typeDetailsLink: 'Or type the details',
    button: 'Scan code',
  },
} as const;

/** Scan pairing code (mobile-03-scan.html): one scanner for both code kinds. */
export const ScanCopy = {
  title: 'Scan code',
  helpAccessibilityLabel: 'Where is the code?',
  hint: 'Point at the code in Ghostex → Settings → Remote',
  pasteButton: 'Paste a code instead',
  cantFindPrefix: "Can't find the code? ",
  cantFindLink: 'Show me where it is',
  found: (computer: string) => `Found ${computer}`,
  pairingAs: (user: string) => `Pairing as ${user}…`,
  tailscaleFound: (user: string, address: string) => `Tailscale code · ${user}@${address}`,
  summary: {
    computer: 'Computer',
    user: 'User',
    connection: 'Connection',
    easyConnect: 'Easy Connect',
  },
  rejected: {
    title: "That's not a Ghostex code",
    detail: 'Point at the code in Ghostex → Mobile & Remote on the computer.',
  },
  expired: {
    title: 'This code has expired',
    detail: 'Click New code on the computer and scan again.',
  },
  pairingFailed: {
    title: "Couldn't pair with the computer",
  },
  noSecret: {
    title: 'This code cannot pair by itself',
    detail: 'Update Ghostex on the computer, then scan a new code.',
  },
  cameraDenied: 'Camera access is off for Ghostex, so paste the code instead.',
  cameraDeniedSettingsLink: 'Allow the camera in Settings',
  paste: {
    title: 'Paste a pairing code',
    ledePrefix: 'On the computer, click ',
    ledeStrong: 'Copy as text',
    ledeSuffix: ' next to the QR code and send it to this phone.',
    placeholder: 'ghostex-ec1:…',
    validEasyConnect: (user: string, computer: string) =>
      `Looks like a Ghostex pairing code for ${user} on ${computer}`,
    validTailscale: (user: string, computer: string) =>
      `Looks like a Ghostex Tailscale code for ${user} on ${computer}`,
    validLegacy: 'Looks like a pairing address. You will be asked for the computer name and user next.',
    invalid: "That doesn't look like a Ghostex code.",
    button: 'Pair',
  },
  whereIsCode: {
    title: 'Where is the code?',
    steps: [
      {
        title: 'Open Ghostex on your computer',
        detail: 'The code is only shown while Ghostex is open.',
      },
      {
        title: 'Click the Ghostex menu at the top of the sidebar → Mobile & Remote',
        detail: 'Or open Settings → Remote.',
      },
      {
        title: 'Click Connect under Easy Connect',
        detail: 'Easy Connect turns on by itself and the code appears.',
      },
    ],
    notInstalledPrefix: "Ghostex isn't installed on the computer yet? ",
    notInstalledLink: 'ghostex.dev',
    notInstalledUrl: 'https://ghostex.dev',
  },
  tailscalePassword: {
    eyebrow: 'Tailscale',
    title: 'One more thing: your computer password',
    lede: "The code filled in everything else. The password is saved in this phone's secure keystore and never leaves it.",
    summary: { computer: 'Computer', address: 'Address', username: 'Username' },
    passwordLabel: (user: string) => `Password for ${user}`,
    button: 'Save and connect',
    keyHint: 'Prefer an SSH key? Skip the password and set one up later under Edit machine → Advanced.',
    emptyPassword: 'Enter the password for this user on the computer.',
  },
} as const;

/** Connected (mobile-05-connected.html): end of setup. */
export const ConnectedCopy = {
  title: 'Connected',
  ledePrefix: 'This phone can now reach ',
  ledeSuffix: ' from anywhere.',
  connectingTitle: (name: string) => `Connecting to ${name}…`,
  connectingLede: 'Saved on this phone. Checking that the computer answers.',
  failedTitle: (name: string) => `Saved, but can't reach ${name} yet`,
  failedLede: 'The computer is saved on this phone. Fix the connection and try again from Sessions.',
  whatCanICheck: 'What can I check?',
  rows: {
    connection: 'Connection',
    runsAs: 'Runs as',
    version: 'Ghostex on the computer',
    sessions: 'Sessions right now',
  },
  easyConnect: 'Easy Connect',
  tailscale: (address: string) => `Tailscale · ${address}`,
  checking: 'Checking…',
  unavailable: 'Not reachable yet',
  cliNotFound: 'Ghostex CLI not found',
  versionFailed: (exitCode: number) => `ghostex server version exited with code ${exitCode}`,
  sessionsValue: (total: number, working: number) =>
    working > 0 ? `${total} · ${working} working` : `${total}`,
  calloutEasyConnect:
    'The computer needs to be awake and Ghostex open. Ghostex can keep it awake while sessions run: turn on Keep awake in Settings → General on the computer.',
  calloutTailscale:
    'The computer needs to be awake, Ghostex open, and Tailscale connected on both devices. Ghostex can keep it awake while sessions run: turn on Keep awake in Settings → General on the computer.',
  openSessions: 'Open sessions',
  addAnother: 'Add another computer',
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
    title: 'Add your computer',
    body: 'Add the computer that runs Ghostex and its sessions.',
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
    "SSH host key verification failed. Reset this phone's saved host key under Edit machine → Advanced → Host key, or confirm you are connecting to the right computer.",
  permissionDeniedWithPassword:
    'SSH rejected the saved password. Update the saved machine password or choose another machine.',
  permissionDeniedWithoutPassword:
    'SSH needs a key or password. Open the machine settings and save a password, or configure SSH keys/Tailscale SSH.',
  refused:
    'The computer is reachable, but SSH refused the connection. Turn on SSH access on the computer and confirm the saved SSH port.',
  unreachable:
    'Could not reach the computer. Open Tailscale and confirm both devices are online.',
  timedOut:
    "The computer didn't answer. The connection timed out; check that the computer is awake and Ghostex is open.",
  noCli:
    'Connected over SSH, but the computer could not find the Ghostex CLI. Install Ghostex CLI and make sure ghostex is available in the SSH login shell.',
  oldCli:
    'Connected over SSH, but this computer has an older Ghostex CLI. Update Ghostex so ghostex android-check --json is available.',
  outdatedForFeature:
    "This machine's Ghostex is too old for this feature. Update Ghostex on the machine, then try again.",
  persistenceNotZmx:
    'Ghostex is reachable, but Session persistence is not set to zmx. Open Ghostex Settings on the computer and set Session persistence to zmx.',
  zmxMissing:
    'Ghostex is reachable, but ZMX is not available on the computer. Install zmx and set Ghostex session persistence to zmx.',
  emptyOutput: 'Could not connect to the machine.',
  noJson: 'Ghostex CLI did not return JSON.',
  incompleteJson: 'Ghostex CLI returned incomplete JSON.',
} as const;

/** Machine list/editor copy, sessions-drawer.md §4. */
export const MachineCopy = {
  emptyCard: {
    title: 'No computers yet',
    body: 'Add the computer that runs Ghostex and its sessions.',
  },
  editor: {
    addTitle: 'Add a computer',
    editTitle: 'Edit machine',
    body: 'Ghostex connects over SSH, then runs the Ghostex CLI on this computer to list and attach its sessions.',
    passwordBody:
      'Leave the password empty to use SSH keys or Tailscale SSH. If entered without saving, it stays only in memory for this app run.',
    savePasswordCheckbox: 'Save password securely on this device',
    passwordHintNew: 'SSH password (optional)',
    passwordHintEdit: 'SSH password (leave blank to keep saved password)',
  },
  /** "Scan" affordance next to the Easy Connect address field; opens the Scan code screen. */
  scanner: {
    buttonLabel: 'Scan',
    buttonAccessibilityLabel: 'Scan the pairing code shown on the computer',
  },
  validation: {
    port: 'Use a port from 1 to 65535.',
    duplicate: 'This SSH target is already saved.',
    savePasswordWithoutPassword: 'Enter a password or uncheck Save password.',
    general: 'Fix the highlighted machine details.',
    emptyPassword: 'Enter the SSH password.',
    tailcatTokenEmpty: 'Paste the Easy Connect pairing address for this computer.',
    tailcatTokenPrefix: 'An Easy Connect pairing address starts with "tc".',
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
  body: 'This updates the session title in Ghostex on the connected computer.',
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
    `Could not load https://localhost:${port}. The tunnel carries the connection as-is, so check that the server speaks HTTPS on that port.`,
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

/**
 * Sessions machine strip (docs/2026-09-03/mobile-setup/mobile-06-sessions.html):
 * the cloud glyph's states, its long-press menu, and the failed-machine card.
 */
export const StripCopy = {
  connection: {
    busy: 'Connecting',
    connected: 'Connected',
    disconnected: 'Not connected',
    failed: 'Connection failed',
  },
  glyphAction: {
    retry: 'Retry connection',
    connect: 'Connect',
  },
  /** Status line while a glyph / card retry is in flight. */
  retryingStatus: (name: string) => `Retrying ${name}…`,
  addTab: 'Add a computer',
  menu: {
    retry: 'Retry connection',
    edit: 'Edit machine',
    hide: 'Hide from this strip',
    whatCanICheck: 'What can I check?',
    allMachines: 'All machines',
    addProject: 'Add Project',
  },
  failedCard: {
    title: (name: string) => `Can't reach ${name}`,
    retry: 'Retry',
    whatCanICheck: 'What can I check?',
  },
} as const;

/** Machines list (docs/2026-09-03/mobile-setup/mobile-07-machines.html). */
export const MachinesCopy = {
  title: 'Machines',
  badge: {
    connected: 'Connected',
    failed: 'Failed',
    hidden: 'Hidden',
    notConnected: 'Not connected',
  },
  detail: {
    /** "Easy Connect · madda · paired Sep 3". */
    paired: (date: string) => `paired ${date}`,
    hidden: 'not shown in Sessions',
  },
  swipe: {
    edit: 'Edit',
    remove: 'Remove',
    hint: 'Swipe left on a machine to edit or remove it. Tap to open it.',
  },
  remove: {
    title: 'Remove this computer?',
    body: (name: string) =>
      `${name} is removed from this phone, along with its saved password and pairing key. Nothing changes on the computer.`,
    confirm: 'Remove',
  },
  add: {
    sectionLabel: 'Add a computer',
    easyConnect: {
      title: 'Scan a code',
      subtitle: 'Easy Connect. Nothing to type.',
      button: 'Scan code',
    },
    tailscale: {
      title: 'Use Tailscale',
      subtitle: 'Enter address, user, password.',
      button: 'Type details',
    },
  },
} as const;

/**
 * Per-OS "turn on SSH access" instructions, mirroring `SSH_INSTRUCTIONS` in
 * docs/2026-09-03/mobile-setup/shared.js. "Remote Login" appears only inside
 * the macOS path, because that is the name of the switch the user has to find.
 */
export const SshAccessCopy = {
  routeTitle: 'SSH access',
  osLabels: { macos: 'macOS', windows: 'Windows', linux: 'Linux' },
  done: 'Done',
  byOs: {
    macos: {
      title: 'Turn on SSH access on macOS',
      steps: [
        'Open System Settings → General → Sharing.',
        'Turn on Remote Login.',
        'Under Remote Login, make sure your user is allowed access.',
      ],
      note: 'Or let Ghostex do it: on the computer, Settings → Remote → Turn on SSH access. macOS asks for an admin password once.',
    },
    windows: {
      title: 'Turn on SSH access on Windows',
      steps: [
        'Open Settings → System → Optional features → Add a feature.',
        'Install OpenSSH Server.',
        'Open Services, start OpenSSH SSH Server, and set its startup type to Automatic.',
      ],
      note: 'Or let Ghostex do it: on the computer, Settings → Remote → Turn on SSH access. Windows asks for admin approval once.',
    },
    linux: {
      title: 'Turn on SSH access on Linux',
      steps: [
        'Install the OpenSSH server: sudo apt install openssh-server (Debian, Ubuntu) or sudo dnf install openssh-server (Fedora).',
        'Start it and keep it on: sudo systemctl enable --now ssh (or sshd on Fedora).',
      ],
      note: 'Or let Ghostex do it: on the computer, Settings → Remote → Turn on SSH access. It asks for sudo once.',
    },
  },
} as const;

/** The manual Tailscale form (docs/2026-09-03/mobile-setup/mobile-04-tailscale.html). */
export const TailscaleFormCopy = {
  navTitle: 'Tailscale',
  eyebrow: 'Connect your computer',
  title: 'Connect over Tailscale',
  lede: 'Ghostex connects to your computer over SSH through your tailnet.',
  prechecksLabel: 'Before you start',
  precheck: {
    tailscaleOnPhone: 'Tailscale is connected on this phone',
    tailscaleOnPhoneChecking: 'Checking…',
    tailscaleOnPhoneOff: 'Tailscale is not connected on this phone. Open Tailscale and sign in.',
    tailscaleOnPhoneError: (reason: string) => `Could not read Tailscale's state on this phone: ${reason}`,
    tailscaleOnPhoneOn: 'Connected',
    sshAccess: 'SSH access is on, on the computer',
    sshAccessDetail:
      "Ghostex on the computer can turn it on: Settings → Remote → Turn on SSH access. To do it by hand, pick the computer's system:",
  },
  computerLabel: 'Your computer',
  scanInstead: 'Scan the code from the computer instead',
  fields: {
    name: 'Name',
    namePlaceholder: 'My computer',
    nameHint: 'How it shows up in this app.',
    address: 'Address',
    addressPlaceholder: '100.x.y.z or name.tailnet.ts.net',
    addressHint:
      'Ghostex on the computer shows this under Settings → Remote → Tailscale, or copy it from the Tailscale menu.',
    username: 'Username',
    usernamePlaceholder: 'Your username on that computer',
    password: 'Password',
    passwordPlaceholder: 'Your login password',
    passwordPlaceholderEdit: 'Leave blank to keep the saved password',
    passwordHint: "Stored in this phone's secure keystore.",
    pairingAddress: 'Pairing address',
    pairingAddressPlaceholder: 'Paste the Easy Connect pairing address (tc…)',
    pairingAddressHint:
      'Scan the code from Settings → Remote on the computer, or paste the pairing address from Advanced. Addresses are case-sensitive and start with "tc".',
  },
  advanced: {
    title: 'Advanced',
    hintTailscale: 'Port, SSH key, host key',
    hintEasyConnect: "Ports, keys, this phone's key",
    sshPort: 'SSH port',
    sshKey: 'SSH key',
    sshKeyNone: 'Use a key instead of a password. Generated on this phone; you add the public key to the computer.',
    sshKeyNoneEdit: 'None · using password',
    sshKeyPresent: 'ed25519 · generated on this phone',
    generate: 'Generate',
    copyPublicKey: 'Copy public key',
    copied: 'Copied',
    passphrase: 'Key passphrase',
    passphrasePlaceholder: 'Only if the key is encrypted',
    webPreviewPorts: 'Web preview ports',
    webPreviewPortsDetail: 'Ports forwarded for the Browser tab.',
    tailscaleSsh: 'Tailscale SSH',
    tailscaleSshDetail: "Use your tailnet's SSH policy instead of a password or key.",
    hostKey: 'Host key',
    hostKeyNew: 'Not saved yet',
    hostKeyNewDetail: 'Trusted on first connection and pinned after that.',
    hostKeyPinned: 'Pinned on first connection. Reset it if the computer was reinstalled.',
    hostKeyReset: 'Reset',
    hostKeyResetDone: 'Host key cleared. The next connection pins it again.',
    pairingAddress: 'Pairing address',
    copyAddress: 'Copy',
    ghostexPort: 'Ghostex port on the computer',
    ghostexPortDetail: 'Only change if you changed it on the computer too.',
    phoneKey: "This phone's key",
    phoneKeyDetail: 'ed25519 · registered on the computer when you paired. Removing it there unpairs this phone.',
    phoneKeyNone: 'No key on this phone. Re-pair to create one.',
  },
  test: {
    button: 'Test connection',
    testing: 'Testing…',
    success: (name: string, user: string, version: string, sessions: number) =>
      `Reached ${name}. SSH as ${user} works. Ghostex ${version} is installed and has ${sessions} ${sessions === 1 ? 'session' : 'sessions'}.`,
    successNoCli: (name: string, user: string) =>
      `Reached ${name}. SSH as ${user} works, but Ghostex is not installed for this user.`,
  },
  connect: 'Connect',
} as const;

/** Edit machine (docs/2026-09-03/mobile-setup/mobile-08-edit-machine.html). */
export const EditMachineCopy = {
  save: 'Save',
  cancel: 'Cancel',
  connectionLabel: 'Connection',
  connectionTailscaleLabel: 'Connection · Tailscale',
  easyConnect: {
    title: 'Easy Connect',
    /** "Paired as madda · Sep 3 · connected now" */
    pairedAs: (user: string) => `Paired as ${user}`,
    connectedNow: 'connected now',
    notConnected: 'not connected',
    rePair: 'Re-pair',
  },
  showInSessions: 'Show in Sessions',
  showInSessionsDetail: 'Adds a tab to the machine strip.',
  errorPrefix: (name: string) => `Can't reach ${name}. `,
  whatCanICheck: 'What can I check?',
  remove: {
    button: 'Remove this computer from the phone',
    title: 'Remove this computer?',
    body: (name: string) =>
      `Type ${name} to confirm. It is removed from this phone, along with its saved password and pairing key. Nothing changes on the computer.`,
    placeholder: 'Computer name',
    mismatch: 'The name does not match.',
    confirm: 'Remove',
  },
} as const;

/** Can't reach (docs/2026-09-03/mobile-setup/mobile-09-cant-reach.html). */
export const CantReachCopy = {
  eyebrow: 'Connection failed',
  title: (name: string) => `Can't reach ${name}`,
  lastReached: (recency: string) => `Last reached ${recency}.`,
  neverReached: 'Never reached from this phone.',
  checklistLabel: 'Check these, in order',
  verified: 'Verified from this phone',
  easyConnect: {
    awake: {
      title: 'Is the computer awake?',
      detail:
        "A sleeping computer can't answer. Ghostex can keep it awake while sessions run (Keep awake in Settings → General), but a closed lid on battery still sleeps.",
    },
    ghostexOpen: {
      title: 'Is Ghostex open on the computer?',
      detail: 'Easy Connect runs inside Ghostex. If Ghostex quit or updated, reopen it.',
    },
    easyConnectOn: {
      title: 'Is Easy Connect still on?',
      detail:
        'On the computer, open Settings → Remote and check that Easy Connect says Running and SSH access is on.',
    },
    unpaired: {
      title: 'Was this phone unpaired?',
      detail:
        'A phone removed from Paired devices on the computer can no longer connect. Scan a new code to pair it again.',
      button: 'Scan a new code',
    },
  },
  tailscale: {
    tailscaleOnPhone: {
      title: 'Tailscale is connected on this phone',
      detailOn: 'Tailscale is connected on this phone.',
      detailOff: 'Tailscale is not connected on this phone. Open Tailscale and sign in.',
      detailChecking: 'Checking…',
      detailError: (reason: string) => `Could not read Tailscale's state on this phone: ${reason}`,
    },
    tailscaleOnComputer: {
      title: 'Is Tailscale connected on the computer?',
      detail:
        'Open the Tailscale menu on the computer. It should show Connected, with the same account as this phone.',
    },
    awake: {
      title: 'Is the computer awake?',
      detail:
        'A sleeping computer drops off the tailnet. Ghostex can keep it awake while sessions run (Keep awake in Settings → General).',
    },
    address: {
      title: 'Is the address still right?',
      detail:
        'Tailscale IPs rarely change, but a re-added computer gets a new one. The MagicDNS name is safer.',
      button: 'Edit address',
    },
    /** One accordion row per rarer SSH error: a short title, then a cause sentence, a fix sentence and the fix itself. */
    otherReasons: {
      title: 'Other reasons you might see here',
      sshRefused: {
        title: 'SSH refused',
        cause: 'The computer answered but refused the connection, which means SSH access is turned off on it.',
        fix: "Turn SSH access on, then retry. Pick the computer's system for the steps:",
      },
      wrongPassword: {
        title: 'Wrong password',
        cause: 'The computer rejected the password saved on this phone, usually because the account password was changed.',
        fix: 'Enter the current password in Edit machine, then retry.',
        button: 'Edit machine',
      },
      hostKeyChanged: {
        title: 'Host key changed',
        cause:
          "The computer's identity no longer matches the one this phone pinned, which happens after a reinstall or when another computer took over the address.",
        fix: 'If you expected that change, reset the pinned key so the next connection trusts the new one.',
        button: 'Reset host key',
        done: 'Host key cleared. Retry to pin the new one.',
      },
    },
  },
  stillStuck: 'Still stuck? ',
  copyDiagnostics: 'Copy diagnostics and share them in Discord.',
  diagnosticsCopied: 'Diagnostics copied.',
  retry: 'Retry',
} as const;
