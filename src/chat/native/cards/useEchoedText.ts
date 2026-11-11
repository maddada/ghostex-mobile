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

export function useEchoedText(
  identity: string,
  serverValue: string,
  report: (text: string) => void,
): [string, (text: string) => void, (value: string) => void, (value: string) => void] {
  const [text, setText] = useState(serverValue);
  const sent = useRef<string[]>([]);
  const seen = useRef(serverValue);
  /** Values the core wrote itself that the field already holds in what it reports next (`expect`). */
  const expected = useRef<string[]>([]);
  const currentIdentity = useRef(identity);

  useEffect(() => {
    if (currentIdentity.current !== identity) {
      currentIdentity.current = identity;
      sent.current = [];
      expected.current = [];
      seen.current = serverValue;
      setText(serverValue);
      return;
    }
    if (seen.current === serverValue) return;
    seen.current = serverValue;
    const passing = expected.current.indexOf(serverValue);
    if (passing >= 0) {
      expected.current.splice(passing, 1);
      return;
    }
    expected.current = [];
    const settled = sent.current.indexOf(serverValue);
    if (settled >= 0) {
      // The core caught up with an edit this field made; anything typed since is still on its way.
      sent.current = sent.current.slice(settled + 1);
      return;
    }
    sent.current = [];
    setText(serverValue);
  }, [identity, serverValue]);

  /**
   * The core wrote `value` itself (a dictation typed into this field's draft) while the field holds
   * an edit the core has not answered yet: the document showing `value` on its way must not replace
   * the text.
   */
  const expect = useCallback((value: string) => {
    expected.current.push(value);
  }, []);

  /**
   * The core wrote `value` itself and the field takes it: shown, and not reported back as an edit
   * (the core already has it; a report would be a whole-text write over whatever came after).
   */
  const adopt = useCallback((value: string) => {
    sent.current.push(value);
    setText(value);
  }, []);

  const change = useCallback(
    (next: string) => {
      setText(next);
      if (sent.current[sent.current.length - 1] === next) return;
      sent.current.push(next);
      report(next);
    },
    [report],
  );
  return [text, change, expect, adopt];
}
