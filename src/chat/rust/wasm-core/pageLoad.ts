/**
 * The rules for starting the chat core's page (ChatCoreWebView.tsx, bridge.ts), kept free of React
 * Native: which file the page loads from, what a failed
 * load says, and how often a page that keeps failing is tried again.
 *
 * CDXC:SessionChat 2026-11-02 WHY: issue #393. After the 10.42.1 OTA every iPhone resolved the page
 * to `file:///` (the update's asset was keyed so expo-asset could not find it, and iOS turns the
 * empty URI it fell back to into the app's working directory). WKWebView failed each load with
 * -1101 (NSURLErrorFileIsDirectory), `onError` dropped that, and `died()` remounted the WebView at
 * once, about 16 times a second, forever; after 20 s the chat said only "couldn't start". The
 * publish side is fixed in tooling/release-mobile/ota-release-lib.mjs (manifestAssetKey); these
 * guards make the next failure of this kind name itself and stop.
 */

/** What react-native-webview reports for a failed load (`onError`'s `nativeEvent`). */
export type PageLoadError = { code?: number; domain?: string; description?: string; url?: string };

/**
 * What one stat of the page's path found (expo-file-system `Paths.info`), or null when unknown: it
 * answers "doesn't exist" for paths outside the folders it may read, so that says nothing.
 */
export type PagePathKind = 'file' | 'directory' | null;

/** The last path segment of a URI, or the whole URI when it ends in `/` (a folder). */
export function uriBasename(uri: string): string {
  if (uri === '' || uri.endsWith('/')) return uri;
  return uri.slice(uri.lastIndexOf('/') + 1);
}

/**
 * Why `uri` cannot be the page, or null when it may be. Checked before the WebView mounts, so a page
 * that resolved to nothing or to a folder fails once with the reason instead of reloading.
 */
export function pageUriProblem(uri: string, kind: PagePathKind = null): string | null {
  if (uri.trim() === '') return 'The app found no file for the chat core page in this update.';
  if (kind === 'directory' || uri.endsWith('/')) {
    return `The chat core page resolved to a folder (${uri}), not a file.`;
  }
  return null;
}

/**
 * The page's file inside the running update when expo-asset did not find it: the one HTML asset in
 * the update's manifest, looked up in `Updates.localAssets` by that asset's own key. Null when the
 * manifest holds no HTML asset, more than one, or no local file for it.
 *
 * CDXC:SessionChat 2026-11-02 WHY: expo-asset looks an update's asset up by Metro's MD5 only, so an
 * update published with any other key (every update before the issue #393 fix) leaves it with an
 * empty URI. The manifest the app runs names the page's real key, so the page still loads.
 */
export function pageFromUpdate(
  manifest: unknown,
  localAssets: Readonly<Record<string, string>> | null | undefined,
): string | null {
  if (localAssets == null || typeof manifest !== 'object' || manifest === null) return null;
  const assets = (manifest as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return null;
  const pages = assets.filter((asset): asset is { key: string } => {
    if (typeof asset !== 'object' || asset === null) return false;
    const { key, fileExtension, contentType } = asset as Record<string, unknown>;
    if (typeof key !== 'string') return false;
    return fileExtension === '.html' || fileExtension === 'html' || contentType === 'text/html';
  });
  if (pages.length !== 1) return null;
  return localAssets[pages[0].key] ?? null;
}

/** One line for the log and the chat: "error -1101 (NSURLErrorDomain: …) loading <name>, a folder". */
export function describeLoadError(error: PageLoadError | null | undefined, uri: string, kind: PagePathKind): string {
  const parts: string[] = [];
  if (typeof error?.code === 'number') parts.push(`error ${error.code}`);
  const detail = [error?.domain, error?.description].filter((value) => typeof value === 'string' && value !== '');
  if (detail.length > 0) parts.push(`(${detail.join(': ')})`);
  const name = uriBasename(error?.url || uri) || '(no path)';
  const what = kind === 'directory' ? ', a folder' : kind === 'file' ? ', a file' : '';
  return `The chat core page could not load: ${parts.length > 0 ? parts.join(' ') : 'unknown error'} loading ${name}${what}.`;
}

/** Waits before each reload of a page that keeps failing; one more failure after the last gives up. */
export const PAGE_RELOAD_DELAYS_MS: readonly number[] = [500, 1_000, 2_000, 4_000];
/** After giving up, a chat that opens this much later tries the page once more (with a fresh budget). */
export const PAGE_RETRY_AFTER_GIVE_UP_MS = 60_000;

export type PageFailureDecision = { kind: 'reload'; delayMs: number } | { kind: 'giveUp'; message: string };

/**
 * How the bridge answers a page that died or could not load: reload after a growing wait, and after
 * {@link PAGE_RELOAD_DELAYS_MS}'s length of reloads fail in a row, give up with the real reason. A
 * page that starts resets the count.
 */
export class PageRestarts {
  private failures = 0;
  private gaveUpAt: number | null = null;

  constructor(private readonly delays: readonly number[] = PAGE_RELOAD_DELAYS_MS) {}

  onFailure(reason: string, nowMs: number): PageFailureDecision {
    const delayMs = this.delays[this.failures];
    this.failures += 1;
    if (delayMs !== undefined) return { kind: 'reload', delayMs };
    this.gaveUpAt = nowMs;
    return {
      kind: 'giveUp',
      message: `${reason} It failed to start ${this.failures} times in a row, so the app stopped trying.`,
    };
  }

  onReady(): void {
    this.failures = 0;
    this.gaveUpAt = null;
  }

  /** True once, long enough after giving up, for the next chat that opens; it resets the count. */
  retryAfterGiveUp(nowMs: number): boolean {
    if (this.gaveUpAt === null || nowMs - this.gaveUpAt < PAGE_RETRY_AFTER_GIVE_UP_MS) return false;
    this.onReady();
    return true;
  }
}

/** What a chat draws when the chat core's page could not start, with the reason it gave. */
export function coreUnavailableMessage(reason: string | null | undefined): string {
  const detail = reason?.trim();
  return detail
    ? `The chat engine couldn't start. ${detail} Close the chat and open it again.`
    : "The chat engine couldn't start. Close the chat and open it again.";
}
