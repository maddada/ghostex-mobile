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
 * SEE-ALSO: apps/mobile/app/src/docs/page.ts (`mirrorRequestedAssets`),
 * apps/mobile/app/src/screens/DocViewerScreen.tsx
 */

import { MIRROR_FOLDER } from './page';

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
 * element still waiting on a URL that is now in the mirror.
 */
export function assetLoaderInjectionScript(): string {
  return `(function () {
  if (window.__GHOSTEX_DOCS_ASSETS__) return;
  var marker = ${JSON.stringify(`/${MIRROR_FOLDER}/`)};
  var waiting = {};
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
  function reload(el) {
    var tag = el.tagName.toLowerCase();
    if (!el.isConnected) return;
    if (tag === 'script') {
      // A script element runs once; only a fresh element fetches again.
      var fresh = document.createElement('script');
      for (var i = 0; i < el.attributes.length; i++) fresh.setAttribute(el.attributes[i].name, el.attributes[i].value);
      el.replaceWith(fresh);
    } else if (tag === 'link') {
      el.replaceWith(el.cloneNode(true));
    } else if (tag === 'source' && el.parentElement && typeof el.parentElement.load === 'function') {
      el.parentElement.load();
    } else if (tag === 'video' || tag === 'audio') {
      el.load();
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
    if (url.indexOf('file:') !== 0 || url.indexOf(marker) < 0) return;
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
    answer: function (asked, ready) {
      var loaded = {};
      ready.forEach(function (url) { loaded[url] = true; });
      asked.forEach(function (url) {
        var elements = waiting[url] || [];
        waiting[url] = null;
        if (loaded[url]) elements.forEach(reload);
      });
    }
  };
})();
true;`;
}

/** Hands the page the viewer's answer to one {@link DocAssetsMessage}. */
export function assetLoaderAnswerScript(asked: readonly string[], ready: readonly string[]): string {
  return `window.__GHOSTEX_DOCS_ASSETS__ && window.__GHOSTEX_DOCS_ASSETS__.answer(${JSON.stringify(asked)}, ${JSON.stringify(ready)});
true;`;
}
