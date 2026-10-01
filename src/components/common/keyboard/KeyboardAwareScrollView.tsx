/**
 * A ScrollView that keeps the focused text field visible above the software keyboard: it adds the
 * keyboard's overlap with its own frame as extra room at the end of the content, and scrolls the
 * focused field (and a little margin under it) into the uncovered part whenever the keyboard opens
 * or changes height, or the scroll view itself is resized. Works on full screens, where Android may
 * or may not have resized the window, and inside dialogs and sheets that already moved up.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import {
  ScrollView,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';

import { useKeyboardOverlap } from './KeyboardAvoidingContainer';

/** Space kept between the focused field and the keyboard (or the scroll view's edge). */
const REVEAL_MARGIN = 16;

const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardAwareScrollView(
  { children, onScroll, onLayout, scrollEventThrottle, keyboardShouldPersistTaps = 'handled', ...props },
  forwardedRef,
) {
  const scrollRef = useRef<ScrollView | null>(null);
  const offset = useRef(0);
  const keyboard = useKeyboardOverlap();
  useImperativeHandle(forwardedRef, () => scrollRef.current as ScrollView, []);

  const { keyboardTop, frame } = keyboard;
  const reveal = useCallback(() => {
    const scroll = scrollRef.current;
    const native = scroll?.getNativeScrollRef();
    const input = TextInput.State.currentlyFocusedInput();
    if (scroll == null || native == null || input == null || keyboardTop === null || frame === null) return;
    // measureLayout fails for a field outside this scroll view; then it is someone else's to reveal.
    input.measureLayout(
      native,
      () => {
        input.measureInWindow((_x, y, _width, height) => {
          const visibleTop = frame.top;
          const visibleBottom = Math.min(frame.bottom, keyboardTop);
          let delta = 0;
          if (y + height + REVEAL_MARGIN > visibleBottom) {
            // A field taller than the visible space keeps its top edge in view.
            delta = Math.min(y + height + REVEAL_MARGIN - visibleBottom, y - REVEAL_MARGIN - visibleTop);
          } else if (y - REVEAL_MARGIN < visibleTop) {
            delta = y - REVEAL_MARGIN - visibleTop;
          }
          if (delta !== 0) scroll.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
        });
      },
      () => undefined,
    );
  }, [keyboardTop, frame]);

  useEffect(() => {
    if (keyboardTop === null) return undefined;
    // Wait a frame so the extra room at the end of the content is laid out before scrolling into it.
    const handle = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(handle);
  }, [keyboardTop, keyboard.overlap, reveal]);

  return (
    <ScrollView
      {...props}
      ref={(node) => {
        scrollRef.current = node;
        (keyboard.ref as { current: View | null }).current = node as unknown as View | null;
      }}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      scrollEventThrottle={scrollEventThrottle ?? 16}
      onLayout={(event) => {
        keyboard.onLayout();
        onLayout?.(event);
      }}
      onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        offset.current = event.nativeEvent.contentOffset.y;
        onScroll?.(event);
      }}
    >
      {children}
      {keyboard.overlap > 0 ? <View style={{ height: keyboard.overlap }} /> : null}
    </ScrollView>
  );
});

export default KeyboardAwareScrollView;
