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
import { chiefStatusCommand, gbotsEditCommand, gbotsShowCommand } from '../../commands/ghostexCli';
import { parseChiefAgents } from '../../contract/chief';
import { parseGbotDetails, type GbotFields } from '../../contract/gbots';
import type { MachineConnectionTarget } from '../../machines/credentials';
import GbotSettingsSheet from './GbotSettingsSheet';

export type GbotSettingsHostProps = {
  target: MachineConnectionTarget;
  botId: string;
  /** The name shown while the GBot loads. */
  name: string;
  onClose: () => void;
  /** After a save the computer took: `name` is the GBot's name as saved. */
  onSaved: (name: string) => void;
};

export default function GbotSettingsHost({ target, botId, name, onClose, onSaved }: GbotSettingsHostProps): ReactElement {
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
    />
  );
}
