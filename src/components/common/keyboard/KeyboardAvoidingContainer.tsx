/**
 * A view that keeps its children above the software keyboard by padding its bottom by exactly the
 * part of its own frame the keyboard covers. Every modal dialog and bottom sheet puts its content
 * in one, so a centred card re-centres in the space above the keyboard and a bottom sheet rides on
 * top of it (shrinking when its percentage max height no longer fits).
 *
 * Replaces React Native's `KeyboardAvoidingView`, which needs a resized window on Android and so
 * does nothing inside a `Modal` there (see keyboardFrame.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardTop } from './keyboardFrame';

/** How far below the keyboard's top edge the view's frame reaches; 0 while the keyboard is hidden. */
export function useKeyboardOverlap(): {
  ref: React.RefObject<View | null>;
  onLayout: () => void;
  overlap: number;
  keyboardTop: number | null;
  frame: { top: number; bottom: number } | null;
} {
  const ref = useRef<View | null>(null);
  const keyboardTop = useKeyboardTop();
  const [frame, setFrame] = useState<{ top: number; bottom: number } | null>(null);
  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _width, height) => {
      setFrame((previous) =>
        previous !== null && previous.top === y && previous.bottom === y + height
          ? previous
          : { top: y, bottom: y + height },
      );
    });
  }, []);
  // The window may have moved or resized with the keyboard without changing this view's own layout.
  useEffect(onLayout, [keyboardTop, onLayout]);
  const overlap =
    keyboardTop === null || frame === null ? 0 : Math.max(0, Math.round(frame.bottom - keyboardTop));
  return { ref, onLayout, overlap, keyboardTop, frame };
}

function basePadding(style: ViewProps['style'], edge: 'paddingTop' | 'paddingBottom'): number {
  const flat = StyleSheet.flatten(style) ?? {};
  const value = flat[edge] ?? flat.paddingVertical ?? flat.padding ?? 0;
  return typeof value === 'number' ? value : 0;
}

export type KeyboardAvoidingContainerProps = ViewProps & {
  /**
   * Keep the content below the status bar. Modals are edge-to-edge on Android, and a centred card
   * squeezed into the space above the keyboard would otherwise grow up under it.
   */
  safeAreaTop?: boolean;
};

export default function KeyboardAvoidingContainer({
  style,
  onLayout,
  safeAreaTop = false,
  ...props
}: KeyboardAvoidingContainerProps) {
  const keyboard = useKeyboardOverlap();
  const topInset = useSafeAreaInsets().top;
  return (
    <View
      {...props}
      ref={keyboard.ref}
      onLayout={(event) => {
        keyboard.onLayout();
        onLayout?.(event);
      }}
      style={[
        style,
        safeAreaTop ? { paddingTop: basePadding(style, 'paddingTop') + topInset } : null,
        keyboard.overlap > 0 ? { paddingBottom: basePadding(style, 'paddingBottom') + keyboard.overlap } : null,
      ]}
    />
  );
}
