# Ghostex iOS — First-Machine Onboarding Flow Spec (for React Native reimplementation)

Extracted from `/Users/madda/dev/_active/Ghostex/iOS` (VVTerm fork). User-facing copy says "Ghostex". All copy quoted verbatim.

## 0. Fresh-install sequence

1. Launch → Welcome sheet shows while `hasSeenWelcome == false`.
2. Continue → main UI: server list titled **"Servers"**.
3. Zero servers → empty state "No Servers / Add a server to get started" (a default workspace "My Servers" is auto-bootstrapped so the workspace variant rarely shows).
4. **Add Server** (empty-state button or toolbar `+`) → Add Server form sheet.
5. Save persists machine + credentials (secure storage), closes sheet, row appears.
6. Tap row → connect → terminal screen.
7. Optional: local discovery prefills the form. SSH keygen/import + copy-public-key helpers.

RN v1 scope: welcome → add first machine → sessions list → terminal. (Files/Stats tabs, workspaces, Pro gating, iCloud sync, voice = out of scope.)

## 1. Welcome screen

Single scrollable page, sheet presentation. Layout top→bottom:
1. Top spacer 24.
2. App icon 108×108, rounded rect radius 26 continuous, shadow black 0.2/r8/y4.
3. Headline **"Welcome to Ghostex"** — title, bold, centered, top pad 18.
4. Subheadline **"Your secure SSH terminal"** — subheadline, secondary, centered, pads top 6 / H28 / bottom 24.
5. Feature list, VStack leading spacing 20, H pad 24: rows = HStack(16): 46×46 rounded-12 color badge with white SF symbol (size 20 medium), then title (headline) over description (subheadline secondary), spacing 4.
6. Pinned **Continue** button: headline white text, full width, height 50, radius 12, accent fill; container pads H24/bottom 24/top 8.

Feature catalog (icon / color / title / description), in order:
1. `terminal.fill` / blue / **SSH Terminal** / "Connect to servers with GPU-accelerated terminal emulation."
2. `folder.fill` / indigo / **SFTP Files** / "Browse folders, preview files, and move things around on your server."
3. `chart.xyaxis.line` / mint / **Server Stats** / "Keep an eye on CPU, memory, disk, and network activity at a glance."
4. `macbook.and.iphone` / blue / **Available on Mac** / "Ghostex is available on iPhone, iPad, and Mac with the same app identity."
5. `icloud.fill` / cyan / **iCloud Sync** / "Server metadata syncs with iCloud across your devices."
6. `clock.arrow.circlepath` / teal / **Session Persistence** / "Keep sessions alive with tmux, even after disconnects."
7. `key.fill` / green / **Secure Storage** / "Passwords and SSH keys protected by Keychain."
8. `waveform` / orange / **Voice Commands** / "Speak commands with on-device speech recognition."

RN note: trim/adapt features to what the RN app actually ships (e.g. drop iCloud/Voice rows or keep as roadmap copy — implementer choice, but keep visual structure). One button only, no skip/paywall. On Continue: persist `hasSeenWelcome = true`.

## 2. Add-machine form

Empty state (server list): icon `server.rack` 48 tertiary; **"No Servers"** headline semibold; "Add a server to get started" subheadline secondary; primary button **"Add Server"** with `plus.circle.fill` (tint bg, white text, radius 8); secondary **"Discover Local Devices"** with `dot.radiowaves.left.and.right` (primary 0.08 bg).

Sheet: grouped form, nav title **"Add Server"** (edit: "Edit Server"), leading **Cancel**, trailing **Add**/**Save** (spinner while saving, disabled per rules below). Interactive dismiss disabled while saving.

Defaults: name "", host "", port "22", username "", transport standard SSH, auth password, tmux off.

Sections in order:

**Server** (header "Server"):
1. Name — placeholder "My Server".
2. Host — placeholder "203.0.113.10" (URL keyboard, no autocorrect/caps) + Port — placeholder "22" (number pad, trailing aligned, width 76) on one row.
3. Username — placeholder "root" (no autocorrect/caps).
4. Button "Pick from Local Discovery..." with `dot.radiowaves.left.and.right`.

**Authentication** (header "Authentication"):
1. Transport picker: SSH (`terminal`), Tailscale (`network`), Mosh (`antenna.radiowaves.left.and.right`), Cloudflare (`shield.lefthalf.filled`). RN v1: SSH (+ Tailscale note: tailscale = plain SSH over tailnet IP, no creds section: caption "Uses server-side Tailscale SSH policy. No password or SSH key is required."). Mosh/Cloudflare out of v1 scope.
2. Method picker: **Password** (`key.fill`), **SSH Key** (`lock.doc.fill`), **SSH Key + Passphrase** (`lock.shield.fill`).
   - Password: SecureField "Password", placeholder "Required".
   - SSH Key: stored-key picker ("Select a key..." + named keys) + button "Add to Keychain" (opens key import/generate).
   - +Passphrase: adds SecureField "Key Passphrase" placeholder "Optional" (but validation requires non-empty for this method).

**Connection** (header "Connection"):
- Button "Test Connection" (bordered), disabled unless valid; while testing: spinner + "Testing...".
- Success footer: green check "Connection successful". Failure: red caption error. Any edit to connection-affecting fields resets test state. Test optional — Save doesn't require it.

**Session** (header "Session", footer "Sessions stay alive across app restarts and disconnects when tmux is available."):
- Toggle "Use tmux to preserve sessions" (default OFF). (v1: can hide; ghostex/zmx own persistence.)

**Security** (header "Security"): biometric unlock toggle "Require Face ID to open this server" (v1 optional).

**Notes** (header "Notes"): multiline notes.

Validation: name non-empty AND host non-empty AND port parses int AND credentials valid (password non-empty | key non-empty | key+passphrase both non-empty). Username blank → defaults to "root" on save. Port fallback 22.

Save: persist machine record + credentials in secure storage (keys namespaced per machine id: password / sshkey / passphrase / publickey), close sheet, show row. Does NOT auto-connect.

Server row: `server.rack` icon, name, address, chevron; swipe Edit / Remove; context menu Connect/Edit. Tap → connect and push terminal screen; while connecting show connecting state with machine name.

## 3. Ghostex specifics

- NO ghostex-CLI install/detection wizard exists. Sessions UI just runs `"$SHELL" -lc 'ghostex sessions --json --mobile-summary'` over SSH; if the CLI is missing, the raw error surfaces in the sessions screen error state.
- Zero-machines copy for sessions screen: "No Servers" / "Add a Ghostex server for the Mac that runs the Ghostex CLI."
- Loading: spinner + "Loading sessions". Filter placeholder: "Filter sessions". Error alert title "Ghostex", OK.
- Polling: refresh loop every 15s (60s when a load takes ≥10s); per-machine fan-out; fingerprint skip when unchanged; pull-to-refresh.
- Pending creation overlay: full-screen dim black 0.35 + centered material card radius 14 with white spinner + bold white label ("Creating terminal…", "Starting <agent>…", "Running <action>…"). Creation switches to terminal tab immediately; on failure returns to sessions with error.
- Attach commands (built server-side by CLI): `ghostex attach --session-id …`; login-shell wrapper: `"$SHELL" -lc '<single-quoted cmd>'` with `'"'"'` escaping.

## 4. Local discovery (v1: nice-to-have)

Sheet "Discover Local Devices": Bonjour + port-22 scan; sections "Nearby SSH Hosts" (rows: `server.rack`, name, host:port, source chips Bonjour/Port Scan, latency "Nms"), "Scanning Status", help footer "Discovery only prefills host details. Credentials are still configured in Add Server." Tapping a host prefills name/host/port only.

## 5. SSH keys

- Types: **Ed25519** ("Modern, fast, and secure. Recommended for most uses.") and **RSA 4096** ("Wide compatibility with older systems.").
- Generate sheet: "Generate SSH Key" — Key Name (placeholder "e.g., Personal MacBook, Work Key"), Algorithm segmented picker, optional passphrase + confirm ("Protect your key with a passphrase. Leave empty for no protection."). Comment = name with spaces→underscores.
- Import sheet: "Add SSH Key" — name, Add Private Key menu ("Import Key File" / "Paste"), "Key loaded" green check, optional passphrase ("If your key is encrypted with a passphrase, enter it here...").
- Key details: public key monospaced selectable + "Copy to Clipboard"→"Copied" button; footer "Add this to your server's ~/.ssh/authorized_keys file:". Manual install only (no ssh-copy-id automation).
- Fingerprint: `SHA256:` + base64(SHA256(wire pubkey)), `=` stripped.
- Native side: iOS generates via CryptoKit/SecKey (port exists in VVTerm `Core/SSH/SSHKeyGenerator.swift`); Android can use BouncyCastle. Or generate in native module with a common API `generateKey(type, comment, passphrase?) -> {privateKey, publicKey, fingerprint}`.

## Persistence keys (RN)

- `hasSeenWelcome`: boolean.
- Machines list: persisted store (id, name, host, port, username, transport, authMethod, notes, createdAt).
- Credentials: secure storage, per machine id: password / privateKey / passphrase / publicKey.
- Defaults from Android app: autoScroll=true, doneNotificationSound=true, refreshButton/fileUploadButton/keyboardButton visible=true, hideKeyboardOnStartup=true.
