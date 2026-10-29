# Ghostex iOS Terminal Screen — Implementation Spec (for React Native reimplementation)

Extracted from `/Users/madda/dev/_active/Ghostex/iOS` (VVTerm fork). The app is **dark-only on iOS** (even a light theme keeps the terminal host `.dark`). Terminal surface = native view; everything else described here is chrome to rebuild in RN.

---

## 1. Terminal Screen Layout

Source: `VVTerm/App/iOS/iOSContentView.swift` (`iOSTerminalView` @814, `iOSTerminalTabsBar` @2475, `iOSTerminalTabButton` @2547, `NavBarBackdrop` @2458), `Features/TerminalSessions/UI/Terminal/TerminalContainerView.swift`, `Core/UI/ServerTabChrome.swift`.

### Top-to-bottom structure
`VStack(spacing: 0)`:
1. **headerTabsBar** — merged into the header row: back button + tabs capsule track (fills the remaining width; no title text) + overflow button. Shown whenever ≥1 tab, including a single tab.
2. **sessionContent** — `TerminalEmptyStateView` (no sessions) or the active terminal container.

Screen sits in a nav stack with a native nav bar; back button hidden/custom. Zen mode hides tab bar + nav bar.

### Backgrounds
- Terminal view: theme terminal background color, ignores all safe areas. Default dark theme "Aizen Dark", fallback `#000000`. Cached hex in prefs key `terminalBackgroundColor`.
- Sessions view: system grouped background. Other: system background.

### Safe area
`NavBarBackdrop`: paints terminal background color behind status/nav bar. Height = top safe inset (fallback 44). Non-interactive overlay.

### Tab bar metrics (`ServerViewTopTabBarMetrics`)
- tabHeight 28, trackHeight 36 (fits inside the 44 header row), tabSpacing 4, trackInnerPad 4.
- Track: capsule background `primary.opacity(0.08)` + 1pt stroke `primary.opacity(0.12)`, clipped; flexes to fill the header between back and overflow buttons. Animations disabled.
- Layout: minTabWidth 120. itemWidth = (available - spacing)/count; ≥120 → equal-width row filling width. One tab, or a track not yet measured, also fills the width: a lone tab in a track narrower than 120 pt now fills it, its title ending in an ellipsis, where the earlier fixed 120 pt scrolling tab was clipped (a deliberate change, not "unchanged"). Otherwise a horizontal ScrollView (no indicators) whose tabs are sized so the next tab always peeks in (`tabStripLayout`, `src/components/terminal/tabStrip.ts`; owner 2026-10-28, "es muss deutlich sein, dass man wischen kann"): as many whole tabs as still leave 25 % of the next tab showing, none narrower than 80 pt.
- Scroll mode: the edge that hides more tabs fades (`HorizontalFade`, the same component as the chat's pill rows, in the track's own colour over the header; left once scrolled, right while more follow). Only the active tab shows its close button in this mode, so a peeking tab shows its title, not a lone close button; wide strips and a single tab (which has no neighbour to hide) show a close button on every tab. Chat stays a header button (owner 2026-10-28), also in the narrow Duo status band.
- Scroll mode rests the active tab at the strip's start so the next tab always peeks in (`stripScrollOffset`); the last tab rests at the strip's end, where the previous tab peeks in instead. This replaces centring, which left a middle tab's neighbour only about 15 % visible. It happens on tap, on selection change, and after a close/content resize the offset re-clamps immediately (no stale gap at the end). The centering is owed again only when the active tab, the tab count or the track width changes; a manual drag ends it, and a re-render or reflow with the same active tab never undoes the user's scroll.

### Tab button
- HStack(spacing 8): status dot Circle 6×6 `statusColor` + title `.callout`, 1 line, primary.
- Padding: leading 14, trailing 36, vertical 7; height 36.
- Selected bg: `primary.opacity(0.18)` capsule; unselected clear.
- Close button overlaid trailing: `xmark` 11pt bold, `primary.opacity(0.92)`, 20×20 circle bg `primary.opacity(selected ? 0.16 : 0.12)` + 1pt stroke 0.12, trailing pad 8.
- Tap anywhere selects. Selection animation easeInOut 0.12s.
- statusColor: connected/open → NO dot; connecting/reconnecting → orange; disconnected/idle → secondary; failed → red.

### Nav bar toolbar
- Leading: back chevron (`chevron.left`) → dismiss keyboard, then back.
- Principal: segmented view switcher (Terminal / Files / Stats / Sessions). For the RN v1 we have Terminal + Sessions.
- Trailing: one overflow menu (`ellipsis.circle`) holding both sections — the Agent Actions section (Rename, Sleep/Wake, Delayed Actions, Fork, Full Reload, Prompt Editor, Export Transcript) for resolved gxserver sessions, then the Session section:
  - "Send & Attach File" — `paperclip`; disabled unless connected + terminal view + not uploading.
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
- Closing a tab disconnects immediately by default. When "Confirm before closing tabs" is enabled, show "Close Tab?" → destructive "Close" / "Cancel"; message: `This will disconnect "<title>".`
- "Replace Trusted Host?" → "Cancel" / "Replace and Reconnect" (destructive); message includes host:port.
- "Upload Failed" → "OK".

### Floating controls (browse mode, phone)
Keyboard (`keyboard`), Upload (`paperclip`/`hourglass`), Enter (`arrow.turn.down.left`) buttons; spring response 0.28 damping 0.84.

---

## 2. Keyboard Accessory — the "2 rows of keys"

Source: `GhosttyTerminal/GhosttyTerminalView+iOS.swift` (`TerminalInputAccessoryView` @4626), `Features/TerminalAccessories/Domain/TerminalAccessoryModels.swift`.

### Attachment
Real `inputAccessoryView` riding above the software keyboard. Hidden when: hardware keyboard attached, find navigator active, or browse mode.

### Keyboard: the terminal slides, the grid stays (iOS, terminal view)
Owner decision A, 2026-10-28 ("Raster bleibt, Terminal gleitet"; the slide rule below was replaced by the owner's decision of 2026-10-28T19:54:22Z, "Unterkante sichtbar, Cursor gewinnt", on the report that the keyboard covered the question card omp draws in the terminal below the cursor), on the report that the terminal jumped when the software keyboard came and went. Cause, as found in the code: the screen shrank the terminal container by the keyboard height at once (`TerminalScreen` bottom padding), so the native view's bounds changed, `sizeDidChange` set a new surface size and `onResize` announced a new grid to the host, whose pty resize made the remote program redraw; the keyboard's own animation was not used (`useKeyboardMetrics` read only `endCoordinates`). Not reproduced on a device; the redraw part is an inference.
- **The grid stays.** On iOS in terminal mode the terminal view keeps the size it has with the keyboard hidden (the area above the home-indicator inset), whatever the keyboard or QuickType do: no surface size change, no `onResize`, no grid announcement caused by the keyboard. Rotation, fold and window-size changes still resize it as before. Chat view and Android keep their paths (Android: container padding, key bar in the flow).
- **The view slides.** The terminal area clips its content (`overflow: hidden`); the view moves up by `terminalSlideOffset` (`terminalKeyboardSlide.ts`): always as far as the bottom row stands directly above the top of the key bar (above the keyboard with the key bar off), so what the program draws below the cursor (an omp question card with its options) is visible; only when the cursor row would then leave the top of the visible part, as far as it stays visible. With `caretTop` the cursor row's top edge and `obstruction` the covered height: `offset = clamp(min(obstruction, caretTop), 0, obstruction)`; cursor row in the lower part: the whole covered height; cursor row near the top (`caretTop < obstruction`): `caretTop`, the cursor row at the visible area's top edge; keyboard hidden or view not laid out: 0; no cursor row reported yet: the covered height (the bottom is visible, no known cursor can be lost). The covered height is the keyboard's overlap (window height less the reported frame's top, FL-LAY-01) plus the key bar's height, less the home-indicator inset below the view. No extra gap is added on iOS (the 3 pt gap is Android's). Rows moved above the area are hidden behind the header while the keyboard is up; scrollback still works.
- **The cursor row** comes from the native view's `onCaretChange` (`{ top }`: the cursor row's top edge in whole points from the view's top, `y - height` of `ghostty_surface_ime_point`, where Ghostty's `imePoint` (v1.3.1) sets `y` to the bottom of the cursor cell with the padding included and `height` to the cell's height; sent after a draw when the whole-point value changed, and once when the view is attached), so the offset follows new output and a growing prompt. iOS only; the Android view declares no such event and the prop is not passed there.
- **With the keyboard's animation.** The shared keyboard store (`keyboardFrame.ts`) requests `LayoutAnimation` before it publishes the frame that changes the overlap; `useKeyboardMetrics({ slides })` reads the store and requests nothing, so the terminal's offset and the key bar's position are expected to move in step with the keyboard (basis and limit below); a repeated report of the same frame (`keyboardWillShow` and `keyboardWillChangeFrame` for one move) animates once. The motion is an approximation of the system's: React Native's Fabric renderer (0.88) has no keyboard curve (`LayoutAnimation.Types.keyboard` falls through to linear there), and the owner found linear not good on the device (2026-10-28), so the screen asks for configs fitted to the measured keyboard motion, defined once in `components/common/keyboard/keyboardMotion.ts`: a show (the keyboard's top appears or rises) is a spring, `springDamping` 1.8, 580 ms (rmse 5.6 pt, worst 14 pt against the recording; linear over 250 ms was 20 / 49 pt); a hide (the top leaves or lowers) is an ease-out, 250 ms (rmse 13 pt, worst 27 pt; linear 33 / 58 pt). Basis: one owner screen recording (iPhone Duo inner display, iOS 27.2, 60 fps, 6 shows and 5 hides; evidence `bug-kbd/curve-fit.json` of the S1 work), one device; the hide is only visible for about 0.17 s, so its fit is weaker. Not identical to the system curve; the owner chose the approximation, 2026-10-28 (the exact approach, react-native-keyboard-controller, is a separate change after S1). The event's `duration` is no longer the length (what iOS reports there was not measured and the fit needs 580 ms); it only decides whether to animate at all (0: nothing). `LayoutAnimation` is app-wide and last-writer-wins, so on iOS the shared `keyboardFrame.ts` store is the one writer for everything that follows the keyboard, the terminal included: `useKeyboardMetrics` registers no keyboard listener of its own there and reads the store (`useKeyboardState`), so the terminal's layout change is expected to land in the render the store's publish causes; one request per keyboard move. The store's visibility model: the keyboard is visible between `keyboardWillShow` (iOS posts it for every appearance) and `keyboardWillHide`; `keyboardWillShow` is never discarded (it always means visible, and requests the show motion when the keyboard appears or its top changes); a `keyboardWillChangeFrame` while hidden (the end frame of a hide) is ignored; one while visible updates the frame and requests show (end top above start top) or hide (below), read off the notification's own `startCoordinates` and `endCoordinates` (one coordinate space, so a turn or fold cannot skew it; the stored frame only when a notification has no start frame); one whose end frame starts at or below its start frame's bottom edge is a frame-only hide (hide motion once, hidden; the later `keyboardWillHide` finds it hidden). An appearance is counted only from hidden. The terminal additionally masks the store's visibility with the current window (`keyboardTopInWindow`). The store counts appearances, so a terminal mounted while the keyboard is up sees none. The chat composer's lift (`useKeyboardInset`, upstream's code) follows the same fitted motion (owner decision 2026-10-28, "Ja, in S1") as a consumer of the store (`useKeyboardTop`) too: no keyboard listener and no animation request of its own, no measurement at keyboard time. Its overlap is its resting bottom edge in the window (cached from its layout: `onLayout`, and again when the window's height changes; the window's bottom until the first measurement) less the keyboard's top, so the composer, and what sits above and below it, are expected to change in the render the store's publish causes, with the store's one request, and nothing with Reduce Motion or a zero duration. Basis and limit of that expectation: React flushes the sync-lane render from the store's publish in a microtask after the keyboard event, so a JS-driven `Animated` frame (a later task) should not land in between; a `setNativeProps` or `Animated` update made synchronously inside another keyboard listener could still consume the pending Fabric config (the store holds the only iOS keyboard listeners in `src`; no code sets such values there); the device hand test decides. Reason (installed build 51446c3b, owner recordings 2026-10-28; cause inferred, not proven): its own request came after an asynchronous measurement (show) or after the store's commit (hide), so another commit could consume the pending config and the composer's own change landed unanimated, while the row below it slid. Its geometry (padding = inset + 8, `inputMaxHeightFor`) is unchanged. This also changes upstream's `keyboardFrame.ts` motion for its other consumers (`VerticalBarArea`, `KeyboardAvoidingContainer`, `BottomSheet`, the chat sheet, `fieldReveal`, `FindPromptsScreen`, `SessionSearchSheet`): they follow the keyboard more closely too. Cursor-row moves are not animated.
- **Reduce Motion (FL-A11Y-05).** With the system setting on, one carrier (`components/common/reduceMotion.ts`: `AccessibilityInfo.isReduceMotionEnabled()`, followed through `reduceMotionChanged` while anything consumes it; read from React by `useKeyboardMetrics`, from the non-React keyboard store by `isReduceMotionOn`) is the only source, and the one writer of the app-wide `LayoutAnimation` on iOS, the shared `keyboardFrame.ts` store (mounted by `VerticalBarArea` for the whole app), requests none (`useKeyboardMetrics`, the sheets and the chat composer request nothing of their own). Consequence outside the terminal: the other consumers of `keyboardFrame.ts` no longer animate their keyboard moves with Reduce Motion on either (floor-required, a change to upstream's behaviour). Then the terminal's offset and the key bar go to their end positions at once and the key bar unmounts without the hide delay. Geometry and end states are the same.
- **Keyboard summoned while scrolled back.** When the keyboard comes up (hidden to shown; keyboard button, tap or focus alike) the terminal is scrolled to the bottom of its scrollback (`GhostexNative.scrollToBottom`, once), so the input area is visible above the key bar with the keyboard. Not on a frame change while the keyboard is already up, not in chat view, not on Android. On iOS "comes up" means the reported frame reaches into the window: a `keyboardWillChangeFrame` that ends below it (after a hide) counts as hidden, so it neither scrolls nor keeps the key bar. Only the terminal on screen scrolls (`mountedTerminalSessionKey`: open tab, not chat view, screen focused): a retained terminal behind another screen that opens its keyboard (Settings text input) keeps its scrollback; the layout predicate `slidesWithKeyboard` does not depend on focus. The cursor row's `top` is the active area's (Ghostty's `imePoint` does not depend on the scroll position), so the offset needs no recomputation after the scroll.
- **The key bar rides on the keyboard.** On iOS the key bar is in `KeyBarDock`, absolutely positioned across the window width, `inset` points above the window's bottom edge while the keyboard is up and below it while it is away; it stays mounted for the hide motion's 250 ms (`KEYBOARD_HIDE_MOTION`; 0 with Reduce Motion) so it leaves with the keyboard, then unmounts (its state resets as before) and is out of touch and VoiceOver reach while leaving. The optimistic bar after a tap (`tapKeyboardHint`), the editor/pen hand-over, the hardware-keyboard behavior and the setting that turns the bar off are unchanged; with the bar off, the floating controls are lifted by the keyboard's overlap so they stay above it.
- **One place to restrict it.** `slidesWithKeyboard` in `TerminalScreen.tsx` (`Platform.OS === 'ios' && !chatModeActive`) decides it for all iPhones; limiting it to the iPhone Duo would change that line only.
- **Verified** by component tests on the real screen (`TerminalScreen.rntl.tsx`, with the helper's `terminalKeyboardSlide.test.ts`): nothing that decides the terminal view's height changes with the keyboard, the offsets above, the animation requests (show spring 1.8 / 580 ms, hide ease-out / 250 ms, one request per keyboard move from the store, none from the terminal hook, nothing for duration 0), the store's visibility model against notifications with start and end frames (both turn directions, both hide orderings, a frame-only hide, a late mount; `keyboardFrame.rntl.tsx`), Reduce Motion, the scroll-to-bottom on appearance (also: not for a frame-only hide's end frame, not while the screen is not focused), Reduce Motion through the real app chrome (`VerticalBarArea`) around the screen, the key bar's lifecycle, the Android path. **Not verified (device only):** the real start/end frames iOS posts on a turn or fold with the keyboard up (the frame-only-hide rule reads them; a start frame in the old orientation's space could misread a legitimate turn as a hide), that the native grid and pty really stay put, smoothness, the clip under the header and in the Duo's band/rail poses, hit-testing of taps, selection handles and scrollback while the view is moved, the caret row's exact top edge on the device (taken from Ghostty's source, not measured), that the scroll-to-bottom lands the cursor row where the offset expects it, and the scrolled-back case with the keyboard already up (the offset follows the active area's cursor row).

### Bar
- **88pt** total height. Background opaque = theme terminal background color. Dark style always. On Android, position the entire bar 3pt above the native visible-window boundary so IME candidate, clipboard, and extended-layout rows cannot cover it; do not compensate with internal bar padding.
- Trailing cluster (spacing 8, trailing inset 12): text-editor toggle above Dismiss-keyboard `keyboard.chevron.compact.down` (default **shown**), preceded by a separator (`separator` α0.4).
- Rows stack: vertical, spacing 6, fillEqually; insets top 7 / bottom 7 / trailing 10 / leading 10 (after separator) or 12.

### Text editor page
- The trailing text-editor button swaps the key grid for a focused multiline composer using the full text keyboard, including emoji, clipboard, composition, and suggestion affordances.
- While the editor is open, the dismiss-keyboard button becomes the editor action. A non-empty buffer shows an up-arrow and inserts the entire buffer into the selected terminal before clearing it. An empty buffer shows the Send glyph and sends the terminal Enter key.
- Return in the software keyboard inserts a newline into the draft instead of sending it.
- Backspace or Delete on an empty draft is forwarded to the terminal, including repeated events while the key is held.
- Switching back to the key grid restores terminal keyboard focus. The terminal is asked for focus (`focusTerminal`, which resolves whether it took it) while the editor still holds it, and the editor is removed only after the answer; the aim is that the keyboard stays up and the key rows come back in place instead of the keyboard hiding and showing again. The component test (`TerminalKeyBar.rntl.tsx`) proves that order: the focus request is made while the editor is still mounted, and the editor closes after the answer. That the keyboard does not hide and show again on the device is not yet verified. A refusal or an error is logged and the key grid comes back anyway; further presses while the hand-over is pending are ignored.

### Two rows, 7 equal columns each (fixed grid, no scroll). Empty slots invisible placeholders. Max 14 items, min 1.

### Default layout (VERBATIM)
- Row 1: `Esc`, `Shift`, `Ctrl-J` (return glyph), `Home`, `↑`, `End`, `PGUP`
- Row 2: `Tab`, `Ctrl`, `Alt`, `←`, `↓`, `→`, `PGDN`

Labels (fixed ASCII): CTRL, ALT, Cmd, SHIFT, ESC, TAB, S-Tab, Enter, Bksp, Del, Ins, HOME, END, PGUP, PGDN; arrows and Ctrl-J use icons; F1..F12; ^C ^D ^Z ^L ^A ^E ^K ^U.

### Button styling
- Pill: height 28, radius 14, 1pt border `separator` α0.3, bg dark `white α0.08`, font system 10 semibold for every text key, color secondaryLabel.
- Modifier: same dimensions and font size as every other text key.
- Icon: symbol 14 semibold, tint label, height 32, width 36, radius 16, bg dark `white α0.12`.
- Buttons fill columns without per-label font shrinking.

### Modifier latching
- Tapping Ctrl/Alt/Cmd/Shift activates it for the next input only. One-shot look: system blue background with white text.
- Long-pressing a modifier for 450ms locks it until the modifier is tapped again. Locked look: purple background, white text, and a brighter border so it is visually distinct from one-shot activation.
- The next non-modifier input clears only one-shot modifiers. Locked modifiers remain applied to accessory keys and software-keyboard input.

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
- Changes **font size in points**, per-session. Range 4.0–32.0, step 1.0. Default: 13pt.
- Ratchet logic: reference scale at began; relativeScale ≥1.12 → +1pt; ≤0.89 → −1pt; reset reference each step. Not continuous.
- Persistence: per-session presentation override, persisted; falls back to global `terminalFontSize`.
- HUD: centered dark-blur card radius 18, min 112×72; value "12 pt" (monospaced 24 semibold white) over "Font Size" (12 medium white α0.72). Fade in 0.12s, auto-hide 0.8s idle (0.45s after gesture end), fade out 0.18s.

## 4. Scrolling

- iOS: NO native scroll view. Single-touch pan → synthetic scroll events into the terminal engine, `translation * 4.0`, precision, reset translation each change.
- Momentum: if |velocity| > 35 → per-frame v = velocity/60 * 4.0 * 0.75, display-link ticks, decay ×0.94/frame, stop at |v| < 0.5, send momentum began/changed/ended.
- New pan/pinch stops momentum. Scroll-to-bottom on output/keypress handled by the engine. No scrollbar, no jump-to-bottom button.
- Android note: Termux TerminalView has its own scroll/fling handling — keep it; pinch-zoom must map to font size changes like iOS.

## 5. File Attach & Send

- Entry: overflow menu "Send & Attach File" (paperclip) + floating Upload control. Enabled only when connected.
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
