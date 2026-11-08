/**
 * GBots on the phone: Main Hub's GBots section, the same placement the desktop draws
 * (packages/gx-core/src/sidebar_view/gbots.rs). The bots are the projects carrying `gbotsBot` on the computer whose
 * home project (Main Hub) is drawn, by bot name; each bot's chats are its folder's listed sessions, newest first; a bot
 * shows a status dot while any of its chats works or waits. Without a drawn home project, or without a bot, there is
 * no section.
 *
 * CDXC:GBots 2026-11-09 DECISION:
 * User (Q2101 A): GBots show "under Chief of Staff in Main Hub": a GBots group between Chief of Staff and Main Hub's
 * loose sessions, each bot's chats folding under its row like a project's sessions, newest first, a chat Chief of
 * Staff opened carrying a small "Chief" tag. Long press on a bot: New Chat, GBot Settings, Remove GBot; on the GBots
 * heading: New GBot. Hidden with Main Hub, so a bot never shows twice.
 * SEE-ALSO: packages/gx-core/src/sidebar_view/gbots.rs, server/src/gbots/presentation.rs, contract/gbotsFilter.ts (the
 * projects list's half), components/sessions/GbotsRows.tsx (the rows).
 */

import { coordinatorBadges, coordinatorRowKey } from './coordinatorTree';
import { chiefOnIn } from './chief';
import { countSessions, headerStatusCounts, type SectionStatusCounts, type SessionItem } from './grouping';
import {
  visibleSessions,
  type GhostexGbotsBot,
  type GhostexMobileSummary,
  type GhostexProject,
  type GhostexSession,
} from './mobileSummary';

/** The section's heading and the product's name for them. */
export const GBOTS_LABEL = 'GBots';

/** GBots' built-in feature id, as the computer lists it in `builtInFeatures`. */
export const GBOTS_FEATURE = 'gbots';

/** The icon a GBot gets when none is picked (server/src/gbots/record.rs `DEFAULT_ICON`). */
export const GBOT_DEFAULT_ICON = 'robot';

/** A GBot's eight colours, in the order gxserver lists them (server/src/gbots/record.rs `COLORS`). */
export const GBOT_COLORS: readonly { id: string; hex: string }[] = [
  { id: 'periwinkle', hex: '#9fb0ff' },
  { id: 'sky', hex: '#59d9ff' },
  { id: 'mint', hex: '#4ee6b8' },
  { id: 'gold', hex: '#f3cc5f' },
  { id: 'coral', hex: '#ff8b6b' },
  { id: 'lavender', hex: '#d2a7ff' },
  { id: 'pink', hex: '#ff9ee7' },
  { id: 'rose', hex: '#ff5f73' },
];

/** The hex a colour id draws in: periwinkle for anything gxserver would not send. */
export function gbotColorHex(color: string, sent = ''): string {
  if (sent.length > 0) return sent;
  return (GBOT_COLORS.find((entry) => entry.id === color) ?? GBOT_COLORS[0]).hex;
}

/** How much a GBot's chats may do without asking (server/src/gbots/record.rs `APPROVALS`). */
export type GbotApproval = 'ask' | 'edits' | 'auto' | 'full';
export const GBOT_APPROVALS: readonly { value: GbotApproval; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'edits', label: 'Edits' },
  { value: 'auto', label: 'Auto' },
  { value: 'full', label: 'Full' },
];

/** Why a Codex GBot starts at Full (server/src/gbots/session.rs `default_approval`). */
export const GBOT_CODEX_APPROVAL_NOTE =
  "Codex GBots start at Full access: below it, Codex's sandbox stops them reaching Ghostex.";

/** Whether GBots are on for a computer: their own switch and Main Hub (server/src/gbots/feature.rs). */
export function gbotsOnIn(
  summary: Pick<GhostexMobileSummary, 'builtInFeatures' | 'builtInFeaturesOff'> | null | undefined,
): boolean {
  return summary?.builtInFeatures.includes(GBOTS_FEATURE) === true && chiefOnIn(summary);
}

/** The fold key of the GBots heading under `homeProjectKey` (gx-core `gbots_section_storage_id`). */
export function gbotsHeadingKey(homeProjectKey: string): string {
  return `gbots:${homeProjectKey}`;
}

/** One chat under a bot: the session row as the projects list would build it, and who opened it. */
export type GbotChatItem = SessionItem & { openedBy: string };

export type GbotRowModel = {
  bot: GhostexGbotsBot;
  projectId: string;
  /** The bot's fold key (its folder's project key, `id:<projectId>`), open while it is in the expanded projects. */
  projectKey: string;
  collapsed: boolean;
  /** Newest first. */
  chats: GbotChatItem[];
  /** The one status dot: working, attention, question or approval (no counts). */
  status: { workingCount: number; attentionCount: number; questionCount: number; approvalCount: number };
  /** Folded with the open chat inside. */
  containsActive: boolean;
};

export type GbotsSectionModel = {
  /** The heading's fold key (`gbotsHeadingKey`), collapsed while it is in the collapsed session kinds. */
  headingKey: string;
  collapsed: boolean;
  bots: GbotRowModel[];
  /** What the folded heading draws: its dots and the number of GBots. */
  headingStatus: SectionStatusCounts;
};

export type GbotsFoldState = {
  expandedProjectKeys: ReadonlySet<string>;
  collapsedSessionKindKeys: ReadonlySet<string>;
};

/** Newest first: by creation time, the computer's own order between equals. */
function newestFirst(sessions: readonly GhostexSession[]): GhostexSession[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => {
      const byTime = right.session.createdAt.localeCompare(left.session.createdAt);
      return byTime !== 0 ? byTime : left.index - right.index;
    })
    .map(({ session }) => session);
}

/**
 * Main Hub's GBots section for one computer: `summary` is the computer's whole summary (a GBot belongs to no Space or
 * workspace and follows Main Hub wherever it is drawn), `homeProjectId` the drawn home project's. Null without a bot.
 */
export function gbotsSection(input: {
  machineId: string;
  summary: GhostexMobileSummary;
  homeProjectId: string;
  fold: GbotsFoldState;
  /** The session the phone has open on this computer, if any. */
  activeSessionId?: string | null;
  nowMs?: number;
}): GbotsSectionModel | null {
  const { machineId, summary, fold } = input;
  const nowMs = input.nowMs ?? Date.now();
  const botProjects = summary.projects
    .filter((project): project is GhostexProject & { gbotsBot: GhostexGbotsBot } => project.gbotsBot !== undefined)
    .sort(
      (left, right) =>
        left.gbotsBot.name.toLowerCase().localeCompare(right.gbotsBot.name.toLowerCase()) ||
        left.projectId.localeCompare(right.projectId),
    );
  if (botProjects.length === 0) return null;
  const sessions = visibleSessions(summary.sessions);
  const badges = coordinatorBadges(summary.sessions, nowMs);
  const allChats: GhostexSession[] = [];
  const bots = botProjects.map((project): GbotRowModel => {
    const bot = project.gbotsBot;
    const projectKey = `id:${project.projectId}`;
    const own = newestFirst(sessions.filter((session) => session.projectId === project.projectId));
    allChats.push(...own);
    const chats = own.map((session): GbotChatItem => ({
      type: 'SESSION',
      key: `gbot-chat:${projectKey}:${session.sessionId}`,
      machineId,
      projectKey,
      projectId: project.projectId,
      groupId: session.groupId,
      projectTitle: bot.name,
      projectPath: project.path ?? session.projectPath,
      session,
      capabilities: summary.capabilities,
      coordinatorBadge: session.isCoordinator
        ? (badges.get(coordinatorRowKey(session)) ?? { count: 0, tone: 'idle' })
        : undefined,
      openedBy: session.gbotsChat?.openedBy ?? 'user',
    }));
    const counts = headerStatusCounts(countSessions(own, summary.capabilities));
    const collapsed = !fold.expandedProjectKeys.has(projectKey);
    return {
      bot,
      projectId: project.projectId,
      projectKey,
      collapsed,
      chats,
      status: {
        workingCount: counts.workingCount,
        attentionCount: counts.attentionCount,
        questionCount: counts.questionCount,
        approvalCount: counts.approvalCount,
      },
      containsActive:
        collapsed &&
        input.activeSessionId != null &&
        own.some((session) => session.sessionId === input.activeSessionId),
    };
  });
  const headingKey = gbotsHeadingKey(`id:${input.homeProjectId}`);
  const all = headerStatusCounts(countSessions(allChats, summary.capabilities));
  return {
    headingKey,
    collapsed: fold.collapsedSessionKindKeys.has(headingKey),
    bots,
    headingStatus: {
      count: bots.length,
      workingCount: all.workingCount,
      attentionCount: all.attentionCount,
      backgroundWorkCount: 0,
      questionCount: all.questionCount,
      approvalCount: all.approvalCount,
      sessionIds: allChats.map((session) => session.sessionId),
    },
  };
}

/** Whether a chat was opened by Chief of Staff (its row's small "Chief" tag). */
export function openedByChief(chat: Pick<GbotChatItem, 'openedBy'>): boolean {
  return chat.openedBy === 'chief';
}

// ---------------------------------------------------------------------------
// `ghostex gbots … --json` answers.
// ---------------------------------------------------------------------------

/** A GBot as `ghostex gbots show <bot> --json` answers it (`bot`). */
export type GbotDetails = {
  botId: string;
  name: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  agentId: string;
  model: string;
  approval: GbotApproval;
  departmentId: string;
  soul: string;
  /** Set when SOUL.md was changed outside Ghostex: the computer's own sentence. */
  soulDriftMessage: string;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: Record<string, unknown>, key: string): string {
  const raw = value[key];
  return typeof raw === 'string' ? raw : '';
}

export function parseGbotDetails(json: unknown): GbotDetails | null {
  const bot = record(record(json).bot);
  const botId = text(bot, 'botId');
  if (botId.length === 0) return null;
  const approval = text(bot, 'approval');
  return {
    botId,
    name: text(bot, 'name'),
    title: text(bot, 'title'),
    description: text(bot, 'description'),
    icon: text(bot, 'icon') || GBOT_DEFAULT_ICON,
    color: text(bot, 'color') || GBOT_COLORS[0].id,
    agentId: text(bot, 'agentId'),
    model: text(bot, 'model'),
    approval: GBOT_APPROVALS.some((entry) => entry.value === approval) ? (approval as GbotApproval) : 'ask',
    departmentId: text(bot, 'departmentId'),
    soul: text(bot, 'soul'),
    soulDriftMessage: text(bot, 'soulDriftMessage'),
  };
}

/** The chat `ghostex gbots new-chat <bot> --json` opened (`chat`, server/src/gbots/session.rs `chat_summary`). */
export function parseGbotNewChat(json: unknown): { projectId: string; sessionId: string; title: string } | null {
  const chat = record(record(json).chat);
  const sessionId = text(chat, 'sessionId');
  return sessionId.length === 0 ? null : { projectId: text(chat, 'projectId'), sessionId, title: text(chat, 'title') };
}

/** What an edit or create sends: only the fields that changed (an edit) or were given (a create). */
export type GbotFields = Partial<{
  name: string;
  title: string;
  description: string;
  soul: string;
  icon: string;
  color: string;
  agentId: string;
  model: string;
  approval: GbotApproval;
}>;

/** The fields of `next` that differ from `saved`. */
export function changedGbotFields(saved: GbotDetails, next: Required<GbotFields>): GbotFields {
  const changed: GbotFields = {};
  const keys = ['name', 'title', 'description', 'soul', 'icon', 'color', 'agentId', 'model', 'approval'] as const;
  for (const key of keys) {
    if (next[key].trim() !== saved[key].trim()) (changed as Record<string, string>)[key] = next[key];
  }
  return changed;
}
