/**
 * What Settings search finds on the phone: every Settings page, and the rows of each page with the words they show,
 * the place they land on (`SettingsSearchFocus`), and, where the desktop has the same setting, its desktop key
 * (`catalog`). A row with a desktop key is also found by the desktop's title, subtitle, choices and hidden search
 * words for it (desktopSettingsWords.generated.ts, from packages/settings-catalog), and both apps match words the same
 * way (fuzzyMatch.ts), so the two searches find the same things by the same words. Rows the desktop does not have are
 * found by the phone's own words.
 *
 * Run `node scripts/generate-settings-search-words.mjs` after adding or changing a `catalog` key here.
 *
 * Kept free of React Native components: the lists below are plain data.
 */

import { CommandPadCopy, LiveActivityCopy, NotificationChoicesCopy, NotificationsCopy } from '../../../copy';
import { LIVE_ACTIVITY_PUSH_SUPPORTED } from '../../../notifications/liveActivityPushStore';
import { NOTIFICATIONS_SUPPORTED } from '../../../notifications/notificationCentre';
import { SETTINGS_PAGES, type SettingsPageId } from '../pages';
import { DESKTOP_SETTINGS_WORDS } from './desktopSettingsWords.generated';
import { anyMatches, SearchPattern, searchTrim } from './fuzzyMatch';
import type { SettingsSearchFocus, SettingsSearchTarget } from './SettingsSearchAnchor';

export type SettingsSearchEntry = {
  readonly page: SettingsPageId;
  /** The `SettingsSection` the row sits in; '' on a page without sections. */
  readonly section: string;
  /** The group the row shows under (its section header), for the result's breadcrumb. */
  readonly group?: string;
  /** The row's name in the result. */
  readonly title: string;
  readonly description?: string;
  /** What the page lands on: the row named `title` unless set; null lands on the top of `section`. */
  readonly anchor?: SettingsSearchTarget | null;
  /** The desktop's settings key for the same setting. */
  readonly catalog?: string;
  /** Other words the row is found by, as the desktop's `search_keywords`. */
  readonly keywords?: readonly string[];
  /** The row's choices, found like its title. */
  readonly options?: readonly string[];
};

const header = (label: string): SettingsSearchTarget => ({ kind: 'header', label });
const row = (label: string): SettingsSearchTarget => ({ kind: 'row', label });

/** Settings › Advanced › Terminal's switches (AdvancedPage's `LEGACY_TERMINAL_TOGGLES`, by their labels). */
const ADVANCED_TERMINAL_SWITCHES: readonly string[] = [
  'Auto scroll',
  'Soft keyboard',
  'Show refresh button',
  'Show file upload button',
  'Show keyboard button',
  'Hide keyboard on startup',
  'Open URLs on tap',
];

/** Every searchable row, by page in the Settings list's order. */
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  // Interface
  {
    page: 'theme',
    section: 'settings:theme:presets',
    title: 'Presets',
    anchor: header('Presets'),
    description: 'Sets the colours below together. You can change each of them afterwards.',
    keywords: ['theme presets', 'themes'],
  },
  {
    page: 'theme',
    section: 'settings:theme:colours',
    group: 'Colours',
    title: 'Appearance',
    description: 'System follows your phone’s light or dark mode.',
    catalog: 'sidebarTheme',
    options: ['System', 'Light', 'Dark'],
    keywords: ['dark mode', 'light mode'],
  },
  {
    page: 'theme',
    section: 'settings:theme:colours',
    group: 'Colours',
    title: 'Dark mode colour',
    description: 'The colour of the app in dark mode.',
    catalog: 'darkThemePreset',
  },
  {
    page: 'theme',
    section: 'settings:theme:colours',
    group: 'Colours',
    title: 'Light mode colour',
    description: 'The colour of the app in light mode.',
    catalog: 'lightThemePreset',
  },
  {
    page: 'theme',
    section: 'settings:theme:colours',
    group: 'Colours',
    title: 'Custom tint',
    description: 'Any colour for the app, typed as hex, after picking the + square.',
    catalog: 'customSidebarTitlebarBackgroundTintColor',
  },
  {
    page: 'theme',
    section: 'settings:theme:colours',
    group: 'Colours',
    title: 'Colourfulness',
    description: 'How much of the colour shows in the sidebar and work area.',
    keywords: ['contrast', 'colorfulness'],
  },
  {
    page: 'theme',
    section: 'settings:theme:colours',
    group: 'Colours',
    title: 'Set the sidebar and work area separately',
    description: 'Off: one Colourfulness for both.',
  },
  {
    page: 'theme',
    section: 'settings:theme:colours',
    group: 'Colours',
    title: 'Sidebar colourfulness',
    anchor: row('Set the sidebar and work area separately'),
    catalog: 'themeSidebarContrast',
  },
  {
    page: 'theme',
    section: 'settings:theme:colours',
    group: 'Colours',
    title: 'Work area colourfulness',
    anchor: row('Set the sidebar and work area separately'),
    catalog: 'themeWorkAreaContrast',
  },
  {
    page: 'theme',
    section: 'settings:theme:chat-terminal',
    title: 'Chat theme',
    anchor: header('Chat theme'),
    description: 'Follow the app theme, or choose a separate appearance for chat.',
    catalog: 'sessionChatTheme',
  },
  {
    page: 'theme',
    section: 'settings:theme:chat-terminal',
    title: 'Terminal theme',
    anchor: header('Terminal theme'),
    description: 'Follow the app theme, or choose a separate appearance for terminals.',
    catalog: 'terminalColorScheme',
  },
  {
    page: 'theme',
    section: 'settings:theme:chat-terminal',
    group: 'Terminal palettes',
    title: 'Terminal palette in dark mode',
    catalog: 'terminalGhosttyTheme',
  },
  {
    page: 'theme',
    section: 'settings:theme:chat-terminal',
    group: 'Terminal palettes',
    title: 'Terminal palette in light mode',
    catalog: 'terminalGhosttyLightTheme',
  },
  {
    page: 'theme',
    section: 'settings:theme:chat-terminal',
    group: 'Terminal palettes',
    title: 'Import Ghostty theme',
    description: 'Add a private terminal palette from a local file.',
    keywords: ['palette', 'ghostty'],
  },

  // Sidebar & Sessions
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Sidebar',
    description: 'Project sidebar or Unified sidebar.',
    catalog: 'sidebarView',
    options: ['Project sidebar', 'Unified sidebar'],
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Separate by machine',
    description: 'One computer at a time, each with its own tab, project list and Spaces.',
    catalog: 'sidebarSeparateByMachine',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Merge copies of the same repository',
    description: 'Two folders of one computer that are copies of one repository show as one project.',
    catalog: 'sidebarMergeRepositoryCopies',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Moving section',
    description: 'Sessions that are working fold into a Moving section at the bottom until they need you.',
    catalog: 'unifiedWorkingSection',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Group by project',
    description: "Every computer's sessions of one repository under one header.",
    catalog: 'unifiedGroupByProject',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Hide projects without sessions',
    description: 'A Show all projects row at the end brings them back.',
    catalog: 'sidebarHideProjectsWithoutSessions',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Worktree sessions show in their project',
    description: "Listed under the repository's project, with the worktree's branch on the row.",
    catalog: 'worktreeSessionsInProject',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Group working sessions',
    description: 'Working sessions move into a folded Working section under their project.',
    catalog: 'groupWorkingSessions',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Pinned order',
    description: 'The order you arranged them in, or the one that came back to you last first.',
    catalog: 'pinnedSessionOrder',
    options: ['Manual', 'Most recently updated'],
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Sidebar',
    title: 'Enable session parking',
    description: 'Deferred sessions move into a folded Parked section.',
    catalog: 'enableSessionParking',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:spaces',
    group: 'Spaces',
    title: 'Spaces',
    description: 'Group projects into Spaces and switch between them from the chips.',
    catalog: 'sidebarSpacesEnabled',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:spaces',
    group: 'Spaces',
    title: 'Active projects',
    description: 'A star before your Spaces lists the projects you are working on from every Space.',
    catalog: 'sidebarActiveProjects',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:spaces',
    group: 'Spaces',
    title: 'Show Main Hub on all Spaces',
    description: 'Main Hub stays at the top of every Space.',
    catalog: 'chiefShowOnAllSpaces',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:session-tags',
    title: 'Session Tags',
    anchor: header('Session Tags'),
    description: 'The tags the Tag As menu and the tag filter offer.',
    catalog: 'sidebarSessionTagListItems',
  },

  // Chat
  {
    page: 'chat',
    section: 'settings:chat:default-agent-view',
    title: 'Default agent view',
    anchor: header('Default agent view'),
    description: 'Agent sessions that support chat open in this view.',
    catalog: 'preferredAgentInterface',
  },
  {
    page: 'chat',
    section: 'settings:chat:messages',
    group: 'Messages',
    title: 'Show file edit previews',
    description: 'Show the first seven code lines instead of only the path and change counts.',
    catalog: 'sessionChatFileEditPreviews',
  },
  {
    page: 'chat',
    section: 'settings:chat:messages',
    group: 'Messages',
    title: 'Grey thinking',
    description: "Show the agent's thinking in grey, so it reads apart from the agent's replies.",
    catalog: 'sessionChatMutedThinking',
  },
  {
    page: 'chat',
    section: 'settings:chat:messages',
    group: 'Messages',
    title: 'Tool call cards (preview)',
    description: 'Show each run of tool calls as one line that says which call is running now.',
    catalog: 'chatToolCallCards',
  },
  {
    page: 'chat',
    section: 'settings:chat:messages',
    group: 'Messages',
    title: 'Tool call lines (experimental)',
    description: "Draw each run of an agent's tool calls as one quiet line that says what it is doing or did.",
    catalog: 'chatToolCallLines',
  },
  {
    page: 'chat',
    section: 'settings:chat:marked-sections',
    title: 'Marked sections',
    anchor: header('Marked sections'),
    description: 'How the chat colours the sections an agent marks with ❓ Needs you, ✅ Done and the other markers.',
    catalog: 'markedHandoversStyle',
  },
  {
    page: 'chat',
    section: 'settings:chat:marked-sections',
    group: 'Marked sections',
    title: 'Show marker emojis',
    description: 'Puts the marker emoji in front of each coloured section.',
    catalog: 'markedHandoversEmoji',
  },
  {
    page: 'chat',
    section: 'settings:chat:read-aloud',
    group: 'Read aloud',
    title: 'Read aloud voice',
    anchor: row('Voice'),
    description: "The voice this phone reads agents' replies with.",
    catalog: 'readAloudVoice',
  },
  {
    page: 'chat',
    section: 'settings:chat:read-aloud',
    group: 'Read aloud',
    title: 'Read aloud speed',
    anchor: header('Read aloud'),
    description: "The speed this phone reads agents' replies at.",
    catalog: 'readAloudRate',
  },

  // Voice
  {
    page: 'voice',
    section: 'settings:voice:computer',
    title: 'Computer',
    description: 'Which computer the voice settings below are saved on.',
  },
  {
    page: 'voice',
    section: 'settings:voice:dictate',
    group: 'Dictate',
    title: 'Dictate engine',
    description: 'Hex on your computer, or your OpenAI or xAI key.',
    catalog: 'dictateEngine',
    keywords: ['dictation', 'speech to text'],
  },
  {
    page: 'voice',
    section: 'settings:voice:dictate',
    group: 'Dictate',
    title: 'Language',
    description: 'The language Dictate listens for.',
    catalog: 'dictateLanguage',
  },
  {
    page: 'voice',
    section: 'settings:voice:call-mode',
    group: 'Voice agent',
    title: 'Call mode',
    anchor: null,
    description: 'Regular (hands-free) or Push-to-talk.',
    catalog: 'voiceAgentCallMode',
    options: ['Regular', 'Push-to-talk'],
  },
  {
    page: 'voice',
    section: 'settings:voice:phone',
    group: 'This phone',
    title: 'Microphone',
    description: "The phone's microphone, or a headset while one is connected.",
    catalog: 'dictateMicrophone',
  },

  // Terminal
  {
    page: 'terminal',
    section: 'settings:terminal:font-size',
    group: 'Font size',
    title: 'Font size',
    description: 'Applies immediately to terminals without a pinch-zoom size of their own.',
    catalog: 'terminalFontSize',
  },
  {
    page: 'terminal',
    section: 'settings:terminal:background',
    title: 'Terminal background',
    anchor: header('Terminal background'),
    description: 'Black / white, Follow theme or Custom color. Only changes the terminal.',
    catalog: 'terminalBackgroundMode',
  },
  {
    page: 'terminal',
    section: 'settings:terminal:background',
    group: 'Terminal background',
    title: 'Terminal background color',
    description: 'Painted behind terminal text in dark and light mode.',
    catalog: 'workspaceBackgroundColor',
  },
  {
    page: 'terminal',
    section: 'settings:terminal:behavior',
    group: 'Behavior',
    title: 'Keep screen on',
    description: 'Keeps the screen awake while a terminal is open.',
  },
  {
    page: 'terminal',
    section: 'settings:terminal:behavior',
    group: 'Behavior',
    title: 'Confirm before closing tabs',
    catalog: 'terminalConfirmCloseSurface',
  },

  // Keyboard
  {
    page: 'keyboard',
    section: 'settings:keyboard:command-pad',
    group: CommandPadCopy.settingsSection,
    title: CommandPadCopy.toggle,
    description: CommandPadCopy.settingsCaption,
    keywords: ['extra keys', 'key bar'],
  },
  {
    page: 'keyboard',
    section: 'settings:keyboard:command-pad',
    group: CommandPadCopy.settingsSection,
    title: CommandPadCopy.vibration,
    keywords: ['haptics'],
  },
  {
    page: 'keyboard',
    section: 'settings:keyboard:command-pad',
    group: CommandPadCopy.settingsSection,
    title: CommandPadCopy.padKeys,
    description: CommandPadCopy.padKeysDescription,
  },
  {
    page: 'keyboard',
    section: 'settings:keyboard:command-pad',
    group: CommandPadCopy.layersSection,
    title: CommandPadCopy.extraKeysLayout,
    description: CommandPadCopy.extraKeysLayoutDescription,
  },
  {
    page: 'keyboard',
    section: 'settings:keyboard:command-pad',
    group: CommandPadCopy.layersSection,
    title: CommandPadCopy.agentHotkeys,
    description: CommandPadCopy.agentHotkeysDescription,
    keywords: ['hotkeys', 'shortcuts'],
  },

  // Notifications
  ...(NOTIFICATIONS_SUPPORTED
    ? [
        {
          page: 'notifications',
          section: '',
          group: NotificationsCopy.settings.sectionAgents,
          title: NotificationsCopy.settings.master,
          description: 'Notifications from your agents on this phone.',
          catalog: 'showMacOSAttentionNotifications',
        } as const,
        ...(
          [
            [NotificationChoicesCopy.needsYou, NotificationChoicesCopy.needsYouDetail],
            [NotificationChoicesCopy.finished, NotificationChoicesCopy.finishedDetail],
            [NotificationChoicesCopy.errors, NotificationChoicesCopy.errorsDetail],
            [NotificationChoicesCopy.threadReports, NotificationChoicesCopy.threadReportsDetail],
          ] as const
        ).map(([title, description]): SettingsSearchEntry => ({
          page: 'notifications',
          section: '',
          group: NotificationChoicesCopy.sectionKinds,
          title,
          description,
          options: [
            NotificationChoicesCopy.choiceSound,
            NotificationChoicesCopy.choiceSilent,
            NotificationChoicesCopy.choiceOff,
          ],
        })),
        {
          page: 'notifications',
          section: '',
          group: NotificationChoicesCopy.sectionKinds,
          title: NotificationChoicesCopy.test,
          anchor: row(NotificationChoicesCopy.test),
          description: 'A notice in 5 seconds, to check sound and banners.',
          catalog: 'attentionNotificationActions',
        } as const,
      ]
    : []),
  {
    page: 'notifications',
    section: '',
    group: NotificationsCopy.settings.sectionSound,
    title: NotificationsCopy.settings.sound,
    description: NotificationsCopy.settings.soundDetail,
    catalog: 'completionSound',
  },
  {
    page: 'notifications',
    section: '',
    title: NotificationsCopy.settings.alertsFor,
    description: 'All, or Needs you only.',
    catalog: 'attentionAlertsFor',
  },

  // Live Activity
  {
    page: 'liveActivity',
    section: '',
    title: LiveActivityCopy.toggle,
    description: 'Working and waiting agents on the Lock Screen and in the Dynamic Island.',
    keywords: ['lock screen', 'dynamic island'],
  },
  ...(LIVE_ACTIVITY_PUSH_SUPPORTED
    ? [
        {
          page: 'liveActivity',
          section: '',
          title: LiveActivityCopy.lockedUpdatesToggle,
          description: 'One of your computers keeps the Live Activity up to date while the phone is locked.',
        } as const,
      ]
    : []),
  {
    page: 'liveActivity',
    section: '',
    title: LiveActivityCopy.sessionNamesToggle,
    description: 'Rows show the session’s name instead of the agent’s, also in the Home Screen widgets.',
    keywords: ['widgets'],
  },

  // Connection
  {
    page: 'connection',
    section: '',
    title: 'Auto-reconnect on disconnect',
    description: 'Reconnects when the connection to your computer drops, and reopens interrupted agent terminals.',
  },
  {
    page: 'connection',
    section: '',
    title: 'Tailscale reminder',
    description: 'A notice on Sessions when Tailscale is off on this phone and your computer cannot be reached.',
    keywords: ['vpn'],
  },

  // Sync
  {
    page: 'sync',
    section: '',
    title: 'Carry settings between computers',
    description: 'This phone keeps a copy of Spaces and synced settings and passes changes on to each computer.',
    keywords: ['sync settings'],
  },

  // Autopilot
  {
    page: 'autopilot',
    section: 'settings:autopilot:switch',
    group: 'Autopilot',
    title: 'Autopilot',
    description:
      'Carries on stopped sessions, interrupts hung commands, reloads frozen ones, switches account at a limit.',
    catalog: 'autopilotEnabled',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:switch',
    group: 'Autopilot',
    title: 'Which sessions',
    description: 'Every session, projects you pick, or sessions you pick.',
    catalog: 'autopilotScope',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:allowed',
    group: 'What it may do',
    title: 'On its own',
    description: 'Heal, Heal and decide, or Everything.',
    catalog: 'autopilotTier',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:allowed',
    group: 'What it may do',
    title: 'Answer questions for me',
    description: "When you don't answer in time, it picks each question's recommended choice.",
    catalog: 'autopilotAnswerQuestions',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:allowed',
    group: 'What it may do',
    title: 'Wait for me first',
    description: 'How long it waits for you before answering a question.',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:allowed',
    group: 'What it may do',
    title: 'Answer approval cards',
    description: 'Permission prompts, Connectors cards and folder trust.',
    catalog: 'autopilotApprovals',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:limits',
    title: 'Hard limits it may cross',
    anchor: header('Hard limits it may cross'),
    catalog: 'autopilotHardLimits',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:supervisor',
    title: 'Supervisor',
    anchor: header('Supervisor'),
    description: 'The model that watches your sessions.',
    catalog: 'autopilotSupervisor',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:supervisor',
    group: 'Supervisor',
    title: 'Look at every session every',
    anchor: null,
    catalog: 'autopilotSweep',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:log',
    title: 'Log',
    anchor: header('Log'),
    description: 'What Autopilot did, newest first.',
    catalog: 'autopilotLog',
  },

  // Collab
  {
    page: 'collab',
    section: 'settings:collab:switch',
    title: 'Ghostex Collab',
    anchor: header('Ghostex Collab'),
    catalog: 'collabEnabled',
  },
  {
    page: 'collab',
    section: 'settings:collab:switch',
    group: 'Ghostex Collab',
    title: 'Uninstall Collab',
  },
  {
    page: 'collab',
    section: 'settings:collab:newShares',
    group: 'New shares start with',
    title: 'Guest messages',
    catalog: 'collabMode',
  },
  {
    page: 'collab',
    section: 'settings:collab:newShares',
    group: 'New shares start with',
    title: 'Link ends after',
    catalog: 'collabExpiry',
  },
  {
    page: 'collab',
    section: 'settings:collab:shared',
    title: 'Shared now',
    anchor: header('Shared now'),
    description: 'The chats shared right now; stop one or all.',
    catalog: 'collabShares',
  },
  {
    page: 'collab',
    section: 'settings:collab:log',
    title: 'Guest messages log',
    anchor: header('Guest messages log'),
    description: 'Every guest message and what you did with it.',
    catalog: 'collabLog',
  },

  // Updates
  {
    page: 'updates',
    section: 'settings:updates:app',
    title: 'App version',
    anchor: null,
    description: 'The version of the app and where it was installed from.',
    keywords: ['version', 'installed from'],
  },
  {
    page: 'updates',
    section: 'settings:updates:ota',
    title: 'Over-the-air update',
    anchor: null,
    description: 'The update the app runs, and the one waiting for a restart.',
  },
  {
    page: 'updates',
    section: 'settings:updates:check',
    title: 'Check for updates',
    description: 'Looks for a new app and a new over-the-air update.',
    catalog: 'updatesCheckNow',
  },

  // Advanced
  ...ADVANCED_TERMINAL_SWITCHES.map((title): SettingsSearchEntry => ({
    page: 'advanced',
    section: 'settings:advanced:terminal',
    group: 'Terminal',
    title,
  })),
  {
    page: 'advanced',
    section: 'settings:advanced:cursor',
    title: 'Cursor',
    anchor: header('Cursor'),
    description: 'Block, Underline or Bar.',
    catalog: 'terminalCursorStyle',
    options: ['Block', 'Underline', 'Bar'],
  },
  {
    page: 'advanced',
    section: 'settings:advanced:cursor',
    group: 'Cursor',
    title: 'Cursor blink',
    anchor: row('Blink'),
    catalog: 'terminalCursorStyleBlink',
  },
  {
    page: 'advanced',
    section: 'settings:advanced:scrollback',
    group: 'Scrollback',
    title: 'Scrollback',
    description: 'How many rows a terminal keeps. Applies to newly opened terminals.',
    catalog: 'terminalScrollbackLimitMb',
  },
  {
    page: 'advanced',
    section: 'settings:advanced:terminal-bell',
    title: 'Terminal bell',
    anchor: header('Terminal bell'),
    description: 'Vibrate, Beep or Ignore bell.',
    options: ['Vibrate', 'Beep', 'Ignore bell'],
  },
  {
    page: 'advanced',
    section: 'settings:advanced:chat-transcript',
    group: 'Chat transcript',
    title: 'Default to Detailed view',
    description: 'New chats open in Detailed view, with the work under each agent reply shown.',
    catalog: 'sessionChatDetailedView',
  },
  {
    page: 'advanced',
    section: 'settings:advanced:chat-transcript',
    group: 'Chat transcript',
    title: 'Custom Transcript Width',
    description: 'Lets the transcript use a different width from the prompt composer.',
    catalog: 'sessionChatCustomTranscriptWidthEnabled',
  },
  {
    page: 'advanced',
    section: 'settings:advanced:chat-transcript',
    group: 'Chat transcript',
    title: 'Transcript width',
    description: 'Adjusts messages only. The prompt composer keeps its current width.',
    catalog: 'sessionChatTranscriptWidthPercent',
  },
  {
    page: 'advanced',
    section: 'settings:advanced:sessions-list',
    group: 'Sessions list',
    title: 'Sidebar groups opacity',
    description: 'Changes only group backgrounds and borders.',
  },
  {
    page: 'advanced',
    section: 'settings:advanced:ssh-connection',
    group: 'SSH connection',
    title: 'Send keep-alive packets',
  },
  {
    page: 'advanced',
    section: 'settings:advanced:ssh-connection',
    group: 'SSH connection',
    title: 'Keep-alive interval',
    description: 'Applies the next time a machine connects.',
  },
];

/** A page opened from another page's row, shown in a result's breadcrumb after that page. */
const SUB_PAGE_PARENT: Partial<Record<SettingsPageId, SettingsPageId>> = {
  readAloudVoice: 'chat',
  dictateLanguage: 'voice',
  terminalPaletteDark: 'theme',
  terminalPaletteLight: 'theme',
};

export type SettingsSearchResult = {
  /** Unique within one search. */
  readonly key: string;
  readonly title: string;
  /** Where it is: the page, then the group, as "Chat › Messages"; "Settings" for a page. */
  readonly breadcrumb: string;
  readonly description: string;
  readonly page: SettingsPageId;
  /** Undefined for a page result: the page opens at its top. */
  readonly focus?: Omit<SettingsSearchFocus, 'at'>;
};

function pageTrail(page: SettingsPageId): string {
  const parent = SUB_PAGE_PARENT[page];
  return parent === undefined
    ? SETTINGS_PAGES[page].title
    : `${SETTINGS_PAGES[parent].title} › ${SETTINGS_PAGES[page].title}`;
}

/** Every word a row is found by: the phone's, and the desktop's for the same setting. */
function entryTexts(entry: SettingsSearchEntry): { titles: string[]; others: string[] } {
  const desktop = entry.catalog === undefined ? undefined : DESKTOP_SETTINGS_WORDS[entry.catalog];
  return {
    titles: [entry.title, ...(desktop === undefined ? [] : [desktop.title])],
    others: [
      entry.description ?? '',
      entry.group ?? '',
      ...(entry.options ?? []),
      ...(entry.keywords ?? []),
      ...(desktop === undefined ? [] : [desktop.subtitle, ...desktop.options, ...desktop.keywords]),
    ],
  };
}

/**
 * How well `texts` match, best first, or null: a title starting with the words (or one of its words starting with
 * them), a title holding them, a title close to them, then any other word of the row.
 */
function rank(
  query: string,
  pattern: SearchPattern,
  titles: readonly string[],
  others: readonly string[]
): number | null {
  const lower = query.toLowerCase();
  const lowered = titles.map((title) => title.toLowerCase());
  if (lowered.some((title) => title.startsWith(lower) || title.includes(` ${lower}`))) return 0;
  if (lowered.some((title) => title.includes(lower))) return 1;
  if (anyMatches(pattern, titles)) return 2;
  if (anyMatches(pattern, others)) return 3;
  return null;
}

/**
 * The Settings pages and rows `query` finds, best first, among `pages` (the pages this phone lists, in its order:
 * another page's rows are left out). A blank query finds nothing.
 */
export function searchSettings(query: string, pages: readonly SettingsPageId[]): SettingsSearchResult[] {
  const trimmed = searchTrim(query);
  if (trimmed === '') return [];
  const pattern = new SearchPattern(trimmed);
  const order = new Map(pages.map((page, index) => [page, index]));
  const ranked: { result: SettingsSearchResult; rank: number; order: number }[] = [];

  pages.forEach((page, index) => {
    const meta = SETTINGS_PAGES[page];
    const score = rank(trimmed, pattern, [meta.title], []);
    if (score === null) return;
    ranked.push({
      result: { key: `page:${page}`, title: meta.title, breadcrumb: 'Settings', description: meta.description, page },
      rank: score,
      order: index * 1000 - 1,
    });
  });

  SETTINGS_SEARCH_ENTRIES.forEach((entry, index) => {
    const pageOrder = order.get(SUB_PAGE_PARENT[entry.page] ?? entry.page);
    if (pageOrder === undefined) return;
    const { titles, others } = entryTexts(entry);
    const score = rank(trimmed, pattern, titles, others);
    if (score === null) return;
    const desktop = entry.catalog === undefined ? undefined : DESKTOP_SETTINGS_WORDS[entry.catalog];
    const trail = pageTrail(entry.page);
    const group = entry.group;
    ranked.push({
      result: {
        key: `row:${index}`,
        title: entry.title,
        breadcrumb: group === undefined || group === entry.title ? trail : `${trail} › ${group}`,
        description: entry.description ?? desktop?.subtitle ?? '',
        page: entry.page,
        focus: { section: entry.section, target: entry.anchor === undefined ? row(entry.title) : entry.anchor },
      },
      rank: score,
      order: pageOrder * 1000 + index,
    });
  });

  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.result);
}
