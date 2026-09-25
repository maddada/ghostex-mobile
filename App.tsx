/**
 * ghostex-mobile entry: dark navigation shell over the shared TS core.
 * Welcome shows while no machine is saved; once one exists Sessions is home.
 * The setup routes (ConnectChoose, ScanCode, TailscaleForm, Connected,
 * MachineForm) are registered in both states so the stack survives the
 * moment the first machine is saved mid-flow.
 */

import { useEffect } from 'react';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { RootStackParamList } from './src/navigation/types';
import { initAlerts } from './src/app/alerts';
import { initAutoReconnect } from './src/app/autoReconnect';
import { flushPendingDeepLink, initDeepLinks, navigationRef } from './src/app/deepLinks';
import { initAppLifecycle } from './src/app/lifecycle';
import { initPersistentNotification } from './src/app/persistentNotification';
import { useMachinesStore } from './src/machines/store';
import { useAgentHotkeysStore } from './src/settings/agentHotkeys';
import { useExtraKeysStore } from './src/settings/extraKeys';
import { initSettingsNativeSync } from './src/settings/nativeSync';
import { useSettingsStore } from './src/settings/store';
import { initTerminalKeepAwake } from './src/terminal/keepAwake';
import { initTerminalEvents, useTerminalStore } from './src/terminal/sessions';
import { initZmxDisplayPolicy } from './src/terminal/zmxDisplay';
import { initAndroidSelfUpdate } from './src/updates/androidSelfUpdateStore';
import { addProjectSourceLabel } from './src/addProject/sources';
import { GhostexPalette } from './src/theme/palette';
import ExtraKeysEditorScreen from './src/screens/ExtraKeysEditorScreen';
import AgentHotkeysEditorScreen from './src/screens/AgentHotkeysEditorScreen';
import AddProjectDestinationScreen from './src/screens/AddProjectDestinationScreen';
import AddProjectLocalScreen from './src/screens/AddProjectLocalScreen';
import AddProjectRepositoryScreen from './src/screens/AddProjectRepositoryScreen';
import AddProjectSourceScreen from './src/screens/AddProjectSourceScreen';
import MachineFormScreen from './src/screens/MachineFormScreen';
import MachinesScreen from './src/screens/MachinesScreen';
import SessionsScreen from './src/screens/SessionsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TerminalScreen from './src/screens/TerminalScreen';
import FindPromptsScreen from './src/screens/FindPromptsScreen';
import WebPreviewPortsScreen from './src/screens/WebPreviewPortsScreen';
import WebPreviewScreen from './src/screens/WebPreviewScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import ConnectChooseScreen from './src/screens/ConnectChooseScreen';
import ConnectedScreen from './src/screens/ConnectedScreen';
import ScanCodeScreen from './src/screens/ScanCodeScreen';
import CantReachScreen from './src/screens/CantReachScreen';
import DocsScreen from './src/screens/DocsScreen';
import DocViewerScreen from './src/screens/DocViewerScreen';
import SshAccessHelpScreen from './src/screens/SshAccessHelpScreen';
import { useWebPreviewStore } from './src/webPreview/store';
import {
  AddProjectCopy,
  DocsCopy,
  MachineCopy,
  SshAccessCopy,
  TailscaleFormCopy,
  WebPreviewCopy,
} from './src/copy';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: GhostexPalette.ACCENT,
    background: GhostexPalette.BACKGROUND,
    card: GhostexPalette.BACKGROUND,
    text: GhostexPalette.FOREGROUND,
    border: GhostexPalette.BORDER,
  },
};

export default function App() {
  const hydrated = useMachinesStore((state) => state.hydrated);
  const hasMachines = useMachinesStore((state) => state.machines.length > 0);

  useEffect(() => {
    initTerminalEvents();
    initZmxDisplayPolicy();
    initAppLifecycle();
    initPersistentNotification();
    initDeepLinks();
    initAlerts();
    initAutoReconnect();
    initTerminalKeepAwake();
    initAndroidSelfUpdate();
    void useMachinesStore.getState().hydrate();
    void useTerminalStore.getState().hydrate();
    void useExtraKeysStore.getState().hydrate();
    void useAgentHotkeysStore.getState().hydrate();
    void useWebPreviewStore.getState().hydrate();
    // Native sync installs after hydration so it pushes the persisted values.
    void useSettingsStore
      .getState()
      .hydrate()
      .then(() => initSettingsNativeSync());
  }, []);

  if (!hydrated) {
    return <View style={styles.splash} />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef} theme={navigationTheme} onReady={flushPendingDeepLink}>
          <StatusBar style="light" />
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: GhostexPalette.BACKGROUND },
              headerTintColor: GhostexPalette.FOREGROUND,
              contentStyle: { backgroundColor: GhostexPalette.BACKGROUND },
            }}
          >
            {!hasMachines ? (
              <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
            ) : (
              <Stack.Screen
                name="Sessions"
                component={SessionsScreen}
                options={{ headerShown: false }}
              />
            )}
            <Stack.Screen
              name="ConnectChoose"
              component={ConnectChooseScreen}
              options={{ title: '' }}
            />
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
                  route.params?.machineId !== undefined
                    ? MachineCopy.editor.editTitle
                    : MachineCopy.editor.addTitle,
              })}
            />
            <Stack.Screen
              name="Connected"
              component={ConnectedScreen}
              options={{ headerShown: false, gestureEnabled: false }}
            />
            {hasMachines ? (
              <>
                <Stack.Screen name="Machines" component={MachinesScreen} options={{ title: 'Machines' }} />
                <Stack.Screen name="CantReach" component={CantReachScreen} options={{ title: '' }} />
                <Stack.Screen
                  name="Terminal"
                  component={TerminalScreen}
                  options={({ route }) => ({
                    title: route.params.title ?? 'Terminal',
                    headerStyle: { backgroundColor: GhostexPalette.TERMINAL_BACKGROUND },
                    contentStyle: { backgroundColor: GhostexPalette.TERMINAL_BACKGROUND },
                  })}
                />
                <Stack.Screen
                  name="FindPrompts"
                  component={FindPromptsScreen}
                  options={{
                    title: 'Find Prompts',
                    headerStyle: { backgroundColor: GhostexPalette.TERMINAL_BACKGROUND },
                    contentStyle: { backgroundColor: GhostexPalette.TERMINAL_BACKGROUND },
                  }}
                />
                <Stack.Screen
                  name="WebPreviewPorts"
                  component={WebPreviewPortsScreen}
                  options={{ title: WebPreviewCopy.pickerTitle }}
                />
                <Stack.Screen
                  name="WebPreview"
                  component={WebPreviewScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen name="Docs" component={DocsScreen} options={{ title: DocsCopy.listTitle }} />
                <Stack.Screen name="DocViewer" component={DocViewerScreen} options={{ title: '' }} />
                <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
                <Stack.Screen
                  name="ExtraKeysEditor"
                  component={ExtraKeysEditorScreen}
                  options={{ title: 'Extra Keys' }}
                />
                <Stack.Screen
                  name="AgentHotkeysEditor"
                  component={AgentHotkeysEditorScreen}
                  options={{ title: 'Agent Hotkeys' }}
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
          </Stack.Navigator>
        </NavigationContainer>
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
    backgroundColor: GhostexPalette.BACKGROUND,
  },
});
