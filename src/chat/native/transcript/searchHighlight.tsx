/**
 * Transcript search's word highlight (desktop `search.rs`, `begin_row_find`): every occurrence of
 * the query in a matched row's text gets a background, and the selected one (the core's
 * `activeInRow`) a stronger one.
 *
 * The row frame provides a fresh counter each time it renders, and the text of the row numbers its
 * occurrences against it in the order it renders, which is reading order, so the selected
 * occurrence is the same one desktop marks.
 */

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

export type RowFind = {
  /** Lowercase and trimmed. */
  needle: string;
  background: string;
  activeBackground: string;
  /** The selected occurrence within the row, or null when it is in another row. */
  active: number | null;
  counter: { next: number };
};

export const RowFindContext = createContext<RowFind | null>(null);

export function useRowFind(): RowFind | null {
  return useContext(RowFindContext);
}

/** `text` with each occurrence of the row's query wrapped in a highlighted run. */
export function highlightText(text: string, find: RowFind | null, key: string, style?: StyleProp<TextStyle>): ReactNode {
  const plain = style === undefined ? text : <Text key={key} style={style}>{text}</Text>;
  if (find === null || find.needle.length === 0) return plain;
  const lower = text.toLowerCase();
  // Lowercasing changed the length (a handful of scripts): offsets would not line up, so the
  // text is left plain rather than marked in the wrong place.
  if (lower.length !== text.length) return plain;
  const parts: ReactNode[] = [];
  let at = 0;
  let found = lower.indexOf(find.needle);
  if (found < 0) return plain;
  while (found >= 0) {
    if (found > at) parts.push(text.slice(at, found));
    const occurrence = find.counter.next;
    find.counter.next += 1;
    const end = found + find.needle.length;
    parts.push(
      <Text key={`${key}~${found}`} style={{ backgroundColor: occurrence === find.active ? find.activeBackground : find.background }}>
        {text.slice(found, end)}
      </Text>
    );
    at = end;
    found = lower.indexOf(find.needle, at);
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <Text key={key} style={style}>
      {parts}
    </Text>
  );
}

/**
 * The find for a component that can also render again on its own (it has state of its own, like a
 * table measuring its columns): it numbers its occurrences from where the row's render reached it,
 * every time, instead of from wherever the row's counter stands by then. Call the returned `done`
 * once its text is built; on the row's own render that moves the row's counter past it.
 */
export function useOwnFind(find: RowFind | null): [RowFind | null, () => void] {
  const start = useRef<{ counter: RowFind['counter']; next: number } | null>(null);
  if (find === null) return [null, () => {}];
  const passRender = start.current?.counter !== find.counter;
  if (passRender) start.current = { counter: find.counter, next: find.counter.next };
  const own = { ...find, counter: { next: start.current!.next } };
  return [own, () => {
    if (passRender) find.counter.next = own.counter.next;
  }];
}
