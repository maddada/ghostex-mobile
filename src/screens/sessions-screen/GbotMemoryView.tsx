/**
 * GBot Settings > Memory on the phone: what loads when the GBot's chat starts (with the gauge of MEMORY.md against its
 * 200 lines / 24 KB, amber from 80%), MEMORY.md itself, its topics, its daily log and the changes with Undo on the
 * newest one. Read-only apart from Undo; editing the memory is the computer's Memory tab.
 *
 * CDXC:GBots 2026-11-09 DECISION: User (plan section 3.4): the phone's GBot Settings shows "a read-only Memory view
 * with Undo". Undo names the change it undoes, so a button left over from before someone else's change is refused by
 * the computer instead of undoing the wrong one.
 * SEE-ALSO: apps/desktop/src/app/window/gbot_settings_modal/memory.rs (the desktop tab), server/src/gbots/memory/ops.rs.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { gbotMemoryGaugeLabel, gbotMemoryWhen, type GbotMemory } from '../../contract/gbotMemory';
import { GhostexStrokeWidth } from '../../theme/palette';
import { useGbotFormStyles } from './GbotFormParts';

const AMBER = '#f59e0b';
const RED = '#ef4444';
const CHANGES_SHOWN = 6;

export type GbotMemoryViewProps = {
  load: () => Promise<GbotMemory>;
  /** Undoes change `id`, then answers the memory as it is afterwards. */
  undo: (id: string) => Promise<GbotMemory>;
};

function lines(count: number): string {
  return count === 0 ? 'None' : count === 1 ? '1 line' : `${count} lines`;
}

export default function GbotMemoryView(props: GbotMemoryViewProps): ReactElement {
  const { appearance, styles: form } = useGbotFormStyles();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        section: { marginTop: 18 },
        heading: { color: appearance.foreground, fontSize: 14, fontWeight: '600', marginBottom: 6 },
        box: {
          borderRadius: 8,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.card,
          paddingHorizontal: 12,
          paddingVertical: 10,
        },
        gaugeTrack: { height: 8, borderRadius: 4, backgroundColor: appearance.border, marginTop: 6, overflow: 'hidden' },
        gaugeFill: { height: 8, borderRadius: 4 },
        rowLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
        label: { color: appearance.foreground, fontSize: 13 },
        value: { color: appearance.muted, fontSize: 13, flexShrink: 1, textAlign: 'right' },
        small: { color: appearance.muted, fontSize: 12, lineHeight: 17 },
        memoryText: { color: appearance.foreground, fontSize: 13, lineHeight: 19 },
        change: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
        changeText: { flex: 1, color: appearance.foreground, fontSize: 13 },
        undone: { opacity: 0.55 },
        undoButton: {
          borderRadius: 7,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.input,
          paddingHorizontal: 12,
          paddingVertical: 5,
        },
        undoLabel: { color: appearance.foreground, fontSize: 13 },
      }),
    [appearance],
  );
  const [memory, setMemory] = useState<GbotMemory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    props.load().then(
      (loaded) => {
        if (!cancelled) setMemory(loaded);
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

  const undo = useCallback(
    (id: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      props.undo(id).then(
        (after) => {
          setMemory(after);
          setBusy(false);
        },
        (undoError: unknown) => {
          setError(undoError instanceof Error ? undoError.message : String(undoError));
          setBusy(false);
        },
      );
    },
    [busy, props],
  );

  if (memory === null) {
    return error === null ? (
      <ActivityIndicator style={form.loading} color={appearance.muted} />
    ) : (
      <Text style={form.error}>{error}</Text>
    );
  }
  const fill = memory.level === 'red' ? RED : memory.level === 'amber' ? AMBER : appearance.accent;
  const gaugeNote =
    memory.level === 'red'
      ? "Over what loads: the end of MEMORY.md doesn't reach new chats until older notes move to the archive."
      : memory.level === 'amber'
        ? 'Nearly full: the next note moves the oldest ones to the archive.'
        : `When it fills up, the oldest notes move to the archive (${memory.archiveNotes} there now).`;
  const days = memory.log.filter((day) => day.lines.length > 0);

  return (
    <View>
      <View style={styles.section}>
        <Text style={styles.heading}>What loads when a chat starts</Text>
        <View style={styles.box}>
          <View style={styles.rowLine}>
            <Text style={styles.label}>MEMORY.md</Text>
            <Text style={[styles.value, memory.level === 'ok' ? null : { color: fill }]}>
              {gbotMemoryGaugeLabel(memory)}
            </Text>
          </View>
          <View style={styles.gaugeTrack} accessibilityLabel={`Memory ${Math.round(memory.share * 100)}% full`}>
            <View
              style={[
                styles.gaugeFill,
                { backgroundColor: fill, width: `${Math.round(Math.min(1, Math.max(0.02, memory.share)) * 100)}%` },
              ]}
            />
          </View>
          <Text style={[styles.small, { marginTop: 6, marginBottom: 6 }]}>{gaugeNote}</Text>
          <View style={styles.rowLine}>
            <Text style={styles.label}>Instructions</Text>
            <Text style={styles.value}>{lines(memory.instructionsLines)}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.label}>Shared preferences</Text>
            <Text style={styles.value}>{lines(memory.preferencesLines)}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.label}>Topic index</Text>
            <Text style={styles.value}>
              {memory.topicsIndexed === 0
                ? 'None yet'
                : `${memory.topicsIndexed} topic${memory.topicsIndexed === 1 ? '' : 's'}, read when needed`}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>MEMORY.md</Text>
        <View style={styles.box}>
          <Text style={styles.memoryText} selectable>
            {memory.text.trim().length > 0 ? memory.text.trimEnd() : '(Empty)'}
          </Text>
        </View>
        <Text style={[styles.small, { marginTop: 4 }]}>Edit it from GBot Settings on your computer.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Topics</Text>
        <View style={styles.box}>
          {memory.topics.length === 0 ? (
            <Text style={styles.small}>No topics yet.</Text>
          ) : (
            memory.topics.map((topic) => (
              <View key={topic.name} style={{ paddingVertical: 4 }}>
                <Text style={styles.label}>{topic.title}</Text>
                <Text style={styles.small}>
                  {topic.description.length > 0 ? `${topic.description} · ` : ''}memory/{topic.name}.md
                </Text>
              </View>
            ))
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Daily log</Text>
        <View style={styles.box}>
          {days.length === 0 ? (
            <Text style={styles.small}>Nothing yet. A line is added each time one of its chats finishes a turn.</Text>
          ) : (
            days.slice(0, 2).map((day) => (
              <View key={day.date} style={{ paddingVertical: 4 }}>
                <Text style={styles.label}>{day.date === memory.today ? 'Today' : day.date}</Text>
                {[...day.lines]
                  .reverse()
                  .slice(0, 8)
                  .map((line, index) => (
                    <Text key={`${day.date}-${index}`} style={styles.small}>
                      {line}
                    </Text>
                  ))}
              </View>
            ))
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Changes</Text>
        <View style={styles.box}>
          {memory.changes.length === 0 ? (
            <Text style={styles.small}>No changes yet.</Text>
          ) : (
            memory.changes.slice(0, CHANGES_SHOWN).map((change) => (
              <View key={change.id} style={[styles.change, change.undone ? styles.undone : null]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.changeText}>
                    {change.by} · {change.what}
                    {change.undone ? ' (undone)' : ''}
                  </Text>
                  <Text style={styles.small}>{gbotMemoryWhen(change.at)}</Text>
                </View>
                {change.undoable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Undo ${change.what}`}
                    disabled={busy}
                    onPress={() => undo(change.id)}
                    style={[styles.undoButton, busy ? { opacity: 0.5 } : null]}
                  >
                    <Text style={styles.undoLabel}>{busy ? 'Undoing…' : 'Undo'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>
      </View>
      {error !== null ? <Text style={form.error}>{error}</Text> : null}
    </View>
  );
}
