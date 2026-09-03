/**
 * Choose how to connect (docs/2026-09-03/mobile-setup/mobile-02-choose.html):
 * two PathCards described by what the user will do. "Scan code" on either
 * card opens the one scanner (it tells the two codes apart); "Or type the
 * details" opens the Tailscale form.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import PathCard from '../components/onboarding/PathCard';
import { CameraGlyph, QrcodeGlyph, ShieldGlyph } from '../components/onboarding/SetupIcons';
import { setupText } from '../components/onboarding/SetupPrimitives';
import { ConnectChooseCopy } from '../copy';
import type { RootStackParamList } from '../navigation/types';
import { SetupPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'ConnectChoose'>;

export default function ConnectChooseScreen({ navigation }: Props) {
  const openScanner = (): void => navigation.navigate('ScanCode');
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text style={setupText.eyebrow}>{ConnectChooseCopy.eyebrow}</Text>
          <Text style={setupText.titleLg}>{ConnectChooseCopy.title}</Text>
          <Text style={setupText.lede}>{ConnectChooseCopy.lede}</Text>
        </View>

        <View style={styles.cards}>
          <PathCard
            recommended
            icon={<QrcodeGlyph size={20} color={SetupPalette.ACCENT} />}
            title={ConnectChooseCopy.easyConnect.title}
            tag={ConnectChooseCopy.easyConnect.tag}
            subtitle={ConnectChooseCopy.easyConnect.subtitle}
            steps={ConnectChooseCopy.easyConnect.steps}
            footNote={ConnectChooseCopy.easyConnect.duration}
            button={{
              label: ConnectChooseCopy.easyConnect.button,
              icon: <CameraGlyph size={14} color={SetupPalette.PRIMARY_BUTTON_FOREGROUND} />,
              onPress: openScanner,
            }}
          />
          <PathCard
            icon={<ShieldGlyph size={20} color={SetupPalette.FOREGROUND} />}
            title={ConnectChooseCopy.tailscale.title}
            subtitle={ConnectChooseCopy.tailscale.subtitle}
            footLink={{
              label: ConnectChooseCopy.tailscale.typeDetailsLink,
              onPress: () => navigation.navigate('TailscaleForm'),
            }}
            button={{
              label: ConnectChooseCopy.tailscale.button,
              icon: <CameraGlyph size={14} color={SetupPalette.FOREGROUND} />,
              onPress: openScanner,
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SetupPalette.PAGE,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 24,
  },
  intro: {
    gap: 6,
  },
  cards: {
    marginTop: 22,
    gap: 12,
  },
});
