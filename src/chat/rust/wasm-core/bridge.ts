/**
 * The bridge to the chat core's hidden WebView: one page (`assets/chat-core/chat-core.html`, built
 * by `cargo xtask build-mobile-chat-wasm` in the main repo) holds the Rust chat core as
 * WebAssembly, and every chat calls it through here.
 *
 * Requests go in through `GhostexNative.postToWebView` (evaluated on the UI thread at once, not on
 * the next frame), answers come back through react-native-webview's `onMessage`. The protocol is
 * documented at the top of `packages/gx-chat-wasm/page/chat-core.html` in the main repo.
 *
 * CDXC:SessionChat 2026-10-23 DECISION:
 * User picked "Hidden browser view on the phone" (Q26) after the two spikes in
 * docs/2026-10-23/mobile-ota/: the phone runs the same Rust chat core as WebAssembly in one hidden
 * WebView, shipped in the over-the-air update, so chat-core changes reach phones without a new
 * app. It supersedes the 2026-09-21 DECISION that the phone runs the core through UniFFI
 * (packages/gx-chat-mobile); the native views are unchanged.
 *
 * CDXC:SessionChat 2026-10-28 DECISION:
 * The user tried the Browser view brain on a real phone ("Yes, it feels fine") and chose "Remove
 * the native core now", with no fallback. The 2026-10-23 release carried both brains behind a
 * Settings switch; the built-in UniFFI core (`modules/gx-chat-core`, `packages/gx-chat-mobile`)
 * and the switch are gone, so this WebView is the phone's only chat brain and the OTA runtime
 * version no longer hashes the Rust core (`scripts/ota-runtime-version.js`).
 * SEE-ALSO: ChatCoreWebView.tsx (the WebView), wasmChatCore.ts (one chat's core over this bridge),
 * ../core-backend.ts (the interface the host drives), ../core-types.ts (the JSON), modules/ghostex-native
 * GhostexWebViewPost (Kotlin and Swift).
 */

import { logAppEvent } from '../../../app/appLog';
import { ChatCoreError } from '../core-types';
import { GhostexNative } from '../../../../modules/ghostex-native/src';
import { PageRestarts } from './pageLoad';

/** One request the page answers (`{id, op, handle?, args?}` in the page's protocol). */
export type WasmCoreRequest = { op: string; handle?: number; args?: readonly unknown[] };

type Reply = { id: number | null; ok: boolean; result?: unknown; error?: { code?: string; message?: string } };

type Pending = { resolve: (value: unknown) => void; reject: (error: ChatCoreError) => void };

/** How long a chat waits for the page to start before it gives up on this brain. */
const READY_TIMEOUT_MS = 20_000;
/**
 * WebAssembly memory only grows. When the last chat closes and the page holds more than this, it
 * reloads, so a phone that once opened a huge chat gets the memory back.
 */
const RELOAD_AT_BYTES = 96 * 1024 * 1024;

type Phase = 'unmounted' | 'loading' | 'ready' | 'failed';

class WasmCoreBridge {
  private phase: Phase = 'unmounted';
  /** The page posted `ready`. The bridge is ready once this and the view tag are both known. */
  private pageReady = false;
  private failure: string | null = null;
  /** The failure came from a page that kept dying, so a chat opening a minute later may try again. */
  private failureRetryable = false;
  /** Why the page last failed to load or died, for the "did not start in time" message. */
  private lastError: string | null = null;
  private readonly restarts = new PageRestarts();
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private viewTag: number | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private waiting: { resolve: () => void; reject: (error: ChatCoreError) => void }[] = [];
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lostListeners = new Set<() => void>();
  private readonly viewListeners = new Set<() => void>();
  private reloadSequence = 0;
  private liveHandles = 0;

  // ---- the WebView's side (ChatCoreWebView.tsx) ----------------------------------------------

  /** The WebView mounted (or remounted after a reload) and starts loading the page. */
  mounted(): void {
    this.phase = 'loading';
    this.failure = null;
    this.viewTag = null;
    this.pageReady = false;
  }

  /** The WebView unmounted (a reload remounts it): every core in it is gone. */
  unmounted(): void {
    this.phase = 'unmounted';
    this.viewTag = null;
    this.lose('The chat core page was closed.');
  }

  /**
   * The page finished loading in the WebView tagged `webViewTag`, inside the wrapper view tagged
   * `hostTag`. Requests go through the wrapper's tag, after one empty script through each tag so
   * that the native side forgets any WebView a reload left behind.
   *
   * CDXC:SessionChat 2026-11-11 WHY: after an over-the-air update's restart the chat stayed blank
   * until the app was restarted again. `Updates.reloadAsync()` restarts the JavaScript in the same
   * process, and React numbers views from the start again (Fabric's first tag is 2 in every
   * JavaScript runtime), so the new WebView can get the old one's tag. The native `postToWebView` (GhostexWebViewPost, Kotlin and Swift) keeps the last
   * WebView it found for a tag, for the whole process, and while the old WebView was not yet freed
   * it sent every request to the old page, whose answers reached the old JavaScript: the new page
   * had said `ready`, so the chat waited for answers that never came. The cache holds one tag, so
   * it can match at most one of the two tags here: an empty script through the WebView's tag, then
   * one through the wrapper's, leaves the wrapper's tag naming the new WebView (each lookup that
   * misses the cache searches the tagged view for its WebView, and posts run in order). Done in
   * JavaScript so it ships over the air; the native cache stays as it is.
   */
  attach(webViewTag: number, hostTag: number | null): void {
    if (hostTag !== null && hostTag !== webViewTag) {
      GhostexNative.postToWebView(webViewTag, 'void 0');
      GhostexNative.postToWebView(hostTag, 'void 0');
      this.viewTag = hostTag;
    } else {
      this.viewTag = webViewTag;
    }
    this.becomeReady();
  }

  /**
   * The renderer process died or the page could not load: every core in it is gone. The page is
   * reloaded after a growing wait, and after a few failures in a row the bridge gives up with
   * `reason` (pageLoad.ts PageRestarts).
   *
   * CDXC:SessionChat 2026-11-02 WHY: issue #393. This used to reload at once with no cap, so a page
   * that can never load (it resolved to a folder) spawned about 16 WebContent processes a second
   * forever and the chat never learned why.
   */
  died(reason: string): void {
    this.lastError = reason;
    // A reload is already on its way: another report of the same failure (the content process
    // ending after the load error) doesn't spend another try.
    if (this.reloadTimer !== null) return;
    if (this.phase === 'failed') return;
    const decision = this.restarts.onFailure(reason, Date.now());
    if (decision.kind === 'giveUp') {
      console.warn(`[chat-core] gave up: ${decision.message}`);
      logAppEvent(`Chat engine: ${decision.message}`);
      this.fail(decision.message, { retryable: true });
      this.lose(reason);
      return;
    }
    console.warn(`[chat-core] ${reason} Reloading in ${decision.delayMs} ms.`);
    logAppEvent(`Chat engine: ${reason} Reloading in ${decision.delayMs} ms.`);
    // Loading from now, so the chats that rebuild on `lose` wait for the new page.
    this.phase = 'loading';
    this.pageReady = false;
    this.viewTag = null;
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.reload();
    }, decision.delayMs);
    this.lose(reason);
  }

  /** The page could not even start (the asset is missing from this build, for example). */
  fail(reason: string, { retryable = false }: { retryable?: boolean } = {}): void {
    this.phase = 'failed';
    this.failure = reason;
    this.failureRetryable = retryable;
    this.rejectWaiting(new ChatCoreError('unavailable', reason));
  }

  /** One message the page posted. */
  receive(text: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === 'ready') {
      this.pageReady = true;
      this.becomeReady();
      return;
    }
    if (message.type === 'failed') {
      this.fail(typeof message.error === 'string' ? message.error : 'The chat core could not start.');
      return;
    }
    if (message.type === 'crashed') {
      // A core panicked: WebAssembly cannot unwind, so every core in the page is gone.
      this.died('The chat core stopped.');
      return;
    }
    if (Array.isArray(message.batch)) {
      for (const reply of message.batch) this.settle(reply as Reply);
      return;
    }
    this.settle(message as Reply);
  }

  /** The reload counter the WebView keys itself on. */
  reloadKey = (): number => this.reloadSequence;

  /** Re-renders the WebView after a reload. */
  subscribeView = (listener: () => void): (() => void) => {
    this.viewListeners.add(listener);
    return () => {
      this.viewListeners.delete(listener);
    };
  };

  // ---- the chats' side (wasmChatCore.ts) ------------------------------------------------------

  /** Resolves once the page answers; rejects when it cannot start. */
  ready(): Promise<void> {
    if (this.phase === 'ready') return Promise.resolve();
    if (this.phase === 'failed' && this.failureRetryable && this.restarts.retryAfterGiveUp(Date.now())) {
      // The page kept dying a while ago; a chat opening now gets one fresh round of tries.
      logAppEvent('Chat engine: trying the chat core page again.');
      this.reload();
    }
    if (this.phase === 'failed') {
      return Promise.reject(new ChatCoreError('unavailable', this.failure ?? 'The chat core could not start.'));
    }
    if (this.readyTimer === null) {
      // A slow start turns away the chats waiting now but leaves the page loading, so the next chat
      // that opens gets it once it is up. Android holds the page back while the app is in the
      // background, and this timer fires the moment the app returns; failing for good there left
      // every chat broken until the app was restarted, with no other brain to switch to.
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null;
        if (this.phase !== 'ready') {
          const last = this.lastError === null ? '' : ` Last error: ${this.lastError}`;
          this.rejectWaiting(new ChatCoreError('unavailable', `The chat core did not start in time.${last}`));
        }
      }, READY_TIMEOUT_MS);
    }
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }

  /** Every core in the page is gone (crash, reload): the chats rebuild. */
  onLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => {
      this.lostListeners.delete(listener);
    };
  }

  /** One request, one answer. */
  async call(request: WasmCoreRequest): Promise<unknown> {
    const [answer] = await this.batch([request]);
    if (answer.ok) return answer.value;
    throw answer.error;
  }

  /** Several requests in one message (one settle round's events); answers in request order. */
  async batch(
    requests: readonly WasmCoreRequest[],
  ): Promise<({ ok: true; value: unknown } | { ok: false; error: ChatCoreError })[]> {
    await this.ready();
    const tag = this.viewTag;
    if (tag === null) throw new ChatCoreError('unavailable', 'The chat core page has no view yet.');
    const ids: number[] = [];
    const answers = requests.map((request) => {
      const id = this.nextId++;
      ids.push(id);
      return new Promise<{ ok: true; value: unknown } | { ok: false; error: ChatCoreError }>((resolve) => {
        this.pending.set(id, {
          resolve: (value) => resolve({ ok: true, value }),
          reject: (error) => resolve({ ok: false, error }),
        });
      });
    });
    const message =
      requests.length === 1
        ? { id: ids[0], ...requests[0] }
        : { batch: requests.map((request, index) => ({ id: ids[index], ...request })) };
    GhostexNative.postToWebView(tag, `window.gxChatCore.receive(${JSON.stringify(JSON.stringify(message))})`);
    return Promise.all(answers);
  }

  /**
   * A chat's core owes an answer for too long (`RustChatHost.watchDictations`). A page that is up
   * and does not answer is treated as one that died: what it still owes is rejected, every chat
   * rebuilds, and the page is loaded again. A page still starting has its own wait (`ready`).
   */
  stalled(): void {
    if (this.phase === 'ready') this.died('The chat core page stopped answering.');
  }

  /** A chat created a core in the page. */
  coreCreated(): void {
    this.liveHandles += 1;
  }

  /** A chat disposed its core; the last one out reloads a grown page. */
  coreDisposed(): void {
    this.liveHandles = Math.max(0, this.liveHandles - 1);
    if (this.liveHandles > 0 || this.phase !== 'ready') return;
    void this.call({ op: 'memoryBytes' })
      .then((bytes) => {
        if (typeof bytes === 'number' && bytes > RELOAD_AT_BYTES && this.liveHandles === 0) this.reload();
      })
      .catch(() => undefined);
  }

  // ---- inside ------------------------------------------------------------------------------------

  private settle(reply: Reply): void {
    if (typeof reply.id !== 'number') return;
    const pending = this.pending.get(reply.id);
    if (pending === undefined) return;
    this.pending.delete(reply.id);
    if (reply.ok) pending.resolve(reply.result);
    else
      pending.reject(
        new ChatCoreError(reply.error?.code ?? 'unknown', reply.error?.message ?? 'The chat core failed.'),
      );
  }

  private lose(reason: string): void {
    const error = new ChatCoreError('lost', reason);
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) request.reject(error);
    this.liveHandles = 0;
    for (const listener of [...this.lostListeners]) listener();
  }

  /**
   * Ready once the page has started AND `onLoadEnd` named its view tag: the page's `ready` message
   * can arrive before `onLoadEnd`, and a request needs the tag to reach the page.
   */
  private becomeReady(): void {
    if (this.phase !== 'loading' || !this.pageReady || this.viewTag === null) return;
    this.phase = 'ready';
    this.restarts.onReady();
    this.lastError = null;
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    const waiting = this.waiting;
    this.waiting = [];
    for (const waiter of waiting) waiter.resolve();
  }

  private reload(): void {
    if (this.reloadTimer !== null) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    this.phase = 'loading';
    this.failure = null;
    this.failureRetryable = false;
    this.pageReady = false;
    this.viewTag = null;
    this.reloadSequence += 1;
    for (const listener of [...this.viewListeners]) listener();
  }

  private rejectWaiting(error: ChatCoreError): void {
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    const waiting = this.waiting;
    this.waiting = [];
    for (const waiter of waiting) waiter.reject(error);
  }
}

export const wasmCoreBridge = new WasmCoreBridge();
