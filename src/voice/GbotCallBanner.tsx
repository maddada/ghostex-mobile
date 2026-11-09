/**
 * The voice screen's line above the captions in a call with a GBot: the GBot's icon in its colour, "Call with
 * <name>", and the chat it talks to as the detail. It has no All sessions: a call with a GBot stays with it
 * (gbotCall.ts has the DECISION).
 */

import { useMemo, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GbotIcon } from '../components/sessions/gbotIcons';
import { GBOT_DEFAULT_ICON, gbotColorHex } from '../contract/gbots';
import { useInventoryStore } from '../inventory/store';
import { GhostexRadii } from '../theme/palette';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import { useVoiceStore, voiceActive } from './conversation';
import { callGbotId } from './focus';

/** Whether the call open (or being started) is one with a GBot, so the voice screen draws this banner. */
export function useGbotCallOpen(): boolean {
  return useVoiceStore((state) => voiceActive(state.phase) && callGbotId(state.focus, state.requestedFocus) !== null);
}

export function GbotCallBanner(): ReactElement | null {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const focus = useVoiceStore((state) => state.focus);
  const requested = useVoiceStore((state) => state.requestedFocus);
  const machineId = useVoiceStore((state) => state.machineId);
  const botId = callGbotId(focus, requested);
  // Before gxserver names it (`ready.focus.gbot`), the GBot as the phone's sessions list has it.
  const listed = useInventoryStore((store) =>
    machineId === null || botId === null
      ? undefined
      : store.inventoriesByMachineId[machineId]?.summary?.projects.find((project) => project.gbotsBot?.id === botId)
          ?.gbotsBot,
  );
  if (botId === null) return null;
  const gbot = focus?.gbot;
  const name = gbot?.name ?? requested?.gbot?.name ?? listed?.name ?? 'GBot';
  const icon = gbot?.icon || listed?.icon || GBOT_DEFAULT_ICON;
  const color = gbot?.colorHex || (listed !== undefined ? gbotColorHex(listed.color, listed.colorHex) : appearance.muted);
  const chat = focus !== null ? focus.title : (requested?.sessionId ?? '').length > 0 ? (requested?.title ?? '') : '';
  const detail = focus?.closed === true ? `${chat} was closed` : chat;
  return (
    <View style={styles.banner}>
      <GbotIcon icon={icon} color={color} size={22} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {`Call with ${name}`}
        </Text>
        {detail.length > 0 ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(appearance: Appearance) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginBottom: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minHeight: 48,
      borderRadius: GhostexRadii.section,
      backgroundColor: appearance.card,
    },
    text: { flex: 1 },
    title: { color: appearance.foreground, fontSize: 16, lineHeight: 22, fontWeight: '700' },
    detail: { color: appearance.muted, fontSize: 14, lineHeight: 19 },
  });
}
