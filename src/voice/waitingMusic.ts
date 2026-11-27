/**
 * Waiting music in a voice agent call on this phone: a quiet loop while the agent thinks or runs a tool, so silence
 * does not sound like a dropped call. This file keeps the setting (on or off, its own volume, the piece), saved on this
 * phone, hands it to the native call, and plays Settings › Voice's preview. When the music plays is decided natively
 * from the call's own `state` frames and reply audio (`GhostexWaitingMusicGate` in GhostexVoiceAudio.swift, which
 * holds the DECISION, and `WaitingMusicGate` in GhostexVoiceAudio.kt), so it works with the phone locked.
 *
 * CDXC:VoiceMode 2026-11-26 DECISION: The settings belong to this phone, one set per device, and the computer and its
 * desktop app are unchanged: a phone in a car holder can be set up differently from another one. They are on by
 * default at 30 % of the call's playback, with six CC0 pieces to choose from (music/PROVENANCE.md), each with a short
 * preview. The user chose Calm Loop as the piece a phone starts with; a piece already chosen and saved stays. The user
 * added Bossa Town and Coffee House Bump after the first four, at the end, so the list keeps its order.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { create } from 'zustand';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';

export type WaitingMusicPieceId =
  'ambientRelaxingLoop' | 'heavenlyLoop' | 'slowStride' | 'calmLoop' | 'bossaTown' | 'coffeeHouseBump';

export type WaitingMusicPiece = {
  readonly id: WaitingMusicPieceId;
  readonly title: string;
  readonly author: string;
  /** Metro's asset id of the bundled `.m4a`. */
  readonly asset: number;
};

/** The pieces, in Settings › Voice's order. */
export const WAITING_MUSIC_PIECES: readonly WaitingMusicPiece[] = [
  {
    id: 'ambientRelaxingLoop',
    title: 'Ambient Relaxing Loop',
    author: 'isaiah658',
    asset: require('./music/ambient-relaxing-loop.m4a') as number,
  },
  {
    id: 'heavenlyLoop',
    title: 'Heavenly Loop',
    author: 'isaiah658',
    asset: require('./music/heavenly-loop.m4a') as number,
  },
  { id: 'slowStride', title: 'Slow Stride', author: 'isaiah658', asset: require('./music/slow-stride.m4a') as number },
  { id: 'calmLoop', title: 'Calm Loop', author: 'wipics', asset: require('./music/calm-loop.m4a') as number },
  { id: 'bossaTown', title: 'Bossa Town', author: 'KarateStudios', asset: require('./music/bossa-town.m4a') as number },
  {
    id: 'coffeeHouseBump',
    title: 'Coffee House Bump',
    author: 'OatCog',
    asset: require('./music/coffee-house-bump.m4a') as number,
  },
];

export type WaitingMusicSettings = {
  enabled: boolean;
  /** Percent of the call's playback, the agent's voice playing at 100. */
  volumePercent: number;
  piece: WaitingMusicPieceId;
};

/** The volume is stepless between these, in percent of the call's playback; 0 is silent. */
export const WAITING_MUSIC_VOLUME_MIN = 0;
export const WAITING_MUSIC_VOLUME_MAX = 100;

export const WAITING_MUSIC_DEFAULTS: WaitingMusicSettings = {
  enabled: true,
  volumePercent: 30,
  piece: 'calmLoop',
};

/** How long Settings › Voice's preview of a piece plays before it fades out. */
export const WAITING_MUSIC_PREVIEW_SECONDS = 8;

const STORAGE_KEY = 'voice.waitingMusic';

/** A saved value as settings: anything missing or unreadable takes its default. */
export function sanitizeWaitingMusic(value: unknown): WaitingMusicSettings {
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const volume = record.volumePercent;
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : WAITING_MUSIC_DEFAULTS.enabled,
    volumePercent:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(WAITING_MUSIC_VOLUME_MAX, Math.max(WAITING_MUSIC_VOLUME_MIN, volume))
        : WAITING_MUSIC_DEFAULTS.volumePercent,
    piece: WAITING_MUSIC_PIECES.some((piece) => piece.id === record.piece)
      ? (record.piece as WaitingMusicPieceId)
      : WAITING_MUSIC_DEFAULTS.piece,
  };
}

/** Whether this app build plays waiting music (builds from before it have no native side for it). */
export function waitingMusicSupported(): boolean {
  return typeof GhostexNative.voiceSetWaitingMusic === 'function';
}

type WaitingMusicState = {
  settings: WaitingMusicSettings;
  /** The saved settings were read (until then `settings` holds the defaults). */
  loaded: boolean;
  /** The piece Settings › Voice previews now. */
  previewing: WaitingMusicPieceId | null;
};

export const useWaitingMusicStore = create<WaitingMusicState>(() => ({
  settings: WAITING_MUSIC_DEFAULTS,
  loaded: false,
  previewing: null,
}));

let loading: Promise<WaitingMusicSettings> | null = null;

/** Reads the saved settings once per app run; the defaults when none were saved or they can't be read. */
export function loadWaitingMusic(): Promise<WaitingMusicSettings> {
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((saved) => (saved === null ? WAITING_MUSIC_DEFAULTS : sanitizeWaitingMusic(JSON.parse(saved))))
    .catch(() => WAITING_MUSIC_DEFAULTS)
    .then((settings) => {
      useWaitingMusicStore.setState({ settings, loaded: true });
      return settings;
    });
  return loading;
}

/**
 * The piece's file on this phone (expo-asset's copy), or null when this build or update has none.
 *
 * CDXC:VoiceMode 2026-11-26 WHY: expo-asset leaves the URI empty when it finds no local copy, and `downloadAsync()`
 * then answers `file:///`, a folder (CDXC:SessionChat 2026-11-02 in ChatCoreWebView.tsx), so both are taken as no file.
 */
async function pieceFile(id: WaitingMusicPieceId): Promise<string | null> {
  const piece = WAITING_MUSIC_PIECES.find((candidate) => candidate.id === id) ?? WAITING_MUSIC_PIECES[0];
  try {
    const asset = Asset.fromModule(piece.asset);
    if (asset.localUri == null && asset.uri === '') return null;
    const downloaded = await asset.downloadAsync();
    const uri = downloaded.localUri ?? '';
    return uri === '' || uri.endsWith('/') ? null : uri;
  } catch (error) {
    logAppEvent(
      `Voice agent: the waiting music ${piece.title} could not be found (${error instanceof Error ? error.message : String(error)})`,
    );
    return null;
  }
}

/**
 * Every change of the setting, and every call's hand-over, takes the next number when it is made; once its piece's
 * file is found, it goes to the native side only if no newer one came meanwhile. The native module runs its calls in
 * the order they are made, so the newest one is what the call keeps.
 *
 * CDXC:VoiceMode 2026-11-26 WHY: Finding a piece's file can take a while (expo-asset may copy or download it), and so
 * can saving, so an older change could finish after a newer one, such as turning the music off, and undo it natively
 * while Settings › Voice shows the newer one.
 */
let generation = 0;

/**
 * The call the setting goes to: `voiceStart`'s session, while `current` says it still runs. A call starts natively
 * without music and plays only what is handed over with its own session (GhostexVoice.swift's `setWaitingMusic`).
 */
let call: { session: string; current: () => boolean } | null = null;

/** The session of the call running now, or null. */
function runningCall(): string | null {
  return call !== null && call.current() ? call.session : null;
}

/**
 * Hands `settings` (change number `sent`) to the native side for the call `session` (null: no call, only a preview's
 * volume), unless a newer change came or that call ended by the time the piece's file is found. An app build without
 * waiting music: nothing happens.
 */
async function sendWaitingMusic(settings: WaitingMusicSettings, sent: number, session: string | null): Promise<void> {
  if (!waitingMusicSupported()) return;
  const path = settings.enabled ? await pieceFile(settings.piece) : null;
  if (sent !== generation || (session !== null && runningCall() !== session)) return;
  await GhostexNative.voiceSetWaitingMusic?.(
    settings.enabled && path !== null,
    settings.volumePercent / 100,
    path,
    session,
  );
}

/**
 * A call has opened (`session`, `voiceStart`'s answer), or JavaScript found one still running after a reload: this
 * phone's settings follow it to the native side once the piece's file is found, while `current` says the call still
 * runs, and so do the changes made during it. Never throws; a failure leaves the call without music.
 *
 * CDXC:VoiceMode 2026-11-26 WHY: The music is optional, so the call never waits for it: finding the file or reading
 * the saved setting has no time limit of its own, and the call would stay at "Connecting…" meanwhile.
 */
export async function prepareWaitingMusicForCall(session: string, current: () => boolean): Promise<void> {
  if (!waitingMusicSupported()) return;
  call = { session, current };
  generation += 1;
  const sent = generation;
  try {
    await loadWaitingMusic();
    // The settings as shown now: a change made while they were read is in them.
    await sendWaitingMusic(useWaitingMusicStore.getState().settings, sent, session);
  } catch (error) {
    logAppEvent(
      `Voice agent: the waiting music could not be set up (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

/** Settings › Voice changed a setting: shown at once, saved on this phone, and handed to a call that is running. */
export async function changeWaitingMusic(patch: Partial<WaitingMusicSettings>): Promise<void> {
  // Numbered as it is made, before any wait, so the order of the user's changes decides what the call gets; and meant
  // for the call running when it is made, never for one that starts later (that one is handed its own).
  generation += 1;
  const sent = generation;
  const session = runningCall();
  await loadWaitingMusic();
  const settings = sanitizeWaitingMusic({ ...useWaitingMusicStore.getState().settings, ...patch });
  useWaitingMusicStore.setState({ settings });
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    logAppEvent(
      `Voice agent: the waiting music setting could not be saved (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  try {
    await sendWaitingMusic(settings, sent, session);
  } catch (error) {
    logAppEvent(
      `Voice agent: the waiting music setting could not reach the call (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

let previewTimer: ReturnType<typeof setTimeout> | undefined;
/** Each preview start and each stop takes the next number: a start whose number is no longer the latest goes no further. */
let previewRun = 0;
/** A preview went to the native side and no stop since: it may still play (or fade out by itself). */
let previewHandedOver = false;

function clearPreviewTimer(): void {
  clearTimeout(previewTimer);
  previewTimer = undefined;
}

/** Plays a few seconds of `id` at the volume set, replacing a preview that plays. */
export async function previewWaitingMusic(id: WaitingMusicPieceId): Promise<void> {
  if (typeof GhostexNative.voicePreviewWaitingMusic !== 'function') return;
  // The preview that plays, or one still starting, ends now, also when this piece turns out to have no file.
  stopWaitingMusicPreview();
  const run = previewRun;
  useWaitingMusicStore.setState({ previewing: id });
  const path = await pieceFile(id);
  // Stopped (Stop, or the page was left) or replaced while the file was looked up.
  if (run !== previewRun) return;
  if (path === null) {
    useWaitingMusicStore.setState({ previewing: null });
    return;
  }
  previewHandedOver = true;
  try {
    await GhostexNative.voicePreviewWaitingMusic(
      path,
      useWaitingMusicStore.getState().settings.volumePercent / 100,
      WAITING_MUSIC_PREVIEW_SECONDS,
    );
  } catch (error) {
    if (run === previewRun) useWaitingMusicStore.setState({ previewing: null });
    logAppEvent(
      `Voice agent: the waiting music preview could not play (${error instanceof Error ? error.message : String(error)})`,
    );
    return;
  }
  // A stop made while it started reached the native side after it (calls run in order) and ended it there.
  if (run !== previewRun) return;
  previewTimer = setTimeout(() => {
    previewTimer = undefined;
    if (run === previewRun) useWaitingMusicStore.setState({ previewing: null });
  }, WAITING_MUSIC_PREVIEW_SECONDS * 1000);
}

/** Stops the preview, and cancels one still starting (Stop, leaving Settings › Voice, another piece's preview). */
export function stopWaitingMusicPreview(): void {
  previewRun += 1;
  clearPreviewTimer();
  if (useWaitingMusicStore.getState().previewing !== null) useWaitingMusicStore.setState({ previewing: null });
  if (!previewHandedOver) return;
  previewHandedOver = false;
  void GhostexNative.voiceStopWaitingMusicPreview?.().catch(() => undefined);
}
