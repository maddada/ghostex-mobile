// Newer Xcode rejects pod targets with IPHONEOS_DEPLOYMENT_TARGET below 15.0
// (resource-bundle targets like RNSVG/RNCAsyncStorage ship 12.4/13.4). Clamp
// every pod target during post_install.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SNIPPET = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.0
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
        end
      end
    end
`;

module.exports = function withPodfileMinDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes("IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.0")) {
        contents = contents.replace(
          /post_install do \|installer\|\n/,
          `post_install do |installer|\n${SNIPPET}`
        );
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
