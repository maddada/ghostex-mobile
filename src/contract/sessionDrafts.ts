type DraftSession = {
  createdAt?: string;
  isDraft?: boolean;
  isPinned?: boolean;
  hasComposerDraft?: boolean;
};

/**
 * CDXC:Drafts 2026-09-15 SEE-ALSO:
 * packages/shared/session-drafts.ts owns the 10-minute grace period and Drafts membership shared by desktop and web; keep this standalone mobile contract aligned.
 */
export const NEW_SESSION_PRIORITY_MS = 10 * 60 * 1_000;

export function newSessionPriorityExpiresAt(session: DraftSession | undefined): number {
  return Date.parse(session?.createdAt ?? '') + NEW_SESSION_PRIORITY_MS;
}

export function isNewSidebarSession(session: DraftSession | undefined, nowMs: number = Date.now()): boolean {
  return newSessionPriorityExpiresAt(session) > nowMs;
}

export function isSidebarDraftSectionSession(
  session: DraftSession | undefined,
  nowMs: number = Date.now()
): boolean {
  return (
    session?.isDraft === true &&
    session.isPinned !== true &&
    session.hasComposerDraft === true &&
    !isNewSidebarSession(session, nowMs)
  );
}
