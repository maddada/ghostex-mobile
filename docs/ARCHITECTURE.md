# ghostex-mobile Architecture

One React Native (Expo, New Architecture) app for iOS + Android. The UI, session inventory, machine management, and orchestration are shared TypeScript. Only two things are native per platform:

1. **The terminal surface** — iOS: Ghostty `libghostty` (ported wrapper from the VVTerm fork). Android: Termux `terminal-emulator` + `terminal-view` (copied from the Android fork).
2. **The SSH transport** — iOS: libssh2 (ported `SSHClient` subset from VVTerm). Android: SSHJ + BouncyCastle (ported `GhostexSshTransport` from the Android fork).

**Golden rule: PTY bytes never cross the JS bridge.** The SSH shell channel is piped into the terminal engine entirely in native code. JS only orchestrates: connect, run non-interactive commands (`ghostex sessions --json --mobile-summary`), open/close terminals, send discrete keys/text, receive lifecycle events.

## Repo layout

```
mobile/
  App.tsx                     # entry → navigation
  src/
    theme/                    # GhostexPalette tokens (docs/specs/sessions-drawer.md §0)
    contract/                 # mobile-summary TS types + parser + displayStatus()
    machines/                 # machine store (AsyncStorage) + credentials (expo-secure-store)
    inventory/                # inventory client (exec over native ssh), 5s polling, per-machine fan-out
    terminal/                 # tab/session state, warm-session policy (max 7), attach orchestration
    commands/                 # ghostex CLI command builders (login-shell wrapping, quoting)
    components/               # shared UI (action sheets, state cards, chips, key bar)
    screens/
      WelcomeScreen.tsx       # docs/specs/onboarding.md §1
      SessionsScreen.tsx      # docs/specs/sessions-drawer.md
      MachinesScreen.tsx      # docs/specs/sessions-drawer.md §4
      MachineFormScreen.tsx   # onboarding.md §2 (VVTerm form) merged w/ Android editor fields
      TerminalScreen.tsx      # docs/specs/terminal-screen.md
      SettingsScreen.tsx      # minimal v1 (Android defaults)
  modules/ghostex-native/     # Expo local module (autolinked)
    expo-module.config.json
    src/                      # TS bindings: GhostexNative module + GhostexTerminalView
    ios/                      # Swift: GhosttyTerminal port + libssh2 SSHClient + registry
      Vendor/                 # GhosttyKit.xcframework, libssh2 xcframework (copied from iOS fork)
    android/                  # Kotlin glue + Java: termux terminal-emulator/-view + SSHJ transport
  docs/specs/                 # extracted implementation specs (source of truth for UI copy)
  ios/ android/               # expo prebuild output, committed (bare workflow)
```

## Native module contract (`modules/ghostex-native`)

Both platforms implement EXACTLY this API. TS bindings in `modules/ghostex-native/src/index.ts`.

### Concepts

- **machineId** (string): key for one SSH client connection (multiplexed channels). Reconnecting with new config replaces it.
- **sessionKey** (string, JS-chosen, e.g. `${machineId}:${sessionId}` or `${machineId}:tab:${uuid}`): key for one *terminal entry* in the native registry. An entry owns: terminal engine instance + SSH PTY shell channel. Entries survive view unmount (warm sessions); JS enforces the max-7 warm policy by calling `closeTerminal`.
- **GhostexTerminalView**: native view with prop `sessionKey`; mounting attaches the view to the registry entry (rendering + touch + IME input). Unmounting detaches without killing the entry.

### Module functions (all Promises)

```ts
type SshConfig = {
  host: string; port: number; username: string;
  password?: string; privateKey?: string; passphrase?: string;
};
connect(machineId: string, config: SshConfig): Promise<void>;
disconnect(machineId: string): Promise<void>;
isConnected(machineId: string): Promise<boolean>;
// Non-interactive command in a channel; used for inventory + ghostex CLI actions.
exec(machineId: string, command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string; exitCode: number }>;

// PTY terminal lifecycle. command==null → interactive login shell; else run command in PTY.
openTerminal(sessionKey: string, machineId: string, opts: {
  command?: string; termType?: string;      // default "xterm-256color"
  fontSize?: number;                        // initial pt/sp
}): Promise<void>;
closeTerminal(sessionKey: string): Promise<void>;
listTerminals(): Promise<string[]>;

sendText(sessionKey: string, text: string): Promise<void>;   // paste/insert (no newline added)
sendKey(sessionKey: string, key: TerminalKey, mods?: { ctrl?: boolean; alt?: boolean; shift?: boolean; cmd?: boolean }): Promise<void>;
setFontSize(sessionKey: string, size: number): Promise<void>;
scrollToBottom(sessionKey: string): Promise<void>;

uploadFile(machineId: string, localPath: string, remotePath: string): Promise<void>; // SFTP, 0600
generateSshKey(type: 'ed25519' | 'rsa4096', comment: string, passphrase?: string):
  Promise<{ privateKey: string; publicKey: string; fingerprint: string }>;
resetHostKey(host: string, port: number): Promise<void>;
```

`TerminalKey`: `'escape'|'tab'|'enter'|'backspace'|'delete'|'insert'|'home'|'end'|'pageUp'|'pageDown'|'up'|'down'|'left'|'right'|'f1'..'f12'` or a single character (e.g. `'c'` with `{ctrl:true}` → ^C).

### Events (module-level subscriptions)

```ts
onTerminalState: { sessionKey: string; state: 'opening'|'open'|'closed'|'failed'; error?: string; errorCode?: GhostexErrorCode };
onTerminalTitle: { sessionKey: string; title: string };     // OSC title
onTerminalBell:  { sessionKey: string };
onFontSizeChange:{ sessionKey: string; fontSize: number };  // from native pinch-to-zoom
onConnectionState: { machineId: string; state: 'connecting'|'connected'|'disconnected'|'failed'; error?: string; errorCode?: GhostexErrorCode };
```

### Error codes (rejections carry `code`)

`E_AUTH_FAILED` · `E_HOST_KEY_MISMATCH` · `E_UNREACHABLE` · `E_REFUSED` · `E_TIMEOUT` · `E_NOT_CONNECTED` · `E_CHANNEL_FAILED` · `E_SFTP_FAILED`. JS maps these to the human copy in `docs/specs/sessions-drawer.md` §5.

### View

```tsx
<GhostexTerminalView
  sessionKey={key}
  style={...}
  onSingleTap={() => ...}   // optional: show keyboard
/>
```

Native view responsibilities (per platform, matching current apps):
- Rendering + scrollback scrolling (iOS: synthetic wheel events w/ momentum per spec §4; Android: Termux TerminalView built-ins).
- IME/soft-keyboard text input directly into the engine (view is the text-input responder).
- Pinch-to-zoom → font size ratchet (±1pt at 1.12/0.89 thresholds) + native HUD ("N pt" / "Font Size") per spec §3, then emit `onFontSizeChange` for JS persistence. Range 4–32, default iPhone 9 / iPad 12 / Android: Termux font size default.
- Touch text selection (both platforms keep their existing native implementations).
- Scroll-to-bottom on output/keypress (engine behavior; respect autoScroll setting via prop later).

### Keyboard accessory ("2 rows of keys")

Rendered in **RN** (shared component `components/TerminalKeyBar.tsx`), pinned above the keyboard via keyboard-height tracking (not a UIKit inputAccessoryView — keeps it cross-platform). Discrete keys go through `sendKey` (low rate, bridge OK). Layout/behavior per `docs/specs/terminal-screen.md` §2: 2×7 grid, default rows [Esc, Shift, NEWLN(Ctrl-J), Home, ↑, End, PGUP] / [Tab, Ctrl, Alt, ←, ↓, →, PGDN], one-shot modifier latching, repeat-on-hold (350ms then 50ms) for arrows/backspace/home/end/page keys, height 88, theme background.

## Ghostex CLI contract

Same as both existing apps — JSON over SSH, no gxserver wire protocol:
- Inventory: `"$SHELL" -lc 'ghostex sessions --json --mobile-summary'` (5s poll while sessions screen visible; scan stdout for first JSON object containing `sessions`; keep provider=="zmx" only).
- Attach: `openTerminal` with the `ghostex attach --session-id …` command wrapped in a login shell; after first render send `\x1b]1337;ZMX_REFRESH\x07` once (~2s).
- Actions: `create-session`, `create-agent`, `create-chat`, `run-action`, `move-project`, `restore-recent-project`, `rename-session`, wake/sleep/kill/focus via `ghostex` CLI; machine health: `ghostex android-check --json` (works for any mobile client).
- Quoting: single-quote with `'"'"'` escaping; login-shell wrapper `"$SHELL" -lc '<cmd>'`.

## Defaults (from the Android app)

autoScroll=true · doneNotificationSound=true · refreshButton/fileUploadButton/keyboardButton visible=true · hideKeyboardOnStartup=true · terminal dark-only theme, background `#000000` fallback ("Aizen Dark" port later).

## Licensing

GPL-3.0 (inherits from Termux-derived Java and VVTerm-derived Swift/spec).
