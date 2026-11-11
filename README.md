# ghostex-mobile

One React Native (Expo) app for iOS and Android, replacing the separate VVTerm-fork iOS app and Termux-fork Android app. The UI, session inventory, machine management, and all orchestration are shared TypeScript; only the terminal surface and the SSH transport are native per platform:

- **iOS**: Ghostty `libghostty` (Metal) terminal + libssh2 SSH — ported from the VVTerm fork.
- **Android**: Termux `terminal-emulator`/`terminal-view` + SSHJ — ported from the Termux fork.

PTY bytes never cross the JS bridge: SSH shell channels are piped into the terminal engines entirely in native code (`modules/ghostex-native`). JS orchestrates via the contract in `modules/ghostex-native/src/`. See `docs/ARCHITECTURE.md` for the full design and `docs/specs/` for the UI specs extracted from both donor apps.

The app talks to the Mac exactly like both old apps did: `ghostex sessions --json --mobile-summary` and `ghostex attach` over SSH (Tailscale). No gxserver wire protocol on the phone; no server-side changes needed.

## Development

```sh
bun install
(cd ../../.. && cargo xtask build-mobile-chat-wasm)   # the Rust chat core as a WebAssembly page → assets/chat-core/ (gitignored; Metro needs it to bundle; brew install binaryen)
bunx expo prebuild            # generates ios/ + android/ (gitignored, CNG)
bunx expo run:ios             # or: xcodebuild against ios/Ghostex.xcworkspace
bunx expo run:android         # or: cd android && ./gradlew :app:assembleDebug
bunx tsc --noEmit             # typecheck
```

Notes:

- iOS simulator builds are **arm64-only** (`ARCHS=arm64`); the vendored GhosttyKit xcframework has no x86_64 slice.
- Build iOS with Xcode 27.1 (iOS 27.1 SDK) for the iPhone Duo. Per Apple ([Prepare your app for iPhone Duo](https://developer.apple.com/iphone-duo/prepare)), an app built with the iOS 26 SDK or earlier runs in a centred phone-sized window on the unfolded inner display, one built with the iOS 27 SDK fills most of the inner display clear of the status bar, and one built with the iOS 27.1 SDK or later reaches the edges. The app's root view controller (`GhostexRootViewController`, registered as an Expo react delegate handler) turns the system's vertical bar off, so the status items stay in one row along the top in every pose and the app's header stands in the status band beside them, its buttons that do not fit moving into the screen's … menu (`src/components/common/verticalBar/`). Check a build with `plutil -extract DTSDKName raw <Ghostex.app>/Info.plist` (`iphoneos27.1`).
- `plugins/withPodfileMinDeploymentTarget.js` clamps pod deployment targets to 15.0 for new Xcode versions.
- `ios.entitlements` in `app.json` (`application-identifier` + `keychain-access-groups`) is required: iOS 26 simulators reject expo-secure-store (`KeyChainException: A required entitlement isn't present`) when the app carries no keychain entitlement. Prebuild writes it into `ios/Ghostex/Ghostex.entitlements`; do not hand-edit that file. Keep the default simulator ad-hoc signing (`CODE_SIGN_IDENTITY=-`, what `expo run:ios` does): passing `CODE_SIGNING_ALLOWED=NO` to `xcodebuild` skips entitlement processing entirely, so the app ends up with no entitlements no matter what the file says.
- Push notifications: `expo.extra.eas.projectId` and `expo.owner` in `app.json` link the app to the EAS project `@maddada/ghostex-mobile`, which `pushProjectId` (`src/notifications/notificationCentre.ts`) hands to `getExpoPushTokenAsync`; without it no build gets a push token. Expo's push service holds the delivery credentials: the APNs key (team KTKP595G3B, `com.maddada.ghostex.ios`) and the FCM V1 service account key of the Firebase project `ghostex-mobile` (`io.ghostex`), managed with `bunx eas-cli@latest credentials` (it needs an `eas.json`; the app is not built on EAS). `google-services.json` (Firebase's public client config, `android.googleServicesFile`) serves the GitHub and Play builds alike. Changing either file changes the runtime version, so it reaches phones with a new app, not over the air.
- `com.apple.security.application-groups` in the same `ios.entitlements` is the App Group the app shares with its widgets (`docs/specs/widgets.md`); `plugins/withWidgets.js` gives the widget extension the same group and passes it to both bundles as the build setting `GHOSTEX_APP_GROUP`. A build signed by another team sets that setting (and its app entitlements) to a group it owns.
- `bunfig.toml` relaxes bun's minimum-release-age gate (Expo SDK point releases are often newer than 10 days).
- Native module layout and the exact JS↔native contract: `docs/ARCHITECTURE.md`.
- `assets/chat-core/chat-core.html` is the Rust chat brain (`packages/gx-chat-core` in the Ghostex main repo) as WebAssembly, run by a hidden WebView (`src/chat/rust/wasm-core/`); the JSON it takes and answers is in `src/chat/rust/core-types.ts`. It ships with over-the-air updates, so chat-core changes reach phones without a new app. The app imports it, so Metro and `expo export` fail until `cargo xtask build-mobile-chat-wasm` has written it; rerun that after `packages/gx-chat-core` changes.
- `THIRD_PARTY_NOTICES.md` holds the licence texts of the third-party components the notices generator finds in what the iOS app ships; Settings › Licences shows the copy bundled with the app. The generator covers the npm packages in the JavaScript bundle (each source file counted for the innermost package that holds it) and those whose native code the app links, the pods, React Native's prebuilt dependencies and the third-party code inside the prebuilt Hermes engine, the folders under `modules/ghostex-native/ios/Vendor` and what they contain, the fonts in `assets/fonts` and `modules/ghostex-native/ios/Fonts`, the generated data files listed in `scripts/notices/pinned.ts` (the icon outlines, the terminal palettes in `src/theme/ghosttyThemes.json`, each listed by the entry of the project it comes from, and every preset palette file in `src/theme/presets`, where an unlisted file stops the run), the Rust crates and standard library of the chat core and the data files its own crates compile in (such as the tool-call cards' brand logos), and the tailcat bridge's Go modules (with the licence files in the folders of their linked packages), the Go standard library and the files its Go packages embed, such as the Tailscale web client page with its JavaScript packages and font. Anything shipped outside those collectors needs a collector or a table entry before the file covers it. It is generated: `bun run notices -- --host <Ghostex main repo checkout>`. The run needs what the iOS build needs: `bun install`, the chat core page (`cargo xtask build-mobile-chat-wasm`), the pods (`bunx expo prebuild --platform ios`), Rust with the `rust-src` component and the WebAssembly target of the chat core's pinned toolchain (it runs `cargo check` on the chat core to see which files it compiles in), and Go (it reads the tailcat bridge's packages and downloads missing modules). Rerun it in every PR that changes dependencies, vendored code, fonts or bundled data and commit the result; `git diff THIRD_PARTY_NOTICES.md` after a rerun shows drift. Licence files that no package or toolchain on disk carries (the prebuilt code under `modules/ghostex-native/ios/Vendor`, fonts, React Native's prebuilt dependencies, the third-party code inside Hermes, packages published without one, the projects the terminal palettes come from, the parts of the data files the chat core compiles in and of files embedded by Go packages) are copies from each upstream source at the shipped version under `third-party/`, tied to the shipped files in `scripts/notices/pinned.ts`; when a shipped file or version changes, the run stops and names what to update. A package or palette project published without any licence text, whose repository has none at that version either, gets the licence statement from its own files and the standard text of its declared licence from the SPDX License List, with the author its metadata names.
- `src/theme/ghosttyThemes.json` (the Ghostty themes offered as terminal palettes next to the preset palettes) is generated: `bun run generate:ghostty-themes -- --host <Ghostex main repo checkout> [--kept <file>]`. It reads the names the desktop's Settings offers and the theme files of the iTerm2-Color-Schemes release Ghostty's build fetches (run `zig build --fetch` in the checkout's `.dependencies/ghostty` first), and downloads that collection's pinned `licenses.yml`. Only themes whose exact entry there names a licence the app may pass on ship: `nonfree`, `unknown`, GPL-2.0-only and themes without an entry are dropped, `EXCLUDED` in the script names the themes dropped for other unclear rights, and the run stops when a kept theme has no notices entry of its licence. It prints the file's fingerprint for `GENERATED_DATA_FILES`; rerun the notices afterwards. A palette saved before it was dropped stays saved and is listed first in its picker; the terminal then takes the colours of that mode's default palette (GitHub Dark / GitHub Light Default), so its text stays readable.

## Driving the iOS simulator headlessly

The default simulator device set cannot be written on this Mac (`~/Library/Developer/CoreSimulator/Devices` points at an external volume where CoreSimulatorService gets EPERM), so test devices live in a custom set that Maestro cannot see. idb reaches any set and never moves the host mouse or keyboard:

```sh
brew install facebook/fb/idb-companion && uv tool install --python 3.12 fb-idb
SET=~/Library/Developer/GhostexSimDevices
U=$(xcrun simctl --set $SET create gx-mine com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl --set $SET boot $U
idb_companion --device-set-path $SET --udid $U --grpc-port 10882 &   # one port per device
idb connect localhost 10882
idb ui tap 200 400 --udid $U                                   # points, not pixels (iPhone 17: 402x874)
idb ui tap 362 757 --duration 1.0 --udid $U                    # a hold (Send's queue gesture)
idb ui swipe 200 600 200 200 --duration 0.4 --delta 10 --udid $U   # scroll; without --duration it does not register
idb ui text 'hello' --udid $U                                  # types into the focused field
idb ui key 42 --udid $U                                        # Backspace (HID code); --duration 5 holds it
idb ui describe-all --udid $U                                  # accessibility tree with frames, to find tap targets
xcrun simctl --set $SET io $U screenshot shot.png
```

- Wait about a second after focusing a field before `idb ui text`; keys sent while the keyboard animates in are dropped.
- A `Switch` ignores a tap; slide its thumb with a short `idb ui swipe` across it.
- Build with `xcodebuild -workspace ios/Ghostex.xcworkspace -scheme Ghostex -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath <own dir> ARCHS=arm64 build` and install with `xcrun simctl --set $SET install $U <app>`.
- Skip the dev launcher and its menu (Metro on 8081):

```sh
for k in EXDevMenuIsOnboardingFinished; do xcrun simctl --set $SET spawn $U defaults write com.maddada.ghostex.ios $k -bool YES; done
for k in EXDevMenuShowFloatingActionButton EXDevMenuShowsAtLaunch; do xcrun simctl --set $SET spawn $U defaults write com.maddada.ghostex.ios $k -bool NO; done
xcrun simctl --set $SET launch --terminate-running-process $U com.maddada.ghostex.ios --initialUrl http://localhost:8081
```

### Android emulators (x86_64)

The release APK ships **arm64-v8a only** (`GHOSTEX_ANDROID_ABIS` in the main repo's `.github/workflows/release-gpui-android.yml`), so on an x86_64 emulator Android runs it through its ARM translator (`libndk_translation`/berberis). That crashes at launch with `Fatal signal 4 (SIGILL)` in `lib/arm64/libgojni.so` (thread `mqt_v_js`, log line `berberis: Undefined instruction 0xd5380600`): the tailcat bridge's `golang.org/x/sys/cpu` cannot read the auxiliary vector inside an Android app, so on a 4.11+ kernel it reads the CPU feature registers directly (`MRS ID_AA64ISAR0_EL1`). A real arm64 kernel traps and emulates that instruction; the translator does not. Nothing in our code can avoid it short of patching `x/sys`, so emulators need a build that carries the x86_64 libraries and runs natively.

Builds made outside the release script already do: `expo prebuild` writes `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64` and `../tailcat-bridge/build.sh --target android` stages all four ABIs, so `bunx expo run:android` (debug, against Metro) works on an emulator as is. For a standalone build with the bundled JavaScript (no Metro), build the release variant with the ABIs you want and any keystore (an emulator build can't update a GitHub install, which is signed with the release key, so uninstall that first):

```sh
bun install
(cd ../../.. && cargo xtask build-mobile-chat-wasm)
../tailcat-bridge/build.sh --target android
CI=1 bunx expo prebuild --platform android --no-install
keytool -genkeypair -keystore ~/emu-test.jks -storepass emutest -keypass emutest -alias emu -keyalg RSA -dname CN=emulator
(cd android && ./gradlew -PreactNativeArchitectures=arm64-v8a,x86_64 \
  -PghostexReleaseStoreFile=$HOME/emu-test.jks -PghostexReleaseStorePassword=emutest \
  -PghostexReleaseKeyAlias=emu -PghostexReleaseKeyPassword=emutest :app:assembleRelease)
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Without `GHOSTEX_RELEASE_VERSION` the build has over-the-air updates off (runtime `dev`), so it always runs the JavaScript it was built with.

On Windows (Git Bash for the `.sh` scripts):

- Check the submodule out with LF line endings (`git -c core.autocrlf=false checkout`). CRLF files break the shell scripts and change what `scripts/ota-runtime-version.js` prints.
- Git for Windows' `unzip` doesn't match the `'jni/*'` pattern in `build.sh`, so its staging step stops after the AAR is built. Unzip `build/tailcatbridge.aar` whole and copy `classes.jar` to `modules/ghostex-native/android/libs/tailcatbridge.jar` and `jni/<abi>/libgojni.so` to `modules/ghostex-native/android/src/main/jniLibs/<abi>/` by hand. Don't fix it in `build.sh` in passing: every tracked file in `apps/mobile/tailcat-bridge` is an input of the over-the-air runtime version, so any edit there takes installed phones off over-the-air updates.
- `cargo xtask build-mobile-chat-wasm` needs `wasm-opt` from binaryen 133 on PATH (the release asset `binaryen-version_133-x86_64-windows.tar.gz`), and it reads the wasm from `packages/gx-chat-wasm/target/`, so leave `CARGO_TARGET_DIR` unset.
- A short checkout path (for example `D:\gx86`) keeps the React Native CMake builds clear of Windows' path length limit.

### Keeping the simulator dev client current

The shared test device is `gx-cb-iPhone-Duo` in `~/Library/Developer/GhostexSimDevices`. Its dev client goes stale whenever native code changes (a module method the JS calls, a new pod, a Tailcat bridge change); the symptom is a crash at launch on a native call the old build lacks (for example `voiceStatus`). Rebuild it with these steps, from this folder. Keep build output out of `/tmp` (`W` below):

```sh
SET=~/Library/Developer/GhostexSimDevices; U=393739D1-0237-4BAE-91DD-FDD8E53979E2   # gx-cb-iPhone-Duo
W=~/.local/share/agent-work/ghostex/sim-dev-client; mkdir -p $W
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # Xcode 27.1; xcode-select may point at an older beta
bun install
(cd ../../.. && cargo xtask build-mobile-chat-wasm)               # the chat core page Metro bundles
../tailcat-bridge/build.sh --target ios                            # the vendored Tailcatbridge.xcframework is gitignored and goes stale
CI=1 bunx expo prebuild --platform ios --no-install && (cd ios && pod install)
xcodebuild -workspace ios/Ghostex.xcworkspace -scheme Ghostex -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath $W/DerivedData ARCHS=arm64 build > $W/xcodebuild.log 2>&1
APP=$W/DerivedData/Build/Products/Debug-iphonesimulator/Ghostex.app
plutil -extract DTSDKName raw $APP/Info.plist                      # iphonesimulator27.1
xcrun simctl --set $SET boot $U; xcrun simctl --set $SET bootstatus $U -b
xcrun simctl --set $SET install $U $APP                            # keeps the app's data (paired computers)
bunx expo start --dev-client --port 8081 > $W/metro.log 2>&1 &     # then the dev-launcher defaults and launch above
```

- `error: cannot find 'Tailcat…' in scope` from `GhostexNativeModule.swift` means the Tailcat bridge step was skipped.
- Screenshots: the iPhone Duo has several displays and the default capture is black; take the outer one with `xcrun simctl --set $SET io $U screenshot --display=primary shot.png` (`idb screenshot` fails with "Display has no activity").
- `xcrun simctl --set $SET privacy $U grant microphone com.maddada.ghostex.ios` lets Dictate record without a prompt; it quits the app, so launch it again afterwards.
- Pairing with this Mac's gxserver (the device is paired as of 2026-11-05; repeat only if Machines shows it failing): ask gxserver for an Easy Connect code, then in the app tap Add a computer › Scan a code. The simulator has no camera, so the page offers a paste field; type the code with `idb ui text`, tap the page title to close the keyboard (it covers Pair), and tap Pair.

```sh
E=$(ghostex server endpoint); P=$(echo $E | jq .port); T=$(echo $E | jq -r .authToken)
curl -s -X POST -H "authorization: Bearer $T" -H 'x-gxserver-protocol-version: 1' -H 'content-type: application/json' \
  -d '{"params":{"openTunnel":true}}' http://127.0.0.1:$P/api/remotePairingCode | jq -r .result.easyConnect.text
```

- gxserver reads a request's arguments from `params` (`{"params":{…}}`); a bare body is ignored or refused.
- One machine record per computer: two records for the same Mac run two Tailcat tunnels with the phone's one client key, the Mac's WireGuard replies reach the wrong one (`Received invalid response message` in the device log) and the chat link never connects. The app heals this itself: pairing a saved computer again re-pairs its record, and launching merges older duplicates into the newest pairing (`src/machines/computerIdentity.ts`). While a record for the Mac is connected, pairing it again can still time out (the pairing tunnel is a second tunnel too); hide the record first if that happens.
- Leave the computer's settings as they were: Settings › Voice changes Dictate on the real Mac (engine, models, dictionary). Read `/api/readDictateSettings` first and restore it with `/api/setDictateSettings` (`{"params":{"patch":{…}}}`) when done.
- When done: stop Metro, `idb disconnect localhost 10882` and kill its `idb_companion`, and `xcrun simctl --set $SET shutdown $U`.

## License

GPL-3.0 — inherits from the Termux-derived Java and the VVTerm-derived Swift.
