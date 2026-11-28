/**
 * Where `showAlert()` questions are drawn. `AlertHost` sits once at the app's root and shows them in a Modal of their
 * own. A component that is itself a Modal (a sheet, an editor's form) renders an `AlertOutlet` as its last child:
 * while it is open, questions asked are drawn inside it instead.
 *
 * WHY: iOS presents a React Native Modal from the root view controller, which cannot present a second one while
 * a sheet is up, so a question asked from inside a sheet (Delete saved prompt?) would never show from the root.
 * The system alerts did not have this problem; drawing in the top-most open Modal keeps that behaviour without a
 * native change, so it ships over the air. Android's Back inside such a Modal reaches the Modal's own
 * `onRequestClose`, which calls `cancelShownAlert()` first (`closeOrCancelAlert`).
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import DialogSheet, { type DialogSheetProps } from './DialogSheet';
import { DialogButton, DialogButtons, DialogMessage, DialogRow, DialogRows, DialogTitle } from './DialogParts';
import {
  actionButtonsOf,
  alertClosed,
  alertState,
  answerAlert,
  cancelButtonOf,
  cancelShownAlert,
  dismissAlert,
  subscribeAlerts,
  type AlertRequest,
} from './alert';

/** How long the root's sheet may take to present before it is presented again (iOS). */
const PRESENT_RETRY_MS = 700;

const ROOT = 'root';
/** A sheet that hosts an outlet is still leaving: nothing is drawn until it has gone. */
const WAIT = 'wait';

/** The outlets of the open Modals, in the order they opened; the last active one draws the question. */
let outlets: { readonly key: string; readonly active: boolean }[] = [];
const outletListeners = new Set<() => void>();
let target = ROOT;

function updateOutlets(next: typeof outlets): void {
  outlets = next;
  // While a Modal that hosts an outlet is still on screen (sliding away), iOS cannot present the root's Modal yet.
  target = [...outlets].reverse().find((outlet) => outlet.active)?.key ?? (outlets.length > 0 ? WAIT : ROOT);
  for (const listener of outletListeners) listener();
}

function subscribeOutlets(listener: () => void): () => void {
  outletListeners.add(listener);
  return () => outletListeners.delete(listener);
}

function useAlertTarget(): string {
  return useSyncExternalStore(subscribeOutlets, () => target);
}

function useAlerts() {
  return useSyncExternalStore(subscribeAlerts, alertState);
}

/** The root host: questions asked while no other Modal is open. Mount once, at the app's root. */
export function AlertHost() {
  const { queue, closing } = useAlerts();
  const shown = queue[0];
  if (useAlertTarget() !== ROOT || shown === undefined) return null;
  return <AlertSheet key={shown.id} request={shown} leaving={closing?.id === shown.id} inline={false} />;
}

/**
 * Draws questions inside the Modal it is rendered in while `active` (the Modal's `visible`). Render it as the
 * Modal's last child, for as long as the Modal is mounted: while it slides away (`active` false) questions wait
 * for it to go and then show from the root.
 */
export function AlertOutlet({ active }: { active: boolean }) {
  const key = useId();
  useEffect(() => {
    const index = outlets.findIndex((outlet) => outlet.key === key);
    updateOutlets(
      index < 0
        ? [...outlets, { key, active }]
        : outlets.map((outlet) => (outlet.key === key ? { key, active } : outlet)),
    );
  }, [key, active]);
  useEffect(() => () => updateOutlets(outlets.filter((outlet) => outlet.key !== key)), [key]);
  const { queue, closing } = useAlerts();
  const shown = queue[0];
  if (useAlertTarget() !== key || shown === undefined) return null;
  return <AlertSheet key={shown.id} request={shown} leaving={closing?.id === shown.id} inline />;
}

/**
 * A Modal's `onRequestClose` when it hosts an `AlertOutlet`: Android's Back goes to the Modal, so it cancels the
 * question drawn in it first, and closes the Modal only when there is none.
 */
export function closeOrCancelAlert(close: () => void): () => void {
  return () => {
    if (target === ROOT || target === WAIT || !cancelShownAlert()) close();
  };
}

/**
 * A `DialogSheet` in a Modal of its own that also hosts questions asked while it is open (`ConfirmDialog`,
 * `PromptDialog`, `ActionSheet`).
 */
export function HostedDialogSheet(props: DialogSheetProps) {
  return (
    <DialogSheet
      {...props}
      inline={false}
      onRequestClose={closeOrCancelAlert(props.onDismiss)}
      overlay={<AlertOutlet active={props.visible} />}
    />
  );
}

function AlertSheet({ request, leaving, inline }: { request: AlertRequest; leaving: boolean; inline: boolean }) {
  const actions = actionButtonsOf(request);
  const cancel = cancelButtonOf(request);
  const asRows = request.buttons.length >= 3;
  // iOS: a Modal opened without an outlet (or still fading out) keeps the root's Modal from presenting, and nothing
  // says so but the missing `onShow`. Present it again until it shows, so the question never waits unseen.
  const [attempt, setAttempt] = useState(0);
  const presented = useRef(false);
  useEffect(() => {
    if (inline || leaving || Platform.OS !== 'ios') return undefined;
    const timer = setTimeout(() => {
      if (!presented.current) setAttempt((current) => current + 1);
    }, PRESENT_RETRY_MS);
    return () => clearTimeout(timer);
  }, [attempt, inline, leaving]);
  // Moved to another host while already leaving (its outlet closed): it has nothing left to show.
  useEffect(() => {
    if (leaving) alertClosed(request.id);
    // Only on mount: a sheet that was shown leaves through `onClosed`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <DialogSheet
      key={attempt}
      visible={!leaving}
      inline={inline}
      onShow={() => {
        presented.current = true;
      }}
      accessibilityLabel={request.title}
      onDismiss={() => dismissAlert(request.id)}
      onClosed={() => alertClosed(request.id)}
    >
      <DialogTitle>{request.title}</DialogTitle>
      {request.message !== undefined ? <DialogMessage>{request.message}</DialogMessage> : null}
      {asRows ? (
        <DialogRows>
          {actions.map((button, index) => (
            <DialogRow
              key={`${index}-${button.text ?? ''}`}
              label={button.text ?? 'OK'}
              destructive={button.style === 'destructive'}
              onPress={() => answerAlert(request.id, button)}
            />
          ))}
        </DialogRows>
      ) : null}
      <DialogButtons style={asRows ? { marginTop: 10 } : null}>
        {asRows
          ? null
          : actions.map((button, index) => (
              <DialogButton
                key={`${index}-${button.text ?? ''}`}
                label={button.text ?? 'OK'}
                kind={button.style === 'destructive' ? 'destructive' : 'primary'}
                onPress={() => answerAlert(request.id, button)}
              />
            ))}
        {cancel !== undefined ? (
          <DialogButton label={cancel.text ?? 'Cancel'} kind="neutral" onPress={() => answerAlert(request.id, cancel)} />
        ) : null}
      </DialogButtons>
    </DialogSheet>
  );
}
