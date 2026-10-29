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
bun test src                  # logic tests (*.test.ts, node:test)
bun run test:jest             # component and lifecycle tests (*.rntl.tsx, Jest + jest-expo + React Native Testing Library)
```

Notes:
- iOS simulator builds are **arm64-only** (`ARCHS=arm64`); the vendored GhosttyKit xcframework has no x86_64 slice.
- Build iOS with Xcode 27.1 (iOS 27.1 SDK) for the iPhone Duo. Per Apple ([Prepare your app for iPhone Duo](https://developer.apple.com/iphone-duo/prepare)), an app built with the iOS 26 SDK or earlier runs in a centred phone-sized window on the unfolded inner display, one built with the iOS 27 SDK fills most of the inner display clear of the status bar, and one built with the iOS 27.1 SDK or later reaches the edges. The app's root view controller (`GhostexRootViewController`, registered as an Expo react delegate handler) turns the system's vertical bar off, so the status items stay in one row along the top in every pose and the app's header stands in the status band beside them, its buttons that do not fit moving into the screen's … menu (`src/components/common/verticalBar/`). Check a build with `plutil -extract DTSDKName raw <Ghostex.app>/Info.plist` (`iphoneos27.1`).
- `plugins/withPodfileMinDeploymentTarget.js` clamps pod deployment targets to 15.0 for new Xcode versions.
- `ios.entitlements` in `app.json` (`application-identifier` + `keychain-access-groups`) is required: iOS 26 simulators reject expo-secure-store (`KeyChainException: A required entitlement isn't present`) when the app carries no keychain entitlement. Prebuild writes it into `ios/Ghostex/Ghostex.entitlements`; do not hand-edit that file. Keep the default simulator ad-hoc signing (`CODE_SIGN_IDENTITY=-`, what `expo run:ios` does): passing `CODE_SIGNING_ALLOWED=NO` to `xcodebuild` skips entitlement processing entirely, so the app ends up with no entitlements no matter what the file says.
- `bunfig.toml` relaxes bun's minimum-release-age gate (Expo SDK point releases are often newer than 10 days).
- Two test runners, each with its own files: `bun test src` runs the logic tests (`*.test.ts`), `bun run test:jest` the component and lifecycle tests (`*.rntl.tsx`: a hook wired into a screen, state kept across a fold or a column switch), which need React Native's runtime under Jest (`jest-expo` preset, `jest` block in `package.json`; `testTimeout` 30 s because a cold first run spends longer than Jest's default 5 s transforming React Native). Neither picks up the other's files. A component test file starts with `/// <reference types="jest" />`, as the logic tests reference `node` (TypeScript 6 includes no `@types` package by default).
- Native module layout and the exact JS↔native contract: `docs/ARCHITECTURE.md`.
- `assets/chat-core/chat-core.html` is the Rust chat brain (`packages/gx-chat-core` in the Ghostex main repo) as WebAssembly, run by a hidden WebView (`src/chat/rust/wasm-core/`); the JSON it takes and answers is in `src/chat/rust/core-types.ts`. It ships with over-the-air updates, so chat-core changes reach phones without a new app. The app imports it, so Metro and `expo export` fail until `cargo xtask build-mobile-chat-wasm` has written it; rerun that after `packages/gx-chat-core` changes.

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

## License

GPL-3.0 — inherits from the Termux-derived Java and the VVTerm-derived Swift.
