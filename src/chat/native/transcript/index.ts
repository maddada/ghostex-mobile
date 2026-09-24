/**
 * The native chat's transcript (the "transcript" area of the Rust chat port,
 * docs/2026-09-24/rust-chat-mobile/PLAN.md): the list, its rows and Markdown, transcript search,
 * the rewind confirmation, and the per-chat drawing state the rows share.
 */

export { NativeChatUiProvider, useNativeChatUi } from './context';
export { RewindDialog } from './RewindDialog';
export { TranscriptSearchBar } from './SearchBar';
export { NativeTranscript, TranscriptScope, useSubagentRowRenderer, useTranscriptTheme, type NativeTranscriptProps } from './Transcript';
export { TranscriptItemView } from './TranscriptItemRow';
export { transcriptTheme, type TranscriptTheme } from './theme';
