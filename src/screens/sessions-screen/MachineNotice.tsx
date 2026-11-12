/**
 * The Sessions screen's line about a computer that is not connected (`machineNotice` and `noticeLine` in
 * src/components/sessions/machineNotice.ts hold the rule). It sits in the screen's flow above the search row, so the
 * list moves down for it and nothing ever covers its rows; its tap opens the Connections sheet
 * (src/components/sessions/ConnectionsSheet.tsx), which has the full reason, the fix, Retry and Logs.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { noticeLine, type NoticeEntry } from '../../components/sessions/machineNotice';
import { SpinningLoader } from '../../components/sessions/MachineTabs';
import { WarningTriangleIcon } from '../../components/terminal/icons';
import { MachineNoticeCopy } from '../../copy';
import type { SidebarAppearance } from '../../theme/sidebarAppearance';
import { SetupPalette } from '../../theme/palette';

/** A computer connecting this long is said on the line; a quicker connect says nothing. */
const CONNECTING_SHOWN_AFTER_MS = 5_000;

/**
 * `entries` with each connecting computer left out until it has been connecting for 5 s.
 *
 * CDXC:RemoteMachines 2026-11-12 DECISION:
 * User (Q2739): the Sessions screen says nothing while everything works, and "Connecting to …" only if it takes more
 * than 5 s. Failures always show at once.
 */
export function useShownNotices(entries: readonly NoticeEntry[]): NoticeEntry[] {
  const since = useRef(new Map<string, number>());
  const [, setTick] = useState(0);
  const now = Date.now();
  const connecting = new Set(entries.filter(({ notice }) => notice.kind === 'connecting').map(({ machineId }) => machineId));
  for (const machineId of [...since.current.keys()]) if (!connecting.has(machineId)) since.current.delete(machineId);
  for (const machineId of connecting) if (!since.current.has(machineId)) since.current.set(machineId, now);
  const waiting = [...since.current.values()].filter((at) => now - at < CONNECTING_SHOWN_AFTER_MS);
  const nextDue = waiting.length === 0 ? null : Math.min(...waiting) + CONNECTING_SHOWN_AFTER_MS;
  useEffect(() => {
    if (nextDue === null) return;
    const timer = setTimeout(() => setTick((tick) => tick + 1), Math.max(0, nextDue - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [nextDue]);
  return entries.filter(
    ({ machineId, notice }) =>
      notice.kind !== 'connecting' || now - (since.current.get(machineId) ?? now) >= CONNECTING_SHOWN_AFTER_MS,
  );
}

/** The clock the "list from 2 min ago" part reads; ticks only while it is shown. */
export function useNoticeClock(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/** The status row's text while a computer is connecting or failing; null when there is nothing to say. */
export function MachineNoticeLine({
  entries,
  now,
  appearance,
  onPress,
}: {
  entries: readonly NoticeEntry[];
  now: number;
  appearance: SidebarAppearance;
  onPress: () => void;
}) {
  const line = noticeLine(entries, now);
  if (line === null) return null;
  if (line.kind === 'connecting') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.line}>
        <SpinningLoader color={appearance.mutedGlyph} size={12} />
        <Text numberOfLines={1} style={[styles.lineText, { color: appearance.muted }]}>
          {line.text}
        </Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={line.text}
      accessibilityHint={MachineNoticeCopy.detailsHint}
      accessibilityLiveRegion="polite"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.line, styles.failureLine, pressed ? styles.pressed : null]}
    >
      <WarningTriangleIcon size={13} color={SetupPalette.ERROR} />
      {/* Two lines at most: in the flow it may wrap, so a long computer name never cuts the message. */}
      <Text numberOfLines={2} style={[styles.lineText, styles.failureText, { color: appearance.foreground }]}>
        {line.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20, minWidth: 0 },
  failureLine: { alignItems: 'flex-start', paddingVertical: 2 },
  lineText: { fontSize: 12, flexShrink: 1 },
  failureText: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
