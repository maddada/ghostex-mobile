/**
 * A work-mode session card's second line, as data: the PR, the Linear or GitHub issues and the
 * Linear project or GitHub project the session is linked to, plus the merged-PR Clean up / Keep
 * offer.
 *
 * CDXC:WorkMode 2026-10-09 SEE-ALSO:
 * The chips, their order, glyphs, colors and labels follow the desktop's
 * apps/desktop/src/app/native_sidebar/work_chips.rs; what they read comes from gxserver
 * (server/src/work_mode/presentation.rs) through the mobile summary's `work`.
 */

import type { GhostexSessionWork } from '../../contract/mobileSummary';
import { SidebarPalette } from '../../theme/palette';

export type WorkChipGlyph =
  | 'pullRequest'
  | 'merged'
  | 'checksPassing'
  | 'checksFailing'
  | 'checksPending'
  | 'issueOpen'
  | 'issueClosed'
  | 'linearStarted'
  | 'linearReview'
  | 'linearDone'
  | 'linearCanceled'
  | 'linearBacklog'
  | 'linearCircle'
  | 'linearProject'
  | 'cleanUp'
  | 'keep';

export type WorkChip = {
  key: string;
  glyph: WorkChipGlyph;
  glyphColor: string;
  label: string;
  /** The PR's checks mark, drawn after the number. */
  trailing?: { glyph: WorkChipGlyph; color: string };
  /** What a tap opens and a long press copies; '' for the offer's two chips. */
  url: string;
  /** The offer's answer a tap sends instead of opening a link. */
  cleanupAnswer?: 'cleanUp' | 'keep';
  /** What the desktop shows as the chip's tooltip; the phone reads it out as its label. */
  description: string;
};

const PR_STATE: Record<string, { glyph: WorkChipGlyph; color: string; label: string }> = {
  draft: { glyph: 'pullRequest', color: SidebarPalette.WORK_DRAFT, label: 'Draft' },
  merged: { glyph: 'merged', color: SidebarPalette.WORK_MERGED, label: 'Merged' },
  closed: { glyph: 'pullRequest', color: SidebarPalette.WORK_CLOSED, label: 'Closed' },
};

const PR_CHECKS: Record<string, { glyph: WorkChipGlyph; color: string; label: string }> = {
  passing: { glyph: 'checksPassing', color: SidebarPalette.WORK_OPEN, label: 'checks passing' },
  failing: { glyph: 'checksFailing', color: SidebarPalette.WORK_CLOSED, label: 'checks failing' },
  pending: { glyph: 'checksPending', color: SidebarPalette.WORK_PENDING, label: 'checks running' },
};

/**
 * Linear's status ring for a workflow state (work_chips.rs `linear_glyph`): empty or dashed before
 * work starts, half while it runs, three-quarters in review, a filled check when done, a cross when
 * cancelled, and the plain ring in Linear's color until Linear has answered.
 */
function linearGlyph(stateType: string, stateName: string): { glyph: WorkChipGlyph; color: string } {
  const inReview = stateName.toLowerCase().includes('review');
  switch (stateType) {
    case 'started':
      return inReview
        ? { glyph: 'linearReview', color: SidebarPalette.WORK_REVIEW }
        : { glyph: 'linearStarted', color: SidebarPalette.WORK_STARTED };
    case 'completed':
      return { glyph: 'linearDone', color: SidebarPalette.WORK_DONE };
    case 'canceled':
      return { glyph: 'linearCanceled', color: SidebarPalette.WORK_DRAFT };
    case 'backlog':
    case 'triage':
      return { glyph: 'linearBacklog', color: SidebarPalette.WORK_DRAFT };
    case '':
      return { glyph: 'linearCircle', color: SidebarPalette.WORK_LINEAR };
    default:
      return { glyph: 'linearCircle', color: SidebarPalette.WORK_DRAFT };
  }
}

function joinParts(parts: readonly string[]): string {
  return parts.filter((part) => part.trim().length > 0).join(' · ');
}

/** The chips a session's card draws, in the desktop's order; empty keeps the card one line. */
export function workChips(work: GhostexSessionWork | undefined): WorkChip[] {
  if (work === undefined) return [];
  const chips: WorkChip[] = [];
  const prNumber = work.pullRequestNumber;
  if (prNumber !== null) {
    const state = PR_STATE[work.pullRequestState] ?? {
      glyph: 'pullRequest' as const,
      color: SidebarPalette.WORK_OPEN,
      label: 'Open',
    };
    const checks = PR_CHECKS[work.pullRequestChecks];
    chips.push({
      key: 'pr',
      glyph: state.glyph,
      glyphColor: state.color,
      label: `#${prNumber}`,
      trailing: checks === undefined ? undefined : { glyph: checks.glyph, color: checks.color },
      url: work.pullRequestUrl,
      description: joinParts([`PR #${prNumber}`, state.label, checks?.label ?? '']),
    });
  }
  if (work.offerCleanup) {
    chips.push({
      key: 'cleanup',
      glyph: 'cleanUp',
      glyphColor: SidebarPalette.WORK_MERGED,
      label: 'Clean up',
      url: '',
      cleanupAnswer: 'cleanUp',
      description: `PR #${prNumber ?? ''} is merged. Remove this session's worktree and park the session.`,
    });
    chips.push({
      key: 'keep',
      glyph: 'keep',
      glyphColor: SidebarPalette.MUTED,
      label: 'Keep',
      url: '',
      cleanupAnswer: 'keep',
      description: "Keep this session and its worktree. Ghostex won't ask again for this PR.",
    });
  }
  const firstLinear = work.linearIssues[0];
  if (firstLinear !== undefined) {
    const { glyph, color } = linearGlyph(firstLinear.stateType, firstLinear.stateName);
    const extra = work.linearIssues.length - 1;
    chips.push({
      key: 'linear',
      glyph,
      glyphColor: color,
      label: extra > 0 ? `${firstLinear.identifier} +${extra}` : firstLinear.identifier,
      url: firstLinear.url,
      description: work.linearIssues
        .map((issue) => joinParts([issue.identifier, issue.title, issue.stateName]))
        .join('\n'),
    });
  }
  const firstIssue = work.githubIssues[0];
  if (firstIssue !== undefined) {
    const open = firstIssue.state !== 'closed';
    const extra = work.githubIssues.length - 1;
    chips.push({
      key: 'issue',
      glyph: open ? 'issueOpen' : 'issueClosed',
      glyphColor: open ? SidebarPalette.WORK_OPEN : SidebarPalette.WORK_MERGED,
      label: extra > 0 ? `#${firstIssue.number} +${extra}` : `#${firstIssue.number}`,
      url: firstIssue.url,
      description: work.githubIssues
        .map((issue) =>
          joinParts([`Issue #${issue.number}`, issue.title, issue.state === 'closed' ? 'Closed' : 'Open']),
        )
        .join('\n'),
    });
  }
  if (work.linearProjectName.length > 0) {
    chips.push({
      key: 'linear-project',
      glyph: 'linearProject',
      glyphColor: SidebarPalette.WORK_LINEAR,
      label: work.linearProjectName,
      url: work.linearProjectUrl,
      description: `Linear project: ${work.linearProjectName}`,
    });
  }
  /*
   * CDXC:WorkMode 2026-10-09 DECISION:
   * User: in a workspace whose tracker is GitHub, the phone matches the desktop: the card shows the GitHub Project chip (work_chips.rs `github-project`). gxserver sends `githubProject` instead of the Linear project only for such a workspace, so the chip draws whenever it is there.
   */
  if (work.githubProjectName.length > 0) {
    chips.push({
      key: 'github-project',
      glyph: 'linearProject',
      glyphColor: SidebarPalette.WORK_DRAFT,
      label: work.githubProjectName,
      url: work.githubProjectUrl,
      description: joinParts([`GitHub project: ${work.githubProjectName}`, work.githubProjectStatus]),
    });
  }
  return chips;
}
