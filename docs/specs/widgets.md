# Home Screen widgets — Implementation Spec (iOS)

One Ghostex widget in three sizes on the Home Screen; StandBy shows the small one. It shows the app's last view of the
agents on the computers: no push reaches it, so it is as fresh as the app's last session refresh, and every size says
when that was. Code: `src/notifications/widgetSnapshot.ts`, `widgetWriter.ts`, `widgets.ts`; native
`modules/ghostex-widgets` (app side and the widget's SwiftUI in `ios/Extension`), compiled into the WidgetKit extension
of `plugins/withWidgets.js` together with the Live Activity.

## 1. Sizes and content

| Size                 | Shows                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Small (also StandBy) | Ghostex mark; "Needs you" with a bell while an agent waits; the number of working agents and the number of waiting agents, each with its glyph and word; "Updated {time}"                                                                                                             |
| Medium               | Left: the small widget's content. Right: the first three agents in two lines (mark and name; state glyph and word, project) or, with none working or waiting, "No agent is working or waiting."                                                                                       |
| Large                | Head: mark, "{n} working", "{n} waiting", "Needs you" while one waits. Rows: up to eight agents, as many as the height leaves room for, one line each (mark, name, project, state glyph and word, "since {time}"). Usage bars where the app has usage (below). Foot: "Updated {time}" |

- Agents: working and waiting, waiting first; inside a state the longest wait and the longest work first. Finished
  agents are neither counted nor listed. A waiting agent with a question says "waiting" (the snapshot carries no
  question field).
- Agent marks and tints come from the same resolved identity as the session list and Live Activity, not from the
  displayed name. An explicit icon keeps its identity even when the agent has a custom name.
- "No agent is working or waiting." (medium and large, in the agents' place) only when both counts are 0. An agent
  counted without a row (a computer that sends no start time, an approval without a time) leaves that place empty;
  the counts still show it.
- Text level: event and session only. Leading name, project, state and times; no prompt or reply. The leading name
  ("name" in the table above) is the session's name as the Sessions list shows it while Settings › Live Activity ›
  "Show session names" is on (`liveActivitySessionNames`, on by default) and the session has one, else the agent's
  name; the mark tells the agent either way. The Live Activity's rows follow the same switch and rule (`leadingName`
  in `src/notifications/contentState.ts`). The snapshot carries that name in `agentName`, the key the widgets draw
  first, so the format version stays 2 and the widgets need no new build.
- No data written yet (or a snapshot of another version, or one with an agent neither working nor waiting): the
  Ghostex mark only, no numbers.
- Colour never carries meaning alone: every state colour comes with its glyph (open arc working, clock waiting, bell
  "Needs you") and word, so the tinted Home Screen and StandBy at night (red) keep the meaning. Dark: the app's
  surface and state colours; light: white surface, the darker state tones the app uses on light surfaces. StandBy and
  tinted mode remove the background (`containerBackground`).
- Tapping a widget opens the app.

## 2. Usage bars (large)

- From the selected computer (the one the Sessions list shows): its saved, enabled Claude and Codex accounts as the
  usage pane lists them (`agentAccounts` with `operation: "list"`, `src/usage/client.ts`), one bar per usage window in
  the pane's order, the first six. Label "{Provider} {window}" ("Claude 5h"); where the computer has more than one
  account of a provider, "{account name} {window}". Percent as the pane rounds it, kept within 0 to 100; "Resets
  {time left}" counting down (iOS 18; a timer before), gone once the reset has passed.
- Read while the summary poll runs, when no read of the selected computer started in the last 2 minutes, also after
  switching to another computer and back; the computer answers from a reading of up to 2 minutes anyway. Never in the
  background. Each computer keeps its last reading, so switching back shows its bars again while they are fresh.
- No bars without usage: no account, no usage window, a window without a readable percent, a reading older than
  5 minutes, or a reading of another computer. No empty bars, no 0 %.

## 3. Data path

- After every session refresh the app builds the snapshot (`buildSnapshot`, `widget-snapshot` format version 2:
  `schemaVersion`, `writtenAt`, `counts`, `attention`, `agents` (at most 8, each `working` or `waiting`, with resolved
  artwork `agentIcon` and packed RGB `agentTint`), optional `usage.bars` (at most 6)) over every enabled computer's
  summary, with the Live Activity's classification of a session (`candidateFor` in `contentState.ts`), and writes it
  as `widget-snapshot.json` into the App Group container (atomic), then asks WidgetKit to reload the widget
  (`reloadTimelines(ofKind: "GhostexStatus")`), once per write.
- Older snapshots show the existing empty state until the app's next session refresh replaces them with the current
  format. The app and extension ship together; no name-based identity is reconstructed from an old snapshot.
- Data time (`writtenAt`): when the oldest summary used was read; the refresh time when every computer answered.
- A refresh that changes nothing shown, compared with the data time to the minute, writes nothing; while the poll runs
  an unchanged state is written once a minute, so the shown time stays current. Switching "Show session names"
  writes at once, and nothing is written before the stored settings were read.
- Nothing is written before the first summary was read. Removing the last computer deletes the file.
- "Show session names" switched off never leaves names in the widgets: with summaries read, the snapshot is written
  again without them; with none (the computers cannot be reached, every computer is disabled, the app just started),
  a snapshot that may carry names is deleted and the widgets reloaded, and the next summary writes it again. The app
  cannot read the file back, so it keeps a record of whether the file may carry names (`widgets.snapshotMayHoldNames.v1`
  in the app's storage): set before a snapshot with names shown is written, cleared only after one without names was
  written or the file was deleted, and read before anything is written. A snapshot written without names is not
  deleted for this, so with the switch off the widgets keep their last state while no summary is there, as before.
  A record that could not be read is "unknown", which is not the same as stored: it counts as "may carry names"
  when the switch is off (the file is deleted or rewritten, and the record then stored as clear), and with the
  switch on the record is stored first, as when it was clear; if it cannot be stored, no names are written. So a
  file with names always has the record set in storage, and a later launch that reads it finds it.
- Not written while the app is in the background except in a run iOS grants for a push with content-available.
  The registered task refreshes the session list once, then `updateWidgets()` installs the existing writer if a
  background launch mounted no screen and applies that list. The task awaits the write and reload within its 25 s
  budget. If the refresh fails or reads no computer, the snapshot stays as it is; a successfully read empty list
  still updates it. No second summary read or background usage read is added.
- An agent of a computer that does not send a start time (`workingStartedAt`, `attention.enteredAt`) is counted but
  gets no row. On a computer that does not send `attention.kind`, every agent in attention counts as waiting.

## 4. App Group and signing

- `com.apple.security.application-groups` in app.json's `ios.entitlements` (`group.<bundle id>`); the plugin gives the
  extension the same group (`GhostexLiveActivityExtension.entitlements`) and both Info.plists the key
  `GhostexAppGroup = $(GHOSTEX_APP_GROUP)`, the build setting it sets from app.json. A build signed by another team
  overrides `GHOSTEX_APP_GROUP` (and its app entitlements) with a group of its own; the code reads only the key.
- The extension keeps one bundle id (`<app bundle id>.liveactivity`) for the Live Activity and the widgets.
