/**
 * GBot Settings > Routines on the phone: what the GBot does on its own, on a schedule, one row per routine with its
 * schedule in words, its next run (or Paused), the check it runs first and its last result, and Pause or Resume,
 * Run now and Remove. The phone has no Automate view, so changing what a routine does is asking the GBot in its chat.
 *
 * CDXC:GBots 2026-11-09 DECISION: User (plan section 3.4): the phone's GBot Settings has "a Routines list (Pause,
 * Resume, Run now, Remove), since the phone has no Automations UI"; a "Routine set" card's Edit opens it.
 * SEE-ALSO: apps/desktop/src/app/window/gbot_settings_modal/routines.rs (the desktop tab), server/src/gbots/routines.rs.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { gbotRoutineRunStatus, type GbotRoutine } from '../../contract/gbotRoutines';
import { GhostexStrokeWidth } from '../../theme/palette';
import { useGbotFormStyles } from './GbotFormParts';

export type GbotRoutineVerb = 'pause' | 'resume' | 'run-now' | 'remove';

export type GbotRoutinesViewProps = {
  /** The GBot's name, for the empty list's example. */
  name: string;
  load: () => Promise<GbotRoutine[]>;
  /** Runs `verb` on routine `id`, then answers the routines as they are afterwards. */
  act: (verb: GbotRoutineVerb, id: string) => Promise<GbotRoutine[]>;
};

function lines(routine: GbotRoutine): string[] {
  const out = [
    routine.paused ? 'Paused.' : routine.nextLabel.length > 0 ? `Next: ${routine.nextLabel}` : 'No more runs.',
  ];
  if (routine.precheckSentence.length > 0) {
    out.push(
      routine.checkFailure.length > 0
        ? `Checks ${routine.precheckSentence} first. Its last check failed: ${routine.checkFailure}`
        : `Checks ${routine.precheckSentence} first, and runs only when that changes.`,
    );
  }
  if (routine.toChief) out.push('Tells Chief of Staff when it finds something.');
  if (routine.lastRunStatus.length > 0) {
    const status = gbotRoutineRunStatus(routine.lastRunStatus);
    out.push(
      routine.lastRunSummary.length > 0 ? `Last run: ${status}. ${routine.lastRunSummary}` : `Last run: ${status}.`,
    );
  }
  return out;
}

export default function GbotRoutinesView(props: GbotRoutinesViewProps): ReactElement {
  const { appearance, styles: form } = useGbotFormStyles();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        list: { marginTop: 14, gap: 10 },
        box: {
          borderRadius: 8,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.card,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 4,
        },
        name: { color: appearance.foreground, fontSize: 14, fontWeight: '600' },
        schedule: { color: appearance.foreground, fontSize: 13, lineHeight: 18 },
        small: { color: appearance.muted, fontSize: 12.5, lineHeight: 17 },
        buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
        button: {
          borderRadius: 7,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.input,
          paddingHorizontal: 12,
          paddingVertical: 6,
        },
        danger: { borderColor: '#ef4444' },
        label: { color: appearance.foreground, fontSize: 13 },
        dangerLabel: { color: '#ef4444' },
        disabled: { opacity: 0.5 },
        empty: { color: appearance.muted, fontSize: 13, lineHeight: 19, marginTop: 14 },
      }),
    [appearance],
  );
  const [routines, setRoutines] = useState<GbotRoutine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    props.load().then(
      (loaded) => {
        if (!cancelled) setRoutines(loaded);
      },
      (loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      },
    );
    return () => {
      cancelled = true;
    };
    // Read once per opening of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = useCallback(
    (verb: GbotRoutineVerb, id: string) => {
      if (busy) return;
      if (verb === 'remove' && confirmRemove !== id) {
        setConfirmRemove(id);
        return;
      }
      setBusy(true);
      setError(null);
      setConfirmRemove(null);
      props.act(verb, id).then(
        (after) => {
          setRoutines(after);
          setBusy(false);
        },
        (actError: unknown) => {
          setError(actError instanceof Error ? actError.message : String(actError));
          setBusy(false);
        },
      );
    },
    [busy, confirmRemove, props],
  );

  if (routines === null) {
    return error === null ? (
      <ActivityIndicator style={form.loading} color={appearance.muted} />
    ) : (
      <Text style={form.error}>{error}</Text>
    );
  }
  const button = (routine: GbotRoutine, verb: GbotRoutineVerb, label: string) => (
    <Pressable
      key={verb}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${routine.name}`}
      disabled={busy}
      onPress={() => act(verb, routine.id)}
      style={[styles.button, verb === 'remove' ? styles.danger : null, busy ? styles.disabled : null]}
    >
      <Text style={[styles.label, verb === 'remove' ? styles.dangerLabel : null]}>{label}</Text>
    </Pressable>
  );
  return (
    <View>
      {error !== null ? <Text style={form.error}>{error}</Text> : null}
      {routines.length === 0 ? (
        <Text style={styles.empty}>
          {`No routines yet. Ask ${props.name} in its chat, for example "every weekday at 8, check my inbox folder and tell me what's new".`}
        </Text>
      ) : (
        <View style={styles.list}>
          {routines.map((routine) => (
            <View key={routine.id} style={styles.box}>
              <Text style={styles.name}>{routine.name}</Text>
              <Text style={styles.schedule}>{routine.scheduleSentence}</Text>
              {lines(routine).map((line, index) => (
                <Text key={index} style={styles.small}>
                  {line}
                </Text>
              ))}
              <View style={styles.buttons}>
                {routine.paused ? button(routine, 'resume', 'Resume') : button(routine, 'pause', 'Pause')}
                {button(routine, 'run-now', 'Run now')}
                {button(routine, 'remove', confirmRemove === routine.id ? 'Remove?' : 'Remove')}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
