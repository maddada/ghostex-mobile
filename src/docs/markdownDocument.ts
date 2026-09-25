/**
 * A Markdown file as a readable page for the Docs viewer: GitHub-flavoured Markdown rendered by
 * `marked` into a dark document styled like the rest of the app. The page is written next to the
 * mirrored file, so relative images and links resolve exactly as they do on the computer.
 */

import { Marked, type Tokens } from 'marked';

import { GhostexPalette } from '../theme/palette';

const MERMAID_MODULE_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens, repeats numbered. */
function slugger() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base =
      text
        .toLowerCase()
        .trim()
        .replace(/<[^>]*>/gu, '')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/gu, '-') || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** Leading YAML front matter, shown as a quiet block instead of a stray rule and paragraph. */
function splitFrontMatter(source: string): { frontMatter: string | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/u.exec(source);
  if (match === null) return { frontMatter: null, body: source };
  return { frontMatter: match[1] ?? '', body: source.slice(match[0].length) };
}

export function renderMarkdownDocument(source: string, title: string): string {
  const slug = slugger();
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline(tokens: Tokens.Heading['tokens']): string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        const id = slug(token.text);
        return `<h${token.depth} id="${escapeHtml(id)}"><a class="anchor" href="#${escapeHtml(id)}" aria-hidden="true">#</a>${inner}</h${token.depth}>\n`;
      },
    },
  });
  const { frontMatter, body } = splitFrontMatter(source);
  const rendered = marked.parse(body, { async: false }) as string;
  const front = frontMatter === null ? '' : `<pre class="front-matter">${escapeHtml(frontMatter)}</pre>\n`;
  const usesMermaid = /class="language-mermaid"/u.test(rendered);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>${MARKDOWN_STYLES}</style>
</head>
<body>
<article class="markdown-body">
${front}${rendered}
</article>
${usesMermaid ? mermaidScript() : ''}
</body>
</html>`;
}

function mermaidScript(): string {
  return `<script type="module">
import mermaid from ${JSON.stringify(MERMAID_MODULE_URL)};
const blocks = [...document.querySelectorAll('pre > code.language-mermaid')];
mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
for (const [index, code] of blocks.entries()) {
  const holder = document.createElement('div');
  holder.className = 'mermaid-diagram';
  try {
    const { svg } = await mermaid.render('ghostex-mermaid-' + index, code.textContent || '');
    holder.innerHTML = svg;
    code.parentElement.replaceWith(holder);
  } catch {}
}
</script>`;
}

const MARKDOWN_STYLES = `
:root { color-scheme: dark; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: ${GhostexPalette.BACKGROUND};
  color: #e6e6e6;
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  overflow-wrap: anywhere;
}
.markdown-body {
  box-sizing: border-box;
  max-width: 820px;
  margin: 0 auto;
  padding: 20px 18px calc(48px + env(safe-area-inset-bottom));
}
.markdown-body > :first-child { margin-top: 0; }
h1, h2, h3, h4, h5, h6 { position: relative; color: #fafafa; line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 650; }
h1 { font-size: 1.75em; padding-bottom: 0.3em; border-bottom: 1px solid rgba(255,255,255,0.1); }
h2 { font-size: 1.4em; padding-bottom: 0.25em; border-bottom: 1px solid rgba(255,255,255,0.08); }
h3 { font-size: 1.18em; }
h4 { font-size: 1.05em; }
h5, h6 { font-size: 0.95em; color: #b5b5b5; }
.anchor { position: absolute; left: -0.9em; width: 0.9em; opacity: 0; color: #747b85; text-decoration: none; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor { opacity: 1; }
p, ul, ol, blockquote, pre, table, details { margin: 0 0 1em; }
a { color: ${GhostexPalette.ACCENT}; text-decoration: none; }
a:active { text-decoration: underline; }
strong { color: #fafafa; }
ul, ol { padding-left: 1.5em; }
li + li { margin-top: 0.25em; }
li > p { margin-bottom: 0.4em; }
li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.3em; }
input[type=checkbox] { margin: 0 0.45em 0 0; vertical-align: -0.1em; accent-color: ${GhostexPalette.ACCENT}; }
blockquote { margin-left: 0; padding: 0.1em 1em; color: #b5b5b5; border-left: 3px solid rgba(255,255,255,0.18); }
code, pre, kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.86em; }
:not(pre) > code { padding: 0.15em 0.4em; border-radius: 5px; background: rgba(255,255,255,0.08); color: #f4f4f5; }
pre { padding: 12px 14px; overflow-x: auto; border-radius: 8px; background: #141414; border: 1px solid rgba(255,255,255,0.08); line-height: 1.5; }
pre code { white-space: pre; overflow-wrap: normal; }
pre.front-matter { color: #a3a3a3; }
kbd { padding: 0.1em 0.4em; border: 1px solid rgba(255,255,255,0.2); border-bottom-width: 2px; border-radius: 4px; }
table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 0.92em; }
th, td { min-width: 64px; max-width: 72vw; padding: 6px 12px; border: 1px solid rgba(255,255,255,0.12); text-align: left; vertical-align: top; overflow-wrap: normal; word-break: normal; }
td code { overflow-wrap: anywhere; }
th { background: #161616; color: #fafafa; font-weight: 600; }
tr:nth-child(2n) td { background: rgba(255,255,255,0.025); }
hr { height: 1px; margin: 2em 0; border: 0; background: rgba(255,255,255,0.12); }
img, video { max-width: 100%; height: auto; border-radius: 6px; }
details { padding: 0.5em 0.8em; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; }
summary { cursor: pointer; font-weight: 600; }
.mermaid-diagram { margin: 0 0 1em; overflow-x: auto; }
.mermaid-diagram svg { max-width: 100%; height: auto; }
`;
