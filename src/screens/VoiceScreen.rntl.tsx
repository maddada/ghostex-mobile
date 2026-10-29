/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The Voice screen opens on iOS through `ghostex://voice`, so its conversation, a scroll view, spans the window
 * under the iPhone Duo's side bar while its lines keep their own 16 pt padding plus the side bar's inset,
 * on whichever side the bar stands. Without a side bar (every other iPhone, also in landscape with the
 * notch's insets) its styling is what it was. The real `VoiceScreen` inside the real `VerticalBarArea`;
 * mocked are the boundaries only: the native module (the bar reports), the safe area, storage (the
 * library's own Jest mock) and Reanimated's Reduce Motion read. The voice store is the real one, set to
 * an ended call so the conversation shows its closing notice.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ReactNode } from 'react';
import { Dimensions, StyleSheet, type ViewStyle } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import type { BarLayout } from '../../modules/ghostex-native/src/GhostexNative.types';
import { useBarGeometryStore } from '../components/common/verticalBar/barGeometry';
import VerticalBarArea from '../components/common/verticalBar/VerticalBarArea';
import type { RootStackParamList } from '../navigation/types';
import { useVoiceStore } from '../voice/conversation';
import VoiceScreen from './VoiceScreen';

let mockFirstLayout: ((value: { id: number; layout: BarLayout }) => void) | null = null;
let mockInsets = { top: 0, bottom: 20, left: 0, right: 0 };

jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: () => ({ remove: () => undefined }),
    observeBarLayout: () => {
      const { promise, resolve } = Promise.withResolvers<{ id: number; layout: BarLayout }>();
      mockFirstLayout = resolve;
      return promise;
    },
    stopObservingBarLayout: () => Promise.resolve(),
  },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// The safe area: the insets of each case; its view only holds the screen (no padding of its own here).
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
  SafeAreaView: ({ children }: { children?: ReactNode }) => children,
}));
// Reanimated is native (its worklets runtime does not load under Jest); of it the screen's tree reads only
// whether Reduce Motion is on (the chat pills, `ChatPills.tsx`), which is off here.
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));

const ENDED = 'The call ended.';

/** The folded display turned: the side bar on the leading side, 84 pt of the window's left behind it. */
const FOLDED_TURNED: BarLayout = {
  windowWidth: 678,
  windowHeight: 466,
  safeTop: 0,
  safeLeft: 84,
  safeRight: 0,
  marginTop: 8,
  edge: 'leading',
  sideBar: { x: 25, y: 116, width: 46, height: 330 },
  divisions: [],
};
/** The unfolded display in landscape: the side bar on the trailing side, 81 pt of the window's right. */
const INNER_LANDSCAPE: BarLayout = {
  windowWidth: 951,
  windowHeight: 669,
  safeTop: 10,
  safeLeft: 0,
  safeRight: 81,
  marginTop: 18,
  edge: 'trailing',
  sideBar: { x: 880, y: 116, width: 46, height: 520 },
  divisions: [],
};
/** A regular iPhone in landscape: no side bar, the notch's insets on both sides. */
const IPHONE_LANDSCAPE: BarLayout = {
  windowWidth: 874,
  windowHeight: 402,
  safeTop: 0,
  safeLeft: 62,
  safeRight: 62,
  marginTop: 8,
  divisions: [],
};

type Props = NativeStackScreenProps<RootStackParamList, 'Voice'>;
// TS-03: VoiceScreen calls the navigator only from its buttons, which this test does not press; a navigator
// is not mounted here, so the stand-in is cast (a call to any member fails this test with a TypeError).
const props: Props = {
  navigation: {} as unknown as Props['navigation'],
  route: { key: 'voice', name: 'Voice', params: undefined },
};

/** The conversation's scroll view: the nearest view around the closing notice that has a content style. */
async function conversationStyles(
  layout: BarLayout,
  insets: typeof mockInsets,
): Promise<{ scroll: ViewStyle | undefined; content: ViewStyle | undefined }> {
  mockInsets = insets;
  await act(() => {
    const window = { width: layout.windowWidth ?? 0, height: layout.windowHeight ?? 0, scale: 3, fontScale: 1 };
    Dimensions.set({ window, screen: window });
  });
  await render(
    <VerticalBarArea>
      <VoiceScreen {...props} />
    </VerticalBarArea>,
  );
  await act(async () => {
    mockFirstLayout?.({ id: 1, layout });
  });
  let scroll = screen.getByText(ENDED).parent;
  while (scroll !== null && scroll.props.contentContainerStyle === undefined) scroll = scroll.parent;
  return {
    scroll: StyleSheet.flatten(scroll?.props.style),
    content: StyleSheet.flatten(scroll?.props.contentContainerStyle),
  };
}

beforeEach(async () => {
  mockFirstLayout = null;
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
  await useBarGeometryStore.getState().hydrate();
  useVoiceStore.setState({ phase: 'ended', endedMessage: ENDED, problem: null, lines: [] });
});

describe('the Voice conversation clear of the side bar', () => {
  test('a leading side bar: the view reaches under it, the lines keep 16 pt past it', async () => {
    const { scroll, content } = await conversationStyles(FOLDED_TURNED, { top: 0, bottom: 20, left: 84, right: 0 });
    expect(scroll).toMatchObject({ marginLeft: -84, marginRight: 0 });
    expect(content).toMatchObject({ paddingLeft: 16 + 84, paddingRight: 16 });
  });

  test('a trailing side bar: the view reaches under it, the lines keep 16 pt past it', async () => {
    const { scroll, content } = await conversationStyles(INNER_LANDSCAPE, { top: 10, bottom: 20, left: 0, right: 81 });
    expect(scroll).toMatchObject({ marginLeft: 0, marginRight: -81 });
    expect(content).toMatchObject({ paddingLeft: 16, paddingRight: 16 + 81 });
  });

  test('without a side bar (a regular iPhone in landscape) the styling is unchanged', async () => {
    const { scroll, content } = await conversationStyles(IPHONE_LANDSCAPE, { top: 0, bottom: 21, left: 62, right: 62 });
    expect(scroll?.marginLeft).toBeUndefined();
    expect(scroll?.marginRight).toBeUndefined();
    expect(content).toMatchObject({ paddingHorizontal: 16 });
    expect(content?.paddingLeft).toBeUndefined();
    expect(content?.paddingRight).toBeUndefined();
  });
});
