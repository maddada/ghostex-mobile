Pod::Spec.new do |s|
  s.name           = 'GxChatCore'
  s.version        = '0.1.0'
  s.summary        = 'The Ghostex Rust chat core (packages/gx-chat-core) for iOS, through UniFFI.'
  s.description    = 'Expo local module exposing the Rust chat brain as synchronous JSI functions with JSON strings at the boundary.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'GPL-3.0' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # Generated/gx_chat_mobile.swift and Vendor/GxChatMobile.xcframework are build outputs of
  # packages/gx-chat-mobile/build.sh in the Ghostex main repo (gitignored). The xcframework is a
  # static library per slice whose Headers carry `module gx_chat_mobileFFI`, which the generated
  # Swift imports; CocoaPods selects the slice and links it.
  s.source_files = ['*.swift', 'Generated/*.swift']
  s.vendored_frameworks = 'Vendor/GxChatMobile.xcframework'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
end
