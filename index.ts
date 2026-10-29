import { registerRootComponent } from 'expo';
import { StatusBar } from 'expo-status-bar';

import App from './App';
import { installCrashReporting } from './src/app/crashReports';

// Before the first render, so a crash while the app starts is kept too.
installCrashReporting();

// iPhone Duo (owner, 2026-10-27, §12 "1b"): the status items stay in one row along the top. The root view
// controller says so from the first frame (GhostexRootViewController); this is Expo's switch for the
// controllers presented over it (React Native's Modal, alerts), which would otherwise flip them into a
// column. No-op on other platforms and before iOS 27.1.
StatusBar.setVerticalBarBehaviorIOS('disabled');

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
