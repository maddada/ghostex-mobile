/**
 * ghostex-mobile entry: dark navigation shell over the shared TS core.
 * Welcome shows while no machine is saved; once one exists Sessions is home.
 * The setup routes (ConnectChoose, ScanCode, TailscaleForm, Connected,
 * MachineForm) are registered in both states so the stack survives the
 * moment the first machine is saved mid-flow.
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { RootStackParamList } from './src/navigation/types';
import { initAlerts } from './src/app/alerts';
import { initAutoReconnect } from './src/app/autoReconnect';
import { checkForCrashReport, noteCrashRoute } from './src/app/crashReports';
import { reportMobileView } from './src/analytics/clientView';
import { flushPendingDeepLink, initDeepLinks, navigationRef } from './src/app/deepLinks';
import { initAppLifecycle } from './src/app/lifecycle';
import { initSettingsSync } from './src/settingsSync/settingsSync';
import { initLiveActivity } from './src/notifications/liveActivity';
import { initWidgets } from './src/notifications/widgets';
import { initPersistentNotification } from './src/app/persistentNotification';
import { securityNoticeTarget } from './src/app/securityNotice';
import { useMachinesStore } from './src/machines/store';
import { initAttentionNotifications } from './src/notifications/feedStore';
import { initPaneLayouts } from './src/panes/store';
import { initPushNotifications } from './src/notifications/pushStore';
import { useAgentHotkeysStore } from './src/settings/agentHotkeys';
import { useExtraKeysStore } from './src/settings/extraKeys';
import { initSettingsNativeSync } from './src/settings/nativeSync';
import { useSettingsStore } from './src/settings/store';
import { initChatGridClaim } from './src/terminal/chatGridClaim';
import { initTerminalKeepAwake } from './src/terminal/keepAwake';
import { initTerminalEvents, useTerminalStore } from './src/terminal/sessions';
import { initZmxDisplayPolicy } from './src/terminal/zmxDisplay';
import { initAndroidSelfUpdate } from './src/updates/androidSelfUpdateStore';
import { initOverTheAirUpdates } from './src/updates/overTheAir';
import { addProjectSourceLabel } from './src/addProject/sources';

import CrashReportPrompt from './src/components/common/CrashReportPrompt';
import { useBarGeometryStore } from './src/components/common/verticalBar/barGeometry';
import { useStackHeaderOptions } from './src/components/common/verticalBar/StackHeader';
import VerticalBarArea, { useTwoColumns } from './src/components/common/verticalBar/VerticalBarArea';
import { ChatCoreWebViewHost } from './src/chat/rust/wasm-core/ChatCoreWebView';
import ExtraKeysEditorScreen from './src/screens/ExtraKeysEditorScreen';
import FeedbackScreen from './src/screens/FeedbackScreen';
import AgentHotkeysEditorScreen from './src/screens/AgentHotkeysEditorScreen';
import CommandPadKeysEditorScreen from './src/screens/CommandPadKeysEditorScreen';
import LicenceNoticeScreen from './src/screens/LicenceNoticeScreen';
import AddProjectDestinationScreen from './src/screens/AddProjectDestinationScreen';
import AddProjectLocalScreen from './src/screens/AddProjectLocalScreen';
import AddProjectRepositoryScreen from './src/screens/AddProjectRepositoryScreen';
import AddProjectSourceScreen from './src/screens/AddProjectSourceScreen';
import MachineFormScreen from './src/screens/MachineFormScreen';
import MachinesScreen from './src/screens/MachinesScreen';
import SessionsScreen from './src/screens/SessionsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SettingsPageScreen from './src/screens/settings/SettingsPageScreen';
import { SETTINGS_PAGES } from './src/screens/settings/pages';
import TerminalScreen from './src/screens/TerminalScreen';
import VoiceScreen from './src/screens/VoiceScreen';
import { initVoice } from './src/voice/conversation';
import FindPromptScreen from './src/screens/FindPromptScreen';
import FindPromptsScreen from './src/screens/FindPromptsScreen';
import WebPreviewPortsScreen from './src/screens/WebPreviewPortsScreen';
import WebPreviewScreen from './src/screens/WebPreviewScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import ConnectChooseScreen from './src/screens/ConnectChooseScreen';
import ConnectedScreen from './src/screens/ConnectedScreen';
import ScanCodeScreen from './src/screens/ScanCodeScreen';
import CantReachScreen from './src/screens/CantReachScreen';
import AttentionListScreen from './src/screens/AttentionListScreen';
import ChangesScreen from './src/screens/ChangesScreen';
import DocsScreen from './src/screens/DocsScreen';
import DocViewerScreen from './src/screens/DocViewerScreen';
import SshAccessHelpScreen from './src/screens/SshAccessHelpScreen';
import UsageScreen from './src/screens/UsageScreen';
import { useWebPreviewStore } from './src/webPreview/store';
import {
  AddProjectCopy,
  ChangesCopy,
  DocsCopy,
  FeedbackCopy,
  FindPromptsCopy,
  MachineCopy,
  NotificationsCopy,
  PanesCopy,
  SettingsCopy,
  SshAccessCopy,
  TailscaleFormCopy,
  WebPreviewCopy,
} from './src/copy';
import { isSettingsRoute } from './src/screens/settings/columnRules';
import { useAppearance } from './src/theme/useAppearance';
import { useTerminalColours } from './src/theme/useTerminalColours';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The stack, with the iPhone Duo's header in the status band or side bar (StackHeader) where it has one.
 * While Settings shows two columns its screens change without a push or pop animation: picking a
 * page swaps the right column, as iPad Settings does.
 */
function DuoStackNavigator({
  screenOptions,
  children,
}: {
  screenOptions: NativeStackNavigationOptions;
  children: ReactNode;
}) {
  const duoOptions = useStackHeaderOptions();
  const twoColumns = useTwoColumns();
  const options = useMemo(() => {
    const merged = { ...screenOptions, ...duoOptions };
    return ({ route }: { route: { name: string } }): NativeStackNavigationOptions =>
      twoColumns && isSettingsRoute(route.name) ? { ...merged, animation: 'none' } : merged;
  }, [screenOptions, duoOptions, twoColumns]);
  return <Stack.Navigator screenOptions={options}>{children}</Stack.Navigator>;
}


export default function App() {
  const appearance = useAppearance();
  const terminalSurface = useTerminalColours().chrome;
  const navigationTheme = useMemo<Theme>(() => {
    const base = appearance.light ? DefaultTheme : DarkTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: appearance.accent,
        background: appearance.background,
        card: appearance.background,
        text: appearance.foreground,
        border: appearance.border,
      },
    };
  }, [appearance]);
  const hydrated = useMachinesStore((state) => state.hydrated);
  const hasMachines = useMachinesStore((state) => state.machines.length > 0);

  useEffect(() => {
    initTerminalEvents();
    initZmxDisplayPolicy();
    initAppLifecycle();
    initPersistentNotification();
    initDeepLinks();
    initAlerts();
    initAttentionNotifications();
    initLiveActivity();
    initWidgets();
    initPushNotifications();
    initAutoReconnect();
    initSettingsSync();
    initTerminalKeepAwake();
    initChatGridClaim();
    initPaneLayouts();
    initAndroidSelfUpdate();
    initOverTheAirUpdates();
    initVoice();
    void checkForCrashReport().catch(() => undefined);
    // Stores keyed by machine id load after the machine list, whose load may merge duplicate
    // records and move their saved data to the record it keeps (healDuplicateComputers).
    void useMachinesStore
      .getState()
      .hydrate()
      .finally(() => {
        void useTerminalStore.getState().hydrate();
        void useWebPreviewStore.getState().hydrate();
      });
    void useExtraKeysStore.getState().hydrate();
    void useAgentHotkeysStore.getState().hydrate();
    void useBarGeometryStore.getState().hydrate();
    // Native sync installs after hydration so it pushes the persisted values.
    void useSettingsStore
      .getState()
      .hydrate()
      .then(() => initSettingsNativeSync());
  }, []);

  if (!hydrated) {
    return <View style={[styles.splash, { backgroundColor: appearance.background }]} />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/* The chat core's hidden WebView, the phone's chat brain: 1×1, under the screens, never touched. */}
        <ChatCoreWebViewHost />
        {/* The screens stay clear of the iPhone Duo's side status bar (VerticalBarArea). */}
        <VerticalBarArea>
          <NavigationContainer
            ref={navigationRef}
            theme={navigationTheme}
            onReady={() => {
              flushPendingDeepLink();
              noteCrashRoute(navigationRef.getCurrentRoute()?.name);
              // The 11.0.1 notice opens straight into the scanner when a computer needs this phone paired again.
              void securityNoticeTarget(useMachinesStore.getState().machines).then((target) => {
                if (target === null || !navigationRef.isReady()) return;
                navigationRef.navigate('ScanCode', {
                  rePairMachineId: target.rePairMachineId,
                  securityNotice: { computers: target.computers },
                });
              });
            }}
            onStateChange={() => {
              noteCrashRoute(navigationRef.getCurrentRoute()?.name);
              reportMobileView(navigationRef.getCurrentRoute());
            }}
          >
            <StatusBar style={appearance.light ? 'dark' : 'light'} />
            <DuoStackNavigator
              screenOptions={{
                headerStyle: { backgroundColor: appearance.background },
                headerTintColor: appearance.foreground,
                contentStyle: { backgroundColor: appearance.background },
              }}
            >
              {!hasMachines ? (
                <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
              ) : (
                <Stack.Screen name="Sessions" component={SessionsScreen} options={{ headerShown: false }} />
              )}
              <Stack.Screen
                name="Voice"
                component={VoiceScreen}
                options={{ headerShown: false, animation: 'slide_from_bottom' }}
              />
              <Stack.Screen name="ConnectChoose" component={ConnectChooseScreen} options={{ title: '' }} />
              <Stack.Screen name="ScanCode" component={ScanCodeScreen} options={{ title: 'Scan code' }} />
              <Stack.Screen
                name="TailscaleForm"
                component={MachineFormScreen}
                options={{ title: TailscaleFormCopy.navTitle }}
              />
              <Stack.Screen
                name="SshAccessHelp"
                component={SshAccessHelpScreen}
                options={{ title: SshAccessCopy.routeTitle }}
              />
              <Stack.Screen
                name="MachineForm"
                component={MachineFormScreen}
                options={({ route }) => ({
                  title:
                    route.params?.machineId !== undefined ? MachineCopy.editor.editTitle : MachineCopy.editor.addTitle,
                })}
              />
              <Stack.Screen
                name="Connected"
                component={ConnectedScreen}
                options={{ headerShown: false, gestureEnabled: false }}
              />
              {/* Outside the machine routes: feedback posts with no computer connected. */}
              <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ title: FeedbackCopy.title }} />
              {hasMachines ? (
                <>
                  <Stack.Screen name="Machines" component={MachinesScreen} options={{ title: 'Machines' }} />
                  <Stack.Screen name="CantReach" component={CantReachScreen} options={{ title: '' }} />
                  <Stack.Screen
                    name="Terminal"
                    component={TerminalScreen}
                    options={({ route }) => ({
                      title: route.params.title ?? 'Terminal',
                      headerStyle: { backgroundColor: terminalSurface.background },
                      contentStyle: { backgroundColor: terminalSurface.background },
                    })}
                  />
                  <Stack.Screen
                    name="FindPrompts"
                    component={FindPromptsScreen}
                    options={{ title: FindPromptsCopy.title }}
                  />
                  <Stack.Screen
                    name="FindPrompt"
                    component={FindPromptScreen}
                    options={{ title: FindPromptsCopy.promptTitle }}
                  />
                  <Stack.Screen
                    name="WebPreviewPorts"
                    component={WebPreviewPortsScreen}
                    options={{ title: WebPreviewCopy.pickerTitle }}
                  />
                  <Stack.Screen name="WebPreview" component={WebPreviewScreen} options={{ headerShown: false }} />
                  <Stack.Screen name="Docs" component={DocsScreen} options={{ title: DocsCopy.listTitle }} />
                  <Stack.Screen name="DocViewer" component={DocViewerScreen} options={{ title: '' }} />
                  <Stack.Screen name="Changes" component={ChangesScreen} options={{ title: ChangesCopy.title }} />
                  <Stack.Screen
                    name="AttentionList"
                    component={AttentionListScreen}
                    options={{ title: NotificationsCopy.title }}
                  />
                  <Stack.Screen name="Usage" component={UsageScreen} options={{ title: PanesCopy.usageType }} />
                  <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: SettingsCopy.title }} />
                  <Stack.Screen
                    name="SettingsPage"
                    component={SettingsPageScreen}
                    options={({ route }) => ({ title: SETTINGS_PAGES[route.params.page].title })}
                  />
                  <Stack.Screen
                    name="ExtraKeysEditor"
                    component={ExtraKeysEditorScreen}
                    options={{ title: SettingsCopy.extraKeysTitle }}
                  />
                  <Stack.Screen
                    name="AgentHotkeysEditor"
                    component={AgentHotkeysEditorScreen}
                    options={{ title: SettingsCopy.agentHotkeysTitle }}
                  />
                  <Stack.Screen
                    name="CommandPadKeysEditor"
                    component={CommandPadKeysEditorScreen}
                    options={{ title: SettingsCopy.padKeysTitle }}
                  />
                  <Stack.Screen
                    name="LicenceNotice"
                    component={LicenceNoticeScreen}
                    options={({ route }) => ({ title: route.params.name })}
                  />
                  <Stack.Screen
                    name="AddProjectSource"
                    component={AddProjectSourceScreen}
                    options={{ title: AddProjectCopy.sourceTitle }}
                  />
                  <Stack.Screen
                    name="AddProjectLocal"
                    component={AddProjectLocalScreen}
                    options={{ title: AddProjectCopy.localTitle }}
                  />
                  <Stack.Screen
                    name="AddProjectRepository"
                    component={AddProjectRepositoryScreen}
                    options={({ route }) => ({ title: addProjectSourceLabel(route.params.source) })}
                  />
                  <Stack.Screen
                    name="AddProjectDestination"
                    component={AddProjectDestinationScreen}
                    options={{ title: AddProjectCopy.destinationTitle }}
                  />
                </>
              ) : null}
            </DuoStackNavigator>
          </NavigationContainer>
          {/* Under the screens, not over them: the once-per-crash offer to send its report. */}
          <CrashReportPrompt />
        </VerticalBarArea>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  /** Gesture handler needs a flex root above the navigator for swipe rows to receive touches. */
  root: {
    flex: 1,
  },
  splash: {
    flex: 1,
  },
});
