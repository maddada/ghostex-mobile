/**
 * When a coordinator's model or effort may make it work worse: the phone's copy of
 * `coordinator_quality_concern` in packages/gx-protocol/src/coordinator.rs (the Ghostex main repo),
 * which the phone cannot link outside the chat core, for the agent step of New Coordinator. Change
 * both together.
 *
 * CDXC:Coordinators 2026-11-13 SEE-ALSO: packages/gx-protocol/src/coordinator.rs (the user's Q2980 decision: a model other than Opus, Fable, GPT Sol or GPT Astra, an effort below medium, or an unknown model warns).
 */

function modelWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/** Opus, Fable, GPT Sol or GPT Astra, any version (`opus[1m]`, `claude-opus-5-5`, `GPT-6.1 Sol`). */
export function coordinatorModelIsStrong(model: string): boolean {
  const words = modelWords(model);
  const has = (word: string): boolean => words.includes(word);
  return has('opus') || has('fable') || (has('gpt') && (has('sol') || has('astra')));
}

function present(text: string | undefined): string | null {
  const trimmed = (text ?? '').trim();
  return trimmed.length === 0 || trimmed.toLowerCase() === 'default' ? null : trimmed;
}

/**
 * "Coordinator quality may be degraded on <model>", or null when the coordinator would run on a
 * model it works well on at medium effort or above. Either of the model's value and label may be
 * empty; an unknown effort is no reason on its own.
 */
export function coordinatorQualityWarning(model: { value?: string; label?: string }, effort?: string): string | null {
  const value = present(model.value);
  const label = present(model.label);
  const knownEffort = present(effort);
  const strong = [value, label].some((text) => text !== null && coordinatorModelIsStrong(text));
  const lowEffort = knownEffort !== null && ['low', 'minimal', 'none', 'min'].includes(knownEffort.toLowerCase());
  if (strong && !lowEffort) return null;
  const name = label ?? value ?? 'an unknown model';
  const runsOn = lowEffort ? `${name} at ${knownEffort} effort` : name;
  return `Coordinator quality may be degraded on ${runsOn}`;
}
