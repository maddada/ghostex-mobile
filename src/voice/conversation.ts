/**
 * Voice mode: a spoken conversation with the manager voice agent that runs in the connected
 * computer's gxserver (docs/2026-10-20/voice-mode/voice-agent-client-contract.md).
 *
 * The phone only streams the microphone in and plays the agent out; gxserver owns the provider,
 * the API keys, the tools and the idle hang-up. The audio, the socket and its reattach ladder run in
 * Kotlin (`GhostexVoice.kt`) and Swift (`GhostexVoice.swift`) so the conversation keeps going with
 * the screen locked. This file keeps the state the voice screen draws (state, captions, tool rows, errors) and answers the native
 * side's `linkNeeded` by rebuilding the SSH forward to the computer.
 *
 * CDXC:VoiceMode 2026-10-20 DECISION: User: "the one in the chat box just pastes whatever i say into the chat box, while the one above is more general and for discussing". The phone's top bar has a global Voice button that starts and ends a conversation with the manager voice agent; it keeps going while you move between screens and with the phone locked ("Voice mode on" notification with Hang up). The composer's Dictate microphone is the other entry point (`src/chat/native/composer/useDictation.ts`).
 * CDXC:VoiceMode 2026-10-20 DECISION: The API keys live on the computer; the phone never stores one. When the computer has none, the phone says so and points to Ghostex Settings › Extensions › Voice agent on that computer.
 * CDXC:VoiceMode 2026-10-21 SEE-ALSO: the call mode (`voiceAgentCallMode`, regular or push-to-talk) is the user's DECISION in server/src/voice_agent/conversation.rs (`talk_start`); the phone shows it in the gear sheet and Settings › Voice agent and holds Talk with `setVoiceTalking`.
 * CDXC:VoiceMode 2026-10-24 SEE-ALSO: what a hold does (push-to-talk, hold to unmute in a muted Regular call, Mute wins, a tap's hint, a dropped link) is the user's DECISION in server/src/voice_agent/talk.rs; the phone's hold button and its slide-off cancel are `src/voice/VoiceHoldButton.tsx`.
 * CDXC:VoiceMode 2026-10-20 DECISION: User: "on the voice mode screen, the user should be able to click on Eve to change the voice, and click buttons to change the voice agent's speed, with options 1, 1.2, 1.4, 1.6, 1.8, and 2", and the phone's voice screen gets the same picker and speed control, reading and saving the computer's settings (`voiceAgentXaiVoice` / `voiceAgentOpenaiVoice`, `voiceAgentSpeed`) through gxserver's `setVoiceAgentSettings`. The speed is played on the phone (`AudioTrack` playback rate, pitch kept) like the desktop's time stretch. Later the same day: "Move the voice speed control from the bottom bar into the top-right picker. Add a smaller button to its right that opens a speed menu when clicked, so users can pick a different speed without the bottom bar." (phone confirmed): the speed is a small button right of the voice chip that opens a speed sheet, superseding the row of speed buttons above Mute and Hang up.
 */

import { Platform } from 'react-native';
import { create } from 'zustand';

import { GhostexNative, type VoiceEvent } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from '../machines/credentials';
import { enabledMachines, useMachinesStore } from '../machines/store';
import {
  focusChangeNotice,
  focusQuery,
  focusRef,
  outdatedFocusMessage,
  outdatedGbotCallMessage,
  parseFocus,
  readyFocus,
  readyFromOlderServer,
  type VoiceFocus,
  type VoiceFocusTarget,
} from './focus';
import {
  clipHangUp,
  clipSend,
  clipTalkActive,
  clipTalkEnd,
  clipTalkStart,
  startClipTalk,
  stopClipTalk,
} from './clipTalk';
import { saveGbotVoice } from './gbotVoice';
import { captionParagraphs, toolLineFrame } from './lines';
import { microphoneAllowed, microphoneDeniedMessage } from './microphone';

/** Where the conversation is: not running, opening, talking, reconnecting after a dropped link, over. */
export type VoicePhase = 'idle' | 'starting' | 'live' | 'reattaching' | 'ended';

/** gxserver's `state` frame values. */
export type VoiceAgentState = 'connecting' | 'listening' | 'userSpeaking' | 'thinking' | 'speaking' | 'toolRunning';

export type VoiceLine =
  /** `paragraphs`: gxserver's paragraphs of a long agent reply (`lines.ts`); empty: `text` is one. */
  | { kind: 'caption'; key: string; role: 'user' | 'agent'; text: string; paragraphs: string[]; final: boolean; cut: boolean }
  | { kind: 'tool'; key: string; label: string; finished: boolean; ok: boolean }
  | { kind: 'announcement'; key: string; text: string }
  | { kind: 'notice'; key: string; text: string };

export type VoiceProblem = { code: string; message: string };

/** The remembered last conversation gxserver names in `ready` (server/src/voice_agent/memory.rs). */
export type VoiceMemory = { gist: string; summary: string; endedAt: string };

/**
 * What the screen shows of it: the Continue / Start fresh card, "Remembering last conversation",
 * "Forgot the last conversation.", or nothing (none remembered, Start fresh, or the user just talked).
 */
export type VoiceMemoryState = 'hidden' | 'offered' | 'continued' | 'forgotten';

type VoiceState = {
  phase: VoicePhase;
  machineId: string | null;
  machineName: string;
  agentState: VoiceAgentState;
  muted: boolean;
  /** Another app (a call, a navigation prompt) has the audio; the conversation waits for it. */
  paused: boolean;
  /** The tool running right now, for the state line. */
  toolLabel: string | null;
  lines: VoiceLine[];
  problem: VoiceProblem | null;
  /** Why it ended, in one sentence, once `phase` is `ended`. */
  endedMessage: string | null;
  /** `xai` or `openai`, the voice the agent speaks with now and the provider's voices (`ready`). */
  provider: string | null;
  voice: string | null;
  voiceOptions: string[];
  /** A picked voice this conversation could not switch to: it speaks from the next one. */
  nextVoice: string | null;
  /** How fast the agent's audio plays (`voiceAgentSpeed`). */
  speed: number;
  /** `voiceAgentCallMode`: the kind of call the next one will be (the gear sheet's tick). */
  callMode: VoiceCallMode;
  /** This call is push-to-talk (`ready` said so, or a later `callMode` frame), and whether Talk is held. */
  pushToTalk: boolean;
  /** This call's gxserver switches a running call when the call mode changes (`ready.callModeLive`). */
  callModeLive: boolean;
  /** A short note the voice screen shows as a toast; a new `id` shows it again. */
  toast: { id: number; message: string } | null;
  talking: boolean;
  /** A short note above the buttons ("Unmute to talk", "Hold to talk, then let go to send"). */
  hint: string | null;
  memory: VoiceMemory | null;
  memoryState: VoiceMemoryState;
  /** The latest session the agent showed (worked with or was asked to show), for the voice screen's "Open <session>" chip. */
  shownSession: VoiceShownSession | null;
  /** The session the call is about (gxserver's `ready.focus` / `focus` frames), or null for all sessions. */
  focus: VoiceFocus | null;
  /** The session a call being started was asked to be about, until gxserver's `ready` names it. */
  requestedFocus: VoiceFocusTarget | null;
  /** The call microphone kept stopping, so each turn is recorded while Talk is held (`clipTalk.ts`). */
  clipTalk: boolean;
};

/** `regular`: hands-free; `pushToTalk`: the agent hears you only while you hold the talk button. */
export type VoiceCallMode = 'regular' | 'pushToTalk';

/** The two call modes with their pricing lines, for the gear sheet and Settings › Voice agent. */
export const VOICE_CALL_MODES: { mode: VoiceCallMode; label: string; detail: string }[] = [
  {
    mode: 'regular',
    label: 'Regular',
    detail: 'Hands-free. On Grok you pay for the whole time the call is connected, quiet and muted time included (about $0.08 a minute).',
  },
  {
    mode: 'pushToTalk',
    label: 'Push-to-talk',
    detail: "Hold the talk button to speak. On Grok you pay only for the audio you send and the agent's replies.",
  },
];

/** Computers whose gxserver said `callModeLive` (it switches a running call's mode), in a call's `ready` or in `readVoiceAgent`, since the app started. */
const liveCallModeComputers = new Set<string>();

/**
 * Said once under the two modes: GPT Realtime bills by audio either way, and when a change applies.
 * `live`: the computer switches a running call (`ready.callModeLive`); an older one keeps the call's
 * mode until the next call.
 */
export function voiceCallModeNote(live: boolean): string {
  return live
    ? 'GPT Realtime bills only audio in both modes. A change switches a running call at once.'
    : 'GPT Realtime bills only audio in both modes. A change applies to your next call.';
}

/** Whether `machineId`'s gxserver is known to switch a running call's mode (a call or `readVoiceAgent` there said so). */
export function callModeSwitchesLive(machineId: string): boolean {
  return liveCallModeComputers.has(machineId);
}

/** A session the agent showed, as gxserver names it on the tool event (`server/src/voice_agent/show.rs`). */
export type VoiceShownSession = { projectId: string; sessionId: string; title: string };

const INITIAL: VoiceState = {
  phase: 'idle',
  machineId: null,
  machineName: '',
  agentState: 'connecting',
  muted: false,
  paused: false,
  toolLabel: null,
  lines: [],
  problem: null,
  endedMessage: null,
  provider: null,
  voice: null,
  voiceOptions: [],
  nextVoice: null,
  speed: 1,
  callMode: 'regular',
  pushToTalk: false,
  callModeLive: false,
  toast: null,
  talking: false,
  hint: null,
  memory: null,
  memoryState: 'hidden',
  shownSession: null,
  focus: null,
  requestedFocus: null,
  clipTalk: false,
};

/** Lines kept on screen; older ones scroll away for good. */
const MAX_LINES = 120;
const READ_TIMEOUT_MS = 15_000;

export const useVoiceStore = create<VoiceState>(() => INITIAL);

/** The native voice session this store follows, and the computer it talks to. */
let nativeSessionId: string | null = null;
let target: MachineConnectionTarget | null = null;
let relinking = false;
let noticeSeq = 0;
let installed = false;
/** The call being started asked for a focus: its first `ready` must carry the `focus` key. */
let askedForFocus = false;

/** How long a hint stays above the voice screen's buttons. */
const HINT_MS = 2_500;
let hintTimer: ReturnType<typeof setTimeout> | null = null;

export const HINT_TOO_SHORT = 'Hold to talk, then let go to send';
export const HINT_UNMUTE = 'Unmute to talk';
export const HINT_ALREADY_HEARD = 'Mute first, then hold to talk';
export const HINT_CANCELLED = 'Talk cancelled';

export const MODE_NOW_REGULAR = 'Microphone is open: regular mode';
export const MODE_NOW_PUSH_TO_TALK = 'Hold to speak is on';
const MODE_NEXT_REGULAR = 'Regular mode starts with your next call';
const MODE_NEXT_PUSH_TO_TALK = 'Hold to speak starts with your next call';

let toastCount = 0;

/** Shows `message` as the voice screen's toast. */
function showVoiceToast(message: string): void {
  toastCount += 1;
  set({ toast: { id: toastCount, message } });
}

/** Shows a short note above the buttons for a moment. */
export function flashVoiceHint(text: string): void {
  if (hintTimer !== null) clearTimeout(hintTimer);
  set({ hint: text });
  hintTimer = setTimeout(() => {
    hintTimer = null;
    set({ hint: null });
  }, HINT_MS);
}

/**
 * Voice mode needs the phone's native voice engine (GhostexVoice.kt on Android, GhostexVoice.swift
 * with CallKit on iOS).
 *
 * CDXC:VoiceMode 2026-11-04 DECISION: Issue #412 ("Ship the Ghostex iPhone app with voice mode: the same voice agent call the Android app has today"), started by the user ("Yes, start it now"): the iPhone gets the voice agent call, Dictate and Read aloud with the same screens; the call is a CallKit call (GhostexVoiceCall.swift says why).
 */
export const VOICE_SUPPORTED = Platform.OS === 'android' || Platform.OS === 'ios';

/** The speeds the speed buttons offer (`voiceAgentSpeed`). */
export const VOICE_SPEEDS = [1, 1.2, 1.4, 1.6, 1.8, 2] as const;

/** "Grok" / "GPT Realtime", for "Grok · Eve". */
export function voiceProviderName(provider: string | null): string {
  return provider === 'openai' ? 'GPT Realtime' : 'Grok';
}

/** "eve" → "Eve". */
export function voiceName(voice: string): string {
  return voice.length > 0 ? voice[0].toUpperCase() + voice.slice(1) : voice;
}

/**
 * One sentence per error code (the contract's section 3), in the phone's words, naming the computer
 * whose key is missing or refused and the Settings page that holds it.
 *
 * CDXC:VoiceMode 2026-11-09 WHY: The phone said "Add your xAI API key in Ghostex Settings › Extensions › Voice agent on your computer" after the key moved to Settings › Voice Agent, and never said which computer, so a person with the key on one computer and the phone on another could not tell what was missing where.
 */
export function problemMessage(code: string, serverMessage: string, provider: string | null, computer = ''): string {
  const providerName = provider === 'openai' ? 'OpenAI' : 'xAI';
  const on = computer.length > 0 ? computer : 'your computer';
  switch (code) {
    case 'noKey':
      return `Ghostex on ${on} has no ${providerName} API key for the voice agent. Add it in Settings › Voice Agent on ${on}.`;
    case 'unreadableKey':
      return `The ${providerName} API key saved on ${on} can't be read anymore. Paste it again in Settings › Voice Agent on ${on}.`;
    case 'badKey':
      return `${providerName} refused the API key saved on ${on}. Check it in Settings › Voice Agent on ${on}.`;
    case 'providerUnavailable':
      return `Couldn't reach the voice service from ${on}. Check its internet connection and try again.`;
    case 'notFound':
      return 'That conversation already ended. Start a new one.';
    case 'turnedOff':
      return `The voice agent is turned off on ${on}. Turn it on in Ghostex Settings › Extensions there.`;
    default:
      return serverMessage || 'The voice agent ran into a problem.';
  }
}

/** Why a conversation ended (`ended.reason`), in one sentence. */
function endedMessage(reason: string, serverMessage: string): string {
  switch (reason) {
    case 'user':
      return 'You hung up.';
    case 'idle':
      return 'Hung up after 5 minutes with nobody talking.';
    case 'providerClosed':
      return 'The voice service ended the conversation.';
    case 'detachedTooLong':
    case 'lost':
      return 'The phone lost the computer for too long, so the conversation ended.';
    case 'replaced':
      return 'The conversation moved to another device.';
    case 'serverShutdown':
      return 'Ghostex on the computer restarted, so the conversation ended.';
    case 'turnedOff':
      return 'The voice agent was turned off on your computer, so the conversation ended.';
    default:
      return serverMessage || 'The conversation ended.';
  }
}

function parseMemory(value: unknown): VoiceMemory | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string).trim() : '');
  const summary = text('summary');
  return summary ? { gist: text('gist'), summary, endedAt: text('endedAt') } : null;
}

/** "25 min ago", "yesterday", for the memory card. */
export function memoryAgo(endedAt: string): string {
  const ended = Date.parse(endedAt);
  if (Number.isNaN(ended)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - ended) / 60_000));
  if (minutes === 0) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 2880) return 'yesterday';
  return `${Math.floor(minutes / 1440)} days ago`;
}

function set(partial: Partial<VoiceState>): void {
  useVoiceStore.setState(partial);
}

function pushLine(line: VoiceLine): void {
  const lines = useVoiceStore.getState().lines;
  const index = lines.findIndex((entry) => entry.key === line.key);
  const next = index >= 0 ? lines.map((entry, at) => (at === index ? line : entry)) : [...lines, line];
  set({ lines: next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next });
}

/**
 * CDXC:VoiceMode 2026-11-09 WHY: GitHub #500 (Jakey, iPhone): every try added another "The microphone
 * stopped.", 3 to 10 in a row, which buried the captions. A notice the screen already shows as its last line
 * is not added again; one that comes back after something else happened still shows.
 */
function notice(text: string): void {
  const last = useVoiceStore.getState().lines.at(-1);
  if (last?.kind === 'notice' && last.text === text) return;
  noticeSeq += 1;
  pushLine({ kind: 'notice', key: `notice-${noticeSeq}`, text });
}

function parseShownSession(value: unknown): VoiceShownSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const { projectId, sessionId, title } = value as Record<string, unknown>;
  if (typeof projectId !== 'string' || typeof sessionId !== 'string' || typeof title !== 'string') return null;
  if (projectId.length === 0 || sessionId.length === 0) return null;
  return { projectId, sessionId, title };
}

/**
 * CDXC:VoiceMode 2026-10-23 DECISION: User, asked "How does the phone's voice screen show which session the call is about?", picked "The screen stays as it is, with a line "Only about Voice mode" above the captions". The voice screen keeps its "Voice agent" title and gets an "Only about <title> (<project>)" line above the captions; the "Open <title>" chip stays on the focused session for the whole call instead of following the sessions the agent touched.
 */
function shownFromFocus(focus: VoiceFocus): VoiceShownSession {
  return { projectId: focus.projectId, sessionId: focus.sessionId, title: focus.title };
}

function finish(message: string, problem?: VoiceProblem): void {
  nativeSessionId = null;
  clearMicRetries();
  stopClipTalk();
  set({
    phase: 'ended',
    endedMessage: message,
    toolLabel: null,
    paused: false,
    shownSession: null,
    ...(problem ? { problem } : {}),
  });
}

let currentProvider: string | null = null;

/**
 * One line in the phone's Logs sheet about the call (GitHub #500: the Logs had nothing about voice, so a
 * report could not show why the microphone stopped). Never what the person said or typed, nor a reply's
 * words: captions, typed turns and announcements stay out, and so do session titles.
 */
function voiceLog(message: string): void {
  logAppEvent(`Voice agent: ${message}`);
}

/** The agent's last state logged, so a call logs each change once. */
let loggedAgentState = '';

function onFrame(json: string): void {
  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return;
  }
  const text = (key: string): string => (typeof frame[key] === 'string' ? (frame[key] as string) : '');
  switch (frame.type) {
    case 'ready': {
      if (readyFromOlderServer(askedForFocus, frame)) {
        // An older gxserver ignored the focus and opened an all-sessions call: hang it up.
        askedForFocus = false;
        void GhostexNative.voiceEnd('conversation').catch(() => undefined);
        const message = outdatedFocusMessage(useVoiceStore.getState().machineName);
        finish(message, { code: 'outdated', message });
        return;
      }
      askedForFocus = false;
      if (switchOnReady && target !== null && nativeSessionId !== null) {
        switchOnReady = false;
        // Once this frame is drawn the native call has its id; the phone joins it from JavaScript.
        setTimeout(() => {
          if (target !== null) void switchToClipTalk(target);
        }, 0);
      }
      const scope = readyFocus(frame);
      // A reattach redraws the banner from `ready.focus`; an older gxserver's all-sessions call has none.
      const focus = scope.kind === 'focus' ? scope.focus : null;
      set({
        focus,
        requestedFocus: null,
        ...(focus !== null ? { shownSession: shownFromFocus(focus) } : {}),
      });
      currentProvider = text('provider') || currentProvider;
      const options = Array.isArray(frame.voiceOptions)
        ? frame.voiceOptions.filter((voice): voice is string => typeof voice === 'string')
        : [];
      const memory = parseMemory(frame.memory);
      const callModeLive = frame.callModeLive === true;
      if (callModeLive && target !== null) liveCallModeComputers.add(target.id);
      /*
       * A `ready` again in the same call (`resumed`: a reattach, or gxserver's mid-call mode switch,
       * which sends `memory: null` unless the call continued it) keeps the memory card as it was.
       */
      const keepMemory = frame.resumed === true && memory === null;
      voiceLog(
        `${frame.resumed === true ? 'the call is back' : 'the call is ready'} (${currentProvider ?? 'unknown provider'}, ${
          frame.callMode === 'pushToTalk' ? 'push to talk' : 'regular'
        }, ${focus !== null ? 'about one session' : 'all sessions'})`,
      );
      set({
        phase: 'live',
        problem: null,
        provider: currentProvider,
        voice: text('voice') || null,
        ...(options.length > 0 ? { voiceOptions: options } : {}),
        pushToTalk: frame.callMode === 'pushToTalk',
        callModeLive,
        // Such a gxserver switches the call when the mode is saved, so the call's mode is the setting's.
        ...(callModeLive ? { callMode: frame.callMode === 'pushToTalk' ? ('pushToTalk' as const) : ('regular' as const) } : {}),
        talking: false,
        ...(keepMemory
          ? {}
          : {
              memory,
              memoryState: memory === null ? 'hidden' : frame.memoryContinued === true ? 'continued' : 'offered',
            }),
      });
      return;
    }
    case 'callMode': {
      // The running call switched mode (CDXC:VoiceMode 2026-11-10 on `setCallMode`).
      const pushToTalk = frame.callMode === 'pushToTalk';
      const state = useVoiceStore.getState();
      if (pushToTalk === state.pushToTalk) return;
      voiceLog(`the computer switched the call to ${pushToTalk ? 'push to talk' : 'regular'}`);
      set({
        pushToTalk,
        callMode: pushToTalk ? 'pushToTalk' : 'regular',
        talking: pushToTalk ? state.talking : false,
        hint: null,
      });
      showVoiceToast(pushToTalk ? MODE_NOW_PUSH_TO_TALK : MODE_NOW_REGULAR);
      return;
    }
    case 'memory': {
      // Continued (the button or the agent's own recall), nothing to continue, or forgotten anywhere.
      voiceLog(`memory ${text('state') || 'hidden'}`);
      if (frame.state === 'continued') {
        set({ memory: parseMemory(frame.memory) ?? useVoiceStore.getState().memory, memoryState: 'continued' });
      } else if (frame.state === 'forgotten') {
        set({ memory: null, memoryState: 'forgotten' });
      } else {
        set({ memory: null, memoryState: 'hidden' });
      }
      return;
    }
    case 'voice': {
      // gxserver's answer to a picked voice: switched now, or kept for the next conversation.
      const voice = text('voice');
      voiceLog(`voice ${voice || 'unknown'} ${frame.applied === 'now' ? 'switched now' : `kept for the next call (${text('reason') || 'no reason'})`}`);
      if (frame.applied === 'now') {
        set({ voice, nextVoice: null });
        return;
      }
      if (useVoiceStore.getState().nextVoice === voice) return;
      set({ nextVoice: voice });
      const provider = voiceProviderName(currentProvider);
      notice(
        frame.reason === 'providerLocksVoice'
          ? `${provider} keeps a call's voice once it has spoken, so ${voiceName(voice)} speaks from your next conversation.`
          : `${provider} didn't switch voices mid-call, so ${voiceName(voice)} speaks from your next conversation.`,
      );
      return;
    }
    case 'focus': {
      // The scope changed: one the phone asked for, the agent widening it by voice, or the session closing.
      const next = parseFocus(frame.focus);
      voiceLog(next !== null ? 'the call is about one session now' : 'the call is about all sessions now');
      const note = focusChangeNotice(useVoiceStore.getState().focus, next);
      set({ focus: next, ...(next !== null ? { shownSession: shownFromFocus(next) } : {}) });
      if (note !== null) notice(note);
      return;
    }
    case 'talk':
      // gxserver's word on a hold (server/src/voice_agent/talk.rs).
      voiceLog(`the computer said the hold was ${text('event') || 'answered'}`);
      if (frame.event === 'tooShort') flashVoiceHint(HINT_TOO_SHORT);
      else if (frame.event === 'refused') {
        set({ talking: false });
        flashVoiceHint(HINT_UNMUTE);
      } else if (frame.event === 'cancelled') flashVoiceHint(HINT_CANCELLED);
      return;
    case 'state':
      if (text('state') !== loggedAgentState) {
        loggedAgentState = text('state');
        voiceLog(`the agent is ${loggedAgentState || 'listening'}`);
      }
      set({
        agentState: (text('state') || 'listening') as VoiceAgentState,
        ...(text('state') === 'toolRunning' ? {} : { toolLabel: null }),
      });
      return;
    case 'caption': {
      // An interrupted reply ends with one `cut` caption holding only the words that were played;
      // it replaces the reply's caption by `itemId` even when that one was already final.
      const role = frame.role === 'user' ? 'user' : 'agent';
      // Talking with the memory card still up counts as Start fresh.
      if (role === 'user' && text('text').trim() && useVoiceStore.getState().memoryState === 'offered') {
        set({ memoryState: 'hidden' });
      }
      pushLine({
        kind: 'caption',
        key: `caption-${text('itemId')}`,
        role,
        text: text('text'),
        paragraphs: captionParagraphs(frame),
        final: frame.final === true,
        cut: frame.cut === true,
      });
      return;
    }
    case 'tool': {
      const finished = frame.phase === 'finished';
      const label = text('label') || text('name');
      // The tool's name only: its label and arguments can carry what was said.
      voiceLog(`tool ${text('name') || 'unnamed'} ${finished ? 'finished' : text('phase') || 'started'}`);
      pushLine({ kind: 'tool', ...toolLineFrame(frame) });
      set({ toolLabel: finished ? null : label });
      // In a call about one session the Open chip stays on that session (`shownFromFocus`).
      const shown = finished && useVoiceStore.getState().focus === null ? parseShownSession(frame.session) : null;
      if (shown !== null) set({ shownSession: shown });
      return;
    }
    case 'announcement':
      noticeSeq += 1;
      pushLine({ kind: 'announcement', key: `announcement-${noticeSeq}`, text: text('text') });
      return;
    case 'error': {
      const code = text('code');
      const message = problemMessage(code, text('message'), currentProvider, useVoiceStore.getState().machineName);
      logAppEvent(`Voice agent: ${code || 'error'}${frame.fatal === true ? ' (call ended)' : ''}: ${message}`);
      if (frame.fatal === true) set({ problem: { code, message } });
      else notice(message);
      return;
    }
    case 'ended': {
      const reason = text('reason');
      voiceLog(`the call ended (${reason || 'no reason'})`);
      const problem = useVoiceStore.getState().problem;
      finish(reason === 'error' && problem !== null ? problem.message : endedMessage(reason, text('message')));
      return;
    }
  }
}

/** The native link dropped: rebuild the SSH forward (and token) and hand it back. */
async function relink(): Promise<void> {
  if (relinking || target === null) return;
  relinking = true;
  voiceLog('the call asked for a new link to the computer');
  try {
    const link = await chatMachineLink(target).gxserverLink({ repair: true });
    if (link !== null && nativeSessionId !== null) {
      await GhostexNative.voiceUpdateLink('conversation', link.localPort, link.authToken);
    }
    voiceLog(link !== null ? 'a new link to the computer is ready' : 'no new link to the computer yet');
  } catch (error) {
    // The native ladder asks again on its next attempt.
    voiceLog(`no new link to the computer yet (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    relinking = false;
  }
}

/** When the phone asks the microphone to come back after it stopped, counted from the stop. */
const MIC_RETRY_MS = [1_000, 3_000, 6_000, 10_000, 20_000, 30_000, 45_000, 60_000];
let micRetryTimers: ReturnType<typeof setTimeout>[] = [];
/** "The microphone stopped." was said and nothing the person did since asked for it again. */
let micStoppedSaid = false;

function clearMicRetries(): void {
  micRetryTimers.forEach(clearTimeout);
  micRetryTimers = [];
}

/**
 * The native engine gave up on the microphone. Said once until the person tries again (Unmute, Talk),
 * and the phone brings it back on its own: an unmute that changes nothing makes the native engine build
 * a fresh microphone when it is down and does nothing when it runs (`recover` in GhostexVoiceAudio.swift),
 * so asking a few times over the next minute heals a microphone that a route or CallKit change stopped.
 *
 * CDXC:VoiceMode 2026-11-09 WHY: The user's iPhone showed "The microphone stopped" over and over in a call and the agent stopped hearing; GitHub #500's fix said it once per failure but left the microphone down until the person pressed Unmute or Talk. Older iPhone builds (before 11.2.1) report every failed rebuild, so the notice is held to one per try here too.
 */
function microphoneStopped(message: string): void {
  logAppEvent(`Voice agent: ${message}`);
  if (clipTurns && target !== null && nativeSessionId !== null && !switchingToClips) {
    void switchToClipTalk(target);
    return;
  }
  if (!micStoppedSaid) {
    micStoppedSaid = true;
    notice(message);
  }
  clearMicRetries();
  const session = nativeSessionId;
  micRetryTimers = MIC_RETRY_MS.map((delay, index) =>
    setTimeout(() => {
      const state = useVoiceStore.getState();
      if (nativeSessionId !== session || session === null || state.phase !== 'live' || state.muted) return;
      voiceLog(`asking the microphone to start again (try ${index + 1} of ${MIC_RETRY_MS.length}, ${delay / 1000} s after it stopped)`);
      void GhostexNative.voiceSetMuted(false).catch(() => undefined);
    }, delay),
  );
}

/** The computer takes recorded turns (`readVoiceAgent`'s `clipTurns`). */
let clipTurns = false;
let switchingToClips = false;
/** The microphone stopped before the call's `ready`: recorded turns start when it comes. */
let switchOnReady = false;

export const CLIP_TALK_NOTICE =
  "The phone's call microphone keeps stopping, so Ghostex records what you say instead. Hold Talk, speak, and let go to send; replies are read aloud.";

/**
 * The call's microphone stopped: the phone lets go of its native call (the computer keeps the
 * conversation) and joins it again from JavaScript with recorded turns (`clipTalk.ts`).
 */
async function switchToClipTalk(machine: MachineConnectionTarget): Promise<void> {
  switchingToClips = true;
  try {
    const status = await GhostexNative.voiceStatus().catch(() => null);
    const conversationId = status?.conversationId;
    if (nativeSessionId === null || useVoiceStore.getState().phase === 'ended') return;
    if (!conversationId) {
      // The call has no id until gxserver's `ready`: the switch happens then.
      switchOnReady = true;
      return;
    }
    clearMicRetries();
    voiceLog('the call microphone keeps stopping; switching to recorded turns');
    nativeSessionId = null;
    await GhostexNative.voiceCancel('conversation').catch(() => undefined);
    set({ clipTalk: true, talking: false });
    notice(CLIP_TALK_NOTICE);
    startClipTalk(machine, conversationId, useVoiceStore.getState().muted, {
      onFrame,
      onRejoining: () => {
        voiceLog('recorded turns: the link to the computer dropped; joining again');
        if (useVoiceStore.getState().phase !== 'ended') set({ phase: 'reattaching' });
      },
      onLost: (message) => {
        voiceLog(`recorded turns: the call was lost (${message})`);
        finish(message);
      },
    });
  } finally {
    switchingToClips = false;
  }
}

function onStatus(event: Extract<VoiceEvent, { kind: 'status' }>): void {
  switch (event.status) {
    case 'reattaching':
      voiceLog('the link to the computer dropped; joining the call again');
      if (useVoiceStore.getState().phase !== 'ended') set({ phase: 'reattaching' });
      return;
    case 'linkNeeded':
      void relink();
      return;
    case 'open':
      voiceLog('the call is connected to the computer');
      return;
    case 'focusPaused':
      // An audio session interruption began (a phone call, Siri, an alarm) or the app lost the audio.
      voiceLog('the audio was taken away (an interruption: a call, Siri, an alarm); the call is paused');
      set({ paused: true });
      return;
    case 'focusResumed':
      voiceLog('the audio came back; the call goes on');
      set({ paused: false });
      return;
    case 'muted':
      voiceLog('muted');
      set({ muted: true });
      return;
    case 'unmuted':
      voiceLog('unmuted');
      set({ muted: false });
      return;
    case 'talking':
      set({ talking: true });
      return;
    case 'notTalking':
      set({ talking: false });
      return;
    case 'talkRefused':
      voiceLog(`a hold was refused (${event.message === 'heard' ? 'already hearing you' : 'muted'})`);
      flashVoiceHint(event.message === 'heard' ? HINT_ALREADY_HEARD : HINT_UNMUTE);
      return;
    case 'micError':
      microphoneStopped(event.message ?? 'The microphone stopped.');
      return;
    case 'failed':
      logAppEvent(`Voice agent: couldn't open the call on ${useVoiceStore.getState().machineName}${event.message ? ` (${event.message})` : ''}`);
      finish(`Couldn't reach Ghostex on ${useVoiceStore.getState().machineName}.`, {
        code: 'unreachable',
        message: `Couldn't reach Ghostex on ${useVoiceStore.getState().machineName}. Check that it is running and try again.`,
      });
      return;
    case 'lost':
      logAppEvent(`Voice agent: lost ${useVoiceStore.getState().machineName} for too long; the call ended`);
      finish(endedMessage('lost', ''));
      return;
    case 'closed':
      voiceLog('the call closed on the phone');
      if (useVoiceStore.getState().phase !== 'ended') {
        finish(useVoiceStore.getState().problem?.message ?? 'The conversation ended.');
      }
      nativeSessionId = null;
      return;
  }
}

/** Installs the native event listener once; also adopts a conversation that outlived a JS reload. */
export function initVoice(): void {
  if (installed || !VOICE_SUPPORTED) return;
  installed = true;
  GhostexNative.addListener('onVoiceEvent', (event) => {
    // The native audio side's own lines, for any call or recording (it may not know the session).
    if (event.kind === 'log') {
      logAppEvent(`Voice audio${event.mode === 'dictation' ? ' (Dictate)' : ''}: ${event.message}`);
      return;
    }
    if (event.mode !== 'conversation' || event.sessionId !== nativeSessionId) return;
    if (event.kind === 'frame') onFrame(event.json);
    else onStatus(event);
  });
  void GhostexNative.voiceStatus()
    .then((status) => {
      if (status === null || nativeSessionId !== null) return;
      nativeSessionId = status.id;
      set({
        ...INITIAL,
        phase: status.reattaching ? 'reattaching' : 'live',
        machineName: status.title,
        muted: status.muted,
        talking: status.talking === true,
      });
    })
    .catch(() => undefined);
}

/** True while a conversation is open or opening (the button shows it, the screen controls it). */
export function voiceActive(phase: VoicePhase): boolean {
  return phase === 'starting' || phase === 'live' || phase === 'reattaching';
}

type VoiceAgentInfo = {
  provider?: string;
  enabled?: boolean;
  keys?: Record<string, { configured?: boolean; unreadable?: boolean }>;
  voices?: Record<string, string>;
  voiceOptions?: Record<string, string[]>;
  speed?: number;
  callMode?: string;
  focusedCalls?: boolean;
  gbotCalls?: boolean;
  /** `/api/voiceAgentClip` takes recorded turns (`clipTalk.ts`). */
  clipTurns?: boolean;
};

type GxserverForward = { localPort: number; authToken: string };

/** A computer's voice agent ready to call, or why it can't take a call (`code` as in `problemMessage`). */
type ComputerVoice =
  | { ok: true; forward: GxserverForward; info: VoiceAgentInfo; provider: 'xai' | 'openai' }
  | { ok: false; code: string; message: string };

/** Asks `machine`'s gxserver whether its voice agent can take a call now. Never throws. */
async function readComputerVoice(machine: MachineConnectionTarget, machineName: string): Promise<ComputerVoice> {
  try {
    const link = chatMachineLink(machine);
    const forward = await link.gxserverLink();
    if (forward === null) {
      return { ok: false, code: 'unreachable', message: `Couldn't reach Ghostex on ${machineName}. Check that it is running and try again.` };
    }
    if (!forward.capabilities.includes('voiceAgent')) {
      return { ok: false, code: 'unsupported', message: `Ghostex on ${machineName} has no voice agent yet. Update Ghostex on that computer.` };
    }
    const answer = await link.rpc('readVoiceAgent', {}, READ_TIMEOUT_MS);
    if (answer.error !== null) return { ok: false, code: 'unreachable', message: answer.error.message };
    const info = (answer.result ?? {}) as VoiceAgentInfo;
    const provider = info.provider === 'openai' ? 'openai' : 'xai';
    const key = info.keys?.[provider];
    if (info.enabled === false) return { ok: false, code: 'turnedOff', message: problemMessage('turnedOff', '', provider, machineName) };
    if (key?.configured !== true) {
      const code = key?.unreadable === true ? 'unreadableKey' : 'noKey';
      return { ok: false, code, message: problemMessage(code, '', provider, machineName) };
    }
    return { ok: true, forward, info, provider };
  } catch (error) {
    return {
      ok: false,
      code: 'unreachable',
      message: `Couldn't reach Ghostex on ${machineName}. ${error instanceof Error ? error.message : ''}`.trim(),
    };
  }
}

/** The name the phone shows for a saved computer (as the Voice button does). */
function computerName(machine: MachineConnectionTarget & { name?: string }): string {
  return machine.name && machine.name.length > 0 ? machine.name : machine.username;
}

/** How long the phone waits for the other computers when the one on screen has no voice key. */
const OTHER_COMPUTER_TIMEOUT_MS = 8_000;

/**
 * Another saved computer whose voice agent can take the call, asked all at once; the first in the
 * Sessions screen's order wins. Null when none answers in time.
 */
async function otherComputerWithVoice(
  skipId: string,
): Promise<{ machine: MachineConnectionTarget; name: string; voice: Extract<ComputerVoice, { ok: true }> } | null> {
  const others = enabledMachines(useMachinesStore.getState()).filter(
    (machine) => machine.id !== skipId && machine.transport !== 'demo',
  );
  if (others.length === 0) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), OTHER_COMPUTER_TIMEOUT_MS));
  const answers = await Promise.all(
    others.map((machine) => Promise.race([readComputerVoice(machine, computerName(machine)), timeout])),
  );
  for (let index = 0; index < others.length; index += 1) {
    const voice = answers[index];
    if (voice?.ok === true) return { machine: others[index], name: computerName(others[index]), voice };
  }
  return null;
}

/**
 * Starts a conversation with the voice agent on `machine`, about all sessions or, with `about`, about
 * one session. Never throws: every failure lands in the store as a problem the voice screen shows.
 *
 * CDXC:VoiceMode 2026-11-09 WHY: The user's iPhone failed to start the voice agent while the xAI key was on their other computer ("i have xai api key on pc"). The key stays per computer (the 2026-10-20 DECISION), so a call about all sessions whose computer has no usable key (none, unreadable, or the voice agent off) runs on another saved computer that has one, and the voice screen says which and where the missing key goes; a voice agent sees the sessions of the computers its computer is connected to (`server/src/voice_agent/computers.rs`). A call about one session stays on that session's computer and says plainly what is missing there.
 */
export async function startVoice(
  machine: MachineConnectionTarget,
  machineName: string,
  about?: VoiceFocusTarget,
): Promise<void> {
  if (!VOICE_SUPPORTED || voiceActive(useVoiceStore.getState().phase)) return;
  target = machine;
  currentProvider = null;
  askedForFocus = false;
  micStoppedSaid = false;
  clearMicRetries();
  stopClipTalk();
  clipTurns = false;
  switchOnReady = false;
  set({ ...INITIAL, phase: 'starting', machineId: machine.id, machineName, requestedFocus: about ?? null });
  loggedAgentState = '';
  voiceLog(`starting a call on ${machineName} (${about !== undefined ? 'about one session' : 'all sessions'}, ${Platform.OS})`);
  const fail = (code: string, message: string) => {
    logAppEvent(`Voice agent: couldn't start on ${useVoiceStore.getState().machineName} (${code}): ${message}`);
    finish(message, { code, message });
  };
  try {
    if (!(await microphoneAllowed())) {
      fail('microphone', microphoneDeniedMessage('talk with the voice agent'));
      return;
    }
    let voice = await readComputerVoice(machine, machineName);
    let movedNote: string | null = null;
    if (!voice.ok && about === undefined && (voice.code === 'noKey' || voice.code === 'unreadableKey' || voice.code === 'turnedOff')) {
      const other = await otherComputerWithVoice(machine.id);
      if (other !== null && useVoiceStore.getState().phase === 'starting') {
        movedNote = `${voice.message} This call uses the voice agent on ${other.name}, which sees ${machineName}'s sessions when the two computers are connected.`;
        logAppEvent(`Voice agent: ${machineName} can't take the call (${voice.code}); using ${other.name}`);
        target = other.machine;
        machineName = other.name;
        set({ machineId: other.machine.id, machineName });
        voice = other.voice;
      }
    }
    if (!voice.ok) {
      fail(voice.code, voice.message);
      return;
    }
    const { forward, info: result, provider } = voice;
    currentProvider = provider;
    clipTurns = result.clipTurns === true;
    const speed = VOICE_SPEEDS.find((offered) => Math.abs(offered - (result.speed ?? 1)) < 0.01) ?? 1;
    set({
      provider,
      voice: result.voices?.[provider] ?? null,
      voiceOptions: result.voiceOptions?.[provider] ?? [],
      speed,
      callMode: result.callMode === 'pushToTalk' ? 'pushToTalk' : 'regular',
    });
    if (about !== undefined && result.focusedCalls !== true) {
      fail('outdated', outdatedFocusMessage(machineName));
      return;
    }
    if (about?.gbot !== undefined && result.gbotCalls !== true) {
      fail('outdated', outdatedGbotCallMessage(machineName));
      return;
    }
    if (useVoiceStore.getState().phase !== 'starting') return;
    askedForFocus = about !== undefined;
    nativeSessionId = await GhostexNative.voiceStart({
      mode: 'conversation',
      localPort: forward.localPort,
      authToken: forward.authToken,
      title: machineName,
      ...(about !== undefined ? { focus: focusQuery(about) } : {}),
    });
    voiceLog(`the phone opened its call (${provider}, speed ${speed}×${clipTurns ? ', recorded turns offered' : ''})`);
    if (movedNote !== null) notice(movedNote);
    if (speed !== 1) await GhostexNative.voiceSetSpeed(speed);
  } catch (error) {
    fail(
      'unreachable',
      `Couldn't reach Ghostex on ${machineName}. ${error instanceof Error ? error.message : ''}`.trim(),
    );
  }
}

/**
 * Moves the open call to one session, or with null to all sessions (the banner's All sessions).
 * gxserver answers with a `focus` frame, which is what changes the screen.
 *
 * CDXC:VoiceMode 2026-10-23 WHY: The banner the user picked has no way to widen, and "Yes, both ways" needs one on the phone, so the banner gets a small All sessions button at its right end (the desktop strip's button, same word).
 */
export function focusVoiceOn(about: VoiceFocusTarget | null): void {
  if (clipTalkActive()) {
    clipSend({ type: 'focus', session: about !== null ? focusRef(about) : null });
    return;
  }
  if (nativeSessionId === null || !voiceActive(useVoiceStore.getState().phase)) return;
  void GhostexNative.voiceSetFocus(about !== null ? focusRef(about) : null).catch(() => undefined);
}

/** Hangs up (or abandons a conversation still opening). */
export function hangUpVoice(): void {
  const phase = useVoiceStore.getState().phase;
  voiceLog('hung up');
  if (clipTalkActive()) {
    clipHangUp();
    // The computer answers `ended`; a link that is already gone ends it here.
    setTimeout(() => {
      if (useVoiceStore.getState().phase !== 'ended') finish('You hung up.');
    }, 3_500);
    return;
  }
  if (nativeSessionId !== null) void GhostexNative.voiceEnd('conversation').catch(() => undefined);
  if (phase === 'starting' && nativeSessionId === null) finish('You hung up.');
}

export function setVoiceMuted(muted: boolean): void {
  if (!muted) micStoppedSaid = false;
  set({ muted });
  if (clipTalkActive()) {
    clipSend({ type: 'mute', muted });
    return;
  }
  void GhostexNative.voiceSetMuted(muted).catch(() => undefined);
}

/**
 * CDXC:VoiceMode 2026-11-10 DECISION:
 * User: "Add an input area at the bottom for the voice agent on the phone and on PC, so I can be muted and still type to the voice agent." A typed message is the user's turn in the running call: gxserver's `text` input (server/src/voice_agent/conversation.rs, `Input::Text`) shows it as the user's caption, cuts a reply being spoken and answers it like a spoken turn. Mute is left as it is.
 *
 * Recorded-turn calls (`clipTalk.ts`) send the `text` frame on their own socket, which every gxserver
 * with voice already takes. A native call's socket (`GhostexVoice.kt` / `.swift`) forwards only its
 * fixed frames, so its typed turn goes through gxserver's `voiceAgentText` route
 * `{conversationId, text}` instead, which hands it to the same call.
 *
 * Answers null when sent, or the sentence the text box shows when it could not be.
 */
export async function sendVoiceText(text: string): Promise<string | null> {
  const typed = text.trim();
  if (typed.length === 0) return null;
  if (useVoiceStore.getState().phase !== 'live') return 'The call is not connected right now.';
  if (clipTalkActive()) {
    return clipSend({ type: 'text', text: typed })
      ? null
      : "Couldn't send that. The call is reconnecting; try again in a moment.";
  }
  return sendNativeCallText(typed);
}

/**
 * VOICE-TEXT-SERVER-ROUTE: the one place a native call's typed turn leaves the phone. It needs
 * gxserver's `/api/voiceAgentText` `{conversationId, text}` (answers `{sent: true}`, or `notFound`
 * once the call ended), allowed for remote clients like `/api/voiceAgentClip`.
 */
async function sendNativeCallText(text: string): Promise<string | null> {
  const machine = target;
  const status = await GhostexNative.voiceStatus().catch(() => null);
  const conversationId = status?.conversationId;
  if (machine === null || !conversationId) return 'The call is still connecting. Try again in a moment.';
  try {
    const answer = await chatMachineLink(machine).rpc('voiceAgentText', { conversationId, text }, READ_TIMEOUT_MS);
    if (answer.error === null) return null;
    // The call ended (`notFound` naming the conversation), or the text was refused (`badRequest`).
    const olderComputer = answer.error.code === 'notFound' && !/conversation/i.test(answer.error.message);
    if (!olderComputer) return answer.error.message;
    return `Typing to the voice agent needs a newer Ghostex on ${useVoiceStore.getState().machineName || 'your computer'} (${answer.error.message.replace(/\.$/, '')}).`;
  } catch {
    return "Couldn't reach your computer. Try again in a moment.";
  }
}

/** "Stop talking": cuts the agent's reply. */
export function interruptVoice(): void {
  if (clipTalkActive()) {
    clipSend({ type: 'interrupt' });
    return;
  }
  void GhostexNative.voiceInterrupt().catch(() => undefined);
}

/** Saves the computer's voice settings through gxserver (which saves them through the desktop app). */
async function saveVoiceSettings(
  params: { provider?: string; voice?: string; speed?: number; callMode?: VoiceCallMode },
  what: string,
  consequence = ', so it lasts for this conversation only',
): Promise<boolean> {
  if (target === null) return false;
  try {
    const answer = await chatMachineLink(target).rpc('setVoiceAgentSettings', params, READ_TIMEOUT_MS);
    if (answer.error !== null) {
      notice(
        `Couldn't save the ${what} on ${useVoiceStore.getState().machineName} (${answer.error.message})${consequence}.`,
      );
      return false;
    }
    return true;
  } catch {
    notice(`Couldn't save the ${what} on ${useVoiceStore.getState().machineName}${consequence}.`);
    return false;
  }
}

/**
 * The gear sheet and the voice settings page: saves the computer's `voiceAgentCallMode`.
 *
 * CDXC:VoiceMode 2026-11-10 DECISION: User: "I had push-to-talk selected, then switched to regular mode mid-conversation, and after that it kept forcing me to use hold-to-speak instead of regular. [...] Please fix the mode switching so selecting regular from push-to-talk reliably switches the conversation to regular mode. Also consider showing the user a notice when the mode is about to switch." A change during a call switches that call at once, both ways: gxserver switches the running call and sends a `callMode` frame, which sets `pushToTalk` (the hold button and the open microphone follow it) and shows "Microphone is open: regular mode" or "Hold to speak is on". A gxserver that cannot switch a running call (no `ready.callModeLive`) keeps it as it started, and the phone says the mode starts with the next call instead of leaving the tick and the call disagreeing silently. Supersedes the 2026-10-21 "a call never changes mode midway" on the phone.
 */
export function setCallMode(mode: VoiceCallMode): void {
  const state = useVoiceStore.getState();
  const previous = state.callMode;
  const callPushToTalk = state.pushToTalk;
  const inCall = state.phase === 'live' || state.phase === 'reattaching';
  // The tick already matches, but the running call does not (it started in the other mode).
  if (mode === previous && (!inCall || callPushToTalk === (mode === 'pushToTalk'))) return;
  set({ callMode: mode });
  void saveVoiceSettings({ callMode: mode }, 'call mode', '').then((saved) => {
    if (!saved) {
      set({ callMode: previous });
      return;
    }
    const now = useVoiceStore.getState();
    if (!voiceActive(now.phase) || now.pushToTalk === (mode === 'pushToTalk')) return;
    // gxserver answers with a `callMode` frame and its own notice when it switches the call.
    if (!now.callModeLive) showVoiceToast(mode === 'pushToTalk' ? MODE_NEXT_PUSH_TO_TALK : MODE_NEXT_REGULAR);
  });
}

/** The call mode saved on `machine` (Settings › Voice agent), or an error sentence. */
export async function readComputerCallMode(
  machine: MachineConnectionTarget,
): Promise<{ mode: VoiceCallMode } | { error: string }> {
  try {
    const answer = await chatMachineLink(machine).rpc('readVoiceAgent', {}, READ_TIMEOUT_MS);
    if (answer.error !== null) return { error: answer.error.message };
    const result = (answer.result ?? {}) as { callMode?: string; callModeLive?: boolean };
    // A gxserver that switches a running call says so here too, so Settings' note is right before any call.
    if (result.callModeLive === true) liveCallModeComputers.add(machine.id);
    return { mode: result.callMode === 'pushToTalk' ? 'pushToTalk' : 'regular' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't reach your computer." };
  }
}

/** Saves the call mode on `machine` through gxserver; answers an error sentence, or null when saved. */
export async function saveComputerCallMode(
  machine: MachineConnectionTarget,
  mode: VoiceCallMode,
): Promise<string | null> {
  try {
    const answer = await chatMachineLink(machine).rpc('setVoiceAgentSettings', { callMode: mode }, READ_TIMEOUT_MS);
    if (answer.error !== null) return answer.error.message;
    if (target?.id === machine.id) set({ callMode: mode });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Couldn't reach your computer.";
  }
}

/** What holding the talk button does now (server/src/voice_agent/talk.rs decides the turn). */
export type VoiceHoldMode = 'talk' | 'unmute' | 'mutedLock' | 'alreadyHeard' | 'none';

export function voiceHoldMode(state: {
  phase: VoicePhase;
  pushToTalk: boolean;
  muted: boolean;
  clipTalk?: boolean;
}): VoiceHoldMode {
  if (state.phase !== 'live') return 'none';
  // Recorded turns: every turn is a hold, and Mute still wins.
  if (state.clipTalk === true) return state.muted ? 'mutedLock' : 'talk';
  if (state.pushToTalk) return state.muted ? 'mutedLock' : 'talk';
  return state.muted ? 'unmute' : 'alreadyHeard';
}

/**
 * The hold button pressed or released: a push-to-talk turn (pressing cuts a reply the agent is
 * speaking, releasing sends it), or a muted Regular call unmuted while held. A press that means
 * nothing now says why instead.
 */
export function setVoiceTalking(talking: boolean): void {
  const state = useVoiceStore.getState();
  if (state.talking === talking) return;
  if (talking) {
    const mode = voiceHoldMode(state);
    if (mode === 'mutedLock') return flashVoiceHint(HINT_UNMUTE);
    if (mode === 'alreadyHeard') return flashVoiceHint(HINT_ALREADY_HEARD);
    if (mode === 'none') return;
  }
  if (talking) micStoppedSaid = false;
  set({ talking, hint: null });
  if (clipTalkActive()) {
    void (talking ? clipTalkStart() : clipTalkEnd(false)).then((problem) => {
      if (problem === null) return;
      if (talking) set({ talking: false });
      notice(problem);
    });
    return;
  }
  void GhostexNative.voiceSetTalking(talking).catch(() => undefined);
}

/** The finger slid off the hold button and let go there: the hold ends with nothing sent. */
export function cancelVoiceTalking(): void {
  if (!useVoiceStore.getState().talking) return;
  set({ talking: false });
  if (clipTalkActive()) {
    void clipTalkEnd(true);
    return;
  }
  void GhostexNative.voiceCancelTalking().catch(() => undefined);
}

/** The speed buttons: faster at once (on the phone), and saved as the computer's `voiceAgentSpeed`. */
export function setVoiceSpeed(speed: number): void {
  if (speed === useVoiceStore.getState().speed) return;
  set({ speed });
  if (!clipTalkActive()) void GhostexNative.voiceSetSpeed(speed).catch(() => undefined);
  void saveVoiceSettings({ speed }, 'speed');
}

/**
 * The voice picker: saved as the computer's voice for this provider (in a call with a GBot, as that
 * GBot's voice: `gbotCall.ts` has the DECISION), and switched to when the provider can.
 */
export function pickVoice(voice: string): void {
  const state = useVoiceStore.getState();
  if (voice === state.voice && state.nextVoice === null) return;
  if (voice === state.voice) set({ nextVoice: null });
  const gbot = state.focus?.gbot;
  if (gbot !== undefined && target !== null) {
    void saveGbotVoice(target, gbot.botId, voice).then((failure) => {
      if (failure !== null) notice(`Couldn't save ${gbot.name}'s voice (${failure}), so it lasts for this call only.`);
    });
  } else void saveVoiceSettings({ provider: state.provider ?? undefined, voice }, 'voice');
  if (clipTalkActive()) clipSend({ type: 'voice', voice });
  else if (voiceActive(state.phase)) void GhostexNative.voiceSetVoice(voice).catch(() => undefined);
}

/** Continue: gxserver hands the summary to the agent, which recaps it, and answers `memory`. */
export function continueVoiceMemory(): void {
  if (useVoiceStore.getState().phase !== 'live') return;
  set({ memoryState: 'continued' });
  if (clipTalkActive()) {
    clipSend({ type: 'continueMemory' });
    return;
  }
  void GhostexNative.voiceSendControl('continueMemory').catch(() => undefined);
}

/** Start fresh: puts the card away; this call's own summary replaces the old one when it ends. */
export function startVoiceFresh(): void {
  set({ memoryState: 'hidden' });
}

/** Forget: gxserver deletes the summary, on the computer, for every device. */
export function forgetVoiceMemory(): void {
  if (useVoiceStore.getState().phase !== 'live') return;
  set({ memory: null, memoryState: 'forgotten' });
  if (clipTalkActive()) {
    clipSend({ type: 'forgetMemory' });
    return;
  }
  void GhostexNative.voiceSendControl('forgetMemory').catch(() => undefined);
}

/** Back to idle once the ended conversation is dismissed. */
export function dismissVoice(): void {
  if (useVoiceStore.getState().phase === 'ended') set(INITIAL);
}
