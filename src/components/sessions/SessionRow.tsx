/**
 * SESSION row renderer, cloned from the desktop gpui reference sidebar
 * (sidebar/styles/group-panels.css + hierarchy-panels.css): 34dp flat row,
 * absolutely-placed leading agent icon at 48% opacity (13dp brand masks, 15dp
 * terminal/browser glyphs), 15.5dp weight-300 title (#b4b8c0), muted relative
 * time on the right (hidden while working/attention), and a tiny flat 7dp
 * status dot at the right edge — blue for attention/done/error, gray for
 * remote sleeping, and NOTHING for working/idle (desktop hides both). Sleeping
 * dims only the title, and the active row gets the translucent rounded fill.
 */

import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import {
  agentIconTint,
  displayStatus,
  resolveAgentIconId,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { SessionCopy } from '../../copy';
import { SidebarPalette } from '../../theme/palette';
import type { MenuAnchor } from './ContextMenu';
import { ds } from './rows';
import { PinGlyph } from './icons';

export type SessionRowProps = {
  session: GhostexSession;
  /** Warm-attached session key matches the current terminal. */
  active: boolean;
  /** True for rows inside a project card (tighter insets than Quick rows). */
  inCard: boolean;
  onPress: () => void;
  /** Context menu, opened by long-pressing the row (anchored to the row). */
  onMenu: (anchor: MenuAnchor) => void;
};

/** Compact desktop-style relative time: 32s / 5m / 3h / 2d. */
function compactLastActive(session: GhostexSession): string {
  const iso = session.lastInteractionAt.length > 0 ? session.lastInteractionAt : session.lastActiveAt;
  if (iso.length === 0) return '';
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Right-edge dot color per the desktop reference sidebar: attention/done/error
 * share the blue token, remote sleeping is neutral gray, and working/idle rows
 * show no dot at all (the working dot is display:none there).
 */
function referenceDotColor(status: string): string | null {
  if (status === 'attention' || status === 'done' || status === 'error') {
    return SidebarPalette.PILL_ATTENTION;
  }
  if (status === 'sleep' || status === 'sleeping') return SidebarPalette.SLEEP_DOT;
  return null;
}

export default function SessionRow({ session, active, inCard, onPress, onMenu }: SessionRowProps) {
  const rowRef = useRef<View | null>(null);
  const iconId = resolveAgentIconId(
    session.agentIcon,
    session.agentName.length > 0 ? session.agentName : session.agent,
  );
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  const iconSize = iconId === 'terminal' || iconId === 'browser' ? ds(15) : ds(13);
  const status = displayStatus(session);
  const sleeping = status === 'sleep' || status === 'sleeping';
  const working = status === 'working';
  const attention = status === 'attention';
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const dotColor = referenceDotColor(status);
  const lastActive = working || attention ? '' : compactLastActive(session);
  const iconLeft = inCard ? ds(5) : ds(26);

  const openMenuFromRow = (): void => {
    const node = rowRef.current;
    if (node === null) return;
    node.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }));
  };

  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        inCard ? styles.rowCard : styles.rowQuick,
        active ? styles.rowActive : pressed ? styles.rowPressed : null,
      ]}
      onPress={onPress}
      onLongPress={openMenuFromRow}
    >
      {session.isPinned ? (
        <View style={[styles.pin, { left: Math.max(0, iconLeft - ds(16)) }]}>
          <PinGlyph size={ds(13)} color="rgba(255,255,255,0.9)" />
        </View>
      ) : null}
      <View style={[styles.icon, { left: iconLeft }, active ? styles.iconActive : null]}>
        <Icon size={iconSize} color={agentIconTint(iconId)} />
      </View>
      <Text
        style={[
          styles.title,
          active ? styles.titleActive : null,
          sleeping ? styles.titleSleeping : null,
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {title}
      </Text>
      {lastActive.length > 0 ? <Text style={styles.lastActive}>{lastActive}</Text> : null}
      {dotColor !== null ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: ds(34),
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: ds(14),
    borderRadius: ds(4),
  },
  rowCard: {
    paddingLeft: ds(26),
  },
  rowQuick: {
    paddingLeft: ds(47),
  },
  rowActive: {
    backgroundColor: 'rgba(200,205,213,0.10)',
  },
  rowPressed: {
    backgroundColor: 'rgba(200,205,213,0.06)',
  },
  pin: {
    position: 'absolute',
    top: '50%',
    marginTop: -ds(6.5),
    width: ds(13),
    height: ds(13),
    opacity: 0.5,
  },
  icon: {
    position: 'absolute',
    top: '50%',
    marginTop: -ds(7.5),
    width: ds(15),
    height: ds(15),
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.48,
  },
  iconActive: {
    opacity: 0.8,
  },
  title: {
    flex: 1,
    color: '#B4B8C0',
    fontSize: ds(15.5),
    fontWeight: '300',
    lineHeight: ds(20),
  },
  titleActive: {
    color: '#D8D8D8',
  },
  titleSleeping: {
    color: '#5F646B',
    opacity: 0.42,
  },
  lastActive: {
    marginStart: ds(8),
    color: '#4F5359',
    fontSize: ds(13.5),
    fontWeight: '300',
    lineHeight: ds(20),
    textAlign: 'right',
  },
  dot: {
    position: 'absolute',
    right: ds(6),
    top: '50%',
    marginTop: -ds(3.5),
    width: ds(7),
    height: ds(7),
    borderRadius: 999,
  },
});
