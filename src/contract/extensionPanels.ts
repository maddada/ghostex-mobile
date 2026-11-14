/**
 * Sidebar extensions' panels, as the computer sends them in the sessions list's optional
 * `extensionPanels` key (gx-protocol `ExtensionPanels`): every enabled sidebar extension's own
 * sidebar mode, its sections above or below the projects, and the blocks they draw.
 *
 * Parsing is lenient, as on the desktop: an extension entry, block or row this phone cannot read
 * is left out, never failing the list that carries it, and a computer that sends no
 * `extensionPanels` (older than 11.8, or with no sidebar extension on) gives `null`, which draws
 * nothing new. gxserver already leaves out a mode or sections switched off in Settings >
 * Extensions on the computer, so the phone draws exactly what arrives.
 *
 * CDXC:Extensions 2026-11-14 SEE-ALSO: packages/gx-protocol/src/extension_panel.rs (the wire types),
 * packages/gx-core/src/sidebar_view/extension_panel.rs (the desktop's layout rules this file mirrors:
 * tabs, sections, permissions, project paths, the text subset).
 */

export type PanelDot = 'green' | 'yellow' | 'red' | 'blue' | 'gray';

export type PanelAction =
  | { kind: 'openProject'; project: string }
  | { kind: 'focusSession'; session: string }
  | { kind: 'newAgent'; project: string; draft?: string; agent?: string }
  | { kind: 'openUrl'; url: string }
  | { kind: 'openView'; view: string }
  | { kind: 'extension'; name: string; data?: unknown };

export type PanelMenuItem = { title: string; icon?: string; action: PanelAction };

export type PanelRow = {
  id?: string;
  icon?: string;
  dot?: PanelDot;
  title?: string;
  subtitle?: string;
  trailing?: string;
  badge?: string;
  /** A project path (`~/dev/app`) or project id; the phone fills in its name and live dot. */
  project?: string;
  /** A session ref (`<projectId>:<sessionId>`). */
  session?: string;
  action?: PanelAction;
  menu?: PanelMenuItem[];
};

export type ChecklistItem = { id: string; text: string; done: boolean; action?: PanelAction; menu?: PanelMenuItem[] };
export type MapGroup = { title: string; subtitle?: string; icon?: string; items: PanelRow[] };
export type PanelButton = {
  id?: string;
  title: string;
  icon?: string;
  style?: 'primary' | 'default';
  action: PanelAction;
};

export type PanelBlockBody =
  | { type: 'rows'; items: PanelRow[] }
  | { type: 'checklist'; editable: boolean; items: ChecklistItem[] }
  | { type: 'map'; root?: { title: string; subtitle?: string; icon?: string }; groups: MapGroup[] }
  | { type: 'progress'; value: number; max: number; label?: string }
  | { type: 'text'; text: string }
  | { type: 'buttons'; items: PanelButton[] }
  | { type: 'empty'; subtitle?: string; icon?: string; action?: PanelAction }
  /** A small page of the extension's own: the desktop shows it, the phone an Open on computer row. */
  | { type: 'web' };

export type PanelBlock = { id: string; tab?: string; title?: string; body: PanelBlockBody };
export type PanelTab = { id: string; title: string; icon?: string };
export type PanelDocument = { title?: string; tabs: PanelTab[]; blocks: PanelBlock[] };

export type ExtensionSidebarPanel = {
  mode: { title: string; icon?: string } | null;
  sections: { block: string; where: 'projectsTop' | 'projectsBottom' }[];
  revision: number;
  document: PanelDocument;
};

export type ExtensionPanelEntry = {
  extensionId: string;
  title: string;
  grantedPermissions: string[];
  sidebar: ExtensionSidebarPanel | null;
};

/** By extension id, in id order (the wire's BTreeMap). */
export type ExtensionPanels = ExtensionPanelEntry[];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function list<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/** gx-protocol `PanelAction`: an externally tagged enum (`{"openProject": "~/dev/app"}`). */
export function parsePanelAction(value: unknown): PanelAction | null {
  if (!isObject(value)) return null;
  const project = text(value.openProject);
  if (project !== undefined) return { kind: 'openProject', project };
  const session = text(value.focusSession);
  if (session !== undefined) return { kind: 'focusSession', session };
  if (isObject(value.newAgent)) {
    const target = text(value.newAgent.project);
    if (target === undefined) return null;
    return { kind: 'newAgent', project: target, draft: text(value.newAgent.draft), agent: text(value.newAgent.agent) };
  }
  const url = text(value.openUrl);
  if (url !== undefined) return { kind: 'openUrl', url };
  const view = text(value.openView);
  if (view !== undefined) return { kind: 'openView', view };
  const extension = value.extension;
  if (typeof extension === 'string' && extension.length > 0) return { kind: 'extension', name: extension };
  if (isObject(extension)) {
    const name = text(extension.name);
    return name === undefined ? null : { kind: 'extension', name, data: extension.data ?? undefined };
  }
  return null;
}

function parseMenu(value: unknown): PanelMenuItem[] | undefined {
  const items = list(value, (entry) => {
    if (!isObject(entry)) return null;
    const title = text(entry.title);
    const action = parsePanelAction(entry.action);
    return title === undefined || action === null ? null : { title, icon: text(entry.icon), action };
  });
  return items.length > 0 ? items : undefined;
}

const DOTS: readonly PanelDot[] = ['green', 'yellow', 'red', 'blue', 'gray'];

function parseRow(value: unknown): PanelRow | null {
  if (!isObject(value)) return null;
  return {
    id: text(value.id),
    icon: text(value.icon),
    dot: DOTS.includes(value.dot as PanelDot) ? (value.dot as PanelDot) : undefined,
    title: text(value.title),
    subtitle: text(value.subtitle),
    trailing: text(value.trailing),
    badge: text(value.badge),
    project: text(value.project),
    session: text(value.session),
    action: parsePanelAction(value.action) ?? undefined,
    menu: parseMenu(value.menu),
  };
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A block this phone draws, or null (an unknown type, the reserved `web` block, a malformed one). */
function parseBlock(value: unknown): PanelBlock | null {
  if (!isObject(value)) return null;
  const id = text(value.id);
  if (id === undefined) return null;
  const head = { id, tab: text(value.tab), title: text(value.title) };
  switch (value.type) {
    case 'rows':
      return { ...head, body: { type: 'rows', items: list(value.items, parseRow) } };
    case 'checklist':
      return {
        ...head,
        body: {
          type: 'checklist',
          editable: value.editable === true,
          items: list(value.items, (entry) => {
            if (!isObject(entry)) return null;
            const itemId = text(entry.id);
            if (itemId === undefined || typeof entry.text !== 'string') return null;
            return {
              id: itemId,
              text: entry.text,
              done: entry.done === true,
              action: parsePanelAction(entry.action) ?? undefined,
              menu: parseMenu(entry.menu),
            };
          }),
        },
      };
    case 'map': {
      const root = isObject(value.root) ? value.root : null;
      const rootTitle = root === null ? undefined : text(root.title);
      return {
        ...head,
        body: {
          type: 'map',
          root:
            root === null || rootTitle === undefined
              ? undefined
              : { title: rootTitle, subtitle: text(root.subtitle), icon: text(root.icon) },
          groups: list(value.groups, (entry) => {
            if (!isObject(entry)) return null;
            const title = text(entry.title);
            return title === undefined
              ? null
              : { title, subtitle: text(entry.subtitle), icon: text(entry.icon), items: list(entry.items, parseRow) };
          }),
        },
      };
    }
    case 'progress': {
      const progress = finite(value.value);
      if (progress === undefined) return null;
      const max = finite(value.max);
      return {
        ...head,
        body: {
          type: 'progress',
          value: progress,
          max: max !== undefined && max > 0 ? max : 100,
          label: text(value.label),
        },
      };
    }
    case 'text':
      return typeof value.text === 'string' ? { ...head, body: { type: 'text', text: value.text } } : null;
    case 'buttons':
      return {
        ...head,
        body: {
          type: 'buttons',
          items: list(value.items, (entry) => {
            if (!isObject(entry)) return null;
            const title = text(entry.title);
            const action = parsePanelAction(entry.action);
            if (title === undefined || action === null) return null;
            return {
              id: text(entry.id),
              title,
              icon: text(entry.icon),
              style: entry.style === 'primary' ? 'primary' : 'default',
              action,
            };
          }),
        },
      };
    case 'empty':
      return {
        ...head,
        body: {
          type: 'empty',
          subtitle: text(value.subtitle),
          icon: text(value.icon),
          action: parsePanelAction(value.action) ?? undefined,
        },
      };
    case 'web':
      return typeof value.path === 'string' ? { ...head, body: { type: 'web' } } : null;
    default:
      return null;
  }
}

function parseDocument(value: unknown): PanelDocument | null {
  if (!isObject(value) || !Array.isArray(value.blocks)) return null;
  return {
    title: text(value.title),
    tabs: list(value.tabs, (entry) => {
      if (!isObject(entry)) return null;
      const id = text(entry.id);
      const title = text(entry.title);
      return id === undefined || title === undefined ? null : { id, title, icon: text(entry.icon) };
    }),
    blocks: list(value.blocks, parseBlock),
  };
}

function parseSidebar(value: unknown): ExtensionSidebarPanel | null {
  if (!isObject(value)) return null;
  const document = parseDocument(value.document);
  if (document === null) return null;
  const mode = isObject(value.mode) ? text(value.mode.title) : undefined;
  return {
    mode: mode === undefined ? null : { title: mode, icon: text((value.mode as Json).icon) },
    sections: list(value.sections, (entry) => {
      if (!isObject(entry)) return null;
      const block = text(entry.block);
      const where = entry.where;
      return block === undefined || (where !== 'projectsTop' && where !== 'projectsBottom') ? null : { block, where };
    }),
    revision: finite(value.revision) ?? 0,
    document,
  };
}

/**
 * The summary's `extensionPanels` key. `null` when absent (an older computer, or no sidebar extension on) or when no
 * entry has a sidebar panel; side panel views are left out on the phone (they belong to the computer's work area).
 */
export function parseExtensionPanels(value: unknown): ExtensionPanels | null {
  if (!isObject(value)) return null;
  const entries: ExtensionPanels = [];
  for (const extensionId of Object.keys(value).sort()) {
    const entry = value[extensionId];
    if (!isObject(entry)) continue;
    const title = text(entry.title);
    const sidebar = parseSidebar(entry.sidebar);
    if (title === undefined || sidebar === null) continue;
    entries.push({
      extensionId,
      title,
      grantedPermissions: Array.isArray(entry.grantedPermissions)
        ? entry.grantedPermissions.filter((permission): permission is string => typeof permission === 'string')
        : [],
      sidebar,
    });
  }
  return entries.length > 0 ? entries : null;
}

// ---------------------------------------------------------------------------
// The layout rules (gx-core sidebar_view/extension_panel.rs).
// ---------------------------------------------------------------------------

/** The extensions that offer their own mode, by title. */
export function extensionModes(panels: ExtensionPanels | null | undefined): ExtensionPanelEntry[] {
  return (panels ?? [])
    .filter((entry) => entry.sidebar?.mode != null)
    .sort((left, right) => left.sidebar!.mode!.title.localeCompare(right.sidebar!.mode!.title));
}

export type ExtensionSection = { entry: ExtensionPanelEntry; block: PanelBlock };

/** The sections an extension adds above (`projectsTop`) or below (`projectsBottom`) the projects. */
export function extensionSections(
  panels: ExtensionPanels | null | undefined,
  where: 'projectsTop' | 'projectsBottom',
): ExtensionSection[] {
  const out: ExtensionSection[] = [];
  for (const entry of panels ?? []) {
    const sidebar = entry.sidebar;
    if (sidebar === null) continue;
    for (const section of sidebar.sections) {
      if (section.where !== where) continue;
      const block = sidebar.document.blocks.find((candidate) => candidate.id === section.block);
      if (block !== undefined) out.push({ entry, block });
    }
  }
  return out;
}

/** The tab a surface shows: the remembered one while the panel still has it, else the first. */
export function selectedTab(document: PanelDocument, remembered: string | undefined): string | null {
  if (remembered !== undefined && document.tabs.some((tab) => tab.id === remembered)) return remembered;
  return document.tabs[0]?.id ?? null;
}

/** The blocks of the tab on screen; a block without a tab shows under every tab. */
export function blocksOfTab(document: PanelDocument, tab: string | null): PanelBlock[] {
  return document.blocks.filter((block) => block.tab === undefined || tab === null || block.tab === tab);
}

/** The scoped permission a built-in action needs (gx-protocol `PanelAction::required_permission`). */
export function requiredPermission(action: PanelAction): string | null {
  switch (action.kind) {
    case 'openProject':
    case 'focusSession':
      return 'sessions.open';
    case 'newAgent':
      return 'agents.start';
    default:
      return null;
  }
}

export function actionAllowed(action: PanelAction, granted: readonly string[]): boolean {
  const needed = requiredPermission(action);
  return needed === null || granted.includes(needed);
}

/** How Settings > Extensions names a permission, for a refusal. */
export function permissionLabel(permission: string): string {
  switch (permission) {
    case 'sessions.open':
      return 'Open projects and sessions';
    case 'agents.start':
      return 'Start agents';
    case 'projects.read':
      return 'See your projects';
    case 'sessions.read':
      return 'See your sessions';
    default:
      return permission;
  }
}

/** A computer's home folder at the start of a project path (`/Users/me`, `/home/me`, `/root`). */
const HOME_PREFIX = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/u;

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/u, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

/**
 * The project a `project` item or `openProject` action names: a project id, or a path (`~/dev/app`, `/home/me/dev/app`).
 * The phone does not know the computer's home folder, so `~` matches the home folder a project's own path starts with.
 */
export function resolvePanelProject(
  reference: string,
  projects: readonly { projectId: string; path?: string }[],
): string | null {
  const wanted = reference.trim();
  let byPath: string | null = null;
  for (const project of projects) {
    if (project.projectId === wanted) return project.projectId;
    if (byPath !== null || project.path === undefined || project.path.length === 0) continue;
    const path = normalizePath(project.path);
    if (wanted.startsWith('~')) {
      const rest = wanted.slice(1);
      if (rest.length > 0 && !rest.startsWith('/')) continue;
      const home = HOME_PREFIX.exec(path)?.[1];
      if (home !== undefined && normalizePath(`${home}${rest}`) === path) byPath = project.projectId;
    } else if (normalizePath(wanted) === path) {
      byPath = project.projectId;
    }
  }
  return byPath;
}

// ---------------------------------------------------------------------------
// The text block's Markdown subset (gx-core `parse_text`).
// ---------------------------------------------------------------------------

export const TEXT_PREVIEW_LINES = 12;

export type TextSpan = { text: string; bold: boolean; italic: boolean; code: boolean; link?: string };
export type TextLine = { kind: 'paragraph' | 'bullet' | 'gap'; number?: number; spans: TextSpan[] };

export function parseText(source: string): TextLine[] {
  const lines: TextLine[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) {
      if (lines.length > 0 && lines[lines.length - 1].kind !== 'gap') lines.push({ kind: 'gap', spans: [] });
      continue;
    }
    const bullet = /^[-*] (.*)$/u.exec(line);
    const numbered = /^(\d{1,3})\. (.*)$/u.exec(line);
    if (bullet !== null) lines.push({ kind: 'bullet', spans: parseSpans(bullet[1]) });
    else if (numbered !== null)
      lines.push({ kind: 'bullet', number: Number(numbered[1]), spans: parseSpans(numbered[2]) });
    else lines.push({ kind: 'paragraph', spans: parseSpans(line) });
  }
  while (lines.length > 0 && lines[lines.length - 1].kind === 'gap') lines.pop();
  return lines;
}

function parseSpans(source: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const chars = Array.from(source);
  let bold = false;
  let italic = false;
  let current: TextSpan = { text: '', bold, italic, code: false };
  const flush = (nextBold: boolean, nextItalic: boolean) => {
    if (current.text.length > 0) spans.push(current);
    current = { text: '', bold: nextBold, italic: nextItalic, code: false };
  };
  let index = 0;
  while (index < chars.length) {
    const rest = chars.slice(index).join('');
    if (rest.startsWith('**')) {
      flush(!bold, italic);
      bold = !bold;
      index += 2;
      continue;
    }
    const char = chars[index];
    // `snake_case` stays literal: `_` opens italics only at a word's start.
    const wordInside = index > 0 && /[\p{L}\p{N}]/u.test(chars[index - 1]);
    if ((char === '*' || (char === '_' && (italic || !wordInside))) && (italic || rest.slice(1).includes(char))) {
      flush(bold, !italic);
      italic = !italic;
      index += 1;
      continue;
    }
    if (char === '`') {
      const end = rest.indexOf('`', 1);
      if (end > 0) {
        flush(bold, italic);
        spans.push({ text: rest.slice(1, end), bold: false, italic: false, code: true });
        index += Array.from(rest.slice(0, end + 1)).length;
        continue;
      }
    }
    if (char === '[') {
      const link = /^\[([^\]]+)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/u.exec(rest);
      if (link !== null) {
        flush(bold, italic);
        spans.push({ text: link[1], bold, italic, code: false, link: link[2] });
        index += Array.from(link[0]).length;
        continue;
      }
    }
    current.text += char;
    index += 1;
  }
  flush(bold, italic);
  return spans;
}
