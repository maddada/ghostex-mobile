# ghostex-mobile

One React Native (Expo) app for iOS and Android, replacing the separate VVTerm-fork iOS app and Termux-fork Android app. The UI, session inventory, machine management, and all orchestration are shared TypeScript; only the terminal surface and the SSH transport are native per platform:

- **iOS**: Ghostty `libghostty` (Metal) terminal + libssh2 SSH — ported from the VVTerm fork.
- **Android**: Termux `terminal-emulator`/`terminal-view` + SSHJ — ported from the Termux fork.

PTY bytes never cross the JS bridge: SSH shell channels are piped into the terminal engines entirely in native code (`modules/ghostex-native`). JS orchestrates via the contract in `modules/ghostex-native/src/`. See `docs/ARCHITECTURE.md` for the full design and `docs/specs/` for the UI specs extracted from both donor apps.

The app talks to the Mac exactly like both old apps did: `ghostex sessions --json --mobile-summary` and `ghostex attach` over SSH (Tailscale). No gxserver wire protocol on the phone; no server-side changes needed.

## Development

```sh
bun install
../../../packages/gx-chat-mobile/build.sh   # Rust chat core → modules/gx-chat-core (gitignored outputs)
bunx expo prebuild            # generates ios/ + android/ (gitignored, CNG)
bunx expo run:ios             # or: xcodebuild against ios/Ghostex.xcworkspace
bunx expo run:android         # or: cd android && ./gradlew :app:assembleDebug
bunx tsc --noEmit             # typecheck
```

Notes:
- iOS simulator builds are **arm64-only** (`ARCHS=arm64`); the vendored GhosttyKit xcframework has no x86_64 slice.
- `plugins/withPodfileMinDeploymentTarget.js` clamps pod deployment targets to 15.0 for new Xcode versions.
- `ios.entitlements` in `app.json` (`application-identifier` + `keychain-access-groups`) is required: iOS 26 simulators reject expo-secure-store (`KeyChainException: A required entitlement isn't present`) when the app carries no keychain entitlement. Prebuild writes it into `ios/Ghostex/Ghostex.entitlements`; do not hand-edit that file. Keep the default simulator ad-hoc signing (`CODE_SIGN_IDENTITY=-`, what `expo run:ios` does): passing `CODE_SIGNING_ALLOWED=NO` to `xcodebuild` skips entitlement processing entirely, so the app ends up with no entitlements no matter what the file says.
- `bunfig.toml` relaxes bun's minimum-release-age gate (Expo SDK point releases are often newer than 10 days).
- Native module layout and the exact JS↔native contract: `docs/ARCHITECTURE.md`.
- `modules/gx-chat-core` is the Rust chat brain (`packages/gx-chat-core` in the Ghostex main repo) through UniFFI, as synchronous JSI functions with JSON strings at the boundary; its API and JSON shapes are documented in `modules/gx-chat-core/src/index.ts`. Its XCFramework, `.so` files and generated Swift/Kotlin bindings are gitignored build outputs of `packages/gx-chat-mobile/build.sh` (needs rustup and, for Android, `cargo install cargo-ndk`); rerun it after the core changes. Without them the iOS and Android builds fail to compile the module.

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
