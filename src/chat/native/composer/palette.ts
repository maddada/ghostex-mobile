/**
 * The composer's tones on the phone's dark chat (background `#0e0e0e`, the WebView chat's dark
 * background). Each value is desktop's `ChatAppearance` (apps/desktop/src/app/native_chat/
 * appearance.rs) over that background, so the composer reads like the GPUI and React composers.
 */
export const ComposerPalette = {
  background: '#0e0e0e',
  foreground: '#fcfcfc',
  primary: '#b4b8c0',
  controlPrimary: '#e5e5e5',
  muted: '#9e9e9e',
  /** Hover and pressed fills, separators (6.2% toward white). */
  border: '#1d1d1d',
  /** The composer card (3% toward white) and its border (8%). */
  composerBackground: '#151515',
  composerBorder: '#212121',
  /** The field edge when the composer has focus (`border-ring`, ring at 20%). */
  ring: '#737373',
  ringGlow: 'rgba(115,115,115,0.20)',
  inputBorder: 'rgba(255,255,255,0.08)',
  /** Menus and sheets (the popover tone). */
  menu: '#171717',
  menuBorder: 'rgba(255,255,255,0.10)',
  pressed: 'rgba(252,252,252,0.08)',
  error: '#ef9999',
  /** Send: light fill, dark ink. Stop: dark fill, light ink (send_control.rs). */
  sendFill: '#e5e5e5',
  sendInk: '#171717',
  stopFill: '#171717',
  stopInk: '#fcfcfc',
  backdrop: 'rgba(0,0,0,0.5)',
  grabber: 'rgba(255,255,255,0.22)',
  /** Reference pill tints: `reference-visual.json` colors mixed 28% toward white (dark mode). */
  reference: {
    file: '#95a4b7',
    folder: '#b6a689',
    image: '#8cb59e',
    skill: '#91a99a',
    url: '#91a9bd',
  } as Record<string, string>,
  meterTrack: 'rgba(158,158,158,0.24)',
  meterFill: '#b9b9b9',
} as const;
