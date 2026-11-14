/**
 * Agentation on HTML pages in the phone's Docs viewer.
 *
 * CDXC:Docs 2026-09-24 DECISION:
 * User: "on html pages i want agentation injected so i can annotate them". The viewer injects the
 * same pinned Agentation build the desktop Docs view mounts into rendered HTML documents, into the
 * loaded page itself (Agentation picks elements from its own document), with the desktop's
 * "Clear on copy/send" default. The copy button hands the Markdown to the app, which writes the
 * phone clipboard natively: `navigator.clipboard` is unreliable inside WKWebView and Android
 * WebView pages loaded from files.
 * SEE-ALSO: apps/desktop/views/manage/preview/html-viewer.tsx (MANAGE_AGENTATION_* and the
 * bootstrap), apps/desktop/src/app/consts.rs (BROWSER_FEEDBACK_AGENTATION_*).
 */

const AGENTATION_VERSION = '3.1.2';
const AGENTATION_REACT_VERSION = '18.2.0';
/** Where the phone loads Agentation from; a Docs page's content policy allows it for scripts (`pageRules.ts`). */
export const AGENTATION_ORIGIN = 'https://esm.sh';
const AGENTATION_PACKAGE_URL = `https://esm.sh/agentation@${AGENTATION_VERSION}?bundle&deps=react@${AGENTATION_REACT_VERSION},react-dom@${AGENTATION_REACT_VERSION}`;
const AGENTATION_REACT_URL = `https://esm.sh/react@${AGENTATION_REACT_VERSION}`;
const AGENTATION_REACT_DOM_CLIENT_URL = `https://esm.sh/react-dom@${AGENTATION_REACT_VERSION}/client?deps=react@${AGENTATION_REACT_VERSION}`;

/** Messages the page posts to the viewer. */
export type DocPageMessage =
  | { type: 'agentationCopy'; markdown: string }
  | { type: 'agentationReady' }
  | { type: 'agentationFailed'; message: string };

export function parseDocPageMessage(data: string): DocPageMessage | null {
  try {
    const value = JSON.parse(data) as { type?: unknown; markdown?: unknown; message?: unknown };
    if (value.type === 'agentationCopy' && typeof value.markdown === 'string') {
      return { type: 'agentationCopy', markdown: value.markdown };
    }
    if (value.type === 'agentationReady') return { type: 'agentationReady' };
    if (value.type === 'agentationFailed') {
      return { type: 'agentationFailed', message: typeof value.message === 'string' ? value.message : '' };
    }
  } catch {
    // Not one of ours: a page may post its own messages.
  }
  return null;
}

/**
 * CDXC:Docs 2026-10-23 DECISION: User (issue #280, confirmed for the phone): Annotate on an HTML page goes straight into annotating mode and stays in it across reloads, as on the desktop. agentation@3.1.2 mounts collapsed (`isActive` is component state that starts false, is never persisted, and has no prop or handle), so the bootstrap clicks Agentation's own launcher once it renders. It matches the launcher only while it reads `aria-expanded="false"` and `aria-label="Start feedback mode"` inside the open shadow root of its `<agentation-toolbar>` host (3.1.2 put the shortcut into the title, so the title is not matched, and a MutationObserver on the page cannot see into the shadow root, so it polls every 50ms for up to 5s), so it can never switch an active toolbar off; its Cmd/Ctrl+Shift+F shortcut was rejected because it toggles and the synthetic key would also reach the page's own listeners. Every load remounts the WebView and re-runs this bootstrap, which is what keeps it active.
 * SEE-ALSO: apps/desktop/views/manage/preview/html-viewer.tsx (CDXC:Docs 2026-11-14: the desktop's Files view no longer does this; Annotate there starts off, mounts Agentation already active with no floating toolbar, and the header drives it).
 */
function bootstrapModule(): string {
  return `
const post = (message) => { try { window.ReactNativeWebView?.postMessage(JSON.stringify(message)); } catch {} };
const rootId = "ghostex-agentation-root";
const directionStyleId = "ghostex-agentation-direction-style";
document.getElementById(rootId)?.remove();
document.getElementById(directionStyleId)?.remove();
const directionStyle = document.createElement("style");
directionStyle.id = directionStyleId;
directionStyle.textContent = "[data-agentation-root][data-agentation-theme] { direction: ltr !important; text-align: left !important; }";
(document.head || document.documentElement).appendChild(directionStyle);
const rootEl = document.createElement("div");
rootEl.id = rootId;
rootEl.setAttribute("data-agentation-html-root", "true");
rootEl.setAttribute("data-agentation-root", "true");
(document.body || document.documentElement).appendChild(rootEl);
const startFeedbackMode = () => {
  const startSelector = '[data-agentation-toolbar] button[aria-expanded="false"][aria-label="Start feedback mode"]';
  let attempts = 0;
  const tryStart = () => {
    const startButton = document.querySelector("agentation-toolbar")?.shadowRoot?.querySelector(startSelector);
    if (startButton) {
      startButton.click();
      return;
    }
    attempts += 1;
    if (attempts < 100) setTimeout(tryStart, 50);
  };
  tryStart();
};
Promise.all([
  import(${JSON.stringify(AGENTATION_REACT_URL)}),
  import(${JSON.stringify(AGENTATION_REACT_DOM_CLIENT_URL)}),
  import(${JSON.stringify(AGENTATION_PACKAGE_URL)})
]).then(([reactModule, reactDomClientModule, agentationModule]) => {
  const React = reactModule.default ?? reactModule;
  const Agentation = agentationModule.Agentation;
  if (!React?.createElement || !reactDomClientModule?.createRoot || !Agentation) {
    throw new Error("Agentation modules did not expose the expected React mounting API.");
  }
  const settingsKey = "feedback-toolbar-settings";
  let settings = null;
  try { settings = JSON.parse(localStorage.getItem(settingsKey) || "null"); } catch { settings = null; }
  if (!settings || typeof settings !== "object") settings = {};
  if (settings.ghostexDefaults !== 1) {
    settings.autoClearAfterCopy = true;
    settings.ghostexDefaults = 1;
    try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch {}
  }
  const root = reactDomClientModule.createRoot(rootEl);
  globalThis.__GHOSTEX_AGENTATION__ = { container: rootEl, root };
  root.render(React.createElement(Agentation, {
    copyToClipboard: false,
    onCopy: (markdown) => post({ type: "agentationCopy", markdown: String(markdown ?? "") })
  }));
  startFeedbackMode();
  post({ type: "agentationReady" });
}).catch((error) => {
  post({ type: "agentationFailed", message: error instanceof Error ? error.message : String(error) });
  rootEl.remove();
  directionStyle.remove();
});
`.trim();
}

/**
 * The script the viewer runs once the page has loaded (`injectedJavaScript`): it appends the
 * bootstrap as a module script, so the page's own markup and bytes stay exactly as authored.
 */
export function agentationInjectionScript(): string {
  return `(function () {
  if (window.__GHOSTEX_AGENTATION_BOOT__) return;
  window.__GHOSTEX_AGENTATION_BOOT__ = true;
  var script = document.createElement('script');
  script.type = 'module';
  script.textContent = ${JSON.stringify(bootstrapModule())};
  (document.body || document.documentElement).appendChild(script);
})();
true;`;
}
