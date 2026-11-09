/**
 * Team files and presets on the phone (server/src/gbots/team_file/): what `ghostex gbots team import --dry-run --json`,
 * `team import --json`, `team export --json` and `preset list --json` answer, read into plain shapes the sheets draw.
 * The rules (names taken get " 2", routines arrive paused, what a file may hold) are gxserver's; this only reads them.
 */

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === 'string');
}

export type TeamBotRow = {
  name: string;
  renamedFrom: string | null;
  title: string;
  icon: string;
  colorHex: string;
  department: string | null;
  isLead: boolean;
  detail: string;
};

export type TeamPreview = {
  kind: 'team' | 'preset';
  name: string;
  summary: string;
  bots: TeamBotRow[];
  departments: { name: string; detail: string }[];
  routines: { name: string; detail: string }[];
  approvalSentence: string;
  /** Titled lists under the rows: left out, ignored, names, warnings, problems. */
  lists: { title: string; lines: string[]; danger: boolean }[];
  canImport: boolean;
  hasProblems: boolean;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function botRow(raw: unknown): TeamBotRow {
  const bot = obj(raw);
  const department = str(bot.department);
  const notes = obj(bot.starterNotes);
  const lines = typeof notes.memoryLines === 'number' ? notes.memoryLines : 0;
  const topics = list(notes.topics).length;
  const routines = typeof bot.routines === 'number' ? bot.routines : 0;
  const parts: string[] = [];
  if (str(bot.title).length > 0) parts.push(str(bot.title));
  if (department.length > 0) parts.push(bot.isLead === true ? `${department}, lead` : department);
  const noteParts = [
    lines > 0 ? plural(lines, 'line', 'lines') : '',
    topics > 0 ? plural(topics, 'topic', 'topics') : '',
  ]
    .filter((part) => part.length > 0)
    .join(', ');
  if (noteParts.length > 0) parts.push(`starter notes: ${noteParts}`);
  if (routines > 0) parts.push(plural(routines, 'routine', 'routines'));
  return {
    name: str(bot.name),
    renamedFrom: str(bot.renamedFrom).length > 0 ? str(bot.renamedFrom) : null,
    title: str(bot.title),
    icon: str(bot.icon),
    colorHex: str(bot.colorHex) || '#9fb0ff',
    department: department.length > 0 ? department : null,
    isLead: bot.isLead === true,
    detail: parts.join(' · '),
  };
}

/** `team import --dry-run --json`'s `preview`. */
export function parseTeamPreview(json: Json | null): TeamPreview | null {
  const preview = obj(json?.preview);
  if (str(preview.kind).length === 0) return null;
  const problems = strings(preview.problems);
  return {
    kind: preview.kind === 'preset' ? 'preset' : 'team',
    name: str(preview.name),
    summary: str(preview.summary),
    bots: list(preview.bots).map(botRow),
    departments: list(preview.departments).map((raw) => {
      const department = obj(raw);
      const lead = str(department.lead);
      const members = list(department.members).length;
      return {
        name: str(department.name),
        detail: `${lead.length > 0 ? `led by ${lead}, ` : ''}${plural(members, 'GBot', 'GBots')}`,
      };
    }),
    routines: list(preview.routines).map((raw) => {
      const routine = obj(raw);
      return { name: str(routine.name), detail: `${str(routine.bot)} · ${str(routine.scheduleSentence)}` };
    }),
    approvalSentence: str(preview.approvalSentence),
    lists: [
      { title: 'Read this', lines: strings(preview.warnings), danger: true },
      { title: 'Names', lines: strings(preview.notes), danger: false },
      { title: 'Left out of the file', lines: strings(preview.leftOut), danger: false },
      { title: "Ignored (this Ghostex doesn't know these fields)", lines: strings(preview.ignored), danger: false },
      { title: "Can't import", lines: problems, danger: true },
    ].filter((entry) => entry.lines.length > 0),
    canImport: preview.canImport === true,
    hasProblems: problems.length > 0,
  };
}

export type TeamImported = { changeId: string; name: string; bots: TeamBotRow[]; routines: number; skipped: string[] };

/** `team import --json`. */
export function parseTeamImported(json: Json | null): TeamImported {
  return {
    changeId: str(json?.changeId),
    name: str(json?.name),
    bots: list(json?.bots).map(botRow),
    routines: list(json?.routines).length,
    skipped: strings(json?.skipped),
  };
}

/** `team export --json`: the file's text, its name and what was left out. */
export type TeamExported = { text: string; fileName: string; summary: string; leftOut: string[] };

export function parseTeamExported(json: Json | null): TeamExported {
  const count = (key: string): number => (typeof json?.[key] === 'number' ? (json[key] as number) : 0);
  const what =
    json?.kind === 'preset'
      ? '1 GBot as a preset'
      : [
          plural(count('bots'), 'GBot', 'GBots'),
          count('departments') > 0 ? plural(count('departments'), 'department', 'departments') : '',
          count('routines') > 0 ? plural(count('routines'), 'routine', 'routines') : '',
        ]
          .filter((part) => part.length > 0)
          .join(', ');
  return {
    text: str(json?.text),
    fileName: str(json?.fileName) || 'gbots.gbots-team.json',
    summary: what,
    leftOut: strings(json?.leftOut),
  };
}

export type GbotPreset = {
  presetId: string;
  name: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  builtIn: boolean;
};

/** `preset list --json`. */
export function parseGbotPresets(json: Json | null): GbotPreset[] {
  return list(json?.presets).map((raw) => {
    const preset = obj(raw);
    return {
      presetId: str(preset.presetId),
      name: str(preset.name),
      title: str(preset.title),
      description: str(preset.description),
      icon: str(preset.icon),
      color: str(preset.color),
      builtIn: preset.builtIn === true,
    };
  });
}
