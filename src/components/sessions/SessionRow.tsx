/**
 * SESSION row renderer, cloned from the desktop gpui reference sidebar
 * (packages/core-ui/styles/session-cards.css reference-layout skin +
 * session-card-content.tsx): 34dp flat row, absolutely-placed leading agent
 * icon at 48% opacity (13dp brand masks, 15dp terminal/browser glyphs) that an
 * active Delayed Send (yellow clock) or Close After Done (pastel-red clock)
 * timer replaces at full opacity, 15.5dp weight-300 title (#b4b8c0), and ONE
 * shared trailing slot flush at the row's right edge. A tagged session paints
 * its tag glyph in that leading slot instead of the agent icon, at full opacity
 * in the tag's color (desktop .session-tag-agent-icon, which owns the slot at
 * rest and only yields to the agent identity on pointer hover — a state the
 * phone has no equivalent for). Trailing precedence
 * matches the desktop trailing rules: a timer countdown label always wins the
 * text slot (getSessionCardTimerTrailingLabel), then the status indicator —
 * spinning orange ring for working (reference-sidebar-working-spin), static
 * blue dot for attention/done, red for error, gray for remote sleeping — and
 * the muted Last Active time renders only when neither is present, so the time
 * and the status indicator occupy the same right-aligned area. Sleeping dims
 * only the title, and the active row gets the translucent rounded fill plus a
 * solid-white outline.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import {
  agentIconTint,
  displayStatus,
  resolveAgentIconId,
  type GhostexSession,
} from '../../contract/mobileSummary';
import {
  effectiveSessionTag,
  sessionTagColor,
  sessionTagIcon,
} from '../../contract/sessionTags';
import { SessionCopy } from '../../copy';
import { mixHexColors, SidebarPalette } from '../../theme/palette';
import type { MenuAnchor } from './ContextMenu';
import { ds } from './rows';
import { ClockGlyph } from './icons';

const ACTIVE_SURFACED_DARKEN_PERCENT = 10;
const INACTIVE_SURFACED_DARKEN_PERCENT = 40;

/**
 * Desktop timer-label precedence (session-card-content.tsx
 * getSessionCardTimerTrailingLabel): a live Delayed Send countdown wins, then
 * an armed Close After Done shows the constant 03:00 label. The mobile summary
 * carries only the live remaining label and the armed flag.
 */
function timerTrailingLabel(session: GhostexSession): string {
  if (session.delayedSendRemainingLabel.length > 0) return session.delayedSendRemainingLabel;
  return session.closeAfterDone ? '03:00' : '';
}

/** Compact desktop-style relative time: 32s / 5m / 3h / 2d (relative-time.ts). */
function compactLastActive(session: GhostexSession): string {
  const iso = session.lastInteractionAt.length > 0 ? session.lastInteractionAt : session.lastActiveAt;
  if (iso.length === 0) return '';
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Static right-edge dot color per the desktop reference-layout rules
 * (session-cards.css): attention/done → the blue attention token, error → red
 * #ff6b6b, remote sleeping → neutral gray, idle → no dot. Working renders the
 * spinning ring instead of a dot. This is the same displayStatus that drives
 * the collapsed project/group count pills.
 */
function referenceDotColor(status: string): string | null {
  if (status === 'attention' || status === 'done') return SidebarPalette.PILL_ATTENTION;
  if (status === 'error') return SidebarPalette.ERROR_DOT;
  if (status === 'sleep' || status === 'sleeping') return SidebarPalette.SLEEP_DOT;
  return null;
}

/**
 * Desktop working indicator (reference-sidebar-working-spin): a 12dp orange
 * ring with a transparent right quarter, rotating at 0.82s/turn.
 */
function WorkingSpinner() {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 820,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={[styles.workingSpinner, { transform: [{ rotate }] }]} />;
}

export type SessionRowProps = {
  session: GhostexSession;
  /** Warm-attached session key matches the current terminal. */
  active: boolean;
  /** A warm native terminal surface exists for this session. */
  surfaced: boolean;
  /** Exact expanded-group surface behind this row, including collection tint. */
  expandedGroupSurface: string;
  /** Current tint/contrast-resolved sidebar backing. */
  sidebarBackground: string;
  /** Current tint/contrast-resolved sidebar foreground. */
  sidebarForeground: string;
  /** True for rows inside a project card (tighter insets than Quick rows). */
  inCard: boolean;
  onPress: () => void;
  /** Context menu, opened by long-pressing the row (anchored to the row). */
  onMenu: (anchor: MenuAnchor) => void;
};

export default function SessionRow({
  session,
  active,
  surfaced,
  expandedGroupSurface,
  sidebarBackground,
  sidebarForeground,
  inCard,
  onPress,
  onMenu,
}: SessionRowProps) {
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
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const timerLabel = timerTrailingLabel(session);
  const dotColor = working ? null : referenceDotColor(status);
  // The time yields the trailing slot to a timer countdown or status indicator.
  const lastActive =
    timerLabel.length === 0 && !working && dotColor === null ? compactLastActive(session) : '';
  const trailingText = timerLabel.length > 0 ? timerLabel : lastActive;
  /*
   * Desktop leading-slot order (SessionFloatingAgentIcon): an active Delayed
   * Send clock, then a Close After Done clock, then the session tag, then the
   * agent icon.
   */
  const tag = effectiveSessionTag(session);
  const TagIcon = tag === undefined ? undefined : sessionTagIcon(tag);
  const tagColor = tag === undefined ? null : sessionTagColor(tag);
  const timerClockColor =
    session.delayedSendRemainingLabel.length > 0
      ? SidebarPalette.DELAYED_SEND_CLOCK
      : session.closeAfterDone
        ? SidebarPalette.CLOSE_AFTER_DONE_CLOCK
        : null;
  const iconLeft = inCard ? ds(5) : ds(26);
  const lightSurfacedBackground = mixHexColors(sidebarForeground, expandedGroupSurface, 30);
  const surfacedBackground = active
    ? mixHexColors('#000000', lightSurfacedBackground, ACTIVE_SURFACED_DARKEN_PERCENT)
    : mixHexColors('#000000', lightSurfacedBackground, INACTIVE_SURFACED_DARKEN_PERCENT);
  const pressedBackground = mixHexColors(sidebarBackground, '#000000', 90);

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
        surfaced ? { backgroundColor: surfacedBackground } : null,
        !surfaced && pressed ? { backgroundColor: pressedBackground } : null,
      ]}
      onPress={onPress}
      onLongPress={openMenuFromRow}
    >
      {active ? <View pointerEvents="none" style={styles.activeOutline} /> : null}
      <View
        style={[
          styles.icon,
          { left: iconLeft },
          timerClockColor !== null || tagColor !== null
            ? styles.iconTimer
            : active
              ? styles.iconActive
              : null,
        ]}
      >
        {timerClockColor !== null ? (
          <ClockGlyph size={ds(15)} color={timerClockColor} />
        ) : TagIcon !== undefined && tagColor !== null ? (
          <TagIcon size={ds(15)} color={tagColor} strokeWidth={1.9} />
        ) : (
          <Icon size={iconSize} color={agentIconTint(iconId)} />
        )}
      </View>
      {/*
        Desktop parity (plan 016 §6): prompts waiting in this session's Ghostex
        queue, as a small filled circle over the agent icon. A SIBLING of the
        absolutely-placed icon rather than a child of it, so it keeps its own
        full opacity (the icon slot sits at 48%) and, like the icon, it can
        never move the row's layout. Hidden at zero.
      */}
      {session.queuedPromptCount > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.queueBadge,
            session.queuedPromptFailedCount > 0 ? styles.queueBadgeFailed : null,
            { left: iconLeft + ds(8) },
          ]}
        >
          <Text style={styles.queueBadgeCount} numberOfLines={1}>
            {session.queuedPromptCount > 9 ? '9+' : String(session.queuedPromptCount)}
          </Text>
        </View>
      ) : null}
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
      <View style={styles.trailing}>
        {trailingText.length > 0 ? <Text style={styles.trailingText}>{trailingText}</Text> : null}
        {working ? (
          <WorkingSpinner />
        ) : dotColor !== null ? (
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: ds(34),
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: ds(6),
    borderRadius: ds(4),
  },
  rowCard: {
    paddingLeft: ds(26),
  },
  rowQuick: {
    paddingLeft: ds(47),
  },
  activeOutline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderColor: '#FFFFFF',
    borderRadius: ds(4),
    borderWidth: ds(2),
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
  iconTimer: {
    opacity: 1,
  },
  queueBadge: {
    position: 'absolute',
    top: '50%',
    marginTop: -ds(13),
    minWidth: ds(13),
    height: ds(13),
    paddingHorizontal: ds(2),
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SidebarPalette.DELAYED_SEND_CLOCK,
  },
  /*
    A `failed` row holds the queue until the user retries or deletes it, so the
    badge switches to the sidebar's error red — desktop paints the same badge
    #ff6b6b for the same reason. Colour only: the box above is untouched, so a
    red badge can never move the row.
  */
  queueBadgeFailed: {
    backgroundColor: SidebarPalette.ERROR_DOT,
  },
  queueBadgeCount: {
    color: '#1A1A1A',
    fontSize: ds(9),
    fontWeight: '700',
    lineHeight: ds(11),
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
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(5),
    marginStart: ds(8),
  },
  trailingText: {
    color: '#4F5359',
    fontSize: ds(13.5),
    fontWeight: '300',
    lineHeight: ds(20),
    textAlign: 'right',
  },
  dot: {
    width: ds(7),
    height: ds(7),
    borderRadius: 999,
  },
  workingSpinner: {
    width: ds(12),
    height: ds(12),
    borderRadius: 999,
    borderWidth: 2,
    borderColor: SidebarPalette.WORKING_SPINNER,
    borderRightColor: 'transparent',
  },
});
