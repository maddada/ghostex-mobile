/**
 * Choose how to connect (docs/2026-09-03/mobile-setup/mobile-02-choose.html):
 * two PathCards described by what the user will do. "Scan code" on either
 * card opens the one scanner (it tells the two codes apart); "Or type the
 * details" opens the Tailscale form.
 */

import { useMemo } from 'react';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import PathCard from '../components/onboarding/PathCard';
import { CameraGlyph, QrcodeGlyph, ShieldGlyph, SparklesGlyph } from '../components/onboarding/SetupIcons';
import { useSetupText } from '../components/onboarding/SetupPrimitives';
import { ConnectChooseCopy } from '../copy';
import { DemoCopy } from '../demo/copy';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';


type Props = NativeStackScreenProps<RootStackParamList, 'ConnectChoose'>;

export default function ConnectChooseScreen({ navigation }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const setupText = useSetupText();
  const openScanner = (): void => navigation.navigate('ScanCode');
  const openDemo = (): void => {
    const hadMachines = useMachinesStore.getState().machines.length > 0;
    useMachinesStore.getState().addDemoComputer();
    if (hadMachines) navigation.navigate('Sessions');
  };
  // The page reaches under the iPhone Duo's side bar, its content keeps clear of it.
  const edges = useScrollToBarEdges(styles.content);
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={edges.scroll} contentContainerStyle={[styles.content, edges.content]}>
        <View style={styles.intro}>
          <Text style={setupText.eyebrow}>{ConnectChooseCopy.eyebrow}</Text>
          <Text style={setupText.titleLg}>{ConnectChooseCopy.title}</Text>
          <Text style={setupText.lede}>{ConnectChooseCopy.lede}</Text>
        </View>

        <View style={styles.cards}>
          <PathCard
            icon={<SparklesGlyph size={20} color={appearance.accent} />}
            title={DemoCopy.entryTitle}
            subtitle={DemoCopy.entrySubtitle}
            footNote="On this phone"
            button={{ label: DemoCopy.entryButton, onPress: openDemo }}
          />
          <PathCard
            recommended
            icon={<QrcodeGlyph size={20} color={appearance.accent} />}
            title={ConnectChooseCopy.easyConnect.title}
            tag={ConnectChooseCopy.easyConnect.tag}
            subtitle={ConnectChooseCopy.easyConnect.subtitle}
            steps={ConnectChooseCopy.easyConnect.steps}
            footNote={ConnectChooseCopy.easyConnect.duration}
            button={{
              label: ConnectChooseCopy.easyConnect.button,
              icon: <CameraGlyph size={14} color={appearance.accentForeground} />,
              onPress: openScanner,
            }}
          />
          <PathCard
            icon={<ShieldGlyph size={20} color={appearance.foreground} />}
            title={ConnectChooseCopy.tailscale.title}
            subtitle={ConnectChooseCopy.tailscale.subtitle}
            footLink={{
              label: ConnectChooseCopy.tailscale.typeDetailsLink,
              onPress: () => navigation.navigate('TailscaleForm'),
            }}
            button={{
              label: ConnectChooseCopy.tailscale.button,
              icon: <CameraGlyph size={14} color={appearance.foreground} />,
              onPress: openScanner,
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appearance.background,
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
