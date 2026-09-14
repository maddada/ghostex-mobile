/** Remote path helpers retain POSIX semantics and recognize Windows drive/UNC roots. */
export const PATH_SEPARATOR = '/';

export function isWindowsRemotePath(value: string): boolean {
  return /^[a-z]:[/\\]/iu.test(value) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/u.test(value);
}

export function isAbsoluteRemotePath(value: string): boolean {
  return value.startsWith('/') || isWindowsRemotePath(value);
}

function normalize(value: string): string {
  return isWindowsRemotePath(value) ? value.replace(/\\/gu, '/') : value;
}

function rootLength(value: string): number {
  const unc = /^\/\/[^/]+\/[^/]+(?:\/|$)/u.exec(value);
  if (unc) return unc[0].length;
  if (/^[a-z]:\//iu.test(value)) return 3;
  if (value.startsWith('~/')) return 2;
  return value.startsWith('/') ? 1 : 0;
}

export function hasTrailingPathSeparator(value: string): boolean {
  return normalize(value).endsWith('/');
}

export function getBrowseDirectoryPath(value: string): string {
  const path = normalize(value);
  if (hasTrailingPathSeparator(path)) return path;
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index + 1);
}

export function getBrowseLeafPathSegment(value: string): string {
  const path = normalize(value);
  return path.slice(path.lastIndexOf('/') + 1);
}

export function appendBrowsePathSegment(directory: string, segment: string): string {
  return `${getBrowseDirectoryPath(directory)}${segment}/`;
}

export function getBrowseParentPath(value: string): string | null {
  const path = normalize(value.trim());
  const root = rootLength(path);
  const withoutTrailing = path.replace(/\/+$/u, '');
  if (withoutTrailing.length <= root) return null;
  const index = withoutTrailing.lastIndexOf('/');
  if (index < 0) return null;
  return path.slice(0, Math.max(root, index + 1));
}

export function canNavigateUp(value: string): boolean {
  return hasTrailingPathSeparator(value) && getBrowseParentPath(value) !== null;
}

export function ensureBrowseDirectoryPath(value: string): string {
  const path = normalize(value.trim());
  if (!path) return '~/';
  return path.endsWith('/') ? path : `${path}/`;
}

export function stripTrailingSeparators(value: string): string {
  const path = normalize(value);
  const stripped = path.replace(/\/+$/u, '');
  return path.slice(0, Math.max(rootLength(path), stripped.length));
}

export function remotePathIdentity(value: string): string {
  const normalized = stripTrailingSeparators(value);
  return isWindowsRemotePath(value) ? normalized.toLowerCase() : normalized;
}

export function joinPathSegment(directory: string, segment: string): string {
  const path = stripTrailingSeparators(directory);
  return `${path}${path.endsWith('/') ? '' : '/'}${segment}`;
}

export function cloneFolderName(repositoryTitle: string, remoteUrl: string): string {
  const fromTitle = repositoryTitle.trim().split('/').pop() ?? '';
  const candidate = fromTitle.length > 0 ? fromTitle : remoteUrl.trim();
  return (
    candidate
      .replace(/[/:]+$/, '')
      .split(/[/:]/)
      .pop() ?? ''
  ).replace(/\.git$/i, '');
}
