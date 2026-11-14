/**
 * What a page shown in the phone's Docs viewer may do: which computer files its mirror may copy,
 * where it may load from or connect to (its content policy), and which of its navigations open
 * at once, open only after asking, or stay in the page. Plain functions with no native imports, so
 * `page.ts` and `DocViewerScreen.tsx` share one copy of the rules.
 *
 * CDXC:Docs 2026-11-14 DECISION:
 * User (Q3120, "P1 to P3 now, P5 checked"), the phone's side of the desktop's Files page rules
 * (apps/desktop/src/app/helpers/manage_embed_page_rules.rs, html-viewer.tsx):
 * - An HTML page copies plain files from its own folder and below only, never dot-files or
 *   dot-folders, whether its markup names them or its script asks for them while it runs.
 * - The page loads only from its mirror, the desktop's library CDNs and the phone forwards the
 *   viewer opens for it, and connects only to the mirror and those CDNs, so nothing it reads can
 *   leave (a content policy `<meta>` written first in the mirrored page).
 * - A navigation the user did not tap asks first; a link that hands off to another app always
 *   asks, as the desktop's "Open a link in another app?" (CDXC:Navigation 2026-11-05 in
 *   session_chat/runnable_links.rs). A tap on an ordinary link opens it as before.
 * SEE-ALSO: apps/mobile/app/src/docs/page.ts (CDXC:Docs 2026-10-25), DocViewerScreen.tsx
 */

import { remotePathFromFileUrl } from './openDoc';
import { AGENTATION_ORIGIN } from './agentation';
import { MERMAID_MODULE_FOLDER } from './markdownDocument';
import type { ViewerProject } from './mediaStream';
import { dirName, fileUrlForDocsLoaderUrl, normalizeRemotePath, remotePathForMirrorUrl, type DocKind } from './paths';

// Copy scope ------------------------------------------------------------------------------------

/** Where a page's mirror may copy from, and the folder whose dot-folders it may not enter. */
export type MirrorScope = {
  /** Every copied file sits in this computer folder or below. */
  folder: string;
  /** No path segment below this folder may start with `.` (the project, or the page's folder). */
  hiddenFrom: string;
};

/**
 * The computer folder a page may copy files from. An HTML page copies from its own folder and
 * below, as the desktop's Files page reads (`manage_docs_page_may_read`). A Markdown page keeps
 * its project, so `../images/…` beside a docs folder still shows: its policy runs no script of the
 * file's own ({@link docPageContentPolicy}), so only what its text names is copied. A
 * picture, text or media page names nothing beyond its own file and keeps to its folder.
 * Dot-folders count from the project root when the page is in one.
 */
export function mirrorScopeFor(
  documentPath: string,
  project: ViewerProject | null,
  kind: DocKind | 'other',
): MirrorScope {
  const document = normalizeRemotePath(documentPath);
  const own = dirName(document);
  const projectPath = project === null ? null : normalizeRemotePath(project.projectPath).replace(/\/+$/u, '');
  if (projectPath === null || projectPath.length === 0 || !isWithin(projectPath, document)) {
    return { folder: own, hiddenFrom: own };
  }
  return { folder: kind === 'markdown' ? projectPath : own, hiddenFrom: projectPath };
}

function samePathText(path: string): string {
  // Windows drive and UNC paths are case-insensitive.
  return /^(?:[a-z]:\/|\/\/)/iu.test(path) ? path.toLowerCase() : path;
}

export function isWithin(folder: string, path: string): boolean {
  const base = samePathText(folder.replace(/\/+$/u, ''));
  const candidate = samePathText(path);
  return candidate === base || candidate.startsWith(`${base}/`);
}

/**
 * Whether a computer path may be copied for a page: inside its folder, and no segment below the
 * project (or the page's folder) starts with `.`, which also refuses any `..` left in a path the
 * page wrote. The computer checks the folder again once links are resolved (`remoteFiles.ts`).
 */
export function mayCopyForPage(scope: MirrorScope, path: string): boolean {
  if (!isWithin(scope.folder, path)) return false;
  const base = scope.hiddenFrom.replace(/\/+$/u, '');
  const rest = isWithin(base, path) ? path.slice(base.length) : path;
  return !rest.split('/').some((segment) => segment.startsWith('.'));
}

// Content policy --------------------------------------------------------------------------------

/**
 * Public library CDNs a page may still load scripts, styles, fonts and pictures from, and fetch
 * from. Keep in step with `MANAGE_HTML_PAGE_LIBRARY_HOSTS` in
 * apps/desktop/src/app/helpers/manage_embed_page_rules.rs.
 */
export const DOC_PAGE_LIBRARY_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.tailwindcss.com',
  'd3js.org',
  'cdn.plot.ly',
  'code.jquery.com',
] as const;

/**
 * The phone forwards the viewer answers a page's loopback pictures and media with
 * (`http://127.0.0.1:<phone port>/…`, DocViewerScreen.tsx). Their phone port is only known once
 * the forward opens, after the page has loaded, so any port on the phone's own loopback is allowed
 * for loads, never for `fetch`, sockets or forms.
 */
const PHONE_FORWARDS = 'http://127.0.0.1:* https://127.0.0.1:*';

/**
 * CDXC:Docs 2026-11-14 WHY:
 * The mirrored page's own files are named by `mirrorSource`: `file:` on iOS, a `file://` document
 * WebKit keeps to the page's folder (`allowingReadAccessToURL`), and the mirror under the Docs
 * loader's origin on Android (`DOCS_LOADER_ORIGIN` in paths.ts), the only place that WebView
 * serves it from. Frames are limited to `blob:`
 * because a mirrored file loaded in a frame would run without this policy, and the phone, unlike
 * the desktop app, cannot hold every frame to it from outside (an SVG in a frame runs its scripts).
 * An HTML page's own scripts run as authored; Agentation still loads from esm.sh on the phone
 * (`agentation.ts`), so its host is allowed for scripts. A Markdown page runs only the viewer's own
 * Mermaid script, by nonce: script in the Markdown file never runs.
 */
export function docPageContentPolicy(options: { markdownScriptNonce?: string; mirrorSource?: string } = {}): string {
  const libraries = DOC_PAGE_LIBRARY_HOSTS.map((host) => `https://${host}`).join(' ');
  const mirror = options.mirrorSource ?? 'file:';
  const scripts =
    options.markdownScriptNonce === undefined
      ? `${mirror} ${libraries} ${AGENTATION_ORIGIN} 'unsafe-inline' 'unsafe-eval' blob: data: ${PHONE_FORWARDS}`
      : `'nonce-${options.markdownScriptNonce}' ${MERMAID_MODULE_FOLDER}`;
  return [
    "default-src 'none'",
    `script-src ${scripts}`,
    `style-src ${mirror} ${libraries} 'unsafe-inline' blob: data: ${PHONE_FORWARDS}`,
    `img-src ${mirror} ${libraries} blob: data: ${PHONE_FORWARDS}`,
    `font-src ${mirror} ${libraries} blob: data: ${PHONE_FORWARDS}`,
    `media-src ${mirror} blob: data: ${PHONE_FORWARDS}`,
    `connect-src ${mirror} ${libraries} blob: data:`,
    'worker-src blob:',
    'frame-src blob:',
    "object-src 'none'",
    "form-action 'none'",
    "manifest-src 'none'",
  ].join('; ');
}

/** A fresh nonce for the viewer's own script in a rendered Markdown page. */
export function newScriptNonce(): string {
  let nonce = '';
  for (let index = 0; index < 4; index += 1)
    nonce += Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  return nonce;
}

/** Leading whitespace and comments, then the doctype: the policy goes right after them. */
const DOCUMENT_PREAMBLE = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype[^>]*>)?/iu;
const DECLARED_CHARSET =
  /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([a-z0-9_.:-]+)|<meta\b[^>]*?\bcontent\s*=\s*["'][^"']*?charset\s*=\s*([a-z0-9_.:-]+)/iu;

/**
 * The tags written first in a page: the page's own character set again when it declares one in its
 * first 1024 bytes (where the browser looks for it, and the policy would push it past), the
 * content policy, and DNS prefetching off (a prefetch is not a request the policy can refuse).
 */
function policyTags(head: string, policy: string, withCharset: boolean): string {
  const declared = withCharset ? DECLARED_CHARSET.exec(head.slice(0, 1024)) : null;
  const charset = declared?.[1] ?? declared?.[2];
  return (
    (charset === undefined ? '' : `<meta charset="${charset}">`) +
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    '<meta http-equiv="x-dns-prefetch-control" content="off">'
  );
}

/** HTML text with the policy written first, after any doctype (before it would switch to quirks mode). */
export function withPagePolicy(html: string, policy: string): string {
  const at = DOCUMENT_PREAMBLE.exec(html)?.[0].length ?? 0;
  return html.slice(0, at) + policyTags(html, policy, true) + html.slice(at);
}

/**
 * {@link withPagePolicy} for a page's bytes as base64, so a page in any encoding keeps its bytes:
 * the tags are ASCII, spliced in at the byte level, or as UTF-16 after a UTF-16 byte-order mark.
 */
export function withPagePolicyBase64(base64: string, policy: string): string {
  const bytes = atob(base64);
  const first = bytes.charCodeAt(0);
  const second = bytes.charCodeAt(1);
  const utf16 = first === 0xff && second === 0xfe ? 'le' : first === 0xfe && second === 0xff ? 'be' : null;
  if (utf16 === null) {
    const start = first === 0xef && second === 0xbb && bytes.charCodeAt(2) === 0xbf ? 3 : 0;
    const view = bytes.slice(start, start + 65536);
    const at = start + (DOCUMENT_PREAMBLE.exec(view)?.[0].length ?? 0);
    return btoa(bytes.slice(0, at) + policyTags(view, policy, true) + bytes.slice(at));
  }
  let view = '';
  for (let index = 2; index + 1 < bytes.length && view.length < 65536; index += 2) {
    const high = utf16 === 'le' ? bytes.charCodeAt(index + 1) : bytes.charCodeAt(index);
    const low = utf16 === 'le' ? bytes.charCodeAt(index) : bytes.charCodeAt(index + 1);
    view += String.fromCharCode((high << 8) | low);
  }
  const at = 2 + 2 * (DOCUMENT_PREAMBLE.exec(view)?.[0].length ?? 0);
  // A UTF-16 page's own `charset` declaration is ignored by the browser, so none is repeated.
  const tags = policyTags(view, policy, false)
    .split('')
    .map((character) => (utf16 === 'le' ? `${character}\u0000` : `\u0000${character}`))
    .join('');
  return btoa(bytes.slice(0, at) + tags + bytes.slice(at));
}

// Navigation ------------------------------------------------------------------------------------

/** Why a navigation asks before it opens. */
export type DocLinkAsk = 'otherApp' | 'notTapped';

export type DocNavigation =
  /** Loads in the page itself: its own anchors, `about:`, `blob:` and `javascript:` URLs. */
  | { kind: 'stay' }
  /** Never loads: a top-level `data:` document would run without the page's policy. */
  | { kind: 'refuse' }
  /** Another file on the computer, opened in a new viewer. */
  | { kind: 'file'; path: string; fragment: string; ask: DocLinkAsk | null }
  /** A web or loopback address, through the machine-aware opener (`useOpenMachineLink`). */
  | { kind: 'web'; url: string; ask: DocLinkAsk | null }
  /** Any other scheme, handed to the phone (`Linking.openURL`). */
  | { kind: 'app'; url: string; ask: DocLinkAsk | null };

/** How long after the user last touched the page a navigation counts as theirs. */
export const DOC_TAP_WINDOW_MS = 1500;

/**
 * Whether the user tapped for a navigation: they touched the page just before it (the app sees
 * that touch itself, so a page cannot fake it), and on iOS WebKit also reports a link activated
 * (`navigationType: 'click'`), so a script's `location = …` during a tap still asks. Android's
 * WebView reports no navigation type.
 */
export function navigationWasTapped(
  lastTouchAt: number | null,
  now: number,
  navigationType: string | undefined,
  platform: string,
): boolean {
  if (lastTouchAt === null || now - lastTouchAt < 0 || now - lastTouchAt > DOC_TAP_WINDOW_MS) return false;
  return platform !== 'ios' || navigationType === 'click';
}

function decodePath(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * What a top-frame navigation of the page at `pagePath` does. A frame's own navigations stay in
 * the frame, where the page's policy (`frame-src`) holds them.
 */
export function docNavigationFor(rawUrl: string, pagePath: string, tapped: boolean): DocNavigation {
  // Android's mirror and the computer paths a page names arrive under the Docs loader's origin.
  const url = fileUrlForDocsLoaderUrl(rawUrl);
  if (/^(?:about|blob|javascript):/iu.test(url)) return { kind: 'stay' };
  if (/^data:/iu.test(url)) return { kind: 'refuse' };
  const ask: DocLinkAsk | null = tapped ? null : 'notTapped';
  if (/^https?:\/\//iu.test(url)) return { kind: 'web', url, ask };
  const mirrored = remotePathForMirrorUrl(url);
  if (mirrored !== null) {
    const target = normalizeRemotePath(mirrored.remotePath);
    // The page itself, including a jump to one of its own anchors.
    if (target === pagePath || target === `${pagePath}.ghostex-view.html`) return { kind: 'stay' };
    return { kind: 'file', path: target, fragment: mirrored.fragment, ask };
  }
  // An absolute path the page wrote (`/Users/…`, `file:///…`, `C:/…`) resolved against the
  // phone's own file system; it names a file on the computer.
  const file = remotePathFromFileUrl(url);
  if (file !== null) return { kind: 'file', path: file.path, fragment: file.fragment ?? '', ask };
  if (/^[a-z]:\//iu.test(url))
    return { kind: 'file', path: decodePath(url.split(/[?#]/u)[0] ?? ''), fragment: '', ask };
  // Email links open as before; any other app's link shows its target first, tap or not.
  return { kind: 'app', url, ask: /^mailto:/iu.test(url) ? ask : 'otherApp' };
}
