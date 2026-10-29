/**
 * The composer's bottom sheet: the phone form of the chat's popup menus (desktop draws them as
 * child windows, `option_menu/window.rs`; React as `ghostex-session-chat-popup` dropdowns). Dimmed
 * backdrop, a panel in the chat's menu tone, a grabber, an optional title row with a back arrow for
 * nested pages, and keyboard avoidance so a search field inside stays visible.
 *
 * CDXC:SessionChat 2026-10-25 DECISION:
 * User: "we are showing the backdrop, the black backdrop, animating up. It should fade in the
 * backdrop and the sheet should animate up." The Modal's own "slide" moved backdrop and panel
 * together, so the Modal now has no animation and this component runs two: the backdrop fades in
 * place (opacity only) while the panel slides up by its own height, and both reverse on close. While
 * closing, the sheet keeps showing the last content it was given (a parent usually empties it the
 * moment `visible` goes false) and takes no touches.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardTop } from '../../../components/common/keyboard/keyboardFrame';
import KeyboardAvoidingContainer from '../../../components/common/keyboard/KeyboardAvoidingContainer';
import { useVerticalBarSpace } from '../../../components/common/verticalBar/VerticalBarArea';
import { Glyph } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Shows a back arrow before the title (a nested page). */
  onBack?: () => void;
  /** Controls on the right of the title row. */
  accessory?: ReactNode;
  children: ReactNode;
  /** Fraction of the screen the panel may take. */
  maxHeight?: `${number}%`;
  /** iOS: the sheet finished going away, so another view controller (a picker) can present. */
  onDismissed?: () => void;
};

/** How long the backdrop's fade and the panel's slide take, opening and closing. */
const OPEN_MS = 260;
const CLOSE_MS = 200;

export function Sheet(props: SheetProps) {
  const { visible, onClose, onDismissed } = props;
  const styles = useStyles();
  const P = useTranscriptTheme();
  const insets = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  const windowHeight = useWindowDimensions().height;
  // The navigation bar's inset is under the keyboard while it is open; the sheet sits right on top of it.
  const bottomInset = useKeyboardTop() === null ? insets.bottom : 0;
  // Stays true until the closing animation has finished, so the Modal outlives `visible`.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  // 0 = closed (backdrop clear, panel below the screen), 1 = open.
  const progress = useRef(new Animated.Value(0)).current;
  const [panelHeight, setPanelHeight] = useState(0);
  // What the panel shows: the live props, then the last ones while it slides away.
  const lastProps = useRef(props);
  if (visible) lastProps.current = props;
  const { title, onBack, accessory, children, maxHeight = '80%' } = lastProps.current;

  useEffect(() => {
    if (visible && mounted) {
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (!visible && mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: CLOSE_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    // Before the panel has been measured it waits a whole screen below.
    outputRange: [panelHeight > 0 ? panelHeight : windowHeight, 0],
  });
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onBack ?? onClose}
      {...(onDismissed !== undefined ? { onDismiss: onDismissed } : {})}
      statusBarTranslucent
    >
      <KeyboardAvoidingContainer style={styles.fill} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Animated.View style={[styles.backdrop, { opacity: progress }]} />
        </Pressable>
        <Animated.View
          onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
          style={[
            styles.panel,
            bar.margin,
            { maxHeight, paddingBottom: Math.max(bottomInset, 12), transform: [{ translateY }] },
          ]}
        >
          <View style={styles.grabber} />
          {title !== undefined || onBack !== undefined || accessory !== undefined ? (
            <View style={styles.titleRow}>
              {onBack !== undefined ? (
                <Pressable
                  onPress={onBack}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  style={styles.back}
                >
                  <Glyph name="chevron-left" size={18} color={P.primary} />
                </Pressable>
              ) : null}
              <Text style={styles.title} numberOfLines={1}>
                {title ?? ''}
              </Text>
              {accessory}
            </View>
          ) : null}
          {children}
        </Animated.View>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const useStyles = themedStyles((P) => ({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: P.sheetBackdrop },
  panel: {
    backgroundColor: P.menu,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: P.menuBorder,
    paddingTop: 8,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: P.grabber, alignSelf: 'center', marginBottom: 8 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
    minHeight: 32,
  },
  back: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: P.foreground, fontSize: 15, fontWeight: '600' },
}));
