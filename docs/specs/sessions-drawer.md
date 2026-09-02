# Ghostex Android Sessions Drawer — Implementation Spec (for React Native reimplementation)

Extracted from `/Users/madda/dev/_active/Ghostex/android` (Termux fork). This is the sessions list UI to rebuild in RN for BOTH platforms.

## 0. Design tokens (GhostexPalette)

| Token            | Hex                     | Usage                                                            |
| ---------------- | ----------------------- | ---------------------------------------------------------------- |
| BACKGROUND       | `#181818`               | drawer + dialog surface; pill chip fill                          |
| FOREGROUND       | `#FAFAFA`               | primary text, icons                                              |
| MUTED            | `#B5B5B5`               | secondary text, headers, empty rows                              |
| BORDER           | `#33FFFFFF` (white 20%) | 1dp strokes on cards/pills                                       |
| CARD             | `#1F1F1F`               | session row bg (inactive)                                        |
| CARD_ACTIVE      | `#262626`               | active row fill, state cards, buttons                            |
| INPUT_BACKGROUND | `#0E0E0E`               | inputs                                                           |
| BUTTON (accent)  | `#7DD3FC`               | active-row stroke, focused dot, primary buttons (text `#181818`) |
| DANGER           | `#E85C5C`               | destructive labels                                               |
| STATUS_ATTENTION | `#95D7F6`               | attention + done dot (blue, NOT green)                           |
| STATUS_WORKING   | `#F59E0B`               | working dot (amber)                                              |
| STATUS_SLEEPING  | `#6E7684`               | sleep icon tint                                                  |

Radius: cards/rows/inputs 8dp; pills/chips fully rounded. Strokes 1dp BORDER (active row: BUTTON).

## 1. Drawer structure

Width 336dp (RN: use as drawer width on tablets/side panel; can be full-screen page on phones), bg `#181818`, padding 12. Three pages toggled: **Sessions** (default), **Machines**, **Settings**.

### Sessions page

1. Header row: Android Exit (48×48 icon btn, bg #262626) | Title "Ghostex" (18sp bold, weight 1) | Refresh | Machines | Settings — 8dp gaps. Refresh = full reconnect. Android Exit = quit app; iOS omits it because iOS apps do not expose a quit action.
2. Status row: 12sp muted, marginTop 4. Initial: "Connect to a ZMX machine". The tappable Tailscale indicator is green while connected and red while disconnected.
3. The top-right More options menu includes "Recent Projects" when the selected machine has recent projects.
4. Session list: flat list, 10dp transparent gaps between top-level project
   cards and collection panels, marginTop 12.

On Android, Back from a terminal shows Sessions and Back from Sessions returns to the selected warm terminal. Back is consumed when no terminal is open, so the explicit top-left Exit control is the only app-exit path.

### Machines page

Header "Machines" + "Sessions" back button. Status line. Machine cards list. Footer rows: [Retry (accent #7DD3FC/#181818 text) | Add] and [Tailscale | Setup].

### Settings page

Header "Settings" + back. Status "Edit chat, terminal behavior, and remote-session alerts." Theming starts with GPUI-parity Background Contrast (85–100, default 90) and Background Tint: the same calibrated preset swatches plus a custom `#RRGGBB` field. These settings recolor the drawer backing and its derived group, project, border, header-button, and session surfaces while leaving menus and Settings surfaces untinted. Chat settings select light/dark chat appearance, an installed font family, and message width from 50–100% in 5% steps (default 100%); width affects only transcript messages, with a 40px minimum side margin on viewports 500px and wider and 20px below 500px. Toggles: Auto scroll, Extra keys toolbar, Soft keyboard, Keep screen on, Show refresh/upload/keyboard button, Attention notification sound, Fullscreen, Hide keyboard on startup, Open URLs on tap, Confirm before closing tabs, Disable session change toasts; font size. Tab-close confirmation defaults to off. The file-upload floating button defaults on; the refresh and keyboard floating buttons default off.

## 2. Row types

Flat list items: STATE_CARD, MACHINE_HEADER, PROJECT_HEADER, PROJECT_AGENTS_ROW, PROJECT_EMPTY, GROUP_HEADER, PROJECT_SESSION_LIST_TOGGLE, SESSION. Collapsed session list shows 6 (`PROJECT_SESSION_LIST_COLLAPSED_COUNT = 6`).

### SESSION row

Horizontal, padding 10/9/10/9, minHeight 44, radius 8, bg CARD + 1 BORDER; active: CARD_ACTIVE + 1 BUTTON stroke.

- Agent icon 18×18, marginEnd 10, tinted.
- Title: weight 1, #FAFAFA 14sp bold, 1 line ellipsize. displayTitle or "Ghostex Session".
- Status dot 8×8 circle marginStart 10 — OR sleeping icon 16×16 (ic sleep, tinted STATUS_SLEEPING) when sleeping (mutually exclusive).

Status colors: working→#F59E0B; attention→#95D7F6; sleep→#6E7684; else focused→#7DD3FC; else idle→#B5B5B5.
Active row = warm-attached session key (machineId+sessionId) matches current terminal.
Tap → attach. Long-press → context menu.

### Agent icon registry (icon id → tint; assets `ic_ghostex_agent_*` exist in android fork, copy to RN assets)

amp-cli #FFFFFF · antigravity-cli #749BFF · browser #82B7FF · claude #D97757 · cursor-cli #EDECEC · codex #FFFFFF · copilot #FFFFFF · factory-droid #FF7A1A · gemini #8B9AFF · grok-build #FFFFFF · hermes-agent #F3C46B · opencode #6D96C0 · pi #C8FF62 · terminal #FAFAFA (fallback).
Name aliases (lowercased): codex/codex cli→codex; claude/claude code→claude; cursor/cursor cli/cursor agent/cursor-agent→cursor-cli; pi/pi agent/π→pi; opencode/open code→opencode; gemini; copilot/github copilot; droid/factory droid→factory-droid; grok/grok build→grok-build; antigravity/antigravity cli/agy→antigravity-cli; amp/amp cli→amp-cli; hermes/hermes agent→hermes-agent; browser. `agentIcon` field wins over `agent` name.

### Session context menu (action sheet)

Title = displayTitle or "Ghostex Session"; subtitle "Session {alias} · {displayStatus}". Rows:

1. Attach — "Open this ZMX session in the terminal."
2. Focus on Mac — "Focus this session in the running Ghostex app."
3. Rename — "Update this session title in Ghostex." → prompt: title "Rename session", body "This updates the session title in Ghostex on the connected Mac.", input hint "Session title" (prefill raw title), Cancel/Rename; empty → "Enter a session title."
4. Wake — "Resume this persistent Ghostex session on the Mac."
5. Sleep — "Leave the session persistent but idle on the Mac."
6. Close Session (destructive) — confirm: "Close session?" / "This closes the selected Ghostex session on the connected machine." / target "{alias} · {title}" / "Close Session". The row is removed optimistically and restored if the remote close fails.
7. Copy attach command — "Copy the SSH command for this session." (toast "Attach command copied")
8. Refresh sessions — "Reload the ZMX session list from the Mac."
9. Details — Machine, Project, Project path, Status, Focused on Mac, Last active, Provider "zmx", ZMX session, Agent, Session id ("-" for blanks). Subtitle "Remote session metadata from the Ghostex CLI."

Session rename, pin/tag changes, sleep/wake, project ordering, project-group
membership/title/color/deletion, and single or bulk session closes update the
drawer optimistically. Pending changes are rebased over inventory polling,
serialized per affected resource, and rolled back individually on command
failure. A successful command remains optimistic only while the server
inventory converges; repeated authoritative disagreement restores server truth.

### Recency: <60s "{n}s ago" (min 1); <60m "{n}m ago"; <48h "{n}h ago"; else "{n}d ago"; unknown → "Unknown" (details only; rows are title-only single line).

### MACHINE_HEADER (only when ≥2 machines): muted 12sp bold ALL-CAPS letterSpacing 0.06, padding 8/18/8/4, minHeight 36; " …" suffix when collapsed; tap toggles machine section collapse.

### PROJECT_HEADER

Padding 6/14/6/6, minHeight 52. Title 15sp bold #FAFAFA weight 1. "+" button 32×32 pill (bg #181818, stroke BORDER) — create session, cd "Create a session in {title}". Overflow ⋮ 32×32 pill (hidden for Chats) — project menu. Row tap toggles expand/collapse. No session-count pill.

### PROJECT_AGENTS_ROW ("agents isle")

Horizontal scroll chips under project header (not for Chats; needs stable projectId; only if agents or quickActions exist). Global agent chips first, then project quick actions. Chip: pill, padding 10/6/10/6, minHeight 32, optional 15×15 icon + label 12sp #FAFAFA. Agent chip → create agent session. Quick action: browser type opens URL on device; terminal type runs `ghostex run-action '<commandId>' --project-id '<projectId>'` then attach.

### PROJECT_EMPTY: muted 12sp, "No sessions yet. Tap + to create one."

### GROUP_HEADER: muted 13sp bold, padding 14/10/12/4; "{title}" or "{title} ({count})" collapsed; tap toggles (in-memory).

### TOGGLE: muted 13sp "Show more"/"Show less" (>6 sessions in flat project).

### STATE_CARD: padding 12, minHeight 104, radius 8, bg #262626 + BORDER. Title 15sp bold; body 12sp muted marginTop 6; action hint 12sp bold #7DD3FC marginTop 10. Tap → recovery actions sheet.

## 3. Grouping & ordering

- Project key: `id:` → `path:` → `name:` → `session:` fallback. Chat projects merge into synthetic "chats" key titled "Chats", ordered first.
- Project order: chats → workspaceGroups.projectOrder ids → remaining projects array order → leftovers.
- preserveSessionOrder when workspaceGroups present OR any sortOrder present; else sort: browser-kind first → pinned (saved order) → attention(2)>working(1)>idle(0) → most recent lastInteractionAt → stable.
- Per project: HEADER → (collapsed? stop) → AGENTS_ROW → (empty? PROJECT_EMPTY) → grouped (ungrouped "main" sessions first, then GROUP_HEADER + members per group in sessionIds order, skip empty groups) or flat (6 + Show more).
- Collapse persistence: project + session-list collapse persisted per machine; group + machine collapse in-memory.
- Recent Projects modal: title "Recent Projects", subtitle "Choose a parked project to restore to the active sidebar.", rows title + "{path} · {n session(s)}", tap → `ghostex restore-recent-project --project-id '<id>' --json`; status "Restoring {title}..." → "Restored {title}."

### Project context menu

Title projectTitle, subtitle "{n} ZMX session(s)". Move project up/down (edge-gated) → `ghostex move-project --json --project-id '<id>' --direction 'up|down'`; Refresh sessions; Wake/Sleep project sessions; Kill project sessions (destructive; confirm "Kill project sessions?" / "This stops {n} Ghostex sessions in this project on the connected machine."); Copy project path; Details (Path, Sessions, Working, Attention, Sleeping; subtitle "Project summary from the remote sidebar list.").

## 4. Machines

Machine model: id (UUID), name, host, username, port, savePassword, lastConnectedAt. Persisted list; duplicates by (host,user,port) rejected. displayLabel = name or `user@host[:port]`.

Machines page: empty card "No SSH machines yet" / "Add the Mac or workstation that runs Ghostex, Tailscale, SSH, and ZMX sessions." + Add/Setup pills. Machine card: label (+" · Selected"), target, "Never connected"/"Last connected {n}{unit} ago", "Tap this card to switch to this machine." Pills: Edit, Remove, Password, More.

Editor dialog: title "Add a Mac or workstation" / "Edit SSH machine"; body "Ghostex Android connects over Tailscale SSH, then runs the Ghostex CLI on this machine to list and attach ZMX sessions." Connection card: Display name, Tailscale host or IP, SSH username, SSH port (default "22"). Password card: body "Leave the password empty to use SSH keys or Tailscale SSH. If entered without saving, it stays only in memory for this app run."; checkbox "Save password securely on this device"; field hint "SSH password (optional)" / "SSH password (leave blank to keep saved password)". Validation: port 1–65535 → "Use a port from 1 to 65535."; dup → "This SSH target is already saved."; save-checked w/o password → "Enter a password or uncheck Save password."; global "Fix the highlighted machine details."

Machine actions sheet: Connect / Check connection ("Verify SSH reachability, credentials, Ghostex CLI, and zmx." → `ghostex android-check --json`) / Enter password / Edit / Details / Copy SSH target / Forget saved password (destructive, confirm "Forget saved password?") / Reset SSH host key (destructive, confirm "Reset SSH host key?" / "This removes only this phone's saved SSH host key for the selected machine...") / Delete (confirm "Delete SSH machine?" / "This removes the machine from Ghostex Android on this device. Remote Ghostex sessions on the Mac are not changed.") / Open Tailscale.

Passwords: saved → secure store (Keystore/Keychain via expo-secure-store or native), keyed by machine id; unsaved → in-memory only. Prompt copy: "Saved passwords use Android Keystore. Unchecked passwords are used only until Ghostex Android is closed." Empty → "Enter the SSH password."

Recovery matching: message contains "SSH needs a key or password" or "SSH rejected" → password prompt; contains "SSH host key verification failed" → host-key reset prompt.

## 5. Refresh, polling, states

- List command: `ghostex sessions --json --mobile-summary` via `"$SHELL" -lc '...'`. Scan stdout for first JSON object containing `sessions` (tolerate banners). Keep only provider zmx.
- Poll every **5s** while sessions page visible + machine selected. Multi-machine: other machines refresh concurrently. No pull-to-refresh (header Refresh = full reconnect). (RN: pull-to-refresh optional addition.)
- State copy (STATE_CARD title / body / action hint):
  - No machines: "Add your Mac" / "Add the macOS machine that runs Ghostex, Tailscale, SSH, and ZMX sessions." / "Open Machines, then tap Add, or open Tutorial from Machines." Status: "Add a machine to connect to Ghostex over Tailscale."
  - Connecting: "Connecting" / "Opening SSH to {label} and asking the Ghostex CLI for ZMX-backed sessions." / "Keep Tailscale online on both devices." Status "Connecting to {label}..."; refreshing over list: "Refreshing sessions on {label}...".
  - Failure: "Connection needs attention" / error or "Could not connect to the selected machine." / "Use Retry, Tailscale, Setup, or switch machines above." While list visible: status "Session refresh failed: {message}" (list preserved).
  - Empty: "No ZMX sessions yet" / "The machine is reachable, but the Ghostex CLI did not return any ZMX-backed sessions." / "Start or resume sessions in Ghostex on the remote machine, then tap Retry."
  - Success status: "Connected to {label}" or "Connected. Active projects have no ZMX-backed sessions."
- Recovery sheet rows: Retry connection / Open Tailscale / Setup / Add SSH machine / Manage machines / Tutorial.
- Failure copy map: permission denied w/ password → "SSH rejected the saved password. Update the saved machine password or choose another machine."; w/o → "SSH needs a key or password. Open the machine settings and save a password, or configure SSH keys/Tailscale SSH."; refused → "The machine is reachable, but SSH refused the connection. Enable Remote Login on the Mac and confirm the saved SSH port."; unreachable → "Could not reach the machine. Open Tailscale and confirm both devices are online."; no CLI → "Connected over SSH, but the Mac could not find the Ghostex CLI. Install Ghostex CLI and make sure ghostex is available in the SSH login shell."; old CLI → "Connected over SSH, but this Mac has an older Ghostex CLI. Update Ghostex so ghostex android-check --json is available."; persistence not zmx → "Ghostex is reachable, but Session persistence is not set to zmx. Open Ghostex Settings on the Mac and set Session persistence to zmx."; zmx missing → "Ghostex is reachable, but ZMX is not available on the Mac. Install zmx and set Ghostex session persistence to zmx."; host key → "SSH host key verification failed. Open Setup and reset this phone's saved host key for the machine, or confirm you are connecting to the right Mac."; truncate 220 chars + "...".
- Warm sessions: keep up to **7** attached terminals alive keyed machine+session; kill/sleep close warm surface; wake/focus/rename/refresh preserve. Attach status: "Preparing SSH attach for {alias}..." → "Attached to {alias} on {label}...". After attach + first render, send zmx viewport refresh OSC `\x1b]1337;ZMX_REFRESH\x07` once (~2s after visible).

## 6. Creation flows

All: close drawer → progress dialog (spinner + message) → run command → refresh inventory → auto-attach created session (`{ok:true, session:{sessionId}}`). Failure: dismiss, error, reopen drawer.

- Project "+": `ghostex create-session --json [--project-id '<id>'] [--group-id '<id>']` — "Creating a terminal in {project}…". Chats "+": `ghostex create-chat --json` — "Creating a Quick session…".
- Agent chip: `ghostex create-agent '<agentId>' --project-id '<projectId>' --json` — "Starting {agent} in {project}…". No stable projectId → "This project has no stable project id, so agent sessions cannot be started here."
- Quick action: terminal → `ghostex run-action '<commandId>' --project-id '<projectId>'`; browser → open URL on device, status "Opened {name} in the browser."

## 7. mobile-summary contract (build TS types from this)

Root: `{ sessions: Session[], projects?, recentProjects?, agents?, quickActionsByProject? (Record<projectId, QuickAction[]>), workspaceGroups? { projectOrder?: string[], projects?: Record<projectId, {groups?: {groupId, title?, sessionIds?}[]}> } }`.

Project: `{projectId (req), name?, path?, isChat?}`. RecentProject: `{projectId, title?, path?, sessionCount?}`. AgentLauncher: `{agentId (req), icon?, name?}`. QuickAction: `{actionType ("browser"|"terminal"), commandId?, url?, icon?, name?}`.

Session (sessionId required; provider must normalize to "zmx"): alias (derives from first 4 chars of id), projectId|groupId, title|primaryTitle|terminalTitle, displayTitle, displayTitleTooltip, projectName|groupTitle, projectPath, activity|activityState|activityStatus, status|lifecycleState, provider|sessionPersistenceProvider, providerSessionName|sessionPersistenceName, agent, agentIcon, agentName, globalRef, kind, surface ("browser" sorts first), lastInteractionAt, lastActiveAt, titleSource, trustedResumeTitle, updatedAt, zmxName, nativePaneState, providerSessionState, sortOrder?, isFocused, isFavorite, isPinned, isSleeping, isLive, isPrimaryTitleTerminalTitle, isTemporaryTitle, visibleInSidebarByDefault, shouldSubmitStagedFirstPromptTitleCommand, attention?{enteredAt, acknowledged}, actions?{acknowledgeAttention, attach, focus, kill, readText, sendMessage, sendText, sleep, wake}.

displayStatus(): sleeping&&!live → "sleep"; else first actionable (attention|working|done|error) from normalized activity then status; else !live && sleepish → "sleep"; else first non-empty non-"running" activity/status; else "idle". Normalize: needs-attention/attention-required→attention; active/busy/processing→working; sleeping→sleep; `_`/space→`-`; lowercase.

## 8. Notifications (later milestone)

Foreground service (Android) with custom rows: bold title + muted project + status dot; sorted done→working→running; summary "{n} remote terminal(s)"; sound on transition into attention/done (setting-gated). iOS: no direct equivalent in v1.

## 9. Desktop gpui-sidebar parity amendment (2026-07-22)

The drawer was reworked to match the macOS gpui sidebar's CURRENT skin (the
`hierarchy-panels.css` "layered panels" reference layout, which overrides the
older groups.css look); where this section conflicts with §§0-7, it wins.
Second pass on 2026-07-22 replaced the agent/action chips with header menus
and recloned every surface from the live CSS cascade.

- **Structure**: "Quick" section label → chat sessions as bare rows →
  "Projects" section label → colored collection PANELS (tinted bg mix(color
  5%, mix(bg 96%, black 4%)), border mix(color 28%, mix(fg 14%, bg)), radius
  5; the fg-14% base keeps a visible outline for the transparent color)
  containing member project CARDS → ungrouped project cards (translucent bg
  fg-4.5%, 1dp translucent border fg-13%, radius 5). This is the current gpui
  hierarchy: darker group panels with lighter project cards. No colored left
  rail, no uppercase titles, no folder icons. Section labels are 15.5dp
  weight-300 at fg-52% with a filled caret; both sections persist collapse per
  machine (`collapsedSections` in `drawer.disclosure.v2`, default expanded).
  Top-level groups and projects always have a 10dp gap. Collapsed groups use
  the same translucent fg-4.5% background as collapsed ungrouped projects.
- **Headers**: collection + project headers are flat 30dp rows with 13dp
  weight-300 titles (mix(fg 92%, white 8%)). Collapsed headers show the count
  pills (working #F8AD07 dot+count, attention #95D7F6 dot+count, awake
  #D8D8D8 count WITHOUT dot, weight 300). Expanded project headers show the
  desktop button cluster (22×22, radius 6, card fill, blue-tinted icons):
  optional Show-less chevron, Actions menu button (only when the project has
  quick actions), Create Terminal, and the 24+17 agent split-button (primary
  agent icon + ▾). Long-press on the header opens the project menu (desktop
  right-click equivalent).
- **Menus** (`ContextMenu`, cloned from `.session-context-menu`): 220dp dark
  popup (#222222, 1dp border, radius 0, 6dp padding, 2dp row gap) aligned
  horizontally to the pressed row and fixed to the full safe viewport height.
  Its vertical frame never depends on space remaining below the anchor, so
  menus opened near the bottom cannot collapse into a short strip. Every
  actionable row has a 14dp leading glyph or semantic color swatch; the shared
  item type requires this, including Back, Details, ordering, and
  expand/collapse rows. The agent menu lists `summary.agents`
  with brand-tinted icons and a check on the selected primary agent; selecting
  launches the agent AND persists it globally (`drawer.launcher.v1`,
  mirroring the desktop's ghostex-sidebar-project-terminal-launcher). The
  actions menu lists the project's quick actions with a check on the last-run
  action (persisted per machine+project). The old PROJECT_AGENTS_ROW chip row
  is gone.
- **Session rows**: 34dp flat rows, radius 4 fills, title 15.5dp weight-300
  #B4B8C0 (active #D8D8D8; sleeping dims ONLY the title to #5F646B at 0.42),
  with the gpui surface chain driven by warm terminal state: unsurfaced rows
  are transparent until pressed (90% resolved sidebar background / 10% black);
  surfaced rows start with 30% foreground over their expanded-group background
  (including collection tint); active rows mix that base 10% toward black,
  while surfaced-but-inactive rows mix the same base 40% toward black,
  leading icon absolute at 5dp (in-card) / 26dp (Quick) with 48% opacity
  (80% active; 13dp agent masks, 15dp terminal/browser glyphs), relative
  time 13.5dp #4F5359 right-aligned (hidden while working/attention), and a
  flat 7dp right-edge dot matching desktop .session-status-dot activity
  colors (2026-07-22 amendment): working #FFB454 with the desktop 1.35s
  pulse (opacity .78/scale .92 ↔ full), attention/done #95D7F6, error
  #FF6B6B, grey for remote sleeping, nothing for idle. Same displayStatus
  as the collapsed project/group count pills. Pinned rows show a mirrored
  13dp pin at 50% opacity.
  "Show more" renders as a session-styled "Show N more" row; "Show less" is
  the header chevron button. Empty projects render the dashed "No sessions"
  38dp box; empty Quick renders bare "No Quick Sessions" (#444444).
- **Ordering** (unchanged): browser-kind first → pinned in saved order →
  attention > working > idle → newest lastInteractionAt → stable wire order;
  the CLI forwards isPinned/isFavorite/kind/surface/agentName.
- **First-start disclosure** (unchanged): EXPANDED sets in
  `drawer.disclosure.v2`; everything starts collapsed except the two section
  labels.

### §9.1 Context-menu parity (2026-07-22, second amendment)

Every drawer surface opens a desktop-parity `ContextMenu` via LONG-PRESS on
the row (the mobile stand-in for desktop right-click; the earlier ⋮
GhostMenuButton triggers were removed 2026-07-22, third amendment — the menu
anchors to the long-pressed row):

- **Session** (long-press): Rename, Pin/Unpin (`pin-session`), Tag as ›
  (grouped Priority/Progress/Type radio submenu with the desktop tag tints,
  check on `session.sessionTag`, tap-again clears → `tag-session`),
  Sleep/Wake · Attach, Copy attach command, Delayed Send (modal mirroring the
  desktop Hours/Minutes dialog → `delayed-send --delay-ms`, Cancel Timer →
  `--cancel`), Close After Done (toggle → `close-after-done`, check from
  `session.closeAfterDone`), Fork (`fork-session`, codex/claude/pi only),
  Full reload (`reload-session`, non-browser), Details · Close (confirm →
  kill). Browser sessions lose Rename/Tag/Delayed Send/Close After Done/
  Fork/Full reload like the desktop. Focus on Mac was removed 2026-07-22.
  Desktop-only items intentionally absent: Pop Out Pane / Focus (AppKit pane
  zoom), Move to New Group, Sleep/Close below (sidebar-visual-order bulk
  actions), View 1st message / Generate Title / Copy resume (need fields the
  mobile summary does not carry yet).
- **Project header**: Copy Path, Add to project group › (New project group /
  swatch radio per collection / Remove from group — full-state
  `update-sidebar-project-collections --state-json` round-trip via
  `contract/collectionsState.ts`) · Sleep Inactive⇄Wake, Full reload · Close
  inactive, Close Project (`remove-project`) · Move up/down, Refresh,
  Details (mobile extras).
- **Collection header**: Sleep/Wake/Pin/Unpin/Full-reload sessions (bulk) ·
  Rename group (prompt), Group color › (desktop 9-color swatch submenu),
  Delete group, Close all sessions.
- **Named group header**: Full reload, Sleep⇄Wake, Close (confirm).
- **Section labels**: Quick → Quick Terminal; Projects → Add Project
  (path prompt → `add-project`), Recent Projects, Collapse All / Expand All.

The Rust mobile emitter now also forwards `sessionTag`; menus needing it
degrade gracefully (no check mark) until the CLI is redeployed.
