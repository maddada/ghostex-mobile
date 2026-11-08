/**
 * The Settings pages listed on the Settings home, in order. Names follow the
 * desktop Settings where one exists (Interface, Chat, Terminal, Notifications:
 * the desktop files its sounds under Notifications).
 */

import { ANDROID_SELF_UPDATE_ENABLED } from '../../config/featureFlags';
import { LicencesCopy, LiveActivityCopy, NotificationsCopy, ShortRepliesCopy } from '../../copy';
import { OTA_ENABLED } from '../../updates/overTheAir';
import { LIVE_ACTIVITY_SUPPORTED } from '../../notifications/liveActivity';
import { VOICE_SUPPORTED } from '../../voice/conversation';

export type SettingsPageId =
  | 'updates'
  | 'theme'
  | 'sessionsList'
  | 'chat'
  | 'voice'
  | 'terminal'
  | 'keyboard'
  | 'shortReplies'
  | 'notifications'
  | 'liveActivity'
  | 'connection'
  | 'sync'
  | 'autopilot'
  | 'collab'
  | 'advanced'
  | 'demo'
  | 'readAloudVoice'
  | 'dictateLanguage'
  | 'dictateDictionary'
  | 'terminalPaletteDark'
  | 'terminalPaletteLight'
  | 'licences';

export const SETTINGS_PAGES: Readonly<Record<SettingsPageId, { title: string; description: string }>> = {
  updates: { title: 'Updates', description: 'Your Ghostex version, and newer releases.' },
  theme: { title: 'Interface', description: 'Theme presets, colours, and the chat and terminal appearance.' },
  sessionsList: { title: 'Sessions list', description: 'Unified or Project layout, and how Unified groups.' },
  chat: { title: 'Chat', description: 'Default agent view and chat detail.' },
  voice: { title: 'Voice', description: 'Dictation with Hex or your key, and the voice agent, on each computer.' },
  terminal: { title: 'Terminal', description: 'Font size, background, screen and tab behavior.' },
  keyboard: { title: 'Keyboard', description: 'Command pad, its keys and agent hotkeys.' },
  shortReplies: { title: ShortRepliesCopy.pageTitle, description: ShortRepliesCopy.pageDescription },
  notifications: { title: NotificationsCopy.title, description: NotificationsCopy.settings.pageDescription },
  liveActivity: { title: LiveActivityCopy.pageTitle, description: LiveActivityCopy.pageDescription },
  connection: { title: 'Connection', description: 'Reconnecting to your computer.' },
  sync: { title: 'Sync', description: 'Carrying Spaces and settings between your computers.' },
  autopilot: { title: 'Autopilot', description: 'Keep sessions going while you are away, and what it did.' },
  collab: { title: 'Collab', description: 'Share a chat through a link that opens it in a browser.' },
  advanced: { title: 'Advanced', description: 'Older settings most people never change.' },
  demo: { title: 'Demo computer', description: 'The sample computer on this phone, and how to remove it.' },
  licences: { title: LicencesCopy.pageTitle, description: LicencesCopy.pageDescription },
  // Opened from Settings › Chat's Read aloud rows, not listed on the Settings home.
  readAloudVoice: { title: 'Read aloud voice', description: "Which of this phone's voices reads replies aloud." },
  // Opened from Settings › Voice, for the computer picked there; not listed on the Settings home.
  dictateLanguage: { title: 'Language', description: 'The language Dictate listens for.' },
  dictateDictionary: { title: 'Dictionary', description: 'Words Dictate should spell your way.' },
  // Opened from Settings › Interface's Terminal palettes rows, not listed on the Settings home.
  terminalPaletteDark: { title: 'Terminal palette in dark mode', description: 'The terminal colours in dark mode.' },
  terminalPaletteLight: { title: 'Terminal palette in light mode', description: 'The terminal colours in light mode.' },
};

export const SETTINGS_PAGE_ORDER: readonly SettingsPageId[] = [
  ...(ANDROID_SELF_UPDATE_ENABLED || OTA_ENABLED ? (['updates'] as const) : []),
  'theme',
  'sessionsList',
  'chat',
  ...(VOICE_SUPPORTED ? (['voice'] as const) : []),
  'terminal',
  'keyboard',
  'shortReplies',
  'notifications',
  ...(LIVE_ACTIVITY_SUPPORTED ? (['liveActivity'] as const) : []),
  'connection',
  'sync',
  'autopilot',
  'collab',
  'advanced',
  'licences',
];
