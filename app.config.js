const app = require('./app.json');

function releaseBuildNumber(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`GHOSTEX_RELEASE_VERSION must be MAJOR.MINOR.PATCH, got ${version}`);
  }
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
}

module.exports = () => {
  const version = process.env.GHOSTEX_RELEASE_VERSION || app.expo.version;
  const buildNumber = process.env.GHOSTEX_RELEASE_BUILD_NUMBER || String(releaseBuildNumber(version));

  return {
    ...app.expo,
    version,
    ios: {
      ...app.expo.ios,
      buildNumber,
    },
    android: {
      ...app.expo.android,
      versionCode: Number(buildNumber),
    },
  };
};
