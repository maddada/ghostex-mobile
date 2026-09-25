/**
 * Settings home: one row per Settings page, each with a one-line summary.
 * The pages themselves live in `./settings/` and open through the
 * `SettingsPage` route.
 *
 * CDXC:Settings 2026-09-25 DECISION: User (2026-09-25): "i want settings to be affected by selected colors the and to make contrast a slider and i want to have pages for settings and to move all the ″might be useless″ settings to advanced page (bunch of legacy settings there)". Settings is a home list of pages (Updates, Theme, Chat, Terminal, Keyboard, Sounds, Connection, Advanced), named after the desktop Settings where one exists. Advanced holds the settings carried over from the older Android app and the ones almost nobody changes (legacy terminal toggles, cursor, scrollback, terminal bell, the Web chat view and its font, the transcript width, sessions list opacity, SSH keep-alive); every setting keeps its stored key and behavior. Background Contrast is a slider, and every Settings page follows the Background Tint and Contrast.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { availableUpdate, useAndroidSelfUpdateStore } from '../updates/androidSelfUpdateStore';
import { SETTINGS_PAGE_ORDER, SETTINGS_PAGES } from './settings/pages';
import { LinkRow, SettingsScreenLayout } from './settings/SettingsControls';

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const updateVersion = useAndroidSelfUpdateStore((state) => availableUpdate(state.check)?.version ?? null);

  return (
    <SettingsScreenLayout>
      {SETTINGS_PAGE_ORDER.map((page) => {
        const updateAvailable = page === 'updates' && updateVersion !== null;
        return (
          <LinkRow
            key={page}
            title={SETTINGS_PAGES[page].title}
            description={updateAvailable ? `Update available: Ghostex ${updateVersion}` : SETTINGS_PAGES[page].description}
            descriptionAccent={updateAvailable}
            onPress={() => navigation.navigate('SettingsPage', { page })}
          />
        );
      })}
    </SettingsScreenLayout>
  );
}
