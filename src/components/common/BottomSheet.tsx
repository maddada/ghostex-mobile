/**
 * Bottom sheet with free-form content: dimmed backdrop, #161616 panel with a
 * grabber and 20px top corners, keyboard-avoiding so inputs inside stay
 * visible. Dragging the grabber down closes it. `ActionSheet` stays the list-only variant; this one hosts the setup
 * flow's paste, help and password sheets. Half folded like a laptop it starts below the fold (with the
 * keyboard up, above it: the keyboard-avoiding layer).
 */

import { useMemo, type ReactNode, type Ref } from 'react';
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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingContainer style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <Animated.View
          testID="sheet-panel"
          style={[
            styles.sheet,
            bar.margin,
            { paddingBottom: Math.max(bottomInset, 16) + 12, transform: [{ translateY: drag.offset }] },
            foldMaxHeight !== undefined && { maxHeight: foldMaxHeight },
          ]}
        >
          <View testID="sheet-grabber" style={styles.grabberArea} {...drag.grabber}>
            <View style={styles.grabber} />
          </View>
          <KeyboardAwareScrollView ref={scrollRef} bounces={false} contentContainerStyle={styles.content}>
            {children}
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
