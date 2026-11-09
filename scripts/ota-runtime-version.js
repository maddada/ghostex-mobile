#!/usr/bin/env node
/**
 * The runtime version of an over-the-air update: a hash of every input that ends up as native code
 * in the app binary. An update is only offered to a binary with the same runtime version, so this
 * must change whenever the JavaScript could meet native code it was not built against.
 *
 * app.config.js calls it for release builds and for update exports; both run from the same
 * checkout, so they agree. `node scripts/ota-runtime-version.js <android|ios> [--explain]` prints
 * it (and, with --explain, how many files each input contributed).
 *
 * CDXC:Release 2026-10-23 WHY: an explicit list of git-tracked sources, hashed from disk, instead
 * of Expo's automatic fingerprint. The Go tailcat bridge is built from the Ghostex main repo around
 * this submodule and lands in gitignored folders (jniLibs, xcframeworks), so the fingerprint would
 * hash whatever build output happens to be on the machine, or nothing. Hashing its sources gives
 * the same answer on the Linux runner that exports the update and the macOS runner that archives
 * the iOS app.
 *
 * CDXC:Release 2026-10-28 WHY: the Rust chat core is not a runtime input. The phone runs it as
 * WebAssembly in a hidden WebView, from a page Metro bundles like any other asset
 * (`assets/chat-core/chat-core.html`, built from packages/gx-chat-wasm), so a core change travels
 * in the over-the-air update. The user chose to remove the native UniFFI core on 2026-10-28
 * (src/chat/rust/wasm-core/bridge.ts); until then every core change needed a new app.
 * SEE-ALSO: tooling/release-mobile/ota-export.sh, tooling/release-gpui/product-inputs.mjs (the
 * Android product's input list, which keeps the core as an input of the bundled page).
 *
 * CDXC:Release 2026-11-10 WHY: app.json counts by what each platform's native build reads from it,
 * not by its bytes. `owner` and `extra` (the EAS project id for push tokens) are data the
 * JavaScript reads through Constants.expoConfig, and an update carries its own copy
 * (ota-export.sh's expo-config.json), so they are not native; iOS never reads the `android`
 * section and Android never reads `ios`. `expo prebuild` of the 11.2.1 app.json and of the one
 * that added `owner`, `extra.eas.projectId` and `android.googleServicesFile` (phone 9deedc0) made
 * the same Xcode project; on Android the Google Services Gradle plugin and google-services.json
 * came in, so the file `googleServicesFile` names is an Android input too. Hashing whole bytes
 * had cut every 11.2.1 iPhone off from updates over a push id.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * The hashing rules' version: bump it whenever this script changes what a runtime version means.
 * The script's own bytes are not an input, so a comment or a refactor here strands no installed app.
 */
const FORMAT = 2;

/**
 * Runtime versions of apps already installed, by the FORMAT 2 hash of the native inputs they were
 * built from. Builds before FORMAT 2 carry a FORMAT 1 id (whole app.json and this script's bytes),
 * which no FORMAT 2 hash can equal; when a checkout's native inputs are exactly such a build's,
 * its runtime version is that build's, so updates keep reaching it. An entry stops matching (and can
 * go) once the platform's native inputs change and a new build ships.
 *
 * CDXC:Release 2026-11-10 WHY: the user's iPhone runs 11.2.1 from TestFlight and cannot easily
 * take a new build; updates must reach it while its native side is unchanged.
 */
const SHIPPED_RUNTIMES = {
  // Ghostex 11.2.1 (phone 2f39e304d), the TestFlight build.
  ios: { '9bd54123d0142995': '9e7ef8a8ec4f6ab6' },
  // Ghostex 11.2.1 (phone 2f39e304d), the GitHub APK.
  android: { 'e5402b113f9fbd17': 'f0159ac53e84a653' },
};

const APP_ROOT = path.resolve(__dirname, '..');
const MAIN_ROOT = path.resolve(APP_ROOT, '../../..');

/** Hashed by its native view (appJsonNativeView), not its bytes. */
const APP_JSON = 'app.json';

/** Pathspecs inside this app (the apps/mobile/app submodule). */
const APP_SHARED = [
  'package.json',
  'bun.lock',
  APP_JSON,
  'app.config.js',
  'plugins',
  // Patches to dependencies (bun `patchedDependencies`) can change native code.
  'patches',
  'certs',
  ':(glob)modules/*/expo-module.config.json',
];
const APP_PLATFORM = {
  android: [':(glob)modules/*/android/**'],
  ios: [':(glob)modules/*/ios/**'],
};

/** app.json `expo` keys no native build reads: the JavaScript reads them from the update it runs. */
const JS_ONLY_CONFIG_KEYS = ['owner', 'extra'];
const OTHER_PLATFORM = { android: 'ios', ios: 'android' };

/** What `platform`'s native build reads from app.json. */
function appJsonNativeView(platform) {
  const app = JSON.parse(fs.readFileSync(path.join(APP_ROOT, APP_JSON), 'utf8'));
  const expo = { ...app.expo };
  for (const key of [...JS_ONLY_CONFIG_KEYS, OTHER_PLATFORM[platform]]) delete expo[key];
  return { ...app, expo };
}

/** JSON with object keys sorted, so reformatting or reordering app.json changes nothing. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The Firebase config file the platform's build compiles in (`googleServicesFile`), as a pathspec. */
function googleServicesPathspecs(platform) {
  const file = appJsonNativeView(platform).expo[platform]?.googleServicesFile;
  return typeof file === 'string' ? [path.posix.normalize(file)] : [];
}

/** Pathspecs in the Ghostex main repo: the Go tailcat bridge. */
const MAIN_SHARED = ['apps/mobile/tailcat-bridge'];

function trackedFiles(root, pathspecs) {
  const output = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...pathspecs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

function fileDigest(file) {
  const stat = fs.lstatSync(file);
  const bytes = stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(file)) : fs.readFileSync(file);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertMainRepo() {
  if (!fs.existsSync(path.join(MAIN_ROOT, 'apps/mobile/tailcat-bridge/go.mod'))) {
    throw new Error(
      `The OTA runtime version hashes the tailcat bridge, but ${MAIN_ROOT} is not the Ghostex main repo. ` +
        'Release builds and update exports run from the main repo with this app checked out at apps/mobile/app.',
    );
  }
}

/**
 * @param {'android' | 'ios'} platform
 * @param {{ androidSelfUpdate: boolean }} flags native choices app.config.js makes from the environment
 */
function otaRuntimeInputs(platform, flags) {
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error(`OTA runtime version: unknown platform ${platform}`);
  }
  assertMainRepo();
  const appPathspecs = [...APP_SHARED, ...APP_PLATFORM[platform], ...googleServicesPathspecs(platform)];
  const groups = [
    { label: 'app', root: APP_ROOT, files: trackedFiles(APP_ROOT, appPathspecs) },
    { label: 'main', root: MAIN_ROOT, files: trackedFiles(MAIN_ROOT, MAIN_SHARED) },
  ];
  // The GitHub APK and the Google Play bundle differ natively (the installer permission), so they
  // never share updates.
  const settings = platform === 'android' ? { androidSelfUpdate: flags.androidSelfUpdate } : {};
  return { groups, settings };
}

/** The FORMAT hash of this checkout's native inputs, before SHIPPED_RUNTIMES. */
function nativeInputsHash(platform, flags) {
  const { groups, settings } = otaRuntimeInputs(platform, flags);
  const hash = crypto.createHash('sha256');
  hash.update(`ghostex-ota-runtime ${FORMAT} ${platform} ${JSON.stringify(settings)}\n`);
  for (const group of groups) {
    for (const file of [...group.files].sort()) {
      const digest =
        group.label === 'app' && file === APP_JSON
          ? crypto.createHash('sha256').update(canonicalJson(appJsonNativeView(platform))).digest('hex')
          : fileDigest(path.join(group.root, file));
      hash.update(`${group.label}:${file}\0${digest}\n`);
    }
  }
  return hash.digest('hex').slice(0, 16);
}

function otaRuntimeVersion(platform, flags) {
  const inputs = nativeInputsHash(platform, flags);
  return SHIPPED_RUNTIMES[platform][inputs] ?? inputs;
}

module.exports = { otaRuntimeVersion, otaRuntimeInputs, nativeInputsHash };

if (require.main === module) {
  const [platform, ...rest] = process.argv.slice(2);
  const raw = process.env.GHOSTEX_ANDROID_SELF_UPDATE;
  const flags = { androidSelfUpdate: raw === undefined || raw === '' || raw === '1' };
  if (rest.includes('--explain')) {
    const { groups, settings } = otaRuntimeInputs(platform, flags);
    for (const group of groups) console.error(`${group.label}: ${group.files.length} files under ${group.root}`);
    console.error(`settings: ${JSON.stringify(settings)}`);
    console.error(`native inputs hash: ${nativeInputsHash(platform, flags)}`);
  }
  console.log(otaRuntimeVersion(platform, flags));
}
