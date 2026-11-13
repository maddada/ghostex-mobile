/**
 * Pieces the Beads screen and the Bead screen share: a bead's status mark, its priority tag, the
 * card a failed write or sync leaves (bd's output behind Details), and the sync pill with its sheet.
 * Card titles and messages are the desktop's (`apps/desktop/src/app/native_beads/cards.rs`).
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Glyph } from '../chat/native/transcript/icons';
import { MONO_FONT, themedStyles, useTranscriptTheme, type TranscriptTheme } from '../chat/native/transcript/theme';
import ActionSheet from '../components/common/ActionSheet';
import { BeadsCopy } from '../copy';
import { parseBdTime, relativeAgo, type BeadGlyph, type BeadsSync, type BeadsSyncResult } from './model';
import type { BeadsNotice } from './store';

function glyphColor(glyph: BeadGlyph, theme: TranscriptTheme): string {
  switch (glyph) {
    case 'inProgress':
      return theme.light ? '#a16207' : '#e2c08d';
    case 'blocked':
      return theme.light ? '#be123c' : '#f87171';
    case 'decision':
      return theme.light ? '#7c3aed' : '#c4b5fd';
    case 'review':
      return theme.light ? '#0550ae' : '#79c0ff';
    case 'closed':
      return theme.light ? '#15803d' : '#86efac';
    default:
      return theme.muted;
  }
}

/** A bead's status mark, as the desktop tree draws it. */
export function StatusMark({ glyph, size = 14 }: { glyph: BeadGlyph; size?: number }) {
  const theme = useTranscriptTheme();
  const color = glyphColor(glyph, theme);
  if (glyph === 'snoozed' || glyph === 'onIce') return <Glyph name="clock" size={size} color={color} />;
  if (glyph === 'closed') return <Glyph name="check" size={size} color={color} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Circle cx={8} cy={8} r={5.5} stroke={color} strokeWidth={1.6} fill="none" />
      {glyph === 'inProgress' ? <Path d="M8 2.5 A5.5 5.5 0 0 1 8 13.5 Z" fill={color} /> : null}
      {glyph === 'blocked' ? <Path d="M4.2 11.8 L11.8 4.2" stroke={color} strokeWidth={1.6} /> : null}
      {glyph === 'decision' ? <Circle cx={8} cy={8} r={2.2} fill={color} /> : null}
      {glyph === 'review' ? <Circle cx={8} cy={8} r={1.6} fill={color} /> : null}
    </Svg>
  );
}

export function PriorityTag({ priority }: { priority: string | null }) {
  const styles = useStyles();
  if (priority === null) return null;
  return (
    <View style={styles.priority}>
      <Text style={styles.priorityText}>{priority}</Text>
    </View>
  );
}

/** A card with a title, one or two sentences, and bd's own output behind Details. */
export function NoticeCard({
  notice,
  onDismiss,
  action,
}: {
  notice: BeadsNotice;
  onDismiss?: () => void;
  action?: { label: string; onPress: () => void };
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{notice.title}</Text>
      <Text style={styles.cardBody}>{notice.message}</Text>
      {open && notice.details !== null ? (
        <Text style={styles.cardDetails} selectable>
          {notice.details}
        </Text>
      ) : null}
      <View style={styles.cardButtons}>
        {action !== undefined ? (
          <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.cardButton}>
            <Text style={styles.cardButtonText}>{action.label}</Text>
          </Pressable>
        ) : null}
        {notice.details !== null ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)} style={styles.cardButton}>
            <Text style={styles.cardButtonText}>{open ? BeadsCopy.hideDetails : BeadsCopy.details}</Text>
          </Pressable>
        ) : null}
        {onDismiss !== undefined ? (
          <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.cardButton}>
            <Text style={styles.cardButtonText}>{BeadsCopy.dismiss}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** The card for a sync that did not go through (`cards.rs` `sync_failure`); `pullNow` offers Pull. */
export function syncFailure(result: BeadsSyncResult | null): (BeadsNotice & { pullNow: boolean }) | null {
  if (result === null || result.ok) return null;
  const push = result.kind === 'push';
  const didnt = push ? 'Push didn’t go through' : 'Pull didn’t go through';
  const details = result.output.length > 0 ? result.output : null;
  switch (result.code) {
    case 'notFastForward':
      return {
        title: 'Push didn’t go through',
        message: 'The remote has changes this computer doesn’t have yet. Pull them, then push again.',
        details,
        pullNow: true,
      };
    case 'conflict':
      return {
        title: push ? didnt : 'Pull found conflicting changes',
        message: 'The same beads changed here and on another computer. Ask an agent to resolve the conflict with bd, then sync again.',
        details,
        pullNow: false,
      };
    case 'noRemote':
      return {
        title: 'No sync remote set up',
        message: 'This workspace has nowhere to sync to yet. Ask an agent to add one with bd dolt remote add.',
        details,
        pullNow: false,
      };
    case 'auth':
      return { title: didnt, message: 'The remote refused this computer’s credentials. Check access to it, then try again.', details, pullNow: false };
    case 'network':
      return { title: didnt, message: 'Couldn’t reach the remote. Check the connection, then try again.', details, pullNow: false };
    case 'timeout':
      return {
        title: push ? 'Push took too long' : 'Pull took too long',
        message: 'Beads stayed busy or the remote was slow. Try again in a moment.',
        details,
        pullNow: false,
      };
    default:
      return { title: didnt, message: 'Beads stopped with an error. Details has what it said.', details, pullNow: false };
  }
}

/** "Synced 4 min ago", "Pulling…", "Not synced yet", and whether the last sync failed (`cards.rs` `synced_label`). */
export function syncStatus(sync: BeadsSync): { label: string; failed: boolean; running: boolean } {
  if (sync.running !== null) return { label: sync.running.kind === 'push' ? BeadsCopy.pushing : BeadsCopy.pulling, failed: false, running: true };
  const times = [sync.lastPushAt, sync.lastPullAt].map(parseBdTime).filter((time): time is number => time !== null);
  const failed = sync.lastResult !== null && !sync.lastResult.ok && sync.lastResult.code !== 'noRemote';
  const label = times.length > 0 ? BeadsCopy.synced(relativeAgo(Math.max(...times))) : BeadsCopy.syncNotYet;
  return { label: failed ? BeadsCopy.syncFailedPill : label, failed, running: false };
}

export function SyncPill({ sync, onPress }: { sync: BeadsSync; onPress: () => void }) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  const status = syncStatus(sync);
  const color = status.failed ? (theme.light ? '#be123c' : '#f87171') : theme.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${BeadsCopy.syncTitle}: ${status.label}`}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <Glyph name={status.failed ? 'x' : 'download'} size={13} color={color} />
      <Text style={[styles.pillText, { color }]} numberOfLines={1}>
        {status.label}
      </Text>
    </Pressable>
  );
}

/** The sync pill's sheet: the remote, the last push and pull, and Pull and Push (the desktop's Sync menu). */
export function SyncSheet({
  visible,
  sync,
  onSync,
  onClose,
}: {
  visible: boolean;
  sync: BeadsSync;
  onSync: (kind: 'pull' | 'push') => void;
  onClose: () => void;
}) {
  const ago = (time: string | null) => {
    const parsed = parseBdTime(time);
    return parsed !== null ? relativeAgo(parsed) : 'not yet';
  };
  const subtitle = [
    sync.remote !== null ? BeadsCopy.remote(sync.remote.name, sync.remote.url) : BeadsCopy.noRemote,
    `${BeadsCopy.lastPush(ago(sync.lastPushAt))} · ${BeadsCopy.lastPull(ago(sync.lastPullAt))}`,
  ].join('\n');
  const running = sync.running !== null;
  return (
    <ActionSheet
      visible={visible}
      title={BeadsCopy.syncTitle}
      subtitle={subtitle}
      onClose={onClose}
      items={
        sync.remote === null
          ? []
          : [
              { key: 'pull', label: BeadsCopy.pull, detail: BeadsCopy.syncHelp, disabled: running, onPress: () => onSync('pull') },
              { key: 'push', label: BeadsCopy.push, disabled: running, onPress: () => onSync('push') },
            ]
      }
    />
  );
}

const useStyles = themedStyles((t) => ({
  priority: {
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: t.controlBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityText: { color: t.foreground, fontSize: 11.5, fontWeight: '600', fontFamily: MONO_FONT },
  card: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 14,
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBackground,
  },
  cardTitle: { color: t.foreground, fontSize: 14, fontWeight: '600' },
  cardBody: { color: t.muted, fontSize: 13, lineHeight: 18 },
  cardDetails: { color: t.muted, fontSize: 12, lineHeight: 17, fontFamily: MONO_FONT },
  cardButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  cardButton: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 8,
    backgroundColor: t.neutralFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardButtonText: { color: t.foreground, fontSize: 13, fontWeight: '600' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    maxWidth: 150,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.controlBorder,
  },
  pillText: { fontSize: 12.5, fontWeight: '500', flexShrink: 1 },
  pressed: { opacity: 0.6 },
}));
