/**
 * Add a computer (the sessions screen's + and its menu): the first screen's connect steps without the app's
 * name and without the demo, Scan the code, and "Other ways to connect" (Paste a code, Use Tailscale). The route
 * keeps its old name, ConnectChoose: it replaced the "How does your phone reach your computer?" chooser.
 */

import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import { ConnectActions, ConnectSteps } from '../components/onboarding/ConnectStart';
import type { RootStackParamList } from '../navigation/types';
import { useAppearance, type Appearance } from '../theme/useAppearance';

type Props = NativeStackScreenProps<RootStackParamList, 'ConnectChoose'>;

export default function ConnectChooseScreen({ navigation }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  // The page reaches under the iPhone Duo's side bar, its content keeps clear of it.
  const edges = useScrollToBarEdges(styles.content);
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={edges.scroll} contentContainerStyle={[styles.content, edges.content]}>
        <ConnectSteps />
      </ScrollView>
      <View style={styles.footer}>
        <ConnectActions
          onScan={() => navigation.navigate('ScanCode')}
          onPaste={() => navigation.navigate('ScanCode', { startWith: 'paste' })}
          onTailscale={() => navigation.navigate('TailscaleForm')}
        />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: appearance.background,
    },
    content: {
      paddingHorizontal: 24,
      paddingTop: 20,
      paddingBottom: 24,
    },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
    },
  });
