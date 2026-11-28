/**
 * The shell every Ghostex dialog draws in: a bottom sheet over a blurred and dimmed screen. `showAlert()` questions,
 * `ConfirmDialog`, `PromptDialog` and `ActionSheet` all put their content in it, so they look the same on Android
 * and iOS.
 *
 * CDXC:PhoneDialogs 2026-11-28 DECISION:
 * User, picking from the dialogs page: a bottom sheet (not a centred card), the screen behind blurred and dimmed
 * (dim only where blur is not available or Reduce Transparency is on), Back and a tap outside acting as Cancel.
 * On wide windows ("watch out for foldable phones that are opened or landscape then we shouldn't make this get
 * super wide") the sheet keeps `WIDE_MAX_WIDTH`, centred, floating `FLOAT_GAP` above the bottom edge with all four
 * corners rounded; on a portrait phone it spans the width from the bottom edge. Safe areas and the keyboard are
 * respected in both.
 *
 * WHY no blur behind it on Android: expo-blur blurs only a `BlurTargetView` in the same window, and a Modal is
 * its own window there, so Android gets the dim alone and a solid panel (the same look, without the frost).
 *
 * `inline` draws it without a Modal of its own, inside whichever Modal is already open (`AlertOutlet`): iOS presents
 * a React Native Modal from the root view controller, which cannot present a second one while a sheet is up.
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppearance, type Appearance } from '../../../theme/useAppearance';
import { GhostexRadii, mixHexColors } from '../../../theme/palette';
import { useFoldSheetMaxHeight } from '../foldAvoidance';
import { useKeyboardTop } from '../keyboard/keyboardFrame';
import KeyboardAvoidingContainer from '../keyboard/KeyboardAvoidingContainer';
import { useReduceMotion } from '../reduceMotion';
import { useReduceTransparency } from '../reduceTransparency';
import { useGrabberDrag } from '../useGrabberDrag';
import { useSheetPresence } from '../useSheetPresence';
import { useVerticalBarSpace } from '../verticalBar/VerticalBarArea';

/** From this window width up (an unfolded foldable, a landscape phone, a tablet) the sheet floats at `WIDE_MAX_WIDTH`. */
export const WIDE_WINDOW_MIN_WIDTH = 560;
/** The floating sheet's width limit on a wide window. */
export const WIDE_MAX_WIDTH = 480;
/** How far the floating sheet stands above the bottom safe area. */
const FLOAT_GAP = 16;
const RADIUS = GhostexRadii.section;

export type DialogSheetProps = {
  visible: boolean;
  /** Back, a tap outside or a drag down on the grabber. */
  onDismiss: () => void;
  /** The sheet has finished leaving (on iOS, once its Modal is dismissed). */
  onClosed?: () => void;
  /** Draw inside the Modal that is already open instead of in a Modal of its own (`AlertOutlet`). */
  inline?: boolean;
  /** Android's Back for the Modal, when it should do more than `onDismiss` (`HostedDialogSheet`). */
  onRequestClose?: () => void;
  /** The Modal has been presented (not called when `inline`). */
  onShow?: () => void;
  /** Drawn over everything in the Modal, after the sheet: an `AlertOutlet` (`HostedDialogSheet`). */
  overlay?: ReactNode;
  /** Read out for the sheet as a whole by screen readers: its title. */
  accessibilityLabel?: string;
  children: ReactNode;
};

/** Whether the window is wide enough for the floating sheet. */
export function useDialogSheetIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_WINDOW_MIN_WIDTH;
}

/** The panel's solid fill: Android's (no blur there) and iOS's with Reduce Transparency on. */
export function dialogSolidFill(appearance: Appearance): string {
  return appearance.light ? '#ffffff' : mixHexColors('#ffffff', appearance.background, 9);
}

export default function DialogSheet({
  visible,
  onDismiss,
  onClosed,
  inline = false,
  onRequestClose = onDismiss,
  onShow,
  overlay,
  accessibilityLabel,
  children,
}: DialogSheetProps) {
  const appearance = useAppearance();
  const opaque = useReduceTransparency();
  const reduceMotion = useReduceMotion();
  const frosted = Platform.OS === 'ios' && !opaque;
  const styles = useMemo(() => createStyles(appearance, frosted), [appearance, frosted]);
  const insets = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  const wide = useDialogSheetIsWide();
  // The navigation bar's inset is under the keyboard while it is open; the sheet sits right on top of it.
  const bottomInset = useKeyboardTop() === null ? insets.bottom : 0;
  const foldMaxHeight = useFoldSheetMaxHeight({ avoidsKeyboard: true });
  const { mounted, progress, translateY, onPanelLayout } = useSheetPresence(visible);
  const drag = useGrabberDrag(visible, onDismiss);
  // What the panel shows: the live children, then the last ones while it slides away.
  const lastChildren = useRef(children);
  if (visible) lastChildren.current = children;

  // Inline (no Modal of its own) and on Android, the sheet is gone once the presence unmounts it.
  const wasMounted = useRef(mounted);
  const usesModalDismiss = !inline && Platform.OS === 'ios';
  useEffect(() => {
    if (wasMounted.current && !mounted && !usesModalDismiss) onClosed?.();
    wasMounted.current = mounted;
  }, [mounted, usesModalDismiss, onClosed]);

  if (!mounted && inline) return null;

  const slide = reduceMotion
    ? drag.offset
    : Animated.add(wide ? Animated.multiply(translateY, 1.15) : translateY, drag.offset);
  const content = (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]} pointerEvents="none">
        {frosted ? (
          <BlurView tint={appearance.light ? 'light' : 'dark'} intensity={22} style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={styles.dim} />
      </Animated.View>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <KeyboardAvoidingContainer
        safeAreaTop
        style={[styles.layer, bar.padding, wide && styles.layerWide]}
        pointerEvents="box-none"
      >
        <Animated.View
          onLayout={onPanelLayout}
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
          style={[
            styles.panel,
            wide
              ? [styles.panelFloating, { marginBottom: bottomInset + FLOAT_GAP }]
              : [styles.panelAttached, { paddingBottom: Math.max(bottomInset, 16) + 8 }],
            { maxHeight: foldMaxHeight ?? '88%', transform: [{ translateY: slide }] },
            reduceMotion ? { opacity: progress } : null,
          ]}
        >
          {frosted ? (
            <BlurView
              tint={appearance.light ? 'light' : 'dark'}
              intensity={65}
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={styles.grabberArea} {...drag.grabber}>
            <View style={styles.grabber} />
          </View>
          {lastChildren.current}
        </Animated.View>
      </KeyboardAvoidingContainer>
      {overlay}
    </View>
  );
  if (inline) return content;
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
      {...(onShow !== undefined ? { onShow } : {})}
      {...(usesModalDismiss && onClosed !== undefined ? { onDismiss: onClosed } : {})}
    >
      {content}
    </Modal>
  );
}

const createStyles = (appearance: Appearance, frosted: boolean) => {
  const light = appearance.light;
  return StyleSheet.create({
    dim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: frosted
        ? light ? 'rgba(0,0,0,0.20)' : 'rgba(0,0,0,0.38)'
        : light ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.55)',
    },
    layer: { flex: 1, justifyContent: 'flex-end' },
    layerWide: { alignItems: 'center', paddingHorizontal: 24 },
    panel: {
      overflow: 'hidden',
      paddingHorizontal: 16,
      backgroundColor: frosted
        ? light ? 'rgba(255,255,255,0.78)' : 'rgba(32,33,36,0.72)'
        : dialogSolidFill(appearance),
      borderColor: light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)',
    },
    panelAttached: {
      alignSelf: 'stretch',
      borderTopLeftRadius: RADIUS,
      borderTopRightRadius: RADIUS,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    panelFloating: {
      width: '100%',
      maxWidth: WIDE_MAX_WIDTH,
      borderRadius: RADIUS,
      borderWidth: StyleSheet.hairlineWidth,
      paddingBottom: 16,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
    // The strip that takes the drag: the grabber with the room above and below it.
    grabberArea: { paddingTop: 8, paddingBottom: 12 },
    grabber: {
      width: 36,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      backgroundColor: light ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.22)',
    },
  });
};
