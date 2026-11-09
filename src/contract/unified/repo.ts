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

/** The `owner/repo` part of an origin key (its last two segments), which two spellings of one origin share. */
function ownerRepo(key: string): string {
  const parts = key.split('/').filter((part) => part !== '');
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  return parts[0] ?? key;
}

/**
 * Each repository key a list holds, mapped to the identity its row goes under (gx-core
 * `merge_repo_identities`): origins naming the same `owner/repo` are one repository whatever their
 * host (the `github.com` key, else the first, wins), and a folder with no known origin joins the
 * one repository whose name is its folder name. Two provably different repositories stay apart.
 *
 * CDXC:Sidebar 2026-11-04 DECISION:
 * User (Q1224, randomsand: "Projects with the same name on 2 computers sometimes merge into one row and sometimes show as two"): one project is one row with its computers on it, and it stays one row; the rule and its reasons are written down in packages/gx-core/src/unified_sidebar/repo.rs.
 */
export function mergeRepoIdentities(identities: Iterable<RepoIdentity>): Map<string, RepoIdentity> {
  const origins = new Map<string, RepoIdentity[]>();
  const folders: RepoIdentity[] = [];
  for (const identity of identities) {
    if (identity.key.startsWith('dir:')) {
      folders.push(identity);
    } else {
      const group = ownerRepo(identity.key);
      origins.set(group, [...(origins.get(group) ?? []), identity]);
    }
  }
  const merged = new Map<string, RepoIdentity>();
  const canonicalByName = new Map<string, RepoIdentity[]>();
  for (const group of origins.values()) {
    let canonical = group[0]!;
    for (const identity of group) {
      const rank = (candidate: RepoIdentity) => (candidate.key.startsWith('github.com/') ? 0 : 1);
      if (
        rank(identity) < rank(canonical) ||
        (rank(identity) === rank(canonical) && identity.key < canonical.key)
      ) {
        canonical = identity;
      }
    }
    for (const identity of group) merged.set(identity.key, { ...canonical });
    const name = canonical.key.split('/').pop() ?? '';
    const entry = canonicalByName.get(name) ?? [];
    if (!entry.some((other) => other.key === canonical.key && other.label === canonical.label)) {
      entry.push(canonical);
    }
    canonicalByName.set(name, entry);
  }
  for (const folder of folders) {
    const candidates = canonicalByName.get(folder.key.slice('dir:'.length)) ?? [];
    merged.set(folder.key, candidates.length === 1 ? { ...candidates[0]! } : { ...folder });
  }
  return merged;
}

/** The merged keys of one computer's projects that have an origin (gx-core `origin_keys_of`). */
export function originKeysOf(identities: Iterable<RepoIdentity>, merged: ReadonlyMap<string, RepoIdentity>): Set<string> {
  const keys = new Set<string>();
  for (const identity of identities) {
    if (identity.key.startsWith('dir:')) continue;
    keys.add(merged.get(identity.key)?.key ?? identity.key);
  }
  return keys;
}

/**
 * The identity one project of one computer goes under: its merged repository, except that a
 * folder with no origin keeps its own when that computer already has the repository it would
 * join, since then it is another checkout (gx-core `resolve_repo_identity`).
 */
export function resolveRepoIdentity(
  identity: RepoIdentity,
  merged: ReadonlyMap<string, RepoIdentity>,
  originKeysHere: ReadonlySet<string>,
): RepoIdentity {
  const target = merged.get(identity.key) ?? identity;
  if (identity.key.startsWith('dir:') && target.key !== identity.key && originKeysHere.has(target.key)) {
    return { ...identity };
  }
  return { ...target };
}

/** Every computer's project identities, merged across the computers and resolved per computer. */
export function mergedRepoIdentities(perComputer: readonly (readonly RepoIdentity[])[]): RepoIdentity[][] {
  const merged = mergeRepoIdentities(perComputer.flat());
  return perComputer.map((identities) => {
    const here = originKeysOf(identities, merged);
    return identities.map((identity) => resolveRepoIdentity(identity, merged, here));
  });
}

/**
 * A project's folder inside its repository, lowercase, when it is a subfolder of it; `null` at the
 * repository's root or without a known root (gx-core `folder_in_repository`).
 */
export function folderInRepository(path: string, repositoryRootPath: string | null | undefined): string | null {
  if (repositoryRootPath == null) return null;
  const normalize = (text: string): string => trimEnd(text.trim().replaceAll('\\', '/'), '/');
  const root = normalize(repositoryRootPath);
  const own = normalize(path);
  if (!own.startsWith(root)) return null;
  const rest = own.slice(root.length);
  if (!rest.startsWith('/')) return null;
  const folder = trimBoth(rest.slice(1), '/');
  return folder === '' ? null : folder.toLowerCase();
}

/**
 * The key one project matches its copies by: its repository's key, plus `#` and its folder inside
 * the repository when it is a subfolder (gx-core `project_repo_key`, #461).
 */
export function projectRepoKey(repositoryKey: string, folder: string | null): string {
  return folder !== null && !repositoryKey.startsWith('dir:') ? `${repositoryKey}#${folder}` : repositoryKey;
}
