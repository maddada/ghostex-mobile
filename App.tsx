/**
 * ghostex-mobile entry: dark navigation shell over the shared TS core.
 * Welcome shows until hasSeenWelcome is persisted; Sessions is home.
 */

import { useEffect } from 'react';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { RootStackParamList } from './src/navigation/types';
import { initAppLifecycle } from './src/app/lifecycle';
import { initPersistentNotification } from './src/app/persistentNotification';
import { useMachinesStore } from './src/machines/store';
import { useSettingsStore } from './src/settings/store';
import { initTerminalEvents, useTerminalStore } from './src/terminal/sessions';
import { GhostexPalette } from './src/theme/palette';
import MachineFormScreen from './src/screens/MachineFormScreen';
import MachinesScreen from './src/screens/MachinesScreen';
import SessionsScreen from './src/screens/SessionsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TerminalScreen from './src/screens/TerminalScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { MachineCopy } from './src/copy';

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
  const hasSeenWelcome = useMachinesStore((state) => state.hasSeenWelcome);

  useEffect(() => {
    initTerminalEvents();
    initAppLifecycle();
    initPersistentNotification();
    void useMachinesStore.getState().hydrate();
    void useSettingsStore.getState().hydrate();
    void useTerminalStore.getState().hydrate();
  }, []);

  if (!hydrated) {
    return <View style={styles.splash} />;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: GhostexPalette.BACKGROUND },
            headerTintColor: GhostexPalette.FOREGROUND,
            contentStyle: { backgroundColor: GhostexPalette.BACKGROUND },
          }}
        >
          {!hasSeenWelcome ? (
            <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen
                name="Sessions"
                component={SessionsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen name="Machines" component={MachinesScreen} options={{ title: 'Machines' }} />
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
                name="Terminal"
                component={TerminalScreen}
                options={({ route }) => ({
                  title: route.params.title ?? 'Terminal',
                  headerStyle: { backgroundColor: GhostexPalette.TERMINAL_BACKGROUND },
                  contentStyle: { backgroundColor: GhostexPalette.TERMINAL_BACKGROUND },
                })}
              />
              <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
});
