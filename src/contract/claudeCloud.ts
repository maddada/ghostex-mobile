/**
 * A Claude cloud session on the phone: the record the computer sends with its row
 * (`claudeCloud`, gx-protocol `PresentationClaudeCloud`) and what tapping the row opens.
 *
 * CDXC:ClaudeCloud 2026-10-23 DECISION:
 * User (Q411): the phone shows cloud sessions' rows too, after the computer. Tapping one opens
 * Claude's page for the session while the session runs on claude.ai, the same rule as the
 * desktop's row click (gx-core `session_claude_cloud_page`); in any other state the row opens like
 * every row.
 *
 * CDXC:ClaudeCloud 2026-10-29 DECISION:
 * User, asked "A Claude cloud session's sidebar row now starts with the orange cloud and still has a grey cloud after its title. Keep the grey one?" (Q753): "Drop the grey cloud". The row's leading orange cloud (the Claude (cloud) agent's icon) is its only cloud mark, and that icon slot carries the "Runs in Claude's cloud" accessibility label the grey glyph had (SessionRow.tsx). Supersedes the 2026-10-23 grey glyph kept in every state.
 *
 * CDXC:ClaudeCloud 2026-10-26 DECISION:
 * User, asked how the phone follows the computer's cloud chat (the first message typed in Chat View starts the session, then the computer's chat pane shows its claude.ai page): "Swap A (long press to see terminal, tap to open claude.ai)". A cloud session waiting for its task (or whose start failed) opens its chat, whatever the Default Agent View, and the first message sent there starts it (gxserver routes the send, server/src/claude_cloud/chat.rs). Once it exists on claude.ai, a tap opens its page and the long-press menu's Open Terminal shows its terminal, where Ghostex's cloud client shows the conversation and sends follow-ups. Supersedes "No, tap is enough" (no long-press cloud actions) from 2026-10-23.
 *
 * CDXC:ClaudeCloud 2026-10-23 WHY:
 * The page opens through Android's own link handling (the Claude app when it takes claude.ai links,
 * else the browser the user is signed in to claude.ai with), not an in-app web view: a web view on
 * the phone has no claude.ai sign-in, and Google refuses to sign in inside embedded web views.
 *
 * SEE-ALSO: packages/gx-core/src/claude_cloud.rs (the desktop's rule),
 * server/src/ghostex_cli/sessions/mobile_summary.rs (forwards the record).
 */

export type GhostexClaudeCloud = {
  /** `draft`, `starting`, `running`, `failed` or `moved` (brought to the computer). */
  state: string;
  /** `https://claude.ai/code/session_…` once the session exists, else ''. */
  url: string;
  branch: string;
  statusText: string;
  accountName: string;
  limitNotice: string;
};

/** The record as the summary forwards it, or undefined for a session that is not a cloud one. */
export function parseClaudeCloud(value: unknown): GhostexClaudeCloud | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string).trim() : '');
  const state = text('state');
  if (state.length === 0) return undefined;
  return {
    state,
    url: text('url'),
    branch: text('branch'),
    statusText: text('statusText'),
    accountName: text('accountName'),
    limitNotice: text('limitNotice'),
  };
}

/** The claude.ai page a tap on the row opens, or null when the row opens like any other. */
export function claudeCloudPageUrl(cloud: GhostexClaudeCloud | undefined): string | null {
  if (cloud === undefined || cloud.state !== 'running') return null;
  return cloud.url.startsWith('https://claude.ai/code/') ? cloud.url : null;
}

/** Whether the session's chat takes its task: it waits for one, or its start failed. */
export function claudeCloudTakesTask(cloud: GhostexClaudeCloud | undefined): boolean {
  return cloud !== undefined && (cloud.state === 'draft' || cloud.state === 'failed');
}

/**
 * Whether Close on the row puts the session to sleep instead of closing it: the session exists (or
 * is being created) on claude.ai, so the row stays listed, asleep ("Keep it listed, asleep"). The
 * caller adds that the session is awake; Close on an asleep row closes it as before. gxserver's rule
 * (server/src/claude_cloud/record.rs `close_keeps_session_asleep`, which holds the DECISION).
 */
export function claudeCloudCloseSleeps(cloud: GhostexClaudeCloud | undefined): boolean {
  return cloud !== undefined && (cloud.state === 'starting' || cloud.state === 'running');
}
