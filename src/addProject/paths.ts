/**
 * POSIX path helpers for the Add Project browser, ported from t3code's
 * client-runtime path utilities (plans/014-add-project-dialog.t3code-spec.md
 * §2.3). Mobile only ever browses a Mac or Linux machine over SSH, so there is
 * no Windows separator handling and no relative-path support here: the flow
 * never sends `cwd`, so `./x` has nothing to resolve against.
 */

export const PATH_SEPARATOR = '/';

/** True when the value ends with a separator, i.e. "list this directory". */
export function hasTrailingPathSeparator(value: string): boolean {
  return /\/$/.test(value);
}

/** The directory portion of a query: itself when it ends with a separator. */
export function getBrowseDirectoryPath(value: string): string {
  if (hasTrailingPathSeparator(value)) return value;
  const index = value.lastIndexOf(PATH_SEPARATOR);
  return index < 0 ? '' : value.slice(0, index + 1);
}

/** The text after the last separator — the leaf filter the user is typing. */
export function getBrowseLeafPathSegment(value: string): string {
  const index = value.lastIndexOf(PATH_SEPARATOR);
  return index < 0 ? value : value.slice(index + 1);
}

/** Append a folder name to a directory query, keeping the trailing separator. */
export function appendBrowsePathSegment(directory: string, segment: string): string {
  const base = hasTrailingPathSeparator(directory)
    ? directory
    : `${getBrowseDirectoryPath(directory)}`;
  return `${base}${segment}${PATH_SEPARATOR}`;
}

/**
 * Root-aware parent of a directory query; null when already at a root
 * (`/` or `~/`), which is what hides the ".." row.
 */
export function getBrowseParentPath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const withoutTrailing = trimmed.replace(/\/+$/, '');
  if (withoutTrailing.length === 0) return null; // "/" is the filesystem root.
  if (withoutTrailing === '~') return null; // "~/" is the home root.
  const index = withoutTrailing.lastIndexOf(PATH_SEPARATOR);
  if (index < 0) return null;
  if (index === 0) return PATH_SEPARATOR;
  return `${withoutTrailing.slice(0, index)}${PATH_SEPARATOR}`;
}

/** True when a ".." row should be offered for the current query. */
export function canNavigateUp(value: string): boolean {
  return hasTrailingPathSeparator(value) && getBrowseParentPath(value) !== null;
}

/** Ensure a directory path ends with a separator (browse queries always do). */
export function ensureBrowseDirectoryPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return `~${PATH_SEPARATOR}`;
  return hasTrailingPathSeparator(trimmed) ? trimmed : `${trimmed}${PATH_SEPARATOR}`;
}

/** Drop trailing separators without turning "/" into "". */
export function stripTrailingSeparators(value: string): string {
  const stripped = value.replace(/\/+$/, '');
  return stripped.length === 0 ? PATH_SEPARATOR : stripped;
}

/** Join a resolved directory with one more segment. */
export function joinPathSegment(directory: string, segment: string): string {
  const base = stripTrailingSeparators(directory);
  return base === PATH_SEPARATOR ? `${PATH_SEPARATOR}${segment}` : `${base}${PATH_SEPARATOR}${segment}`;
}

/**
 * Folder name a clone should land in: the repository leaf, with a trailing
 * `.git` removed. Used to turn a browsed destination directory into a concrete
 * destination path.
 */
export function cloneFolderName(repositoryTitle: string, remoteUrl: string): string {
  const fromTitle = repositoryTitle.trim().split(PATH_SEPARATOR).pop() ?? '';
  const candidate = fromTitle.length > 0 ? fromTitle : remoteUrl.trim();
  const leaf =
    candidate
      .replace(/[/:]+$/, '')
      .split(/[/:]/)
      .pop() ?? '';
  return leaf.replace(/\.git$/i, '');
}
