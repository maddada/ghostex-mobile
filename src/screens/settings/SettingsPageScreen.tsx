import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation/types';
import AdvancedPage from './AdvancedPage';
import ChatPage from './ChatPage';
import ConnectionPage from './ConnectionPage';
import KeyboardPage from './KeyboardPage';
import { SETTINGS_PAGES, type SettingsPageId } from './pages';
import ReadAloudVoicePage from './ReadAloudVoicePage';
import { SettingsColumnsFrame } from './SettingsColumns';
import SoundsPage from './SoundsPage';
import TerminalPage from './TerminalPage';
import { SettingsPageBoundary } from './SectionBoundary';
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
      <SettingsPageBody page={page} />
    </SettingsPageBoundary>
  );
}

function SettingsPageBody({ page }: { page: SettingsPageId }) {
  switch (page) {
    case 'updates':
      return <UpdatesPage />;
    case 'theme':
      return <ThemePage />;
    case 'chat':
      return <ChatPage />;
    case 'voice':
      return <VoicePage />;
    case 'terminal':
      return <TerminalPage />;
    case 'keyboard':
      return <KeyboardPage />;
    case 'sounds':
      return <SoundsPage />;
    case 'connection':
      return <ConnectionPage />;
    case 'advanced':
      return <AdvancedPage />;
    case 'readAloudVoice':
      return <ReadAloudVoicePage />;
  }
}
