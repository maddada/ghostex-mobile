import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation/types';
import DemoSettingsPage from '../../demo/DemoSettingsPage';
import AdvancedPage from './AdvancedPage';
import AutopilotPage from './AutopilotPage';
import CollabPage from './CollabPage';
import ChatPage from './ChatPage';
import ConnectionPage from './ConnectionPage';
import DictateLanguagePage from './DictateLanguagePage';
import KeyboardPage from './KeyboardPage';
import NotificationsPage from './NotificationsPage';
import LiveActivityPage from './LiveActivityPage';
import LicencesPage from './LicencesPage';
import { SETTINGS_PAGES, type SettingsPageId } from './pages';
import ReadAloudVoicePage from './ReadAloudVoicePage';
import { SettingsColumnsFrame } from './SettingsColumns';
import { SettingsPageIntro } from './SettingsControls';
import SessionsListPage from './SessionsListPage';
import ShortRepliesPage from './ShortRepliesPage';
import SyncPage from './SyncPage';
import TerminalPage from './TerminalPage';
import { SettingsPageBoundary } from './SectionBoundary';
import TerminalPalettePage from './TerminalPalettePage';
import ThemePage from './ThemePage';
import UpdatesPage from './UpdatesPage';
import VoicePage from './VoicePage';

/** One Settings page, chosen by the `SettingsPage` route's `page` param; beside the list in two columns. */
export default function SettingsPageScreen({ route }: NativeStackScreenProps<RootStackParamList, 'SettingsPage'>) {
  const { page } = route.params;
  return (
    <SettingsColumnsFrame title={SETTINGS_PAGES[page].title}>
      <SettingsPageContent page={page} />
    </SettingsColumnsFrame>
  );
}

/** A Settings page's content; a page that throws leaves the rest of Settings usable (the boundary resets per page). */
export function SettingsPageContent({ page }: { page: SettingsPageId }) {
  return (
    <SettingsPageBoundary key={page} name={`settings:${page}`}>
      <SettingsPageIntro.Provider value={SETTINGS_PAGES[page].description}>
        <SettingsPageBody page={page} />
      </SettingsPageIntro.Provider>
    </SettingsPageBoundary>
  );
}

function SettingsPageBody({ page }: { page: SettingsPageId }) {
  switch (page) {
    case 'updates':
      return <UpdatesPage />;
    case 'theme':
      return <ThemePage />;
    case 'sessionsList':
      return <SessionsListPage />;
    case 'chat':
      return <ChatPage />;
    case 'voice':
      return <VoicePage />;
    case 'terminal':
      return <TerminalPage />;
    case 'keyboard':
      return <KeyboardPage />;
    case 'shortReplies':
      return <ShortRepliesPage />;
    case 'notifications':
      return <NotificationsPage />;
    case 'liveActivity':
      return <LiveActivityPage />;
    case 'connection':
      return <ConnectionPage />;
    case 'sync':
      return <SyncPage />;
    case 'autopilot':
      return <AutopilotPage />;
    case 'collab':
      return <CollabPage />;
    case 'advanced':
      return <AdvancedPage />;
    case 'demo':
      return <DemoSettingsPage />;
    case 'readAloudVoice':
      return <ReadAloudVoicePage />;
    case 'dictateLanguage':
      return <DictateLanguagePage />;
    case 'terminalPaletteDark':
      return <TerminalPalettePage dark />;
    case 'terminalPaletteLight':
      return <TerminalPalettePage dark={false} />;
    case 'licences':
      return <LicencesPage />;
  }
}
