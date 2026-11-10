Pod::Spec.new do |s|
  s.name           = 'GhostexLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Ghostex Live Activity (ActivityKit) for iOS'
  s.description    = 'Expo local module that starts, updates and ends the Ghostex Live Activity; its views are in the widget extension plugins/withWidgets.js adds.'
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

  # The app side only: the module and the attributes it shares with the extension. Extension/ is compiled by
  # the widget extension target.
  s.source_files = ['GhostexLiveActivityModule.swift', 'Shared/**/*.swift']
  s.frameworks = 'ActivityKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
end
