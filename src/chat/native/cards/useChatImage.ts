/**
 * Where a transcript image's pixels come from, as desktop's `chat_image` (`images.rs`) decides:
 * a `url` image is fetched by the image view itself, a `data` image is its own data URL, and a
 * `read` image is a file on the session's machine whose bytes the core reads once (`loadImage`)
 * and the host keeps in `state.images[path]`.
 */

import { useEffect } from 'react';

import type { RustChat } from '../../rust/useRustChat';
import type { ChatImage } from './overlayStore';

/** Why a picture cannot be shown: the core's `image_read_failure_reason` word, or `unavailable`. */
export type ChatImageFailure = { reason: string; error: string };

export type ChatImageSource =
  | { status: 'ready'; uri: string }
  | { status: 'loading' }
  | { status: 'unavailable'; failure: ChatImageFailure };

const NO_SOURCE: ChatImageSource = { status: 'unavailable', failure: { reason: 'unavailable', error: '' } };

/** Paths already asked for, per chat state object, so a list of thumbnails asks once each. */
const requested = new WeakMap<object, Set<string>>();

export function useChatImage(chat: RustChat, image: ChatImage | null | undefined): ChatImageSource {
  const transport = image?.transport ?? 'none';
  const path = transport === 'read' && typeof image?.path === 'string' ? image.path : '';
  const loaded = path.length > 0 ? chat.state?.images[path] : undefined;
  const host = chat.composer;

  useEffect(() => {
    if (path.length === 0 || loaded !== undefined || host === null) return;
    let asked = requested.get(host);
    if (asked === undefined) {
      asked = new Set();
      requested.set(host, asked);
    }
    if (asked.has(path)) return;
    asked.add(path);
    chat.dispatch({ type: 'loadImage', path });
  }, [chat, host, loaded, path]);

  if (image === null || image === undefined) return NO_SOURCE;
  if (transport === 'url' || transport === 'data') {
    return typeof image.url === 'string' && image.url.length > 0 ? { status: 'ready', uri: image.url } : NO_SOURCE;
  }
  if (transport !== 'read' || path.length === 0) return NO_SOURCE;
  if (loaded === undefined) return { status: 'loading' };
  if (loaded.status === 'failed') return { status: 'unavailable', failure: { reason: loaded.reason, error: loaded.error } };
  return { status: 'ready', uri: `data:${loaded.mediaType};base64,${loaded.base64Data}` };
}
