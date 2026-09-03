/**
 * The `SshAccessHelp` route: the same per-OS "turn on SSH access" content the
 * bottom sheet shows, as a full screen with the OS buttons on top, for deep
 * links and for surfaces that have no sheet host of their own.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SshAccessHelpContent,
  SshOsButtons,
  type SshOs,
} from '../components/onboarding/SshAccessHelpSheet';
import type { RootStackParamList } from '../navigation/types';
import { SetupPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'SshAccessHelp'>;

export default function SshAccessHelpScreen({ route }: Props) {
  const [os, setOs] = useState<SshOs>(route.params?.platform ?? 'macos');
  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <SshOsButtons current={os} onSelect={setOs} />
        <View style={styles.body}>
          <SshAccessHelpContent os={os} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: SetupPalette.PAGE,
  },
  content: {
    padding: 16,
    gap: 20,
  },
  body: {
    paddingHorizontal: 2,
  },
});
