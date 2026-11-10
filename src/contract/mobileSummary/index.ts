/**
 * TypeScript contract for the `ghostex sessions --json --mobile-summary` payload.
 * Source of truth: docs/specs/sessions-drawer.md §7, mirrored from the Android
 * reference implementation (GhostexRemoteSession / GhostexWorkspaceInventory).
 *
 * Split by concern into the files beside this one; this barrel keeps every importer's
 * path (`contract/mobileSummary`), including scripts/generate-chat-agents.mjs.
 */

export type { MobileSummaryWireRoot, MobileSummaryWireSession } from './wire';
export { EMPTY_CUSTOM_SESSION_TAGS, EMPTY_SIDEBAR_SPACES } from './model';
export type {
  GhostexAgentLauncher,
  GhostexCustomSessionTag,
  GhostexCustomSessionTags,
  GhostexGbotsBot,
  GhostexGbotsChat,
  GhostexGbotsComputer,
  GhostexProject,
  GhostexProjectCollection,
  GhostexProjectIcon,
  GhostexQuickAction,
  GhostexRecentProject,
  GhostexSessionActions,
  GhostexSessionCloudBox,
  GhostexSessionGroup,
  GhostexSessionLink,
  GhostexSessionLinks,
  GhostexSessionWork,
  GhostexSidebarSpace,
  GhostexSidebarSpaces,
  GhostexWorkspace,
  GhostexWorkspaceGroups,
  GhostexWorkspaces,
  QuickActionScope,
} from './model';
export { NO_SUMMARY_CAPABILITIES, hasQuestion, visibleSessions } from './session';
export type { GhostexAttentionKind, GhostexMobileSummary, GhostexSession, GhostexSummaryCapabilities } from './session';
export { displayStatus, normalizeStatusToken } from './status';
export { formatLastActive } from './recency';
export {
  AGENT_NAME_ALIASES,
  agentIconTint,
  isCustomAgentId,
  resolveAgentArtId,
  resolveAgentIconId,
  sessionAgentName,
} from './agentIcons';
export type { AgentArtId, AgentIconId } from './agentIcons';
export { scanJsonObjects } from './jsonScan';
export { linkKind, parseSession } from './parseSession';
export {
  parseCustomSessionTags,
  parseMobileSummary,
  parseProjectCollections,
  parseSidebarSpaces,
  parseWorkspaces,
  withoutGlobalQuickActions,
} from './parseSummary';
