/**
 * Notifications: the computer's notification list as a screen, opened from the bell on the Sessions screen, drawn as
 * the desktop's Notifications panel (`notifications/AttentionList.tsx`). Its actions (Next unread, Mark all read,
 * Clear all) stand in the list's own header row, as on the desktop, so the screen's header holds only its title; the
 * "…" that held Clear Done went with the Done section (CDXC:Notifications 2026-11-12 in `notifications/feedPanel.ts`).
 * A card opens its session as a notification does (`ghostex://session`, a session with a question at its question
 * card).
 */

import { useCallback, useLayoutEffect } from 'react';

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { sessionDeepLink } from '../app/deepLinkHandler';
import { openDeepLink } from '../app/deepLinks';
import { NotificationsCopy } from '../copy';
import type { RootStackParamList } from '../navigation/types';
import AttentionList, { type OpenSessionTarget } from '../notifications/AttentionList';
import { refreshAttentionFeeds } from '../notifications/feedStore';
import { useAppearanceHeader } from './settings/useAppearanceHeader';

type Props = NativeStackScreenProps<RootStackParamList, 'AttentionList'>;

export default function AttentionListScreen({ navigation }: Props) {
  const appearance = useAppearanceHeader();

  // The list is read again whenever it comes into view, so it is current on arrival.
  useFocusEffect(
    useCallback(() => {
      void refreshAttentionFeeds();
    }, []),
  );

  const openSession = useCallback((target: OpenSessionTarget) => {
    openDeepLink(
      sessionDeepLink({
        machineId: target.machineId,
        sessionId: target.sessionId,
        ...(target.question ? { view: 'question' as const } : {}),
      }),
    );
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({ title: NotificationsCopy.title });
  }, [navigation]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appearance.background }]} edges={['bottom']}>
      <AttentionList onOpenSession={openSession} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
