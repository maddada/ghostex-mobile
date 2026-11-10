/**
 * The normalized model's project, launcher, workspace and session-link types.
 * Part of the mobile summary contract (`./index.ts`).
 */

// ---------------------------------------------------------------------------
// Normalized model.
// ---------------------------------------------------------------------------

/**
 * The project identity a row renders, mirroring SidebarV2ProjectIcon's
 * resolution chain: a user-attached image, then the icon the project's own
 * repository ships (discovered server-side), then a typed Tabler glyph, then a
 * folder/worktree fallback.
 */
export type GhostexProjectIcon = {
  /** Hand-attached image; wins over everything else. */
  imageDataUrl: string;
  /** The repository's own favicon/app icon, discovered by gxserver. */
  discoveredIconDataUrl: string;
  /** SIDEBAR_COMMAND_ICON_IDS glyph name, or "" when none is set. */
  glyph: string;
  /** "#rrggbb" tint for the glyph, or "" for the default foreground. */
  glyphColor: string;
  /** True when the project is a git worktree (changes the fallback glyph). */
  isWorktree: boolean;
};

export type GhostexProject = {
  projectId: string;
  name?: string;
  path?: string;
  /** The project at the computer's home folder, whose header is Main Hub's row (server/src/chief/home.rs). */
  isHome?: boolean;
  /**
   * A GBot's folder (`gbotsProject`, server/src/gbots/presentation.rs), sent whether GBots are on or off: never one of
   * the user's projects, so no projects list, Space, picker or Unified list shows it (contract/gbots.ts).
   */
  gbotsProject?: boolean;
  /** The GBot this project is the folder of (`gbotsBot`), only while GBots are on: drawn as its row under Main Hub. */
  gbotsBot?: GhostexGbotsBot;
  icon: GhostexProjectIcon;
  /** Workspace theme color ("#rrggbb"), or "": tints the project rail. */
  themeColor: string;
  /**
   * `worktree.parentProjectId` for a git worktree, "" otherwise. Space
   * membership is never assigned to a worktree directly: it defers to this
   * parent (see src/spaces/otherSpace.ts).
   */
  worktreeParentProjectId: string;
  /**
   * Issues Workflow (formerly Work mode) is on for this project: a Linear key applies to it or `gh`
   * is signed in on the computer (`workMode: true` on the wire, absent when off). Its sessions get
   * Link to.
   */
  workMode?: boolean;
  /** Issues Workflow's Linear parts are on: a Linear key applies (`workLinear: true` on the wire). */
  workLinear?: boolean;
  /**
   * Issues Workflow's GitHub parts are off: `gh` is not signed in on the computer
   * (`workGithubOff: true` on the wire). A computer too old to send it had no such rule, so its
   * absence means they are on.
   */
  workGithubOff?: boolean;
  /**
   * The primary tracker of the project's workspace while Issues Workflow is on (gx-protocol
   * `PresentationProject.work_tracker`): `github` makes Link to offer GitHub issues and projects
   * instead of Linear's. Absent when it is off or the computer does not send it (Linear).
   */
  workTracker?: 'linear' | 'github';
  /** The worktree's name and branch, which Copy Details quotes; absent for a plain project. */
  worktree?: { name: string; branch: string };
  /** `launchSettings.workspaceId`; absent = the default workspace (a worktree follows its parent's). */
  workspaceId?: string;
  /** Shown in every workspace (the Ghostex config folder's project, where Help chats live). */
  everyWorkspace?: boolean;
  /**
   * The project's git origin as the computer probed it, raw; the Unified list names the project by
   * its repository from it (contract/unified/repo.ts). Absent without a remote or from an older computer.
   */
  gitRemoteOriginUrl?: string;
  /**
   * The computer's probe found the project's folder in a git work tree: it sent
   * `gitRemoteOriginUrl`, a URL or `null` for a repository with no remote. `false` for a plain
   * folder (and for one the probe has not reached yet, the first minutes after gxserver starts).
   */
  gitWorkTree?: boolean;
  /**
   * The root of the git repository the project's folder is in, as the computer probed it; the
   * Project list tells one repository's folders apart by it (contract/grouping.ts). Absent outside
   * a repository or from an older computer.
   */
  gitRepositoryRootPath?: string;
};

/** A GBot's look and place, as the computer publishes it on its project (`gbotsBot`). */
export type GhostexGbotsBot = {
  id: string;
  name: string;
  title: string;
  /** A desktop titlebar icon name (apps/desktop/assets/titlebar/<icon>.svg), `robot` by default. */
  icon: string;
  color: string;
  /** "#rrggbb" for `color`; "" when the computer sent none. */
  colorHex: string;
  agentId: string;
  departmentId?: string;
  /** Its department's name, icon and place, for Main Hub's department sub-headings (server/src/gbots/presentation.rs). */
  departmentName?: string;
  departmentIcon?: string;
  departmentOrder?: number;
  isLead?: boolean;
  paused?: boolean;
  /** Where its chats run when not on that computer, or that it may use the screen (server/src/gbots/computer/). */
  computer?: GhostexGbotsComputer;
};

/** Where a GBot's chats run (`gbotsBot.computer`): a connected computer or a Cloud Box, by name. */
export type GhostexGbotsComputer = { kind: 'this' | 'computer' | 'cloudBox'; name: string; computerUse: boolean };

/** A GBot chat's bot and who opened it (`gbotsChat`): `user`, `chief`, later others. */
export type GhostexGbotsChat = { botId: string; openedBy: string };

export type GhostexRecentProject = {
  projectId: string;
  title?: string;
  path?: string;
  sessionCount?: number;
};

export type GhostexAgentLauncher = {
  agentId: string;
  icon?: string;
  name?: string;
};

export type GhostexQuickAction = {
  actionType: 'browser' | 'terminal';
  commandId?: string;
  url?: string;
  icon?: string;
  name?: string;
};

/**
 * Which list an action comes from: the project's own (`quickActionsByProject`) or the computer's Global Actions
 * (`globalQuickActions`). A project action and a Global Action can share a commandId, so the scope and the
 * commandId together identify an action.
 */
export type QuickActionScope = 'project' | 'global';

export type GhostexSessionGroup = {
  groupId: string;
  title: string;
  sessionIds: string[];
};

export type GhostexWorkspaceGroups = {
  projectOrder?: string[];
  projects?: Record<string, { groups?: { groupId: string; title?: string; sessionIds?: string[] }[] }>;
};

/**
 * Colored project collection ("Group N") mirrored from the desktop sidebar.
 * Collections render before ungrouped projects, in this array order.
 */
export type GhostexProjectCollection = {
  collectionId: string;
  title: string;
  /** "#rrggbb" (desktop SIDEBAR_PROJECT_COLLECTION_COLORS). */
  color: string;
  projectIds: string[];
};

/**
 * One saved sidebar filter, mirroring `SidebarSpace` in
 * packages/core-ui/spaces.ts. Members are project collections ("groups") and
 * ungrouped projects; either may belong to any number of Spaces, and member ids
 * that resolve to nothing are tolerated because gxserver prunes them
 * asynchronously.
 */
export type GhostexSidebarSpace = {
  spaceId: string;
  name: string;
  /** SIDEBAR_COMMAND_ICON_IDS glyph name; the server defaults it to "stack". */
  icon: string;
  /** "#rrggbb"; the server defaults it to "#4f5663". */
  color: string;
  memberCollectionIds: string[];
  memberProjectIds: string[];
  /** The workspace this Space belongs to; absent = the default workspace. */
  workspaceId?: string;
};

/** Ordered Space set for one machine. Empty `order` means the daemon has none. */
export type GhostexSidebarSpaces = {
  order: string[];
  spaces: Record<string, GhostexSidebarSpace>;
};

export const EMPTY_SIDEBAR_SPACES: GhostexSidebarSpaces = { order: [], spaces: {} };

/**
 * One user-defined session tag, mirroring `CustomSessionTag` in
 * packages/shared/session-tags.ts. gxserver owns the catalog per daemon and
 * ships the resolved hex color and icon id, so the phone needs no palette mirror.
 */
export type GhostexCustomSessionTag = {
  /** `custom-` plus a random token; the value a session's `sessionTag` stores. */
  tagId: string;
  name: string;
  /** SIDEBAR_COMMAND_ICON_IDS glyph name (COMMAND_ICONS on the phone). */
  icon: string;
  /** "#rrggbb". */
  color: string;
};

/** Ordered custom tag catalog for one machine. Empty `order` means the daemon has none. */
export type GhostexCustomSessionTags = {
  order: string[];
  tags: Record<string, GhostexCustomSessionTag>;
};

export const EMPTY_CUSTOM_SESSION_TAGS: GhostexCustomSessionTags = { order: [], tags: {} };

/**
 * One of the computer's workspaces (gx-protocol `SidebarWorkspace`): a company (`work`) or
 * Personal, each with its own projects and Spaces.
 */
export type GhostexWorkspace = {
  workspaceId: string;
  name: string;
  /** "#rrggbb" the workspace tile is filled with. */
  color: string;
  /** The one character drawn on the tile. */
  letter: string;
  /** `work` or `personal`. */
  kind: string;
};

/** The computer's workspaces (gx-protocol `SidebarWorkspacesState`). */
export type GhostexWorkspaces = {
  /** The workspace a project or Space with no (or an unknown) `workspaceId` belongs to. */
  defaultWorkspaceId: string;
  /** Display order; every id names a workspace in `workspaces`. */
  order: string[];
  workspaces: Record<string, GhostexWorkspace>;
};

export type GhostexSessionActions = {
  acknowledgeAttention: boolean;
  attach: boolean;
  focus: boolean;
  kill: boolean;
  readText: boolean;
  sendMessage: boolean;
  sendText: boolean;
  sleep: boolean;
  wake: boolean;
};

/** One PR, GitHub issue, Linear ticket or other ticket a session is linked to (`GxserverPresentationSessionLink`). */
export type GhostexSessionLink = {
  /** `pr:owner/repo#318`, `issue:owner/repo#305`, `linear:GHX-142` or `fixture:ACM-12`: what removing it sends. */
  key: string;
  /** `ticket` is any other source's ticket (a workspace's ticket command, whose id is its wire kind). */
  kind: 'pullRequest' | 'issue' | 'linear' | 'ticket';
  /** `#318`, `repo#12` or `GHX-142`. */
  label: string;
  title: string;
  /** A PR's `open|draft|merged|closed`, an issue's `open|closed`, a Linear state type; '' until read. */
  state: string;
  stateName: string;
  checks: string;
  review: string;
  url: string;
  /** Where it came from (`branch`, `closes`, `user`…); only `closes` shows, as `sourceLabel`. */
  source: string;
  sourceLabel: string;
  finished: boolean;
  /** A person pinned it: gxserver lists it first and every sidebar option but Off shows it. */
  pinned: boolean;
  /** Never read yet, with a read on its way: the sheet says "Loading…" and keeps it out of Open. */
  loading: boolean;
  /** A pull request's branch (`headRefName`); '' otherwise or until read. */
  branch: string;
};

/** A session's links, open work first, and the PR and issue URLs its chat only mentioned. */
export type GhostexSessionLinks = {
  items: GhostexSessionLink[];
  /** Drawn like linked ones: `sourceLabel` is "Mentioned in the chat"; no checks or review. */
  suggested: GhostexSessionLink[];
  /** Links a person removed, newest first, which the sheet offers to restore; `sourceLabel` says
   * where each came from (or "Removed"). */
  removed: GhostexSessionLink[];
};

/**
 * The links of a work-mode session that the Copy submenu copies (gx-core `SessionWork`); every
 * field is empty when the session has no such link.
 */
export type GhostexSessionWork = {
  branch: string;
  pullRequestUrl: string;
  /** The linked PR's number, or null; the Link to submenu shows it as `#123`. */
  pullRequestNumber: number | null;
  /** `open`, `draft`, `merged` or `closed`; empty without a PR. */
  pullRequestState: string;
  /** `passing`, `failing` or `pending`; empty until the checks were read. */
  pullRequestChecks: string;
  linearIssues: {
    identifier: string;
    url: string;
    title: string;
    /** Linear's workflow state type (`started`, `completed`, ...); empty until Linear answered. */
    stateType: string;
    /** The team's own name for the state, e.g. "In Review". */
    stateName: string;
  }[];
  /** `state` is `open` or `closed`. */
  githubIssues: { number: number; title: string; state: string; url: string }[];
  githubIssueUrls: string[];
  githubIssueNumbers: number[];
  linearProjectName: string;
  linearProjectUrl: string;
  /**
   * A GitHub Project (gx-protocol `PresentationWorkGithubProject`), sent instead of the Linear
   * project when the workspace's primary tracker is GitHub: its title, else `owner/number`.
   */
  githubProjectName: string;
  githubProjectUrl: string;
  /** The item's Status on the GitHub project board; empty until `gh` read it. */
  githubProjectStatus: string;
  /** Some link was set by hand, so Back to automatic has something to undo. */
  handSet: boolean;
  /** The linked PR is merged and its Clean up / Keep offer is unanswered. */
  offerCleanup: boolean;
};

/**
 * A session on a Cloud Box (`PresentationCloudBox`, plus where the phone reaches it). A box's
 * sessions are listed inside their home project: `projectId` is then the home project and
 * `boxProjectId` the box's own, which every request to the box uses; `machineId` is the box's
 * hidden machine (`cloudbox:<boxId>`).
 */
export type GhostexSessionCloudBox = {
  boxId: string;
  provider: string;
  state: string;
  boxName: string;
  homeProjectId?: string;
  /** A home draft whose tray picked Cloud Box: its first message starts the box. */
  pending?: true;
  machineId?: string;
  boxProjectId?: string;
  startedAt?: string;
  costTotalUsd?: number;
  usdPerHour?: number;
};
