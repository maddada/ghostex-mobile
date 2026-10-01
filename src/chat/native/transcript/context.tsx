/**
 * What every transcript row reads besides its own item.
 *
 * `NativeChatUiProvider` (mounted once per chat screen) owns the drawing state that outlives one
 * list: open rows, the row-detail demand and the loaded-image requests. The subagent viewer's rows
 * share all of it with the main transcript, as desktop's one `NativeChatView` does. The image
 * viewer and the table preview are `NativeChatOverlays`' (`../cards/overlayStore.ts`).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import type { RustChat } from '../../rust/useRustChat';
import type { ChatDocument, Json } from '../../rust/document';
import { arr, obj, str, type JsonRecord } from './json';
import { DisclosureStore, RowDetailDemand } from './state';
import type { TranscriptTheme } from './theme';

/** A picture as the document projects it (`transport`, `path`, `url`, `label`, `alt`). */
export type ChatImageSource = JsonRecord;

export type NativeChatUi = {
  disclosures: DisclosureStore;
  demand: RowDetailDemand;
  /** Asks the core for a machine image's bytes once (`loadImage`); the answer lands in `state.images`. */
  requestImage(path: string): void;
};

const UiContext = createContext<NativeChatUi | null>(null);

export function NativeChatUiProvider({ chat, children }: { chat: RustChat; children: ReactNode }) {
  const disclosures = useMemo(() => new DisclosureStore(), []);
  const dispatchRef = useRef(chat.dispatch);
  dispatchRef.current = chat.dispatch;
  const demand = useMemo(() => new RowDetailDemand((action) => dispatchRef.current(action)), []);
  useEffect(() => () => demand.dispose(), [demand]);
  // A new core (the host changed) has forgotten which rows are open and which images it read.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    demand.reset();
    requested.current = new Set();
  }, [chat.dispatch, demand]);
  const requestImage = useCallback((path: string) => {
    if (path.length === 0 || requested.current.has(path)) return;
    requested.current.add(path);
    dispatchRef.current({ type: 'loadImage', path });
  }, []);
  const value = useMemo<NativeChatUi>(() => ({ disclosures, demand, requestImage }), [demand, disclosures, requestImage]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

/** The chat screen's shared drawing state. Throws outside `NativeChatScreen`. */
export function useNativeChatUi(): NativeChatUi {
  const value = useContext(UiContext);
  if (value === null) throw new Error('useNativeChatUi outside NativeChatUiProvider');
  return value;
}

/** How one list draws (`ChatAppearance` plus the list it belongs to). */
export type TranscriptEnv = {
  /** The chat's `dispatch`, stable per chat (the `RustChat` object itself changes every frame). */
  dispatch: RustChat['dispatch'];
  theme: TranscriptTheme;
  /** Verbose mode opens every work fold by default (`verboseOverride` or the setting). */
  verbose: boolean;
  /**
   * Simple mode (`sessionChatSimpleMode`): tool runs and a message's file edits fold behind a
   * count, and tool rows hide their command preview (desktop `ChatAppearance::simple`).
   */
  simple: boolean;
  /** File edit previews: file cards show their first lines without a tap. */
  filePreviews: boolean;
  /** This session's own transcript (not the subagent viewer): only it offers rewind. */
  main: boolean;
};

const EnvContext = createContext<TranscriptEnv | null>(null);
export const TranscriptEnvProvider = EnvContext.Provider;

export function useTranscriptEnv(): TranscriptEnv {
  const value = useContext(EnvContext);
  if (value === null) throw new Error('useTranscriptEnv outside a transcript');
  return value;
}

/** The document fields rows read, gathered once per document so rows compare cheaply. */
export type TranscriptFlags = {
  finalIds: ReadonlySet<string>;
  savedPrompts: { [messageId: string]: Json };
  rewindAvailable: boolean;
  rewindEnabled: boolean;
  /** The host can stash (Save prompt on a user row). */
  canSavePrompt: boolean;
  deferredWork: { [itemId: string]: { loading: boolean; error?: string | null } };
};

const EMPTY_FLAGS: TranscriptFlags = {
  finalIds: new Set(),
  savedPrompts: {},
  rewindAvailable: false,
  rewindEnabled: false,
  canSavePrompt: false,
  deferredWork: {},
};

const FlagsContext = createContext<TranscriptFlags>(EMPTY_FLAGS);
export const TranscriptFlagsProvider = FlagsContext.Provider;
export function useTranscriptFlags(): TranscriptFlags {
  return useContext(FlagsContext);
}

export function transcriptFlags(document: ChatDocument | null): TranscriptFlags {
  if (document === null) return EMPTY_FLAGS;
  return {
    finalIds: new Set(arr(document.finalIds).filter((id): id is string => typeof id === 'string')),
    savedPrompts: obj(document.savedPrompts) === null ? {} : document.savedPrompts,
    rewindAvailable: document.rewindAvailable === true,
    rewindEnabled: document.rewindEnabled === true,
    canSavePrompt: obj(document.composerActions)?.stash === true,
    deferredWork: obj(document.deferredWork) === null ? {} : document.deferredWork,
  };
}

/** Row details by row key; changes only when the core ships new ones. */
const DetailsContext = createContext<{ [key: string]: Json }>({});
export const RowDetailsProvider = DetailsContext.Provider;
export function useRowDetails(): { [key: string]: Json } {
  return useContext(DetailsContext);
}

/** Loaded image bytes by machine path. */
const ImagesContext = createContext<RustChatImages>({});
export type RustChatImages = NonNullable<RustChat['state']>['images'];
export const ChatImagesProvider = ImagesContext.Provider;
export function useChatImages(): RustChatImages {
  return useContext(ImagesContext);
}

/** Registers an open row's demand for its detail while mounted, and returns the detail (or null). */
export function useRowDetail(key: string, kind: 'tool' | 'file', messageId: string, index: number, active: boolean): Json {
  const { demand } = useNativeChatUi();
  const details = useRowDetails();
  useEffect(() => {
    if (!active) return undefined;
    return demand.add({ key, kind, messageId, index });
  }, [active, demand, index, key, kind, messageId]);
  return active ? (details[key] ?? null) : null;
}

/** What an image tile shows: a URI React Native can load, a spinner, or the picture's own words. */
export type ImageDisplay = { state: 'ready'; uri: string } | { state: 'loading' } | { state: 'unavailable' };

/** Resolves one projected image source, asking the core for machine bytes the first time (`images.rs`). */
export function useImageDisplay(image: ChatImageSource): ImageDisplay {
  const images = useChatImages();
  const { requestImage } = useNativeChatUi();
  const transport = str(image, 'transport');
  const path = str(image, 'path');
  const url = str(image, 'url');
  useEffect(() => {
    if (transport === 'read' && path.length > 0 && images[path] === undefined) requestImage(path);
  }, [images, path, requestImage, transport]);
  if (transport === 'url' || transport === 'data') return url.length > 0 ? { state: 'ready', uri: url } : { state: 'unavailable' };
  if (transport !== 'read' || path.length === 0) return { state: 'unavailable' };
  const loaded = images[path];
  if (loaded === undefined) return { state: 'loading' };
  if (loaded.status === 'failed') return { state: 'unavailable' };
  return { state: 'ready', uri: `data:${loaded.mediaType};base64,${loaded.base64Data}` };
}
