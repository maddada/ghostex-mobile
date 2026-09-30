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

import type { MachineConnectionTarget } from '../machines/credentials';
import { renderMarkdownDocument } from './markdownDocument';
import {
  baseName,
  docKindForPath,
  extensionOf,
  mirrorSegments,
  normalizeRemotePath,
  remotePathFromMirrorSegments,
  resolveRemoteReference,
  type DocKind,
} from './paths';
import { decodeBase64Utf8, readRemoteFiles } from './remoteFiles';

export const MIRROR_FOLDER = 'ghostex-docs-view';
const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
const ASSET_MAX_BYTES = 12 * 1024 * 1024;
const ASSETS_MAX_COUNT = 250;
const ASSETS_MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const ASSET_BATCH_SIZE = 40;
/** HTML → stylesheet → the stylesheet's own imports and fonts. */
const ASSET_MAX_DEPTH = 4;

export type DocPage = {
  kind: DocKind;
  /** What the WebView loads. */
  uri: string;
  /** The mirror folder; iOS needs read access widened to it for the page's sibling files. */
  rootUri: string;
  title: string;
  /** Referenced files that were missing, too large, or over the page budget. */
  skippedAssets: number;
  /** What this page has already copied or tried, for the files it asks for while it runs. */
  mirror: DocMirror;
};

/** One opened page's mirror bookkeeping. */
type DocMirror = {
  machine: MachineConnectionTarget;
  rootUri: string;
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

/** The `file://` URI a remote path is mirrored at, each segment percent-encoded. */
function mirrorUri(rootUri: string, remotePath: string): string | null {
  const segments = mirrorSegments(remotePath);
  if (segments === null || segments.length < 2) return null;
  return rootUri + segments.map(encodeURIComponent).join('/');
}

function writeMirrorFile(uri: string, content: string, encoding: 'base64' | 'utf8'): void {
  const file = new File(uri);
  file.create({ intermediates: true, overwrite: true });
  file.write(content, { encoding });
}

/**
 * The remote path a URL inside the mirror stands for, or null for any other URL. Matched on the
 * mirror folder's name rather than the full root, because WebKit may report `/private/var/…` for a
 * page loaded as `/var/…`.
 */
export function remotePathForMirrorUrl(url: string): { remotePath: string; fragment: string } | null {
  if (!url.startsWith('file://')) return null;
  const hashIndex = url.indexOf('#');
  const fragment = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf('?');
  const pathPart = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const marker = `/${MIRROR_FOLDER}/`;
  const markerIndex = pathPart.indexOf(marker);
  if (markerIndex < 0) return null;
  try {
    const segments = pathPart
      .slice(markerIndex + marker.length)
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
    const remotePath = remotePathFromMirrorSegments(segments);
    return remotePath === null ? null : { remotePath, fragment };
  } catch {
    return null;
  }
}

const MIRROR_PATH_IN_TEXT = new RegExp(`(?:file://)?/[^\\s"'\`()<>]*/${MIRROR_FOLDER}/[^\\s"'\`()<>#?]+`, 'gu');

/**
 * Rewrites phone mirror paths inside text (Agentation's copied feedback names the page it was
 * written on) back to the file's path on the computer, which is what an agent reading it can use.
 * A Markdown file's rendered page is named after the Markdown file itself.
 */
export function mirrorPathsToRemote(text: string): string {
  return text.replace(MIRROR_PATH_IN_TEXT, (match) => {
    const url = match.startsWith('file://') ? match : `file://${match}`;
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

const EMBEDDING_TAG = /<(img|source|video|audio|script|link|iframe|frame|embed|object|input|track|use|image)\b([^>]*)>/giu;
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
    if (name === 'link' && /\brel\s*=\s*["']?(?:canonical|alternate|next|prev|author|help|license)\b/iu.test(attributes)) {
      continue;
    }
    for (const attribute of attributes.matchAll(URL_ATTRIBUTE)) {
      const key = (attribute[1] ?? '').toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      const candidates = key === 'srcset' ? value.split(',').map((part) => part.trim().split(/\s+/u)[0] ?? '') : [value];
      for (const candidate of candidates) {
        const reference = localReference(candidate);
        if (reference !== null) references.add(reference);
      }
    }
  }
  for (const block of html.matchAll(STYLE_BLOCK)) cssReferences(block[1] ?? '', references);
  for (const attribute of html.matchAll(STYLE_ATTRIBUTE)) cssReferences(decodeEntities(attribute[1] ?? attribute[2] ?? ''), references);
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
  limitTotals: boolean
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
    for (let start = 0; start < level.length; start += ASSET_BATCH_SIZE) {
      if (isCancelled()) return skipped;
      const batch = level.slice(start, start + ASSET_BATCH_SIZE);
      if (limitTotals && (mirror.copiedCount >= ASSETS_MAX_COUNT || mirror.copiedBytes >= ASSETS_MAX_TOTAL_BYTES)) {
        // Left unsettled, so the page can still ask for them once it runs.
        batch.forEach((path) => mirror.settled.delete(path));
        skipped += batch.length;
        continue;
      }
      let reads: Awaited<ReturnType<typeof readRemoteFiles>>;
      try {
        reads = await readRemoteFiles(mirror.machine, batch, ASSET_MAX_BYTES);
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
 * Copies files the loaded page asked for while it ran (see `assetLoader.ts`), given as the mirror
 * URLs that failed. Returns the URLs whose files are now in the mirror; a file that is missing on
 * the computer or too large is left out, and the page tries each file again only once.
 */
export async function mirrorRequestedAssets(page: DocPage, urls: readonly string[]): Promise<string[]> {
  const byPath = new Map<string, string[]>();
  for (const url of urls) {
    const remotePath = remotePathForMirrorUrl(url)?.remotePath;
    if (remotePath === undefined) continue;
    const path = normalizeRemotePath(remotePath);
    byPath.set(path, [...(byPath.get(path) ?? []), url]);
  }
  if (byPath.size === 0) return [];
  const mirror = page.mirror;
  const request = mirror.requests.then(() => mirrorAssets(mirror, [...byPath.keys()], () => false, false));
  mirror.requests = request.catch(() => undefined);
  await request;
  return [...byPath.entries()].filter(([path]) => mirror.copied.has(path)).flatMap(([, pathUrls]) => pathUrls);
}

/**
 * Reads a Markdown or HTML file off the computer and mirrors it, with what it embeds, for the
 * viewer. Throws a message fit to show when the file cannot be read.
 */
export async function buildDocPage(
  machine: MachineConnectionTarget,
  remotePath: string,
  isCancelled: () => boolean = () => false
): Promise<DocPage> {
  const documentPath = normalizeRemotePath(remotePath);
  const kind = docKindForPath(documentPath);
  if (kind === null) throw new Error('Only Markdown and HTML files open here.');
  const root = mirrorRoot();
  const rootUri = directoryUri(root);
  const documentUri = mirrorUri(rootUri, documentPath);
  if (documentUri === null) throw new Error(`Not a full path on the computer: ${remotePath}`);
  const [read] = await readRemoteFiles(machine, [documentPath], DOCUMENT_MAX_BYTES);
  if (read === undefined || read.status === 'missing') throw new Error(`File not found: ${documentPath}`);
  if (read.status === 'tooLarge') throw new Error('This file is too large to open on the phone.');
  const text = decodeBase64Utf8(read.base64);
  const title = baseName(documentPath);

  const mirror: DocMirror = {
    machine,
    rootUri,
    settled: new Set([documentPath]),
    copied: new Set(),
    requests: Promise.resolve(),
    copiedCount: 0,
    copiedBytes: 0,
  };
  const referencedPaths = (references: Set<string>) =>
    [...references].map((reference) => resolveRemoteReference(documentPath, reference));

  if (kind === 'html') {
    writeMirrorFile(documentUri, read.base64, 'base64');
    const skippedAssets = await mirrorAssets(mirror, referencedPaths(htmlReferences(text)), isCancelled, true);
    return { kind, uri: documentUri, rootUri, title, skippedAssets, mirror };
  }

  const html = renderMarkdownDocument(text, title);
  // Beside the Markdown file, so its relative images and links resolve from the same folder.
  const pageUri = `${documentUri}.ghostex-view.html`;
  writeMirrorFile(pageUri, html, 'utf8');
  const skippedAssets = await mirrorAssets(mirror, referencedPaths(htmlReferences(html)), isCancelled, true);
  return { kind, uri: pageUri, rootUri, title, skippedAssets, mirror };
}
