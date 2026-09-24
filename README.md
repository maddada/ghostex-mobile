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
- `modules/gx-chat-core` is the Rust chat brain (`packages/gx-chat-core` in the Ghostex main repo) through UniFFI, as synchronous JSI functions with JSON strings at the boundary; its API and JSON shapes are documented in `modules/gx-chat-core/src/index.ts`. Its XCFramework, `.so` files and generated Swift/Kotlin bindings are gitignored build outputs of `packages/gx-chat-mobile/build.sh` (needs rustup and, for Android, `cargo install cargo-ndk`); rerun it after the core changes. Without them the iOS and Android builds fail to compile the module. Debug builds log a boot-and-frame timing probe under `[gx-chat-core]`.

## License

GPL-3.0 — inherits from the Termux-derived Java and the VVTerm-derived Swift.
