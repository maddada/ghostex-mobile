/**
 * The composer's bottom sheet: the phone form of the chat's popup menus (desktop draws them as
 * child windows, `option_menu/window.rs`; React as `ghostex-session-chat-popup` dropdowns). Dimmed
 * backdrop, a panel in the chat's menu tone, a grabber (dragging it down closes the sheet), an optional
 * title row with a back arrow for nested pages, and keyboard avoidance so a search field inside stays
 * visible.
 *
 * CDXC:SessionChat 2026-10-25 DECISION:
 * User: "we are showing the backdrop, the black backdrop, animating up. It should fade in the
 * backdrop and the sheet should animate up." The Modal's own "slide" moved backdrop and panel
 * together, so the Modal now has no animation and this component runs two: the backdrop fades in
 * place (opacity only) while the panel slides up by its own height, and both reverse on close. While
 * closing, the sheet keeps showing the last content it was given (a parent usually empties it the
 * moment `visible` goes false) and takes no touches. Half folded like a laptop the panel starts below the fold
 * (with the keyboard up, above it: the keyboard-avoiding layer).
 */

import { useRef, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFoldSheetMaxHeight } from '../../../components/common/foldAvoidance';
import { useKeyboardTop } from '../../../components/common/keyboard/keyboardFrame';
import KeyboardAvoidingContainer from '../../../components/common/keyboard/KeyboardAvoidingContainer';
import { useVerticalBarSpace } from '../../../components/common/verticalBar/VerticalBarArea';
import { useGrabberDrag } from '../../../components/common/useGrabberDrag';
import { useSheetPresence } from '../../../components/common/useSheetPresence';
import { Glyph } from './icons';
import { PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Shows a back arrow before the title (a nested page). */
  onBack?: () => void;
  /** Controls on the right of the title row. */
  accessory?: ReactNode;
  /**
   * A muted line under the title, as a pill menu's header has its detail beside its title on the
   * desktop (`pill_menu_header` in chat_pills.rs): "2 threads waiting for you", "3 hidden". Only a
   * sheet that passes one draws it.
   */
  subtitle?: string;
  children: ReactNode;
  /** Fraction of the screen the panel may take. */
  maxHeight?: `${number}%`;
  /** iOS: the sheet finished going away, so another view controller (a picker) can present. */
  onDismissed?: () => void;
};

export function Sheet(props: SheetProps) {
  const { visible, onClose, onDismissed } = props;
  const styles = useStyles();
  const P = useTranscriptTheme();
  const insets = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  // The navigation bar's inset is under the keyboard while it is open; the sheet sits right on top of it.
  const bottomInset = useKeyboardTop() === null ? insets.bottom : 0;
  const foldMaxHeight = useFoldSheetMaxHeight({ avoidsKeyboard: true });
  // The Modal outlives `visible` until the panel has slid away (`useSheetPresence`).
  const { mounted, progress, translateY, onPanelLayout } = useSheetPresence(visible);
  // What the panel shows: the live props, then the last ones while it slides away.
  const lastProps = useRef(props);
  if (visible) lastProps.current = props;
  const { title, onBack, accessory, subtitle, children, maxHeight = '80%' } = lastProps.current;
  const drag = useGrabberDrag(visible, onClose);
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
          testID="sheet-panel"
          onLayout={onPanelLayout}
          style={[
            styles.panel,
            bar.margin,
            {
              maxHeight: foldMaxHeight ?? maxHeight,
              paddingBottom: Math.max(bottomInset, 12),
              transform: [{ translateY: Animated.add(translateY, drag.offset) }],
            },
          ]}
        >
          <View testID="sheet-grabber" style={styles.grabberArea} {...drag.grabber}>
            <View style={styles.grabber} />
          </View>
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
          {subtitle !== undefined && subtitle.length > 0 ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
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
  },
  // The strip that takes the drag: the grabber with the room above and below it.
  grabberArea: { paddingVertical: 8 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: P.grabber, alignSelf: 'center' },
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
  /** The pill sheets' muted detail line (`AgentPanels.tsx` `MenuMeta`'s look), tucked under the title. */
  subtitle: { color: P.cardMuted, fontSize: PROSE_SIZE, paddingHorizontal: 16, marginTop: -4, paddingBottom: 8 },
}));
