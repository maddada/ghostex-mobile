/**
 * Opening a Markdown or HTML file from anywhere in the app (a chat file link, a terminal `file://`
 * hyperlink) in the Docs viewer.
 */

import { isAbsoluteRemotePath } from '../addProject/paths';
import { docKindForPath, joinRemotePath, normalizeRemotePath } from './paths';

/**
 * The computer-side path a `file://` URL names, when it is a Markdown or HTML file. The host part
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
  if (docKindForPath(path) === null) return null;
  const fragment = match[2];
  return fragment !== undefined && fragment.length > 0 ? { path, fragment } : { path };
}

/**
 * A chat file reference as an absolute path when it names a Markdown or HTML file: absolute as
 * written, or relative to the session's project folder.
 */
export function docPathForChatFile(path: string, projectPath: string): string | null {
  const trimmed = path.trim();
  if (docKindForPath(trimmed) === null) return null;
  if (isAbsoluteRemotePath(trimmed)) return normalizeRemotePath(trimmed);
  if (trimmed.startsWith('~') || projectPath.length === 0) return null;
  return joinRemotePath(projectPath, trimmed.replace(/^\.\//u, ''));
}
