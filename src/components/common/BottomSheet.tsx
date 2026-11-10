/**
 * Bottom sheet with free-form content: dimmed backdrop, #161616 panel with a
 * grabber and 20px top corners, keyboard-avoiding so inputs inside stay
 * visible. Dragging the grabber down closes it. `ActionSheet` stays the list-only variant; this one hosts the setup
 * flow's paste, help and password sheets, and the voice screen's sheets. Its backdrop fades in over the
 * whole screen while the panel slides up (`useSheetPresence`). Half folded like a laptop it starts below the fold (with the
 * keyboard up, above it: the keyboard-avoiding layer).
 */

import { useMemo, useRef, type ReactNode, type Ref } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

import { Animated, Modal, Pressable, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import { useFoldSheetMaxHeight } from './foldAvoidance';
import { useKeyboardTop } from './keyboard/keyboardFrame';
import { useVerticalBarSpace } from './verticalBar/VerticalBarArea';
import KeyboardAvoidingContainer from './keyboard/KeyboardAvoidingContainer';
import KeyboardAwareScrollView from './keyboard/KeyboardAwareScrollView';
import { useGrabberDrag } from './useGrabberDrag';
import { useSheetPresence } from './useSheetPresence';

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** The sheet's scroll view, for a sheet that opens scrolled to a row (the voice list). */
  scrollRef?: Ref<ScrollViewInstance>;
};

export default function BottomSheet({ visible, onClose, children, scrollRef }: BottomSheetProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const insets = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  // The navigation bar's inset is under the keyboard while it is open; the sheet sits right on top of it.
  const bottomInset = useKeyboardTop() === null ? insets.bottom : 0;
  const foldMaxHeight = useFoldSheetMaxHeight({ avoidsKeyboard: true });
  const drag = useGrabberDrag(visible, onClose);
  // The Modal outlives `visible` until the panel has slid away, showing what it showed last.
  const { mounted, progress, translateY, onPanelLayout } = useSheetPresence(visible);
  const lastChildren = useRef(children);
  if (visible) lastChildren.current = children;
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingContainer style={styles.fill} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button">
          <Animated.View style={[styles.backdrop, { opacity: progress }]} />
        </Pressable>
        <Animated.View
          testID="sheet-panel"
          onLayout={onPanelLayout}
          style={[
            styles.sheet,
            bar.margin,
            {
              paddingBottom: Math.max(bottomInset, 16) + 12,
              transform: [{ translateY: Animated.add(translateY, drag.offset) }],
            },
            foldMaxHeight !== undefined && { maxHeight: foldMaxHeight },
          ]}
        >
          <View testID="sheet-grabber" style={styles.grabberArea} {...drag.grabber}>
            <View style={styles.grabber} />
          </View>
          <KeyboardAwareScrollView ref={scrollRef} bounces={false} contentContainerStyle={styles.content}>
            {lastChildren.current}
          </KeyboardAwareScrollView>
        </Animated.View>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SetupPalette.BACKDROP,
  },
  sheet: {
    backgroundColor: appearance.input,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: appearance.border,
    paddingHorizontal: 16,
    maxHeight: '88%',
  },
  // The strip that takes the drag: the grabber with the room above and below it.
  grabberArea: {
    paddingTop: 10,
    paddingBottom: 12,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: appearance.control,
    alignSelf: 'center',
  },
  content: {
    paddingBottom: 4,
  },
});
