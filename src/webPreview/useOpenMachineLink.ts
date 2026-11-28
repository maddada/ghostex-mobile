import { useCallback } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { chatIsLightNow } from '../chat/native/transcript/theme';
import { DocsCopy } from '../copy';
import { openComputerFile } from '../docs/openComputerFile';
import type { RootStackParamList } from '../navigation/types';
import { classifyMachineLink, withPageTheme } from './machineLinks';
import { showAlert } from '../components/common/dialog/alert';

export type OpenMachineLinkOptions = {
  /** The session's project, whose file link reads a video, audio, PDF or drawing the link names. */
  projectId?: string;
  /** Shows what opening a computer file reports (`openComputerFile`) instead of an alert. */
  notify?: (message: string, error: boolean, title?: string) => void;
};

/**
 * CDXC:Browser 2026-09-12 DECISION:
 * User: localhost links on Android and iOS open in the embedded browser, where the computer's port is reachable.
 * Chat and both native terminal link events share this routing.
 *
 * What a link names is decided once, in `machineLinks.ts`: an address on the computer's loopback
 * opens in the Web preview through a forward (a page the computer's gxserver published shares the
 * chat's forward and follows the chat's theme), a `file://` link opens the computer's file in the
 * file viewer, and only an internet address goes to the phone's browser.
 */
export function useOpenMachineLink() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useCallback(
    (machineId: string, url: string, options: OpenMachineLinkOptions = {}): void => {
      const link = classifyMachineLink(url);
      if (link.kind === 'file') {
        openComputerFile(navigation, machineId, link.path, {
          ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
          ...(link.fragment !== undefined ? { fragment: link.fragment } : {}),
          notify:
            options.notify ??
            ((message, error, title) => {
              // Progress needs no alert; a copied path or a failure does.
              if (error || title !== undefined) showAlert(title ?? DocsCopy.openFailed, message);
            }),
        });
        return;
      }
      if (link.kind === 'computer') {
        const { scheme, remotePort, host, path } = link.address;
        const theme = chatIsLightNow() ? 'light' : 'dark';
        navigation.navigate('WebPreview', { machineId, scheme, remotePort, host, path: withPageTheme(path, theme) });
        return;
      }
      void Linking.openURL(link.url).catch(() => undefined);
    },
    [navigation],
  );
}
