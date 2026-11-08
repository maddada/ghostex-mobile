/**
 * A GBot's memory as `ghostex gbots memory show --json` answers it (server/src/gbots/memory/ops.rs `show`): MEMORY.md
 * with how full it is against what loads at the start of a chat (200 lines, 24 KB), what else loads, the topic notes,
 * the daily log and the journal of changes.
 * SEE-ALSO: the desktop's window/gbot_settings_modal/memory_model.rs (the same answer, parsed for the Memory tab).
 */

export type GbotMemoryLevel = 'ok' | 'amber' | 'red';

export type GbotMemoryChange = {
  id: string;
  at: string;
  by: string;
  what: string;
  undone: boolean;
  /** The newest change not undone yet, whose files still read as it left them. */
  undoable: boolean;
};

export type GbotMemory = {
  text: string;
  lines: number;
  bytes: number;
  maxLines: number;
  maxBytes: number;
  share: number;
  level: GbotMemoryLevel;
  archiveNotes: number;
  instructionsLines: number;
  preferencesLines: number;
  topicsIndexed: number;
  team: number;
  topics: { name: string; title: string; description: string; bytes: number }[];
  log: { date: string; lines: string[] }[];
  changes: GbotMemoryChange[];
  today: string;
};

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The memory in a `memory show` answer; null when it has none. */
export function parseGbotMemory(json: unknown): GbotMemory | null {
  const answer = record(json);
  if (typeof answer.memory !== 'object' || answer.memory === null) return null;
  const memory = record(answer.memory);
  const loads = record(answer.loads);
  const level = text(memory.level);
  return {
    text: text(memory.text),
    lines: count(memory.lines),
    bytes: count(memory.bytes),
    maxLines: Math.max(1, count(memory.maxLines)),
    maxBytes: Math.max(1, count(memory.maxBytes)),
    share: count(memory.share),
    level: level === 'red' || level === 'amber' ? level : 'ok',
    archiveNotes: count(record(answer.archive).notes),
    instructionsLines: count(loads.instructionsLines),
    preferencesLines: count(loads.preferencesLines),
    topicsIndexed: count(loads.topicsIndexed),
    team: count(loads.team),
    topics: list(answer.topics).map((item) => {
      const topic = record(item);
      return {
        name: text(topic.name),
        title: text(topic.title),
        description: text(topic.description),
        bytes: count(topic.bytes),
      };
    }),
    log: list(answer.log).map((item) => {
      const day = record(item);
      return { date: text(day.date), lines: list(day.lines).map(text) };
    }),
    changes: list(answer.journal).map((item) => {
      const change = record(item);
      return {
        id: text(change.id),
        at: text(change.at),
        by: text(change.byLabel),
        what: text(change.what),
        undone: change.undone === true,
        undoable: change.undoable === true,
      };
    }),
    today: text(answer.today),
  };
}

/** "34 of 200 lines · 3.1 of 24 KB". */
export function gbotMemoryGaugeLabel(memory: GbotMemory): string {
  return `${memory.lines} of ${memory.maxLines} lines · ${(memory.bytes / 1024).toFixed(1)} of ${Math.round(
    memory.maxBytes / 1024,
  )} KB`;
}

/** A journal time as the phone's local "9 Nov, 14:05". */
export function gbotMemoryWhen(iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return iso;
  const day = time.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const clock = time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${clock}`;
}
