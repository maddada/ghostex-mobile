Pod::Spec.new do |s|
  s.name           = 'GhostexNative'
  s.version        = '1.0.0'
  s.summary        = 'Ghostex native terminal (libghostty) + SSH transport (libssh2) for iOS'
  s.description    = 'Expo local module hosting the Ghostty terminal surface and the libssh2 SSH client used by the Ghostex mobile app.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'GPL-3.0' }
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.exclude_files = ['Vendor/**/*', 'Vendor/**']

  # -- Vendored native libraries -------------------------------------------
  # GhosttyKit is a proper xcframework (static library + Headers with a
  # module.modulemap exposing `module GhosttyKit`). CocoaPods selects the
  # right slice and links the static library automatically.
  s.vendored_frameworks = 'Vendor/GhosttyKit.xcframework'

  # libssh2 (+ statically built OpenSSL libssl/libcrypto) ships as plain
  # per-SDK static libs mirroring the VVTerm Xcode project layout:
  #   Vendor/libssh2/{include,module.modulemap}
  #   Vendor/libssh2/{ios,ios-simulator}/lib/{libssh2,libssl,libcrypto}.a
  # The modulemap has `link "ssh2"/"ssl"/"crypto"` directives, so importing
  # the module from Swift emits autolink flags; we only need to make the
  # library search paths visible at the final (app) link step.
  s.preserve_paths = 'Vendor/**/*'

  s.frameworks = 'Metal', 'QuartzCore', 'UIKit', 'IOSurface', 'Security'
  s.libraries = 'z', 'c++'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # `import GhosttyKit` / `import libssh2` from Swift (Clang modules).
    'SWIFT_INCLUDE_PATHS[sdk=iphoneos*]' => '"$(PODS_TARGET_SRCROOT)/Vendor/GhosttyKit.xcframework/ios-arm64/Headers" "$(PODS_TARGET_SRCROOT)/Vendor/libssh2"',
    'SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]' => '"$(PODS_TARGET_SRCROOT)/Vendor/GhosttyKit.xcframework/ios-arm64-simulator/Headers" "$(PODS_TARGET_SRCROOT)/Vendor/libssh2"',
    'HEADER_SEARCH_PATHS[sdk=iphoneos*]' => '"$(PODS_TARGET_SRCROOT)/Vendor/GhosttyKit.xcframework/ios-arm64/Headers" "$(PODS_TARGET_SRCROOT)/Vendor/libssh2/include"',
    'HEADER_SEARCH_PATHS[sdk=iphonesimulator*]' => '"$(PODS_TARGET_SRCROOT)/Vendor/GhosttyKit.xcframework/ios-arm64-simulator/Headers" "$(PODS_TARGET_SRCROOT)/Vendor/libssh2/include"',
    'LIBRARY_SEARCH_PATHS[sdk=iphoneos*]' => '"$(PODS_TARGET_SRCROOT)/Vendor/libssh2/ios/lib"',
    'LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]' => '"$(PODS_TARGET_SRCROOT)/Vendor/libssh2/ios-simulator/lib"',
  }

  # The pod builds as a static library, so libssh2/libssl/libcrypto are
  # resolved at the app's final link. Expo prebuild puts the Podfile at
  # <app>/ios, so $(PODS_ROOT)/../.. is the mobile/ app root.
  ghostex_native_vendor = '$(PODS_ROOT)/../../modules/ghostex-native/ios/Vendor'
  s.user_target_xcconfig = {
    'LIBRARY_SEARCH_PATHS[sdk=iphoneos*]' => "\"#{ghostex_native_vendor}/libssh2/ios/lib\"",
    'LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]' => "\"#{ghostex_native_vendor}/libssh2/ios-simulator/lib\"",
    'OTHER_LDFLAGS' => '$(inherited) -lssh2 -lssl -lcrypto -lz',
  }
end
