/**
 * One open chat whose transcript GPUI draws: the desktop's own chat renderer and Rust chat host
 * inside the phone library (`packages/gpui-mobile`), fed from the chat's computer through a port
 * forward (`endpoint.ts`).
 *
 * It exposes the same surface as the TypeScript host (`../rust/host.ts`) so the React Native
 * composer, card band and overlays draw from it unchanged:
 * - `state.document` is the core's document, which the Rust host forwards on every change;
 * - the composer is the same `ComposerModel`, and the core's composer requests (which the view
 *   forwards in host-composer mode, `native_chat/state.rs`) are applied to it exactly as `host.ts`
 *   applies the effects they come from;
 * - `query` answers the core's pure helpers from a query-only core in the same library;
 * - view requests (open, copy, toast, host actions) come from the transcript's events.
 *
 * The transcript itself (items, row details, images, the subagent viewer) is GPUI's, so this host
 * keeps none of it.
 */
import {
  createChatCore,
  type ChatCoreHandle,
  type ChatCoreQuery,
} from '../../../modules/gx-chat-core/src';
import { gpuiCommand, startGpui, type GpuiEvent } from '../../../modules/gx-chat-core/src/gpui';
import type { ChatDocument } from '../rust/document';
import type { ChatViewRequest } from '../rust/effects';
import { ComposerModel } from '../rust/composer';
import type { RustChatHost, RustChatState, RustChatTarget } from '../rust/host';
import type { UserAction } from '../rust/actions';
import { uploadSessionChatLocalFile } from '../session-chat-helpers';
import { gpuiMachineEndpoint, forgetGpuiMachineEndpoint } from './endpoint';

type Listener = () => void;
type ViewListener = (request: ChatViewRequest) => void;

const MAX_HELD_VIEW_REQUESTS = 64;

let gpuiStarted = false;
const eventListeners = new Set<(event: GpuiEvent) => void>();

/** Hands one GPUI event to the open chat (the `GpuiView`'s `onEvent`). */
export function dispatchGpuiEvent(event: GpuiEvent): void {
  for (const listener of eventListeners) listener(event);
}

/** Launches GPUI with the chat content once per process. */
function ensureGpuiStarted(): void {
  if (gpuiStarted) return;
  gpuiStarted = true;
  startGpui({
    content: 'chat',
    hostComposer: true,
    forwardSnapshots: true,
    clientName: 'ghostex-mobile',
  });
}

function emptyState(): RustChatState {
  return {
    status: 'starting',
    revision: 0,
    document: null,
    items: [],
    subagentItems: [],
    minimap: [],
    rowDetails: {} as RustChatState['rowDetails'],
    composer: new ComposerModel({
      dispatch: () => undefined,
      document: () => null,
      onChange: () => undefined,
      onSendBlocked: () => undefined,
      onFocusRequested: () => undefined,
    }).state,
    images: {},
    error: null,
    stats: {
      eventsHandled: 0,
      framesPublished: 0,
      rpcsSent: 0,
      rpcsRefused: 0,
      effects: {},
      unknownEffects: 0,
      settleRoundsExhausted: 0,
      storageRefused: 0,
    },
  };
}

export class GpuiChatHost {
  state: RustChatState = emptyState();
  private readonly listeners = new Set<Listener>();
  private readonly viewListeners = new Set<ViewListener>();
  private heldViewRequests: ChatViewRequest[] = [];
  private queryCore: ChatCoreHandle | null = null;
  private disposed = false;
  private readonly composer: ComposerModel;
  private readonly onEvent = (event: GpuiEvent) => this.handleEvent(event);

  constructor(private readonly target: RustChatTarget) {
    this.composer = new ComposerModel({
      dispatch: (action) => this.dispatch(action),
      document: () => this.state.document,
      onChange: () => this.update({ composer: this.composer.state }),
      onSendBlocked: (reason) => this.sendBlocked(reason),
      onFocusRequested: () => this.view({ kind: 'focusComposer' }),
    });
    this.state = { ...this.state, composer: this.composer.state };
  }

  /** Resolves the computer's endpoint and opens the chat in GPUI. */
  open(): void {
    eventListeners.add(this.onEvent);
    try {
      ensureGpuiStarted();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'The GPUI transcript could not start.');
      return;
    }
    const { machine, projectId, sessionId } = this.target;
    gpuiMachineEndpoint(machine)
      .then((endpoint) => {
        if (this.disposed) return;
        gpuiCommand({ type: 'setMachineEndpoint', ...endpoint });
        gpuiCommand({ type: 'openSession', machineId: machine.id, projectId, sessionId });
      })
      .catch((error: unknown) => {
        forgetGpuiMachineEndpoint(machine.id);
        this.fail(error instanceof Error ? error.message : 'Could not reach the computer for the GPUI transcript.');
      });
  }

  dispose(): void {
    this.disposed = true;
    eventListeners.delete(this.onEvent);
    this.queryCore?.dispose();
    this.queryCore = null;
  }

  // ---- the RustChat surface ------------------------------------------------------------------

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): RustChatState {
    return this.state;
  }

  dispatch(action: UserAction): void {
    if (this.disposed) return;
    gpuiCommand({ type: 'action', action });
  }

  onViewRequest(listener: ViewListener): () => void {
    this.viewListeners.add(listener);
    const held = this.heldViewRequests;
    this.heldViewRequests = [];
    for (const request of held) listener(request);
    return () => this.viewListeners.delete(listener);
  }

  /** The core's pure helpers, answered synchronously from a query-only core. */
  query(name: ChatCoreQuery, args: readonly unknown[]): unknown {
    try {
      this.queryCore ??= createChatCore();
      return JSON.parse(this.queryCore.query(name, JSON.stringify(args))) as unknown;
    } catch {
      return null;
    }
  }

  readonly composerInput: RustChatHost['composerInput'] = {
    edited: (text, selection) => this.composer.edited(text, selection),
    selected: (selection) => this.composer.selected(selection),
    focused: () => this.composer.focused(),
    blurred: () => this.composer.blurred(),
    submit: (mode) => this.composer.submit(mode),
  };

  async attachFiles(files: readonly { uri: string; name?: string }[]): Promise<void> {
    if (files.length === 0) return;
    this.dispatch({ type: 'attachmentsStarted' } as UserAction);
    try {
      const paths: string[] = [];
      for (const file of files) {
        const name = file.name ?? file.uri.split('/').pop() ?? 'attachment';
        const kind = /\.(png|jpe?g|gif|webp|heic)$/iu.test(name) ? 'image' : 'file';
        paths.push(await uploadSessionChatLocalFile(this.target.machine, file.uri, name, kind));
      }
      this.dispatch({ type: 'attachmentsFinished', paths } as UserAction);
    } catch (error) {
      this.dispatch({
        type: 'attachmentsFinished',
        error: error instanceof Error ? error.message : 'The attachment could not be uploaded.',
      } as UserAction);
    }
  }

  // ---- GPUI events ---------------------------------------------------------------------------

  private handleEvent(event: GpuiEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'snapshot':
        this.update({
          status: 'running',
          document: event.snapshot as ChatDocument,
          revision: this.state.revision + 1,
        });
        return;
      case 'hostAction':
        this.hostAction(String(event.action), (event.message ?? {}) as Record<string, unknown>);
        return;
      case 'toast':
        this.view({ kind: 'toast', level: event.error === true ? 'error' : 'info', message: String(event.message) });
        return;
      case 'copy':
        this.view({ kind: 'copy', text: String(event.text) });
        return;
      case 'error':
        console.warn(`[gpui-chat] ${String(event.message)}`);
        return;
    }
  }

  private hostAction(action: string, message: Record<string, unknown>): void {
    switch (action) {
      case 'composerRequest':
        this.composerRequest((message.request ?? {}) as Record<string, unknown>);
        return;
      case 'chatImage':
        this.chatImage((message.request ?? {}) as Record<string, unknown>);
        return;
      case 'openLink':
        if (typeof message.url === 'string') this.view({ kind: 'open', target: { kind: 'url', url: message.url } });
        return;
      case 'openFile':
        if (typeof message.path === 'string') {
          this.view({
            kind: 'open',
            target: {
              kind: 'file',
              path: message.path,
              ...(typeof message.line === 'number' ? { line: message.line } : {}),
              ...(typeof message.column === 'number' ? { column: message.column } : {}),
            },
          });
        }
        return;
      default: {
        const { type: _type, action: _action, ...params } = message;
        this.view({ kind: 'hostAction', action, params });
      }
    }
  }

  /** A composer request the view forwarded; the same calls `host.ts` makes for their effects. */
  private composerRequest(request: Record<string, unknown>): void {
    const params = (request.params ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    switch (request.kind) {
      case 'composerInit':
        this.composer.init({ clientId: params.clientId, entry: params.entry }, this.target.sessionId);
        return;
      case 'composer':
        this.composer.replace(
          text(params.content),
          typeof params.caret === 'number' ? params.caret : null,
          request.method === 'history',
          params.preserveError === true
        );
        return;
      case 'composerClearExpected':
        this.composer.clearIfUnchanged(text(params.text));
        return;
      case 'returnedPrompt':
        this.composer.returnedPrompt(text(params.text));
        return;
      case 'draftSubmitted':
        this.composer.submitted(typeof request.method === 'string' ? request.method : 'send', params);
        return;
      case 'submissionFailed':
        this.composer.failed(text(params.text));
        return;
      case 'draftReceived':
        this.composer.received(params);
        return;
      case 'attachmentReferences':
        this.composer.insertAttachments(params.paths);
        return;
      case 'rpc':
        if (request.method === 'readNativeComposer') {
          gpuiCommand({ type: 'resolveComposerRead', id: request.id, text: this.composer.state.text });
        }
        return;
    }
  }

  /** A chat image the core loaded, for the composer's attachment thumbnails. */
  private chatImage(request: Record<string, unknown>): void {
    const params = (request.params ?? {}) as Record<string, unknown>;
    const path = typeof params.path === 'string' ? params.path : '';
    if (!path) return;
    const base64Data = typeof params.base64Data === 'string' ? params.base64Data : null;
    const loaded =
      request.method === 'loaded' && base64Data !== null
        ? ({
            status: 'loaded',
            base64Data,
            mediaType: typeof params.mediaType === 'string' ? params.mediaType : 'image/png',
          } as const)
        : ({ status: 'failed', error: typeof params.error === 'string' ? params.error : '' } as const);
    this.update({ images: { ...this.state.images, [path]: loaded } });
  }

  private sendBlocked(reason: string): void {
    const answer = this.query('sendBlockedToast', [reason]) as { title?: string; message?: string } | null;
    this.view({
      kind: 'toast',
      level: 'error',
      message: answer?.message ?? reason,
      ...(answer?.title ? { title: answer.title } : {}),
    });
  }

  private view(request: ChatViewRequest): void {
    if (this.viewListeners.size === 0) {
      if (this.heldViewRequests.length < MAX_HELD_VIEW_REQUESTS) this.heldViewRequests.push(request);
      return;
    }
    for (const listener of this.viewListeners) listener(request);
  }

  private fail(message: string): void {
    this.update({ status: 'failed', error: message });
  }

  private update(next: Partial<RustChatState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}
