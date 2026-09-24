/**
 * The chat card tones for the phone's dark chat (background `#0e0e0e`, the WebView chat's dark
 * background). Each value is desktop's `ChatAppearance` (apps/desktop/src/app/native_chat/
 * appearance.rs) computed over that background, so a card here reads like the same card in the
 * GPUI chat and in the React chat it replaces.
 */
export const ChatCardPalette = {
  background: '#0e0e0e',
  foreground: '#fcfcfc',
  /** Icons and link-like controls. */
  primary: '#b4b8c0',
  /** A selected choice's check and tint base. */
  controlPrimary: '#e5e5e5',
  controlBorder: 'rgba(255,255,255,0.06)',
  inputBorder: 'rgba(255,255,255,0.08)',
  /** The status card's panel (7% toward white) and footer band (3.3%). */
  cardPanel: '#1f1f1f',
  cardFooter: '#161616',
  prose: '#b4b8c0',
  cardMuted: '#b4b8bf',
  muted: '#9e9e9e',
  border: '#1d1d1d',
  input: '#151515',
  ring: '#737373',
  error: '#ef9999',
  /** The theme accent the account-switch card uses. */
  accent: '#86d3f8',
  /** A pressed card or card header. */
  pressedFill: 'rgba(252,252,252,0.06)',
  /** The dimmer behind a modal over the chat (the subagent viewer, the account switch). */
  backdrop: 'rgba(0,0,0,0.58)',
  /** The selected choice fill and border (`controlPrimary` at 10% / 30%). */
  selectedFill: 'rgba(229,229,229,0.10)',
  selectedBorder: 'rgba(229,229,229,0.30)',
  /** The async question dot. */
  asyncDot: '#f472b6',
  /** The async question spinner ring. */
  asyncSpinner: '#d99a62',
  /** The composer-not-ready alert glyph. */
  alertGlyph: '#ef9999',
} as const;

export const CHAT_MONO_FONT = 'Menlo';
