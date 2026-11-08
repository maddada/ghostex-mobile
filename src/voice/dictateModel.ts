/**
 * Dictate's settings as each computer's gxserver keeps them (`/api/readDictateSettings`): the
 * engine that transcribes (Hex 3 on that computer, or the OpenAI or xAI key), the language, the
 * dictionary, filler removal and AI polish, and what is left of the retired local engine (its
 * one-time notice and its old models). The phone only reads and
 * writes them; the microphone is the phone's own. Kept free of React Native so its rules are
 * testable under `bun test`.
 *
 * CDXC:VoiceMode 2026-11-05 DECISION: User (Q1275): the phone manages Dictate per computer in Settings › Voice, with a computer picker at the top, because the paired computer's gxserver is what transcribes.
 * CDXC:Dictate 2026-11-08 DECISION: User (Q1709 "Drop local now"): Ghostex's own local engine is gone and Hex is the recommended engine, "hex used even on the phone": the phone records and the computer transcribes, so the phone's dictation uses Hex on that computer. A computer still on an older Ghostex may answer `local`; the phone says to update Ghostex there.
 * CDXC:VoiceMode 2026-11-05 SEE-ALSO: the routes and shapes are gxserver's `server/src/voice_agent/speech/http.rs`; the desktop's Voice page draws the same settings.
 */

/** `local` only from a computer whose Ghostex predates Hex replacing the local engine. */
export type DictateEngineId = 'local' | 'openai' | 'xai' | 'hex';

export type DictionaryWord = { word: string; aliases: string[] };

export type DictateSettings = {
  engine: DictateEngineId;
  /** The Hex model id; null uses Hex's first ready model. Older computers leave it out. */
  hexModel?: string | null;
  language: string;
  dictionary: DictionaryWord[];
  addProjectNames: boolean;
  removeFillers: boolean;
  polish: { enabled: boolean; model: string; prompt: string | null };
};

export type DictateProblemCode = 'noKey' | 'keyUnreadable' | 'hexNotInstalled' | 'hexNotRunning' | 'hexModelNotReady';

/** What will transcribe on a computer: its label ("Hex, Parakeet v3") and why it can't yet. */
export type DictateEngine = {
  engine: DictateEngineId;
  label: string;
  ready: boolean;
  problem: { code: DictateProblemCode | string; message: string } | null;
  polish: boolean;
};

/**
 * Where the user stands with Hex 3 on a computer (`hex` in `/api/readDictateSettings`, from
 * gxserver's `speech/hex.rs`): not offered where Hex 3 has no build, then not installed, not
 * running, a problem (a version Ghostex doesn't speak), or ready with the models Hex has ready.
 */
export type HexState = 'unsupported' | 'notInstalled' | 'notRunning' | 'problem' | 'ready';

export type HexModel = { id: string; name: string; languages: string[]; supportsLanguageDetection: boolean };

export type HexView = {
  available: boolean;
  state: HexState;
  version: string | null;
  olderVersion: string | null;
  models: HexModel[];
  /** The model Dictate uses now, or null. */
  model: string | null;
  ready: boolean;
  problem: { code: string; message: string } | null;
  downloadUrl: string;
};

export type DictateOverview = {
  settings: DictateSettings;
  engine: DictateEngine;
  keys: Record<'xai' | 'openai', { configured: boolean; unreadable: boolean }>;
  projectWords: string[];
  polishAvailable: boolean;
  languages: { code: string; label: string }[];
  /** Missing on a computer whose Ghostex predates the Hex engine. */
  hex?: HexView;
  /** The one-time notice for a computer that used the retired local engine, until dismissed. */
  localRetired?: { message: string } | null;
  /** The retired engine's models still on the computer, to delete. */
  oldModels?: { folder: string; bytes: number } | null;
};

export const DICTATE_ENGINES: readonly { value: DictateEngineId; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'xai', label: 'xAI' },
];

/**
 * The engines the picker offers for a computer: Hex first, as the recommended engine, where Hex 3
 * ships for it (gxserver says), then OpenAI and xAI.
 *
 * CDXC:Dictate 2026-11-07 DECISION: User: Hex wherever the dictation engine is chosen, shown only on systems Hex 3 supports (macOS on Apple silicon, Windows, Linux), with the row saying where the user stands in plain words. Since 2026-11-08 it leads the list (the local engine is gone).
 */
export function dictateEngines(
  overview: Pick<DictateOverview, 'hex'> | null,
): readonly { value: DictateEngineId; label: string }[] {
  return overview?.hex?.available === true ? [{ value: 'hex', label: 'Hex' }, ...DICTATE_ENGINES] : DICTATE_ENGINES;
}

/** Why the phone's dictation goes through the computer, so Hex there is what transcribes it. */
export function phoneDictationNote(computer: string): string {
  return `Dictating on this phone records here and ${computer} transcribes it with its engine, so with Hex the words come from Hex on ${computer}. Nothing to install on the phone.`;
}

/** The Hex block's caption on the phone: what transcribes, or what to do on the computer. */
export function hexCaption(hex: HexView | undefined, computer: string): string {
  if (hex === undefined) return `Ghostex on ${computer} is too old for Hex. Update Ghostex on that computer.`;
  switch (hex.state) {
    case 'unsupported':
      return hex.problem?.message ?? `Hex 3 has no build for ${computer}.`;
    case 'notInstalled':
      return hex.olderVersion
        ? `${computer} has Hex ${hex.olderVersion}, which can't transcribe for Ghostex. Install Hex 3 there.`
        : `Hex 3 isn't installed on ${computer}. Install Hex, then open it on ${computer}, allow the microphone and download a model in Hex's settings.`;
    case 'notRunning':
      return `Hex isn't running on ${computer}. Open Hex there, then check again. Turning on Open at login in Hex keeps dictation working after a restart.`;
    case 'ready': {
      if (hex.problem !== null)
        return hex.problem.code === 'hexNoModels'
          ? `Hex on ${computer} has no model ready. Download one in Hex there, then check again.`
          : `The Hex model Dictate uses isn't ready on ${computer}. Download it in Hex there, or pick another model below.`;
      const model = hex.models.find((entry) => entry.id === hex.model);
      const hexName = hex.version ? `Hex ${hex.version}` : 'Hex';
      return `${hexName} on ${computer} transcribes${model ? ` with ${model.name}` : ''}. Recordings stay on ${computer}.`;
    }
    default:
      return hex.problem?.message ?? '';
  }
}

/** The dictionary's limits, as gxserver checks them (`speech/settings.rs`). */
export const DICTIONARY_LIMITS = { words: 200, wordLength: 64, aliasMin: 3, aliasMax: 64, aliases: 8 } as const;

/** "0.72 GB", or "150 MB" under a gigabyte's tenth (the old models' size). */
export function formatBytes(bytes: number): string {
  // Nothing on disk is "0 MB", not the 1 MB floor a small file gets.
  if (bytes <= 0) return '0 MB';
  if (bytes >= 100_000_000) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** A comma-separated alias field as aliases: trimmed, empty ones and repeats dropped. */
export function parseAliases(text: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const part of text.split(',')) {
    const alias = part.trim().replace(/\s+/g, ' ');
    const key = alias.toLowerCase();
    if (alias.length === 0 || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}

/** Why a dictionary word can't be saved as it is, in a sentence, or null when it can. */
export function dictionaryProblem(
  entry: DictionaryWord,
  others: readonly DictionaryWord[],
): string | null {
  const word = entry.word.trim();
  if (word.length === 0) return 'Type the word first.';
  if (word.length > DICTIONARY_LIMITS.wordLength)
    return `A word can be at most ${DICTIONARY_LIMITS.wordLength} characters.`;
  if (others.some((other) => other.word.trim().toLowerCase() === word.toLowerCase()))
    return `"${word}" is already in the dictionary.`;
  if (entry.aliases.length > DICTIONARY_LIMITS.aliases)
    return `A word can have at most ${DICTIONARY_LIMITS.aliases} spellings to replace.`;
  const short = entry.aliases.find(
    (alias) => alias.length < DICTIONARY_LIMITS.aliasMin || alias.length > DICTIONARY_LIMITS.aliasMax,
  );
  if (short !== undefined)
    return `"${short}" is too ${short.length < DICTIONARY_LIMITS.aliasMin ? 'short' : 'long'}: a spelling to replace is ${DICTIONARY_LIMITS.aliasMin} to ${DICTIONARY_LIMITS.aliasMax} characters.`;
  return null;
}

/** The Dictionary row's summary: "4 words + project names". */
export function dictionarySummary(settings: Pick<DictateSettings, 'dictionary' | 'addProjectNames'>): string {
  const count = settings.dictionary.length;
  const words = count === 0 ? 'No words' : `${count} word${count === 1 ? '' : 's'}`;
  return settings.addProjectNames ? `${words} + project names` : words;
}

/** The name the language list gives `code` ("Auto-detect", "English"), or the code itself. */
export function languageLabel(languages: readonly { code: string; label: string }[], code: string): string {
  return languages.find((entry) => entry.code === code)?.label ?? code;
}

/**
 * A recording's engine line for the phone: "Hex, Parakeet v3", the engine label gxserver gives,
 * or null before the computer has answered.
 */
export function engineLine(engine: Pick<DictateEngine, 'label'> | null): string | null {
  const label = engine?.label.trim() ?? '';
  return label.length > 0 ? label : null;
}

/**
 * What the chat's long-press menu says under the engine: where it transcribes, or why it can't yet,
 * in the phone's words (gxserver's own sentences say "Click" and "in Settings").
 */
export function engineStatusLine(engine: DictateEngine, computer: string): string {
  if (engine.ready) return `Transcribes on ${computer}${engine.polish ? ', then AI polish' : ''}.`;
  switch (engine.problem?.code) {
    case 'hexNotInstalled':
      return `Hex 3 isn't installed on ${computer}. Install it in Voice settings.`;
    case 'hexNotRunning':
      return `Hex isn't running on ${computer}. Open Hex there.`;
    case 'hexNoModels':
    case 'hexModelNotReady':
      return `Hex on ${computer} has no ready model for Dictate. Download one in Hex there, or pick another in Voice settings.`;
    case 'noKey':
      return `${computer} has no key for it yet. Add it in Ghostex Settings › Dictation there.`;
    case 'keyUnreadable':
      return `${computer} can't read its key anymore. Paste it again in Ghostex Settings › Dictation there.`;
    default:
      return engine.problem?.message ?? '';
  }
}

/** A gxserver too old to have these routes answers that the route is unknown. */
export function isUnknownRoute(error: { code?: string | null; message: string }): boolean {
  return error.code === 'notFound' || /unknown .*route|not found/i.test(error.message);
}

/** The engine row's caption on the phone: what transcribes, and what is missing for it. */
export function engineCaption(
  overview: Pick<DictateOverview, 'engine' | 'keys' | 'settings' | 'hex'>,
  computer: string,
): string {
  const { engine, keys } = overview;
  if (engine.engine === 'hex') return hexCaption(overview.hex, computer);
  if (engine.engine === 'local')
    return `${computer} still dictates with Ghostex's own speech model, which newer Ghostex replaces with Hex. Update Ghostex on ${computer}, or pick another engine.`;
  const provider = engine.engine === 'xai' ? 'xAI' : 'OpenAI';
  const key = keys[engine.engine];
  if (key?.unreadable)
    return `${computer} can't read its ${provider} key anymore. Paste it again in Ghostex Settings › Dictation there.`;
  if (key?.configured !== true) return `${computer} has no ${provider} key yet. Add it in Ghostex Settings › Dictation there.`;
  return `Recordings go to ${provider} with the key saved on ${computer}.`;
}
