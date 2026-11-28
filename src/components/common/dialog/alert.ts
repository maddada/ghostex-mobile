/**
 * `showAlert(title, message, buttons, options)`: the app's own replacement for React Native's `Alert.alert`, with the
 * same arguments, so a call site changes only its import. It queues the question and `AlertHost` shows it as a
 * Ghostex dialog sheet (`DialogSheet`), one at a time in the order asked, like the system alerts did.
 *
 * CDXC:PhoneDialogs 2026-11-28 DECISION:
 * User: "I don't like the default look of [modals] of Android. Please fix it so that we have consistently good
 * looking [modals] in the mobile app on Android and iOS and I don't wanna use the system one. We should just use
 * something that we make." Every `Alert.alert` became this, drawn as one bottom sheet on both phones: stacked
 * full-width buttons (the action on top, Cancel under it), a red label on a soft red tint for a destructive one,
 * three or more choices as rows, and Android's Back, a tap outside or a drag down acting as Cancel (or OK on a
 * notice with no Cancel).
 *
 * How the buttons map: a button with `style: 'cancel'` is the Cancel at the bottom (the last one wins, as on iOS);
 * every other button is an action above it. With no buttons the sheet shows one OK. With three or more buttons in
 * all, the actions are rows and Cancel a button under them. A button's `onPress` runs once the sheet has gone,
 * as UIAlertController runs its handler after dismissing, so an action that opens another sheet or screen opens
 * it cleanly.
 */

import type { AlertButton, AlertOptions } from 'react-native';

export type AlertRequest = {
  readonly id: number;
  readonly title: string;
  readonly message: string | undefined;
  readonly buttons: readonly AlertButton[];
  readonly options: AlertOptions | undefined;
};

type State = {
  /** The questions asked, oldest first: the first is the one shown. */
  readonly queue: readonly AlertRequest[];
  /** Set once the shown question is answered: its sheet is leaving and then runs `answer`. */
  readonly closing: { readonly id: number; readonly answer: () => void } | null;
};

let state: State = { queue: [], closing: null };
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeAlerts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function alertState(): State {
  return state;
}

/** Ask a question or show a notice as a Ghostex dialog sheet. Same arguments as React Native's `Alert.alert`. */
export function showAlert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void {
  const request: AlertRequest = {
    id: nextId++,
    title,
    message: message !== undefined && message.length > 0 ? message : undefined,
    buttons: buttons !== undefined && buttons.length > 0 ? buttons : [{ text: 'OK' }],
    options,
  };
  set({ ...state, queue: [...state.queue, request] });
}

/** The Cancel button of a request: the last button styled `cancel`, as on iOS. */
export function cancelButtonOf(request: AlertRequest): AlertButton | undefined {
  return [...request.buttons].reverse().find((button) => button.style === 'cancel');
}

/** The action buttons, in the order given, without the Cancel. */
export function actionButtonsOf(request: AlertRequest): AlertButton[] {
  const cancel = cancelButtonOf(request);
  return request.buttons.filter((button) => button !== cancel);
}

/** Answer the shown question with one of its buttons: its sheet leaves, then the button's `onPress` runs. */
export function answerAlert(id: number, button: AlertButton): void {
  const shown = state.queue[0];
  if (shown === undefined || shown.id !== id || state.closing !== null) return;
  set({ ...state, closing: { id, answer: () => button.onPress?.(button.text) } });
}

/**
 * Back, a tap outside or a drag down: the Cancel button's `onPress`, or else the only button's (a notice's OK),
 * or else `options.onDismiss` (React Native's own dismissal callback).
 */
export function dismissAlert(id: number): void {
  const shown = state.queue[0];
  if (shown === undefined || shown.id !== id || state.closing !== null) return;
  const cancel = cancelButtonOf(shown);
  const only = shown.buttons.length === 1 ? shown.buttons[0] : undefined;
  const button = cancel ?? only;
  set({
    ...state,
    closing: {
      id,
      answer: () => {
        if (button !== undefined) button.onPress?.(button.text);
        else shown.options?.onDismiss?.();
      },
    },
  });
}

/** The sheet of the shown question has finished leaving: drop it, run its answer, show the next one. */
export function alertClosed(id: number): void {
  const closing = state.closing;
  if (closing === null || closing.id !== id) return;
  set({ queue: state.queue.filter((request) => request.id !== id), closing: null });
  closing.answer();
}

/**
 * Android's Back inside a Modal goes to that Modal's `onRequestClose`, not to a sheet drawn in it. A Modal that
 * hosts an `AlertOutlet` calls this first: true when it cancelled the question shown there, so the Modal stays.
 */
export function cancelShownAlert(): boolean {
  const shown = state.queue[0];
  if (shown === undefined) return false;
  if (state.closing === null) dismissAlert(shown.id);
  return true;
}
