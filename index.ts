import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Development builds prove the Rust chat core (modules/gx-chat-core) loads and answers, logging
// timings under [gx-chat-core]. Release builds never load the probe.
if (__DEV__) {
  setTimeout(() => require('./modules/gx-chat-core/src/devProbe').runChatCoreProbe(), 1500);
}
