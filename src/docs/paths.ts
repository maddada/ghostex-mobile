/**
 * Remote document paths, as the Docs viewer handles them: always absolute, always with forward
 * slashes (a Windows `C:\a\b.md` becomes `C:/a/b.md`, which PowerShell reads just the same), and
 * mapped one-to-one onto the viewer's mirror folder on the phone so relative links between a page
 * and its images, styles and sibling pages resolve there exactly as they do on the computer.
 */

import { isAbsoluteRemotePath } from '../addProject/paths';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkdn']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);

export type DocKind = 'markdown' | 'html';

export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Markdown and HTML are the two kinds the phone renders; anything else stays a copied path. */
export function docKindForPath(path: string): DocKind | null {
  const extension = extensionOf(path);
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  return null;
}

export function normalizeRemotePath(path: string): string {
  const trimmed = path.trim();
  return /^[a-z]:[\\/]/iu.test(trimmed) || /^\\\\/u.test(trimmed) ? trimmed.replace(/\\/gu, '/') : trimmed;
}

/** Length of the root a path cannot climb above: `/`, `C:/`, or `//server/share/`. */
function rootLength(path: string): number {
  const unc = /^\/\/[^/]+\/[^/]+\/?/u.exec(path);
  if (unc !== null) return unc[0].length;
  if (/^[a-z]:\//iu.test(path)) return 3;
  return path.startsWith('/') ? 1 : 0;
}

export function baseName(path: string): string {
  const normalized = normalizeRemotePath(path).replace(/\/+$/u, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  const normalized = normalizeRemotePath(path);
  const root = rootLength(normalized);
  const slash = normalized.lastIndexOf('/');
  if (slash < root) return normalized.slice(0, root);
  return normalized.slice(0, slash);
}

/** Joins a project-relative Docs path (`docs/a/b.md`) onto its absolute root. */
export function joinRemotePath(root: string, relative: string): string {
  const base = normalizeRemotePath(root).replace(/\/+$/u, '');
  return `${base}/${relative.replace(/^\/+/u, '')}`;
}

/**
 * Resolves a page-relative reference (already stripped of `?query` and `#fragment`, and percent
 * decoded) against the directory of the page that holds it. `..` stops at the root.
 */
export function resolveRemoteReference(fromFile: string, reference: string): string {
  const directory = dirName(fromFile);
  const root = rootLength(directory);
  const segments = directory.slice(root).split('/').filter((segment) => segment.length > 0);
  for (const segment of reference.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return directory.slice(0, root) + segments.join('/');
}

/**
 * The mirror folder's segments for a remote path. The first segment names the kind of root so the
 * mapping reverses without guessing: `posix`, `drive-C`, or `unc` followed by server and share.
 */
export function mirrorSegments(remotePath: string): string[] | null {
  const path = normalizeRemotePath(remotePath);
  if (!isAbsoluteRemotePath(path)) return null;
  const unc = /^\/\/([^/]+)\/([^/]+)\/?(.*)$/u.exec(path);
  if (unc !== null) return ['unc', unc[1] ?? '', unc[2] ?? '', ...splitRest(unc[3] ?? '')];
  const drive = /^([a-z]):\/(.*)$/iu.exec(path);
  if (drive !== null) return [`drive-${(drive[1] ?? '').toUpperCase()}`, ...splitRest(drive[2] ?? '')];
  return ['posix', ...splitRest(path.slice(1))];
}

function splitRest(rest: string): string[] {
  return rest.split('/').filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** The remote path a mirror file stands for: the inverse of {@link mirrorSegments}. */
export function remotePathFromMirrorSegments(segments: readonly string[]): string | null {
  const [head, ...rest] = segments;
  if (head === 'posix') return `/${rest.join('/')}`;
  if (head === 'unc' && rest.length >= 2) return `//${rest.join('/')}`;
  const drive = /^drive-([A-Z])$/u.exec(head ?? '');
  if (drive !== null) return `${drive[1]}:/${rest.join('/')}`;
  return null;
}
