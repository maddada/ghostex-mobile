/**
 * The Sessions screen's line about a computer that is not connected, and the details its tap opens
 * (`machineNotice` and `noticeLine` in src/components/sessions/machineNotice.ts hold the rule). Both
 * sit in the screen's flow above the search row: the line in the status row, the details right under
 * it, so the list moves down for them and nothing ever covers its rows.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { RefreshGlyph, SettingsGlyph } from '../../components/sessions/icons';
import { agoText, noticeLine, type NoticeEntry } from '../../components/sessions/machineNotice';
import { SpinningLoader } from '../../components/sessions/MachineTabs';
import { WarningTriangleIcon } from '../../components/terminal/icons';
import { MachineNoticeCopy } from '../../copy';
import type { SidebarAppearance } from '../../theme/sidebarAppearance';
import { SetupPalette } from '../../theme/palette';

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
  open,
  appearance,
  onToggle,
}: {
  entries: readonly NoticeEntry[];
  now: number;
  open: boolean;
  appearance: SidebarAppearance;
  onToggle: () => void;
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
      accessibilityState={{ expanded: open }}
      accessibilityLiveRegion="polite"
      hitSlop={8}
      onPress={onToggle}
      style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
    >
      <WarningTriangleIcon size={13} color={SetupPalette.ERROR} />
      <Text numberOfLines={1} style={[styles.lineText, styles.failureText, { color: appearance.foreground }]}>
        {line.text}
      </Text>
    </Pressable>
  );
}

/** What the line's tap opens: per failing computer, the full reason, how old the list is, and its buttons. */
export function MachineNoticeDetails({
  entries,
  now,
  appearance,
  onRetry,
  onRemoteSettings,
  onLogs,
}: {
  entries: readonly NoticeEntry[];
  now: number;
  appearance: SidebarAppearance;
  onRetry: (machineId: string) => void;
  onRemoteSettings: (machineId: string) => void;
  onLogs: () => void;
}) {
  const failures = entries.flatMap(({ machineId, notice }) =>
    notice.kind === 'failure' ? [{ machineId, notice }] : [],
  );
  if (failures.length === 0) return null;
  return (
    <View style={[styles.card, { backgroundColor: appearance.card, borderColor: appearance.border }]}>
      {failures.map(({ machineId, notice }, index) => (
        <View key={machineId} style={index > 0 ? [styles.next, { borderTopColor: appearance.border }] : null}>
          {failures.length > 1 ? (
            <Text style={[styles.title, { color: appearance.foreground }]}>{notice.title}</Text>
          ) : null}
          <Text selectable style={[styles.reason, { color: appearance.muted }]}>
            {notice.reason}
            {notice.staleSince === null ? '' : ` ${MachineNoticeCopy.staleLong(agoText(notice.staleSince, now))}`}
          </Text>
          <View style={styles.actions}>
            <SetupButton
              small
              variant="primary"
              busy={notice.retrying}
              label={MachineNoticeCopy.retry}
              icon={<RefreshGlyph size={13} color={SetupPalette.PRIMARY_BUTTON_FOREGROUND} />}
              onPress={() => onRetry(machineId)}
            />
            <SetupButton
              small
              variant="secondary"
              label={MachineNoticeCopy.remoteSettings}
              icon={<SettingsGlyph size={13} color={SetupPalette.FOREGROUND} />}
              onPress={() => onRemoteSettings(machineId)}
            />
            {index === failures.length - 1 ? (
              <SetupButton small variant="secondary" label={MachineNoticeCopy.logs} onPress={onLogs} />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20, minWidth: 0 },
  lineText: { fontSize: 12, flexShrink: 1 },
  failureText: { fontSize: 13, fontWeight: '600' },
  card: {
    marginTop: 8,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  next: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  reason: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pressed: { opacity: 0.6 },
});
