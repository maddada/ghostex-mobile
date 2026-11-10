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

The table above is the original reference palette, not a fixed runtime page palette. Native screens, setup/forms, state cards, machine chips, the bottom bar, menus and dialogs now read `useAppearance`; the shared colour model resolves their page/card/input/neutral/accent roles in light and dark appearance. Secondary and semantic text is adjusted for its actual surfaces, while semantic glyph hues stay distinct. The original sleeping-row dimming and Unified status-colour decisions remain in force.

Radius: cards/rows/inputs 8dp; pills/chips fully rounded. Strokes 1dp BORDER (active row: BUTTON).

## 1. Drawer structure

Width 336dp (RN: use as drawer width on tablets/side panel; can be full-screen page on phones), bg `#181818`, padding 12. Three pages toggled: **Sessions** (default), **Machines**, **Settings**.

### Sessions page

1. Header row: Android Exit (48×48 icon btn, bg #262626) | Title "Ghostex" (18sp bold, weight 1) | Refresh | Machines | Settings — 8dp gaps. Refresh = full reconnect. Android Exit = quit app; iOS omits it because iOS apps do not expose a quit action.
2. Status row: 12sp muted, marginTop 4. Initial: "Connect to a ZMX machine". The tappable Tailscale indicator is green while connected and red while disconnected.
3. The top-right More options menu includes "Recent Projects" when the selected machine has recent projects.
4. Session list: flat list, 10dp transparent gaps between top-level project
   cards and collection panels, marginTop 12.
5. Session wall (iPhone Duo inner display only, flat or half folded): a list/tiles switch in the header (in the side bar, two switch entries "Show as list" / "Show as tiles"), kept across launches. Tiles: the same blocks and project headers; each session a tile with agent icon, title, status badge (the row's dot plus Working / Waiting / Has a question / Failed / Background work / Waiting for approval, else the row's time label; a coordinator whose threads are folded shows its row's overlapping dots of the hidden threads, named by the most urgent), the worktree's branch where the row names one (a worktree session its parent project lists, with the row's badge) and its newest 9 screen lines, refreshed only while the tiles are shown. Tap = row tap; long press = row menu. With the Unified list (the computer's Sidebar set to Unified) the tiles follow it: its order, group and shelf headers, every card and shelf row a tile whose badge is the card's status (icon and Approval / Question / Failed / Working / Waiting / Done, else its age); tap = card tap; long press = card menu. Folded and on other iPhones: the list, no switch.
6. Folded triage (iPhone Duo outer display only): above the full list a "Waiting for you · N" section lists the sessions that wait for the user (a wait for input, an approval, a question; a finished turn stays in the full list only), the longest wait first, each a card whose head opens the session as its row does. Approval: Deny / Allow as the chat's stored approval card, or the chat's folded permission rows with their own labels and answers, for every agent. An approval with neither card nor answerable folded rows is answered in the session. A single-select question with options: its options as buttons, answered as the chat's question card. Other questions: "Open Question" opens the session at its question card; a question notice does not become an approval. Other waiting sessions: the last two screen lines and the short replies of Settings › Short Replies (default "continue", "yes"), sent as a chat message in Chat View and typed and submitted in the terminal in Terminal View. A tap disables the card's buttons until the answer is out or refused, so one card sends one answer. Once an answer is out the card leaves and a message at the bottom says what went to which session. Nothing waiting: one quiet row "Nothing is waiting for you". With the computer's Sidebar set to Unified the section stands above the Unified list the same way; it then lists the waiting sessions of every computer that list shows, as its filter and search leave them, ordered together by wait, each answered on its own computer. Unfolded and on other iPhones: no triage.

On Android, Back from a terminal shows Sessions and Back from Sessions returns to the selected warm terminal. Back is consumed when no terminal is open, so the explicit top-left Exit control is the only app-exit path.

### Machines page

Header "Machines" + "Sessions" back button. Status line. Machine cards list. Footer rows: [Retry (accent #7DD3FC/#181818 text) | Add] and [Tailscale | Setup].

### Settings page

Header "Settings" + back. Status "Edit chat, terminal behavior, and remote-session alerts." Theming lives on Settings › Interface (`src/screens/settings/ThemePage.tsx`, the desktop's controls): Presets, Colours (Appearance, the dark and light mode colours with a custom tint, Colourfulness and the separate sidebar and work area sliders), Chat theme, Terminal theme and the terminal palettes in dark and light mode. These settings recolor the drawer backing and its derived group, project, border, header-button, and session surfaces, and the Settings pages paint with the same colours (`useAppearance` in `src/theme/useAppearance.ts`: the theme's sidebar colour for the saved appearance, System following the device). Chat settings select an installed font family, and message width from 50–100% in 5% steps (default 100%); width affects only transcript messages, with a 40px minimum side margin on viewports 500px and wider and 20px below 500px. Toggles: Auto scroll, Command pad (Settings > Keyboard; stored as `extraKeysToolbarVisible`, formerly Extra keys toolbar), Soft keyboard, Keep screen on, Show refresh/upload/keyboard button, Attention notification sound, Fullscreen, Hide keyboard on startup, Open URLs on tap, Confirm before closing tabs, Disable session change toasts; font size. Tab-close confirmation defaults to off. The file-upload floating button defaults on; the refresh and keyboard floating buttons default off.

The existing tint resolver adjusts secondary text toward the foreground on page, card and pressed-card surfaces,
while glyphs retain their original muted tone. Find's filter sheets use the fixed dark sheet's palette. Editor
buttons use the accent's dark label; destructive labels and custom-action placeholders are adjusted on their actual
fills. A surface too light for the existing foreground still needs a separate surface/foreground decision.

## 2. Row types

Flat list items: STATE_CARD, MACHINE_HEADER, PROJECT_HEADER, PROJECT_AGENTS_ROW, PROJECT_EMPTY, GROUP_HEADER, SESSION. Every project lists all of its sessions (the 6-row "Show more" collapse was removed on 2026-10-13).

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

The Live Activity extension cannot use the RN components, so it reuses them as vector image sets in `modules/ghostex-live-activity/ios/Extension/Assets.xcassets/AgentMarks/` (`AgentMark-<id>`, SVG copies of `src/assets/agentIcons.generated.tsx` with the same elements, viewBox, path data, transforms and gradient; template images, omp as drawn; provenance in `Extension/GhostexAgentMarks.swift`). `src/notifications/contentState.ts` resolves each row's `agentIcon` with the same `resolveAgentArtId(session.agentIcon, session.agentName || session.agent)` path as the session list, and carries its `agentTint` as an RGB integer from `agentIconTint`. Explicit icons win, the Claude (cloud) artwork stays distinct, and unknown agents use the terminal mark. Swift draws the supplied identity and tint; it has no name or tint registry. The app-side module and extension share the required fields in `GhostexActivityRow` and ship together; name-only payloads are not decoded by the updated model. The existing encoder still fits attributes plus content within 4096 bytes by dropping rows from the end into `moreCount`. New artwork needs its matching image set, but no Swift registry entry.

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

The Unified list's clock updates working time each second and ages every half minute while Sessions is in front.
It stops behind another screen and in Project mode; returning to Unified reads the current time immediately.

### MACHINE_HEADER (only when ≥2 machines): muted 12sp bold ALL-CAPS letterSpacing 0.06, padding 8/18/8/4, minHeight 36; " …" suffix when collapsed; tap toggles machine section collapse.

### PROJECT_HEADER

Padding 6/14/6/6, minHeight 52. Title 15sp bold #FAFAFA weight 1. "+" button 32×32 pill (bg #181818, stroke BORDER) — create session, cd "Create a session in {title}". Overflow ⋮ 32×32 pill — project menu. Row tap toggles expand/collapse. No session-count pill.

### PROJECT_AGENTS_ROW ("agents isle")

Horizontal scroll chips under project header (needs stable projectId; only if agents or quickActions exist). Global agent chips first, then project quick actions. Chip: pill, padding 10/6/10/6, minHeight 32, optional 15×15 icon + label 12sp #FAFAFA. Agent chip → create agent session. Quick action: browser type opens URL on device; terminal type runs `ghostex run-action '<commandId>' --project-id '<projectId>'` then attach.

### PROJECT_EMPTY: muted 12sp, "No sessions yet. Tap + to create one."

### GROUP_HEADER: muted 13sp bold, padding 14/10/12/4; "{title}" or "{title} ({count})" collapsed; tap toggles (in-memory).

### STATE_CARD: padding 12, minHeight 104, radius 8, bg #262626 + BORDER. Title 15sp bold; body 12sp muted marginTop 6; action hint 12sp bold #7DD3FC marginTop 10. Tap → recovery actions sheet.

## 3. Grouping & ordering

- Project key: `id:` → `path:` → `name:` → `session:` fallback. There is no Chats collection: a project under `~/ghostex/chats` is listed like any other project (an older computer's `isChat` flag is ignored).
- Project order: workspaceGroups.projectOrder ids → remaining projects array order → leftovers.
- preserveSessionOrder when workspaceGroups present OR any sortOrder present; else sort: browser-kind first → pinned (saved order) → attention(2)>working(1)>idle(0) → most recent lastInteractionAt → stable.
- Per project: HEADER → (collapsed? stop) → AGENTS_ROW → (empty? PROJECT_EMPTY) → grouped (ungrouped "main" sessions first, then GROUP_HEADER + members per group in sessionIds order, skip empty groups) or flat (every session).
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
- Poll every **5s** on every screen while the app is in the foreground and a machine is selected (`src/inventory/summaryRefresh.ts`; the Live Activity and the Home Screen widgets read the same summaries, `docs/specs/widgets.md`). Multi-machine: other machines refresh concurrently. No pull-to-refresh (header Refresh = full reconnect). (RN: pull-to-refresh optional addition.)
- State copy (STATE_CARD title / body / action hint):
  - No machines: "Add your Mac" / "Add the macOS machine that runs Ghostex, Tailscale, SSH, and ZMX sessions." / "Open Machines, then tap Add, or open Tutorial from Machines." Status: "Add a machine to connect to Ghostex over Tailscale."
  - Connecting: "Connecting" / "Opening SSH to {label} and asking the Ghostex CLI for ZMX-backed sessions." / "Keep Tailscale online on both devices." Status "Connecting to {label}..."; refreshing over list: "Refreshing sessions on {label}...".
  - Failure: "Connection needs attention" / error or "Could not connect to the selected machine." / "Use Retry, Tailscale, Setup, or switch machines above." While list visible: status "Session refresh failed: {message}" (list preserved).
  - Empty: "No ZMX sessions yet" / "The machine is reachable, but the Ghostex CLI did not return any ZMX-backed sessions." / "Start or resume sessions in Ghostex on the remote machine, then tap Retry."
  - Success status: "Connected to {label}" or "Connected. Active projects have no ZMX-backed sessions."
- Recovery sheet rows: Retry connection / Open Tailscale / Setup / Add SSH machine / Manage machines / Tutorial.
- Failure copy map: permission denied w/ password → "SSH rejected the saved password. Update the saved machine password or choose another machine."; w/o → "SSH needs a key or password. Open the machine settings and save a password, or configure SSH keys/Tailscale SSH."; refused → "The machine is reachable, but SSH refused the connection. Enable Remote Login on the Mac and confirm the saved SSH port."; unreachable → "Could not reach the machine. Open Tailscale and confirm both devices are online."; no CLI → "Connected over SSH, but the Mac could not find the Ghostex CLI. Install Ghostex CLI and make sure ghostex is available in the SSH login shell."; old CLI → "Connected over SSH, but this Mac has an older Ghostex CLI. Update Ghostex so ghostex android-check --json is available."; persistence not zmx → "Ghostex is reachable, but Session persistence is not set to zmx. Open Ghostex Settings on the Mac and set Session persistence to zmx."; zmx missing → "Ghostex is reachable, but ZMX is not available on the Mac. Install zmx and set Ghostex session persistence to zmx."; host key → "SSH host key verification failed. Open Setup and reset this phone's saved host key for the machine, or confirm you are connecting to the right Mac."; truncate 220 chars + "...".
- Warm sessions: keep up to **7** attached terminals alive keyed machine+session, fewer when their scrollback rows would pass the shared 28,000-row budget (`src/terminal/warmBudget.ts`, so a big Scrollback setting cannot run the app out of memory); kill/sleep close warm surface; wake/focus/rename/refresh preserve. Attach status: "Preparing SSH attach for {alias}..." → "Attached to {alias} on {label}...". After attach + first render, send zmx viewport refresh OSC `\x1b]1337;ZMX_REFRESH\x07` once (~2s after visible).
- Transient operation messages use the shared `NoticeToast` above the bottom bar, with a six-second reading time and the shared Reduce Motion behavior. The top status line continues to show machine/list status; transient messages no longer replace it.

## 6. Creation flows

All: close drawer → progress dialog (spinner + message) → run command → refresh inventory → auto-attach created session (`{ok:true, session:{sessionId}}`). Failure: dismiss, error, reopen drawer.

- Project "+": `ghostex create-session --json [--project-id '<id>'] [--group-id '<id>']` — "Creating a terminal in {project}…".
- Agent chip: `ghostex create-agent '<agentId>' --project-id '<projectId>' --json` — "Starting {agent} in {project}…". No stable projectId → "This project has no stable project id, so agent sessions cannot be started here."
- Quick action: terminal → `ghostex run-action '<commandId>' --project-id '<projectId>'`, plus ` --scope global` for a Global Action (run in the project whose menu it was chosen from, and only while the current summary has `capabilities.globalQuickActions: true`); browser → open URL on device (loopback address → Web Preview, otherwise the phone's browser, notice "Opened {name} in the browser." once iOS has opened it). A start the computer refuses closes the progress dialog and shows "Couldn't start {name}" with the §5 failure copy in the shared bottom notice for 6 s before it fades out (a refusal the phone does not recognise reads as a plain sentence; the computer's own words go to the app log); an address the phone cannot open (no installed app handles it) shows the same "Couldn't start {name}" notice with the system's message instead of the opened notice. A failure after the start (list read, attach) uses the same channel as other transient Sessions messages, without a start-failure title. The next notice replaces the previous one, so they cannot overlap. The start-failure notice is an accessible alert; on iOS it also asks VoiceOver once to announce its title and message (whether VoiceOver speaks it is not yet checked on a device).

## 7. mobile-summary contract (build TS types from this)

Root: `{ sessions: Session[], projects?, recentProjects?, agents?, quickActionsByProject? (Record<projectId, QuickAction[]>), globalQuickActions? (QuickAction[], the computer's Global Actions in its saved order), workspaceGroups? { projectOrder?: string[], projects?: Record<projectId, {groups?: {groupId, title?, sessionIds?}[]}> }, capabilities? }`. `capabilities`: booleans naming the summary fields this computer sends; the phone reads `awaitingAnswer`, `attentionNotificationId` and `globalQuickActions`, other keys are ignored, absent = none.

Global Actions count only while `capabilities.globalQuickActions` is `true`; a missing `globalQuickActions` (an older computer, or a summary whose action read failed) is an empty list. The phone drops the cached Global Actions and the capability, until the computer answers again, when a list read fails, when an explicit retry of the connection starts, and when the automatic reconnect or the connection check on returning to the foreground starts. A list read already under way when a retry, reconnect or check starts was sent over the old connection: its answer is discarded, and a recovery in the foreground ends with a new read. Sessions, projects and project actions stay on screen meanwhile.

Project: `{projectId (req), name?, path?}`. RecentProject: `{projectId, title?, path?, sessionCount?}`. AgentLauncher: `{agentId (req), icon?, name?}`. QuickAction: `{actionType ("browser"|"terminal"), commandId?, url?, icon?, name?}`.

Session (sessionId required; provider must normalize to "zmx"): alias (derives from first 4 chars of id), projectId|groupId, title|primaryTitle|terminalTitle, displayTitle, displayTitleTooltip, projectName|groupTitle, projectPath, activity|activityState|activityStatus, status|lifecycleState, provider|sessionPersistenceProvider, providerSessionName|sessionPersistenceName, agent, agentIcon, agentName, globalRef, kind, surface ("browser" sorts first), lastInteractionAt, lastActiveAt, titleSource, trustedResumeTitle, updatedAt, zmxName, nativePaneState, providerSessionState, sortOrder?, isFocused, isFavorite, isPinned, isSleeping, isLive, isPrimaryTitleTerminalTitle, isTemporaryTitle, visibleInSidebarByDefault, shouldSubmitStagedFirstPromptTitleCommand, awaitingAnswer? (an open question card; absent = false; read only with the `awaitingAnswer` capability), attention?{enteredAt, acknowledged, eventId?, kind?, workingStartedAt?, notificationId? (the feed row written for that attention event; optional, '' when absent; used only with the `attentionNotificationId` capability)}, workingStartedAt?, actions?{acknowledgeAttention, attach, focus, kill, readText, sendMessage, sendText, sleep, wake}.

Live Activity fields (optional; sent by a Ghostex desktop with the paired summary change, absent on older ones; parsed as `workingStartedAt` / `attentionKind` / `attentionWorkingStartedAt`, '' when absent, and `awaitingAnswer` / `capabilities`):

- `workingStartedAt` (ISO): when the session's current working stint began, sent only while the session works. A working row's time counts from it; a new value on the same session is a new stint, which starts the Live Activity again when none runs (once the app is in front: iOS starts no Live Activity for an app in the background, so a stint a background run reads starts it when the app comes to front).
- `attention.workingStartedAt` (ISO): when the stint that ended began, sent while the session is in attention. A finished row shows how long the agent worked, `attention.enteredAt` − `attention.workingStartedAt`, static. A current desktop leaves it out when the start is unknown or the attention came from idle (also after an acknowledgement); such a finished agent gets no row (no duration is invented) and counts in "+N more".
- `attention.kind` (`finished` | `needsInput`; a bell arrives as `needsInput`, any other value reads as no kind): `finished` makes a finished row (2 minutes from `attention.enteredAt`), `needsInput` a waiting row starting at `attention.enteredAt`.
- The computer drops `attention` once a finished session is acknowledged on any device. The app remembers each finished event it has seen and keeps it a finished row candidate until 2 minutes after the finish; it drops it earlier when the session works again or enters a new attention. The memory is not stored: after an app restart, a finish acknowledged in the meantime is not shown.
- `awaitingAnswer` (bool, an open question card) and `pendingQuestionCount` (counted questions): a waiting row "has a question" when `awaitingAnswer` is true and the root `capabilities` object has `awaitingAnswer: true`, or when `pendingQuestionCount` is above zero. Without that capability flag an absent `awaitingAnswer` says nothing. A finished session with a question is a waiting row.
- A Live Activity row leads with the session's name, the row title of this list (`displayTitle`, cut to 64 characters), while Settings › Live Activity › "Show session names" is on (`liveActivitySessionNames`, off by default); a session without a name, and every row while the switch is off, leads with the agent's name. The project stays the muted text after it and the mark tells the agent. The name travels in the row's `agentName`, the key the extension draws first, so the switch needs no new app build; the Home Screen widgets follow the same switch (`docs/specs/widgets.md`).
- A Live Activity row opens the session named by its target ids. A row that says "has a question" adds `view=question` to the same session link notifications use, so it opens the question card in Chat View even when that session was saved in its terminal view; every other row keeps the session's normal view choice.
- A session with `awaitingApproval` outside attention has no `attention.enteredAt`: it counts as waiting (and in "+N more") but gets no row, since a row needs its start. Giving approval waits a start is a further paired host change.
- Gate: the Live Activity runs only while every enabled computer with agents sends the start times and the kind. A computer with a working agent without `workingStartedAt`, or an agent in attention without `attention.kind`, needs an update: no Live Activity runs (a running one ends) and Settings › Live Activity names that computer (`computersNeedingUpdate` in `src/notifications/contentState.ts`). A finished agent without `attention.workingStartedAt` does not make its computer need an update, since a current desktop leaves that field out after an attention from idle. A summary without working or attention agents proves nothing.

Has a question: `hasQuestion` in `src/contract/mobileSummary.ts` combines a positive `pendingQuestionCount` with an open question card (`awaitingAnswer`, only when the computer announces its capability). The notification and attention lists use the same predicate on their capability-gated session facts. The Sessions list uses it for the row's pink question indicator and hidden time, the Unified list's "Question" ahead of "Done", machine and Space tabs, project, collection, group and section counts, and folded coordinator stacks. Approval keeps precedence. Sleep Below leaves sessions with either kind of question awake. Without the capability, the card field does not change the existing status; counted questions still count.

The Close confirmation uses that same capability-gated question rule when warning that an agent waits for an answer. Opening a coordinator acknowledges finished threads only when a thread has no question by that rule; an open question card is not a finished reply. Both classifiers receive the capabilities of the same computer as their session rows, with no capabilities when its summary is absent.

Live Activity content reads that same shared predicate with the session's own computer capabilities; its question flag and question link expose no question text.

Folded triage uses that predicate for wait membership, card actions, refresh identity and status dots with the session's own computer capabilities.

displayStatus(): sleeping&&!live → "sleep"; else first actionable (attention|working|done|error) from normalized activity then status; else !live && sleepish → "sleep"; else first non-empty non-"running" activity/status; else "idle". Normalize: needs-attention/attention-required→attention; active/busy/processing→working; sleeping→sleep; `_`/space→`-`; lowercase.

## 8. Notifications

Foreground service (Android) with custom rows: bold title + muted project + status dot; sorted done→working→running; summary "{n} remote terminal(s)"; sound on transition into attention/done (setting-gated; once per event, also when the agent notification of that attention's feed row announces it, when the computer names that row for the attention and announces that it does; from a computer that names none, the sound and the row's notification are separate announcements; not for the session open on screen nor later for an event seen there, and within the rate limit the agent notifications use, kept across launches; a sound the limit holds back is not played).

iOS (`src/notifications/`): while the app runs (foreground or briefly in the background) every enabled computer's notification feed (`/api/readNotificationFeed` over the warm link; the live `stream=notifications` channel only when `ghostex server endpoint` lists `notificationStream`) is read on every screen. A new row of a listed session (top-level sessions and coordinator threads), or a row whose kind the computer changed in place (finished → needsInput), posts one local notification: title "agent · project", line Finished / Waiting for you / Has a question (an open question card, `awaitingAnswer` with its capability, or a pending question counted in `pendingQuestionCount`) / Ended with an error (the computer's kind `failed`: after its five quick retries of a transient error, at once for a permanent one, never on a user abort); never the agent's text; one notification and one sound per event, through one gate for every route (`src/notifications/eventIdentity.ts`): a feed row is announced once in whichever order its routes deliver it, while the app remembers it (every announced event of a row still in the computer's feed, and every event for two hours after its first announcement, judged when a copy arrived, the push's hour of validity with margin; a session's current attention's first event until the session leaves it; the Sessions list's sound that the named row's kind took over later, for two hours from that takeover; kept across launches, ids only; at a start, notifications and the attention sound wait until that record is read, then go out in order); the Sessions list's sound is the event of the feed row the computer names for the attention (`attention.notificationId`, optional, used only when the summary's capability `attentionNotificationId` is set); from a computer that does not send it, the sound is an event of its own, no row is matched to it and nothing is swallowed: the sound and the row's notification both count, so within 20 s after the sound the one-per-session limit holds the row's notification back, and with the attention sound on such a computer's attention events usually give the sound and the row in the list, but no notification; a push without the row id is matched only within the session's attention it came in; none for the session open on screen (its terminal or Chat View on the focused Terminal screen, app active), whose row stays in the list and whose event counts as seen, so no later copy announces it, also after the person left the session (a Sessions-list copy seen there covers its own attention and the row it named, no other row; the seen events are kept apart per computer, at most 363 ids, the oldest going first past that); at most one notification per session every 20 s and 8 per 60 s, every notification and attention sound counted (a row's notification within 20 s after the sound of the event that named the row is part of that sound; the sound after a notification that came without it counts on its own) and kept across launches (what the limit holds back stays in the list, and a later copy of it brings it); nothing for rows that were already there at the first read, at the first read after a failed one, or at the first read after the app comes back from the background (what came while iOS had paused the app is in the list). Two accepted exceptions: if iOS ends the app between showing a notification or sound and saving that it did, that event can be announced a second time (never lost), in the minute after the next launch up to one more batch of other notices can come, and a row's next kind can take the Sessions-list sound its first kind took in that moment and come without its own sound; if the person changes the phone's clock by hand, a notice can come twice, or none for up to a minute after a clock set back, or up to one more batch in the minute after a clock set forward (of any size: the phone cannot tell it from time that passed). Settings › Notifications (was Sounds): master + Finished + Waiting for you + Ended with an error, set by the one-time iOS prompt at the first launch, plus the attention sound (one sound per event). A tap opens the session (`ghostex://session?…`, `&view=question` opens its Chat View at the question card when it has one; at a cold start once the saved computers and view choices are loaded and the session list shows the session) and marks its row read. The header's bell (with the number of sessions that need the user, marked "N?" and read as "last known count" while one of them is the last known wait of a computer that cannot be reached; in the status band on the iPhone Duo; in a side bar as its first entry where the system stands one) opens Notifications, the attention list: what needs the user now, one row per session by its live state, not the desktop bell's event history: Needs you (approval, question, waiting, from the session lists, longest waiting first, the "has a question" label kept current whatever the switches; titled "Needs you · last known" while one of its waits is such a last known one), Done (finished, not opened since), Failed (ended with an error, or a message the computer could not send for good, its kind `sendFailed`, the desktop bell's red "Not sent", as a red "not sent" row that, as on the desktop, posts no notification and plays no sound; it stays until the computer reads that row or the user marks it done), account notices last; read again when the list comes into view or is pulled. A row reads as the desktop bell's card: the agent's icon in a square, the session's title with the time, the computer's message for it as the body ("2 questions are waiting for your answers: …", "Waiting for your approval"), and "project · state" (Needs input, Finished, Failed, Not sent, Ended) as its footer, with the accent wash while unread. A row tap opens its session and marks its rows read on the computer except its failure rows; an ended session's row (its computer lists it as closed) opens a "Session ended" sheet with Restore and Remove (asks first, this phone only); a restored or removed session's row stays off this phone's list; long press: Open Session (and Mark as Done on a Failed row; an account row: Mark as Read/Unread, Clear); "…" (its menu under the button): Clear Done. In both menus each command and "Close menu" are separate VoiceOver elements; in the shared menu a command's (i) (New Coordinator…) is its own element beside the command.

iOS push (`src/notifications/push*.ts`, `backgroundPush.ts`): when the build carries its push project and the computer's gxserver sends pushes (through the Expo Push Service), an event also reaches a closed or suspended phone. The phone registers its Expo push token with every enabled computer whose `ghostex server endpoint` lists `pushNotifications`, over the warm link (`/api/registerPushToken`, only with iOS's permission and the master switch on), with the Finished, Waiting for you and Ended with an error switches and, for a computer paired by QR code, its pairing device id; a computer keeps one token per phone, under the phone's own id for that computer, and pushes no kind that is switched off. A computer that does not list `pushNotifications` gets no registration and counts as not accepted; it is looked at again at the next occasion, so it is registered once its Ghostex lists it, and the master switch off and its removal still ask it to remove the token, since an earlier registration may still be there. One that took the token and whose link settles an endpoint without the flag during the launch (a reconnect) counts as not accepted from the next occasion on; a link that has settled no endpoint yet says nothing. A token fetch, or a request not yet handed to the link, that a newer token or the master switch overtook is not sent; the next pass sends what is wanted then. The master switch off removes this phone's token from the computers (every removal names the computer), on registers it again. A change of Finished, Waiting for you or Ended with an error is sent as a new registration, once, to each enabled computer that should hold the token (master switch on, iOS's permission, a push project, `pushNotifications` listed), with no retry loop: a change that does not reach a computer takes effect there at the next registration it takes; the app in front applies the switches as before. Removing a computer in the app first asks it to remove the token, once the first notification ask was answered and whatever the master switch says, hidden or not; it waits for that at most 2 s and is then removed anyway: a computer it could not reach keeps the token, and nothing asks it again on its own. From the start of its removal no registration goes to that computer for the rest of the launch. The Remove confirm says that the computer stops sending push notifications only when the removal asks it, and an open confirm changes to that text when the first ask's answer arrives. Hiding a computer asks it nothing. The phone keeps across launches which computers confirmed they accepted its registration (their ids only, never the token). An accepted computer stays so while it cannot be reached, while a new registration is under way and when it does not take one (a refusal, or an answer the phone cannot read: it keeps the token it took before), and stops only when it removes the token, answers that it has no push route or no longer lists `pushNotifications`. Only a confirmation counts: a computer whose registration has no answer or was refused, or whose confirmation was lost with the stored list, counts as not accepted until it confirms again. While the app is in front, or inactive and iOS asks it about the push, a push shows no banner of its own: its event goes through the same gate as the feed row of that event (the push carries the row's id), so the two give one notification within the same limits. While the app runs out of front (in the background, or inactive), it posts no notification of its own for a computer that accepted the registration, also for a row read in front that was still waiting when the app left the front: only that event's push presents; other computers keep the app's own notifications. Back in front from inactive, every computer is read again at once and every row that read brings counts as read out of front (iOS may have shown their pushes), also one written after the return before that read answered; rows a later read brings notify as usual, also while the stored list is still read. A push iOS showed while the app was in the background counts as that event's notification whatever the switches and the limits say then, and within the limits as an output (its session's 20 s and one of the 8 a minute, once), with a sound only when the push carried one: the Sessions list's attention sound for a silent push is still to come, but within those 20 s it stays silent; the first read after the app comes back notifies nothing that came meanwhile. A push with content-available may let iOS run the app briefly in the background (not guaranteed; none for a force-quit app): it refreshes the session list once, applies it to the Live Activity and widgets, and awaits their native updates within 25 s. A cold background launch installs their existing consumers without mounting a screen. If the refresh fails or reads no computer, both stay as they are; a successfully read list with no agents still updates them. No second summary read is added. A tapped push marks its row read once the saved computers are loaded and opens its session; a tapped waiting push reads the session list anew and opens the question card when the session has a pending question; when that list takes longer than 5 s, the session opens then and the question card follows once the list arrives and shows a pending question, also while the app is inactive (not when the list shows none or the computer cannot be reached). Every opening of a tap holds only while no later tap on any notification came and the person has not left for another screen or session since the tap (their navigation or another session's tab; not the app's first screen or its own opening of the tapped session), and is checked up to the navigation, also while the session's terminal attaches and before its tab is selected. Settings › Notifications says, while an enabled computer accepted the registration (also in an earlier launch) and until the stored list is read, that it can also notify while Ghostex is closed, without promising that a push arrives, that the three switches also apply to pushes, and that a computer the app cannot reach when one changes keeps the earlier choice until it next accepts this iPhone. Limits: a hidden computer keeps the token, also after Notifications are turned off, and can keep pushing (whether hiding should remove it is open); a computer the removal could not reach keeps it until the token is removed on that computer; a computer that holds the token of an earlier registration but does not list `pushNotifications` counts as not accepted, so its push can come beside the app's own notification until Notifications off or its removal removes the token; a registration already on its way to a computer when its removal started is not called back and can reach it after the removal, which then keeps the token and can keep pushing until the token is removed on that computer (nothing on the phone corrects it); should removing the computer on the phone fail after the removal of the token went out, it stays saved but gets no registration until the app starts again; a second Remove confirmed during the 2 s wait asks the computer again and removes it again; a switch change that does not reach a computer takes effect there only at the next registration it takes, so until then that computer can push a kind now switched off and sends no push for a kind now switched on (while the app runs out of front it posts none of its own for an accepted computer's rows; they are in the list); a push that does not arrive while the app runs out of front leaves that notification missing (the row is in the list); a notification shown in front can be followed by its push after the app went to the background; a computer that took a registration the phone holds no confirmation of (a lost answer, also when a later registration is refused; a stored list that could not be read, was not saved or is missing; the app's data wiped while the computer keeps an old token) keeps the app's own notifications, so its push can come as well, and Settings then shows the text for a running app; a row written after a return from inactive that the first read after the return brings gets no notification of the app's own for an accepted computer and is announced only by its push; what iOS does with a push while the app is inactive (ask the app, or show it itself) is not verified on a device.

## 9. Desktop gpui-sidebar parity amendment (2026-07-22)

The drawer was reworked to match the macOS gpui sidebar's CURRENT skin (the
`hierarchy-panels.css` "layered panels" reference layout, which overrides the
older groups.css look); where this section conflicts with §§0-7, it wins.
Second pass on 2026-07-22 replaced the agent/action chips with header menus
and recloned every surface from the live CSS cascade.

- **Structure**: "Projects" section label → colored collection PANELS (tinted bg mix(color
  5%, mix(bg 96%, black 4%)), border mix(color 28%, mix(fg 14%, bg)), radius
  5; the fg-14% base keeps a visible outline for the transparent color)
  containing member project CARDS → ungrouped project cards (translucent bg
  fg-4.5%, 1dp translucent border fg-13%, radius 5). This is the current gpui
  hierarchy: darker group panels with lighter project cards. No colored left
  rail, no uppercase titles, no folder icons. The section label is 15.5dp
  weight-300 at fg-52% and never collapses.
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
- **Menus** (`ContextMenu`, cloned from `.session-context-menu`): 220dp model-coloured
  popup (the current card, 1dp border, radius 0, 6dp padding, 2dp row gap) aligned
  horizontally to the pressed row and fixed to the full safe viewport height.
  Its vertical frame never depends on space remaining below the anchor, so
  menus opened near the bottom cannot collapse into a short strip. Every
  actionable row has a 14dp leading glyph or semantic color swatch; the shared
  item type requires this, including Back, Details, ordering, and
  expand/collapse rows. The agent menu lists `summary.agents`
  with brand-tinted icons and a check on the selected primary agent; selecting
  launches the agent AND persists it globally (`drawer.launcher.v1`,
  mirroring the desktop's ghostex-sidebar-project-terminal-launcher). The
  actions menu lists the project's quick actions under "Project Actions", then
  the computer's Global Actions under "Global Actions" (each heading only when
  its part is non-empty), with a check on the last-run action, identified by
  scope and commandId (persisted per machine+project; a project action as its
  bare commandId, a Global Action as `{scope:"global", commandId}`). Actions…
  is in the project menu only while at least one action is listed. An open project
  menu or actions menu takes the Global Actions from the current summary, so they
  leave it as soon as the computer no longer offers them; the project's own actions
  stay as they were when the menu opened. The Unified list has no project menu, so
  under the same condition a Unified session's long-press menu offers Actions… (after
  Changes) for that session's computer and project, read from that computer's current
  summary (also for a project in a saved collection, however it is folded); it opens
  the same actions menu, which runs on that computer. The old PROJECT_AGENTS_ROW chip
  row is gone.
- **Session rows**: 34dp flat rows, radius 4 fills, title 15.5dp weight-300
  #B4B8C0 (active #D8D8D8; sleeping dims ONLY the title to #5F646B at 0.42),
  with the gpui surface chain driven by warm terminal state: unsurfaced rows
  are transparent until pressed (90% resolved sidebar background / 10% black);
  surfaced rows start with 30% foreground over their expanded-group background
  (including collection tint); active rows mix that base 10% toward black,
  while surfaced-but-inactive rows mix the same base 40% toward black,
  leading icon absolute at 5dp (in-card) with 48% opacity
  (80% active; 13dp agent masks, 15dp terminal/browser glyphs), relative
  time 13.5dp #4F5359 right-aligned (hidden while working/attention), and a
  flat 7dp right-edge dot matching desktop .session-status-dot activity
  colors (2026-07-22 amendment): working #FFB454 with the desktop 1.35s
  pulse (opacity .78/scale .92 ↔ full), attention/done #95D7F6, error
  #FF6B6B, grey for remote sleeping, nothing for idle. Same displayStatus
  as the collapsed project/group count pills. Pinned rows show a mirrored
  13dp pin at 50% opacity.
  Empty projects render the dashed "No sessions"
  38dp box.
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
  plus a Custom section listing the machine's user-defined tags from the
  root `customSessionTags` catalog ({order, tags}: tagId, name, icon, color),
  check on `session.sessionTag`, tap-again clears → `tag-session`),
  Sleep/Wake · Attach, Copy attach command, Delayed Send (modal mirroring the
  desktop Hours/Minutes dialog → `delayed-send --delay-ms`, Cancel Timer →
  `--cancel`), Close After Done (toggle → `close-after-done`, check from
  `session.closeAfterDone`), Fork (`fork-session`, codex/claude/pi only),
  Full reload (`reload-session`, non-browser), Details · Close (confirm →
  kill). Browser sessions lose Rename/Tag/Delayed Send/Close After Done/
  Fork/Full reload like the desktop. Focus on Mac was removed 2026-07-22.
  Desktop-only items intentionally absent: Pop Out Pane / Focus (AppKit pane
  zoom), Move to New Sessions Group, Sleep/Close below (sidebar-visual-order bulk
  actions), View 1st message / Generate Title / Copy resume (need fields the
  mobile summary does not carry yet).
- **Project header**: Copy Path, Add to project group › (New Group /
  swatch radio per collection / Remove from group — full-state
  `update-sidebar-project-collections --state-json` round-trip via
  `contract/collectionsState.ts`) · Sleep Inactive⇄Wake, Full reload · Close
  inactive, Close Project (`remove-project`) · Move up/down, Refresh,
  Details (mobile extras).
- **Collection header**: Sleep/Wake/Pin/Unpin/Full-reload sessions (bulk) ·
  Rename group (prompt), Group color › (desktop 9-color swatch submenu),
  Delete group, Close all sessions.
- **Named group header**: Full reload, Sleep⇄Wake, Close (confirm).
- **Section label**: Projects → Add Project
  (path prompt → `add-project`), Recent Projects, Collapse All / Expand All.

The Rust mobile emitter now also forwards `sessionTag`; menus needing it
degrade gracefully (no check mark) until the CLI is redeployed.
