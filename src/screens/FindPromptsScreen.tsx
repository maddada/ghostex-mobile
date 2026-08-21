/**
 * Find Prompts — the GUI for `gx f` on the phone.
 *
 * Hosts the bundled shared Find page in a webview scoped to one machine, and
 * performs the two requests the page cannot: focusing a session that already
 * owns the selected conversation, and opening a new one for the command
 * gxserver resolved. Both land on the Terminal screen, so a result opens
 * exactly where the user would have opened it from the sessions list.
 */

import { useCallback } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { quickTerminalCommand } from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import FindPromptsWebView from '../find/FindPromptsWebView';
import type { FindPromptsHostAction } from '../find/find-prompts-bridge';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useTerminalStore } from '../terminal/sessions';

type Props = NativeStackScreenProps<RootStackParamList, 'FindPrompts'>;

export default function FindPromptsScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const machine = useMachinesStore((state) =>
    state.machines.find((candidate) => candidate.id === route.params.machineId),
  );

  const handleHostAction = useCallback(
    (action: FindPromptsHostAction): void => {
      if (machine === undefined) return;
      if (action.type === 'close') {
        navigation.goBack();
        return;
      }
      if (action.type === 'focusSession') {
        void useTerminalStore
          .getState()
          .attachSession(machine, {
            projectId: action.projectId,
            sessionId: action.sessionId,
          })
          .then((sessionKey) => {
            navigation.replace('Terminal', { machineId: machine.id, sessionKey });
          })
          .catch(() => undefined);
        return;
      }
      /*
       * A resumed or forked prompt runs as a quick terminal in its recorded
       * folder: the daemon registers or reuses the project there, which is what
       * lets the phone open a conversation from a folder it has never seen.
       */
      void runGhostexCli(
        machine,
        quickTerminalCommand(action.cwd, { command: action.command, title: action.title }),
      )
        .then(() => navigation.goBack())
        .catch(() => undefined);
    },
    [machine, navigation],
  );

  if (machine === undefined) {
    return <View style={styles.container} />;
  }
  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <FindPromptsWebView machine={machine} onHostAction={handleHostAction} visible />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0e0e0e',
    flex: 1,
  },
});
