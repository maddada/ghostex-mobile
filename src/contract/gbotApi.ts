/**
 * A GBot's API as `ghostex gbots api … --json` answers it (server/src/gbots/api/ops.rs): whether apps may message it,
 * its key's label and use, the command to paste and who can reach it. `key` is set only in the answer of turning it on
 * or a new key: the computer keeps the key's fingerprint only, so it is never read back.
 */

export type GbotApi = {
  on: boolean;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  uses: number;
  /** Its chats for apps may read the GBot's memory and the shared preferences. */
  shareMemory: boolean;
  /** The command to paste, with the key filled in when `key` is set, else a stand-in for it. */
  command: string;
  reach: string;
  /** The key, only right after it was made. */
  key: string;
};

type Json = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function record(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

export function parseGbotApi(answer: unknown): GbotApi | null {
  const root = record(answer);
  const api = record(root?.api);
  if (root === null || api === null) return null;
  const key = record(api.key);
  return {
    on: api.on === true,
    label: text(key?.label),
    createdAt: text(key?.createdAt),
    lastUsedAt: text(key?.lastUsedAt),
    uses: typeof key?.uses === 'number' ? key.uses : 0,
    shareMemory: key?.shareMemory === true,
    command: text(api.command),
    reach: text(api.reach),
    key: text(root.key),
  };
}

/** "2026-11-09T08:12:40.000Z" as "9 Nov, 08:12" (as the desktop's Bot API tab says it). */
export function gbotApiWhen(at: string): string {
  const [date = '', rest = ''] = at.split('T');
  const [, month = '', day = ''] = date.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = months[Number(month) - 1];
  if (name === undefined || day.length === 0) return at;
  return `${Number(day)} ${name}, ${rest.slice(0, 5)}`;
}
