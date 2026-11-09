/**
 * "Voice call about this chat" (the chat's ⋯ menu) and "Voice Call" (a session's long press): a call
 * about one session, or the open call moved to it.
 *
 * CDXC:VoiceMode 2026-10-23 DECISION: User, asked "Where do you start a voice call about one chat on the phone?", picked "A row in the chat's ⋯ menu, and Voice Call when you long-press a session". The top bar's headset stays the all-sessions call everywhere.
 */

import { Alert } from 'react-native';

import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import { focusVoiceOn, hangUpVoice, startVoice, useVoiceStore, voiceActive } from './conversation';
import { callGbotId, voiceCallAboutAction, type VoiceFocusTarget } from './focus';

/** How long a hang-up may take before the new call starts anyway (gxserver answers `ended` in well under a second). */
const HANG_UP_WAIT_MS = 8_000;

/** The computer's name as the session list shows it. */
function computerName(machineId: string): string {
  const machine = useMachinesStore.getState().machines.find((entry) => entry.id === machineId);
  if (machine === undefined) return 'your computer';
  return machine.name.length > 0 ? machine.name : machine.username;
}

/** Resolves once no call is open (or after `HANG_UP_WAIT_MS`). */
function callClosed(): Promise<void> {
  return new Promise((resolve) => {
    if (!voiceActive(useVoiceStore.getState().phase)) {
      resolve();
      return;
    }
    const timer = setTimeout(done, HANG_UP_WAIT_MS);
    const unsubscribe = useVoiceStore.subscribe((state) => {
      if (!voiceActive(state.phase)) done();
    });
    function done() {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
  });
}

/**
 * Starts a call about `about` on `machine`, or moves the open call there, then `show`s the voice
 * screen.
 *
 * CDXC:VoiceMode 2026-10-23 WHY: A call runs on one computer's gxserver and can't move to another (the
 * other computer has its own key, sessions and bill). So with a call open on computer A, a call about
 * a session on computer B asks first: keep the call, or hang up and start the call about that session
 * on B. Refocusing silently is impossible and starting a second call would leave two calls billing.
 */
export function callVoiceAbout(machine: MachineConnectionTarget, about: VoiceFocusTarget, show: () => void): void {
  const state = useVoiceStore.getState();
  const action = voiceCallAboutAction(
    {
      active: voiceActive(state.phase),
      machineId: state.machineId,
      focus: state.focus,
      gbotId: callGbotId(state.focus, state.requestedFocus),
    },
    { machineId: machine.id, projectId: about.projectId, sessionId: about.sessionId, gbotId: about.gbot?.botId },
  );
  const name = computerName(machine.id);
  const hangUpAndCall = () => {
    hangUpVoice();
    void callClosed().then(() => {
      void startVoice(machine, name, about);
      show();
    });
  };
  switch (action) {
    case 'start':
      void startVoice(machine, name, about);
      show();
      return;
    case 'refocus':
      focusVoiceOn(about);
      show();
      return;
    case 'already':
      show();
      return;
    case 'otherComputer':
      Alert.alert(
        `A voice call is open on ${state.machineName}`,
        about.gbot !== undefined
          ? `A call stays on the computer it started on. Hang up and call ${about.gbot.name} on ${name}?`
          : `A call stays on the computer it started on. Hang up and start a voice call about ${about.title} on ${name}?`,
        [
          { text: 'Keep the call', style: 'cancel' },
          { text: 'Hang up and call', onPress: hangUpAndCall },
        ],
      );
      return;
    case 'replace':
      // A call with a GBot stays with it (gxserver refuses to move it), so this is a new call.
      Alert.alert(
        `A voice call is open on ${name}`,
        about.gbot !== undefined
          ? `Hang up and call ${about.gbot.name}?`
          : `A call with a GBot stays with it. Hang up and start a voice call about ${about.title}?`,
        [
          { text: 'Keep the call', style: 'cancel' },
          { text: 'Hang up and call', onPress: hangUpAndCall },
        ],
      );
  }
}
