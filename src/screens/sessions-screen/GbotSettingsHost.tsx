/**
 * GBot Settings for one GBot on one computer: the sheet (GbotSettingsSheet.tsx) wired to the `ghostex gbots` commands
 * that read and save it. The sessions list opens it from a GBot's long press (use-gbots.tsx) and a chat opens it from
 * the "GBot added" card's Open settings (chat/native/NativeChatScreen.tsx, the core's `openGbotSettings`), so both
 * read and save the same way.
 *
 * CDXC:GBots 2026-11-09 SEE-ALSO: apps/desktop/src/app/gbot_settings_modal_lifecycle.rs (the desktop's window, which
 * the card's Open settings opens there).
 */

import type { ReactElement } from 'react';

import { runGhostexCli } from '../../components/sessions/cli';
import {
  chiefStatusCommand,
  gbotsEditCommand,
  gbotsMemoryShowCommand,
  gbotsMemoryUndoCommand,
  gbotsRoutineActCommand,
  gbotsRoutineListCommand,
  gbotsShowCommand,
} from '../../commands/ghostexCli';
import { parseGbotRoutines, type GbotRoutine } from '../../contract/gbotRoutines';
import { parseChiefAgents } from '../../contract/chief';
import { parseGbotMemory, type GbotMemory } from '../../contract/gbotMemory';
import { parseGbotDetails, type GbotFields } from '../../contract/gbots';
import type { MachineConnectionTarget } from '../../machines/credentials';
import GbotSettingsSheet, { type GbotSettingsTab } from './GbotSettingsSheet';

export type GbotSettingsHostProps = {
  target: MachineConnectionTarget;
  botId: string;
  /** The name shown while the GBot loads. */
  name: string;
  onClose: () => void;
  /** After a save the computer took: `name` is the GBot's name as saved. */
  onSaved: (name: string) => void;
  /** The tab it opens on; Profile by default. */
  initialTab?: GbotSettingsTab;
};

export default function GbotSettingsHost({
  target,
  botId,
  name,
  onClose,
  onSaved,
  initialTab,
}: GbotSettingsHostProps): ReactElement {
  const readRoutines = async (): Promise<GbotRoutine[]> => {
    const routines = parseGbotRoutines((await runGhostexCli(target, gbotsRoutineListCommand(botId))).json);
    if (routines === null) throw new Error(`${name}'s routines could not be read. Try again in a moment.`);
    return routines;
  };
  const readMemory = async (): Promise<GbotMemory> => {
    const memory = parseGbotMemory((await runGhostexCli(target, gbotsMemoryShowCommand(botId))).json);
    if (memory === null) throw new Error(`${name}'s memory could not be read. Try again in a moment.`);
    return memory;
  };
  return (
    <GbotSettingsSheet
      name={name}
      load={async () => {
        const result = await runGhostexCli(target, gbotsShowCommand(botId));
        const details = parseGbotDetails(result.json);
        if (details === null) throw new Error(`${name} could not be read. Try again in a moment.`);
        return details;
      }}
      loadAgents={async () => parseChiefAgents((await runGhostexCli(target, chiefStatusCommand())).json)}
      onSave={async (fields: GbotFields) => {
        await runGhostexCli(target, gbotsEditCommand(botId, fields));
        onClose();
        onSaved(fields.name ?? name);
      }}
      onCancel={onClose}
      loadMemory={readMemory}
      undoMemory={async (change: string) => {
        await runGhostexCli(target, gbotsMemoryUndoCommand(botId, change));
        return readMemory();
      }}
      loadRoutines={readRoutines}
      actRoutine={async (verb, id) => {
        await runGhostexCli(target, gbotsRoutineActCommand(verb, id));
        return readRoutines();
      }}
      initialTab={initialTab}
    />
  );
}
