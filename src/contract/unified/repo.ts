/**
 * Which repository a project is, so the same checkout on two computers reads as one project in
 * the Unified list.
 *
 * A port of packages/gx-core/src/unified_sidebar/repo.rs; `unifiedFixture.test.ts` runs the
 * desktop builder's answers through it, so keep the two in step.
 */

/** A project as the Unified list names and groups it. */
export type RepoIdentity = {
  /**
   * What two projects share when they are the same repository: the normalized origin
   * (`github.com/owner/repo`), else `dir:` and the checkout's folder name.
   */
  key: string;
  /** What a card and the filter show: the repository's name as its origin spells it, else the folder name. */
  label: string;
};

function trimEnd(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

function trimBoth(text: string, char: string): string {
  let start = 0;
  while (start < text.length && text[start] === char) start += 1;
  return trimEnd(text.slice(start), char);
}

function trimSuffix(text: string, suffix: string): string {
  let out = text;
  while (suffix.length > 0 && out.endsWith(suffix)) out = out.slice(0, -suffix.length);
  return out;
}

function lastNonEmpty(parts: string[]): string | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] !== '') return parts[index];
  }
  return null;
}

/** The part after the last `@`, as the desktop's `rsplit('@').next()` takes it. */
function afterLastAt(authority: string): string {
  const at = authority.lastIndexOf('@');
  return at < 0 ? authority : authority.slice(at + 1);
}

/**
 * `host/owner/repo` (lowercase) and the repository's name, for every form git prints an origin
 * in: `https://host/owner/repo(.git)`, `ssh://user@host:port/owner/repo`, `git@host:owner/repo`
 * and a local path. `null` for an empty value.
 */
export function normalizeGitRemote(raw: string): [key: string, label: string] | null {
  const url = trimEnd(raw.trim(), '/');
  if (url === '') return null;
  const scheme = url.indexOf('://');
  const withoutScheme = scheme >= 0 ? url.slice(scheme + 3) : url;
  let host: string;
  let path: string;
  if (scheme >= 0) {
    // `scheme://[user@]host[:port]/path`
    const slash = withoutScheme.indexOf('/');
    const authority = slash >= 0 ? withoutScheme.slice(0, slash) : withoutScheme;
    path = slash >= 0 ? withoutScheme.slice(slash + 1) : '';
    host = afterLastAt(authority).split(':')[0];
  } else {
    // scp form `[user@]host:path`, but not a Windows drive (`C:\…`).
    const colon = withoutScheme.indexOf(':');
    const authority = colon >= 0 ? withoutScheme.slice(0, colon) : '';
    if (colon >= 0 && authority.length > 1 && !authority.includes('/')) {
      host = afterLastAt(authority);
      path = withoutScheme.slice(colon + 1);
    } else {
      host = '';
      path = withoutScheme;
    }
  }
  path = trimEnd(trimSuffix(trimBoth(path, '/'), '.git'), '/').replaceAll('\\', '/');
  const label = lastNonEmpty(path.split('/'));
  if (label === null) return null;
  const key = host === '' ? path.toLowerCase() : `${host.toLowerCase()}/${path.toLowerCase()}`;
  return [key, label];
}

function folderName(path: string): string | null {
  return lastNonEmpty(trimEnd(path.trim(), '/\\').split(/[/\\]/));
}

/**
 * The repository a project is: its git origin, else the checkout's folder name. A worktree
 * project shares its parent's origin; without one it takes the parent's folder.
 */
export function repoIdentity(
  originUrl: string | null | undefined,
  path: string,
  parentPath: string | null | undefined,
  fallbackTitle: string,
): RepoIdentity {
  const remote = originUrl == null ? null : normalizeGitRemote(originUrl);
  if (remote !== null) return { key: remote[0], label: remote[1] };
  const folder =
    (parentPath != null ? folderName(parentPath) : null) ??
    folderName(path) ??
    fallbackTitle.trim();
  return { key: `dir:${folder.toLowerCase()}`, label: folder };
}
