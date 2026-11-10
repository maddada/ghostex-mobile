/**
 * How a bottom sheet comes and goes: its backdrop fades in place over the whole screen while its
 * panel slides up by its own height, and both reverse on close. The sheet's `Modal` has no animation
 * of its own (`animationType="none"`) and stays mounted until the closing animation has finished.
 *
 * CDXC:SessionChat 2026-10-25 DECISION: User: "we are showing the backdrop, the black backdrop, animating up. It should fade in the backdrop and the sheet should animate up." The Modal's own "slide" moved backdrop and panel together.
 * CDXC:VoiceMode 2026-11-10 DECISION: User, on Android: "when I click on the settings button on Android, the overlay behind animates up. It should not animate up; it should fade in over the whole screen at one time." The free-form `BottomSheet` (the voice screen's gear, voice and speed sheets, setup's sheets) moves the same way as the chat's `Sheet`, through this hook.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

const OPEN_MS = 260;
const CLOSE_MS = 200;

export function useSheetPresence(visible: boolean): {
  /** The Modal's `visible`: true from opening until the panel has slid away. */
  mounted: boolean;
  /** 0 closed, 1 open: the backdrop's opacity. */
  progress: Animated.Value;
  /** The panel's slide, from its own height below to its place. */
  translateY: Animated.AnimatedInterpolation<number>;
  /** The panel's `onLayout`: the slide starts once the panel has been measured. */
  onPanelLayout: (event: LayoutChangeEvent) => void;
} {
  const windowHeight = useWindowDimensions().height;
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const progress = useRef(new Animated.Value(0)).current;
  const [panelHeight, setPanelHeight] = useState(0);
  const measured = panelHeight > 0;

  useEffect(() => {
    if (visible && mounted && measured) {
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
        if (!finished) return;
        setMounted(false);
        // The next open measures its own content.
        setPanelHeight(0);
      });
    }
  }, [visible, mounted, measured, progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    // Before the panel has been measured it waits a whole screen below.
    outputRange: [panelHeight > 0 ? panelHeight : windowHeight, 0],
  });
  return {
    mounted,
    progress,
    translateY,
    onPanelLayout: (event) => setPanelHeight(event.nativeEvent.layout.height),
  };
}
