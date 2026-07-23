const { withAppBuildGradle } = require('expo/config-plugins');

const DEBUG_SIGNING_CONFIG = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
`;

const RELEASE_SIGNING_CONFIG = `${DEBUG_SIGNING_CONFIG}        release {
            storeFile file(findProperty('ghostexReleaseStoreFile') ?: 'missing-release-keystore')
            storePassword findProperty('ghostexReleaseStorePassword') ?: ''
            keyAlias findProperty('ghostexReleaseKeyAlias') ?: ''
            keyPassword findProperty('ghostexReleaseKeyPassword') ?: ''
        }
`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidReleaseSigning requires a Groovy app/build.gradle');
    }
    let contents = cfg.modResults.contents;
    if (!contents.includes('ghostexReleaseStoreFile')) {
      if (!contents.includes(DEBUG_SIGNING_CONFIG)) {
        throw new Error('withAndroidReleaseSigning did not match the Expo signingConfigs template');
      }
      contents = contents.replace(DEBUG_SIGNING_CONFIG, RELEASE_SIGNING_CONFIG);
    }
    contents = contents.replace(
      /release \{\n([\s\S]*?)signingConfig signingConfigs\.debug/,
      'release {\n$1signingConfig signingConfigs.release'
    );
    if (!contents.includes('signingConfig signingConfigs.release')) {
      throw new Error('withAndroidReleaseSigning could not select the release signing config');
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
};
