/**
 * Centralized user-facing copy quoted verbatim from the specs:
 * - docs/specs/sessions-drawer.md (§§2,4,5,6)
 * - docs/specs/onboarding.md (§1)
 * Keep these strings exactly as specified; screens must import from here.
 *
 * CDXC:Copy 2026-09-03:
 * User decision: Ghostex-owned user-facing copy in the desktop, web, and mobile apps uses no em dashes; use punctuation that preserves the sentence's natural reading instead.
 */

/** The first screen, shown while no computer is saved: the app's name over the connect steps. */
export const WelcomeCopy = {
  headline: 'Ghostex',
  subheadline: 'Your agents, from your pocket.',
} as const;

/**
 * The connect steps, the first screen's and Add a computer's: what to do on each device, in the words the
 * computer's own menu uses, then one button that opens the scanner.
 *
 * CDXC:RemotePairing 2026-11-10 DECISION:
 * The user picked the suggested first screen of the pairing page (Q2181) with "add 1 more item there please and i
 * like having icons like in the old one", and the suggested chooser without the demo (Q2182, "remove try a demo
 * computer from here pls"): three steps with icons (getting Ghostex on the computer is the third, since nothing
 * else on the screen works without it), Scan the code as the one button, and Paste a code and Use Tailscale as a
 * sheet behind "Other ways to connect". The demo stays a small link on the first screen only, where App Review
 * finds it.
 */
export const ConnectStartCopy = {
  /** The title of the Add a computer screen (the sessions screen's + and its menu). */
  addTitle: 'Add a computer',
  steps: [
    {
      key: 'install',
      title: 'Get Ghostex on your computer',
      lead: 'Free at ',
      link: 'ghostex.dev',
      tail: '. Skip this if it is already there.',
    },
    {
      key: 'computer',
      title: 'On your computer',
      lead: 'Open the Ghostex menu and click Connect a Device.',
      link: '',
      tail: '',
    },
    {
      key: 'phone',
      title: 'On this phone',
      lead: 'Scan the code it shows.',
      link: '',
      tail: '',
    },
  ],
  installUrl: 'https://ghostex.dev',
  scanButton: 'Scan the code',
  otherWays: 'Other ways to connect',
  otherWaysSheet: {
    title: 'Other ways to connect',
    paste: { title: 'Paste a code', detail: "When the camera can't scan it." },
    tailscale: { title: 'Use Tailscale', detail: "Type the computer's address and password." },
  },
} as const;

/**
 * Scan the code: one scanner for both code kinds, laid out as two steps with the camera as step 2.
 *
 * CDXC:RemotePairing 2026-11-10 DECISION:
 * The user picked take C of the scan screen page (Q2208, "Two steps, the camera is step 2"): the first screen's
 * two numbered items with icons, the camera inside step 2, Paste a code as a real second way, and "It won't scan"
 * opening its sheet. Android keeps its live camera there; an iPhone keeps Apple's scanner for now and shows the
 * still "Open the scanner" tile in the camera's place, until an in-app camera that can focus close up has been
 * tried on a real iPhone. The light is offered only where the in-app camera runs.
 */
export const ScanCopy = {
  title: 'Scan the code',
  steps: {
    computer: { title: '1. On your computer', detail: 'Open the Ghostex menu and click Connect a Device.' },
    phone: { title: '2. On this phone', detail: 'Point the camera at the code it shows.' },
  },
  stillTile: 'The camera opens over this screen.',
  cameraOff: 'The camera is off for Ghostex.',
  pasteButton: 'Paste a code instead',
  openScanner: 'Open the scanner',
  lightOn: 'Turn on the light',
  lightOff: 'Turn off the light',
  wontScan: "It won't scan",
  wontScanSheet: {
    title: "It won't scan",
    hold: { title: 'Hold the phone a hand away from the screen', detail: 'Too close and the camera cannot focus.' },
    brightness: {
      title: "Turn up the computer's brightness",
      detail: 'A dim screen is hard to read.',
      detailWithLight: 'Or tap the light on this phone.',
    },
    stillNothing: {
      title: 'Still nothing?',
      detail: 'On the computer, click the Copy button under the code, send the text to this phone and paste it.',
    },
    olderComputer:
      "No Connect a Device in the computer's menu? On Ghostex 11.3 it is called Connect a phone; on 11.2 or earlier, click Mobile & Remote, then Connect.",
    paste: 'Paste a code',
  },
  found: (computer: string) => `Found ${computer}`,
  connecting: 'Connecting…',
  tailscaleFound: (user: string, address: string) => `Tailscale code · ${user}@${address}`,
  rejected: {
    title: "That's not a Ghostex code",
    detail: "Point at the code in the computer's Connect a Device window.",
  },
  outdated: {
    title: 'This code needs a newer Ghostex app',
    detail: 'Update Ghostex on this phone, or click Copy Easy Connect code on the computer and paste the code here.',
  },
  cameraDenied: 'Camera access is off for Ghostex, so paste the code instead.',
  cameraDeniedSettingsLink: 'Allow the camera in Settings',
  paste: {
    title: 'Paste an Easy Connect code',
    ledePrefix: 'On the computer, open Settings → Remote → Easy Connect, click Show QR, then ',
    ledeStrong: 'Copy Easy Connect code',
    ledeSuffix: ', and send the text to this phone.',
    placeholder: 'ghostex-ec1:…',
    validEasyConnect: (user: string, computer: string) => `Looks like an Easy Connect code for ${user} on ${computer}`,
    validTailscale: (user: string, computer: string) =>
      `Looks like a Ghostex Tailscale code for ${user} on ${computer}`,
    validLegacy: 'Looks like a pairing address. You will be asked for the computer name and user next.',
    invalid: "That doesn't look like a Ghostex code.",
    outdated: 'This code is from a newer Ghostex. Update Ghostex on this phone to pair with it.',
    button: 'Pair',
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

/**
 * After a code is scanned: the screen that waits for Approve on the computer, and the screen a failed pairing
 * stays on until the person acts. Each failure names what really happened, in the computer's own words for the
 * way back ("Connect a Device").
 */
export const PairingCopy = {
  checkTitle: 'Check your computer',
  checkLede: (computer: string) => `${computer} shows three words. If they are the same as these, click Approve there.`,
  waiting: 'Waiting for Approve on the computer…',
  minutesLeft: (minutes: number) => (minutes <= 1 ? 'Less than a minute left' : `${minutes} minutes left`),
  showsNothing: 'The computer shows nothing',
  cancel: 'Cancel',
  showsNothingSheet: {
    title: 'The computer shows nothing?',
    steps: [
      {
        title: 'Look for the words on the computer',
        detail:
          'They show in its Connect a Device window, or in a window called "Approve this phone?". It can take a few seconds.',
      },
      {
        title: 'Open Settings > Remote there',
        detail: 'A phone that waits for approval is listed there, with its words and Approve.',
      },
      {
        title: 'Still nothing? Start again',
        detail: 'Tap Cancel, click Connect a Device on the computer again, and scan the new code.',
      },
    ],
  },
  scanAgain: 'Scan again',
  pasteInstead: 'Paste a code instead',
  details: 'Details',
  hideDetails: 'Hide details',
  backToComputer: 'On the computer, click Connect a Device again, then scan the new code.',
  failure: {
    timedOut: {
      title: 'Nobody approved this phone in time',
      body: (computer: string, minutes: number | null) =>
        `${minutes !== null && minutes > 0 ? `${computer} waited ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.` : `${computer} stopped waiting.`} On the computer, click Connect a Device again, then scan the new code.`,
    },
    dropped: {
      title: 'The computer stopped waiting',
      body: (computer: string) =>
        `${computer} let go of this phone's request before anyone approved it, for example because Ghostex there restarted. Click Connect a Device there again, then scan the new code.`,
    },
    expired: {
      title: 'That code is used up',
      body: 'A code works once, for 5 minutes. On the computer, click Connect a Device again, then scan the new code.',
    },
    denied: {
      title: 'The computer said no',
      body: (computer: string) =>
        `This phone was turned away on ${computer}. If that was a mistake, click Connect a Device there again and scan the new code.`,
    },
    noSecret: {
      title: 'That code is not complete',
      body: 'It was copied while the Connect a Device window was closed. Open that window on the computer and scan the code it shows.',
    },
    wordsMismatch: {
      title: 'The words did not match',
      body: 'So pairing stopped, to keep this phone safe. On the computer, click Connect a Device again, then scan the new code.',
    },
    needsUpdate: { title: 'Update Ghostex on this phone' },
    computerTooOld: { title: 'Update Ghostex on the computer' },
    unreachable: {
      title: (computer: string) => `Can't reach ${computer}`,
      body: 'Keep Ghostex open on the computer and check that both have internet, then scan again.',
    },
    rejected: { title: (computer: string) => `Couldn't pair with ${computer}` },
  },
  /** The line on top of Sessions once a new computer answers: pairing ends in the sessions list. */
  connected: (computer: string) => `Connected to ${computer}`,
  connectedSessions: (total: number, working: number) =>
    `${total} ${total === 1 ? 'session' : 'sessions'}${working > 0 ? `, ${working} working` : ''}`,
  dismiss: 'Dismiss',
} as const;

export const SessionCopy = {
  /** Row/menu title fallback when a session has no display title. */
  fallbackTitle: 'Ghostex Session',
  /** A worktree session's branch, as its badge reads to a screen reader (the Project list's row, a Session Wall tile). */
  inWorktree: (branch: string) => `In worktree ${branch}`,
  /** A Unified card's third line for a session whose folder is not under git. */
  noSourceControl: 'Untracked',
  /** A Unified card's third line while its branch is not known and none was seen before. */
  noBranch: 'No branch',
  /** A Claude cloud session row's leading orange cloud, for screen readers. */
  claudeCloud: "Runs in Claude's cloud",
  /** Tapping a cloud row when the phone could not open its claude.ai page. */
  claudeCloudOpenFailed: "Couldn't open Claude's page for this session",
  /** Close confirm body for an awake cloud row, which Close puts to sleep ("Keep it listed, asleep"). */
  claudeCloudCloseSleeps:
    'This puts the session to sleep on the connected machine. It keeps running on claude.ai, so its row stays listed.',
  /** Desktop parity: project cards say exactly "No sessions". */
  /** The row an open project with no sessions shows; a tap opens a terminal there (desktop rows.rs "New Session"). */
  emptyProjectRow: 'New Session',
  olderThreads: (count: number) => (count === 1 ? '1 older thread' : `${count} older threads`),
  hideOlderThreads: 'Hide older threads',
  /** Desktop reference sidebar section label. */
  projectsSectionTitle: 'Projects',
  /**
   * Desktop in-project kind disclosures (session-group-section.tsx renders
   * these as Browser / Pinned / Sessions above the first row of each kind).
   */
  browserKindLabel: 'Browser',
  pinnedKindLabel: 'Pinned',
  draftsKindLabel: 'Drafts',
  parkedKindLabel: 'Parked',
  workingKindLabel: 'Working',
  snoozedKindLabel: 'Snoozed',
  sessionsKindLabel: 'Sessions',
  unknownRecency: 'Unknown',
  attachCommandCopied: 'Attach command copied',
} as const;

/**
 * The session wall: the Sessions list's list/tiles switch on the unfolded iPhone Duo and its tiles (the session wall
 * design's words). A badge says in a word what the row's dot says by colour; waiting for approval, which
 * the design predates, takes the agents pane's words.
 */
export const WallCopy = {
  showList: 'Show as list',
  showTiles: 'Show as tiles',
  badge: {
    approval: 'Waiting for approval',
    question: 'Has a question',
    failed: 'Failed',
    working: 'Working',
    attention: 'Waiting',
    backgroundWork: 'Background work',
  },
  /** The thumbnail of a session whose screen the computer could not read. */
  previewUnavailable: 'No preview',
  /**
   * A tile for VoiceOver: its title, then its badge word or the row's time label when it has one, then the worktree
   * its session runs in when its row names one.
   */
  tile: (title: string, status: string | null, worktree?: string) =>
    [title, status, worktree === undefined ? null : SessionCopy.inWorktree(worktree)]
      .filter((part) => part !== null)
      .join(', '),
} as const;

/**
 * The folded triage: the waiting sessions above the Sessions list on the iPhone Duo's outer display (the triage
 * design's words). Allow and Deny are the chat's approval card's labels.
 */
export const TriageCopy = {
  /** The section for VoiceOver. */
  section: 'Waiting for you',
  heading: (count: number) => `Waiting for you · ${count}`,
  /** The quiet row when nothing waits. */
  nothingWaiting: 'Nothing is waiting for you',
  /** A card's head, which opens the session: its title and, when known, how long it has waited. */
  open: (title: string, waited: string | null) =>
    waited === null ? `Open ${title}` : `Open ${title}, waiting ${waited}`,
  deny: 'Deny',
  allow: 'Allow',
  sending: 'Sending…',
  /** An approval the chat does not show (the agent asks on its screen only). */
  approvalInSession: 'Answer it in the session.',
  answers: 'Answers',
  /** The header of the first of several questions in a row. */
  stepHeader: (header: string, steps: number) => (header.length > 0 ? `${header} · 1 of ${steps}` : `1 of ${steps}`),
  openQuestion: 'Open Question',
  hint: {
    multiSelect: 'You can pick several options. Choose them in the session.',
    steps: (steps: number) => `${steps} questions in a row. Answer them in the session.`,
    text: 'Needs a written answer.',
  },
  lastOutput: 'Last output',
  shortReplies: 'Short replies',
  /** The message after an answer went out: what, and to which session. */
  sent: (label: string) => `Sent “${label}”`,
  answered: (label: string) => `Answered “${label}”`,
  sessionLine: (title: string, project: string) => (project.length > 0 ? `${title} · ${project}` : title),
  notSent: 'Not sent',
} as const;

/** Settings › Short Replies: the replies the folded triage offers on a waiting session. */
export const ShortRepliesCopy = {
  pageTitle: 'Short Replies',
  pageDescription: 'Quick answers for waiting agents when folded.',
  intro: 'Shown on a waiting session when the phone is folded. A tap sends the text to that session.',
  entry: (position: number) => `Short reply ${position}`,
  remove: (text: string) => `Remove “${text}”`,
  add: 'Add Reply',
  footer: 'Replies appear on the cards in this order. Empty entries are not kept.',
} as const;

/** The floating context menu (`ContextMenu.tsx`). */
export const ContextMenuCopy = {
  /** The dimmed screen around the menu, as VoiceOver names it: a tap on it closes the menu. */
  close: 'Close menu',
} as const;

/** Session search (the Sessions header's search button), worded as the desktop's Sessions search. */
export const SessionSearchCopy = {
  buttonLabel: 'Search sessions',
  placeholder: 'Search sessions...',
  close: 'Close search',
  clear: 'Clear search',
  noMatches: 'No sessions match that search.',
  noSessions: 'No sessions yet.',
  unknownDay: 'Unknown day',
  closedLabel: 'closed',
  loadingClosed: 'Loading closed sessions...',
  closedUnavailable: (computers: string) => `Closed sessions could not be loaded from ${computers}.`,
  restoring: 'Restoring...',
  restoreFailed: (reason: string) => `Could not restore this session. ${reason}`,
  notRestorable: 'This session can no longer be restored.',
} as const;

/** Find Prompts (the GUI for `gx f`) and the prompt screen it opens. */
export const FindPromptsCopy = {
  title: 'Find Prompts',
  promptTitle: 'Prompt',
  placeholder: 'Search every prompt you have sent',
  clear: 'Clear search',
  allAgents: 'All agents',
  allProjects: 'All projects',
  agentsTitle: 'Filter by agent',
  projectsTitle: 'Filter by project',
  projectsPlaceholder: 'Filter projects...',
  noProjects: 'No projects found.',
  groupByDay: 'Days',
  groupByDayOn: 'Stop grouping results by day',
  groupByDayOff: 'Group results by day',
  noHistory: 'No agent prompt history was found on this computer.',
  noMatches: 'No prompts match this search.',
  searchFailed: 'Pull down to try again.',
  noProject: 'No project',
  favorite: 'Favorite this prompt',
  unfavorite: 'Remove this prompt from favorites',
  resume: 'Resume',
  fork: 'Fork',
  forkTitle: 'Fork prompt into',
  copy: 'Copy',
  star: 'Star',
  starred: 'Starred',
  copied: 'Prompt copied to the clipboard.',
  copyFailed: 'Could not copy.',
  resumeFailed: 'Could not resume.',
  forkFailed: 'Could not fork.',
  gone: 'This prompt is no longer in the results. Go back and search again.',
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
    body: (label: string) => `Opening SSH to ${label} and loading its Ghostex sessions.`,
    actionHint: 'Keep Tailscale online on both devices.',
  },
  failure: {
    title: 'Connection needs attention',
    fallbackBody: 'Could not connect to the selected machine.',
    actionHint: 'Use Retry, Tailscale, Setup, or switch machines above.',
  },
  empty: {
    title: 'No sessions yet',
    body: 'The computer is connected and has no active sessions.',
    actionHint: 'Start or resume sessions in Ghostex on the remote machine, then tap Retry.',
  },
  /** Active projects with nothing in it (src/spaces/activeProjects.ts). */
  activeProjectsEmpty: {
    title: 'Nothing active right now',
    body: 'A project shows here while an agent works or waits in it, and for 8 hours after you last used it.',
  },
} as const;

/** The names of the path an Easy Connect link is on (`easyConnectRouteName` in machines/easyConnectPathModel.ts). */
export const RouteNameCopy = {
  privateRelay: 'Private Relay',
  globalRelay: 'Global Relay',
  direct: 'Direct',
  sameNetwork: 'Same network',
} as const;

/** The Connections sheet (src/components/sessions/ConnectionsSheet.tsx) and the Sessions screen's computer icons. */
export const ConnectionsCopy = {
  title: 'Connections',
  summary: (counts: { failed: number; slow: number; fine: number }) =>
    [
      counts.failed > 0 ? `${counts.failed} can't connect` : null,
      counts.slow > 0 ? `${counts.slow} slow` : null,
      counts.fine > 0 ? `${counts.fine} fine` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(', '),
  status: {
    failed: "Can't connect",
    slow: 'Slow',
    connecting: 'Connecting…',
    connected: 'Connected',
    notConnected: 'Not connected',
  },
  tailscaleOff: 'Tailscale is off on this phone.',
  tailscaleOffFix: 'Turn it on in the Tailscale app, then come back. Ghostex reconnects by itself.',
  slowRoundTrip: (ms: number) => `Each round trip takes about ${ms} ms.`,
  slowDrops: (count: number) => `Its connection dropped ${count} times in the last 5 minutes.`,
  slowHint: 'If it stays slow, send the logs so the developer can see why.',
  openTailscale: 'Open Tailscale',
  retry: 'Retry',
  resetConnection: 'Reset connection',
  remoteSettings: 'Remote Settings',
  sendLogs: 'Send logs',
  logs: 'Logs',
  connectionSettings: 'Connection settings',
  easyConnect: 'Easy Connect',
  tailscale: 'Tailscale',
  demo: 'Sample, on this phone',
  roundTrip: (ms: number) => `${ms} ms`,
  /** A computer icon's VoiceOver label. */
  iconLabel: (name: string, status: string) => `${name}, ${status}`,
  iconHint: 'Shows every computer\'s connection',
  /** Settings › Connection. */
  computers: 'Computers',
  noComputers: 'No computers yet.',
  troubleshooting: 'Troubleshooting',
} as const;

/** The Logs sheet (src/components/common/LogsSheet.tsx). */
export const LogsCopy = {
  export: 'Export',
  exporting: 'Exporting…',
  exportFailed: "Couldn't export",
  subtitleNewest: (shown: number, total: number) =>
    `The newest ${shown} of ${total} events on this phone. Copy, Export and Send take them all.`,
} as const;

/** Logs › Send to developer (src/components/common/SendLogsReview.tsx, src/feedback/logReport.ts). */
export const SendLogsCopy = {
  button: 'Send to developer',
  title: 'Send these logs?',
  lede: 'They go to the Ghostex developer as a bug report. Check what is in them first; nothing is sent until you press Send.',
  public:
    'The report becomes a GitHub issue in the public Ghostex repository (github.com/maddada/Ghostex), where anyone can read it.',
  included: {
    events: "This phone's connection and status events",
    device: 'The app version and the phone system (such as iOS 27)',
    routes: 'Routes and timings: relays, round trips, drops',
  },
  lines: (count: number) => `(${count} ${count === 1 ? 'line' : 'lines'})`,
  replaced: 'IP addresses, user names, computer names, host names and keys',
  replacedDetail: '(replaced with placeholders)',
  never: 'Your sessions, chats, prompts and terminal text',
  neverDetail: '(never included)',
  notePlaceholder: 'What went wrong? (optional)',
  usernamePlaceholder: 'Your GitHub username, to hear back (optional)',
  badUsername: 'That is not a GitHub username.',
  showText: 'See the exact text that will be sent',
  hideText: 'Hide the exact text',
  cancel: 'Cancel',
  send: 'Send',
  sent: (issue: number) => `Sent as issue #${issue}`,
  sentDetail: 'Thanks. The developer reads every report.',
  openIssue: 'Open issue',
  done: 'Done',
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
    'Could not reach the computer. Confirm both devices are online and the computer is awake. For a Tailscale connection, check Tailscale on both devices.',
  timedOut:
    "The computer didn't answer. The connection timed out; check that the computer is awake and Ghostex is open.",
  /** The SSH socket closed under a running command (libssh2's socket errors, "Exec read failed: -43"). */
  connectionDropped:
    'The connection to the computer dropped. Ghostex reconnects by itself; if it keeps dropping, check that the computer is awake and on the network.',
  /** The computer refused a new channel on a working connection, or the phone's own slots were full. */
  channelsBusy:
    "Ghostex is busy on the computer and tries again by itself. If it stays busy, Reset connection frees it up; programs running in terminals that aren't agents end, and those terminals need opening again.",
  /** The sessions list's line while Ghostex on the computer starts; the store sets it there. */
  ghostexNotAnswering: "They'll appear in a moment.",
  /** Any other action that failed because Ghostex on the computer didn't answer. */
  ghostexNotRunning: "Ghostex on the computer isn't answering yet. Open it there, or try again in a moment.",
  /** An action the computer refused for a reason the phone doesn't recognise; the raw text goes to the app log. */
  computerRefused:
    "Ghostex on the computer couldn't do that. Try again; if it keeps failing, check Ghostex on the computer.",
  /** The same failure after about 30 s, the sidebar's and the chat's long-wait line. */
  ghostexNotAnsweringLong: 'Sessions are taking longer than usual to load. If this keeps happening, restart Ghostex.',
  noCli:
    'Connected over SSH, but the computer could not find the Ghostex CLI. Install Ghostex CLI and make sure ghostex is available in the SSH login shell.',
  oldCli:
    'Connected over SSH, but this computer has an older Ghostex CLI. Update Ghostex so ghostex android-check --json is available.',
  outdatedForFeature:
    "This machine's Ghostex is too old for this feature. Update Ghostex on the machine, then try again.",
  persistenceNotZmx:
    'One setting on the computer needs changing: open Ghostex Settings there and turn on keeping terminals running in the background.',
  zmxMissing: 'Part of Ghostex is missing on the computer. Reinstall Ghostex there, then try again.',
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
    buttonAccessibilityLabel: 'Scan the Easy Connect code shown on the computer',
  },
  validation: {
    port: 'Use a port from 1 to 65535.',
    duplicate: 'This SSH target is already saved.',
    duplicateComputer: (name: string) => `This computer is already saved as ${name}. Edit that one instead.`,
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
  startingAgent: (agent: string, project: string) => `Starting ${agent} in ${project}…`,
  startingCoordinator: (project: string) => `Starting a coordinator in ${project}…`,
  noStableProjectId: 'This project has no stable project id, so agent sessions cannot be started here.',
  openedInBrowser: (name: string) => `Opened ${name} in the browser.`,
  restoringProject: (title: string) => `Restoring ${title}...`,
  restoredProject: (title: string) => `Restored ${title}.`,
} as const;

/**
 * The Sessions header's New session button (screens/sessions-screen/new-session-button.tsx): its
 * project sheet and what it says when it cannot start, as card wording (a short title, then what
 * happened and what to do).
 */
export const NewSessionCopy = {
  button: 'New session',
  sheetTitle: 'New session',
  offlineTitle: 'Computer not connected',
  offline: (computer: string) => `${computer} isn't connected. Reconnect it, then try again.`,
  unreachable: (computers: readonly string[]) =>
    computers.length === 1
      ? `Can't reach ${computers[0]}. Reconnect it, then try again.`
      : "Can't reach your computers. Reconnect them, then try again.",
  noAgentsTitle: 'No agents turned on',
  noAgents: (computer: string) => `Turn on an agent in Settings > Agents on ${computer}, then try again.`,
  noProjectIdTitle: "Can't start here",
  noProjectId: "This folder isn't a project yet. Add it as a project on the computer, then try again.",
  goneTitle: 'Project not found',
  gone: (computer: string) => `This project is no longer on ${computer}. Pick another one.`,
  loadingTitle: 'Still loading',
  loading: 'Your computers are still loading. Try again in a moment.',
  loadingOne: (computer: string) => `${computer} is still loading. Try again in a moment.`,
  unopenedTitle: "Couldn't open it",
  unopened: "The computer didn't say what it started. Look for it in the list.",
} as const;

/** The project header's Actions… list and the hint shown when an action cannot start. */
export const ActionCopy = {
  /** Section names of the desktop's Actions settings. */
  projectHeading: 'Project Actions',
  globalHeading: 'Global Actions',
  startFailedTitle: (name: string) => `Couldn't start ${name}`,
  /** A Global Action tapped after the computer's latest summary stopped offering them. */
  globalActionsUnavailable: 'Global Actions are no longer available on this computer.',
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
  manualSection: 'Address',
  manualPlaceholder: 'localhost:3000 or website address',
  manualHint: 'Enter a website address or a port on your computer, such as 3000.',
  openButton: 'Open',
  invalidAddress: 'Enter an HTTP or HTTPS address, or a port from 1 to 65535.',
  listeningSection: 'Pages & ports',
  listeningLoading: 'Asking the computer which ports are listening…',
  listeningEmpty: 'Nothing is listening on the computer right now.',
  refreshButton: 'Refresh',
  /** Row title: exactly what the same page would be at on the computer. */
  portRowTitle: (port: number) => `localhost:${port}`,
  portRowUnknownCommand: 'Unknown process',
  listeningFailedTitle: 'Could not list the computer’s ports',
  listeningFailedHint: 'Enter an address or port above to open it anyway.',
  oldCli:
    'The computer’s ghostex CLI is too old to list ports. Update Ghostex on the computer, or enter a port manually.',
  machineMissing: 'This machine is no longer saved on this device.',
  connecting: (port: number) => `Forwarding localhost:${port} from the computer…`,
  loadingAddress: (url: string) => `Loading ${url}…`,
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
  desktopSiteLabel: 'Desktop site',
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
  /** The tab glyph's press: the Connections sheet (src/components/sessions/ConnectionsSheet.tsx). */
  glyphAction: 'Show connection',
  /** Status line while a glyph / card retry is in flight. */
  retryingStatus: (name: string) => `Retrying ${name}…`,
  addTab: 'Add a computer',
  menu: {
    retry: 'Retry connection',
    edit: 'Edit machine',
    hide: 'Hide from this strip',
    whatCanICheck: 'What can I check?',
    moveLeft: 'Move left',
    moveRight: 'Move right',
    allMachines: 'All machines',
    addProject: 'Add Project',
  },
} as const;

/**
 * The Sessions screen's one line about a computer that is not connected, in the status row above the
 * search row (src/components/sessions/machineNotice.ts holds the rule). Short enough to read whole on
 * a phone; a tap opens the full reason with Retry. The wording follows gx-core's `machine_state_copy`
 * (packages/gx-core/src/sidebar_view/machine_connection.rs), with the computer named.
 */
export const MachineNoticeCopy = {
  connecting: (name: string) => `Connecting to ${name}…`,
  cannotReach: (name: string) => `Can't reach ${name}`,
  cannotSignIn: (name: string) => `Can't sign in to ${name}`,
  setupNeeded: (name: string) => `${name} needs remote setup`,
  reconnecting: (name: string) => `Waiting for Ghostex on ${name}`,
  busy: (name: string) => `Ghostex is busy on ${name}`,
  /** Unified, more than one computer not connected. */
  several: (count: number) => `${count} computers aren't connected`,
  /** After the title while the list is the copy read before the failure. */
  staleShort: (ago: string) => `list from ${ago}`,
  justNow: 'a moment ago',
  minutesAgo: (minutes: number) => `${minutes} min ago`,
  hoursAgo: (hours: number) => `${hours} h ago`,
  daysAgo: (days: number) => `${days} d ago`,
  /** The line's hint while a failure shows: a tap opens or closes the details. */
  detailsHint: "Shows every computer's connection",
} as const;

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
    hidden: (count: number) =>
      count === 1
        ? 'An older entry for this computer stopped working and is hidden. It goes when the app next opens.'
        : `${count} older entries for this computer stopped working and are hidden. They go when the app next opens.`,
    merged: (count: number) =>
      count === 1
        ? 'An older entry for this computer was removed. Its saved data is now here.'
        : `${count} older entries for this computer were removed. Their saved data is now here.`,
  },
  remove: {
    title: 'Remove this computer?',
    /** `asksComputer`: the removal first asks the computer to stop its push notifications. */
    body: (name: string, asksComputer: boolean) =>
      `${name} is removed from this phone, along with its saved password and pairing key. ${asksComputer ? `If ${name} can be reached, it also stops sending push notifications. Nothing else changes on the computer.` : 'Nothing changes on the computer.'}`,
    confirm: 'Remove',
  },
  add: {
    sectionLabel: 'Add a computer',
    easyConnect: {
      title: 'Scan the code',
      subtitle: 'Click Connect a Device on the computer.',
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
  /** A Tailscale computer that also reaches its computer through Easy Connect (`easyConnectRoute.ts`). */
  routes: {
    label: 'Routes',
    tailscale: 'Tailscale',
    easyConnect: 'Easy Connect',
    tailscaleDetail: (address: string, inUse: boolean) =>
      inUse ? `${address} · In use` : `${address} · Tried first`,
    easyConnectDetail: (inUse: boolean) => (inUse ? 'In use' : 'When Tailscale doesn\'t answer'),
    add: {
      label: 'Add Easy Connect',
      detail: (computer: string) =>
        `Reach ${computer} from any network when Tailscale is off. Your own Tailscale phone is added at once; otherwise approve it on the computer.`,
      button: 'Add',
    },
  },
  approvals: 'Approvals',
  approvalsNone: 'Nothing is waiting',
  approvalsWaiting: (count: number) => (count === 1 ? '1 request is waiting' : `${count} requests are waiting`),
  approvalsUnknown: 'Requests that wait for you on this computer',
  requirePresenceDetail: (ios: boolean) =>
    `On: Approve asks for ${ios ? 'Face ID' : 'your fingerprint'} first here, and for Touch ID or the password on the computer. It applies to every device that approves for this computer.`,
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
    title: 'Devices that can reach this computer',
    waiting: (name: string) => `${name} is waiting for approval`,
    waitingDetail:
      'Approve its request only if that phone or computer shows the same three words. Deny it if nobody is pairing one right now.',
    deny: 'Deny',
    approve: 'Approve',
    approveFailed: 'Not approved',
    noLongerWaiting: 'This request is no longer waiting.',
    remove: 'Remove',
    cancel: 'Cancel',
    thisPhone: (name: string) => `This phone (${name})`,
    legacy: 'Paired before Ghostex 11.1.0, so it no longer connects. Pair it again, or remove it.',
    removeTitle: (name: string) => `Remove ${name}?`,
    removeDetail: 'It loses its access to this computer at once: its sign-in key and its Ghostex token are removed.',
    removeSelfDetail:
      'This phone loses its access to this computer at once. To use it again, show a code on the computer and pair again.',
    removeFailed: "Couldn't remove the device",
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
  showInSessionsDetail: "Shows this computer's tab at the top of Sessions.",
  /** The computer's Ghostex row; the status wording lives in src/machines/appUpdate.ts with the desktop's. */
  appUpdate: {
    label: 'Ghostex',
    reading: 'Reading the Ghostex version…',
    autoUpdate: 'Keep this machine up to date',
    autoUpdateDetail:
      'Installs Ghostex updates on that computer by itself while none of its agents is working. Sessions keep running through the restart.',
  },
  /** Agent CLIs and Skills and tools of the computer; row wording lives in src/machines/machineToolsView.ts. */
  machineTools: {
    agentsLabel: 'Agent CLIs',
    toolsLabel: 'Skills and tools',
    reading: 'Reading what is installed there…',
    notConnected: 'Connect to this computer to see and update its agent CLIs, skills and tools.',
    retry: 'Read again',
    skills: 'Skills',
    desktopControl: 'Desktop control',
    tools: 'Tools',
    ghostexCli: 'Ghostex CLI',
    cliFound: (path: string) => `New terminals there run ${path}`,
    cliMissing: "New terminals there don't find a ghostex command",
  },
  errorPrefix: (name: string) => `Can't reach ${name}. `,
  whatCanICheck: 'What can I check?',
  remove: {
    button: 'Remove this computer from the phone',
    title: 'Remove this computer?',
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

/**
 * Files: the project's Markdown and HTML documents, listed from the computer and opened in a
 * viewer on the phone. HTML pages carry Agentation so they can be annotated.
 *
 * CDXC:Docs 2026-10-20 DECISION:
 * User: "rename docs to files." The phone calls this screen Files everywhere it is shown (menu
 * rows, title, search, empty and error text), matching the desktop's Files view; code names stay
 * Docs. "Docs folders" and "Docs directory" are the computer's setting names, so they stay.
 */
/** The read-only Changes screen (a project's diff against main or HEAD, like the desktop Changes tab). */
export const ChangesCopy = {
  menuLabel: 'Changes',
  title: 'Changes',
  scopeMain: 'Whole branch',
  scopeUncommitted: 'Uncommitted only',
  scopeMainDetail: (base: string) => `Everything this branch changed against ${base}, committed or not`,
  scopeUncommittedDetail: 'Only what is not committed yet',
  scopeMenu: 'Choose which changes to show',
  loading: 'Reading this project’s changes…',
  loadFailed: 'Could not read this project’s changes',
  oldCli: 'Update Ghostex on the computer to see a project’s changes from the phone.',
  notRepo: 'This project is not a Git repository.',
  noChangesAgainstBase: 'This branch has no changes against its base.',
  noUncommitted: 'No uncommitted changes.',
  truncated: 'The diff is too large to show completely (over 4 MB); some files are left out.',
  machineMissing: 'This machine is no longer saved on this device.',
  retry: 'Retry',
  reload: 'Reload',
  filesChanged: (count: number) => (count === 1 ? '1 file changed' : `${count} files changed`),
  against: (base: string) => `against ${base}`,
  unchangedLines: (count: number) => (count === 1 ? '1 unchanged line' : `${count} unchanged lines`),
  lineCopied: 'Line copied',
  foldFile: 'Fold file',
  unfoldFile: 'Unfold file',
  hideTestFiles: 'Hide test files',
  showTestFiles: 'Show test files',
  testFilesHidden: (count: number) => (count === 1 ? '1 test file hidden' : `${count} test files hidden`),
  showTests: 'Show',
  onlyTestFiles: 'Only test files changed.',
};

/** The Beads screens: a project's beads as the desktop Beads view's Tree shows them, and one bead full screen. */
export const BeadsCopy = {
  menuLabel: 'Beads',
  title: 'Beads',
  search: 'Search beads',
  filters: 'Filter beads',
  loading: 'Reading this project’s beads…',
  loadFailed: 'Couldn’t read the beads',
  staleList: 'This is the list from the last read. Try again; Details has what went wrong.',
  retry: 'Retry',
  reload: 'Reload',
  oldComputer: 'Update Ghostex on that computer to see its beads from the phone.',
  oldComputerTitle: 'Update Ghostex there',
  machineMissing: 'This computer is no longer saved on this phone.',
  noWorkspaceTitle: 'No beads here yet',
  noWorkspace: (folder: string | null) =>
    folder !== null ? `Beads found no workspace in ${folder}. Ask an agent to set up Beads there.` : 'Beads found no workspace for this project. Ask an agent to set up Beads there.',
  noBdTitle: 'Beads isn’t installed',
  noBd: 'Install Beads (bd) on that computer, then reload.',
  failedTitle: 'Beads didn’t answer',
  failedBody: 'Beads couldn’t read this project’s workspace. Try again; Details has what it said.',
  coreFailed: 'This phone’s Ghostex couldn’t lay it out. Try again; if it keeps failing, update the app. Details has what it said.',
  listFailedTitle: 'Couldn’t show the beads',
  pageFailedTitle: 'Couldn’t show this bead',
  backToList: 'Back to the list',
  showDone: 'Show done',
  emptyAll: 'No beads yet.',
  emptyFiltered: 'Nothing matches.',
  readinessPaused: 'Ready and Blocked come back on the next refresh.',
  done: (count: number) => `${count} done`,
  notInEpic: 'Not in an epic',
  details: 'Details',
  hideDetails: 'Hide details',
  dismiss: 'Dismiss',
  syncTitle: 'Sync',
  syncNotYet: 'Not synced yet',
  synced: (ago: string) => `Synced ${ago}`,
  pulling: 'Pulling…',
  pushing: 'Pushing…',
  syncFailedPill: 'Sync failed',
  remote: (name: string, url: string) => `Remote: ${name} ${url}`.trim(),
  noRemote: 'No remote set up',
  lastPush: (ago: string) => `Last push: ${ago}`,
  lastPull: (ago: string) => `Last pull: ${ago}`,
  syncHelp: 'Push sends this computer’s changes. Pull brings in changes from your other computers.',
  pull: 'Pull',
  push: 'Push',
  pullFailed: 'Pull didn’t start',
  pushFailed: 'Push didn’t start',
  // The bead screen
  copyId: 'Copy ID',
  idCopied: 'ID copied',
  close: 'Close',
  reopen: 'Reopen',
  defer: 'Defer',
  bringBack: 'Bring back',
  claim: 'Claim',
  deferTomorrow: 'Tomorrow',
  deferNextWeek: 'Next week',
  deferOnIce: 'On ice',
  deferOnIceDetail: 'Waits until you bring it back',
  priority: 'Priority',
  labels: 'Labels',
  addLabel: 'Add label',
  addLabelPlaceholder: 'Label',
  removeLabel: (label: string) => `Remove ${label}`,
  links: 'Links',
  externalLink: 'External link',
  specLink: 'Spec',
  addLink: 'Add link',
  linkPlaceholder: 'https://… or docs/spec.md',
  changeLink: 'Change',
  progress: 'Progress',
  clearLink: 'Remove',
  linksReadOnly: 'Update Ghostex on that computer to edit links.',
  epic: 'Epic',
  claimedBy: 'Claimed by',
  nobody: 'Nobody yet',
  description: 'Description',
  noDescription: 'No description.',
  comments: (count: number) => `Comments ${count}`,
  addComment: 'Add a comment',
  comment: 'Comment',
  decision: 'Needs a decision',
  respond: 'Answer',
  respondPlaceholder: 'Your answer',
  dismissDecision: 'Dismiss the decision',
  beadGone: 'This bead is no longer in the list.',
  save: 'Save',
  cancel: 'Cancel',
  failed: {
    close: 'Couldn’t close this bead',
    reopen: 'Couldn’t reopen this bead',
    defer: 'Couldn’t defer this bead',
    undefer: 'Couldn’t bring it back',
    claim: 'Couldn’t claim this bead',
    priority: 'Couldn’t change the priority',
    label: 'Couldn’t change the labels',
    link: 'Couldn’t change the link',
    comment: 'Couldn’t add the comment',
    respond: 'Couldn’t send the answer',
    dismiss: 'Couldn’t dismiss the decision',
    show: 'Couldn’t read this bead',
  },
};

/**
 * Files: the project file browser (`DocsScreen`) and its shared document viewer (`DocViewerScreen`). The browser's labels
 * and status lines are the desktop files list's where the phone has the same thing
 * (apps/desktop/src/app/native_docs/files_list.rs, type_filter.rs, actions.rs).
 */
export const DocsCopy = {
  menuLabel: 'Files',
  listTitle: 'Files',
  searchPlaceholder: 'Search files',
  recentSection: 'Recently changed',
  foldersSection: 'Project Docs',
  searchSection: (count: number) => (count === 1 ? '1 match' : `${count} matches`),
  loading: 'Listing this project’s files…',
  noFiles: 'No files found',
  noMatches: 'No matching files',
  searching: 'Searching…',
  searchIncomplete: 'No matching files. This project is large, so search covers its first 200,000 files and folders.',
  searchTruncated: 'Showing the best matches. Type more to narrow them.',
  filterTruncated: 'Showing the first 3,000 files of these types. Type a name to narrow them.',
  clearSearch: 'Clear search',
  filterByType: 'Filter by file type',
  filterShowing: (types: readonly string[]) => `Showing ${types.join(', ')} files`,
  allFiles: 'All files',
  typeFilterLabels: { markdown: 'Markdown', html: 'HTML', excalidraw: 'Excalidraw', image: 'Image', video: 'Video' },
  filesMenu: 'Files menu',
  refresh: 'Refresh',
  showHiddenFiles: 'Show Hidden Files',
  open: 'Open',
  openFile: (name: string) => `Open ${name}`,
  copyFullPath: 'Copy Full Path',
  // Add to Session Context: the desktop's row label and its messages (native_docs/actions.rs,
  // gpui_engine_terminal_attachment.rs), in the row menu and a text preview's header; the notices are the design's.
  addToSessionContext: 'Add to Session Context',
  contextAdded: (session: string) => `Added to ${session}`,
  contextNotSent: 'Not sent yet. Write your message there and send it.',
  contextFailed: (name: string) => `Can't add ${name}`,
  contextNoSession: 'No active agent session is available.',
  contextNoText: 'The computer sent no text for this file. Update Ghostex on the computer and try again.',
  // Share… in the row menu and on the name-and-size view, Share in a text preview's header.
  share: 'Share…',
  shareButton: 'Share',
  shareFetching: (name: string) => `Getting ${name}…`,
  shareFetchingDetail: (size: string | null) => (size === null ? 'From the computer' : `${size} from the computer`),
  shareFailed: (name: string) => `Can't share ${name}`,
  shareNoData: 'The computer sent no file. Update Ghostex on the computer and try again.',
  // Why a share failed, could not open or was interrupted (`shareSheet.ts`); a plain cancel shows nothing.
  shareSheetUnavailable: 'The share sheet could not open. Try again.',
  shareActivityFailed: 'The app you picked could not share the file.',
  shareSheetInterrupted: 'The share sheet closed before it finished. Try again.',
  shareFallbackName: 'File',
  folderLoading: 'Folder not loaded yet',
  folderFailed: (message: string) => `This folder could not load: ${message}`,
  listFailed: 'Could not list this project’s files',
  oldCli: 'Update Ghostex on the computer to list its files from the phone.',
  retry: 'Retry',
  machineMissing: 'This machine is no longer saved on this device.',
  opening: 'Opening…',
  readingFile: 'Reading the file from the computer…',
  openFailed: 'Could not open this file',
  fileMissing: 'This file is no longer on the computer.',
  reload: 'Reload',
  copyPath: 'Copy path',
  copyFailed: 'Could not copy the path',
  sourceView: (name: string) => `Source of ${name}`,
  infoWhy: {
    image: 'Images are not shown on the phone.',
    binary: 'Binary files are not shown on the phone.',
    large: 'Files over 2 MB are not shown on the phone.',
  },
  infoKind: (extension: string, image: boolean) =>
    extension.length === 0 ? 'File' : `${extension.toUpperCase()} ${image ? 'image' : 'file'}`,
  infoMeta: (size: string, kind: string) => `${size} · ${kind}`,
  sizeUnknown: 'Size unknown',
  justNow: 'just now',
  minutesAgo: (minutes: number) => `${minutes}m ago`,
  hoursAgo: (hours: number) => `${hours}h ago`,
  daysAgo: (days: number) => `${days}d ago`,
  pathCopied: 'Path copied',
  annotateOn: 'Hide annotation tools',
  annotateOff: 'Annotate with Agentation',
  annotationsCopied: 'Annotations copied',
  annotationsCopiedHint: 'Paste them into a session’s chat or terminal.',
  agentationFailed: 'Agentation could not load. It needs an internet connection on this phone.',
  skippedAssets: (count: number) =>
    count === 1
      ? 'One file this page uses was too large to copy to the phone.'
      : `${count} files this page uses were too large to copy to the phone.`,
  cantPreview: "Can't preview this file on the phone",
  pathCopiedNote: (path: string) => `${path} (path copied)`,
  openingPdf: 'Downloading the PDF from the computer…',
  noPdfApp: (path: string) =>
    `No app on this phone opens PDFs. Install a PDF viewer, or open it on the computer: ${path}`,
} as const;

/**
 * Send Bug / Feedback (src/feedback/FeedbackScreen.tsx): the phone's form of the computer's
 * pop-up (apps/desktop/src/app/window/feedback_modal/render.rs), worded the same where the
 * two say the same thing.
 */
export const FeedbackCopy = {
  title: 'Send Bug / Feedback',
  menuLabel: 'Send Bug / Feedback',
  intro:
    'Tell us what is broken, confusing or missing. You review the issue before it is posted publicly on the Ghostex GitHub.',
  introAgent:
    'Tell us what is broken, confusing or missing. Start Agent opens a session on your computer where an agent gathers the details and drafts the issue for the Ghostex GitHub.',
  usernameLabel: 'GitHub username',
  usernamePlaceholder: 'name or @name',
  usernameHint: "Required. The issue mentions you, so GitHub lets you know when it's fixed.",
  usernameInvalid: "That isn't a GitHub username: letters, digits and single hyphens, up to 39 characters.",
  messageLabel: 'Feedback',
  messagePlaceholder: 'What happened, what did you expect, or what would you like to see?',
  imagesHint: 'You can attach up to 5 PNG, JPEG or WebP screenshots of 5 MB each.',
  addScreenshots: 'Add Screenshots',
  pasteImage: 'Paste Image',
  removeImage: 'Remove screenshot',
  agentLabel: 'Collect more data with an agent',
  agentDescription:
    'An agent on your computer reads its Ghostex logs and settings, looks into the problem without changing anything, and shows you the issue before it posts it.',
  review: 'Review',
  startAgent: 'Start Agent',
  reviewTitle: 'Review Issue',
  reviewIntro: 'This is exactly what will be posted publicly on the Ghostex GitHub. Edit anything before you send it.',
  issueTitleLabel: 'Title',
  issueBodyLabel: 'Description',
  back: 'Back',
  send: 'Send',
  sentTitle: 'Thanks for the feedback',
  sentBody: (number: number) => `Issue #${number} is on GitHub now. You can follow it there.`,
  openIssue: 'Open Issue',
  done: 'Done',
  added: (screenshots: number, footer: string) =>
    `Added when it is posted: ${
      screenshots === 0 ? '' : screenshots === 1 ? '1 screenshot and ' : `${screenshots} screenshots and `
    }“${footer}”.`,
  agentUnsupported: 'Update Ghostex on this computer to start the feedback agent from the phone.',
  agentNoSession: 'The agent started, but Ghostex did not say which session it is in.',
  crashAttached: 'Crash report attached',
  crashAttachedHint:
    'Saved on this phone when Ghostex closed. Personal details such as names, addresses, emails and keys are removed; you see the exact text in Review.',
  crashAgentHint: 'The agent gets this report too and removes anything personal it still finds.',
  attachCrash: (when: string) => `Attach Crash Report (${when})`,
  removeCrash: 'Remove',
  showCrash: 'Show Report',
  hideCrash: 'Hide Report',
} as const;

/** The next-launch offer to send the crash report the last run left behind. */
export const CrashReportCopy = {
  title: 'Ghostex closed unexpectedly',
  body: (when: string) =>
    `It closed on ${when}. A crash report is saved on this phone; sending it helps us fix the cause. You review it first, and personal details are removed.`,
  send: 'Send Report',
  dismiss: 'Dismiss',
} as const;

/**
 * Header buttons shared by the system header, the screens' own headers and the iPhone Duo's chrome
 * (status band and side bar).
 */
export const DuoChromeCopy = {
  back: 'Back',
  /** A screen's "…", and the side bar's own one holding the buttons it has no room for. */
  more: 'More options',
} as const;

/** The terminal screen's header buttons, on top, in the status band or in the side bar. */
export const TerminalHeaderCopy = {
  chatView: 'Chat view',
  terminalView: 'Terminal view',
} as const;

/**
 * Panes on the unfolded iPhone Duo: the header's Panes button, the panes' title bars, divider and chooser, and the
 * pane types (the panes design's labels and descriptions).
 */
export const PanesCopy = {
  addPane: 'Panes: add a pane',
  closeSecondPane: 'Panes: close the second pane',
  /** While the chooser (titled "New pane") is on screen the Panes button closes it, the other pane staying. */
  closeNewPane: 'Panes: close the new pane',
  move: (title: string) => `Move ${title} pane`,
  /** The title opens the pane type menu. */
  title: (title: string, typeLabel: string) => `${title}, ${typeLabel} pane`,
  close: (title: string) => `Close ${title} pane`,
  typeMenuTitle: 'Pane type',
  typeMenuSubtitle: 'Shown in this pane',
  sessionType: 'Session',
  sessionTypeDescription: 'Another agent session next to this one',
  /** The checked Session in a session pane's type menu beside another session pane: it opens the chooser there. */
  switchSessionHint: 'Opens the session choice for this pane',
  /** A session pane showing the session's chat view: its title bar names it a chat. */
  chatType: 'Chat',
  browserType: 'Web Preview',
  browserTypeDescription: 'A page from your computer',
  filesType: 'Files',
  filesTypeDescription: 'The project’s files',
  gitType: 'Git Changes',
  gitTypeDescription: 'Changed files and their diff',
  agentsType: 'Agents',
  agentsTypeDescription: 'All sessions with their status',
  usageType: 'Usage',
  usageTypeDescription: 'Claude and Codex limits',
  attentionType: 'Attention',
  attentionTypeDescription: 'Notifications from your agents',
  /** The agents pane's summary over its sessions (the panes design's chips). */
  agentsSummary: 'Summary',
  agentsChip: {
    question: (count: number) => `${count} question`,
    working: (count: number) => `${count} working`,
    done: (count: number) => `${count} done`,
    failed: (count: number) => `${count} failed`,
  },
  agentsEmpty: 'No sessions on this computer.',
  newPane: 'New pane',
  /** The chooser's pane types, above its sessions. */
  chooserTypesLead: 'Show in this pane',
  chooserLead: 'Open a session here',
  chooserEmpty: 'No other session on this computer.',
  chooserLoading: 'Loading sessions',
  /** The chooser's first row: closes it, as its close button does. */
  chooserClose: 'Close',
  /** A new terminal session in the project of the session beside the chooser, opened in the chooser's pane. */
  newTerminalIn: (project: string) => `New terminal in ${project}`,
  /** The computer's Add Project flow, full screen. */
  addProject: 'Add project',
  newTerminalFailed: 'New Terminal Failed',
  /** A files or Git changes pane while the computer's session list is read. */
  projectLoading: 'Loading the project',
  /** A files or Git changes pane whose session (its project's) the computer no longer lists. */
  projectGone: 'The session this pane was opened from is no longer on this computer, so its project is not known.',
  resize: 'Resize panes',
  /** While the divider is dragged: both shares, and "limit" at 25 or 75 percent. */
  shares: (first: number, second: number, atLimit: boolean) => `${first} % · ${second} %${atLimit ? ' · limit' : ''}`,
  releaseToSwap: 'Release to swap',
  status: {
    question: 'Has a question',
    approval: 'Waiting for approval',
    working: 'Working',
    done: 'Done',
    failed: 'Failed',
    backgroundWork: 'Background work',
    idle: 'Idle',
  },
} as const;

/**
 * The usage of a computer's Claude and Codex accounts, in a usage pane and full screen: the chat Accounts panel's
 * head, meters and sentences (`AccountsPanel.tsx`), and the computer it is for.
 */
export const UsageCopy = {
  title: (computer: string) => `Usage · ${computer}`,
  head: 'Accounts & limits',
  refresh: 'Refresh accounts and usage',
  loading: 'Reading accounts and usage…',
  unavailable: 'Usage is unavailable for this login.',
  /** Opens the Accounts screen on this computer: sign-ins and Reconnect (src/accounts/). */
  manageAccounts: 'Manage accounts',
  /** No saved and enabled account to show: none saved, or every saved one turned off on the computer. */
  noAccounts: (computer: string) =>
    `No Claude or Codex account is enabled in Ghostex on ${computer}. Enable or add one there to see its usage and reset times here.`,
  /** A meter for VoiceOver, as the Accounts panel reads it. */
  meter: (name: string, value: string, resetIn: string) =>
    `${name} ${value}${resetIn.length > 0 ? `, resets in ${resetIn}` : ''}`,
  /** The countdown under a meter's bar. */
  resetIn: (resetIn: string) => `↻ ${resetIn}`,
  /** The provider's name on a Home Screen widget bar ("Claude 5h"), when the computer has one account of it. */
  provider: { claude: 'Claude', codex: 'Codex' },
  /** A Home Screen widget bar: the provider's or, with several accounts of one provider, the account's name. */
  widgetBar: (owner: string, window: string) => `${owner} ${window}`,
} as const;

/** The Accounts screen: one computer's Claude and Codex accounts and their sign-ins (src/accounts/). */
export const AccountsCopy = {
  title: 'Accounts',
  computerLabel: (computer: string) => `Accounts on ${computer}`,
  computerDescription: 'Logins stay on each computer. Sign-ins here run there.',
  pickComputer: 'Show accounts on',
  pickComputerHint: 'Picks another computer',
  pickSubtitle: 'Each computer keeps its own saved logins.',
  asking: 'Asking…',
  reachable: (count: number) => (count === 1 ? '1 account' : `${count} accounts`),
  cantReachShort: "Couldn't reach it",
  loading: (computer: string) => `Reading the accounts on ${computer}…`,
  /** Q2781: the honest line in place of buttons that can't work. */
  unreachable: (computer: string) =>
    `Can't reach ${computer} right now. Its accounts sign in on ${computer}: reconnect there in Ghostex, or come back when it's connected.`,
  tryAgain: 'Try again',
  noAccounts: (computer: string) => `No Claude or Codex account is saved in Ghostex on ${computer} yet.`,
  provider: { claude: 'Claude', codex: 'Codex' },
  addAccount: (provider: string) => `Add ${provider} account`,
  reconnect: 'Reconnect',
  turnedOff: 'Turned off',
  needsSignIn: 'Sign in needed',
  signingInOn: (computer: string) => `Signing in on ${computer}`,
  finishInBrowser: 'Finish in your browser with the account you want. If it shows a code, paste it here.',
  finishCodex: 'Open the page, sign in, then enter this code there.',
  openPage: 'Open the sign-in page',
  waitingForPage: 'Waiting for the sign-in page…',
  codeLabel: 'Enter this code on the page',
  copy: 'Copy',
  copied: 'Copied',
  pasteCode: 'Paste the code',
  send: 'Send',
  cancel: 'Cancel',
  saving: 'Saving the login…',
  connected: 'Connected',
  done: 'Done',
  failed: 'The sign-in did not finish.',
  close: 'Close',
} as const;

/** Titles of the Settings screens that are not pages of their own (the pages' are in screens/settings/pages.ts). */
export const SettingsCopy = {
  title: 'Settings',
  extraKeysTitle: 'Extra Keys',
  agentHotkeysTitle: 'Agent Hotkeys',
  padKeysTitle: 'Pad Keys',
  /** Settings > Keyboard > Extra keys layout: the rows feed the command pad's Keys layer. */
  extraKeysStatus: "Customize the two key rows of the command pad's Keys layer. Tap a key to move or remove it.",
  /** Settings > Keyboard > Agent hotkeys. */
  agentHotkeysIntro:
    "Configure the exact terminal shortcuts shown on the command pad's Agent layer for each agent. These keys never type slash commands.",
} as const;

/** The search at the top of the Settings list, worded as the desktop's Settings search. */
export const SettingsSearchCopy = {
  placeholder: 'Search settings',
  clear: 'Clear search',
  noMatches: 'No settings match',
  noMatchesHint: 'Try another word, such as theme, font or notifications.',
  count: (count: number) => (count === 1 ? '1 result' : `${count} results`),
  /** A result's spoken name: the setting and where it is. */
  resultLabel: (title: string, breadcrumb: string) => `${title}, in ${breadcrumb}`,
} as const;

/**
 * The Befehlspad (command pad) in the terminal, its Keys and Agent layers and the text editor, and its rows in
 * Settings > Keyboard (wording of the designs).
 */
export const CommandPadCopy = {
  toggle: 'Command pad',
  /** The toggle's accessibility actions that move the pad; a held toggle drags it. */
  moveLeft: 'Move to the left side',
  moveRight: 'Move to the right side',
  keysLayer: 'Keys',
  agentLayer: 'Agent hotkeys',
  /** Why the Agent button is unavailable: only Codex, Claude Code and Pi have agent hotkeys. */
  agentUnavailableHint: "This session's agent has no agent hotkeys",
  editor: 'Text editor',
  showKeyboard: 'Show keyboard',
  hideKeyboard: 'Hide keyboard',
  extraKeys: 'Extra keys',
  moreKeys: 'More keys',
  padSettings: 'Pad settings',
  /** A layer's own close button, shown while it stands in for the open pad (too little room for both). */
  closeLayer: 'Close',
  closeLayerHint: 'Opens the command pad again',
  /**
   * The text editor's own close button in the same state: it does what the pen does. Named for what it closes, as the
   * editor has no titled head that tells which "Close" it is.
   */
  closeEditor: 'Close text editor',
  closeEditorHint: 'Keeps the text for the next opening; the keyboard stays up',
  holdHintIdle: 'Hold a key to see what it does',
  holdHint: 'Hold to see what this key does',
  modifierHint: 'Tap for one key, or hold to lock until tapped again',
  /** The chip beside the toggle while a modifier is armed. */
  modifierLocked: (label: string) => `${label} locked`,
  editorField: 'Terminal text editor',
  editorPlaceholder: 'Type text to send to the terminal',
  sendEnter: 'Send Enter to terminal',
  insertText: 'Insert text into terminal',
  paste: 'Paste',
  upload: 'Upload',
  newLine: 'New line',
  /** A pad position whose custom action or agent hotkey was deleted; it sends nothing. */
  unavailable: 'Not available',
  /** Spoken and shown names of keys by terminal key name. */
  keyNames: {
    escape: 'Esc',
    tab: 'Tab',
    enter: 'Enter',
    backspace: 'Backspace',
    delete: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageUp: 'Page Up',
    pageDown: 'Page Down',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
  } as Readonly<Record<string, string>>,
  /** Shorter faces where the name does not fit a pad key. */
  keyFaces: {
    backspace: 'Bksp',
    delete: 'Del',
    insert: 'Ins',
    pageUp: 'PgUp',
    pageDown: 'PgDn',
  } as Readonly<Record<string, string>>,
  modifierNames: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' },
  agentKey: (agent: string, label: string) => `${agent}: ${label}`,
  // Settings > Keyboard
  settingsSection: 'Command pad',
  settingsCaption:
    'Shows the pad button in terminals. The pad holds the arrow keys, Enter, Esc, Tab, Ctrl+C and Upload.',
  vibration: 'Key vibration',
  padKeys: 'Pad keys',
  padKeysDescription: 'Choose what the nine pad keys do.',
  layersSection: 'Pad layers',
  extraKeysLayout: 'Extra keys layout',
  extraKeysLayoutDescription: 'Keys layer: your two rows of keys and custom actions.',
  agentHotkeys: 'Agent hotkeys',
  agentHotkeysDescription: 'Agent layer: hotkeys for Codex, Claude Code and Pi.',
  // Settings > Keyboard > Pad keys
  editorIntro: 'Tap a key to change it. Arrow keys repeat while you hold them.',
  positions: {
    topLeft: 'Top left',
    top: 'Top',
    topRight: 'Top right',
    left: 'Left',
    centre: 'Centre',
    right: 'Right',
    bottomLeft: 'Bottom left',
    bottom: 'Bottom',
    bottomRight: 'Bottom right',
  },
  positionKey: (position: string, key: string) => `${position}: ${key}`,
  pickerTitle: (position: string) => `${position} key`,
  done: 'Done',
  sectionKeys: 'Keys',
  sectionModifiers: 'Modifiers',
  sectionShortcuts: 'Shortcuts',
  sectionAgent: (agent: string) => `Agent hotkeys · ${agent}`,
  sectionOther: 'Other',
  sectionCustom: 'Custom actions',
  customEmpty: 'None yet. Add text or shortcut keys in Extra keys layout; they appear here.',
  reset: 'Reset',
  resetTitle: 'Reset Pad Keys?',
  resetBody: 'This puts the default nine keys back.',
  cancel: 'Cancel',
} as const;

/**
 * Agent notifications and the attention list (the notifications design and the state inbox): the
 * four event wordings, the list, the bell and Settings > Notifications. Text level: event and session
 * only, never anything the agent wrote.
 */
export const NotificationsCopy = {
  /** The line under "agent · project" in a notification. */
  event: {
    finished: 'Finished',
    waiting: 'Waiting for you',
    question: 'Has a question',
    failed: 'Ended with an error',
  },
  /** The state line of an attention list row. */
  rowKind: {
    approval: 'Waiting for approval',
    question: 'has a question',
    waiting: 'waiting',
    finished: 'finished · not opened',
    failed: 'ended with an error',
    sendFailed: 'not sent',
    ended: 'Ended',
    resetExpiring: 'reset expiring',
    resetRedeemed: 'reset used',
  },
  /** A row's state in its footer, in the desktop bell's words (`GpuiNotificationFeedKind::label`). */
  rowState: {
    needsInput: 'Needs input',
    finished: 'Finished',
    failed: 'Failed',
    sendFailed: 'Not sent',
    ended: 'Ended',
    resetExpiring: 'Reset expiring',
    resetRedeemed: 'Reset used',
  },
  /** A waiting row's body when the computer's feed holds no message for the wait (gxserver's own wording). */
  waitBody: {
    approval: 'Waiting for your approval',
    question: (count: number) =>
      count > 1 ? `${count} questions are waiting for your answers` : 'A question is waiting for your answer',
    waiting: 'Waiting for your input',
  },
  /** A row's title when the session has none (the desktop bell's "Session"). */
  untitledSession: 'Session',
  /** The Notifications list in the desktop panel's words (`titlebar_notifications_panel.rs`). */
  feed: {
    /** The footer's kind word (`GpuiNotificationFeedKind::label`). */
    kind: {
      finished: 'Finished',
      needsInput: 'Needs input',
      bell: 'Bell',
      custom: 'Notification',
      sendFailed: 'Not sent',
      failed: 'Failed',
      resetExpiring: 'Reset expiring',
      resetRedeemed: 'Reset used',
      security: 'Security',
    },
    unread: 'Unread',
    read: 'Read',
    markAllRead: 'Mark all read',
    clearAll: 'Clear all',
    /** The list's ⋯ (Mark all read, Clear all) and its menu's title. */
    listMenu: 'Notification actions',
    listMenuTitle: 'Notifications',
    emptyTitle: 'No notifications yet',
    emptyText: 'Agents that finish or need you will show up here.',
    offlineOne: (machine: string) => `${machine} is offline. Its notifications show again when it reconnects.`,
    offlineMany: (machines: string, last: string) =>
      `${machines} and ${last} are offline. Their notifications show again when they reconnect.`,
    justNow: 'just now',
    yesterday: 'yesterday',
    /** The card's check, by what it does: an unread row is marked read, a read one is cleared from the list. */
    checkRead: 'Mark as read',
    checkClear: 'Clear',
    rowMenu: 'More actions',
    /** The Remove on the row for a phone added for Easy Connect without a click. */
    removeDevice: 'Remove',
    removeDeviceLabel: (name: string) => `Remove ${name} from this computer`,
    unreadBell: (count: number) => `Notifications, ${count} unread`,
  },
  /** The attention list's sections, in their order. */
  section: {
    needsYou: 'Needs you',
    /** Needs you while one of its waits comes from a computer that cannot be reached now. */
    needsYouLastKnown: 'Needs you · last known',
    done: 'Done',
    failed: 'Failed',
    accounts: 'Accounts',
  },
  /** Who a row names when the computer did not say which agent it was. */
  unknownAgent: 'Agent',
  title: 'Notifications',
  /** Under Needs you while nothing waits; Done, Failed and Accounts stay below it. */
  emptyTitle: 'Nothing needs you',
  emptyText: 'No open approvals, questions or replies waiting for you.',
  loading: 'Loading notifications…',
  offline: (machine: string) => `${machine} is offline. Its rows show what was last known until it reconnects.`,
  /** Beside a row of a computer that cannot be reached now. */
  lastKnown: 'last known',
  cantLoadTitle: 'Can’t load notifications',
  cantLoadText: (machine: string) => `The list loads again as soon as the phone reaches ${machine}.`,
  tooOld: (machine: string) =>
    `${machine} runs a Ghostex that can’t share its notifications with the phone. Update Ghostex on that computer.`,
  bell: 'Notifications',
  bellNeedsYou: (count: number) => `Notifications, ${count} need you`,
  /** The bell while one of the waits it counts comes from a computer that cannot be reached now. */
  bellLastKnown: (count: number) => `Notifications, last known count ${count}`,
  rowUnread: 'Unread.',
  menuTitle: 'Notifications',
  menuSubtitle: 'Read state is shared with the bell on your computer',
  clearDone: 'Clear Done',
  openSession: 'Open Session',
  markDone: 'Mark as Done',
  markRead: 'Mark as Read',
  markUnread: 'Mark as Unread',
  clear: 'Clear',
  cancel: 'Cancel',
  close: 'Close',
  actionFailed: 'The computer didn’t take that change. Try again in a moment.',
  /** The sheet an ended session's row opens. */
  ended: {
    title: 'Session ended',
    text: 'This session is no longer running.',
    restore: 'Restore',
    remove: 'Remove',
    restoringTitle: 'Restoring session…',
    restoringText: 'Waiting for the computer…',
    failedTitle: 'Couldn’t restore session',
    failedText: 'The computer did not return a restored session. Your ended session is kept.',
    tryAgain: 'Try Again',
    removeTitle: 'Remove from this list?',
    removeText: 'The session and the bell on your computer stay as they are.',
  },
  /** Settings > Notifications; the page was "Sounds". */
  settings: {
    pageDescription: 'Agent alerts and the attention sound.',
    sectionAgents: 'Agent notifications',
    master: 'Notifications',
    limit:
      'Ghostex can notify you only while it is running: open, or briefly in the background. Once iOS pauses it, for example a while after you lock the phone, nothing arrives until you open Ghostex again. The bell on the Sessions screen then shows what needs you, what finished and what failed.',
    /** Instead of `limit` while an enabled computer accepted this phone's push registration, or that is not read yet. */
    limitWithPush:
      'Ghostex notifies you while it is running. A computer that accepted this iPhone for push can also notify you while Ghostex is closed or paused: iOS decides when a push arrives, and one can come late or not at all. Finished, Waiting for you and Ended with an error also apply to pushes. A computer that Ghostex cannot reach when you change one keeps the earlier choice until it next accepts this iPhone, for example when you open Ghostex again. The bell on the Sessions screen shows what needs you, what finished and what failed.',
    finished: 'Finished',
    finishedDetail: 'An agent finished its turn.',
    waiting: 'Waiting for you',
    waitingDetail: 'Also when an agent has a question.',
    error: 'Ended with an error',
    errorDetail:
      'When an agent’s run ends with an error, such as an API error. Stopping an agent yourself doesn’t notify.',
    rules:
      'Only main sessions notify, not their subagents. Starting, ending or working never notifies. At most one notification per session every 20 seconds, and 8 per minute.',
    sectionSound: 'Sound',
    alertsFor: 'Alert me for',
    alertsForAll: 'All',
    alertsForNeedsYou: 'Needs you only',
    alertsForDetail:
      'A coordinator’s threads finishing, and a coordinator that only finished, stay quiet under both choices, and a red dot (an approval, a stuck or blocked session) always alerts. All plays the sound and shows a notification whenever any other agent finishes; Needs you only does that only when it asks you something, waits for approval, or ends with Blocked or Needs you.',
    sound: 'Attention notification sound',
    soundDetail: 'Plays a sound when a session on your computer finishes or needs your attention.',
    blockedTitle: 'Blocked in iOS Settings',
    blockedText:
      'iOS doesn’t allow Ghostex to notify you, so the switches below have no effect. Turn on Allow Notifications in iOS Settings › Apps › Ghostex › Notifications.',
    openSettings: 'Open iOS Settings',
  },
} as const;

/**
 * Settings › Notifications, the choice for each kind of notice (CDXC:Notifications 2026-11-11 in
 * src/notifications/settings.ts): Sound, Silent or Off.
 */
export const NotificationChoicesCopy = {
  sectionKinds: 'What notifies you',
  choiceSound: 'Sound',
  choiceSilent: 'Silent',
  choiceOff: 'Off',
  needsYou: 'Needs you',
  needsYouDetail: 'A question, an approval or permission, or an agent waiting for you.',
  finished: 'Finished',
  finishedDetail: 'A session you talk to finished its turn. A coordinator’s own turn notifies only when it needs you.',
  errors: 'Errors',
  errorsDetail: 'A session stopped on an error, is stuck, or is out of usage on every account.',
  threadReports: 'Thread reports',
  threadReportsDetail:
    'A thread under a coordinator finished a turn. It reports to its coordinator, so this is Off unless you want every report.',
  kindsCaption:
    'Silent shows the notification without a sound. Several notices close together come as one sound, and the notices of one session stack together. Nothing notifies for a session open on screen, or for an agent starting or working.',
  pushCaption:
    'A computer that accepted this iPhone for push follows these choices too, also while Ghostex is closed. iOS decides when a push arrives, and one can come late or not at all.',
  quietHours:
    'For quiet hours, use an iOS Focus (iOS Settings › Focus): it holds Ghostex’s notifications until it ends.',
  test: 'Send a test notification',
  testSent: 'Sent. Leave Ghostex or lock the phone: it shows in 5 seconds.',
  testFailed: 'iOS did not take the test notification. Check iOS Settings › Apps › Ghostex › Notifications.',
  testTitle: 'Ghostex',
  testBody: 'Test notification',
} as const;

/**
 * Settings › Live Activity (approved mockup). The activity's own words (working,
 * waiting, has a question, finished, "+N more", "Updated <time>") are drawn by the widget extension
 * (modules/ghostex-live-activity/ios/Extension); the preview here repeats them.
 */
export const LiveActivityCopy = {
  /** The page's row on the Settings home and its title (`src/screens/settings/pages.ts`). */
  pageTitle: 'Live Activity',
  pageDescription: 'Agents on the Lock Screen and in the Dynamic Island.',
  toggle: 'Show Live Activity',
  onCaption:
    'Shows working and waiting agents on the Lock Screen and in the Dynamic Island. It starts when an agent starts working and ends 15 minutes after the last one stops.',
  // The design also says "or briefly in the background": that needs silent pushes, which this build
  // does not have, so it claims only what it does (updates while the app is open).
  freshnessCaption: 'Ghostex updates it while the app is open. Later it can show an older state and then says so.',
  lockedUpdatesToggle: 'Keep it updated while locked',
  lockedUpdatesCaption:
    'New. While your phone is locked, one of your computers keeps this Live Activity up to date through Ghostex’s push service, for itself and the computers connected to it. Off, it updates only while Ghostex is open, as before.',
  offCaption: 'Off. Ghostex ends the current Live Activity and starts no new one.',
  sessionNamesToggle: 'Show session names',
  sessionNamesCaption:
    'Rows show the session’s name, as in the Sessions list, instead of the agent’s; the icon still tells which agent it is. This also applies to the Home Screen widgets. Anyone who sees your Lock Screen can read the names.',
  /**
   * The Live Activity starts only when every computer with agents sends their start times and whether
   * they finished or wait.
   */
  needsUpdate: (names: readonly string[]) =>
    names.length === 1
      ? `${names[0]} needs a newer Ghostex for the Live Activity. Update Ghostex on that Mac; until then no Live Activity starts.`
      : `${names.join(', ')} need a newer Ghostex for the Live Activity. Update Ghostex on those Macs; until then no Live Activity starts.`,
  previewTitle: 'Preview',
  previewLabel:
    'Preview of the Live Activity: 1 working, 2 waiting, one more agent. Claude Code in ghostex-mobile has a question, Codex in homeserver is waiting, Codex in ghostex-mobile is working, omp in Ghostex finished.',
  /** The same preview while "Show session names" is on: each row's session, and the agent its mark shows. */
  previewLabelWithSessionNames:
    'Preview of the Live Activity: 1 working, 2 waiting, one more agent. Widget refresh, Claude Code, in ghostex-mobile has a question. Backup script, Codex, in homeserver is waiting. Release notes, Codex, in ghostex-mobile is working. Sidebar search, omp, in Ghostex finished.',
  more: (count: number) => `+${count} more`,
  /**
   * Sample rows of the preview: agent, its artwork, session name, project, state and time, as the design's Lock
   * Screen. A row leads with `session` and the agent's mark while "Show session names" is on, else with `agent`.
   */
  previewRows: [
    {
      agent: 'Claude Code',
      icon: 'claude',
      session: 'Widget refresh',
      project: 'ghostex-mobile',
      state: 'question',
      time: '4m',
    },
    { agent: 'Codex', icon: 'codex', session: 'Backup script', project: 'homeserver', state: 'waiting', time: '1m' },
    {
      agent: 'Codex',
      icon: 'codex',
      session: 'Release notes',
      project: 'ghostex-mobile',
      state: 'working',
      time: '12m',
    },
    { agent: 'omp', icon: 'omp', session: 'Sidebar search', project: 'Ghostex', state: 'finished', time: '18m' },
  ],
} as const;

/** Settings › Licences: the third-party notices bundled with the app (THIRD_PARTY_NOTICES.md). */
export const LicencesCopy = {
  pageTitle: 'Licences',
  pageDescription: 'Open-source software in this app.',
  searchPlaceholder: 'Search licences',
  clearSearch: 'Clear search',
  componentCount: (count: number) => (count === 1 ? '1 component' : `${count} components`),
  noMatches: 'No component matches that search.',
  loading: 'Reading the licence notices…',
  loadFailed: 'Could not read the licence notices',
  retry: 'Retry',
  missingEntry: 'This component is not in the licence notices of this version.',
  entryLine: (version: string, licence: string | undefined) =>
    licence === undefined ? version : `${version} · ${licence}`,
} as const;

/**
 * Approvals (GitHub #495): what an agent asked a computer to do that only its owner may allow,
 * approved here with Face ID, the fingerprint or the screen lock.
 */
/**
 * GitHub #495, 11.1.0: pairing this phone with a computer it signs in to over SSH (Tailscale, the
 * local network), with three matching words (`machines/sshPairing.ts`).
 */
/*
CDXC:RemotePairing 2026-11-09 WHY:
User (Android, 11.2.1, two tall "Pair this phone with madda@100.77.81.4" / "Pair this phone with W"
cards): "i don't understand as a user what the heck I need to do here". The card now says it
plainly: this phone isn't approved on that computer yet; Ghostex on the computer (named as the
person named it, or as the computer names itself, not by its address) shows "Approve this phone?"
with the same words, and Approve is the step; reading works meanwhile and replying, Stop and typing
wait. Several computers share one compact card. The computer's notice carries the same title
(apps/desktop/src/app/owner_security/ui.rs `approval_title`).
*/
export const SshPairingCopy = {
  theComputer: 'the computer',
  approveTitle: (computer: string) => `Approve this phone on ${computer}`,
  approveTitleMany: (count: number) => `Approve this phone on ${count} computers`,
  pendingSteps: (computer: string) =>
    `This phone isn't approved on ${computer} yet. Ghostex on ${computer} shows “Approve this phone?” with these words. If they match, choose Approve there.`,
  pendingStepsEasyConnect: (computer: string) =>
    `Ghostex on ${computer} shows “Approve this phone?” with these words. If they match, choose Approve there, and this phone also reaches ${computer} through Easy Connect when Tailscale is off.`,
  pendingStepsMany:
    "This phone isn't approved on these computers yet. Ghostex on each one shows “Approve this phone?” with the words next to its name. If they match, choose Approve there.",
  lapsedSteps: (computer: string) =>
    `This phone isn't approved on ${computer} yet, and nobody approved its last request in time. Tap Ask again, then approve it in Ghostex on ${computer}.`,
  lapsedRow: 'Not approved in time',
  meanwhile: 'Until then you can read everything here. Replying, Stop and typing wait for approval on the computer.',
  hideHint: (computer: string) => `Hide puts this away. To see it again, open Machines and tap ${computer}.`,
  hideHintMany: 'Hide puts this away. To see it again, open Machines and tap the computer.',
  pairedTitle: (computer: string) => `Paired with ${computer}`,
  pairedRow: 'Paired',
  pairedBody: 'Replying, Stop and typing from this phone go through now.',
  deniedTitle: (computer: string) => `${computer} didn't approve this phone`,
  deniedRow: 'Not approved',
  deniedBody: 'Replying, Stop and typing from this phone still wait for approval there each time.',
  failedTitle: "Couldn't ask to pair this phone",
  askAgain: 'Ask again',
  hide: 'Hide',
  mismatch: 'The computer named different words from this phone, so pairing stopped. Try again.',
  actionDenied: (computer: string) => `You denied this on ${computer}.`,
  actionLapsed: (computer: string) =>
    `This wasn't approved on ${computer} in time. Approve this phone on ${computer} once and it won't have to be.`,
  /** The computer's page under Machines, while this phone isn't approved there. */
  rowLabel: 'Approve this phone',
  rowDetail: (computer: string) =>
    `Not approved on ${computer} yet. Replying, Stop and typing wait for approval there.`,
  rowShow: 'Show',
} as const;

export const ApprovalsCopy = {
  title: (computer: string) => `Approvals on ${computer}`,
  open: 'Approvals',
  empty: 'Nothing is waiting for your approval.',
  askedBy: (label: string) => `Asked by ${label}`,
  approve: 'Approve',
  deny: 'Deny',
  waitingForComputer: 'Approve adding this phone on your computer first. Ghostex shows it there.',
  loadFailed: 'Could not read the requests',
  notApproved: 'Not approved',
  couldNotDeny: 'Could not deny it',
  updateApp: 'This version of Ghostex can’t approve. Update the app.',
  /** The computer's "Require … to approve" switch (its Settings > Security), on a computer that approves plainly. */
  requirePresence: (ios: boolean) => (ios ? 'Require Face ID to approve' : 'Require your fingerprint to approve'),
  requirePresenceFailed: 'Could not change it',
} as const;
