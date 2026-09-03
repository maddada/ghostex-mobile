/**
 * What is drawn over the camera on the Scan code screen: the corner frame with
 * its moving scan line, the hint under it, the dimmed "frozen" state once a
 * code is recognized, and the toast at the top (`.viewfinder` in
 * mobile-03-scan.html).
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { AlertTriangleGlyph, CheckGlyph, LoaderGlyph } from '../../components/onboarding/SetupIcons';
import { ScanCopy } from '../../copy';
import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import type { ScanToast } from './useScanController';

const FRAME_SIZE = 220;
const CORNER = 30;

function Spinner() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <LoaderGlyph size={20} color={SetupPalette.ACCENT} />
    </Animated.View>
  );
}

function ScanLine() {
  const position = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(position, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(position, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [position]);
  const translateY = position.interpolate({
    inputRange: [0, 1],
    outputRange: [FRAME_SIZE * 0.08, FRAME_SIZE * 0.92],
  });
  return <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />;
}

export type ScannerOverlayProps = {
  /** True once a code is recognized: dims the camera and stops the scan line. */
  frozen: boolean;
  /** Persistent toast while frozen (spinner or check), or the transient error toast. */
  status: { icon: 'spinner' | 'check'; title: string; detail: string } | null;
  toast: ScanToast | null;
  /** Hidden while the camera is unavailable (the paste sheet is open instead). */
  showHint: boolean;
};

export default function ScannerOverlay({ frozen, status, toast, showHint }: ScannerOverlayProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {frozen ? <View style={styles.dim} /> : null}
      <View style={styles.frameArea}>
        <View style={[styles.frame, frozen ? styles.frameFrozen : null]}>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
          {frozen ? null : <ScanLine />}
        </View>
      </View>
      {showHint && !frozen ? <Text style={styles.hint}>{ScanCopy.hint}</Text> : null}

      {status !== null ? (
        <View style={styles.toast}>
          {status.icon === 'spinner' ? <Spinner /> : <CheckGlyph size={20} color={SetupPalette.OK} />}
          <View style={styles.toastText}>
            <Text style={styles.toastTitle}>{status.title}</Text>
            <Text style={styles.toastDetail}>{status.detail}</Text>
          </View>
        </View>
      ) : toast !== null ? (
        <View style={[styles.toast, toast.tone === 'error' ? styles.toastError : null]}>
          {toast.tone === 'error' ? (
            <AlertTriangleGlyph size={20} color={SetupPalette.ERROR} />
          ) : (
            <CheckGlyph size={20} color={SetupPalette.OK} />
          )}
          <View style={styles.toastText}>
            <Text style={styles.toastTitle}>{toast.title}</Text>
            {toast.detail !== undefined ? <Text style={styles.toastDetail}>{toast.detail}</Text> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  frameArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
  },
  frameFrozen: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: SetupPalette.OK,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: SetupPalette.ACCENT,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 6,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 6,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 6,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 6,
  },
  scanLine: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: 0,
    height: 2,
    backgroundColor: SetupPalette.ACCENT,
    opacity: 0.85,
  },
  hint: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER_STRONG,
    backgroundColor: 'rgba(20,20,20,0.92)',
  },
  toastError: {
    borderColor: SetupPalette.ERROR_BORDER,
  },
  toastText: {
    flex: 1,
    gap: 2,
  },
  toastTitle: {
    color: SetupPalette.FOREGROUND,
    fontSize: 13,
    fontWeight: '600',
  },
  toastDetail: {
    color: SetupPalette.MUTED,
    fontSize: 12.5,
    lineHeight: 17,
  },
});
