/**
 * The Connections sheet: every computer's link, problems first, each with its live route, and for a computer that
 * can't connect or is slow the plain reason and the fix. Opened from a computer's icon on the Sessions screen (or the
 * status line of a failure); Logs and Connection settings sit at its foot.
 *
 * CDXC:RemoteMachines 2026-11-12 DECISION:
 * User (Q2740, Q2742): a computer that can't connect shows its own icon red, "and when they click we show the panel
 * that explains the connection stuff and has a button i can click to go switch to tailscale app to enable it on my
 * phone", with Logs to copy or send; the bottom sheet with a card per computer, problems first, was picked over a
 * small card under the icons. This replaces the amber "Tailscale isn't connected" card and the failure line's inline
 * details.
 */

import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConnectionsCopy, FailureCopy } from '../../copy';
import { recentDropCount, latestRoundTrip } from '../../machines/connectionHealthModel';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { useFoldSheetMaxHeight } from '../common/foldAvoidance';
import { useVerticalBarSpace } from '../common/verticalBar/VerticalBarArea';
import { SetupButton } from '../onboarding/SetupPrimitives';
import { ComputerIconGlyph } from './ComputerIconGlyph';
import { CloudGlyph, RefreshGlyph, SettingsGlyph } from './icons';
import { SpinningLoader } from './MachineTabs';
import type { ConnectionEntry } from './useConnectionEntries';
import type { LinkStatus } from '../../machines/linkStatus';

export type ConnectionsSheetProps = {
  entries: readonly ConnectionEntry[];
  onClose: () => void;
  onRetry: (machineId: string) => void;
  onOpenTailscale: () => void;
  onRemoteSettings: (machineId: string) => void;
  /** Opens the Logs sheet; `machineId` is the computer it was opened from, null from the foot. */
  onLogs: (machineId: string | null) => void;
  onConnectionSettings: () => void;
};

/** The colour a link status draws its icon and word in. */
export function linkStatusColor(status: LinkStatus, appearance: Appearance): string {
  switch (status) {
    case 'failed':
      return appearance.danger;
    case 'slow':
      return appearance.working;
    case 'connected':
      return appearance.connected;
    default:
      return appearance.muted;
  }
}

/** A computer's icon in its link's colour (the cloud while its icon is unknown). */
export function LinkIcon({ entry, size, color }: { entry: ConnectionEntry; size: number; color: string }) {
  return entry.iconDrawing !== undefined ? (
    <ComputerIconGlyph drawing={entry.iconDrawing} size={size} color={color} />
  ) : (
    <CloudGlyph size={size} color={color} />
  );
}

export default function ConnectionsSheet({
  entries,
  onClose,
  onRetry,
  onOpenTailscale,
  onRemoteSettings,
  onLogs,
  onConnectionSettings,
}: ConnectionsSheetProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const bar = useVerticalBarSpace();
  const foldMaxHeight = useFoldSheetMaxHeight({ avoidsKeyboard: false });
  const counts = {
    failed: entries.filter((entry) => entry.status === 'failed').length,
    slow: entries.filter((entry) => entry.status === 'slow').length,
    fine: entries.filter((entry) => entry.status === 'connected').length,
  };
  const now = Date.now();

  const card = (entry: ConnectionEntry) => {
    const color = linkStatusColor(entry.status, appearance);
    const problem = entry.status === 'failed' || entry.status === 'slow';
    const drops = recentDropCount(entry.health, now);
    const roundTrip = latestRoundTrip(entry.health);
    return (
      <View key={entry.machine.id} style={styles.card}>
        <View style={styles.cardHead}>
          {entry.status === 'connecting' ? (
            <SpinningLoader color={appearance.mutedGlyph} size={20} />
          ) : (
            <LinkIcon entry={entry} size={20} color={color} />
          )}
          <View style={styles.cardName}>
            <Text numberOfLines={1} style={styles.name}>
              {entry.name}
            </Text>
            <Text numberOfLines={1} style={styles.route}>
              {entry.route}
            </Text>
          </View>
          <Text style={[styles.status, { color }]}>{ConnectionsCopy.status[entry.status]}</Text>
        </View>
        {problem || entry.busy ? (
          <View style={styles.cardBody}>
            {/* Out of channels while it also failed for another reason: its button is Reset connection, so say what that
              does once (a busy list error already says it). */}
            {entry.status === 'failed' && entry.busy && entry.reason !== FailureCopy.channelsBusy ? (
              <Text style={styles.why}>{FailureCopy.channelsBusy}</Text>
            ) : null}
            {entry.status === 'failed' ? (
              entry.tailscaleOff ? (
                <Text style={styles.why}>
                  <Text style={styles.whyStrong}>{ConnectionsCopy.tailscaleOff}</Text> {ConnectionsCopy.tailscaleOffFix}
                </Text>
              ) : entry.reason !== null ? (
                <Text selectable style={styles.why}>
                  {entry.reason}
                </Text>
              ) : null
            ) : entry.busy || entry.status !== 'slow' ? (
              <Text style={styles.why}>{FailureCopy.channelsBusy}</Text>
            ) : (
              <Text style={styles.why}>
                {entry.health?.slowReason === 'drops' || roundTrip === null
                  ? ConnectionsCopy.slowDrops(Math.max(drops, 2))
                  : ConnectionsCopy.slowRoundTrip(roundTrip)}{' '}
                {ConnectionsCopy.slowHint}
              </Text>
            )}
            <View style={styles.actions}>
              {entry.tailscaleOff ? (
                <SetupButton small variant="primary" label={ConnectionsCopy.openTailscale} onPress={onOpenTailscale} />
              ) : null}
              <SetupButton
                small
                variant={entry.status === 'failed' && !entry.tailscaleOff ? 'primary' : 'secondary'}
                busy={entry.retrying}
                label={entry.busy ? ConnectionsCopy.resetConnection : ConnectionsCopy.retry}
                icon={
                  <RefreshGlyph
                    size={13}
                    color={
                      entry.status === 'failed' && !entry.tailscaleOff ? appearance.accentForeground : appearance.foreground
                    }
                  />
                }
                onPress={() => onRetry(entry.machine.id)}
              />
              {entry.status === 'failed' && !entry.tailscaleOff ? (
                <SetupButton
                  small
                  label={ConnectionsCopy.remoteSettings}
                  icon={<SettingsGlyph size={13} color={appearance.foreground} />}
                  onPress={() => onRemoteSettings(entry.machine.id)}
                />
              ) : null}
              {entry.status === 'slow' ? (
                <SetupButton small label={ConnectionsCopy.sendLogs} onPress={() => onLogs(entry.machine.id)} />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, bar.padding]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, foldMaxHeight !== undefined && { maxHeight: foldMaxHeight }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.grab} />
          <Text accessibilityRole="header" style={styles.title}>
            {ConnectionsCopy.title}
          </Text>
          <Text style={styles.summary}>{ConnectionsCopy.summary(counts)}</Text>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {entries.map(card)}
          </ScrollView>
          <View style={styles.foot}>
            <SetupButton label={ConnectionsCopy.logs} style={styles.footButton} onPress={() => onLogs(null)} />
            <SetupButton
              label={ConnectionsCopy.connectionSettings}
              style={styles.footButton}
              onPress={onConnectionSettings}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: appearance.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      paddingTop: 8,
      paddingBottom: 24,
      paddingHorizontal: 14,
      maxHeight: '85%',
    },
    grab: {
      alignSelf: 'center',
      width: 36,
      height: 5,
      borderRadius: 3,
      backgroundColor: appearance.border,
      marginBottom: 10,
    },
    title: {
      color: appearance.foreground,
      fontSize: 17,
      fontWeight: '700',
    },
    summary: {
      color: appearance.muted,
      fontSize: 13,
      marginTop: 2,
    },
    list: {
      marginTop: 10,
    },
    listContent: {
      gap: 8,
      paddingBottom: 4,
    },
    card: {
      borderRadius: GhostexRadii.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    cardName: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      color: appearance.foreground,
      fontSize: 15,
      fontWeight: '600',
    },
    route: {
      color: appearance.muted,
      fontSize: 12,
      marginTop: 1,
    },
    status: {
      fontSize: 12,
      fontWeight: '600',
    },
    cardBody: {
      marginLeft: 30,
      marginTop: 8,
    },
    why: {
      color: appearance.muted,
      fontSize: 13,
      lineHeight: 18,
    },
    whyStrong: {
      color: appearance.foreground,
      fontWeight: '600',
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    foot: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    footButton: {
      flex: 1,
    },
  });
