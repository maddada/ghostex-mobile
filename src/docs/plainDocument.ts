/**
 * The file viewer's pages for files that are not documents: plain text and source code as wrapped
 * monospace, and a picture fitted to the screen (pinch to zoom). Both are written beside the
 * mirrored file like the Markdown page, so the picture loads by its own relative name.
 */

import { GhostexPalette } from '../theme/palette';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

function shell(title: string, styles: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=8, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>${BASE_STYLES}${styles}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Text the viewer shows as written, long lines wrapped so the phone never scrolls sideways. */
export function renderTextDocument(text: string, title: string): string {
  return shell(title, TEXT_STYLES, `<pre class="plain-text">${escapeHtml(text)}</pre>`);
}

/** A page holding one picture; `fileName` is its name in the same folder. */
export function renderImageDocument(fileName: string, title: string): string {
  return shell(
    title,
    IMAGE_STYLES,
    `<main class="picture"><img src="${escapeHtml(encodeURIComponent(fileName))}" alt="${escapeHtml(title)}"></main>`
  );
}

const BASE_STYLES = `
:root { color-scheme: dark; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: ${GhostexPalette.BACKGROUND}; color: #e6e6e6; }
`;

const TEXT_STYLES = `
.plain-text {
  box-sizing: border-box;
  margin: 0;
  padding: 16px 14px calc(48px + env(safe-area-inset-bottom));
  font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 4;
}
`;

const IMAGE_STYLES = `
.picture {
  box-sizing: border-box;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.picture img {
  max-width: 100%;
  height: auto;
  background: repeating-conic-gradient(#2a2a2a 0% 25%, #1f1f1f 0% 50%) 50% / 16px 16px;
}
`;
