/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. A demo computer's session in a pane: its local terminal (`DemoTerminalView`, a list
 * with a typing row at its bottom) takes the pane's visible height, so the keyboard covers none of it; the native
 * terminal keeps its full height and slides instead (ghostex-mobile#28's review).
 */

import { StyleSheet, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { DEMO_MACHINE_ID } from '../demo/identity';
import { useTerminalStore } from '../terminal/sessions';
import SessionPane from './SessionPane';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../modules/ghostex-native/src', () => ({ GhostexNative: {}, GhostexTerminalView: () => null }));
jest.mock('../demo/DemoTerminalView', () => (props: { style: unknown }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').View, {
    testID: 'demo-terminal',
    style: props.style,
  }),
);
jest.mock('../webPreview/useOpenMachineLink', () => ({ useOpenMachineLink: () => () => undefined }));

test("the demo terminal ends above the keyboard: its height is the pane's less what the keyboard covers", async () => {
  useTerminalStore.setState({
    tabs: [{ sessionKey: 'demo-1', machineId: DEMO_MACHINE_ID, ghostexSessionId: 's1', state: 'connected' }],
  } as unknown as Parameters<typeof useTerminalStore.setState>[0]);
  await render(
    <View>
      <SessionPane sessionKey="demo-1" view={{ width: 400, height: 600 }} covered={250} active />
    </View>,
  );
  expect(StyleSheet.flatten(screen.getByTestId('demo-terminal').props.style)).toMatchObject({ width: 400, height: 350 });
});
