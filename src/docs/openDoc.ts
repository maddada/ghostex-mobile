/**
 * Opening a file on the computer from anywhere in the app (a chat file link, a terminal `file://`
 * hyperlink) in the file viewer: Markdown, HTML, plain text and pictures (`previewKindForPath`).
 */

import { isAbsoluteRemotePath } from '../addProject/paths';
import { joinRemotePath, normalizeRemotePath, previewKindForPath } from './paths';

/**
 * The computer-side path a `file://` URL names, when the viewer can show that file. The host part
 * is ignored: a terminal on the computer writes its own hostname there.
 */
export function docPathFromFileUrl(url: string): { path: string; fragment?: string } | null {
  const match = /^file:\/\/[^/]*(\/[^?#]*)(?:\?[^#]*)?(?:#(.*))?$/iu.exec(url.trim());
  if (match === null) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1] ?? '');
  } catch {
    return null;
  }
  // `file:///C:/Users/…` names a Windows drive.
  if (/^\/[a-z]:\//iu.test(path)) path = path.slice(1);
  if (previewKindForPath(path) === null) return null;
  const fragment = match[2];
  return fragment !== undefined && fragment.length > 0 ? { path, fragment } : { path };
}

/**
 * A chat file reference as an absolute path on the computer (forward slashes on Windows too):
 * absolute as written, or relative to the session's project folder. Null when it cannot be placed
 * (a `~` path, or a relative one without a project folder).
 */
export function remotePathForChatFile(path: string, projectPath: string): string | null {
  let trimmed = path.trim();
  // The core reads `file:///C:/Users/…` as `/C:/Users/…`.
  if (/^\/[a-z]:[\\/]/iu.test(trimmed)) trimmed = trimmed.slice(1);
  if (trimmed.length === 0) return null;
  if (isAbsoluteRemotePath(trimmed)) return normalizeRemotePath(trimmed);
  if (trimmed.startsWith('~') || projectPath.length === 0) return null;
  return normalizeRemotePath(joinRemotePath(projectPath, trimmed.replace(/^\.[\\/]/u, '')));
}

/** {@link remotePathForChatFile} when the viewer can show the file, else null. */
export function docPathForChatFile(path: string, projectPath: string): string | null {
  const remote = remotePathForChatFile(path, projectPath);
  return remote !== null && previewKindForPath(remote) !== null ? remote : null;
}
