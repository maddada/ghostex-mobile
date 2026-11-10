/**
 * Recency formatting (spec §2).
 * Part of the mobile summary contract (`./index.ts`).
 */

// ---------------------------------------------------------------------------
// Recency formatting (spec §2).
// ---------------------------------------------------------------------------

/**
 * <60s "{n}s ago" (min 1); <60m "{n}m ago"; <48h "{n}h ago"; else "{n}d ago";
 * unparseable → "Unknown".
 */
export function formatLastActive(iso: string, now: Date): string {
  const trimmed = iso.trim();
  if (trimmed.length === 0) return 'Unknown';
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return 'Unknown';
  const elapsedSeconds = Math.max(1, Math.floor((now.getTime() - timestamp) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
