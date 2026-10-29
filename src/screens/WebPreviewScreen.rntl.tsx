/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Web Preview's side bar "…"
 * (its menu holds Forward, Desktop Site and Open in Browser) stays open when the Duo is turned from
 * landscape (side bar) to portrait (status band), where the toolbar holds those buttons again and the
 * menu is centred (no Effect closes it on a pose
 * change). The page's connection is a stand-in that never connects; the chrome is the real
 * `VerticalBarArea`.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Dimensions } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { BarLayout } from '../../modules/ghostex-native/src/GhostexNative.types';
import { useBarGeometryStore } from '../components/common/verticalBar/barGeometry';
import VerticalBarArea from '../components/common/verticalBar/VerticalBarArea';
import { DuoChromeCopy, WebPreviewCopy } from '../copy';
import type { RootStackParamList } from '../navigation/types';
import WebPreviewScreen from './WebPreviewScreen';

let mockReport: ((layout: BarLayout) => void) | null = null;
let mockFirstLayout: ((value: { id: number; layout: BarLayout }) => void) | null = null;
let mockInsets = { top: 10, bottom: 20, left: 0, right: 81 };

jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: (event: string, listener: (layout: BarLayout) => void) => {
      if (event === 'onBarLayoutChange') mockReport = listener;
      return { remove: () => undefined };
    },
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
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true, useFocusEffect: () => undefined }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('../theme/useAppearance', () => ({
  useAppearance: () => ({ background: 'black', foreground: 'white', border: 'gray' }),
}));
jest.mock('../inventory/client', () => ({ ensureConnected: () => Promise.withResolvers().promise }));
jest.mock('../machines/credentials', () => ({ hasPassword: () => Promise.resolve(false) }));
jest.mock('../webPreview/forwards', () => ({
  startWebPreviewForward: () => Promise.withResolvers().promise,
  describeForwardFailure: () => '',
}));
jest.mock('../webPreview/machineLinks', () => ({
  holdComputerForward: () => Promise.resolve(),
  releaseComputerForward: () => Promise.resolve(),
}));
// A pressed button's window frame: the side bar's "…" (the test renderer measures nothing).
jest.mock('../components/common/measureInWindow', () => ({
  measureInWindow: (_ref: unknown, onFrame: (frame: object) => void) =>
    onFrame({ x: 880, y: 290, width: 46, height: 46 }),
}));

const LANDSCAPE: BarLayout = {
  windowWidth: 951,
  windowHeight: 669,
  safeTop: 10,
  safeLeft: 0,
  safeRight: 81,
  marginTop: 18,
  edge: 'trailing',
  sideBar: { x: 880, y: 116, width: 46, height: 520 },
  topBar: { x: 0, y: 10, width: 870, height: 44 },
  divisions: [],
};
const PORTRAIT: BarLayout = {
  windowWidth: 669,
  windowHeight: 951,
  safeTop: 80,
  safeLeft: 0,
  safeRight: 0,
  marginTop: 88,
  topBar: { x: 0, y: 26, width: 466, height: 44 },
  divisions: [],
};

async function setWindow(width: number, height: number): Promise<void> {
  await act(() => {
    Dimensions.set({
      window: { width, height, scale: 3, fontScale: 1 },
      screen: { width, height, scale: 3, fontScale: 1 },
    });
  });
}

test('the side bar "…" menu stays open when the Duo turns to portrait', async () => {
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
  await useBarGeometryStore.getState().hydrate();
  await setWindow(951, 669);
  type Props = NativeStackScreenProps<RootStackParamList, 'WebPreview'>;
  const route: Props['route'] = {
    key: 'preview',
    name: 'WebPreview',
    params: { machineId: 'machine', remotePort: 3000 },
  };
  // TS-03: of the navigator only `goBack`, the one member Web Preview calls; a navigator is not mounted
  // in this test, so the stand-in is cast (the screen calling any other member fails this test with a
  // TypeError, not silently).
  const navigation = { goBack: jest.fn() } as unknown as Props['navigation'];
  const props: Props = { navigation, route };

  await render(
    <VerticalBarArea>
      <WebPreviewScreen {...props} />
    </VerticalBarArea>,
  );
  await act(async () => {
    mockFirstLayout?.({ id: 1, layout: LANDSCAPE });
  });
  await fireEvent.press(screen.getByLabelText(DuoChromeCopy.more));
  expect(screen.getByText(WebPreviewCopy.forwardLabel)).toBeTruthy();

  mockInsets = { top: 80, bottom: 20, left: 0, right: 0 };
  await setWindow(669, 951);
  await act(async () => {
    mockReport?.(PORTRAIT);
  });
  expect(screen.getByText(WebPreviewCopy.forwardLabel)).toBeTruthy();
  expect(screen.getByText(WebPreviewCopy.openInBrowserLabel)).toBeTruthy();
});
