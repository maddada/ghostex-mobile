/**
 * "Scan" affordance for the tailcat token field in the machine form: an icon
 * button that opens a full-screen camera scanner and hands back the pairing
 * token encoded in the QR code the desktop app shows in
 * Settings → Remote → Tailcat.
 *
 * The button owns its own camera permission and modal state so the form only
 * has to say what to do with a scanned token. Styling follows
 * docs/specs/sessions-drawer.md §0 like the rest of the machine form.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { MachineCopy } from '../../copy';
import { readTailcatQrPayload } from '../../machines/tailcatQr';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export type TailcatQrScanButtonProps = {
  /** Called once per scanning session with a validated tailcat pairing token. */
  onToken: (token: string) => void;
};

/** Scan-frame glyph, drawn in the stroke style of the sessions-drawer icons. */
function QrScanGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 9V6a2 2 0 0 1 2 -2h3 M15 4h3a2 2 0 0 1 2 2v3 M20 15v3a2 2 0 0 1 -2 2h-3 M9 20H6a2 2 0 0 1 -2 -2v-3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x={8} y={8} width={3.6} height={3.6} rx={0.8} stroke={color} strokeWidth={1.6} />
      <Rect x={12.4} y={12.4} width={3.6} height={3.6} rx={0.8} stroke={color} strokeWidth={1.6} />
      <Path
        d="M12.8 8.6h3.2 M8.6 12.8v3.2"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function TailcatQrScanButton({ onToken }: TailcatQrScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  // A Modal is its own native root, so `SafeAreaView` inside it measures against
  // the modal's view rather than the window and reports no top inset. The window
  // insets from the provider are the ones that matter here: the modal is
  // full-screen and status-bar-translucent on both platforms.
  const insets = useSafeAreaInsets();
  /** True once a QR code that is not a tailcat token has been seen this session. */
  const [sawForeignCode, setSawForeignCode] = useState(false);
  /** One token per scanning session: the camera keeps firing after the first hit. */
  const acceptedRef = useRef(false);
  /** The system prompt may only be shown once per open; a re-render must not re-ask. */
  const askedRef = useRef(false);

  const granted = permission?.granted === true;
  const canAsk = permission !== null && !permission.granted && permission.canAskAgain;

  useEffect(() => {
    if (!open || permission === null || permission.granted || !permission.canAskAgain) return;
    if (askedRef.current) return;
    askedRef.current = true;
    void requestPermission();
  }, [open, permission, requestPermission]);

  const close = (): void => {
    setOpen(false);
    setSawForeignCode(false);
    acceptedRef.current = false;
    askedRef.current = false;
  };

  const handleScan = (result: BarcodeScanningResult): void => {
    if (acceptedRef.current) return;
    const token = readTailcatQrPayload(result.data);
    if (token === null) {
      setSawForeignCode(true);
      return;
    }
    acceptedRef.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined,
    );
    onToken(token);
    close();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={MachineCopy.scanner.buttonAccessibilityLabel}
        style={({ pressed }) => [styles.scanButton, pressed ? styles.scanButtonPressed : null]}
        onPress={() => setOpen(true)}
      >
        <QrScanGlyph size={22} color={GhostexPalette.ACCENT} />
        <Text style={styles.scanButtonLabel}>{MachineCopy.scanner.buttonLabel}</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
        <View style={styles.screen}>
          {granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleScan}
            />
          ) : null}
          <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={styles.header}>
              <Text style={styles.title}>{MachineCopy.scanner.title}</Text>
              <Pressable accessibilityRole="button" hitSlop={10} onPress={close}>
                <Text style={styles.cancel}>{MachineCopy.scanner.cancel}</Text>
              </Pressable>
            </View>

            {permission === null ? (
              <View style={styles.centered}>
                <ActivityIndicator size="small" color={GhostexPalette.ACCENT} />
              </View>
            ) : granted ? (
              <>
                <View style={styles.frameArea}>
                  <View style={styles.frame} />
                </View>
                <Text style={styles.hint}>
                  {sawForeignCode
                    ? MachineCopy.scanner.foreignCode
                    : MachineCopy.scanner.aimHint}
                </Text>
              </>
            ) : (
              <View style={styles.centered}>
                <Text style={styles.deniedTitle}>{MachineCopy.scanner.deniedTitle}</Text>
                <Text style={styles.deniedBody}>
                  {canAsk ? MachineCopy.scanner.deniedRetry : MachineCopy.scanner.deniedSettings}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.primaryButton}
                  onPress={() => {
                    if (canAsk) void requestPermission();
                    else void Linking.openSettings().catch(() => undefined);
                  }}
                >
                  <Text style={styles.primaryButtonLabel}>
                    {canAsk
                      ? MachineCopy.scanner.allowButton
                      : MachineCopy.scanner.openSettingsButton}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scanButton: {
    width: 68,
    alignSelf: 'stretch',
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.CARD,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scanButtonPressed: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  scanButtonLabel: {
    color: GhostexPalette.ACCENT,
    fontSize: 12,
    fontWeight: '600',
  },
  screen: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  overlay: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 16,
    fontWeight: '600',
  },
  cancel: {
    color: GhostexPalette.ACCENT,
    fontSize: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  frameArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 236,
    height: 236,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: GhostexPalette.ACCENT,
    backgroundColor: 'transparent',
  },
  hint: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingBottom: 24,
  },
  deniedTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  deniedBody: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 6,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
  },
});
