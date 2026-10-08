/**
 * The composer's Dictate control: the platform speech recognizer (`expo-speech-recognition`) turns
 * what the reader says into text, and each finished phrase goes into the draft at the caret.
 *
 * CDXC:SessionChat 2026-10-08 DECISION: User asked for voice input in the chat box, to the left of the Terminal View button, on the desktop and the phone (GPUI Kit's speech input, #3333, on the desktop). Pressing the microphone starts listening and pressing it again stops; recognized text is typed into the draft and never sent by itself.
 * CDXC:SessionChat 2026-10-08 SEE-ALSO: `apps/desktop/src/app/native_chat/dictation.rs` is the desktop's control.
 *
 * The native module is looked up rather than imported: a build without it (an older dev client)
 * has no Dictate control instead of failing when the composer loads.
 */

import { requireOptionalNativeModule } from 'expo';
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';

type Subscription = { remove(): void };
type SpeechNative = {
  isRecognitionAvailable(): boolean;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  start(options: ExpoSpeechRecognitionOptions): void;
  stop(): void;
  addListener(event: 'start' | 'end', listener: () => void): Subscription;
  addListener(event: 'result', listener: (event: ExpoSpeechRecognitionResultEvent) => void): Subscription;
  addListener(event: 'error', listener: (event: ExpoSpeechRecognitionErrorEvent) => void): Subscription;
};

const speech = requireOptionalNativeModule<SpeechNative>('ExpoSpeechRecognition');

/**
 * The switch for the Dictate control.
 *
 * CDXC:SessionChat 2026-10-09 DECISION: User: "if we can't fix this np release with mic button hidden on all os for now i'll test it later". Dictation returns no words on the desktop and was never confirmed on a phone, so the control is hidden everywhere until it is tested. Set this to `true` to bring it back; the dictation code stays in place.
 * CDXC:SessionChat 2026-10-09 SEE-ALSO: the desktop's switch is `DICTATION_ENABLED` in `apps/desktop/src/app/native_chat/dictation.rs`.
 */
const DICTATION_ENABLED = false;

function recognitionAvailable(): boolean {
  if (!DICTATION_ENABLED) return false;
  try {
    return speech?.isRecognitionAvailable() ?? false;
  } catch {
    return false;
  }
}

/** The device's language for the recognizer, or the recognizer's own default. */
function deviceLanguage(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || undefined;
  } catch {
    return undefined;
  }
}

/**
 * `onPhrase` receives each recognized phrase; `onError` a short message for a failure the reader
 * should know about (no microphone permission, no recognizer for the language).
 */
export function useDictation(onPhrase: (text: string) => void, onError: (message: string) => void) {
  const [available] = useState(recognitionAvailable);
  const [listening, setListening] = useState(false);
  const phrase = useRef(onPhrase);
  const failure = useRef(onError);
  phrase.current = onPhrase;
  failure.current = onError;

  useEffect(() => {
    if (speech === null || !available) return;
    const subscriptions = [
      speech.addListener('start', () => setListening(true)),
      speech.addListener('end', () => setListening(false)),
      speech.addListener('result', (event) => {
        const text = event.results[0]?.transcript?.trim();
        if (event.isFinal && text) phrase.current(text);
      }),
      speech.addListener('error', (event) => {
        setListening(false);
        // Stopping, or a pause with nothing said, is not a failure the reader needs to hear about.
        if (event.error === 'aborted' || event.error === 'no-speech' || event.error === 'speech-timeout') return;
        failure.current(event.message || 'Dictation stopped.');
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [available]);

  const toggle = useCallback(async () => {
    if (speech === null) return;
    if (listening) {
      speech.stop();
      return;
    }
    const permission = await speech.requestPermissionsAsync();
    if (!permission.granted) {
      failure.current('Ghostex needs microphone and speech recognition access to dictate.');
      return;
    }
    speech.start({ lang: deviceLanguage(), interimResults: false, continuous: true, addsPunctuation: true });
  }, [listening]);

  return { available, listening, toggle };
}
