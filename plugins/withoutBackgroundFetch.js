// The app declares one iOS background mode, `remote-notification`, so iOS may start it briefly for a push
// with content-available. expo-task-manager, which runs that push's background task, comes with an Expo
// config plugin that Expo applies on its own to every app that installs it, and that plugin adds `fetch`
// (background fetch). The app never asks for background fetch, and a background mode an app does not use
// has no place in the Info.plist of an app sent to App Review, so this plugin takes `fetch` out again and
// leaves every other mode as it is.
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withoutBackgroundFetch(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = cfg.modResults.UIBackgroundModes;
    if (!Array.isArray(modes)) return cfg;
    const kept = modes.filter((mode) => mode !== 'fetch');
    if (kept.length > 0) cfg.modResults.UIBackgroundModes = kept;
    else delete cfg.modResults.UIBackgroundModes;
    return cfg;
  });
};
