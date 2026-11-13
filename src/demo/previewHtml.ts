/**
 * The Web Preview page for the demo experience. Inlined so Metro ships it inside
 * the JavaScript bundle (the binary and over-the-air updates). It loads no
 * images, fonts, or hosts.
 */

import { DemoCopy } from './copy';

export const DEMO_PREVIEW_PORT = 5173;

export function demoPreviewHtml(): string {
  const title = DemoCopy.previewTitle;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #16181d; color: #f4f1ea; }
  header { padding: 28px 22px 8px; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  p { margin: 0 0 12px; }
  .note { color: #c8c2b4; }
  main { padding: 8px 22px 32px; display: grid; gap: 12px; }
  article { background: #22262e; border: 1px solid #343a46; border-radius: 14px; padding: 14px 16px; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
</style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <p class="note">Demo preview. This page is saved in the app. Nothing is loaded from the internet.</p>
  </header>
  <main>
    <article>
      <h2>Search</h2>
      <p><code>POST /v1/search</code> looks up places in the Atlas index. A token bucket in front of it allows 60 calls a minute per key.</p>
    </article>
    <article>
      <h2>Keys</h2>
      <p>Each key is shown as a short hash in the log. The raw key is not stored in the demo.</p>
    </article>
    <article>
      <h2>Status</h2>
      <p>This listener is <code>localhost:${DEMO_PREVIEW_PORT}</code> in the demo experience. Opening it here does not forward a port.</p>
    </article>
  </main>
</body>
</html>`;
}
