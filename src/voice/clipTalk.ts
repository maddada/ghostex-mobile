/**
 * Recorded turns: the voice call for a phone whose call microphone keeps stopping.
 *
 * The phone lets go of its native call (the computer keeps the conversation for two minutes) and
 * joins it again from here, over its own `/api/voice` socket that carries only the control frames
 * and captions (the computer's audio is dropped). Holding Talk records with Dictate's recorder,
 * which runs without voice processing; letting go sends the recording to `/api/voiceAgentClip`,
 * which hands it to the call as the user's turn. The agent's replies are read aloud by the phone's
 * own speech voice (the Read aloud voice).
 *
 * CDXC:VoiceMode 2026-11-10 WHY: On the user's iPhone 15 Pro Max (iOS 27.2, app 11.2.1) every call said "The microphone stopped" and the agent heard nothing: switching voice processing on stops each new engine about 120 ms after it starts, and the 11.2.1 native code answers with another new engine that stops the same way. The user asked for voice to work over the air and on the computer, so this runs only on what 11.2.1 already has (Dictate's recorder, the speech voice, a JavaScript WebSocket) and only when the computer says it takes recorded turns (`clipTurns` from `readVoiceAgent`).
 * SEE-ALSO: server/src/voice_agent/clip.rs (the endpoint), src/voice/conversation.ts (when it starts).
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useSettingsStore } from '../settings/store';

/** Raw bytes per upload piece: under gxserver's 1 MiB JSON limit once base64 grows it by a third. */
const PIECE_BYTES = 512 * 1024;
const UPLOAD_TIMEOUT_MS = 30_000;
/** The computer keeps a call two minutes after its client went; the phone tries that long. */
const REJOIN_FOR_MS = 120_000;
const REJOIN_DELAYS_MS = [500, 1_000, 2_000, 3_000, 5_000];

type Handlers = {
  /** A JSON frame from the call, as the native socket would have reported it. */
  onFrame: (json: string) => void;
  /** The link dropped and the phone is joining again. */
  onRejoining: () => void;
  /** The phone could not join again in time, or the call refused it. */
  onLost: (message: string) => void;
};

type Link = {
  machine: MachineConnectionTarget;
  conversationId: string;
  handlers: Handlers;
  socket: WebSocket | null;
  /** The call ended or the phone hung up: a closed socket is final. */
  finished: boolean;
  lostAt: number | null;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  muted: boolean;
  /** Between `ready` and the next `state`: the computer replays the call so far, which is not read aloud again. */
  replaying: boolean;
};

let link: Link | null = null;
let recordingId: string | null = null;
let speechSeq = 0;
let speaking: string | null = null;
/** The latest reply read aloud, so the same caption is never read twice. */
let lastSpoken = '';

/** True while the call runs on recorded turns. */
export function clipTalkActive(): boolean {
  return link !== null && !link.finished;
}

/**
 * Joins `conversationId` on `machine` from JavaScript. The native call must already be let go of
 * (`voiceCancel`), so the computer sees this as the same client coming back.
 */
export function startClipTalk(
  machine: MachineConnectionTarget,
  conversationId: string,
  muted: boolean,
  handlers: Handlers,
): void {
  stopClipTalk();
  link = { machine, conversationId, handlers, socket: null, finished: false, lostAt: null, attempt: 0, timer: null, muted, replaying: false };
  logAppEvent('Voice agent: the call microphone keeps stopping; switching to recorded turns');
  void open(link);
}

async function open(current: Link): Promise<void> {
  if (link !== current || current.finished) return;
  let forward: { localPort: number; authToken: string } | null = null;
  try {
    forward = await chatMachineLink(current.machine).gxserverLink(current.attempt > 0 ? { repair: true } : undefined);
  } catch {
    forward = null;
  }
  if (link !== current || current.finished) return;
  if (forward === null) {
    retry(current);
    return;
  }
  const query = [
    'protocolVersion=1',
    'client=phone',
    'mode=conversation',
    `conversationId=${encodeURIComponent(current.conversationId)}`,
    `authToken=${encodeURIComponent(forward.authToken)}`,
  ].join('&');
  const socket = new WebSocket(`ws://127.0.0.1:${forward.localPort}/api/voice?${query}`);
  socket.binaryType = 'arraybuffer';
  current.socket = socket;
  socket.onmessage = (event) => {
    if (link !== current || typeof event.data !== 'string') return;
    onText(current, event.data);
  };
  socket.onclose = () => {
    if (link !== current || current.socket !== socket) return;
    current.socket = null;
    if (current.finished) return;
    retry(current);
  };
  socket.onerror = () => undefined;
}

function onText(current: Link, text: string): void {
  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return;
  }
  switch (frame.type) {
    case 'ready':
      current.lostAt = null;
      current.attempt = 0;
      current.replaying = true;
      if (typeof frame.conversationId === 'string' && frame.conversationId) current.conversationId = frame.conversationId;
      // The computer starts every client unmuted; this phone's Mute carries over.
      if (current.muted) send({ type: 'mute', muted: true });
      break;
    case 'state':
      current.replaying = false;
      break;
    case 'caption':
      if (!current.replaying && frame.role === 'agent' && frame.final === true && frame.cut !== true && typeof frame.text === 'string') {
        speak(frame.text);
      }
      break;
    case 'interrupted':
      stopSpeaking();
      break;
    case 'ended':
    case 'done':
      current.finished = true;
      break;
  }
  current.handlers.onFrame(text);
  if (current.finished) closeSocket(current);
}

function retry(current: Link): void {
  const now = Date.now();
  current.lostAt ??= now;
  if (now - current.lostAt > REJOIN_FOR_MS) {
    current.finished = true;
    current.handlers.onLost('The phone lost the computer for too long, so the conversation ended.');
    return;
  }
  current.handlers.onRejoining();
  const delay = REJOIN_DELAYS_MS[Math.min(current.attempt, REJOIN_DELAYS_MS.length - 1)];
  current.attempt += 1;
  current.timer = setTimeout(() => {
    current.timer = null;
    void open(current);
  }, delay);
}

function closeSocket(current: Link): void {
  if (current.timer !== null) clearTimeout(current.timer);
  current.timer = null;
  const socket = current.socket;
  current.socket = null;
  try {
    socket?.close();
  } catch {
    // Already closed.
  }
}

/** Sends a control frame on the call (mute, voice, focus, interrupt, memory). */
/** Sends a control frame on the call's socket; false when the socket is not open (rejoining). */
export function clipSend(frame: Record<string, unknown>): boolean {
  if (frame.type === 'mute' && link !== null) link.muted = frame.muted === true;
  return send(frame);
}

function send(frame: Record<string, unknown>): boolean {
  const socket = link?.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(frame));
  return true;
}

/** Hang up: the computer ends the call and answers `ended`. */
export function clipHangUp(): void {
  const current = link;
  if (current === null) return;
  send({ type: 'end' });
  current.finished = true;
  void stopRecordingTurn(true);
  stopSpeaking();
  setTimeout(() => closeSocket(current), 3_000);
}

/** Leaves recorded turns (the call ended, or the screen started another one). */
export function stopClipTalk(): void {
  const current = link;
  link = null;
  void stopRecordingTurn(true);
  stopSpeaking();
  if (current !== null) {
    current.finished = true;
    closeSocket(current);
  }
}

/** Talk pressed: the reply being read stops and the recorder starts. Answers an error sentence, or null. */
export async function clipTalkStart(): Promise<string | null> {
  if (!clipTalkActive()) return null;
  stopSpeaking();
  send({ type: 'interrupt' });
  try {
    recordingId = await GhostexNative.dictationRecordStart();
    return null;
  } catch {
    recordingId = null;
    return "Couldn't start the microphone.";
  }
}

/**
 * Talk released (`cancel` false: send what was said) or slid off (`cancel` true: drop it). Answers
 * an error sentence, or null.
 */
export async function clipTalkEnd(cancel: boolean): Promise<string | null> {
  const current = link;
  const recording = await stopRecordingTurn(cancel);
  if (recording === null || cancel || current === null || current.finished) return null;
  try {
    let offset = 0;
    for (;;) {
      const chunk = await GhostexNative.dictationReadPiece(recording.path, offset, PIECE_BYTES);
      const end = offset + Math.floor((chunk.length * 3) / 4) - (chunk.endsWith('==') ? 2 : chunk.endsWith('=') ? 1 : 0);
      const done = end >= recording.bytes || chunk.length === 0;
      const answer = await chatMachineLink(current.machine).rpc(
        'voiceAgentClip',
        { conversationId: current.conversationId, offset, chunk, done },
        UPLOAD_TIMEOUT_MS,
      );
      if (answer.error !== null) return `Couldn't send what you said (${answer.error.message.replace(/\.$/, '')}).`;
      if (done) return null;
      const received = (answer.result as { received?: number } | null)?.received;
      offset = typeof received === 'number' ? Math.min(received, recording.bytes) : end;
    }
  } catch {
    return "Couldn't send what you said. Hold Talk and say it again.";
  } finally {
    await GhostexNative.dictationForget(recording.path).catch(() => undefined);
  }
}

/**
 * Stops the turn's recording. It is closed as dismissed and, when dropped, deleted at once, so the
 * chat box never offers a voice call's turn as a dictation waiting for its words.
 */
async function stopRecordingTurn(
  cancel: boolean,
): Promise<{ path: string; bytes: number } | null> {
  if (recordingId === null) return null;
  recordingId = null;
  const recording = await GhostexNative.dictationRecordStop(true).catch(() => null);
  if (recording === null) return null;
  if (cancel) {
    await GhostexNative.dictationForget(recording.path).catch(() => undefined);
    return null;
  }
  return { path: recording.path, bytes: recording.bytes };
}

/** Reads an agent reply aloud with the phone's speech voice (the Read aloud voice and speed). */
function speak(text: string): void {
  const words = text.trim();
  if (!words || words === lastSpoken) return;
  lastSpoken = words;
  stopSpeaking();
  speechSeq += 1;
  const token = `voiceClip-${speechSeq}`;
  speaking = token;
  const { readAloudVoice, readAloudRate } = useSettingsStore.getState().settings;
  void GhostexNative.speechInit()
    .then(() => GhostexNative.speechSpeak(token, [words], readAloudVoice, readAloudRate))
    .catch(() => undefined);
}

function stopSpeaking(): void {
  const token = speaking;
  speaking = null;
  if (token !== null) void GhostexNative.speechStop(token).catch(() => undefined);
}
