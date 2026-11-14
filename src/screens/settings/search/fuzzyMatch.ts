/**
 * The desktop Settings search's matcher, ported from apps/desktop/src/app/window/settings_modal/search.rs
 * (`SearchPattern`), reduced to whether a text matches. The phone and the desktop decide a match the same way, so a
 * word that finds a setting on one finds it on the other.
 *
 * CDXC:Settings 2026-11-15 DECISION:
 * User: "searching for spaces shows a lot of sidebar pages that dont have spaces in the sidebar of settings pls fix".
 * Both searches were Fuse.js's Bitap match (`threshold: 0.24`, `ignoreLocation`): the query anywhere inside a text,
 * one typo forgiven in six letters, so "spaces" found "workspaces", "Monospace", "SpaceO", "Spacegray", "spacing"
 * and every passing "a space". A text now matches when every query word finds one of its words: from the word's
 * start, as the plural of a word in a name (a title, choice or search word, not a description), or (query words of
 * `MIN_TYPO_WORD_LEN` letters and more) one typo away.
 *
 * Kept free of React Native.
 */

/** The shortest query word a single typo is forgiven in: "spaces" is one letter from "SpaceO", "theme" from "there". */
const MIN_TYPO_WORD_LEN = 7;

/** JavaScript `trim`, as the desktop's `js_trim`. */
export function searchTrim(value: string): string {
  return value.replace(/^[\s﻿]+|[\s﻿]+$/gu, '');
}

/** The lower-cased words of a text: runs of letters and digits, as code points. */
function wordsOf(text: string): string[][] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .map((word) => Array.from(word));
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((unit, index) => unit === b[index]);
}

/** Whether two words are at most one edit apart (a letter added, dropped, changed, or two neighbours swapped). */
function withinOneEdit(a: readonly string[], b: readonly string[]): boolean {
  if (same(a, b)) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  let prefix = 0;
  while (prefix < short.length && short[prefix] === long[prefix]) prefix += 1;
  if (short.length === long.length) {
    const rest = prefix + 1;
    return (
      same(short.slice(rest), long.slice(rest)) ||
      (rest < short.length &&
        short[prefix] === long[rest] &&
        short[rest] === long[prefix] &&
        same(short.slice(rest + 1), long.slice(rest + 1)))
    );
  }
  // One letter dropped from the longer word.
  return same(short.slice(prefix), long.slice(prefix + 1));
}

/**
 * Whether query word `query` finds text word `word`: the word starts with it, it is the plural of a name (`plural`:
 * "spaces" finds the title "Go to Space 1"), or, for a long query word, the two (or the word's start) are one typo apart.
 */
function wordMatches(query: readonly string[], word: readonly string[], plural: boolean): boolean {
  if (query.length <= word.length && same(query, word.slice(0, query.length))) return true;
  if (plural && query.length > 3 && query[query.length - 1] === 's') {
    const singular = query.slice(0, -1);
    if (same(word, singular)) return true;
    if (singular[singular.length - 1] === 'e' && same(word, singular.slice(0, -1))) return true;
  }
  if (query.length < MIN_TYPO_WORD_LEN || query[0] !== word[0]) return false;
  for (let length = query.length - 1; length <= query.length + 1; length += 1) {
    if (length <= word.length && withinOneEdit(query, word.slice(0, length))) return true;
  }
  return false;
}

/** A Settings search query, split into the words a text must hold to match. */
export class SearchPattern {
  private readonly words: string[][];
  /** A query with no letters or digits ("+", "/") matches as plain text. */
  private readonly raw: string;

  constructor(query: string) {
    this.words = wordsOf(query);
    this.raw = query.toLowerCase();
  }

  /**
   * Whether `text` holds every query word. A plural query word finds its singular in a name, not in a description
   * (`prose`), whose passing "a space" or "empty space" is not about Spaces.
   */
  matches(text: string, prose = false): boolean {
    if (this.words.length === 0) return this.raw !== '' && text.toLowerCase().includes(this.raw);
    const textWords = wordsOf(text);
    return this.words.every((query) => textWords.some((word) => wordMatches(query, word, !prose)));
  }
}

/** Whether any non-blank text matches; `prose` for descriptions. */
export function anyMatches(pattern: SearchPattern, texts: readonly string[], prose = false): boolean {
  return texts.some((text) => searchTrim(text) !== '' && pattern.matches(text, prose));
}
