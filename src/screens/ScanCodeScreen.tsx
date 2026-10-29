/**
 * Scan code (docs/2026-09-03/mobile-setup/mobile-03-scan.html): the one
 * scanner for Easy Connect and Tailscale codes. Camera behind a corner frame,
 * "Paste a code instead" and "Show me where it is" in the footer, a summary
 * card once a code is recognized. State lives in scan-code/useScanController;
 * the drawing over the camera in scan-code/ScannerOverlay.
 *
 * Camera permission denied → the paste sheet opens directly with a line that
 * says why. Back is disabled while pairing is in flight.
 *
 * On iOS the camera is Apple's scanner (scan-code/systemScanner.ts): it opens
 * over this screen once the camera is allowed, and "Open the scanner" brings it
 * back after it was closed or a code failed to pair.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

import PasteCodeSheet from '../components/onboarding/PasteCodeSheet';
import { useStackScreenRail } from '../components/common/verticalBar/stackRail';
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
import { useSystemScanner } from './scan-code/useSystemScanner';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanCode'>;

export default function ScanCodeScreen({ navigation, route }: Props) {
  const rePairMachineId = route.params?.rePairMachineId ?? null;
  const incomingCode = route.params?.incomingCode;
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
  const systemScanner = useSystemScanner(handlePayload);
  const systemScannerOpenedRef = useRef(false);

  // Apple's scanner opens by itself once, when the camera is allowed and nothing else is on screen.
  useEffect(() => {
    if (!systemScanner.active || systemScannerOpenedRef.current) return;
    if (!granted || phase.kind !== 'scanning' || sheet !== 'none' || incomingCode !== undefined) return;
    systemScannerOpenedRef.current = true;
    systemScanner.open();
  }, [systemScanner, granted, phase.kind, sheet, incomingCode]);

  // A pairing link the system camera opened the app with pairs like a scanned QR.
  useEffect(() => {
    if (incomingCode !== undefined) handlePayload(incomingCode.payload);
    // Only a new opening (a new `at`) routes again; the payload alone repeats for the same QR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCode?.at]);

  // Ask once; a refusal (or a permanently denied permission) opens the paste
  // sheet with the explanation line, which is the designed camera-less path.
  // Not while a link is pairing: the camera is only needed if it fails.
  useEffect(() => {
    if (permission === null || permission.granted || phase.kind !== 'scanning') return;
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
  }, [permission, requestPermission, setSheet, phase.kind]);

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
  // On the iPhone Duo, Help stands in the side bar under Back; the paste-code and password sheets take
  // the keyboard.
  useStackScreenRail(
    useMemo(
      () => ({
        entries: pairing
          ? []
          : [
              {
                key: 'help',
                label: ScanCopy.helpAccessibilityLabel,
                icon: (size: number) => <HelpCircleGlyph size={size} color={SetupPalette.FOREGROUND} />,
                onPress: () => setSheet('where'),
              },
            ],
        reserveKeyboard: true,
      }),
      [pairing, setSheet],
    ),
  );

  const onBarcode = (result: BarcodeScanningResult): void => {
    if (sheet !== 'none') return;
    // On Android `data` is ML Kit's display value, which can differ from the encoded text for a
    // link; `raw` is the text exactly as the computer encoded it.
    handlePayload(result.raw, result.data);
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
        {granted && !systemScanner.active ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={phase.kind === 'scanning' ? onBarcode : undefined}
          />
        ) : null}
        <ScannerOverlay
          frozen={phase.kind !== 'scanning'}
          status={status}
          toast={toast}
          showHint={granted && !systemScanner.active}
        />
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
            {granted && systemScanner.active ? (
              <SetupButton
                variant="primary"
                label={ScanCopy.openScanner}
                onPress={systemScanner.open}
                disabled={phase.kind !== 'scanning'}
              />
            ) : null}
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
