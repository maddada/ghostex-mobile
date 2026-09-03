/**
 * "Test connection" (`.test-connection-area` in mobile-04 / mobile-08): the
 * button plus its result callout. Rendered by the form below the Advanced
 * collapsible, never inside it, so it can be tapped whether or not Advanced is
 * open. The success sentence names what was checked, not just "OK".
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { TailscaleFormCopy } from '../../copy';
import { formStyles } from './styles';
import { runConnectionTest, type ConnectionTestOutcome, type ConnectionTestPlan } from './testConnection';

export type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'done'; outcome: ConnectionTestOutcome };

export type TestConnectionButtonProps = {
  disabled: boolean;
  /** Builds the SSH config from the form's current values. */
  buildPlan: () => Promise<ConnectionTestPlan>;
  /** What the success sentence calls the computer and the SSH user. */
  computerName: string;
  username: string;
  state: TestState;
  onStateChange: (state: TestState) => void;
};

export function useTestState(): [TestState, (state: TestState) => void, () => void] {
  const [state, setState] = useState<TestState>({ kind: 'idle' });
  /** Any edit to a connection-affecting field invalidates the last result. */
  const reset = (): void => setState((current) => (current.kind === 'idle' ? current : { kind: 'idle' }));
  return [state, setState, reset];
}

export default function TestConnectionButton({
  disabled,
  buildPlan,
  computerName,
  username,
  state,
  onStateChange,
}: TestConnectionButtonProps) {
  const copy = TailscaleFormCopy.test;
  const testing = state.kind === 'testing';

  const run = async (): Promise<void> => {
    if (disabled || testing) return;
    onStateChange({ kind: 'testing' });
    let outcome: ConnectionTestOutcome;
    try {
      outcome = await runConnectionTest(await buildPlan());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = { ok: false, message, reasonCode: 'unknown' };
    }
    onStateChange({ kind: 'done', outcome });
  };

  return (
    <View style={formStyles.stack}>
      <SetupButton
        label={testing ? copy.testing : copy.button}
        busy={testing}
        disabled={disabled}
        onPress={() => void run()}
      />
      {state.kind === 'done' ? (
        state.outcome.ok ? (
          <View style={formStyles.okCallout}>
            <Text style={formStyles.okCalloutText}>
              {state.outcome.version === null
                ? copy.successNoCli(computerName, username)
                : copy.success(computerName, username, state.outcome.version, state.outcome.sessionCount)}
            </Text>
          </View>
        ) : (
          <View style={formStyles.errorCallout}>
            <Text style={formStyles.errorCalloutText}>{state.outcome.message}</Text>
          </View>
        )
      ) : null}
    </View>
  );
}
