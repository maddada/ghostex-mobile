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

import {
  AutomationsCopy,
  CommandPadCopy,
  LiveActivityCopy,
  NotificationChoicesCopy,
  NotificationsCopy,
  SessionGroupsCopy,
} from '../../../copy';
import { CrashReportsSettingsCopy } from '../../../copy/crashReports';
import { CRASH_REPORTS_IN_SETTINGS } from '../../../feedback/crashReports';
import { LIVE_ACTIVITY_PUSH_SUPPORTED } from '../../../notifications/liveActivityPushStore';
import { NOTIFICATIONS_SUPPORTED } from '../../../notifications/notificationCentre';
import { ANALYTICS_PURPOSE_COPY, ANALYTICS_TOGGLE_TITLE } from '../../../copy/privacy';
import type { SidebarOrganization } from '../../../settingsSync/sidebarOrganization';
import { SETTINGS_PAGES, type SettingsPageId } from '../pages';
import { DESKTOP_SETTINGS_WORDS } from './desktopSettingsWords.generated';
import { anyMatches, SearchPattern, searchTrim } from './fuzzyMatch';
import type { SettingsSearchFocus, SettingsSearchTarget } from './settingsSearchFocus';

export type SettingsSearchEntry = {
  readonly page: SettingsPageId;
  /** The `SettingsSection` the row sits in; '' on a page without sections. */
  readonly section: string;
  /** The group the row shows under (its section header), for the result's breadcrumb. */
  readonly group?: string;
  /** The group's name before it was renamed: the row is still found by it. */
  readonly formerGroup?: string;
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
  /**
   * A row the page shows only with the Unified sidebar. While the Project sidebar is chosen, the result says
   * `projectDescription` and the page lands on `standIn`, where the sidebar is chosen, then on the row once it shows.
   */
  readonly unifiedOnly?: { readonly projectDescription: string; readonly standIn: SettingsSearchTarget };
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
  // Themes (formerly Interface)
  {
    page: 'theme',
    section: 'settings:theme:copy-computer',
    title: 'Copy from a computer',
    description: 'Pick a paired computer, preview its swatches, and copy its theme once to this phone.',
    keywords: ['interface', 'sync theme', 'copy theme', 'pc theme', 'mac theme'],
  },
  {
    page: 'theme',
    section: 'settings:theme:gallery',
    title: 'Themes',
    description: 'Default, Moonwater, Polar, Glasshouse, Red Earth, Deep Current, Night Garden, Nocturne Canyon, Firefly Forest, Ember Forge, Synthwave, Inkstone, and Orchid Dusk.',
    keywords: ['interface', 'art', 'polar', 'polar night', 'moonwater', 'glasshouse', 'synthwave', 'firefly', 'ember', 'inkstone', 'orchid', 'looks'],
  },
  {
    page: 'theme',
    section: 'settings:theme:artwork',
    title: 'Artwork',
    description: 'None or any of the 32 still theme artworks painted softly behind the sessions list and chat.',
    keywords: ['windowArt', 'artwork', 'art', 'backdrop', 'wallpaper', 'background', 'dimming', 'polar'],
  },
  {
    page: 'theme',
    section: 'settings:theme:artwork',
    title: 'Show artwork behind screens',
    description: 'Shows the active still artwork dimmed behind the sessions list and chat on this phone.',
    keywords: ['backdrop', 'art', 'wallpaper', 'header', 'show dimmed artwork'],
  },
  {
    page: 'theme',
    section: 'settings:theme:presets',
    title: 'Presets',
    anchor: header('Presets'),
    description: 'Sets the colours below together. You can change each of them afterwards.',
    keywords: ['theme presets', 'themes', 'interface'],
  },
  {
    page: 'theme',
    section: 'settings:theme:appearance',
    title: 'Appearance',
    description: 'System follows your phone’s light or dark mode.',
    catalog: 'sidebarTheme',
    options: ['System', 'Dark', 'Light'],
    keywords: ['dark mode', 'light mode', 'interface'],
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
    description: 'Any uncapped colour for the app, typed as hex, after picking the + square.',
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
    section: 'settings:theme:fine-tune',
    group: 'Fine-tune',
    title: 'Fine-tune colours',
    description: 'Accent, chat bubbles, cards, borders, text, links, and code block overrides.',
    keywords: ['themeRoles', 'accent', 'userMessage', 'chatBox', 'bubble', 'borders'],
  },
  {
    page: 'theme',
    section: 'settings:theme:reset',
    title: 'Reset to default',
    description: 'Restores default colours, artwork settings, and fine-tune overrides on this phone.',
    keywords: ['reset theme', 'default theme'],
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
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Sidebar',
    description: 'Project sidebar or Unified sidebar.',
    catalog: 'sidebarView',
    options: ['Project sidebar', 'Unified sidebar'],
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Computers',
    description: 'One list, or A tab each: one computer at a time, each with its own tab, project list and Spaces.',
    catalog: 'sidebarSeparateByMachine',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Merge copies of the same repository',
    description: 'Two folders of one computer that are copies of one repository show as one project.',
    catalog: 'sidebarMergeRepositoryCopies',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: "Hide sessions and projects from computers that aren't connected",
    description: 'They come back when the computer reconnects.',
    catalog: 'sidebarHideDisconnectedMachines',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Group sessions by tags',
    description: 'Group Unified by the Session Tags order. Change the order in Session Tags.',
    catalog: 'groupSessionsByTags',
    unifiedOnly: { projectDescription: SessionGroupsCopy.searchInProjectSidebar, standIn: row('Sidebar') },
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Moving section',
    description: 'Sessions that are working fold into a Moving section at the bottom until they need you.',
    catalog: 'unifiedWorkingSection',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Group by project',
    description: "Every computer's sessions of one repository under one header.",
    catalog: 'unifiedGroupByProject',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Session order',
    description: 'Recent activity, alphabetical by title, or newest first.',
    catalog: 'unifiedSessionOrder',
    options: ['Recent', 'A to Z', 'Created'],
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Hide projects without sessions',
    description: 'A Show all projects row at the end brings them back.',
    catalog: 'sidebarHideProjectsWithoutSessions',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Worktree sessions',
    description: "In their repository (under the repository's project, with the worktree's branch on the row), or Own project.",
    catalog: 'worktreeSessionsInProject',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Group working sessions',
    description: 'Working sessions move into a folded Working section under their project.',
    catalog: 'groupWorkingSessions',
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
    title: 'Pinned order',
    description: 'The order you arranged them in, or the one that came back to you last first.',
    catalog: 'pinnedSessionOrder',
    options: ['Manual', 'Most recently updated'],
  },
  {
    page: 'sessionsList',
    section: 'settings:sessions-list:sidebar',
    group: 'Layout',
    formerGroup: 'Sidebar',
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
    description: 'The tags the Tag As menu and the tag filter offer, and the order Group sessions by tags follows.',
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
  {
    page: 'chat',
    section: 'settings:chat:session-mode',
    group: 'Session mode',
    title: 'Session mode',
    description: 'Choose Terminal-based or Native mode per agent for Claude Code, Codex, Antigravity, OpenCode, Grok Build, Hermes Agent, Cursor CLI, Pi Agent, and OMP.',
    catalog: 'agentSessionMode',
    keywords: ['native', 'terminal-based', 'terminal', 'claude', 'codex', 'antigravity', 'opencode', 'grok', 'hermes', 'cursor', 'pi', 'omp', 'session mode'],
  },
  {
    page: 'chat',
    section: 'settings:chat:claude-code',
    group: 'Claude Code',
    title: 'Compact idle chats before the prompt cache expires',
    description:
      'Claude Code compacts a long idle chat just before its 1-hour prompt cache expires; Auto Sleep waits for it.',
    catalog: 'claudeIdleCompaction',
  },
  {
    page: 'chat',
    section: 'settings:chat:claude-code',
    group: 'Claude Code',
    title: 'Compact chats above',
    description:
      'The size at which Claude Code compacts an idle chat, and Ghostex offers to compact before sending or before carrying a session on.',
    catalog: 'claudeIdleCompactAbove',
  },
  {
    page: 'chat',
    section: 'settings:chat:claude-code',
    group: 'Claude Code',
    title: 'Offer to compact long chats before sending',
    description: 'Offers to compact a long chat whose prompt cache has expired before sending, to save usage.',
    catalog: 'offerCompactBeforeSending',
  },
  {
    page: 'chat',
    section: 'settings:chat:claude-code',
    group: 'Claude Code',
    title: 'Compact workers before a coordinator returns to them',
    description:
      'Compacts a big worker that sat idle past its prompt cache before its coordinator messages it, to save tokens.',
    catalog: 'compactWorkersBeforeReturn',
  },
  {
    page: 'chat',
    section: 'settings:chat:claude-code',
    group: 'Claude Code',
    title: 'Use a 1-hour prompt cache',
    description: "Ask for Claude's 1-hour prompt cache on an API key, Bedrock, Vertex or Foundry.",
    catalog: 'claudeOneHourPromptCache',
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
        {
          page: 'notifications',
          section: '',
          group: NotificationsCopy.settings.sectionAgents,
          title: NotificationsCopy.settings.hideProjectNamesToggle,
          description: NotificationsCopy.settings.hideProjectNamesCaption,
          keywords: ['project names', 'hide project', 'folder', 'privacy', 'live activity', 'push'],
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
    title: 'Computers',
    description: 'Every computer with its live route (Tailscale, Private Relay, Global Relay, Direct) and status.',
    keywords: ['tailscale', 'easy connect', 'relay', 'route', 'vpn', 'slow'],
  },
  {
    page: 'connection',
    section: '',
    group: 'Memory',
    title: 'Stop sessions that run the computer out of memory',
    description:
      'When the computer is about to run out of memory, Ghostex stops what an agent started that uses the most.',
    catalog: 'memoryGuardEnabled',
    keywords: ['memory guard', 'out of memory', 'ram', 'oom'],
  },
  {
    page: 'connection',
    section: '',
    group: 'Memory',
    title: 'Notify me when it steps in',
    description:
      'A notification whenever Ghostex stops or restarts something to free memory. Shown while the memory guard is on.',
    catalog: 'memoryGuardNotify',
  },
  {
    page: 'connection',
    section: '',
    title: 'Logs',
    description: 'Recent connection and status events on this phone. Copy them, or send them to the developer.',
    keywords: ['log', 'debug', 'send logs'],
  },
  // Connection › Crash reports (iOS): the row under Logs opens the page; the switch is found by its own name.
  ...(CRASH_REPORTS_IN_SETTINGS
    ? [
        {
          page: 'crashReports',
          section: '',
          title: CrashReportsSettingsCopy.title,
          description: CrashReportsSettingsCopy.rowDescription,
          anchor: null,
          keywords: CrashReportsSettingsCopy.searchWords,
        } as const,
        {
          page: 'crashReports',
          section: '',
          title: CrashReportsSettingsCopy.keep,
          description: CrashReportsSettingsCopy.keepCaption,
          keywords: CrashReportsSettingsCopy.searchWords,
        } as const,
      ]
    : []),

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
    group: 'Mode',
    formerGroup: 'Autopilot',
    title: 'Autopilot',
    description:
      'Off, Careful, Full or Custom. Carries on stopped sessions, interrupts hung commands, reloads frozen ones, switches account at a limit.',
    catalog: 'autopilotEnabled',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:switch',
    group: 'Mode',
    formerGroup: 'Autopilot',
    title: 'Which sessions',
    description: 'Every session, projects you pick, or sessions you pick, and what is left out.',
    catalog: 'autopilotScope',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:questions',
    title: 'When it asks a question',
    description: "Wait for me, or pick each question's recommended choice after 5, 10 or 15 minutes.",
    catalog: 'autopilotAnswerQuestions',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:permission',
    title: 'When it asks permission',
    description: 'Permission prompts, Connectors cards and folder trust: Wait for me, Safe steps or All but limits.',
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
    section: 'settings:autopilot:advanced',
    group: 'Advanced',
    title: 'Supervisor',
    anchor: header('Advanced'),
    description: 'The model that wakes for judgment calls.',
    catalog: 'autopilotSupervisor',
  },
  {
    page: 'autopilot',
    section: 'settings:autopilot:advanced',
    group: 'Advanced',
    title: 'Look at every session every',
    anchor: header('Advanced'),
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
    // The section is titled by the computer's name (CollabPage), so the search lands on its first row.
    title: 'Collab on your computer',
    anchor: row('Uninstall Collab'),
    keywords: ['ghostex collab', 'this computer'],
    catalog: 'collabEnabled',
  },
  {
    page: 'collab',
    section: 'settings:collab:switch',
    group: 'Collab on your computer',
    formerGroup: 'Ghostex Collab',
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

  // Experience
  {
    page: 'experience',
    section: 'settings:experience:preset',
    title: 'Experience',
    anchor: null,
    description: 'How many buttons and details this phone shows: Chill, Regular or Advanced.',
    catalog: 'experiencePreset',
    options: ['Chill', 'Regular', 'Advanced', 'Custom'],
  },
  {
    page: 'experience',
    section: 'settings:experience:chatBox',
    title: 'Chat box',
    anchor: null,
    description: 'Chill, Regular or Advanced for the chat box.',
    catalog: 'experienceChatBox',
  },
  {
    page: 'experience',
    section: 'settings:experience:chat',
    title: 'Chat',
    anchor: null,
    description: 'Chill, Regular or Advanced for the chat.',
    catalog: 'experienceChat',
  },
  {
    page: 'experience',
    section: 'settings:experience:sessionsList',
    title: 'Sessions list',
    anchor: null,
    description: 'Chill, Regular or Advanced for the sessions list.',
    catalog: 'experienceSessionsList',
  },
  {
    page: 'experience',
    section: 'settings:experience:switches',
    group: 'Switches',
    title: 'Mode in the chat box',
    catalog: 'chatComposerModePicker',
  },
  {
    page: 'experience',
    section: 'settings:experience:switches',
    group: 'Switches',
    title: 'Terminal button in the chat box',
    catalog: 'chatComposerTerminalButton',
  },
  {
    page: 'experience',
    section: 'settings:experience:switches',
    group: 'Switches',
    title: 'Context ring in the chat box',
    catalog: 'chatComposerContextRing',
  },
  {
    page: 'experience',
    section: 'settings:experience:switches',
    group: 'Switches',
    title: 'Calm Quiet View',
    catalog: 'chatQuietViewCalm',
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
    title: 'New chats open in',
    description: 'Normal view, or Detailed view, with the work under each agent reply shown.',
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
    section: 'settings:advanced:sessions-list',
    group: 'Sessions list',
    title: 'Bold coordinator title',
    description: "Draws each coordinator's title in bold in the Sessions list.",
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

  // Privacy & Analytics
  {
    page: 'privacy',
    section: 'settings:privacy:analytics',
    group: 'Usage analytics',
    title: ANALYTICS_TOGGLE_TITLE,
    description: `${ANALYTICS_PURPOSE_COPY}. Synced with your connected computer's analyticsEnabled setting.`,
    catalog: 'analyticsEnabled',
    keywords: ['anonymous', 'opt out', 'analyticsEnabled'],
  },
  {
    page: 'privacy',
    section: 'settings:privacy:preview',
    group: "Inspect what's sent",
    title: "View what's sent",
    description: 'Inspect the live JSON payload from your computer, or read a plain-English summary.',
    keywords: ['telemetry', 'preview', 'payload', 'json', 'never sent', 'analytics'],
  },
  {
    page: 'privacy',
    section: 'settings:privacy:preview',
    group: "Inspect what's sent",
    title: 'Read ANALYTICS.md on GitHub',
    description: 'Full event reference and open-source audit links.',
    keywords: ['analytics.md', 'github', 'open source', 'mit', 'privacy'],
  },
];

/** A page opened from another page's row, shown in a result's breadcrumb after that page. */
const SUB_PAGE_PARENT: Partial<Record<SettingsPageId, SettingsPageId>> = {
  readAloudVoice: 'chat',
  dictateLanguage: 'voice',
  terminalPaletteDark: 'theme',
  terminalPaletteLight: 'theme',
  crashReports: 'connection',
};

export type SettingsSearchResult = {
  /** Unique within one search. */
  readonly key: string;
  readonly title: string;
  /** Where it is: the page, then the group, as "Chat › Messages"; "Settings" for a page. */
  readonly breadcrumb: string;
  readonly description: string;
  /** Opens a Settings page when `route` is absent. */
  readonly page?: SettingsPageId;
  /** Opens a top-level phone screen directly (e.g. Automations from Settings search). */
  readonly route?: 'Automations';
  /** Undefined for a page result: the page opens at its top. */
  readonly focus?: Omit<SettingsSearchFocus, 'at'>;
};

type SettingsSearchScreenEntry = {
  readonly key: string;
  readonly route: 'Automations';
  readonly title: string;
  readonly breadcrumb: string;
  readonly description: string;
  readonly keywords: readonly string[];
};

/** Non-settings screens discoverable from Settings search so searching "automation" finds Automations. */
const SETTINGS_SEARCH_SCREENS: readonly SettingsSearchScreenEntry[] = [
  {
    key: 'screen:automations',
    route: 'Automations',
    title: AutomationsCopy.title,
    breadcrumb: AutomationsCopy.settingsSearchBreadcrumb,
    description: AutomationsCopy.settingsSearchDescription,
    keywords: ['automation', 'automations', 'automate', 'schedule', 'scheduled', 'cron', 'runs', 'triage', 'pause', 'resume', 'run now'],
  },
];

function pageTrail(page: SettingsPageId): string {
  const parent = SUB_PAGE_PARENT[page];
  return parent === undefined
    ? SETTINGS_PAGES[page].title
    : `${SETTINGS_PAGES[parent].title} › ${SETTINGS_PAGES[page].title}`;
}

/** Every word a row is found by: the phone's, and the desktop's for the same setting. */
function entryTexts(entry: SettingsSearchEntry): { titles: string[]; names: string[]; prose: string[] } {
  const desktop = entry.catalog === undefined ? undefined : DESKTOP_SETTINGS_WORDS[entry.catalog];
  return {
    titles: [entry.title, ...(desktop === undefined ? [] : [desktop.title])],
    names: [
      entry.group ?? '',
      entry.formerGroup ?? '',
      ...(entry.options ?? []),
      ...(entry.keywords ?? []),
      ...(desktop === undefined ? [] : [...desktop.options, ...desktop.keywords]),
    ],
    prose: [entry.description ?? '', ...(desktop === undefined ? [] : [desktop.subtitle])],
  };
}

/**
 * How well `texts` match, best first, or null: a title starting with the words (or one of its words starting with
 * them), a title the words find (fuzzyMatch.ts), then any other word of the row. A title only holding the words
 * inside a word ("Workspaces" for "spaces") no longer counts (CDXC:Settings 2026-11-15 in fuzzyMatch.ts).
 */
function rank(
  query: string,
  pattern: SearchPattern,
  titles: readonly string[],
  names: readonly string[],
  prose: readonly string[],
): number | null {
  const lower = query.toLowerCase();
  const lowered = titles.map((title) => title.toLowerCase());
  if (lowered.some((title) => title.startsWith(lower) || title.includes(` ${lower}`))) return 0;
  if (anyMatches(pattern, titles)) return 2;
  if (anyMatches(pattern, names) || anyMatches(pattern, prose, true)) return 3;
  return null;
}

/** Former page names and search aliases so renamed pages (e.g. Interface -> Themes) still appear as page cards. */
const PAGE_SEARCH_ALIASES: Partial<Record<SettingsPageId, readonly string[]>> = {
  theme: ['Interface', 'Appearance'],
  privacy: ['Analytics', 'Telemetry', 'Anonymous', 'Do Not Track'],
};

/**
 * The Settings pages and rows `query` finds, best first, among `pages` (the pages this phone lists, in its order:
 * another page's rows are left out). A blank query finds nothing. `sidebarView` is the sidebar chosen in Sidebar &
 * Sessions, which decides where a Unified-only row's result leads.
 */
export function searchSettings(
  query: string,
  pages: readonly SettingsPageId[],
  sidebarView: SidebarOrganization['sidebarView'],
): SettingsSearchResult[] {
  const trimmed = searchTrim(query);
  if (trimmed === '') return [];
  const pattern = new SearchPattern(trimmed);
  const order = new Map(pages.map((page, index) => [page, index]));
  const ranked: { result: SettingsSearchResult; rank: number; order: number }[] = [];

  pages.forEach((page, index) => {
    const meta = SETTINGS_PAGES[page];
    const score = rank(trimmed, pattern, [meta.title], PAGE_SEARCH_ALIASES[page] ?? [], []);
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
    const { titles, names, prose } = entryTexts(entry);
    const score = rank(trimmed, pattern, titles, names, prose);
    if (score === null) return;
    const desktop = entry.catalog === undefined ? undefined : DESKTOP_SETTINGS_WORDS[entry.catalog];
    const trail = pageTrail(entry.page);
    const group = entry.group;
    const elsewhere = sidebarView === 'project' ? entry.unifiedOnly : undefined;
    const target = entry.anchor === undefined ? row(entry.title) : entry.anchor;
    ranked.push({
      result: {
        key: `row:${index}`,
        title: entry.title,
        breadcrumb: group === undefined || group === entry.title ? trail : `${trail} › ${group}`,
        description: elsewhere?.projectDescription ?? entry.description ?? desktop?.subtitle ?? '',
        page: entry.page,
        focus:
          elsewhere === undefined
            ? { section: entry.section, target }
            : { section: entry.section, target, standIn: elsewhere.standIn },
      },
      rank: score,
      order: pageOrder * 1000 + index,
    });
  });

  SETTINGS_SEARCH_SCREENS.forEach((screen, index) => {
    const score = rank(trimmed, pattern, [screen.title], screen.keywords, [screen.description]);
    if (score === null) return;
    ranked.push({
      result: {
        key: screen.key,
        title: screen.title,
        breadcrumb: screen.breadcrumb,
        description: screen.description,
        route: screen.route,
      },
      rank: score,
      order: -1000 + index,
    });
  });

  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.result);
}
