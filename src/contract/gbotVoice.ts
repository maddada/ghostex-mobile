/**
 * A GBot's voice as gxserver answers it: `ghostex gbots show --json` (`bot.voice`, `bot.voiceChoices`) and
 * `ghostex gbots voice <bot> --json` (server/src/gbots/call.rs `voice_view`). `voice` null means the Voice agent's own.
 */

/** The voices a GBot can answer calls in: the provider calls use now, its voice when none is picked, every provider's. */
export type GbotVoiceChoices = {
  provider: string;
  providerLabel: string;
  defaultVoice: string;
  voiceOptions: Record<string, string[]>;
};

/** The GBot's voice (null: the Voice agent's own) and its choices. */
export type GbotVoiceState = { voice: string | null; choices: GbotVoiceChoices };

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseChoices(value: unknown): GbotVoiceChoices | null {
  const choices = record(value);
  const provider = typeof choices.provider === 'string' ? choices.provider : '';
  if (provider.length === 0) return null;
  const voiceOptions: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(record(choices.voiceOptions))) {
    voiceOptions[key] = Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : [];
  }
  return {
    provider,
    providerLabel: typeof choices.providerLabel === 'string' ? choices.providerLabel : provider,
    defaultVoice: typeof choices.defaultVoice === 'string' ? choices.defaultVoice : '',
    voiceOptions,
  };
}

function voiceOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** From `show`'s `bot`: null when the computer's Ghostex has no GBot voices yet (no `voiceChoices`). */
export function parseGbotVoiceFromBot(bot: Record<string, unknown>): GbotVoiceState | null {
  const choices = parseChoices(bot.voiceChoices);
  return choices === null ? null : { voice: voiceOf(bot.voice), choices };
}

/** From the `voice` verb's answer (the choices at its top level). */
export function parseGbotVoiceAnswer(json: unknown): GbotVoiceState | null {
  const answer = record(json);
  const choices = parseChoices(answer);
  return choices === null ? null : { voice: voiceOf(answer.voice), choices };
}

/** "eve" → "Eve", as the voice screen names voices. */
export function gbotVoiceLabel(voice: string): string {
  return voice.length > 0 ? voice[0].toUpperCase() + voice.slice(1) : voice;
}
