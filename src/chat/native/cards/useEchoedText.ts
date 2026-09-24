/**
 * A text field whose every edit goes to the core and comes back later in the document.
 *
 * The document's copy lags what the user typed by a round trip, so writing it back into the
 * field would cut the answer short and jump the caret. The field owns what it typed; only a value
 * it never reported (an option pick clearing it, a saved answer restored after load, a new
 * question) replaces the text. Same rule as desktop's `AsyncAnswerEcho` in `async_questions.rs`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useEchoedText(
  identity: string,
  serverValue: string,
  report: (text: string) => void
): [string, (text: string) => void] {
  const [text, setText] = useState(serverValue);
  const sent = useRef<string[]>([]);
  const seen = useRef(serverValue);
  const currentIdentity = useRef(identity);

  useEffect(() => {
    if (currentIdentity.current !== identity) {
      currentIdentity.current = identity;
      sent.current = [];
      seen.current = serverValue;
      setText(serverValue);
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
  }, [identity, serverValue]);

  const change = useCallback(
    (next: string) => {
      setText(next);
      if (sent.current[sent.current.length - 1] === next) return;
      sent.current.push(next);
      report(next);
    },
    [report]
  );
  return [text, change];
}
