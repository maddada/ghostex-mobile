/**
 * Settings home: one row per Settings page, each with a one-line summary.
 * The pages themselves live in `./settings/` and open through the
 * `SettingsPage` route. On the iPhone Duo's inner display in landscape the
 * list stands beside the first page instead (`SettingsColumnsFrame`).
 *
 * CDXC:Settings 2026-09-25 DECISION: User (2026-09-25): "i want settings to be affected by selected colors the and to make contrast a slider and i want to have pages for settings and to move all the ″might be useless″ settings to advanced page (bunch of legacy settings there)". Settings is a home list of pages (Updates, Theme, Chat, Terminal, Keyboard, Sounds, Connection, Advanced), named after the desktop Settings where one exists. Advanced holds the settings carried over from the older Android app and the ones almost nobody changes (legacy terminal toggles, cursor, scrollback, terminal bell, the Web chat view and its font, the transcript width, sessions list opacity, SSH keep-alive); every setting keeps its stored key and behavior. Background Contrast is a slider, and every Settings page follows the Background Tint and Contrast.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { SETTINGS_PAGES } from './settings/pages';
import { SettingsColumnsFrame, SettingsPageList } from './settings/SettingsColumns';
import { DEFAULT_SETTINGS_PAGE } from './settings/columnRules';
import { SettingsScreenLayout } from './settings/SettingsControls';
import { SettingsPageContent } from './settings/SettingsPageScreen';

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <SettingsColumnsFrame
      title={SETTINGS_PAGES[DEFAULT_SETTINGS_PAGE].title}
      single={
        <SettingsScreenLayout>
          <SettingsPageList onOpen={(page) => navigation.navigate('SettingsPage', { page })} />
        </SettingsScreenLayout>
      }
    >
      <SettingsPageContent page={DEFAULT_SETTINGS_PAGE} />
    </SettingsColumnsFrame>
  );
}
