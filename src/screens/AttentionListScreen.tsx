/**
 * Notifications: the attention list as a screen, opened from the bell on the Sessions screen. The header's "…"
 * holds Clear Done: it marks read on the computer the finished rows that keep sessions under Done, and nothing else,
 * so it asks nothing first (the rows stay on the computer, read). A row opens its session as a notification does
 * (`ghostex://session`, a "has a question" row at its question card).
 *
 * The "…" menu stands at its button wherever the header is (the notifications design, state
 * list-menu): with the header on top (every iPhone but the Duo) under the button at the
 * window's trailing edge, as a menu at the control it opened from (`rowAnchor`); in the Duo's status band
 * or a side bar, as that band's or bar's menus stand (`anchor`).
 */

import { useMemo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { type Appearance } from '../theme/useAppearance';

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, type ViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { sessionDeepLink } from '../app/deepLinkHandler';
import { openDeepLink } from '../app/deepLinks';
import { measureInWindow } from '../components/common/measureInWindow';
import { useStackScreenRail } from '../components/common/verticalBar/stackRail';
import { useHeaderPlacement } from '../components/common/verticalBar/VerticalBarArea';
import ContextMenu, { type MenuAnchor } from '../components/sessions/ContextMenu';
import { MoreGlyph } from '../components/sessions/icons';
import { NotificationsCopy } from '../copy';
import type { RootStackParamList } from '../navigation/types';
import AttentionList, { useAttentionInbox, type OpenSessionTarget } from '../notifications/AttentionList';
import { clearDone, refreshAttentionFeeds } from '../notifications/feedStore';
import { useAppearanceHeader } from './settings/useAppearanceHeader';

type Props = NativeStackScreenProps<RootStackParamList, 'AttentionList'>;

/** Where the open "…" menu stands: at its header control on top (`control`), or at a band or side-bar button. */
type MenuState = { anchor?: MenuAnchor; control?: MenuAnchor } | null;

export default function AttentionListScreen({ navigation }: Props) {
  const appearance = useAppearanceHeader();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const moreRef = useRef<ViewInstance | null>(null);
  const headerOnTop = useHeaderPlacement().kind === 'top';
  const [menu, setMenu] = useState<MenuState>(null);
  const [failed, setFailed] = useState(false);
  const done = useAttentionInbox().inbox.done;

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
    navigation.setOptions({
      title: NotificationsCopy.title,
      headerRight: () => (
        <Pressable
          ref={moreRef}
          accessibilityRole="button"
          accessibilityLabel={NotificationsCopy.menuTitle}
          hitSlop={6}
          onPress={() =>
            measureInWindow(moreRef, (frame) => setMenu(headerOnTop ? { control: frame } : { anchor: frame }))
          }
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <MoreGlyph size={20} color={appearance.foreground} />
        </Pressable>
      ),
    });
  }, [navigation, headerOnTop, styles, appearance]);
  // Where the system stands a side bar the "…" stands there under Back (the Duo's header is in its status band).
  useStackScreenRail(
    useMemo(
      () => ({
        entries: [
          {
            key: 'notificationsMenu',
            label: NotificationsCopy.menuTitle,
            icon: (size: number) => <MoreGlyph size={size} color={appearance.foreground} />,
            onPress: (anchor?: MenuAnchor) => setMenu({ anchor }),
          },
        ],
        reserveKeyboard: false,
      }),
      [appearance],
    ),
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appearance.background }]} edges={['bottom']}>
      {failed ? (
        <Text accessibilityRole="alert" style={styles.failed}>
          {NotificationsCopy.actionFailed}
        </Text>
      ) : null}
      <AttentionList onOpenSession={openSession} />
      <ContextMenu
        visible={menu !== null}
        title={NotificationsCopy.menuTitle}
        subtitle={NotificationsCopy.menuSubtitle}
        anchor={menu?.anchor}
        rowAnchor={menu?.control}
        onClose={() => setMenu(null)}
        items={[
          {
            kind: 'item',
            key: 'clearDone',
            label: NotificationsCopy.clearDone,
            disabled: done.length === 0,
            onPress: () => {
              setMenu(null);
              void clearDone(done).then((ok) => setFailed(!ok));
            },
          },
        ]}
      />
    </SafeAreaView>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  container: { flex: 1 },
  headerButton: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  failed: { color: appearance.danger, fontSize: 13, paddingHorizontal: 16, paddingTop: 8 },
});
