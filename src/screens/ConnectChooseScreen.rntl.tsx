/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. "Try a demo computer" on the Connect screen, with the app's real stack navigator and
 * the routes App.tsx registers by whether a computer is saved (Welcome without one, Sessions with one): the first
 * "Open demo" tap, which adds the first computer, opens the demo's Sessions list (it stayed on Connect before,
 * ghostex-mobile#28's review), and so does a tap while other computers are saved.
 */

import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { DEMO_MACHINE_ID } from '../demo/identity';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import ConnectChooseScreen from './ConnectChooseScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../modules/ghostex-native/src', () => ({ GhostexNative: {} }));
jest.mock('react-native-safe-area-context', () =>
  jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../components/common/verticalBar/VerticalBarArea', () => ({
  useScrollToBarEdges: () => ({ scroll: undefined, content: undefined }),
}));

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Welcome = () => <Text>Welcome screen</Text>;
const Sessions = () => <Text>Sessions screen</Text>;

/** The routes App.tsx registers, the first screen chosen by whether a computer is saved. */
function Root() {
  const hasMachines = useMachinesStore((state) => state.machines.length > 0);
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator>
        {!hasMachines ? (
          <Stack.Screen name="Welcome" component={Welcome} />
        ) : (
          <Stack.Screen name="Sessions" component={Sessions} />
        )}
        <Stack.Screen name="ConnectChoose" component={ConnectChooseScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const MAC: MachineRecord = {
  id: 'm1',
  name: 'Mac mini',
  host: 'mac-mini.local',
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

async function openDemoFromConnect(): Promise<void> {
  await render(<Root />);
  await act(() => navigationRef.navigate('ConnectChoose'));
  expect(navigationRef.getCurrentRoute()?.name).toBe('ConnectChoose');
  await fireEvent.press(screen.getByText('Open demo'));
}

beforeEach(() => {
  useMachinesStore.setState({ hydrated: true, machines: [], selectedMachineId: null });
});

test('the first "Open demo" tap adds the demo computer and opens its Sessions list', async () => {
  await openDemoFromConnect();
  expect(useMachinesStore.getState().machines.map((machine) => machine.id)).toEqual([DEMO_MACHINE_ID]);
  expect(useMachinesStore.getState().selectedMachineId).toBe(DEMO_MACHINE_ID);
  expect(navigationRef.getCurrentRoute()?.name).toBe('Sessions');
  expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(['Sessions']);
  expect(screen.getByText('Sessions screen')).toBeTruthy();
});

test('with a computer already saved, "Open demo" opens the Sessions list on the demo too', async () => {
  useMachinesStore.setState({ machines: [MAC], selectedMachineId: MAC.id });
  await openDemoFromConnect();
  expect(useMachinesStore.getState().selectedMachineId).toBe(DEMO_MACHINE_ID);
  expect(navigationRef.getCurrentRoute()?.name).toBe('Sessions');
});
