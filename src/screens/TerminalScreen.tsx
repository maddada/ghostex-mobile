/**
 * PLACEHOLDER terminal screen (docs/specs/terminal-screen.md).
 * Renders the native terminal surface for the routed sessionKey; tab bar,
 * key accessory bar, and overlays are built by a follow-up agent.
 */

import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { GhostexTerminalView } from '../../modules/ghostex-native/src';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Terminal'>;

export default function TerminalScreen({ route }: Props) {
  const { sessionKey } = route.params;
  return (
    <View style={styles.container}>
      <GhostexTerminalView sessionKey={sessionKey} style={styles.terminal} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  terminal: {
    flex: 1,
  },
});
