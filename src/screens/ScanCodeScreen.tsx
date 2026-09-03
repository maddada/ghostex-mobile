/**
 * Scan code (docs/2026-09-03/mobile-setup/mobile-03-scan.html): the one
 * scanner for Easy Connect and Tailscale codes. Camera behind a corner frame,
 * "Paste a code instead" and "Show me where it is" in the footer, a summary
 * card once a code is recognized. State lives in scan-code/useScanController;
 * the drawing over the camera in scan-code/ScannerOverlay.
 *
 * Camera permission denied → the paste sheet opens directly with a line that
 * says why. Back is disabled while pairing is in flight.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

import PasteCodeSheet from '../components/onboarding/PasteCodeSheet';
import { HelpCircleGlyph, PasteGlyph } from '../components/onboarding/SetupIcons';
import { SetupButton, SetupRow, SetupRows, setupText } from '../components/onboarding/SetupPrimitives';
import TailscalePasswordSheet from '../components/onboarding/TailscalePasswordSheet';
import WhereIsCodeSheet from '../components/onboarding/WhereIsCodeSheet';
import { ScanCopy } from '../copy';
import { tailscaleCodeAddress } from '../machines/pairingCodes';
import type { RootStackParamList } from '../navigation/types';
import { SetupPalette } from '../theme/palette';
import ScannerOverlay from './scan-code/ScannerOverlay';
import { useScanController } from './scan-code/useScanController';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanCode'>;

export default function ScanCodeScreen({ navigation, route }: Props) {
  const rePairMachineId = route.params?.rePairMachineId ?? null;
  const [permission, requestPermission] = useCameraPermissions();
  const askedRef = useRef(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const {
    phase,
    toast,
    sheet,
    setSheet,
    handlePayload,
    routeCode,
    tailscaleBusy,
    tailscaleError,
    saveTailscale,
    dismissTailscale,
  } = useScanController(navigation, rePairMachineId);

  const granted = permission?.granted === true;
  const pairing = phase.kind === 'pairing';

  // Ask once; a refusal (or a permanently denied permission) opens the paste
  // sheet with the explanation line, which is the designed camera-less path.
  useEffect(() => {
    if (permission === null || permission.granted) return;
    if (!permission.canAskAgain) {
      setCameraDenied(true);
      setSheet('paste');
      return;
    }
    if (askedRef.current) return;
    askedRef.current = true;
    void requestPermission().then((result) => {
      if (result.granted) return;
      setCameraDenied(true);
      setSheet('paste');
    });
  }, [permission, requestPermission, setSheet]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: ScanCopy.title,
      headerBackVisible: !pairing,
      gestureEnabled: !pairing,
      headerRight: () =>
        pairing ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ScanCopy.helpAccessibilityLabel}
            hitSlop={10}
            onPress={() => setSheet('where')}
          >
            <HelpCircleGlyph size={22} color={SetupPalette.FOREGROUND} />
          </Pressable>
        ),
    });
  }, [navigation, pairing, setSheet]);

  const onBarcode = (result: BarcodeScanningResult): void => {
    if (sheet !== 'none') return;
    handlePayload(result.data);
  };

  const status =
    phase.kind === 'pairing'
      ? {
          icon: 'spinner' as const,
          title: ScanCopy.found(phase.code.name),
          detail: ScanCopy.pairingAs(phase.code.user),
        }
      : phase.kind === 'tailscale'
        ? {
            icon: 'check' as const,
            title: ScanCopy.found(phase.code.name),
            detail: ScanCopy.tailscaleFound(phase.code.user, tailscaleCodeAddress(phase.code)),
          }
        : null;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.viewfinder}>
        {granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={phase.kind === 'scanning' ? onBarcode : undefined}
          />
        ) : null}
        <ScannerOverlay frozen={phase.kind !== 'scanning'} status={status} toast={toast} showHint={granted} />
      </View>

      <View style={styles.footer}>
        {phase.kind === 'pairing' ? (
          <SetupRows panel>
            <SetupRow first label={ScanCopy.summary.computer} value={phase.code.name} />
            <SetupRow mono label={ScanCopy.summary.user} value={phase.code.user} />
            <SetupRow label={ScanCopy.summary.connection} value={ScanCopy.summary.easyConnect} />
          </SetupRows>
        ) : (
          <>
            <SetupButton
              label={ScanCopy.pasteButton}
              icon={<PasteGlyph size={16} color={SetupPalette.FOREGROUND} />}
              onPress={() => setSheet('paste')}
              disabled={phase.kind !== 'scanning'}
            />
            <Text style={[setupText.small, setupText.dim, setupText.center]}>
              {ScanCopy.cantFindPrefix}
              <Text style={setupText.accent} onPress={() => setSheet('where')}>
                {ScanCopy.cantFindLink}
              </Text>
            </Text>
          </>
        )}
      </View>

      <PasteCodeSheet
        visible={sheet === 'paste'}
        cameraDenied={cameraDenied}
        onClose={() => setSheet('none')}
        onCode={routeCode}
      />
      <WhereIsCodeSheet visible={sheet === 'where'} onClose={() => setSheet('none')} />
      <TailscalePasswordSheet
        code={phase.kind === 'tailscale' ? phase.code : null}
        busy={tailscaleBusy}
        error={tailscaleError}
        onClose={dismissTailscale}
        onSave={(password) => void saveTailscale(password)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SetupPalette.PAGE,
  },
  viewfinder: {
    flex: 1,
    backgroundColor: '#050505',
    overflow: 'hidden',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
    backgroundColor: SetupPalette.PAGE,
  },
});
