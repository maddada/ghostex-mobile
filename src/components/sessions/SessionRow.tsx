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
import { GhostMenuButton } from './rows';
import { PinGlyph } from './icons';

export type SessionRowProps = {
  session: GhostexSession;
  /** Warm-attached session key matches the current terminal. */
  active: boolean;
  /** True for rows inside a project card (tighter insets than Quick rows). */
  inCard: boolean;
  onPress: () => void;
  /** Context menu, from the ⋮ button or a long-press (anchored either way). */
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
  const iconSize = iconId === 'terminal' || iconId === 'browser' ? 15 : 13;
  const status = displayStatus(session);
  const sleeping = status === 'sleep' || status === 'sleeping';
  const working = status === 'working';
  const attention = status === 'attention';
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const dotColor = referenceDotColor(status);
  const lastActive = working || attention ? '' : compactLastActive(session);
  const iconLeft = inCard ? 5 : 26;

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
        <View style={[styles.pin, { left: Math.max(0, iconLeft - 16) }]}>
          <PinGlyph size={13} color="rgba(255,255,255,0.9)" />
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
      <View style={styles.menuButton}>
        <GhostMenuButton accessibilityLabel={`${title} session menu`} onAnchorPress={onMenu} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 40,
    borderRadius: 4,
  },
  menuButton: {
    position: 'absolute',
    right: 14,
    top: '50%',
    marginTop: -11,
  },
  rowCard: {
    paddingLeft: 26,
  },
  rowQuick: {
    paddingLeft: 47,
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
    marginTop: -6.5,
    width: 13,
    height: 13,
    opacity: 0.5,
  },
  icon: {
    position: 'absolute',
    top: '50%',
    marginTop: -7.5,
    width: 15,
    height: 15,
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
    fontSize: 15.5,
    fontWeight: '300',
    lineHeight: 20,
  },
  titleActive: {
    color: '#D8D8D8',
  },
  titleSleeping: {
    color: '#5F646B',
    opacity: 0.42,
  },
  lastActive: {
    marginStart: 8,
    color: '#4F5359',
    fontSize: 13.5,
    fontWeight: '300',
    lineHeight: 20,
    textAlign: 'right',
  },
  dot: {
    position: 'absolute',
    right: 6,
    top: '50%',
    marginTop: -3.5,
    width: 7,
    height: 7,
    borderRadius: 999,
  },
});
