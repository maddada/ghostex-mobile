/**
 * The Computers screens' copy: the Machines list, SSH access help, the Tailscale form, the SSH details form, the
 * computer's page, its edit form and Can't reach. Moved from src/copy.ts with the same words, under the same rules.
 */

/** Machines list (docs/2026-09-03/mobile-setup/mobile-07-machines.html). */
export const MachinesCopy = {
  title: 'Machines',
  badge: {
    connected: 'Connected',
    failed: "Can't reach",
    hidden: 'Hidden',
    notConnected: 'Not connected',
  },
  detail: {
    /** "Easy Connect · madda · paired Sep 3". */
    paired: (date: string) => `paired ${date}`,
  },
  swipe: {
    remove: 'Remove',
  },
  /** The card's Update button (its long label is "Update to <version>"). */
  update: 'Update',
  /**
   * The line on the entry kept when older entries for the same computer were hidden or merged
   * (machines/duplicateNotice.ts), shown the first time the list opens after it happened.
   */
  duplicate: {
    hidden: (count: number, computer: string) =>
      count === 1
        ? `An older entry for ${computer} stopped working and is hidden. It goes when the app next opens.`
        : `${count} older entries for ${computer} stopped working and are hidden. They go when the app next opens.`,
    merged: (count: number, computer: string) =>
      count === 1
        ? `An older entry for ${computer} was removed. Its saved data is now here.`
        : `${count} older entries for ${computer} were removed. Their saved data is now here.`,
  },
  remove: {
    title: (name: string) => `Remove ${name}?`,
    /** `asksComputer`: the removal first asks the computer to stop its push notifications. */
    body: (name: string, asksComputer: boolean) =>
      `${name} is removed from this phone, along with its saved password and pairing key. ${asksComputer ? `If ${name} can be reached, it also stops sending push notifications. Nothing else changes on the computer.` : 'Nothing changes on the computer.'}`,
    confirm: 'Remove',
  },
  add: {
    sectionLabel: 'Add a computer',
    easyConnect: {
      title: 'Scan the code',
      subtitle: 'Click Connect a Phone on the computer.',
      button: 'Scan',
    },
    tailscale: {
      title: 'Use Tailscale',
      subtitle: "Type the computer's address and password.",
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

/**
 * Use SSH details (Add a computer's quiet link beside "Other ways to connect"): the computer's address, username and
 * password typed by hand, no code. The phone signs in over SSH itself, like a Tailscale computer, so the form is
 * the Tailscale form without its Tailscale checks.
 *
 * CDXC:RemotePairing 2026-11-16 DECISION:
 * User: "i dont always wanna use the ghostex code". The wording is the desktop's Add a computer dialog's (SSH
 * host, SSH username, SSH password, "Enter a machine name and SSH host first.", the Tailscale code hint), from
 * apps/desktop/src/app/window/settings_modal/tabs/remote/machines.rs and model.rs in the Ghostex repo.
 */
export const SshDetailsFormCopy = {
  navTitle: 'SSH details',
  title: 'Use SSH details',
  lede: 'Enter the other computer’s address and the username and password you sign in with there.',
  fields: {
    host: 'SSH host',
    hostPlaceholder: '100.77.81.4',
    username: 'SSH username',
    usernamePlaceholder: 'machine username',
    usernameHint: 'The account you sign in with on the other computer.',
    password: 'SSH password',
    passwordPlaceholder: 'SSH password',
    passwordHint:
      'Use the password for this username on the other computer. If you already use SSH keys, leave this blank and set the key under Advanced.',
  },
  validation: {
    nameAndHost: 'Enter a machine name and SSH host first.',
    username: 'Enter an SSH username first.',
    tailscaleCode: 'That is a Tailscale code. Use SSH details with its Tailscale name or IP instead.',
    easyConnectCode: 'That is an Easy Connect code. Use Paste a code instead.',
  },
} as const;

/**
 * A computer's page (Machines > a computer): its state and Approvals on top, the devices that can reach it next,
 * and everything else behind four rows, each opening a short page of its own.
 *
 * CDXC:RemotePairing 2026-11-10 DECISION:
 * The user picked the suggested computer page on the pairing page (Q2191): "State, approvals and devices first;
 * the rest behind rows. Nothing to save." Only the row pages that edit something (name, Advanced) have Save.
 */
export const ComputerPageCopy = {
  status: {
    connected: 'Connected',
    failed: "Can't reach it",
    hidden: 'Not shown in Sessions',
    notConnected: 'Not connected',
  },
  easyConnect: 'Easy Connect',
  /** "Easy Connect · Private Relay" (`easyConnectRouteName`). */
  easyConnectRoute: (route: string) => `Easy Connect · ${route}`,
  tailscale: (address: string) => `Tailscale · ${address}`,
  /** A computer added by plain SSH, not through a tailnet (`isTailscaleSshMachine`). */
  ssh: (address: string) => `SSH · ${address}`,
  /** A Tailscale computer that also reaches its computer through Easy Connect (`easyConnectRoute.ts`). */
  routes: {
    label: 'Routes',
    tailscale: 'Tailscale',
    easyConnect: 'Easy Connect',
    tailscaleDetail: (address: string, inUse: boolean) => (inUse ? `${address} · In use` : `${address} · Tried first`),
    easyConnectDetail: (inUse: boolean) => (inUse ? 'In use' : "When Tailscale doesn't answer"),
    /** Easy Connect is off on the computer: this phone can't use it, whatever key it holds. */
    easyConnectOff: (computer: string) =>
      `Off on ${computer}. Turn it on in Ghostex Settings › Remote there to use it.`,
    /** The computer hasn't said yet whether Easy Connect is on there. */
    easyConnectUnknown: 'Not checked yet',
    /** Fall back to Easy Connect is off (or not chosen yet) for this computer. */
    easyConnectNotUsed: 'Not used: Fall back to Easy Connect is off',
  },
  approvals: 'Approvals',
  approvalsNone: 'Nothing is waiting',
  approvalsWaiting: (count: number) => (count === 1 ? '1 request is waiting' : `${count} requests are waiting`),
  approvalsUnknown: (computer: string) => `Requests that wait for you on ${computer}`,
  requirePresenceDetail: (ios: boolean, computer: string) =>
    `On: Approve asks for ${ios ? 'Face ID' : 'your fingerprint'} first here, and for Touch ID or the password on ${computer}. It applies to every device that approves for ${computer}.`,
  moreLabel: 'More',
  rows: {
    name: { easyConnect: 'Name and Sessions tab', tailscale: 'Name, address and password' },
    shown: 'shown in Sessions',
    hidden: 'not shown in Sessions',
    updates: 'Ghostex updates',
    updatesReading: 'Reading the version…',
    updatesUnknown: 'Connect to see the version',
    updatesByItself: 'updates by itself',
    tools: 'Agents, skills and tools',
    toolsUpdates: (count: number) => (count === 1 ? '1 update' : `${count} updates`),
    toolsNone: 'What is installed there',
    advanced: 'Advanced',
    advancedEasyConnect: 'Ports, keys, test the connection, pair again',
    advancedTailscale: 'Port, SSH key, host key, test the connection',
  },
  /** Titles of the row pages (MachineForm with a `section`). */
  sectionTitles: {
    name: 'Name and Sessions tab',
    nameTailscale: 'Name, address and password',
    updates: 'Ghostex updates',
    tools: 'Agents, skills and tools',
    advanced: 'Advanced',
  },
  pairAgain: 'Pair again',
} as const;

/** Edit machine (docs/2026-09-03/mobile-setup/mobile-08-edit-machine.html). */
export const EditMachineCopy = {
  save: 'Save',
  cancel: 'Cancel',
  connectionLabel: 'Connection',
  connectionTailscaleLabel: 'Connection · Tailscale',
  /** Pairing v2 (GitHub #495): what this computer has paired, with one-tap Remove. */
  pairedDevices: {
    title: (computer: string) => `Devices that can reach ${computer}`,
    /** The plain question, as the computer's own card asks it (`security/plainAsk.ts`). */
    waiting: (name: string, phone: boolean, computer: string) =>
      phone ? `Add ${name} to ${computer}?` : `Let ${name} connect to ${computer}?`,
    waitingDetail: (name: string, phone: boolean) =>
      phone
        ? 'Approve only if your phone shows the same words. Deny it if you aren’t adding one right now.'
        : `Approve only if ${name} shows the same words. Deny it if you aren’t connecting it right now.`,
    deny: 'Deny',
    approve: 'Approve',
    approveFailed: 'Not approved',
    noLongerWaiting: 'This request is no longer waiting.',
    remove: 'Remove',
    cancel: 'Cancel',
    thisPhone: (name: string) => `This phone (${name})`,
    legacy: 'Paired before Ghostex 11.1.0, so it no longer connects. Pair it again, or remove it.',
    removeTitle: (name: string) => `Remove ${name}?`,
    removeDetail: (computer: string) =>
      `It loses its access to ${computer} at once: its sign-in key and its Ghostex token are removed.`,
    removeSelfDetail: (computer: string) =>
      `This phone loses its access to ${computer} at once. To use it again, show a code on ${computer} and pair again.`,
    removeFailed: "Couldn't remove the device",
  },
  /** Paired computers: the server links a computer keeps (ServerLinksSection.tsx, the desktop's words). */
  serverLinks: {
    title: 'Paired computers',
    footer: (computer: string) =>
      `Computers linked with ${computer} as servers: their agents and ${computer}'s reach each other with no app open.`,
    waiting: (name: string, words: string) => `Waiting for approval on ${name}. Words: ${words}`,
    ended: (why: string | null) => `Not linked: ${why ?? 'it ended.'}`,
    accessOff: 'Agent access is off: neither computer’s agents use the other.',
    bothWays: 'Linked both ways: the agents on each can use the other.',
    oneWay: 'Linked one way so far: waiting for it to link back.',
    incomingOnly: (computer: string) => `Its agents can use ${computer}; it isn’t linked back yet.`,
    notLinked: 'Not linked.',
    accessLabel: (name: string) => `Agent access with ${name}`,
    accessFailed: "Couldn't change Agent access",
    remove: 'Remove',
    cancel: 'Cancel',
    removeTitle: (name: string) => `Remove ${name}?`,
    removeDetail: (name: string, computer: string) =>
      `This ends the link on both computers: agents on ${name} and ${computer} can no longer use each other.`,
    removeFailed: "Couldn't remove the link",
  },
  easyConnect: {
    title: 'Easy Connect',
    /** "Paired as madda · Sep 3 · connected now" */
    pairedAs: (user: string) => `Paired as ${user}`,
    connectedNow: 'connected now',
    notConnected: 'not connected',
    rePair: 'Re-pair',
  },
  showInSessions: 'Show in Sessions',
  showInSessionsDetail: (computer: string) => `Shows ${computer}'s tab at the top of Sessions.`,
  /** The computer's Ghostex row; the status wording lives in src/machines/appUpdate.ts with the desktop's. */
  appUpdate: {
    label: 'Ghostex',
    reading: 'Reading the Ghostex version…',
    copyCommand: 'Copy command',
    copied: 'Copied',
    releasePage: 'Release page',
    runInTerminal: 'Run in terminal',
    runInTerminalFailed: 'Could not open a terminal',
    autoUpdate: 'Keep this machine up to date',
    autoUpdateDetail:
      'Installs Ghostex updates on that computer by itself while none of its agents is working. Sessions keep running through the restart.',
  },
  /** Agent CLIs and Skills and tools of the computer; row wording lives in src/machines/machineToolsView.ts. */
  machineTools: {
    agentsLabel: 'Agent CLIs',
    toolsLabel: 'Skills and tools',
    /** Beside a failed install (the same button as the Ghostex row's). */
    runInTerminal: 'Run in terminal',
    runInTerminalFailed: 'Could not open a terminal',
    reading: 'Reading what is installed there…',
    notConnected: (computer: string) => `Connect to ${computer} to see and update its agent CLIs, skills and tools.`,
    retry: 'Read again',
    skills: 'Skills',
    desktopControl: 'Desktop control',
    tools: 'Tools',
    ghostexCli: 'Ghostex CLI',
    cliFound: (path: string) => `New terminals there run ${path}`,
    cliMissing: "New terminals there don't find a ghostex command",
    /** The computer's ~/.local/bin is off PATH and Repair can add the line (gxserver `ghostexCli.pathFix`). */
    cliOffPath: (files: string) =>
      `~/.local/bin isn't on PATH there, so new terminals don't find ghostex. Repair adds it to ${files}.`,
    repair: 'Repair',
    cliPathAdded: (files: string) => `Added ~/.local/bin to PATH in ${files}. New terminals there will find ghostex.`,
    cliPathAlready: (files: string) => `${files} already adds ~/.local/bin to PATH. Open a new terminal there.`,
  },
  errorPrefix: (name: string) => `Can't reach ${name}. `,
  whatCanICheck: 'What can I check?',
  remove: {
    button: (name: string) => `Remove ${name} from the phone`,
    title: (name: string) => `Remove ${name}?`,
    /** `asksComputer`: the removal first asks the computer to stop its push notifications. */
    body: (name: string, asksComputer: boolean) =>
      `${name} is removed from this phone, along with its saved password and pairing key. ${asksComputer ? `If ${name} can be reached, it also stops sending push notifications. Nothing else changes on the computer.` : 'Nothing changes on the computer.'}`,
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
      detail: 'On the computer, open Settings → Remote and check that Easy Connect says Running and SSH access is on.',
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
      detail: 'Open the Tailscale menu on the computer. It should show Connected, with the same account as this phone.',
    },
    awake: {
      title: 'Is the computer awake?',
      detail:
        'A sleeping computer drops off the tailnet. Ghostex can keep it awake while sessions run (Keep awake in Settings → General).',
    },
    address: {
      title: 'Is the address still right?',
      detail: 'Tailscale IPs rarely change, but a re-added computer gets a new one. The MagicDNS name is safer.',
      button: 'Edit address',
    },
    /** A computer reached by plain SSH, not through a tailnet: the awake and address lines without Tailscale. */
    plainSsh: {
      awake: {
        title: 'Is the computer awake?',
        detail:
          "A sleeping computer can't answer. Ghostex can keep it awake while sessions run (Keep awake in Settings → General).",
      },
      address: {
        title: 'Is the address still right?',
        detail:
          'A router can give the computer a new IP after a restart. Check its address there, and that this phone is on a network that reaches it.',
        button: 'Edit address',
      },
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
        cause:
          'The computer rejected the password saved on this phone, usually because the account password was changed.',
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
