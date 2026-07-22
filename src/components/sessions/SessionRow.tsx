/**
 * SESSION row renderer, styled after the desktop gpui sidebar session card
 * (sidebar/styles/session-cards.css): flat row, 15dp brand-tinted agent icon,
 * 13sp weight-600 title, muted Last Active label, and a right-anchored glowing
 * status dot (amber working with pulse, blue attention/done, red error, grey
 * sleep, hidden idle). Sleeping rows dim to 0.52 like the desktop.
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import {
  agentIconTint,
  displayStatus,
  resolveAgentIconId,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { SessionCopy } from '../../copy';
import { SidebarPalette, statusDotColor } from '../../theme/palette';

export type SessionRowProps = {
  session: GhostexSession;
  /** Warm-attached session key matches the current terminal. */
  active: boolean;
  onPress: () => void;
  onLongPress: () => void;
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

function StatusDot({ color, pulsing }: { color: string; pulsing: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulsing) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 675, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 675, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, pulsing]);
  return (
    <Animated.View style={[styles.dotHalo, { backgroundColor: `${color}1F`, opacity }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
    </Animated.View>
  );
}

export default function SessionRow({ session, active, onPress, onLongPress }: SessionRowProps) {
  const iconId = resolveAgentIconId(
    session.agentIcon,
    session.agentName.length > 0 ? session.agentName : session.agent,
  );
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  const status = displayStatus(session);
  const sleeping = status === 'sleep' || status === 'sleeping';
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const dotColor = statusDotColor(status, session.isFocused);
  const lastActive = compactLastActive(session);

  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.row, active ? styles.rowActive : null]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={[styles.content, sleeping ? styles.contentSleeping : null]}>
        <View style={styles.icon}>
          <Icon size={15} color={agentIconTint(iconId)} />
        </View>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        {lastActive.length > 0 ? <Text style={styles.lastActive}>{lastActive}</Text> : null}
        <View style={styles.trailing}>
          {dotColor !== null ? (
            <StatusDot color={dotColor} pulsing={status === 'working'} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 40,
    justifyContent: 'center',
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 0,
  },
  rowActive: {
    backgroundColor: 'rgba(125,164,248,0.12)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contentSleeping: {
    opacity: SidebarPalette.SLEEP_OPACITY,
  },
  icon: {
    width: 16,
    height: 16,
    marginEnd: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: SidebarPalette.FOREGROUND,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.26,
    lineHeight: 17,
  },
  lastActive: {
    marginStart: 8,
    color: SidebarPalette.MUTED,
    fontSize: 10.5,
    fontVariant: ['tabular-nums'],
  },
  trailing: {
    width: 18,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  dotHalo: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
});
