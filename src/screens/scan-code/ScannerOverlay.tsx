/**
 * What is drawn over the camera on the scan screen: the corner frame with its moving scan line, and the short
 * box at the top for a code that is not Ghostex's.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { AlertTriangleGlyph, CheckGlyph } from '../../components/onboarding/SetupIcons';
import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import type { ScanToast } from './useScanController';

const FRAME_SIZE = 190;
const CORNER = 30;

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
  /** The corner frame and its scan line, over the live camera. */
  frame: boolean;
  /** The short box for a code that is not Ghostex's. */
  toast: ScanToast | null;
};

export default function ScannerOverlay({ frame, toast }: ScannerOverlayProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {frame ? (
        <View style={styles.frameArea}>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
            <ScanLine />
          </View>
        </View>
      ) : null}
      {toast !== null ? (
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
  frameArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
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
