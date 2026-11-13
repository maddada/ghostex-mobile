/**
 * Dictate's row above the chat box (`useDictation.ts`; desktop: `render_dictation_pill` in
 * `native_chat/dictation.rs`). While the microphone records, a pill shows the red dot, the clock,
 * a live waveform of the voice reaching the recording and the engine ("Hex"); after Stop it says
 * "Transcribing · Hex, Parakeet v3" on one line. Anything that needs the reader (a failed
 * transcription, a recording still waiting for its words, an engine that can't transcribe yet) is
 * a compact calm card (`DictationCard`): what happened in plain words, that the recording is
 * safe, and one or two buttons. The ✕ cancels or dismisses; the recording is kept
 * either way. Share (iPhone) hands the recording's audio elsewhere.
 *
 * CDXC:Dictate 2026-11-13 DECISION: User, after a failed 104 s dictation: a waveform so they can tell they are being recorded; "Transcribing with Hex, Parakeet v3" must not wrap to a second line; the recording row's dot, time and engine sat too far left; the failure was "so ugly": make it and the other errors calm and clear with Try again and Open settings; and "don't let me dictate all of this and then fail to send": an engine that can't transcribe greys the microphone and says why before anything is recorded (`unavailable`).
 */

import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { engineStatusLine, type DictateEngine } from '../../../voice/dictateModel';
import { Spinner } from '../cards/primitives';
import { Glyph as CardGlyph, type GlyphName as CardGlyphName } from '../cards/icons';
import { ToneButton } from '../cards/ToneCard';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { DictationWaveform } from './DictationWaveform';
import { Glyph } from './icons';
import { dictationClock, type DictationFix, type DictationPhase, type DictationProblem } from './useDictation';

/** The engine's first word ("Hex" of "Hex, Parakeet v3"), for the recording pill. */
export function shortEngine(engine: string | null): string | null {
  if (engine === null) return null;
  const first = engine.split(',')[0]?.trim() ?? '';
  return first.length > 0 ? first : null;
}

/** The pill's line for `phase` (recording shows its clock separately). */
export function dictationLabel(phase: DictationPhase, engine: string | null): string {
  switch (phase) {
    case 'starting':
      return 'Starting the microphone';
    case 'transcribing':
      return engine !== null ? `Transcribing · ${engine}` : 'Transcribing';
    default:
      return '';
  }
}

/**
 * What the unavailable card says for `engine`'s answer, in the phone's words (`engineStatusLine`:
 * gxserver's own sentences speak of clicking and of the desktop's Settings).
 */
export function unavailableProblem(engine: DictateEngine | null, computer: string | null): DictationProblem | null {
  if (engine === null) return null;
  return { code: engine.problem?.code ?? '', message: engineStatusLine(engine, computer ?? 'your computer') };
}

/** A card title for why the engine can't transcribe yet, in 2 to 6 words. */
export function unavailableTitle(code: string): string {
  switch (code) {
    case 'hexNotInstalled':
      return "Hex isn't installed";
    case 'hexNotRunning':
      return "Hex isn't running";
    case 'hexNoModels':
    case 'hexModelNotReady':
      return 'Hex has no model ready';
    case 'hexUnsupported':
      return "Hex can't run here";
    case 'noKey':
      return 'No API key added';
    case 'keyUnreadable':
      return "The API key can't be read";
    default:
      return "Dictation isn't ready";
  }
}

export function DictationBar({
  phase,
  elapsedMs,
  failure,
  engine,
  fix,
  problem,
  recordingId,
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
  /** Why the engine can't transcribe (`unavailable`). */
  problem: DictationProblem | null;
  /** The recording the microphone is writing, for the waveform. */
  recordingId: string | null;
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

  const share =
    onShare !== undefined ? <ToneButton key="share" label="Share" kind="secondary" onPress={onShare} /> : null;
  const settings =
    fix !== null ? <ToneButton key="settings" label={fix.label} kind="secondary" onPress={onFix} /> : null;

  if (phase === 'unavailable') {
    return (
      <DictationCard
        icon="microphone-off"
        hue={warnHue(P.light)}
        title={unavailableTitle(problem?.code ?? '')}
        text={`${problem?.message ?? 'Dictation on this computer needs setting up first.'} Nothing was recorded.`}
        onDismiss={onCancel}
        end={[<ToneButton key="settings" label="Open settings" kind="primary" onPress={onFix} />]}
      />
    );
  }

  if (phase === 'failed') {
    return (
      <DictationCard
        icon={retrying ? 'clock' : 'microphone'}
        hue={warnHue(P.light)}
        title={retrying ? 'Waiting for your computer' : "Couldn't transcribe"}
        text={
          retrying
            ? `${failure ?? ''} Your recording is safe on this phone and goes again on its own.`.trim()
            : `${failure ?? 'The transcription failed.'} Your recording is safe.`
        }
        onDismiss={onCancel}
        start={share !== null ? [share] : []}
        end={[settings, <ToneButton key="retry" label="Try again" kind="primary" onPress={onRetry} />]}
      />
    );
  }

  if (phase === 'waiting') {
    return (
      <DictationCard
        icon="microphone"
        hue={null}
        title="Recording not transcribed"
        text={`${dictationClock(elapsedMs)} · kept on this phone`}
        onDismiss={onCancel}
        start={share !== null ? [share] : []}
        end={[<ToneButton key="transcribe" label="Transcribe" kind="primary" onPress={onRetry} />]}
      />
    );
  }

  const recording = phase === 'recording';
  const short = shortEngine(engine);
  return (
    <View style={styles.pill} accessibilityRole="summary">
      {recording ? <View style={styles.dot} /> : <Spinner size={14} color={P.muted} />}
      {recording ? (
        <>
          <Text style={styles.clock}>{dictationClock(elapsedMs)}</Text>
          <View style={styles.wave}>
            <DictationWaveform recordingId={recordingId} />
          </View>
          {short !== null ? (
            <Text style={styles.engine} numberOfLines={1}>
              {short}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.line} numberOfLines={1} ellipsizeMode="tail">
          {dictationLabel(phase, engine)}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel (the recording is kept)"
        hitSlop={8}
        onPress={onCancel}
        style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}
      >
        <Glyph name="x" size={14} color={P.muted} />
      </Pressable>
    </View>
  );
}

/** The notices' amber, for the card's mark (`notice-tone.json` `warning`). */
function warnHue(light: boolean): string {
  return light ? '#b45309' : '#fbbf24';
}

/**
 * The compact card Dictate shows above the chat box: a small mark and a title with the ✕, one or
 * two plain sentences, and its buttons on one line. On the chat box's own surface, inset the same
 * on both sides.
 *
 * CDXC:Dictate 2026-11-13 DECISION: User, of the phone's Hex errors: "they're huge", and "the padding from the left side is not the same as the padding from the right side for the Hex row". The cards are compact (no tile, header band or footer band) and every Dictate row keeps 15pt to its first mark on the left and to the ✕'s mark on the right. Supersedes the full notice card used for them earlier the same day.
 */
function DictationCard({
  icon,
  hue,
  title,
  text,
  onDismiss,
  start = [],
  end = [],
}: {
  icon: CardGlyphName;
  hue: string | null;
  title: string;
  text: string;
  onDismiss: () => void;
  start?: ReactNode[];
  end?: ReactNode[];
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const left = start.filter(Boolean);
  const right = end.filter(Boolean);
  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={styles.cardHead}>
        <CardGlyph name={icon} size={15} color={hue ?? P.muted} />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss (the recording is kept)"
          hitSlop={8}
          onPress={onDismiss}
          style={({ pressed }) => [styles.cardClose, pressed ? styles.pressed : null]}
        >
          <Glyph name="x" size={14} color={P.muted} />
        </Pressable>
      </View>
      <Text style={styles.body}>{text}</Text>
      {left.length > 0 || right.length > 0 ? (
        <View style={styles.cardActions}>
          {left}
          <View style={styles.cardSpacer} />
          {right}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  /** Inset like the chat box's own text (its 14pt padding inside a 1pt border). */
  pill: {
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: P.composerBorder,
    backgroundColor: P.composerBackground,
    // The dot starts 15pt in; the ✕'s 14pt mark, centred in its 28pt button, ends 15pt in.
    paddingLeft: 15,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: P.composerBorder,
    backgroundColor: P.composerBackground,
    paddingLeft: 15,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 11,
    gap: 4,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  cardTitle: { flex: 1, minWidth: 0, color: P.foreground, fontSize: 13.5, fontWeight: '600' },
  cardClose: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingRight: 7 },
  cardSpacer: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  clock: { color: P.primary, fontSize: 13, fontVariant: ['tabular-nums'] },
  wave: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  engine: { color: P.muted, fontSize: 12.5, flexShrink: 0, maxWidth: 90 },
  line: { flex: 1, minWidth: 0, color: P.primary, fontSize: 13 },
  body: { color: P.cardMuted, fontSize: 13, lineHeight: 18, paddingRight: 7 },
  close: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: P.border },
}));
