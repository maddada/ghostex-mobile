/**
 * Send / Stop / Queue (`send_control.rs`, React's `session-chat-composer.tsx` send button).
 *
 * - With text: tap sends; a hold of `interaction.queueLongPressMs` queues instead (the only queue
 *   gesture a phone has). A blocked Send stays pressable and dimmed; pressing it raises the core's
 *   toast rather than locking the composer.
 * - Without text while the agent works: Stop (`interrupt`), then held for
 *   `interaction.stopButtonCooldownMs` so a second tap cannot land on the next turn.
 */

import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function SendControl({
  document,
  hasDraft,
  ready,
  pendingSend,
  submit,
  dispatch,
}: {
  document: ChatDocument | null;
  hasDraft: boolean;
  ready: boolean;
  pendingSend: boolean;
  submit: NonNullable<RustChat['composer']>['submit'];
  dispatch: (action: UserAction) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [cooling, setCooling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The current press already fired its hold. Queuing empties the composer, which turns this
   * button into Stop under the finger; a release that then ran `onPress` interrupted the agent the
   * prompt had just been queued behind. So a press does one thing: its hold or its tap.
   */
  const heldThisPress = useRef(false);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const working = document?.working === true;
  const stop = (working || cooling) && !hasDraft;
  const pendingAttachments = document?.pendingAttachments ?? 0;
  const disabled = stop ? cooling : !hasDraft || !ready || pendingSend || pendingAttachments > 0;
  const blocked = !stop && typeof document?.sendBlockedReason === 'string';
  const canQueue = hasDraft && !pendingSend && document?.queue.capabilities.canQueue === true;
  const holdMs = document?.interaction.queueLongPressMs ?? 500;

  const onStop = (): void => {
    if (cooling) return;
    const cooldown = document?.interaction.stopButtonCooldownMs;
    if (typeof cooldown === 'number') {
      setCooling(true);
      timer.current = setTimeout(() => {
        timer.current = null;
        setCooling(false);
      }, cooldown);
    }
    dispatch({ type: 'interrupt' });
  };

  const label = stop ? 'Stop the agent' : canQueue ? 'Send (hold to queue)' : 'Send';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      delayLongPress={holdMs}
      hitSlop={6}
      onPressIn={() => {
        heldThisPress.current = false;
      }}
      onPress={() => {
        if (heldThisPress.current) return;
        if (stop) onStop();
        else submit('send');
      }}
      onLongPress={() => {
        heldThisPress.current = true;
        // A hold is the queue gesture; where there is nothing to queue it does what a tap does.
        if (stop) onStop();
        else if (canQueue) {
          if (submit('queue')) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } else submit('send');
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: stop ? P.send.stopFill : P.send.fill },
        stop ? styles.stopBorder : null,
        disabled || blocked ? styles.dim : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {!stop && pendingAttachments > 0 ? (
        <ActivityIndicator size="small" color={P.send.ink} />
      ) : (
        <Glyph
          name={stop ? 'player-stop-filled' : 'arrow-up'}
          size={stop ? 12 : 16}
          color={stop ? P.send.stopInk : P.send.ink}
          strokeWidth={2.4}
        />
      )}
    </Pressable>
  );
}

const useStyles = themedStyles((P) => ({
  button: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  stopBorder: { borderWidth: 1, borderColor: P.send.stopBorder },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
}));
