/**
 * A text field whose every edit goes to the core and comes back later in the document.
 *
 * The document's copy lags what the user typed by a round trip, so writing it back into the
 * field would cut the answer short and jump the caret. The field owns what it typed; only a value
 * it never reported (an option pick clearing it, a saved answer restored after load, a new
 * question) replaces the text. Same rule as desktop's `AsyncAnswerEcho` in `async_questions.rs`.
 *
 * CDXC:SessionChat 2026-10-17 WHY: Every chat field whose text goes to the core uses this, never an uncontrolled `defaultValue` fed from the document or a check that writes back any value it did not type last. On Android a stale echo reaches the native field with the newest event count, so it lands as a fresh edit while the keyboard is still composing: gesture (swipe) typing on Samsung Keyboard and Gboard commits a word and its auto-space in quick succession, the echo wiped the space and the keyboard's composition, and swiped words came out joined (the questions form's boxes and the session note did this).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * `[text, change, adopt]`. `change` is the reader's edit (shown and reported). `adopt` shows a text
 * the core handed the field (a dictation, `questions/dictation.rs`) without reporting it, and lets
 * the document's copy of it settle like an edit. `onAdopt` hears when the field takes the
 * document's value in place of what it showed.
 */
export function useEchoedText(
  identity: string,
  serverValue: string,
  report: (text: string) => void,
  onAdopt?: () => void,
): [string, (text: string) => void, (text: string) => void] {
  const [text, setText] = useState(serverValue);
  const sent = useRef<string[]>([]);
  const seen = useRef(serverValue);
  const currentIdentity = useRef(identity);
  const adopted = useRef(onAdopt);
  adopted.current = onAdopt;

  useEffect(() => {
    if (currentIdentity.current !== identity) {
      currentIdentity.current = identity;
      sent.current = [];
      seen.current = serverValue;
      setText(serverValue);
      adopted.current?.();
      return;
    }
    if (seen.current === serverValue) return;
    seen.current = serverValue;
    const settled = sent.current.indexOf(serverValue);
    if (settled >= 0) {
      // The core caught up with an edit this field made; anything typed since is still on its way.
      sent.current = sent.current.slice(settled + 1);
      return;
    }
    sent.current = [];
    setText(serverValue);
    adopted.current?.();
  }, [identity, serverValue]);

  const change = useCallback(
    (next: string) => {
      setText(next);
      if (sent.current[sent.current.length - 1] === next) return;
      sent.current.push(next);
      report(next);
    },
    [report],
  );
  const adopt = useCallback((next: string) => {
    setText(next);
    // The document already shows it: nothing to wait for.
    if (seen.current === next || sent.current[sent.current.length - 1] === next) return;
    sent.current.push(next);
  }, []);
  return [text, change, adopt];
}
