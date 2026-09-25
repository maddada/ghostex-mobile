import { useCallback } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { docPathFromFileUrl } from '../docs/openDoc';
import type { RootStackParamList } from '../navigation/types';
import { webPreviewTargetForUrl } from './routing';

/**
 * CDXC:Browser 2026-09-12 DECISION:
 * User: localhost links on Android and iOS open in the embedded browser, where the computer's port is reachable.
 * Chat and both native terminal link events share this routing.
 *
 * A `file://` link to a Markdown or HTML file (an agent's terminal hyperlink) names a file on the
 * computer, so it opens in the Docs viewer instead of asking the phone for an app.
 */
export function useOpenMachineLink() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useCallback((machineId: string, url: string): void => {
    const doc = docPathFromFileUrl(url);
    if (doc !== null) {
      navigation.push('DocViewer', { machineId, ...doc });
      return;
    }
    const target = webPreviewTargetForUrl(url);
    if (target !== null) {
      navigation.navigate('WebPreview', { machineId, ...target });
      return;
    }
    void Linking.openURL(url).catch(() => undefined);
  }, [navigation]);
}
