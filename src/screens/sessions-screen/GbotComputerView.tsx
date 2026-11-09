/**
 * GBot Settings > Computer on the phone: where the GBot's chats run (this computer, a connected computer and the
 * folder there, or a Cloud Box), whether it may use that computer's screen and apps, and how many of its chats run
 * elsewhere. The phone can give it this computer back and turn computer use off; giving it another computer, a Cloud
 * Box or computer use is done on the computer, like raising its approval level.
 *
 * CDXC:GBots 2026-11-09 DECISION: Coordinator brief for M12: "Show the GBot's computer in GBot Settings (desktop/web
 * and phone)" and "Only the user can give a GBot a computer". The phone reaches the computer through the `ghostex` CLI
 * over SSH, which gxserver can't tell apart from an agent, so it gets the same turn-off-only rights as the terminal.
 * SEE-ALSO: apps/desktop/src/app/window/gbot_settings_modal/computer.rs (the desktop tab), server/src/gbots/computer/ops.rs.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { GbotComputer } from '../../contract/gbotComputer';
import { GhostexStrokeWidth } from '../../theme/palette';
import { useGbotFormStyles } from './GbotFormParts';

export type GbotComputerChange = { thisComputer?: true; screen?: false };

export type GbotComputerViewProps = {
  name: string;
  load: () => Promise<GbotComputer>;
  /** Applies `change`, then answers where it works afterwards. */
  act: (change: GbotComputerChange) => Promise<GbotComputer>;
};

function placeLine(computer: GbotComputer): string {
  switch (computer.kind) {
    case 'computer':
      return computer.available
        ? `Its chats run on ${computer.name}, in ${computer.folder} there.`
        : `Its chats run on ${computer.name}, which isn't connected now: its new chats can't start until it is.`;
    case 'cloudBox':
      return `Its chats run on the Cloud Box ${computer.name}, each in its own worktree of that project.`;
    default:
      return computer.thisComputer.length > 0
        ? `Its chats run on this computer (${computer.thisComputer}), beside its folder.`
        : 'Its chats run on this computer, beside its folder.';
  }
}

export default function GbotComputerView(props: GbotComputerViewProps): ReactElement {
  const { appearance, styles: form } = useGbotFormStyles();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        box: {
          marginTop: 14,
          borderRadius: 8,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.card,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 6,
        },
        heading: { color: appearance.foreground, fontSize: 14, fontWeight: '600' },
        line: { color: appearance.foreground, fontSize: 13, lineHeight: 18 },
        small: { color: appearance.muted, fontSize: 12.5, lineHeight: 17 },
        buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
        button: {
          borderRadius: 7,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.input,
          paddingHorizontal: 12,
          paddingVertical: 6,
        },
        label: { color: appearance.foreground, fontSize: 13 },
        disabled: { opacity: 0.5 },
        note: { color: appearance.muted, fontSize: 12.5, lineHeight: 17, marginTop: 12 },
      }),
    [appearance],
  );
  const [computer, setComputer] = useState<GbotComputer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    props.load().then(
      (loaded) => {
        if (!cancelled) setComputer(loaded);
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
    (change: GbotComputerChange) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      props.act(change).then(
        (after) => {
          setComputer(after);
          setBusy(false);
        },
        (actError: unknown) => {
          setError(actError instanceof Error ? actError.message : String(actError));
          setBusy(false);
        },
      );
    },
    [busy, props],
  );

  if (computer === null) {
    return error === null ? (
      <ActivityIndicator style={form.loading} color={appearance.muted} />
    ) : (
      <Text style={form.error}>{error}</Text>
    );
  }
  const button = (label: string, change: GbotComputerChange) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={() => act(change)}
      style={[styles.button, busy ? styles.disabled : null]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
  const elsewhere =
    computer.chatsElsewhere === 1
      ? '1 chat runs on another computer.'
      : computer.chatsElsewhere > 1
        ? `${computer.chatsElsewhere} chats run on other computers.`
        : null;
  return (
    <View>
      {error !== null ? <Text style={form.error}>{error}</Text> : null}
      <View style={styles.box}>
        <Text style={styles.heading}>Runs on</Text>
        <Text style={styles.line}>{placeLine(computer)}</Text>
        {elsewhere !== null ? <Text style={styles.small}>{elsewhere}</Text> : null}
        {computer.kind !== 'this' ? (
          <View style={styles.buttons}>{button('Use this computer', { thisComputer: true })}</View>
        ) : null}
      </View>
      <View style={styles.box}>
        <Text style={styles.heading}>Computer use</Text>
        <Text style={styles.line}>
          {computer.computerUse
            ? `${props.name} may open and drive apps on the computer it works on.`
            : `${props.name}'s chats start without the screen tools. A Codex GBot at Full access can still run their command-line tools from a shell.`}
        </Text>
        {computer.computerUse ? (
          <View style={styles.buttons}>{button('Turn off', { screen: false })}</View>
        ) : null}
      </View>
      <Text style={styles.note}>
        {`Its folder, memory and routines stay on this computer. To give ${props.name} another computer, a Cloud Box or computer use, open its GBot Settings on the computer.`}
      </Text>
    </View>
  );
}
