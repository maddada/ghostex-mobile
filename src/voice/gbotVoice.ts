/**
 * A GBot's voice: the voice it answers calls in (server/src/gbots/call.rs, `/api/gbots` `voiceSet`), saved from the
 * voice screen's picker during a call with it. GBot Settings saves the same thing with `ghostex gbots voice`
 * (screens/sessions-screen/GbotSettingsHost.tsx).
 */

import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from '../machines/credentials';

const SAVE_TIMEOUT_MS = 15_000;

/**
 * Saves `voice` (one of the Voice agent's voices, or "" for the Voice agent's own) as GBot `botId`'s voice on
 * `machine`. Answers null when saved, else the reason in a few words.
 */
export async function saveGbotVoice(
  machine: MachineConnectionTarget,
  botId: string,
  voice: string,
): Promise<string | null> {
  try {
    const answer = await chatMachineLink(machine).rpc('gbots', { op: 'voiceSet', bot: botId, voice }, SAVE_TIMEOUT_MS);
    return answer.error === null ? null : answer.error.message;
  } catch (error) {
    return error instanceof Error ? error.message : "Couldn't reach your computer";
  }
}
