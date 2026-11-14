/**
 * On-demand copying of the files an HTML page asks for while it runs, for the phone's Docs viewer.
 *
 * CDXC:Docs 2026-09-30 WHY:
 * The up-front mirror (`page.ts`) only finds files the page's source names literally, so a page
 * that builds its image paths in a script (`'img/' + id + '.jpg'`, as the video storyboards do)
 * opened with every picture broken. The page cannot ask the app for a file itself, so a script
 * installed before the page runs reports each image, stylesheet, script or media file that fails to
 * load from the mirror; the viewer copies it from the computer and the script loads the element
 * again. A `fetch()` of a computed path and a CSS background built in script still fail silently,
 * because neither reports an `error` event on an element.
 * The same report carries what a page names on the computer by an absolute path (`/Users/…`,
 * `file:///…`, `C:/…`) or a loopback address (`http://localhost:3000/…`), which on the phone named
 * the phone itself (CDXC:RemoteMachines 2026-10-16 in `webPreview/machineLinks.ts`): the viewer
 * copies the file into the mirror or opens a forward to the port, and answers with the URL to load
 * instead, which the script puts on the element.
 * Anyone's script can post that report, so what it may name is decided in the app, never here: an
 * HTML page's own folder and below, no dot-files or dot-folders (CDXC:Docs 2026-11-14 in `page.ts`,
 * `mayCopyForPage` in `pageRules.ts`), and only loopback ports its markup names.
 * SEE-ALSO: apps/mobile/app/src/docs/page.ts (`mirrorRequestedAssets`),
 * apps/mobile/app/src/screens/DocViewerScreen.tsx
 */

/** What the page posts when files it loads are missing from the mirror. */
export type DocAssetsMessage = { type: 'docAssetsMissing'; urls: string[] };

export function parseDocAssetsMessage(data: string): DocAssetsMessage | null {
  try {
    const value = JSON.parse(data) as { type?: unknown; urls?: unknown };
    if (value.type !== 'docAssetsMissing' || !Array.isArray(value.urls)) return null;
    const urls = value.urls.filter((url): url is string => typeof url === 'string' && url.length > 0);
    return urls.length > 0 ? { type: 'docAssetsMissing', urls } : null;
  } catch {
    return null;
  }
}

/**
 * The script the viewer installs before the page's own content runs
 * (`injectedJavaScriptBeforeContentLoaded`). Element `error` events do not bubble, so it listens in
 * the capture phase on the window. Each URL is asked for once; the viewer's answer loads every
 * element still waiting on a URL it could place, from the URL it answered with.
 */
export function assetLoaderInjectionScript(): string {
  return `(function () {
  if (window.__GHOSTEX_DOCS_ASSETS__) return;
  // What the viewer can place: a mirror file, any other file path, a Windows path (read as a
  // one-letter scheme), and the loopback addresses that name the computer. On Android the mirror
  // and a path the page wrote (\`/Users/…\`) load from the Docs loader's origin (DOCS_LOADER_ORIGIN).
  // Backslashes are doubled: this is a template literal, which would drop a single one.
  var computerUrl = /^(?:file:|https:\\/\\/appassets\\.androidplatform\\.net\\/|[a-z]:\\/|https?:\\/\\/(?:[^\\/?#@]*@)?(?:localhost|[^\\/?#:]+\\.localhost|127(?:\\.\\d{1,3}){3}|0\\.0\\.0\\.0|\\[::1\\]|\\[::ffff:(?:127\\.0\\.0\\.1|7f00:1)\\])(?::\\d+)?(?:[\\/?#]|$))/i;
  var waiting = {};
  // URLs the viewer answered with: a phone-side forward is on the phone, never asked about again.
  var produced = {};
  var queued = [];
  var timer = 0;
  function attr(el, name) {
    var value = el.getAttribute(name);
    return value === null ? '' : value;
  }
  function failedUrl(el) {
    var value = el.currentSrc || el.src || '';
    if (!value && el.href) value = typeof el.href === 'string' ? el.href : el.href.baseVal || '';
    if (!value && el.data) value = el.data;
    if (!value || typeof value !== 'string') return '';
    try { return new URL(value, document.baseURI).href; } catch (e) { return ''; }
  }
  function flush() {
    timer = 0;
    var urls = queued;
    queued = [];
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'docAssetsMissing', urls: urls })); } catch (e) {}
  }
  var URL_ATTRIBUTES = ['src', 'href', 'xlink:href', 'data', 'poster'];
  // Points the attributes that named 'from' at 'to'; the mirror's own files keep their URL.
  function retarget(el, from, to) {
    if (from === to) return;
    URL_ATTRIBUTES.forEach(function (name) {
      if (!el.hasAttribute(name)) return;
      var absolute = '';
      try { absolute = new URL(attr(el, name), document.baseURI).href; } catch (e) { return; }
      if (absolute === from) el.setAttribute(name, to);
    });
    if (el.hasAttribute('srcset')) el.removeAttribute('srcset');
  }
  function reload(el, from, to) {
    var tag = el.tagName.toLowerCase();
    if (!el.isConnected) return;
    if (tag === 'script') {
      // A script element runs once; only a fresh element fetches again.
      var fresh = document.createElement('script');
      for (var i = 0; i < el.attributes.length; i++) fresh.setAttribute(el.attributes[i].name, el.attributes[i].value);
      retarget(fresh, from, to);
      el.replaceWith(fresh);
    } else if (tag === 'link') {
      var copy = el.cloneNode(true);
      retarget(copy, from, to);
      el.replaceWith(copy);
    } else if (tag === 'source' && el.parentElement && typeof el.parentElement.load === 'function') {
      retarget(el, from, to);
      el.parentElement.load();
    } else if (tag === 'video' || tag === 'audio') {
      retarget(el, from, to);
      el.load();
    } else if (from !== to) {
      retarget(el, from, to);
    } else {
      ['srcset', 'src', 'href', 'xlink:href', 'data'].forEach(function (name) {
        if (el.hasAttribute(name)) el.setAttribute(name, attr(el, name));
      });
    }
  }
  window.addEventListener('error', function (event) {
    var el = event.target;
    if (!el || el === window || !el.tagName) return;
    var url = failedUrl(el);
    if (!computerUrl.test(url) || Object.prototype.hasOwnProperty.call(produced, url)) return;
    if (Object.prototype.hasOwnProperty.call(waiting, url)) {
      // Asked already: join the wait, or stay broken when the answer came back without it.
      if (waiting[url]) waiting[url].push(el);
      return;
    }
    waiting[url] = [el];
    queued.push(url);
    if (!timer) timer = setTimeout(flush, 40);
  }, true);
  window.__GHOSTEX_DOCS_ASSETS__ = {
    answer: function (asked, replacements) {
      asked.forEach(function (url) {
        var elements = waiting[url] || [];
        waiting[url] = null;
        var to = Object.prototype.hasOwnProperty.call(replacements, url) ? replacements[url] : null;
        if (to === null) return;
        if (to !== url) produced[to] = true;
        elements.forEach(function (el) { reload(el, url, to); });
      });
    }
  };
})();
true;`;
}

/**
 * Hands the page the viewer's answer to one {@link DocAssetsMessage}: for each URL it could place,
 * the URL to load instead (the same URL for a file now in the mirror).
 */
export function assetLoaderAnswerScript(
  asked: readonly string[],
  replacements: Readonly<Record<string, string>>,
): string {
  return `window.__GHOSTEX_DOCS_ASSETS__ && window.__GHOSTEX_DOCS_ASSETS__.answer(${JSON.stringify(asked)}, ${JSON.stringify(replacements)});
true;`;
}
