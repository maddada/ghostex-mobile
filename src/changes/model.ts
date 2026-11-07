/**
 * The phone's Changes screen data: gxserver's `changesDiff` patch split into files, hunks and lines
 * with their file line numbers, the word-level span that changed inside a replaced line, the syntax
 * tokens of a line, and the flat rows the screen's list draws.
 *
 * CDXC:Changes 2026-10-25 WHY:
 * The parse, the word-level marks and the tokenizer are line-for-line ports of the desktop Changes
 * tab's (`native_changes/model.rs` `parse_patch`, `mark_word_changes`, and `tokens.rs`), so a
 * diff reads the same on both. They stay in TypeScript rather than a shared Rust core because the
 * phone has no Changes core through UniFFI and the desktop's lives in the app crate; positions here
 * are UTF-16 indices (JavaScript strings) where the desktop's are byte ranges.
 * SEE-ALSO: apps/desktop/src/app/native_changes/model.rs, apps/desktop/src/app/native_changes/tokens.rs
 */

export type ChangesScope = 'main' | 'uncommitted';
export type FileStatus = 'added' | 'deleted' | 'modified';
export type LineKind = 'context' | 'added' | 'removed';

export type HunkLine = {
  kind: LineKind;
  old: number | null;
  new: number | null;
  /** The line without its `+`, `-` or space marker. */
  text: string;
  /** The part of `text` that differs from the line it replaced (or was replaced by), as [start, end). */
  changed: [number, number] | null;
};

export type Hunk = {
  /** The `@@ … @@` line. */
  header: string;
  /** The function git names after the header, when it names one. */
  context: string;
  oldStart: number;
  oldCount: number;
  lines: HunkLine[];
};

export type ChangedFile = {
  path: string;
  status: FileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  /** Left out of the patch because it is too large (`tooLargePaths`). */
  tooLarge: boolean;
};

export type ChangesData = {
  files: ChangedFile[];
  baseLabel: string;
  branch: string | null;
  onDefaultBranch: boolean;
  truncated: boolean;
  additions: number;
  deletions: number;
  /**
   * The files gxserver names as tests (`testPaths`, gx-core's `is_test_file`), or null from a
   * computer too old to send them, which leaves the Hide test files button off the toolbar.
   */
  testPaths: ReadonlySet<string> | null;
  /** How many test files `withoutTestFiles` left out. */
  hiddenTests: number;
};

/** What `changesDiff` answered: a repository's changes, or the project is not a Git repository. */
export type ChangesAnswer = { kind: 'repo'; data: ChangesData } | { kind: 'notRepo' };

export function fileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash + 1);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function changesAnswerFrom(answer: unknown): ChangesAnswer {
  const record = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};
  if (record.isRepo === false) return { kind: 'notRepo' };
  const text = (key: string): string | null => (typeof record[key] === 'string' ? (record[key] as string) : null);
  const files = parsePatch(text('patch') ?? '');
  for (const path of stringList(record.tooLargePaths)) {
    files.push({ path, status: 'added', binary: true, additions: 0, deletions: 0, hunks: [], tooLarge: true });
  }
  return {
    kind: 'repo',
    data: {
      files,
      baseLabel: text('baseLabel') ?? 'HEAD',
      branch: text('branch'),
      onDefaultBranch: record.onDefaultBranch === true,
      truncated: record.truncated === true,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      testPaths: Array.isArray(record.testPaths) ? new Set(stringList(record.testPaths)) : null,
      hiddenTests: 0,
    },
  };
}

/**
 * The diff without its test files, with the counts of what is left (the desktop's Hide test files,
 * apps/desktop/src/app/native_changes/test_files.rs).
 */
export function withoutTestFiles(data: ChangesData): ChangesData {
  const tests = data.testPaths;
  if (tests === null || tests.size === 0) return data;
  const files = data.files.filter((file) => !tests.has(file.path));
  if (files.length === data.files.length) return data;
  return {
    ...data,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    hiddenTests: data.files.length - files.length,
  };
}

/** `@@ -a,b +c,d @@ context`: the old start and count, and the context after the second `@@`. */
function hunkHeader(header: string): { oldStart: number; oldCount: number; context: string } {
  const match = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@ ?(.*)$/u.exec(header);
  if (match === null) return { oldStart: 0, oldCount: 0, context: '' };
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    context: (match[3] ?? '').trim(),
  };
}

function newStart(header: string): number {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)/u.exec(header);
  return match === null ? 0 : Number(match[1]);
}

/** `diff --git a/x b/x`: the path after ` b/`. */
function pathFromDiffLine(line: string): string {
  const rest = line.startsWith('diff --git ') ? line.slice('diff --git '.length) : line;
  const index = rest.indexOf(' b/');
  return index >= 0 ? rest.slice(index + 3) : rest.replace(/^a\//u, '');
}

export function parsePatch(patch: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let oldLine = 0;
  let newLine = 0;
  const lines = patch.split('\n');
  // A trailing newline leaves one empty string that is not a line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      files.push({
        path: pathFromDiffLine(line),
        status: 'modified',
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
        tooLarge: false,
      });
      continue;
    }
    const file = files[files.length - 1];
    if (file === undefined) continue;
    if (line.startsWith('@@')) {
      const header = hunkHeader(line);
      oldLine = header.oldStart;
      newLine = newStart(line);
      file.hunks.push({ header: line, ...header, lines: [] });
      continue;
    }
    const hunk = file.hunks[file.hunks.length - 1];
    if (hunk === undefined) {
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) file.binary = true;
      else if (line.startsWith('+++ b/')) file.path = line.slice('+++ b/'.length);
      continue;
    }
    const marker = line.charAt(0);
    // `\ No newline at end of file` and stray lines carry no file line.
    if (marker !== '+' && marker !== '-' && marker !== ' ') continue;
    const text = line.slice(1);
    if (marker === ' ') {
      hunk.lines.push({ kind: 'context', old: oldLine, new: newLine, text, changed: null });
      oldLine += 1;
      newLine += 1;
    } else if (marker === '+') {
      hunk.lines.push({ kind: 'added', old: null, new: newLine, text, changed: null });
      newLine += 1;
      file.additions += 1;
    } else {
      hunk.lines.push({ kind: 'removed', old: oldLine, new: null, text, changed: null });
      oldLine += 1;
      file.deletions += 1;
    }
  }
  for (const file of files) for (const hunk of file.hunks) markWordChanges(hunk.lines);
  return files;
}

/**
 * Pairs each run of removed lines with the added lines after it and marks, in each pair, the
 * middle part that differs (the common start and end stay plain). A line with nothing in common
 * with its partner is left unmarked: the whole row's tint already says it changed.
 */
function markWordChanges(lines: HunkLine[]): void {
  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind !== 'removed') {
      index += 1;
      continue;
    }
    const removedStart = index;
    while (index < lines.length && lines[index].kind === 'removed') index += 1;
    const addedStart = index;
    while (index < lines.length && lines[index].kind === 'added') index += 1;
    const pairs = Math.min(addedStart - removedStart, index - addedStart);
    for (let offset = 0; offset < pairs; offset += 1) {
      const oldLine = lines[removedStart + offset];
      const newLine = lines[addedStart + offset];
      const [oldRange, newRange] = differingMiddle(oldLine.text, newLine.text);
      const keepsSomething =
        oldRange[1] - oldRange[0] < oldLine.text.length || newRange[1] - newRange[0] < newLine.text.length;
      if (!keepsSomething) continue;
      if (oldRange[1] > oldRange[0]) oldLine.changed = oldRange;
      if (newRange[1] > newRange[0]) newLine.changed = newRange;
    }
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function differingMiddle(oldText: string, newText: string): [[number, number], [number, number]] {
  const shorter = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < shorter && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix += 1;
  // Never split a surrogate pair.
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  const room = shorter - prefix;
  while (
    suffix < room &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isHighSurrogate(oldText.charCodeAt(oldText.length - suffix - 1))) suffix -= 1;
  return [
    [prefix, oldText.length - suffix],
    [prefix, newText.length - suffix],
  ];
}

// ---------------------------------------------------------------------------
// Syntax tokens (desktop `tokens.rs`).
// ---------------------------------------------------------------------------

export type TokenKind =
  'attribute' | 'comment' | 'function' | 'keyword' | 'literal' | 'number' | 'operator' | 'plain' | 'string' | 'type';

const KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'defer',
  'do',
  'else',
  'enum',
  'export',
  'extension',
  'final',
  'for',
  'from',
  'func',
  'function',
  'guard',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'let',
  'mut',
  'new',
  'override',
  'package',
  'private',
  'protected',
  'protocol',
  'public',
  'return',
  'static',
  'struct',
  'super',
  'switch',
  'throws',
  'throw',
  'try',
  'type',
  'var',
  'where',
  'while',
]);

const LITERALS = new Set(['false', 'nil', 'null', 'None', 'self', 'Self', 'this', 'true', 'undefined']);

const PRIMITIVE_TYPES = new Set([
  'Array',
  'Bool',
  'Boolean',
  'Date',
  'Dictionary',
  'Double',
  'Float',
  'Int',
  'Map',
  'Number',
  'Object',
  'Set',
  'String',
  'Void',
]);

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';
const isIdentifierStart = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z_$]/u.test(ch);
const isIdentifierPart = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_$]/u.test(ch);
const isOperator = (ch: string | undefined): boolean => ch !== undefined && '{}[]().,:;?<>+=*/%!&|^~-'.includes(ch);
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';
const isNumberPart = (ch: string | undefined): boolean => ch !== undefined && /[0-9A-Fa-f._xXoObB]/u.test(ch);

export type Token = { start: number; end: number; kind: TokenKind };

/** The code's tokens as [start, end) ranges of `text`; they never overlap and cover it in order. */
export function tokenizeLine(text: string): Token[] {
  const tokens: Token[] = [];
  const end = text.length;
  let index = 0;
  const push = (start: number, stop: number, kind: TokenKind) => tokens.push({ start, end: stop, kind });
  while (index < end) {
    const ch = text[index];
    const start = index;
    if (isSpace(ch)) {
      while (isSpace(text[index])) index += 1;
      push(start, index, 'plain');
      continue;
    }
    if (ch === '/' && text[index + 1] === '/') {
      push(start, end, 'comment');
      break;
    }
    if (ch === '/' && text[index + 1] === '*') {
      let cursor = index + 2;
      while (cursor < end && !(text[cursor] === '*' && text[cursor + 1] === '/')) cursor += 1;
      cursor = Math.min(cursor + 2, end);
      push(start, cursor, 'comment');
      index = cursor;
      continue;
    }
    if (ch === '#' && (index === 0 || isSpace(text[index - 1]))) {
      push(start, end, 'comment');
      break;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let cursor = index + 1;
      let escaped = false;
      while (cursor < end) {
        const next = text[cursor];
        if (escaped) escaped = false;
        else if (next === '\\') escaped = true;
        else if (next === ch) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      push(start, cursor, 'string');
      index = cursor;
      continue;
    }
    if (ch === '@' && isIdentifierStart(text[index + 1])) {
      let cursor = index + 1;
      while (isIdentifierPart(text[cursor])) cursor += 1;
      push(start, cursor, 'attribute');
      index = cursor;
      continue;
    }
    if (isDigit(ch)) {
      while (isNumberPart(text[index])) index += 1;
      push(start, index, 'number');
      continue;
    }
    if (isIdentifierStart(ch)) {
      let cursor = index;
      while (isIdentifierPart(text[cursor])) cursor += 1;
      const word = text.slice(start, cursor);
      let look = cursor;
      while (isSpace(text[look])) look += 1;
      const kind: TokenKind = KEYWORDS.has(word)
        ? 'keyword'
        : LITERALS.has(word)
          ? 'literal'
          : PRIMITIVE_TYPES.has(word) || /^[A-Z]/u.test(word)
            ? 'type'
            : text[look] === '('
              ? 'function'
              : 'plain';
      push(start, cursor, kind);
      index = cursor;
      continue;
    }
    if (isOperator(ch)) {
      while (isOperator(text[index])) index += 1;
      push(start, index, 'operator');
      continue;
    }
    // One whole code point, so a surrogate pair stays together.
    const step = isHighSurrogate(text.charCodeAt(index)) ? 2 : 1;
    push(start, Math.min(index + step, end), 'plain');
    index += step;
  }
  return tokens;
}

/** One drawn run of a line: its text, its syntax kind, and whether it is in the changed span. */
export type LineSegment = { text: string; kind: TokenKind; changed: boolean };

/** Splits a line into runs at every token edge and at the changed span's two edges. */
export function lineSegments(line: HunkLine): LineSegment[] {
  const text = line.text.replace(/\t/gu, '  ');
  // Tabs became two spaces, so the changed span shifts with them.
  const shift = (position: number): number => {
    let tabs = 0;
    for (let index = 0; index < position && index < line.text.length; index += 1) {
      if (line.text.charCodeAt(index) === 9) tabs += 1;
    }
    return position + tabs;
  };
  const changed = line.changed === null ? null : ([shift(line.changed[0]), shift(line.changed[1])] as const);
  const segments: LineSegment[] = [];
  for (const token of tokenizeLine(text)) {
    const cuts = [token.start];
    if (changed !== null) {
      for (const edge of changed) if (edge > token.start && edge < token.end) cuts.push(edge);
    }
    cuts.push(token.end);
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const start = cuts[index];
      const stop = cuts[index + 1];
      const inChange = changed !== null && start >= changed[0] && stop <= changed[1];
      const previous = segments[segments.length - 1];
      if (previous !== undefined && previous.kind === token.kind && previous.changed === inChange) {
        previous.text += text.slice(start, stop);
      } else {
        segments.push({ text: text.slice(start, stop), kind: token.kind, changed: inChange });
      }
    }
  }
  return segments;
}

/** The runs of `segments` between display columns `start` and `end` (one wrapped row of a line). */
export function sliceSegments(segments: readonly LineSegment[], start: number, end: number): LineSegment[] {
  const out: LineSegment[] = [];
  let position = 0;
  for (const segment of segments) {
    const from = position;
    const to = position + segment.text.length;
    position = to;
    if (to <= start || from >= end) continue;
    out.push({
      ...segment,
      text: segment.text.slice(Math.max(0, start - from), Math.min(segment.text.length, end - from)),
    });
  }
  return out;
}

/** A line's width in columns once its tabs became two spaces (`lineSegments`). */
function displayText(text: string): string {
  return text.includes('\t') ? text.replace(/\t/gu, '  ') : text;
}

// ---------------------------------------------------------------------------
// The list's rows.
// ---------------------------------------------------------------------------

export type ChangesRow =
  /** The "N files changed" heading over the file list; tapping it folds the list. */
  | { kind: 'listHeading'; key: string; open: boolean }
  | { kind: 'listItem'; key: string; fileIndex: number }
  /** A file's header in the stream, pinned while its lines scroll; tapping it folds the file. */
  | { kind: 'file'; key: string; fileIndex: number; folded: boolean }
  /** The unchanged lines before a hunk that the patch leaves out, and the function git names there. */
  | { kind: 'gap'; key: string; count: number; context: string }
  /**
   * One screen row of a diff line: a line longer than the screen is wrapped into several, `part`
   * counting them, each showing display columns [start, end).
   */
  | {
      kind: 'line';
      key: string;
      fileIndex: number;
      hunkIndex: number;
      lineIndex: number;
      part: number;
      start: number;
      end: number;
    }
  | { kind: 'note'; key: string; text: string };

/**
 * Every row's height. Each kind draws exactly one text line (a long diff line is wrapped into
 * rows of its own by `buildRows`), so the list knows every row's offset before drawing it.
 *
 * CDXC:Changes 2026-10-25 WHY:
 * The list wraps long lines itself, at the column count that fits the screen in the monospace font,
 * instead of letting each Text wrap: with free wrapping every row had its own unknown height and
 * tapping a file in the list could not scroll to a file far below (FlatList's `scrollToIndex`
 * lands only on rows it has measured, and its retry hops raced each other back to the top). Fixed
 * heights give `getItemLayout`, which makes the jump exact and keeps a diff of thousands of lines
 * cheap to scroll.
 */
export const ROW_HEIGHTS: Record<ChangesRow['kind'], number> = {
  listHeading: 40,
  listItem: 34,
  file: 52,
  gap: 24,
  line: 19,
  note: 38,
};

/** Each row's offset from the top of the list, plus the total height as the last entry. */
export function rowOffsets(rows: readonly ChangesRow[]): number[] {
  const offsets = new Array<number>(rows.length + 1);
  let offset = 0;
  rows.forEach((row, index) => {
    offsets[index] = offset;
    offset += ROW_HEIGHTS[row.kind];
  });
  offsets[rows.length] = offset;
  return offsets;
}

/** What a file with no hunks says instead of lines (desktop `rows.rs` `Row::Binary`). */
function emptyFileNote(file: ChangedFile): string {
  if (file.tooLarge) return 'Large file, not shown.';
  if (!file.binary) return 'No changes to show (mode or permission change).';
  return file.status === 'added' ? 'Binary or large file, not shown.' : 'Binary file, not shown.';
}

/**
 * The rows for the whole screen: the file list (when open), then each file's header and, unless it
 * is folded, its hunks. Each hunk starts with how many unchanged lines come before it (since the
 * file's start, or since the previous hunk's end) in place of the raw `@@` line.
 */
export function buildRows(
  data: ChangesData,
  listOpen: boolean,
  folded: ReadonlySet<string>,
  columns: number,
): ChangesRow[] {
  const width = Math.max(8, Math.floor(columns));
  const rows: ChangesRow[] = [{ kind: 'listHeading', key: 'list', open: listOpen }];
  if (listOpen) {
    data.files.forEach((file, fileIndex) => rows.push({ kind: 'listItem', key: `item:${file.path}`, fileIndex }));
  }
  data.files.forEach((file, fileIndex) => {
    const isFolded = folded.has(file.path);
    rows.push({ kind: 'file', key: `file:${file.path}`, fileIndex, folded: isFolded });
    if (isFolded) return;
    if (file.binary || file.hunks.length === 0) {
      rows.push({ kind: 'note', key: `note:${file.path}`, text: emptyFileNote(file) });
      return;
    }
    let previousEnd = 1;
    file.hunks.forEach((hunk, hunkIndex) => {
      // A new file's hunk starts at old line 0, with nothing before it.
      const count = hunk.oldStart === 0 ? 0 : Math.max(0, hunk.oldStart - previousEnd);
      if (count > 0 || hunk.context.length > 0 || hunkIndex > 0) {
        rows.push({ kind: 'gap', key: `gap:${file.path}:${hunkIndex}`, count, context: hunk.context });
      }
      previousEnd = hunk.oldStart + hunk.oldCount;
      hunk.lines.forEach((line, lineIndex) => {
        const text = displayText(line.text);
        let start = 0;
        let part = 0;
        do {
          let end = Math.min(text.length, start + width);
          // Never split a surrogate pair across two rows.
          if (end < text.length && end > start + 1 && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
          rows.push({
            kind: 'line',
            key: `line:${file.path}:${hunkIndex}:${lineIndex}:${part}`,
            fileIndex,
            hunkIndex,
            lineIndex,
            part,
            start,
            end,
          });
          start = end;
          part += 1;
        } while (start < text.length);
      });
    });
  });
  return rows;
}
