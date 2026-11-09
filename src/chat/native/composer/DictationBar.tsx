/**
 * Dictate's row above the chat box (`useDictation.ts`; desktop: `render_dictation_row` in
 * `native_chat/dictation.rs`): "Recording 0:07" while the microphone records, "Transcribing…"
 * after Stop, or why the transcription failed with
 * Transcribe again (and Set up Hex when Hex on the computer isn't ready). Each line names what
 * transcribes ("Hex, Parakeet v3"). The ✕ cancels; the recording is kept either way. A send the
 * computer never answered says "Waiting for your computer…" (it goes again on its own), and a
 * recording still on the phone without its words shows as "Recording not transcribed" with
 * Transcribe; both offer Share on the iPhone, so the audio can be saved elsewhere.
 */

import { Pressable, Text, View } from 'react-native';

import { Glyph } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { dictationClock, type DictationFix, type DictationPhase } from './useDictation';

/** The row's first line for `phase`, naming the engine (`engine`, "Hex, Parakeet v3") when known. */
export function dictationLabel(phase: DictationPhase, elapsedMs: number, engine: string | null): string {
  switch (phase) {
    case 'starting':
      return 'Starting the microphone…';
    case 'recording':
      return `Recording ${dictationClock(elapsedMs)}${engine !== null ? ` · ${engine}` : ''}`;
    case 'transcribing':
      return engine !== null ? `Transcribing with ${engine}…` : 'Transcribing…';
    case 'failed':
      return 'Transcription failed.';
    case 'waiting':
      return `Recording not transcribed · ${dictationClock(elapsedMs)}`;
    case 'idle':
      return '';
  }
}

export function DictationBar({
  phase,
  elapsedMs,
  failure,
  engine,
  fix,
  onCancel,
  onRetry,
  onFix,
  retrying = false,
  onShare,
}: {
  phase: DictationPhase;
  /** The recording's clock (recording), or its length (waiting). */
  elapsedMs: number;
  failure: string | null;
  engine: string | null;
  fix: DictationFix | null;
  onCancel: () => void;
  onRetry: () => void;
  onFix: () => void;
  /** The computer never answered: the recording goes again on its own. */
  retrying?: boolean;
  /** Shares the recording's audio; absent when this phone can't. */
  onShare?: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  if (phase === 'idle') return null;
  const failed = phase === 'failed';
  const waiting = phase === 'waiting';
  const label = failed && retrying ? 'Waiting for your computer…' : dictationLabel(phase, elapsedMs, engine);
  const detail = failed && failure
    ? retrying
      ? `${failure} The recording is kept on this phone and goes again on its own.`
      : `${failure} Your recording is kept.`
    : waiting
      ? 'It is kept on this phone until its words are in a chat.'
      : null;
  const button = (text: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
    >
      <Text style={styles.buttonText}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={styles.bar}>
      {phase === 'recording' ? <View style={styles.dot} /> : null}
      <View style={styles.texts}>
        <Text style={[styles.text, failed ? styles.failed : null]}>{label}</Text>
        {detail !== null ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      {failed && fix !== null ? button(fix.label, onFix) : null}
      {failed && fix === null ? button('Transcribe again', onRetry) : null}
      {waiting ? button('Transcribe', onRetry) : null}
      {(failed || waiting) && onShare !== undefined ? button('Share', onShare) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          failed || waiting ? 'Dismiss (the recording is kept)' : 'Cancel (the recording is kept)'
        }
        hitSlop={8}
        onPress={onCancel}
        style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}
      >
        <Glyph name="x" size={14} color={P.muted} />
      </Pressable>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  texts: { flex: 1, gap: 2 },
  text: { color: P.primary, fontSize: 13 },
  failed: { color: '#ef9999' },
  detail: { color: P.muted, fontSize: 12.5, lineHeight: 17 },
  close: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: P.border },
  button: {
    paddingHorizontal: 10,
    height: 30,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: P.neutralFill,
  },
  buttonPressed: { backgroundColor: P.neutralFillPressed },
  buttonText: { color: P.primary, fontSize: 13 },
}));
