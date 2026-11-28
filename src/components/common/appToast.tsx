/**
 * A short notice anywhere in the app: `showToast("No microphone permission.")` fades the app's own toast
 * (`NoticeToast`) in above the bottom of the screen and away by itself. `ToastHost` sits once at the app's root.
 *
 * CDXC:PhoneDialogs 2026-11-28 DECISION:
 * User, picking from the dialogs page: short notices use the app's own toast on both phones, in place of Android's
 * system toast and the title-only system alert iOS showed for the same message.
 */

import { useSyncExternalStore } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import NoticeToast, { type Notice } from './NoticeToast';
import { useKeyboardTop } from './keyboard/keyboardFrame';

let notice: Notice | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

export function showToast(message: string, { error = false }: { error?: boolean } = {}): void {
  if (message.length === 0) return;
  notice = { id: nextId++, message, error, announce: true };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Clear of the bottom bars and the home indicator, or just above the keyboard while it is up. */
export function ToastHost() {
  const shown = useSyncExternalStore(subscribe, () => notice);
  const insets = useSafeAreaInsets();
  const windowHeight = useWindowDimensions().height;
  const keyboardTop = useKeyboardTop();
  const bottom = keyboardTop !== null ? windowHeight - keyboardTop + 16 : insets.bottom + 96;
  return <NoticeToast notice={shown} bottom={bottom} />;
}
