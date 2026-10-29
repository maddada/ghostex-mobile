import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The height of the bar's items (upstream's option E bar: 58 pt). */
export const BOTTOM_BAR_ITEMS_HEIGHT = 58;

/**
 * The Sessions screen's bottom bar. Like iOS's own tab bars its background runs to the bottom screen edge
 * (S1, owner 2026-10-28): the screen leaves the bottom safe area to the bar, which adds the inset as padding
 * below its items, so the buttons and labels stay above the home indicator and no black strip shows under
 * the bar. Without an inset the bar is exactly the 58 pt it was.
 */
export function SessionsBottomBar({ children }: { children: ReactNode }) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View
      testID="sessions-bottom-bar"
      style={[styles.bar, { height: BOTTOM_BAR_ITEMS_HEIGHT + bottom, paddingBottom: bottom }]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  /*
   * Option E's bottom bar (top-bar-buttons.html `.tb-bottom-bar`): 58pt of items, a hairline on top, #121212,
   * edge to edge under the list (it reaches through the screen's 12pt padding, also at the bottom).
   */
  bar: {
    flexDirection: 'row',
    marginHorizontal: -12,
    marginBottom: -12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121212',
  },
});
