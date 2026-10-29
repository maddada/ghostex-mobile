/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. REQ-DUO-001 AC5 (no margins on the unfolded display: the owner saw the strip
 * under the bar as empty space there) and REQ-DUO-005 AC2 (folded). Owner decision 2026-10-28 (S1 improvement on upstream's Sessions bottom
 * bar): like iOS's own tab bars, the bar's background runs to the bottom screen edge while its buttons and
 * labels stay above the home indicator: the bar is the usual 58 pt of items plus the bottom safe-area inset,
 * the inset as padding inside it. Without an inset (an iPhone with a home button) nothing changes.
 */

import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { BOTTOM_BAR_ITEMS_HEIGHT, SessionsBottomBar } from './BottomBar';

let mockInsets = { top: 0, bottom: 34, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));

async function bar() {
  await render(
    <SessionsBottomBar>
      <Text>Search</Text>
    </SessionsBottomBar>,
  );
  return StyleSheet.flatten(screen.getByTestId('sessions-bottom-bar').props.style);
}

test('with a home indicator the bar grows by the inset and pads its items above it', async () => {
  mockInsets = { top: 0, bottom: 34, left: 0, right: 0 };
  const style = await bar();
  expect(style.height).toBe(BOTTOM_BAR_ITEMS_HEIGHT + 34);
  expect(style.paddingBottom).toBe(34);
  // The items' own room is still the 58 pt of the approved bar.
  expect(style.height - style.paddingBottom).toBe(58);
  // The bar's own background is what reaches the edge (not the screen's padding behind it).
  expect(style.backgroundColor).toBe('#121212');
});

test('without an inset the bar is the 58 pt it was', async () => {
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  const style = await bar();
  expect(style.height).toBe(58);
  expect(style.paddingBottom).toBe(0);
});
