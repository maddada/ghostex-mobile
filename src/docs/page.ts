/**
 * Builds what the Docs viewer loads: the document and everything it embeds, copied from the
 * computer into a mirror folder on the phone that keeps the computer's own paths, so the page loads
 * from `file://` with its relative images, styles, scripts and frames intact.
 *
 * CDXC:Docs 2026-09-30 WHY:
 * react-native-webview cannot answer a page's requests itself (desktop Docs serves sibling assets
 * from a synthetic `ghostex-docs.invalid` origin that CEF intercepts), so the phone copies the
 * assets up front instead: every relative reference the HTML, its stylesheets and its module
 * scripts name is read in batches over SSH and written beside the page. Files whose paths the page
 * builds while it runs are copied when they fail to load (`assetLoader.ts`,
 * {@link mirrorRequestedAssets}); this replaces the 2026-09-24 note that such pages stay broken.
 * SEE-ALSO: apps/desktop/views/manage/preview/html-viewer.tsx (`manageHtmlResourceBaseUrl`)
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { DocsCopy } from '../copy';
import type { SidebarAppearance } from '../theme/sidebarAppearance';
import { filePreview, isTextFile, PREVIEW_MAX_BYTES, type InfoReason } from '../files/preview';
import type { MachineConnectionTarget } from '../machines/credentials';
import { renderMarkdownDocument } from './markdownDocument';
import { computerFileUrl, type ViewerProject } from './mediaStream';
import { remotePathFromFileUrl } from './openDoc';
import {
  docPageContentPolicy,
  mayCopyForPage,
  mirrorScopeFor,
  newScriptNonce,
  withPagePolicy,
  withPagePolicyBase64,
  type MirrorScope,
} from './pageRules';
import {
  baseName,
  DOCS_LOADER_ORIGIN,
  docsLoaderUrl,
  extensionOf,
  fileUrlForDocsLoaderUrl,
  MIRROR_FOLDER,
  mirrorSegments,
  normalizeRemotePath,
  previewKindForPath,
  remotePathForMirrorUrl,
  resolveRemoteReference,
  type PreviewKind,
} from './paths';
import { renderImageDocument, renderMediaDocument, renderSourceDocument, renderTextDocument } from './plainDocument';
import { decodeBase64Utf8, readRemoteFiles } from './remoteFiles';

const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
/** A WebView lays out a few megabytes of wrapped monospace slowly; logs past this stay on the computer. */
const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const ASSET_MAX_BYTES = 12 * 1024 * 1024;
const ASSETS_MAX_COUNT = 250;
const ASSETS_MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const ASSET_BATCH_SIZE = 40;
/** HTML → stylesheet → the stylesheet's own imports and fonts. */
const ASSET_MAX_DEPTH = 4;

export type DocPage =
  | { kind: 'info'; reason: InfoReason; size: number | null }
  | { kind: 'source'; html: string }
  | {
      kind: PreviewKind;
      /** What the WebView loads: the mirror file's `file://` URI, under the Docs loader's origin on Android. */
      uri: string;
      /** The mirror folder. */
      rootUri: string;
      /**
       * The mirror of the folder the page copies from (`mirrorScopeFor`): iOS widens the page's
       * read access to it for the page's sibling files, and no further.
       */
      readAccessUri: string;
      title: string;
      /** Referenced files that were missing, too large, or over the page budget. */
      skippedAssets: number;
      /** What this page has already copied or tried, for the files it asks for while it runs. */
      mirror: DocMirror;
      /** Computer loopback ports the document's own markup names: the only ones the viewer forwards. */
      loopbackPorts: ReadonlySet<number>;
    };

/** One opened page's mirror bookkeeping. */
type DocMirror = {
  machine: MachineConnectionTarget;
  rootUri: string;
  /** The computer folder every copied file must sit in, and where dot-folders count from (`mirrorScopeFor`). */
  scope: MirrorScope;
  /** Remote paths already copied, found missing, or refused; never read twice. */
  settled: Set<string>;
  /** Remote paths now in the mirror. */
  copied: Set<string>;
  /** The page's requests run one after another, so a second ask for a file waits for the first. */
  requests: Promise<unknown>;
  copiedCount: number;
  copiedBytes: number;
};

let mirrorCleared = false;

function mirrorRoot(): Directory {
  const root = new Directory(Paths.cache, MIRROR_FOLDER);
  // Pages from an earlier run are stale copies; start each app run from an empty mirror.
  if (!mirrorCleared) {
    mirrorCleared = true;
    try {
      if (root.exists) root.delete();
    } catch {
      // A leftover file that cannot be deleted is overwritten when its page is opened again.
    }
  }
  root.create({ intermediates: true, idempotent: true });
  return root;
}

function directoryUri(directory: Directory): string {
  return directory.uri.endsWith('/') ? directory.uri : `${directory.uri}/`;
}

/** Android's Docs viewer loads the mirror through the WebView's asset loader (`DOCS_LOADER_ORIGIN`). */
const LOADS_THROUGH_DOCS_LOADER = Platform.OS === 'android';

/** The URL the WebView loads a mirror file from. */
function loadUrl(fileUri: string): string {
  return LOADS_THROUGH_DOCS_LOADER ? docsLoaderUrl(fileUri) : fileUri;
}

/** What a page's content policy names its own mirrored files by (`docPageContentPolicy`). */
const MIRROR_SOURCE = LOADS_THROUGH_DOCS_LOADER ? `${DOCS_LOADER_ORIGIN}/${MIRROR_FOLDER}/` : 'file:';

/** The `file://` URI a remote path is mirrored at, each segment percent-encoded. */
function mirrorUri(rootUri: string, remotePath: string): string | null {
  const segments = mirrorSegments(remotePath);
  if (segments === null || segments.length < 2) return null;
  return rootUri + segments.map(encodeURIComponent).join('/');
}

function writeMirrorFile(uri: string, content: string, encoding: 'base64' | 'utf8'): void {
  const file = new File(uri);
  file.create({ intermediates: true, overwrite: true });
  file.writeSync(content, { encoding });
}

const MIRROR_PATH_IN_TEXT = new RegExp(
  `(?:${DOCS_LOADER_ORIGIN.replace(/[.]/gu, '\\.')}|(?:file://)?/[^\\s"'\`()<>]*)/${MIRROR_FOLDER}/[^\\s"'\`()<>#?]+`,
  'gu',
);

/**
 * Rewrites phone mirror paths inside text (Agentation's copied feedback names the page it was
 * written on) back to the file's path on the computer, which is what an agent reading it can use.
 * A Markdown file's rendered page is named after the Markdown file itself.
 */
export function mirrorPathsToRemote(text: string): string {
  return text.replace(MIRROR_PATH_IN_TEXT, (match) => {
    const url = match.startsWith('file://') || match.startsWith(DOCS_LOADER_ORIGIN) ? match : `file://${match}`;
    const remote = remotePathForMirrorUrl(url)?.remotePath;
    return remote === undefined ? match : remote.replace(/\.ghostex-view\.html$/u, '');
  });
}

// Reference discovery ---------------------------------------------------------------------------

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#0*39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');
}

/** A page-relative file reference, percent-decoded, or null for anything that is not one. */
function localReference(raw: string): string | null {
  const value = decodeEntities(raw.trim());
  if (value.length === 0 || value.startsWith('#') || value.startsWith('/') || value.startsWith('\\')) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) return null;
  const clean = value.split('#')[0]?.split('?')[0] ?? '';
  if (clean.length === 0) return null;
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

const EMBEDDING_TAG =
  /<(img|source|video|audio|script|link|iframe|frame|embed|object|input|track|use|image)\b([^>]*)>/giu;
const URL_ATTRIBUTE = /\s(src|href|srcset|poster|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/giu;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/giu;
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/giu;
const MODULE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(?:"(\.{1,2}\/[^"]*)"|'(\.{1,2}\/[^']*)')/gu;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/giu;
const STYLE_ATTRIBUTE = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;

function cssReferences(css: string, into: Set<string>): void {
  for (const match of css.matchAll(CSS_URL)) {
    const reference = localReference(match[1] ?? match[2] ?? match[3] ?? '');
    if (reference !== null) into.add(reference);
  }
  for (const match of css.matchAll(CSS_IMPORT)) {
    const reference = localReference(match[1] ?? match[2] ?? '');
    if (reference !== null) into.add(reference);
  }
}

function moduleReferences(source: string, into: Set<string>): void {
  for (const match of source.matchAll(MODULE_SPECIFIER)) {
    const reference = localReference(match[1] ?? match[2] ?? '');
    if (reference !== null) into.add(reference);
  }
}

function htmlReferences(html: string): Set<string> {
  const references = new Set<string>();
  for (const tag of html.matchAll(EMBEDDING_TAG)) {
    const name = (tag[1] ?? '').toLowerCase();
    const attributes = tag[2] ?? '';
    if (
      name === 'link' &&
      /\brel\s*=\s*["']?(?:canonical|alternate|next|prev|author|help|license)\b/iu.test(attributes)
    ) {
      continue;
    }
    for (const attribute of attributes.matchAll(URL_ATTRIBUTE)) {
      const key = (attribute[1] ?? '').toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      const candidates =
        key === 'srcset' ? value.split(',').map((part) => part.trim().split(/\s+/u)[0] ?? '') : [value];
      for (const candidate of candidates) {
        const reference = localReference(candidate);
        if (reference !== null) references.add(reference);
      }
    }
  }
  for (const block of html.matchAll(STYLE_BLOCK)) cssReferences(block[1] ?? '', references);
  for (const attribute of html.matchAll(STYLE_ATTRIBUTE))
    cssReferences(decodeEntities(attribute[1] ?? attribute[2] ?? ''), references);
  moduleReferences(html, references);
  return references;
}

function referencesOf(remotePath: string, text: string): Set<string> {
  const extension = extensionOf(remotePath);
  if (extension === 'css') {
    const references = new Set<string>();
    cssReferences(text, references);
    return references;
  }
  if (extension === 'js' || extension === 'mjs') {
    const references = new Set<string>();
    moduleReferences(text, references);
    return references;
  }
  if (extension === 'html' || extension === 'htm' || extension === 'svg') return htmlReferences(text);
  return new Set();
}

/** Files whose text can name further files worth copying. */
function isScannable(remotePath: string): boolean {
  return ['css', 'js', 'mjs', 'html', 'htm', 'svg'].includes(extensionOf(remotePath));
}

// Scope -----------------------------------------------------------------------------------------

/*
 * CDXC:Docs 2026-10-25 WHY:
 * A page's own script can name any computer path or loopback address for the viewer to fetch, and it runs with file access in the WebView, so a Markdown or HTML file from a cloned repository could copy ~/.ssh keys or the gxserver token into the mirror, read them and send them out, or get a forward to the computer's gxserver (security audit 2026-10-25, user decision Q6). Copies now stay inside the page's project (or folder) and skip hidden files and folders, and forwards go only to loopback ports the page's own markup names, never gxserver's (DocViewerScreen.tsx).
 *
 * CDXC:Docs 2026-11-14 DECISION:
 * User (Q3120, "P1 to P3 now, P5 checked"), with the desktop's Files page rules (CDXC:Docs 2026-11-14 in apps/desktop/src/app/helpers/manage_embed_page_rules.rs) as the model, the rules now in `pageRules.ts`:
 * - P1, narrow Docs page reads: an HTML page copies plain files from its own folder and below only, never dot-files or dot-folders (counted from the project root), whether its markup names them or its script asks while it runs; the computer refuses a file whose resolved folder is a dot-folder too (`remoteFiles.ts`). A Markdown page keeps its project, because its policy runs none of the file's own script.
 * - P2, no network for the page: a content policy `<meta>` written first in the mirrored page lets it load only from the mirror, the desktop's library CDNs and the viewer's phone forwards, and connect only to the mirror and those CDNs; frames take `blob:` only.
 * - P3, ask before leaving a Docs page: a navigation the user did not tap asks first, and another app's link always asks; a tap on an ordinary link opens as before (DocViewerScreen.tsx).
 * - P4, known limit: a loopback port the page's markup names is forwarded, so that server on the computer can still receive the page's requests (loads only, now: the policy refuses `fetch`, sockets and forms there), and a page can load from any phone loopback port.
 * - P5, checked, not changed here: on Android the page runs with `allowFileAccessFromFileURLs`, so it can read the app's own files under `file://` (AsyncStorage's database, chat snapshots, other pages' mirrors); P2 keeps what it reads from leaving, and the full fix is native (the next app build).
 * - P5, 11.7.0 app build (user, Q3199 "Fix in the next app build"): Android serves the mirror through the WebView's asset loader at `DOCS_LOADER_ORIGIN` (paths.ts) with file access, file-URL access and universal access off, so a page reaches its mirror and nothing else of the app's; iOS is unchanged.
 */

const LOOPBACK_URL =
  /\b(https?):\/\/(?:[^\s\/?#@"'<>]*@)?(?:localhost|[^\s\/?#:"'<>]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::(\d{1,5}))?(?=[\/?#"'\s<>)]|$)/giu;

/** The computer loopback ports a page's text names (`http://localhost:3000/…`), with scheme defaults. */
function loopbackPortsIn(text: string): Set<number> {
  const ports = new Set<number>();
  for (const match of text.matchAll(LOOPBACK_URL)) {
    const port = match[2] === undefined ? (match[1]?.toLowerCase() === 'https' ? 443 : 80) : Number(match[2]);
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port);
  }
  return ports;
}

// Building --------------------------------------------------------------------------------------

/**
 * Copies the given remote files into the mirror, then whatever those files name in turn. Returns
 * how many were left out. `limitTotals` applies the page budget, which keeps opening a page quick;
 * files the running page asks for are copied without it.
 */
async function mirrorAssets(
  mirror: DocMirror,
  initialPaths: readonly string[],
  isCancelled: () => boolean,
  limitTotals: boolean,
): Promise<number> {
  let skipped = 0;
  let pending = [...initialPaths];
  for (let depth = 0; depth < ASSET_MAX_DEPTH && pending.length > 0; depth += 1) {
    const level = pending.filter((path) => {
      if (mirror.settled.has(path)) return false;
      mirror.settled.add(path);
      return true;
    });
    pending = [];
    // Left settled, so a page that keeps asking for an out-of-scope file is not asked about again.
    const allowed = level.filter((path) => mayCopyForPage(mirror.scope, path));
    for (let start = 0; start < allowed.length; start += ASSET_BATCH_SIZE) {
      if (isCancelled()) return skipped;
      const batch = allowed.slice(start, start + ASSET_BATCH_SIZE);
      if (limitTotals && (mirror.copiedCount >= ASSETS_MAX_COUNT || mirror.copiedBytes >= ASSETS_MAX_TOTAL_BYTES)) {
        // Left unsettled, so the page can still ask for them once it runs.
        batch.forEach((path) => mirror.settled.delete(path));
        skipped += batch.length;
        continue;
      }
      let reads: Awaited<ReturnType<typeof readRemoteFiles>>;
      try {
        // The computer also checks the scope after resolving links (remoteFiles.ts).
        reads = await readRemoteFiles(mirror.machine, batch, ASSET_MAX_BYTES, mirror.scope.folder);
      } catch (error) {
        // The computer could not be asked; a later ask (or Reload) tries these files again.
        batch.forEach((path) => mirror.settled.delete(path));
        throw error;
      }
      batch.forEach((path, index) => {
        const read = reads[index];
        const uri = mirrorUri(mirror.rootUri, path);
        // A missing file is broken on the computer too; only what the phone left out is counted.
        if (read === undefined || read.status === 'missing' || uri === null) return;
        if (read.status === 'tooLarge') {
          skipped += 1;
          return;
        }
        if (limitTotals && mirror.copiedBytes + read.bytes > ASSETS_MAX_TOTAL_BYTES) {
          mirror.settled.delete(path);
          skipped += 1;
          return;
        }
        writeMirrorFile(uri, read.base64, 'base64');
        mirror.copied.add(path);
        mirror.copiedCount += 1;
        mirror.copiedBytes += read.bytes;
        if (isScannable(path)) {
          for (const reference of referencesOf(path, decodeBase64Utf8(read.base64))) {
            pending.push(resolveRemoteReference(path, reference));
          }
        }
      });
    }
  }
  return skipped;
}

/**
 * The computer path a URL a page failed to load names: a file in the mirror, or an absolute path
 * the page wrote itself (`/Users/…/shot.png`, `file:///home/…`, `C:/…`), which on the phone resolved
 * against the phone's own file system. Null for anything else.
 */
function remotePathForRequestedUrl(url: string): string | null {
  const mirrored = remotePathForMirrorUrl(url);
  if (mirrored !== null) return mirrored.remotePath;
  const file = remotePathFromFileUrl(fileUrlForDocsLoaderUrl(url));
  if (file !== null) return file.path;
  // A Windows path in a page reads as a one-letter URL scheme (`c:/Users/…`).
  if (/^[a-z]:\//iu.test(url)) {
    try {
      return decodeURIComponent(url.split(/[?#]/u)[0] ?? '');
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Copies files the loaded page asked for while it ran (see `assetLoader.ts`), given as the URLs
 * that failed: mirror URLs, and absolute computer paths, which are copied into the mirror like any
 * other file. Answers each URL whose file is now in the mirror with the mirror URL to load instead
 * (the same URL for a mirror file); a file that is missing on the computer or too large is left
 * out, and the page tries each file again only once.
 */
export async function mirrorRequestedAssets(
  page: Exclude<DocPage, { kind: 'info' | 'source' }>,
  urls: readonly string[],
): Promise<Record<string, string>> {
  const byPath = new Map<string, string[]>();
  for (const url of urls) {
    const remotePath = remotePathForRequestedUrl(url);
    if (remotePath === null) continue;
    const path = normalizeRemotePath(remotePath);
    byPath.set(path, [...(byPath.get(path) ?? []), url]);
  }
  if (byPath.size === 0) return {};
  const mirror = page.mirror;
  const request = mirror.requests.then(() => mirrorAssets(mirror, [...byPath.keys()], () => false, false));
  mirror.requests = request.catch(() => undefined);
  await request;
  const replacements: Record<string, string> = {};
  for (const [path, pathUrls] of byPath) {
    if (!mirror.copied.has(path)) continue;
    const mirrored = mirrorUri(mirror.rootUri, path);
    for (const url of pathUrls) {
      const replacement = remotePathForMirrorUrl(url) !== null ? url : mirrored === null ? null : loadUrl(mirrored);
      if (replacement !== null) replacements[url] = replacement;
    }
  }
  return replacements;
}

/**
 * Reads a file off the computer and mirrors it, with what it embeds, for the viewer: HTML as
 * authored, Markdown rendered, text and pictures in a page of their own. A size from Files applies
 * its preview limit and numbered source mode, or returns metadata without reading unsupported content.
 * Throws a message fit to show when the file cannot be read.
 */
export async function buildDocPage(
  machine: MachineConnectionTarget,
  remotePath: string,
  appearance: SidebarAppearance,
  isCancelled: () => boolean = () => false,
  project: ViewerProject | null = null,
  fileSize?: number | null,
): Promise<DocPage> {
  const documentPath = normalizeRemotePath(remotePath);
  const browserPreview = fileSize === undefined ? null : filePreview(baseName(documentPath), fileSize);
  if (browserPreview?.kind === 'info') return { ...browserPreview, size: fileSize ?? null };
  const numberedSource = browserPreview?.kind === 'source';
  const kind = numberedSource ? 'text' : previewKindForPath(documentPath);
  if (kind === null) throw new Error(`This kind of file can't be previewed on the phone: ${documentPath}`);
  const root = mirrorRoot();
  const rootUri = directoryUri(root);
  const documentUri = mirrorUri(rootUri, documentPath);
  if (documentUri === null) throw new Error(`Not a full path on the computer: ${remotePath}`);
  const title = baseName(documentPath);
  const scope = mirrorScopeFor(documentPath, project, kind === 'html' || kind === 'markdown' ? kind : 'other');
  const readAccessUri = mirrorFolderUri(rootUri, scope.folder);
  // Beside the file, so a Markdown page's relative images and a picture's own name resolve there.
  const pageUri = `${documentUri}.ghostex-view.html`;

  if (kind === 'video' || kind === 'audio') {
    // Streamed from the computer rather than copied: the page only names where it plays from.
    const source = await computerFileUrl(machine, documentPath, project);
    writeMirrorFile(pageUri, renderMediaDocument(kind, source, title, appearance), 'utf8');
    return {
      kind,
      uri: loadUrl(pageUri),
      rootUri,
      readAccessUri,
      title,
      skippedAssets: 0,
      mirror: emptyMirror(machine, rootUri, documentPath, scope),
      loopbackPorts: new Set(),
    };
  }

  const maximumBytes =
    fileSize !== undefined
      ? PREVIEW_MAX_BYTES
      : kind === 'image'
        ? ASSET_MAX_BYTES
        : kind === 'text'
          ? TEXT_MAX_BYTES
          : DOCUMENT_MAX_BYTES;
  const [read] = await readRemoteFiles(machine, [documentPath], maximumBytes);
  if (read === undefined || read.status === 'missing') {
    throw new Error(fileSize !== undefined ? DocsCopy.fileMissing : `File not found: ${documentPath}`);
  }
  if (read.status === 'tooLarge') {
    if (fileSize !== undefined) return { kind: 'info', reason: 'large', size: fileSize };
    throw new Error('This file is too large to open on the phone.');
  }
  if (numberedSource) {
    if (!isTextFile(read.base64)) return { kind: 'info', reason: 'binary', size: read.bytes };
    return { kind: 'source', html: renderSourceDocument(decodeBase64Utf8(read.base64), title, appearance) };
  }

  if (kind === 'image') {
    writeMirrorFile(documentUri, read.base64, 'base64');
    writeMirrorFile(pageUri, renderImageDocument(title, title, appearance), 'utf8');
    return {
      kind,
      uri: loadUrl(pageUri),
      rootUri,
      readAccessUri,
      title,
      skippedAssets: 0,
      mirror: emptyMirror(machine, rootUri, documentPath, scope),
      loopbackPorts: new Set(),
    };
  }
  const text = decodeBase64Utf8(read.base64);
  if (kind === 'text') {
    if (/\u0000/u.test(text)) throw new Error("This file isn't text, so it can't be previewed on the phone.");
    writeMirrorFile(pageUri, renderTextDocument(text, title, appearance), 'utf8');
    return {
      kind,
      uri: loadUrl(pageUri),
      rootUri,
      readAccessUri,
      title,
      skippedAssets: 0,
      mirror: emptyMirror(machine, rootUri, documentPath, scope),
      loopbackPorts: new Set(),
    };
  }

  const mirror = emptyMirror(machine, rootUri, documentPath, scope);
  const referencedPaths = (references: Set<string>) =>
    [...references].map((reference) => resolveRemoteReference(documentPath, reference));

  if (kind === 'html') {
    // The page's bytes as authored, with its content policy written first (`pageRules.ts`).
    writeMirrorFile(
      documentUri,
      withPagePolicyBase64(read.base64, docPageContentPolicy({ mirrorSource: MIRROR_SOURCE })),
      'base64',
    );
    const skippedAssets = await mirrorAssets(mirror, referencedPaths(htmlReferences(text)), isCancelled, true);
    return {
      kind,
      uri: loadUrl(documentUri),
      rootUri,
      readAccessUri,
      title,
      skippedAssets,
      mirror,
      loopbackPorts: loopbackPortsIn(text),
    };
  }

  const markdownScriptNonce = newScriptNonce();
  const html = renderMarkdownDocument(text, title, appearance, markdownScriptNonce);
  writeMirrorFile(
    pageUri,
    withPagePolicy(html, docPageContentPolicy({ markdownScriptNonce, mirrorSource: MIRROR_SOURCE })),
    'utf8',
  );
  const skippedAssets = await mirrorAssets(mirror, referencedPaths(htmlReferences(html)), isCancelled, true);
  return {
    kind,
    uri: loadUrl(pageUri),
    rootUri,
    readAccessUri,
    title,
    skippedAssets,
    mirror,
    loopbackPorts: loopbackPortsIn(html),
  };
}

/** The `file://` URI of a computer folder's mirror, ending in `/`; the mirror root when it has none. */
function mirrorFolderUri(rootUri: string, folder: string): string {
  const segments = mirrorSegments(folder);
  if (segments === null || segments.length === 0) return rootUri;
  return `${rootUri}${segments.map(encodeURIComponent).join('/')}/`;
}

function emptyMirror(
  machine: MachineConnectionTarget,
  rootUri: string,
  documentPath: string,
  scope: MirrorScope,
): DocMirror {
  return {
    machine,
    rootUri,
    scope,
    settled: new Set([documentPath]),
    copied: new Set(),
    requests: Promise.resolve(),
    copiedCount: 0,
    copiedBytes: 0,
  };
}
