# Ghostex iOS Terminal Screen — Implementation Spec (for React Native reimplementation)

Extracted from `/Users/madda/dev/_active/Ghostex/iOS` (VVTerm fork). The app is **dark-only on iOS** (even a light theme keeps the terminal host `.dark`). Terminal surface = native view; everything else described here is chrome to rebuild in RN.

---

## 1. Terminal Screen Layout

Source: `VVTerm/App/iOS/iOSContentView.swift` (`iOSTerminalView` @814, `iOSTerminalTabsBar` @2475, `iOSTerminalTabButton` @2547, `NavBarBackdrop` @2458), `Features/TerminalSessions/UI/Terminal/TerminalContainerView.swift`, `Core/UI/ServerTabChrome.swift`.

### Top-to-bottom structure
`VStack(spacing: 0)`:
1. **headerTabsBar** — only shown when terminal view is active AND >1 session for the server (and not in Zen mode). Single tab → NO tab bar.
2. **sessionContent** — `TerminalEmptyStateView` (no sessions) or the active terminal container.

Screen sits in a nav stack with a native nav bar; back button hidden/custom. Zen mode hides tab bar + nav bar.

### Backgrounds
- Terminal view: theme terminal background color, ignores all safe areas. Default dark theme "Aizen Dark", fallback `#000000`. Cached hex in prefs key `terminalBackgroundColor`.
- Sessions view: system grouped background. Other: system background.

### Safe area
`NavBarBackdrop`: paints terminal background color behind status/nav bar. Height = top safe inset (fallback 44). Non-interactive overlay.

### Tab bar metrics (`ServerViewTopTabBarMetrics`)
- tabHeight 36, tabVerticalPadding 7, barVerticalInset 4, tabSpacing 4, horizontalPadding 4, outerHorizontalPadding 12. barHeight = 44.
- Container: height 44, capsule background `primary.opacity(0.08)` + 1pt stroke `primary.opacity(0.12)`, clipped, padding H12/V6. Animations disabled.
- Layout: minTabWidth 120. itemWidth = (available - spacing)/count; ≥120 → equal-width HStack filling width; else horizontal ScrollView (no indicators), each tab minWidth 120.

### Tab button
- HStack(spacing 8): status dot Circle 6×6 `statusColor` + title `.callout`, 1 line, primary.
- Padding: leading 14, trailing 36, vertical 7; height 36.
- Selected bg: `primary.opacity(0.18)` capsule; unselected clear.
- Close button overlaid trailing: `xmark` 11pt bold, `primary.opacity(0.92)`, 20×20 circle bg `primary.opacity(selected ? 0.16 : 0.12)` + 1pt stroke 0.12, trailing pad 8.
- Tap anywhere selects. Selection animation easeInOut 0.12s.
- statusColor: connected → green; connecting/reconnecting → orange; disconnected/idle → secondary; failed → red.

### Nav bar toolbar
- Leading: back chevron (`chevron.left`) → dismiss keyboard, then back.
- Principal: segmented view switcher (Terminal / Files / Stats / Sessions). For the RN v1 we have Terminal + Sessions.
- Trailing: overflow menu (`ellipsis.circle`):
  - "Upload Image or File" — `paperclip` (or `hourglass` while uploading); disabled unless connected + terminal view + not uploading.
  - "New Terminal" — `plus`.
  - divider, "Settings" — `gear`, "Find" — `magnifyingglass`, "Edit Server" — `pencil`, "Zen Mode", "Disconnect" (destructive) — `xmark.circle`.

### Connection status overlays (terminal area)
ZStack: bg color → terminal surface (hit-testing only when connected) → state overlay. States:
- Connecting: spinner + "Connecting..." (secondary).
- Reconnecting: spinner + "Reconnecting..." (orange).
- Disconnected: `bolt.slash` largeTitle secondary + "Disconnected"; optional caption "tmux session is still running on the server." or "Without tmux, app backgrounding can interrupt running commands."; Button "Reconnect" (bordered).
- Failed(error): `exclamationmark.triangle` red + "Connection Failed" headline + error caption; host-key failure adds "Trust New Host Key" (prominent); "Retry" (bordered).
- Initializing: spinner + "Initializing terminal..." ; init failed: "Terminal initialization failed" red.

### Banners
- Top warning: "Reconnecting…" / "Reconnecting (attempt N)…".
- Top warning (mosh→ssh fallback): "Using SSH fallback for this session." auto-dismiss 8s.
- Bottom info: "Installing tmux" / "Preparing persistent shell support." (v1: skip tmux/mosh installers)

### Empty state
Centered VStack(24): `terminal` icon 56 secondary; server name title2 semibold; "No terminals open" body secondary; button "New Terminal" (plus + text, pad H24/V12, tint bg, radius 10, white text).

### Alerts
- "Close Tab?" → destructive "Close" / "Cancel"; message: `This will disconnect "<title>".`
- "Replace Trusted Host?" → "Cancel" / "Replace and Reconnect" (destructive); message includes host:port.
- "Upload Failed" → "OK".

### Floating controls (browse mode, phone)
Keyboard (`keyboard`), Upload (`paperclip`/`hourglass`), Enter (`arrow.turn.down.left`) buttons; spring response 0.28 damping 0.84.

---

## 2. Keyboard Accessory — the "2 rows of keys"

Source: `GhosttyTerminal/GhosttyTerminalView+iOS.swift` (`TerminalInputAccessoryView` @4626), `Features/TerminalAccessories/Domain/TerminalAccessoryModels.swift`.

### Attachment
Real `inputAccessoryView` riding above the software keyboard. Hidden when: hardware keyboard attached, find navigator active, or browse mode.

### Bar
- Fixed height **88pt**. Background opaque = theme terminal background color. Dark style always.
- Leading cluster (spacing 8, leading inset 12): text-editor toggle above Dismiss-keyboard `keyboard.chevron.compact.down` (default **shown**), then a separator (`separator` α0.4).
- Rows stack: vertical, spacing 6, fillEqually; insets top 7 / bottom 7 / trailing 10 / leading 10 (after separator) or 12.

### Text editor page
- The leading text-editor button swaps the key grid for a focused single-line composer, matching the Android Termux toolbar's alternate text-input page.
- The keyboard Send action writes the entire buffer to the selected terminal and clears it. Sending an empty buffer writes carriage return (Enter).
- Switching back to the key grid restores terminal keyboard focus.

### Two rows, 7 equal columns each (fixed grid, no scroll). Empty slots invisible placeholders. Max 14 items, min 1.

### Default layout (VERBATIM)
- Row 1: `Esc`, `Shift`, `Ctrl-J` (label **NEWLN**), `Home`, `↑`, `End`, `PGUP`
- Row 2: `Tab`, `Ctrl`, `Alt`, `←`, `↓`, `→`, `PGDN`

Labels (fixed ASCII): CTRL, ALT, Cmd, SHIFT, ESC, TAB, S-Tab, Enter, Bksp, Del, Ins, HOME, END, PGUP, PGDN; arrows are icons (arrow.up/down/left/right); F1..F12; ^C ^D ^Z ^L ^A ^E ^K ^U; Ctrl-J → "NEWLN".

### Button styling
- Pill: height 28, radius 14, 1pt border `separator` α0.3, bg dark `white α0.08`, font system 10 semibold for every text key, color secondaryLabel.
- Modifier: same dimensions and font size as every other text key.
- Icon: symbol 14 semibold, tint label, height 32, width 36, radius 16, bg dark `white α0.12`.
- Buttons fill columns without per-label font shrinking.

### Modifier latching
- Ctrl/Alt/Cmd/Shift are toggle latches. Active look: bg systemBlue, white text, no border; 0.2s animate.
- The next non-modifier input applies all active modifiers and then resets ALL latches (one-shot sticky semantics), whether that input comes from an accessory key or the software keyboard.

### Repeat-on-hold
- Repeatable: arrows, backspace, home, end, pageUp, pageDown.
- Fires once on touch-down, then after 350ms repeats every 50ms until touch up/cancel/drag-exit. Modifiers consumed each repeat.

### Key semantics
- Esc: cancels local IME composition if active, then sends Escape.
- Backspace with no mods + IME session → deleteBackward on proxy; else send key.
- Ctrl shortcuts (^C etc.) send letter with ctrl mod.
- Custom actions: send text, optionally + Enter.

### Customization (later milestone; keep model shape)
Profile: 2 rows × 7 columns, drag reorder, custom actions (≤100, title ≤24 chars, content ≤2048), reset-to-default. Persisted profile, live-rebuild on change. RN v1: ship default layout + persistence hook.

---

## 3. Pinch to Zoom

- Pinch recognizer on terminal surface; disabled while text selection active.
- Changes **font size in points**, per-session. Range 4.0–32.0, step 1.0. Default: iPhone 9pt, iPad 12pt.
- Ratchet logic: reference scale at began; relativeScale ≥1.12 → +1pt; ≤0.89 → −1pt; reset reference each step. Not continuous.
- Persistence: per-session presentation override, persisted; falls back to global `terminalFontSize`.
- HUD: centered dark-blur card radius 18, min 112×72; value "12 pt" (monospaced 24 semibold white) over "Font Size" (12 medium white α0.72). Fade in 0.12s, auto-hide 0.8s idle (0.45s after gesture end), fade out 0.18s.

## 4. Scrolling

- iOS: NO native scroll view. Single-touch pan → synthetic scroll events into the terminal engine, `translation * 4.0`, precision, reset translation each change.
- Momentum: if |velocity| > 35 → per-frame v = velocity/60 * 4.0 * 0.75, display-link ticks, decay ×0.94/frame, stop at |v| < 0.5, send momentum began/changed/ended.
- New pan/pinch stops momentum. Scroll-to-bottom on output/keypress handled by the engine. No scrollbar, no jump-to-bottom button.
- Android note: Termux TerminalView has its own scroll/fling handling — keep it; pinch-zoom must map to font size changes like iOS.

## 5. File Attach & Send

- Entry: overflow menu "Upload Image or File" (paperclip/hourglass) + floating Upload control. Enabled only when connected.
- Picker: document picker, any type, single selection.
- Payload: read file data, filename (fallback `upload.bin`), MIME (`application/octet-stream` fallback), isImage by UTType/MIME.
- Remote path creation (run over SSH, POSIX only):
  ```sh
  tmp_base="${TMPDIR:-/tmp}"
  attachment_dir="${tmp_base%/}/ghostex-ios-attachments"
  mkdir -p "$attachment_dir"
  tmp_path="$(mktemp "$attachment_dir/upload-XXXXXX")"
  target_path="${tmp_path}-<sanitizedFilename>"   # sanitize to [A-Za-z0-9._-], others → '-'
  mv "$tmp_path" "$target_path"
  printf '%s\n' "$target_path"
  ```
- Upload via SFTP (or exec-preferred on Darwin), permissions 0600. Delete remote file on failure.
- On success insert into terminal (no trailing newline): `[<title>](<remotePath>)` where title = "Image #N" / "File #N" (per-kind counters).
- Progress: icon flips to hourglass + disabled; failure → "Upload Failed" alert. Not-connected error copy: "Reconnect the terminal before uploading files."

## 6. Session plumbing (UI-side)

- Tabs = sessions of current machine. Selection falls back to first session.
- Titles: OSC/runtime title override → else machine/server name.
- States: disconnected / connecting / connected / reconnecting(attempt) / failed(error). Status strings: "Disconnected", "Connecting...", "Connected", "Reconnecting (N)...", "Failed: <error>".
- Auto-reconnect default ON (`sshAutoReconnect`); reconnect on foreground/scene-active; 20s connect watchdog → failed("Connection timed out. Please retry.").
- Edge-swipe tab switching: 32pt edge strips, drag min 24, horizontal > 60pt and > vertical → next/prev tab. Light impact haptic on every tab switch.

## Cross-cutting

- Haptics: only light impact on tab switch.
- Animations: tab select easeInOut 0.12; floating controls & zen spring (0.28, 0.84); modifier latch 0.2; zoom HUD fades as above; tab bar/session container animations disabled.
- Theming: dark-only; terminal bg color drives accessory bar + nav backdrop.
