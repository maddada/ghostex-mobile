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
  gbotsDepartmentCreateCommand,
  gbotsDepartmentEditCommand,
  gbotsDepartmentListCommand,
  gbotsDepartmentRemoveCommand,
  gbotsApiCommand,
  gbotsComputerCommand,
  gbotsComputerSetCommand,
  gbotsEditCommand,
  gbotsMemoryShowCommand,
  gbotsMemoryUndoCommand,
  gbotsRoutineActCommand,
  gbotsRoutineListCommand,
  gbotsPlaceCommand,
  gbotsShowCommand,
  gbotsVoiceSetCommand,
} from '../../commands/ghostexCli';
import { parseGbotApi, type GbotApi } from '../../contract/gbotApi';
import { parseGbotComputer, type GbotComputer } from '../../contract/gbotComputer';
import { parseGbotDepartments } from '../../contract/gbotDepartments';
import { parseGbotRoutines, type GbotRoutine } from '../../contract/gbotRoutines';
import { parseChiefAgents } from '../../contract/chief';
import { parseGbotMemory, type GbotMemory } from '../../contract/gbotMemory';
import { parseGbotVoiceAnswer } from '../../contract/gbotVoice';
import { parseGbotDetails, type GbotFields } from '../../contract/gbots';
import type { MachineConnectionTarget } from '../../machines/credentials';
import type { GbotDepartmentAction, GbotDepartmentState } from './GbotDepartmentView';
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
  /** After a change that applied at once (the Department tab), so the list redraws. */
  onChanged?: () => void;
};

export default function GbotSettingsHost({
  target,
  botId,
  name,
  onClose,
  onSaved,
  initialTab,
  onChanged,
}: GbotSettingsHostProps): ReactElement {
  const readDepartments = async (): Promise<GbotDepartmentState> => {
    const departments = parseGbotDepartments((await runGhostexCli(target, gbotsDepartmentListCommand())).json);
    const details = parseGbotDetails((await runGhostexCli(target, gbotsShowCommand(botId))).json);
    if (departments === null || details === null) {
      throw new Error(`${name}'s department could not be read. Try again in a moment.`);
    }
    return { departments, departmentId: details.departmentId, isLead: details.isLead };
  };
  const actDepartment = async (action: GbotDepartmentAction): Promise<GbotDepartmentState> => {
    switch (action.kind) {
      case 'move':
        await runGhostexCli(target, gbotsPlaceCommand(botId, action.departmentId));
        break;
      case 'lead':
        await runGhostexCli(target, gbotsPlaceCommand(botId, null, action.lead));
        break;
      case 'edit':
        await runGhostexCli(
          target,
          gbotsDepartmentEditCommand(action.departmentId, { name: action.name, instructions: action.instructions }),
        );
        break;
      case 'remove':
        await runGhostexCli(target, gbotsDepartmentRemoveCommand(action.departmentId));
        break;
      case 'create':
        await runGhostexCli(target, gbotsDepartmentCreateCommand(action.name));
        await runGhostexCli(target, gbotsPlaceCommand(botId, action.name));
        break;
    }
    onChanged?.();
    return readDepartments();
  };
  const readRoutines = async (): Promise<GbotRoutine[]> => {
    const routines = parseGbotRoutines((await runGhostexCli(target, gbotsRoutineListCommand(botId))).json);
    if (routines === null) throw new Error(`${name}'s routines could not be read. Try again in a moment.`);
    return routines;
  };
  const readComputer = async (): Promise<GbotComputer> => {
    const computer = parseGbotComputer((await runGhostexCli(target, gbotsComputerCommand(botId))).json);
    if (computer === null) throw new Error(`Where ${name} works could not be read. Try again in a moment.`);
    return computer;
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
      loadComputer={readComputer}
      actComputer={async (change) => {
        await runGhostexCli(target, gbotsComputerSetCommand(botId, change));
        onChanged?.();
        return readComputer();
      }}
      loadApi={async (): Promise<GbotApi> => {
        const api = parseGbotApi((await runGhostexCli(target, gbotsApiCommand('status', botId))).json);
        if (api === null) throw new Error(`${name}'s Bot API could not be read. Try again in a moment.`);
        return api;
      }}
      actApi={async (verb): Promise<GbotApi> => {
        // Turning it on and a new key wait for the user's approval in the command (as adding a GBot does).
        const result = await runGhostexCli(target, gbotsApiCommand(verb, botId), { timeoutMs: 5 * 60 * 1000 });
        const api = parseGbotApi(result.json);
        if (api === null) throw new Error(`${name}'s Bot API could not be read. Try again in a moment.`);
        return api;
      }}
      loadDepartments={readDepartments}
      actDepartment={actDepartment}
      initialTab={initialTab}
      saveVoice={async (voice) => {
        const answer = parseGbotVoiceAnswer((await runGhostexCli(target, gbotsVoiceSetCommand(botId, voice))).json);
        if (answer === null) throw new Error(`${name}'s voice could not be read. Try again in a moment.`);
        return answer;
      }}
    />
  );
}
