import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation/types';
import AdvancedPage from './AdvancedPage';
import ChatPage from './ChatPage';
import ConnectionPage from './ConnectionPage';
import KeyboardPage from './KeyboardPage';
import SoundsPage from './SoundsPage';
import TerminalPage from './TerminalPage';
import ThemePage from './ThemePage';
import UpdatesPage from './UpdatesPage';

/** One Settings page, chosen by the `SettingsPage` route's `page` param. */
export default function SettingsPageScreen({ route }: NativeStackScreenProps<RootStackParamList, 'SettingsPage'>) {
  switch (route.params.page) {
    case 'updates':
      return <UpdatesPage />;
    case 'theme':
      return <ThemePage />;
    case 'chat':
      return <ChatPage />;
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
  }
}
