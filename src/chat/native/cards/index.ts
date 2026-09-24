/**
 * The native chat's cards and overlays (the "cards" area of the Rust chat port,
 * docs/2026-09-24/rust-chat-mobile/PLAN.md).
 *
 * The screen mounts `NativeChatCards` between the transcript and the composer and
 * `NativeChatOverlays` last inside the chat's root. The transcript places the inline pieces in its
 * rows and opens the image viewer and table preview through `openChatImageViewer` /
 * `openChatTablePreview`.
 */

export { NativeChatCards, type NativeChatCardsProps } from './NativeChatCards';
export { NativeChatOverlays, type NativeChatOverlaysProps } from './NativeChatOverlays';
export { questionReplacesComposer } from './QuestionCard';
export { composerNotReady } from './ComposerNotReadyCard';
export type { CardHostAction } from './types';

// Inline pieces the transcript draws inside its rows.
export { EmptyTranscript } from './EmptyTranscript';
export { QuestionExchangeCards } from './QuestionExchangeCards';
export { subagentOpenAction } from './AgentPanels';

// The previews the transcript opens.
export { openChatImageViewer, openChatTablePreview, closeChatOverlays, type ChatImage } from './overlayStore';
export { useChatImage, type ChatImageSource } from './useChatImage';
export { tableCsv } from './TablePreview';
export type { TranscriptItemRenderer } from './SubagentViewer';
