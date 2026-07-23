/**
 * Terminal screen (docs/specs/terminal-screen.md).
 * - In-screen header (native nav bar hidden here) with the tabs bar embedded
 *   between the back and overflow buttons (no title text),
 *   native terminal surface for the SELECTED tab only (the native registry
 *   keeps other warm entries alive across view detach), state overlays,
 *   key accessory/editor bar above the soft keyboard, floating keyboard/upload
 *   controls when the keyboard is hidden, and edge-swipe tab switching.
 * - Keyboard tracking: RN Keyboard events plus measured viewport overlap keep
 *   the terminal and accessory keys above the IME on both platforms.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexNative, GhostexTerminalView } from '../../modules/ghostex-native/src';
import EdgeSwipeZones from '../components/terminal/EdgeSwipeZones';
import TerminalFloatingControls from '../components/terminal/TerminalFloatingControls';
import TerminalKeyBar from '../components/terminal/TerminalKeyBar';
import TerminalOverflowMenu, {
  type OverflowMenuItem,
} from '../components/terminal/TerminalOverflowMenu';
import TerminalStateOverlay from '../components/terminal/TerminalStateOverlay';
import TerminalTabsBar from '../components/terminal/TerminalTabsBar';
import { ChevronLeftIcon, EllipsisIcon } from '../components/terminal/icons';
import { pickAndSendAttachment } from '../components/terminal/uploads';
import { useKeyboardMetrics } from '../components/terminal/useKeyboardMetrics';
import { attachCommand, loginShellCommand } from '../commands/ghostexCli';
import { ensureConnected, summarizeFailure } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useSettingsStore } from '../settings/store';
import { useTerminalStore, type TerminalTab } from '../terminal/sessions';
import { GhostexPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Terminal'>;

const HEADER_HEIGHT = 44;
/** Deliberate separation between the Android IME boundary and the accessory bar. */
const ANDROID_KEYBOARD_GAP = 3;
/** How long an onSingleTap keeps the key bar optimistic before keyboard events decide. */
const TAP_KEYBOARD_HINT_TIMEOUT_MS = 1500;

function machineTargetFor(machineId: string): MachineConnectionTarget | null {
  const record = useMachinesStore.getState().machines.find((machine) => machine.id === machineId);
  if (record === undefined) return null;
  return { id: record.id, host: record.host, username: record.username, port: record.port };
}

function patchTab(sessionKey: string, patch: Partial<TerminalTab>): void {
  useTerminalStore.setState((state) => ({
    tabs: state.tabs.map((tab) => (tab.sessionKey === sessionKey ? { ...tab, ...patch } : tab)),
  }));
}

export default function TerminalScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const tabs = useTerminalStore((state) => state.tabs);
  const selectedSessionKey = useTerminalStore((state) => state.selectedSessionKey);
  const selectTab = useTerminalStore((state) => state.selectTab);
  const closeTab = useTerminalStore((state) => state.closeTab);
  const openShellTab = useTerminalStore((state) => state.openShellTab);
  const settings = useSettingsStore((state) => state.settings);

  const { keyboardVisible, bottomInset, visibleWindowBottom } = useKeyboardMetrics();
  const isFocused = useIsFocused();
  const [tapKeyboardHint, setTapKeyboardHint] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [keyboardOcclusionCorrection, setKeyboardOcclusionCorrection] = useState(0);
  const keyBarFrameRef = useRef<View>(null);
  /** Session keys already auto-focused this visit (hide-keyboard-on-startup off). */
  const autoFocusedSessionsRef = useRef<Set<string>>(new Set());

  const activeTab = tabs.find((tab) => tab.sessionKey === selectedSessionKey) ?? null;

  // The native nav bar has no styling guarantee here; render our own header.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Adopt the routed tab once; in-screen switching then owns selection.
  useEffect(() => {
    const store = useTerminalStore.getState();
    const routed = route.params.sessionKey;
    if (
      store.tabs.some((tab) => tab.sessionKey === routed) &&
      store.selectedSessionKey !== routed
    ) {
      store.selectTab(routed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No tabs left (last one closed) → leave the terminal screen.
  useEffect(() => {
    if (tabs.length === 0 && navigation.canGoBack()) navigation.goBack();
  }, [tabs.length, navigation]);

  // Optimistic key-bar visibility from onSingleTap until keyboard events land.
  useEffect(() => {
    if (!tapKeyboardHint) return;
    if (keyboardVisible) {
      setTapKeyboardHint(false);
      return;
    }
    const timer = setTimeout(() => setTapKeyboardHint(false), TAP_KEYBOARD_HINT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [tapKeyboardHint, keyboardVisible]);

  const keyBarVisible = keyboardVisible || tapKeyboardHint;

  const reconcileKeyBarWithVisibleWindow = useCallback((): void => {
    if (!keyboardVisible || visibleWindowBottom === null) return;
    requestAnimationFrame(() => {
      keyBarFrameRef.current?.measureInWindow((_x, y, _width, height) => {
        const signedOcclusion = y + height + ANDROID_KEYBOARD_GAP - visibleWindowBottom;
        if (Math.abs(signedOcclusion) < 0.5) return;
        setKeyboardOcclusionCorrection((current) => {
          const next = Math.max(0, Math.round((current + signedOcclusion) * 2) / 2);
          return Math.abs(next - current) < 0.5 ? current : next;
        });
      });
    });
  }, [keyboardVisible, visibleWindowBottom]);

  useEffect(() => {
    if (!keyboardVisible) {
      setKeyboardOcclusionCorrection(0);
      return;
    }
    reconcileKeyBarWithVisibleWindow();
  }, [keyboardVisible, reconcileKeyBarWithVisibleWindow, visibleWindowBottom]);

  const dismissKeyboard = useCallback((): void => {
    setTapKeyboardHint(false);
    const sessionKey = useTerminalStore.getState().selectedSessionKey;
    if (sessionKey !== null) void GhostexNative.blurTerminal(sessionKey).catch(() => undefined);
    Keyboard.dismiss();
  }, []);

  const showKeyboard = useCallback((): void => {
    const sessionKey = useTerminalStore.getState().selectedSessionKey;
    if (sessionKey === null) return;
    setTapKeyboardHint(true);
    void GhostexNative.focusTerminal(sessionKey).catch(() => setTapKeyboardHint(false));
  }, []);

  const handleBack = useCallback((): void => {
    dismissKeyboard();
    if (navigation.canGoBack()) navigation.goBack();
  }, [dismissKeyboard, navigation]);

  /** Re-run the open flow for a failed/closed tab (Retry / Reconnect). */
  const reopenTab = useCallback(async (tab: TerminalTab): Promise<void> => {
    await useTerminalStore.getState().reopenTab(tab.sessionKey);
  }, []);

  const confirmCloseTab = useCallback(
    (tab: TerminalTab): void => {
      Alert.alert('Close Tab?', `This will disconnect "${tab.title}".`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close', style: 'destructive', onPress: () => void closeTab(tab.sessionKey) },
      ]);
    },
    [closeTab],
  );

  const handleSelectTab = useCallback(
    (sessionKey: string): void => {
      if (sessionKey !== useTerminalStore.getState().selectedSessionKey) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      selectTab(sessionKey);
    },
    [selectTab],
  );

  const switchTabBy = useCallback((delta: -1 | 1): void => {
    const store = useTerminalStore.getState();
    const index = store.tabs.findIndex((tab) => tab.sessionKey === store.selectedSessionKey);
    if (index < 0) return;
    const next = store.tabs[index + delta];
    if (next === undefined) return;
    store.selectTab(next.sessionKey);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleUpload = useCallback(async (): Promise<void> => {
    const store = useTerminalStore.getState();
    const tab = store.tabs.find((entry) => entry.sessionKey === store.selectedSessionKey);
    if (tab === undefined || tab.state !== 'open' || uploading) return;
    setUploading(true);
    try {
      await pickAndSendAttachment(tab.machineId, tab.sessionKey);
    } catch {
      Alert.alert('Upload Failed', undefined, [{ text: 'OK' }]);
    } finally {
      setUploading(false);
    }
  }, [uploading]);

  const handleNewTerminal = useCallback(async (): Promise<void> => {
    const machineId = activeTab?.machineId ?? useMachinesStore.getState().selectedMachineId;
    if (machineId === null || machineId === undefined) return;
    const target = machineTargetFor(machineId);
    if (target === null) return;
    try {
      await openShellTab(target);
    } catch {
      // The store marks the tab failed; the state overlay surfaces it.
    }
  }, [activeTab?.machineId, openShellTab]);

  const uploadEnabled = activeTab !== null && activeTab.state === 'open';

  const menuItems: OverflowMenuItem[] = [
    {
      id: 'upload',
      label: 'Upload Image or File',
      disabled: !uploadEnabled || uploading,
      onPress: () => void handleUpload(),
    },
    { id: 'new-terminal', label: 'New Terminal', onPress: () => void handleNewTerminal() },
    { id: 'settings', label: 'Settings', onPress: () => navigation.navigate('Settings') },
    {
      id: 'disconnect',
      label: 'Disconnect',
      destructive: true,
      disabled: activeTab === null,
      onPress: () => {
        if (activeTab !== null) confirmCloseTab(activeTab);
      },
    },
  ];

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingBottom: keyboardVisible ? bottomInset + keyboardOcclusionCorrection : 0,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.headerButton}
          onPress={handleBack}
        >
          <ChevronLeftIcon size={22} color={GhostexPalette.FOREGROUND} />
        </Pressable>
        <TerminalTabsBar
          tabs={tabs}
          selectedSessionKey={selectedSessionKey}
          onSelect={handleSelectTab}
          onClose={(sessionKey) => {
            const tab = tabs.find((entry) => entry.sessionKey === sessionKey);
            if (tab !== undefined) confirmCloseTab(tab);
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More options"
          hitSlop={8}
          style={styles.headerButton}
          onPress={() => setMenuVisible(true)}
        >
          <EllipsisIcon size={22} color={GhostexPalette.FOREGROUND} />
        </Pressable>
      </View>

      <View style={styles.terminalArea}>
        {activeTab !== null && (
          // Only the selected tab's view is mounted; the native registry keeps
          // the other warm entries alive. Keep this host mounted while its
          // sessionKey changes so closing a tab cannot race native teardown
          // against destruction of the replacement terminal's host view.
          <GhostexTerminalView
            sessionKey={activeTab.sessionKey}
            style={styles.terminal}
            onSingleTap={() => setTapKeyboardHint(true)}
          />
        )}
        {activeTab !== null && (
          <TerminalStateOverlay
            tab={activeTab}
            errorCaption={
              activeTab.error !== undefined ? summarizeFailure(activeTab.error, true) : null
            }
            onRetry={() => void reopenTab(activeTab)}
            onReconnect={() => void reopenTab(activeTab)}
          />
        )}
        {tabs.length > 1 && (
          <EdgeSwipeZones onPrev={() => switchTabBy(-1)} onNext={() => switchTabBy(1)} />
        )}
        {!keyBarVisible && (
          <TerminalFloatingControls
            showKeyboardButton={settings.keyboardButtonVisible}
            showUploadButton={settings.fileUploadButtonVisible}
            showRefreshButton={
              settings.refreshButtonVisible && activeTab?.kind === 'attach'
            }
            uploadEnabled={uploadEnabled}
            uploading={uploading}
            refreshEnabled={activeTab?.state === 'open'}
            keyboardShown={keyboardVisible}
            bottomOffset={16}
            onKeyboard={showKeyboard}
            onDismissKeyboard={dismissKeyboard}
            onUpload={() => void handleUpload()}
            onRefresh={() => {
              if (activeTab !== null) {
                void GhostexNative.refreshTerminalViewport(activeTab.sessionKey).catch(
                  () => undefined,
                );
              }
            }}
          />
        )}
      </View>

      {keyBarVisible && activeTab !== null ? (
        <View
          ref={keyBarFrameRef}
          collapsable={false}
          onLayout={reconcileKeyBarWithVisibleWindow}
        >
          <TerminalKeyBar
            sessionKey={activeTab.sessionKey}
            showDismissButton={settings.keyboardButtonVisible}
            onDismissKeyboard={dismissKeyboard}
          />
        </View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}

      <TerminalOverflowMenu
        visible={menuVisible}
        topOffset={insets.top + HEADER_HEIGHT + 4}
        items={menuItems}
        onDismiss={() => setMenuVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  headerButton: {
    width: 44,
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalArea: {
    flex: 1,
  },
  terminal: {
    flex: 1,
  },
});
