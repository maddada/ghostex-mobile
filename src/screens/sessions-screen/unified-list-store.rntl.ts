import AsyncStorage from '@react-native-async-storage/async-storage';

import { UNIFIED_SAVED_STATE_KEY } from '../../contract/unified/saved';
import { shelfOpen, useUnifiedListStore } from './unified-list-store';

jest.mock('@react-native-async-storage/async-storage', () => {
  const held = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => held.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => void held.set(key, value)),
    },
  };
});

describe('the Unified list state on the phone', () => {
  test('a pick, a shelf and a fold are written; the search is not', async () => {
    const store = useUnifiedListStore.getState();
    store.setQuery('typed');
    store.setFilter({ repos: ['r'], machines: [], spaces: [] });
    store.toggleShelf('r|parked');
    store.toggleGroup('r');
    store.noteLastMachine('r', 'studio');
    const raw = await AsyncStorage.getItem(UNIFIED_SAVED_STATE_KEY);
    const saved = JSON.parse(raw ?? '{}');
    expect(saved.repos).toEqual(['r']);
    expect(saved.toggledShelves).toEqual(['r|parked']);
    expect(saved.foldedGroups).toEqual(['r']);
    expect(saved.lastMachines).toEqual({ r: 'studio' });
    expect(raw).not.toContain('typed');
    // The filter pick kept what was typed for this run.
    expect(useUnifiedListStore.getState().filter.query).toBe('typed');
  });

  test('a restart reads them back', async () => {
    await AsyncStorage.setItem(
      UNIFIED_SAVED_STATE_KEY,
      JSON.stringify({ repos: ['back'], toggledShelves: ['working'], foldedGroups: ['g'], lastMachines: { g: 'm' } }),
    );
    useUnifiedListStore.setState({ hydrated: false });
    useUnifiedListStore.getState().hydrate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = useUnifiedListStore.getState();
    expect(state.filter.repos).toEqual(['back']);
    expect(state.foldedGroups).toEqual(['g']);
    expect(shelfOpen('working', state.toggledShelves)).toBe(true);
    expect(shelfOpen('parked', state.toggledShelves)).toBe(false);
    expect(shelfOpen('drafts', state.toggledShelves)).toBe(true);
    expect(shelfOpen('working', ['r|working'], 'r')).toBe(true);
  });
});
