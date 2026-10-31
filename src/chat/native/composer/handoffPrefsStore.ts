/**
 * Where the phone keeps what Handoff / Export remembers: a per-client preference, like desktop's
 * prefs file. The rules are `contract/handoff/handoff.ts`'s.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { handoffPrefsJson, parseHandoffPrefs, type HandoffPrefs } from '../../../contract/handoff/handoff';

const PREFS_KEY = 'ghostex.chat.handoffPrefs';
/** What the sheet saved before it remembered more than its mode. */
const OLD_MODE_KEY = 'ghostex.chat.handoffExportMode';

export async function loadHandoffPrefs(): Promise<HandoffPrefs> {
  try {
    const saved = await AsyncStorage.getItem(PREFS_KEY);
    if (saved !== null) return parseHandoffPrefs(JSON.parse(saved));
    return parseHandoffPrefs({ mode: await AsyncStorage.getItem(OLD_MODE_KEY) });
  } catch {
    return parseHandoffPrefs(null);
  }
}

export function saveHandoffPrefs(prefs: HandoffPrefs): void {
  void AsyncStorage.setItem(PREFS_KEY, JSON.stringify(handoffPrefsJson(prefs))).catch(() => undefined);
}
