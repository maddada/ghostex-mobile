/**
 * SESSION row renderer (sessions-drawer.md §2): horizontal card, padding
 * 10/9/10/9, minHeight 44, radius 8, CARD bg + BORDER stroke (active:
 * CARD_ACTIVE + ACCENT stroke). Agent icon 18, title 14sp bold single line,
 * trailing 8×8 status dot OR 16×16 sleep glyph (mutually exclusive).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import {
  agentIconTint,
  displayStatus,
  resolveAgentIconId,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { SessionCopy } from '../../copy';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth, statusDotColor } from '../../theme/palette';
import { SleepGlyph } from './icons';

export type SessionRowProps = {
  session: GhostexSession;
  /** Warm-attached session key matches the current terminal. */
  active: boolean;
  onPress: () => void;
  onLongPress: () => void;
};

export default function SessionRow({ session, active, onPress, onLongPress }: SessionRowProps) {
  const iconId = resolveAgentIconId(
    session.agentIcon,
    session.agentName.length > 0 ? session.agentName : session.agent,
  );
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  const status = displayStatus(session);
  const sleeping = status === 'sleep' || status === 'sleeping';
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;

  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.row, active ? styles.rowActive : null]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={styles.icon}>
        <Icon size={18} color={agentIconTint(iconId)} />
      </View>
      <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
        {title}
      </Text>
      {sleeping ? (
        <View style={styles.trailing}>
          <SleepGlyph size={16} color={GhostexPalette.STATUS_SLEEPING} />
        </View>
      ) : (
        <View style={styles.trailing}>
          <View style={[styles.dot, { backgroundColor: statusDotColor(status, session.isFocused) }]} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 44,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  rowActive: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderColor: GhostexPalette.ACCENT,
  },
  icon: {
    width: 18,
    height: 18,
    marginEnd: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: 'bold',
  },
  trailing: {
    marginStart: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
