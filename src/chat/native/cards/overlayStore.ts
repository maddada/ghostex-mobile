/**
 * The chat's full-screen previews that the renderer opens itself, not the core: the image viewer
 * (a transcript image or thumbnail was tapped) and the table preview (a table's expand button).
 * Desktop keeps the same two as view state on `NativeChatView` (`image_viewer`, `table_preview`);
 * nothing about them is in the document.
 *
 * Transcript rows call `openChatImageViewer` / `openChatTablePreview`; `NativeChatOverlays` draws
 * whichever is open and closes both when the chat screen goes away.
 */

import { create } from 'zustand';

/** One image as the document projects it (`images` on a message): `transport` is `url`, `data`,
 * `read` or `none`; `read` images are fetched with the `loadImage` action. */
export type ChatImage = {
  transport?: string;
  url?: string;
  path?: string;
  label?: string;
  alt?: string;
  copyPath?: string;
  fileName?: string;
  [key: string]: unknown;
};

type OverlayState = {
  imageViewer: { images: ChatImage[]; index: number } | null;
  tablePreview: { source: string } | null;
};

export const useChatOverlayStore = create<OverlayState>(() => ({ imageViewer: null, tablePreview: null }));

/** Opens the full-size viewer on `images[index]`; the rest of the list is next / previous. */
export function openChatImageViewer(images: readonly ChatImage[], index: number): void {
  if (images.length === 0) return;
  useChatOverlayStore.setState({ imageViewer: { images: [...images], index: Math.min(Math.max(0, index), images.length - 1) } });
}

/** Opens the larger preview of a Markdown table (its source, delimiter row included). */
export function openChatTablePreview(source: string): void {
  useChatOverlayStore.setState({ tablePreview: { source } });
}

export function closeChatOverlays(): void {
  useChatOverlayStore.setState({ imageViewer: null, tablePreview: null });
}
