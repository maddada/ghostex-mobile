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
    const buildTypesStart = contents.indexOf('    buildTypes {');
    const releaseBuildTypeStart = contents.indexOf('        release {', buildTypesStart);
    const releaseSigningStart = contents.indexOf(
      'signingConfig signingConfigs.debug',
      releaseBuildTypeStart
    );
    if (
      buildTypesStart === -1 ||
      releaseBuildTypeStart === -1 ||
      releaseSigningStart === -1
    ) {
      throw new Error('withAndroidReleaseSigning could not select the release signing config');
    }
    contents =
      contents.slice(0, releaseSigningStart) +
      'signingConfig signingConfigs.release' +
      contents.slice(releaseSigningStart + 'signingConfig signingConfigs.debug'.length);
    const debugBuildType = contents.slice(buildTypesStart, releaseBuildTypeStart);
    if (!debugBuildType.includes('signingConfig signingConfigs.debug')) {
      throw new Error('withAndroidReleaseSigning must preserve debug signing for debug builds');
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
};
