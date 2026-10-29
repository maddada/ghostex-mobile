/**
 * The iOS terminal's key bar rides on top of the software keyboard (terminal-screen.md §2): the dock sits
 * at the window's bottom edge, `inset` points above it while the keyboard is up, and below it while the
 * keyboard is away. The inset changes in the layout commit the keyboard's move animates over (the motion fitted
 * to the keyboard's, `keyboardMotion.ts`; `useKeyboardMetrics`), so the bar moves with the keyboard instead of
 * appearing or vanishing while the keyboard is still on its way. The bar stays mounted for `hideMs` after
 * `shown` ends, the length of that move (0 with Reduce Motion: nothing animates), and is gone afterwards,
 * so its state resets as it did when it was unmounted at once.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

export type KeyBarDockProps = {
  /** The bar is wanted: the keyboard is up, or a tap that will bring it up is under way. */
  shown: boolean;
  /** Points between the window's bottom edge and the bar's bottom edge while `shown`. */
  inset: number;
  /** How long the bar stays mounted after `shown` ends, milliseconds. */
  hideMs: number;
  /** The dock's own height as laid out: the bar's, 0 while it is unmounted. */
  onHeightChange: (height: number) => void;
  children: ReactNode;
};

export default function KeyBarDock({ shown, inset, hideMs, onHeightChange, children }: KeyBarDockProps) {
  const [lastShown, setLastShown] = useState(shown);
  const [lingering, setLingering] = useState(false);
  const [height, setHeight] = useState(0);
  if (lastShown !== shown) {
    setLastShown(shown);
    setLingering(!shown && hideMs > 0);
  }
  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), hideMs);
    return () => clearTimeout(timer);
  }, [lingering, hideMs]);

  const mounted = shown || lingering;
  return (
    <View
      collapsable={false}
      pointerEvents={shown ? 'box-none' : 'none'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      style={[styles.dock, { bottom: shown ? inset : -height }]}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.height;
        setHeight(next);
        onHeightChange(next);
      }}
    >
      {mounted ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
