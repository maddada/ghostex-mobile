/**
 * Scan the code: the one scanner for Easy Connect and Tailscale codes, as two steps in one card (on the
 * computer: Connect a phone; on this phone: the camera, inside step 2), then "Paste a code instead" and
 * "It won't scan" (CDXC:RemotePairing 2026-11-10 in copy.ts `ScanCopy`). Once a code is read the card says
 * "Found <computer> · Connecting…". State lives in scan-code/useScanController; the drawing over the camera
 * in scan-code/ScannerOverlay.
 *
 * Camera permission denied → the paste sheet opens directly with a line that
 * says why. Once a code is read, the screen becomes the waiting screen
 * (scan-code/PairingWaitView), and a pairing that fails stays on its failure
 * screen (scan-code/PairingFailureView). Back is disabled while pairing is in flight.
 *
 * On iOS the camera is Apple's scanner (scan-code/systemScanner.ts): it opens
 * over this screen once the camera is allowed, and the still tile in step 2 has
 * "Open the scanner" to bring it back. Android's camera runs inside step 2, with
 * a light button; Apple's scanner has none.
 */

import { useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GhostexRadii, GhostexStrokeWidth } from '../theme/palette';
import { useAppearance, type Appearance } from '../theme/useAppearance';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

import PasteCodeSheet from '../components/onboarding/PasteCodeSheet';
import { useStackScreenRail } from '../components/common/verticalBar/stackRail';
import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import SetupStepsSheet from '../components/onboarding/SetupStepsSheet';
import {
  BulbGlyph,
  CameraGlyph,
  CheckGlyph,
  DeviceDesktopGlyph,
  PasteGlyph,
} from '../components/onboarding/SetupIcons';
import { SetupButton, useSetupText } from '../components/onboarding/SetupPrimitives';
import TailscalePasswordSheet from '../components/onboarding/TailscalePasswordSheet';
import { remindSecurityNoticeLater, securityNoticeText } from '../app/securityNotice';
import { ScanCopy } from '../copy';
import { tailscaleCodeAddress } from '../machines/pairingCodes';
import type { RootStackParamList } from '../navigation/types';

import PairingFailureView from './scan-code/PairingFailureView';
import PairingWaitView from './scan-code/PairingWaitView';
import { failureText } from './scan-code/pairingFailure';
import ScannerOverlay from './scan-code/ScannerOverlay';
import { useScanController } from './scan-code/useScanController';
import { useSystemScanner } from './scan-code/useSystemScanner';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanCode'>;

export default function ScanCodeScreen({ navigation, route }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const setupText = useSetupText();
  const rePairMachineId = route.params?.rePairMachineId ?? null;
  const incomingCode = route.params?.incomingCode;
  const securityNotice = securityNoticeText(route.params?.securityNotice?.computers ?? []);
  const [permission, requestPermission] = useCameraPermissions();
  const askedRef = useRef(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  // "Paste a code" opens on the paste sheet; the camera is asked for only once that sheet is closed.
  const pasteFirst = route.params?.startWith === 'paste';
  const [cameraWanted, setCameraWanted] = useState(!pasteFirst);
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
    cancelPairing,
    scanAgain,
    pasteAfterFailure,
  } = useScanController(navigation, rePairMachineId, pasteFirst ? 'paste' : 'none');

  const granted = permission?.granted === true;
  const pairing = phase.kind === 'pairing';
  const systemScanner = useSystemScanner(handlePayload);
  // Apple's scanner does not jump over the screen after the paste sheet it opened on is closed.
  const systemScannerOpenedRef = useRef(pasteFirst);

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
    if (permission === null || permission.granted || phase.kind !== 'scanning' || !cameraWanted) return;
    // Opened on the paste sheet, a refusal does not open it again once the person closed it.
    if (!permission.canAskAgain) {
      setCameraDenied(true);
      if (!pasteFirst) setSheet('paste');
      return;
    }
    if (askedRef.current) return;
    askedRef.current = true;
    void requestPermission().then((result) => {
      if (result.granted) return;
      setCameraDenied(true);
      if (!pasteFirst) setSheet('paste');
    });
  }, [permission, requestPermission, setSheet, phase.kind, cameraWanted, pasteFirst]);

  // The three words get a screen of their own, as does a failure; until then the screen keeps its title.
  const ownScreen = (phase.kind === 'pairing' && phase.words !== undefined) || phase.kind === 'failed';
  useLayoutEffect(() => {
    navigation.setOptions({
      title: ownScreen ? '' : ScanCopy.title,
      headerBackVisible: !pairing,
      gestureEnabled: !pairing,
    });
  }, [navigation, pairing, ownScreen]);
  // The paste-code and password sheets take the keyboard on the iPhone Duo.
  useStackScreenRail(useMemo(() => ({ entries: [], reserveKeyboard: true }), []));
  const edges = useScrollToBarEdges(styles.content);

  const onBarcode = (result: BarcodeScanningResult): void => {
    if (sheet !== 'none') return;
    // On Android `data` is ML Kit's display value, which can differ from the encoded text for a
    // link; `raw` is the text exactly as the computer encoded it.
    handlePayload(result.raw, result.data);
  };

  // The in-app camera runs only where Apple's scanner does not; only it has a light.
  const liveCamera = granted && !systemScanner.active;
  const [lightOn, setLightOn] = useState(false);

  const found =
    phase.kind === 'pairing'
      ? { title: ScanCopy.found(phase.code.name), detail: ScanCopy.connecting, busy: true }
      : phase.kind === 'tailscale'
        ? {
            title: ScanCopy.found(phase.code.name),
            detail: ScanCopy.tailscaleFound(phase.code.user, tailscaleCodeAddress(phase.code)),
            busy: false,
          }
        : null;

  const cameraArea = liveCamera ? (
    <View style={styles.camera}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={lightOn}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={phase.kind === 'scanning' ? onBarcode : undefined}
      />
      <ScannerOverlay frame toast={toast} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={lightOn ? ScanCopy.lightOff : ScanCopy.lightOn}
        accessibilityState={{ selected: lightOn }}
        hitSlop={8}
        onPress={() => setLightOn((on) => !on)}
        style={[styles.light, lightOn ? styles.lightOn : null]}
      >
        <BulbGlyph size={20} color={lightOn ? '#111111' : '#ffffff'} />
      </Pressable>
    </View>
  ) : (
    <View style={[styles.camera, styles.stillTile]}>
      {granted && systemScanner.active ? (
        <>
          <CameraGlyph size={28} color={appearance.muted} />
          <Text style={[setupText.lede, setupText.center]}>{ScanCopy.stillTile}</Text>
          <SetupButton variant="primary" label={ScanCopy.openScanner} onPress={systemScanner.open} />
        </>
      ) : cameraDenied ? (
        <Text style={[setupText.lede, setupText.center]}>
          {ScanCopy.cameraOff}{' '}
          <Text style={setupText.accent} onPress={() => void Linking.openSettings().catch(() => undefined)}>
            {ScanCopy.cameraDeniedSettingsLink}
          </Text>
        </Text>
      ) : null}
      <ScannerOverlay frame={false} toast={toast} />
    </View>
  );

  const wontScanCopy = ScanCopy.wontScanSheet;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {phase.kind === 'pairing' && phase.words !== undefined ? (
        <PairingWaitView
          computer={phase.code.name}
          words={phase.words}
          giveUpAtMs={phase.giveUpAtMs}
          onCancel={cancelPairing}
        />
      ) : phase.kind === 'failed' ? (
        <PairingFailureView
          text={failureText(phase.failure)}
          onScanAgain={() => {
            scanAgain();
            if (granted && systemScanner.active) systemScanner.open();
          }}
          onPaste={pasteAfterFailure}
        />
      ) : (
        <ScrollView style={edges.scroll} contentContainerStyle={[styles.content, edges.content]}>
          {securityNotice !== null && phase.kind === 'scanning' ? (
            <View style={styles.notice}>
              <Text style={setupText.title}>{securityNotice.title}</Text>
              <Text style={setupText.lede}>{securityNotice.message}</Text>
            </View>
          ) : null}
          <View style={styles.card}>
            {found !== null ? (
              <View style={[styles.step, styles.stepLast]}>
                <CheckGlyph size={22} color={appearance.connected} />
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle}>{found.title}</Text>
                  <Text style={styles.stepDetail}>{found.detail}</Text>
                </View>
                {found.busy ? <ActivityIndicator size="small" color={appearance.muted} /> : null}
              </View>
            ) : (
              <>
                <View style={styles.step}>
                  <View style={styles.stepIcon}>
                    <DeviceDesktopGlyph size={18} color={appearance.accent} />
                  </View>
                  <View style={styles.stepText}>
                    <Text style={styles.stepTitle}>{ScanCopy.steps.computer.title}</Text>
                    <Text style={styles.stepDetail}>{ScanCopy.steps.computer.detail}</Text>
                  </View>
                </View>
                <View style={[styles.step, styles.stepLast]}>
                  <View style={styles.stepIcon}>
                    <CameraGlyph size={18} color={appearance.accent} />
                  </View>
                  <View style={styles.stepText}>
                    <Text style={styles.stepTitle}>{ScanCopy.steps.phone.title}</Text>
                    <Text style={styles.stepDetail}>{ScanCopy.steps.phone.detail}</Text>
                  </View>
                </View>
                <View style={styles.cameraWrap}>{cameraArea}</View>
              </>
            )}
          </View>
          <SetupButton
            large
            label={ScanCopy.pasteButton}
            icon={<PasteGlyph size={16} color={appearance.foreground} />}
            onPress={() => setSheet('paste')}
            disabled={phase.kind !== 'scanning'}
          />
          {phase.kind === 'scanning' ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setSheet('wontScan')} style={styles.link}>
              <Text style={styles.linkText}>{ScanCopy.wontScan}</Text>
            </Pressable>
          ) : null}
          {securityNotice !== null && phase.kind === 'scanning' ? (
            <>
              {securityNotice.others !== null ? (
                <Text style={[setupText.small, setupText.center]}>{securityNotice.others}</Text>
              ) : null}
              <SetupButton
                label="Remind me later"
                onPress={() => {
                  void remindSecurityNoticeLater().finally(() => navigation.goBack());
                }}
              />
            </>
          ) : null}
        </ScrollView>
      )}
      <PasteCodeSheet
        visible={sheet === 'paste'}
        cameraDenied={cameraDenied}
        onClose={() => {
          setSheet('none');
          setCameraWanted(true);
        }}
        onCode={routeCode}
      />
      <SetupStepsSheet
        visible={sheet === 'wontScan'}
        onClose={() => setSheet('none')}
        title={wontScanCopy.title}
        steps={[
          wontScanCopy.hold,
          {
            title: wontScanCopy.brightness.title,
            detail: liveCamera ? wontScanCopy.brightness.detailWithLight : wontScanCopy.brightness.detail,
          },
          wontScanCopy.stillNothing,
        ]}
        footer={
          <View style={styles.sheetFooter}>
            <SetupButton
              label={wontScanCopy.paste}
              icon={<PasteGlyph size={16} color={appearance.foreground} />}
              onPress={() => setSheet('paste')}
            />
            <Text style={[setupText.small, setupText.center]}>{wontScanCopy.olderComputer}</Text>
          </View>
        }
      />
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

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: appearance.background,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 16,
      gap: 14,
    },
    notice: {
      gap: 6,
    },
    card: {
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      borderRadius: GhostexRadii.section,
      overflow: 'hidden',
    },
    step: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: GhostexStrokeWidth,
      borderBottomColor: appearance.border,
    },
    stepLast: {
      borderBottomWidth: 0,
    },
    stepIcon: {
      width: 34,
      height: 34,
      borderRadius: 9,
      backgroundColor: appearance.cardActive,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepText: {
      flex: 1,
      gap: 2,
    },
    stepTitle: {
      color: appearance.foreground,
      fontSize: 15,
      fontWeight: '600',
    },
    stepDetail: {
      color: appearance.muted,
      fontSize: 13.5,
      lineHeight: 19,
    },
    cameraWrap: {
      paddingHorizontal: 14,
      paddingBottom: 14,
    },
    camera: {
      height: 340,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: '#050505',
    },
    // An iPhone's step 2 until an in-app camera that focuses close up is tried there: Apple's scanner opens over the screen.
    stillTile: {
      backgroundColor: appearance.input,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      paddingHorizontal: 24,
    },
    light: {
      position: 'absolute',
      right: 12,
      bottom: 12,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    lightOn: {
      backgroundColor: '#ffffff',
    },
    link: {
      alignSelf: 'center',
    },
    linkText: {
      color: appearance.accent,
      fontSize: 14,
      fontWeight: '500',
      paddingVertical: 4,
    },
    sheetFooter: {
      gap: 12,
    },
  });
