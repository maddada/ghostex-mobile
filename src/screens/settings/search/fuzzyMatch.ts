/**
 * The desktop Settings search's matcher, ported from apps/desktop/src/app/window/settings_modal/search.rs (itself the
 * Fuse.js 7.3.0 Bitap search with `threshold: 0.24`, `ignoreLocation`), reduced to whether a text matches. The phone
 * and the desktop decide a match the same way, so a word that finds a setting on one finds it on the other.
 *
 * Kept free of React Native.
 */

/** Fuse's `threshold` in the desktop's `getSettingsSectionSearch`. */
const SEARCH_THRESHOLD = 0.24;
/** Fuse's machine word size: longer patterns are searched in 32-character chunks. */
const MAX_BITS = 32;

type Chunk = { readonly pattern: string; readonly alphabet: ReadonlyMap<number, number>; readonly start: number };

/** JavaScript `trim`, as the desktop's `js_trim`. */
export function searchTrim(value: string): string {
  return value.replace(/^[\s﻿]+|[\s﻿]+$/gu, '');
}

/** A lower-cased Fuse pattern, split into the chunks Fuse searches. */
export class SearchPattern {
  readonly pattern: string;
  private readonly chunks: readonly Chunk[];

  constructor(query: string) {
    this.pattern = query.toLowerCase();
    const chunks: Chunk[] = [];
    const add = (chunk: string, start: number): void => {
      const alphabet = new Map<number, number>();
      for (let index = 0; index < chunk.length; index += 1) {
        const unit = chunk.charCodeAt(index);
        alphabet.set(unit, ((alphabet.get(unit) ?? 0) | (1 << (chunk.length - index - 1))) >>> 0);
      }
      chunks.push({ pattern: chunk, alphabet, start });
    };
    const length = this.pattern.length;
    if (length > MAX_BITS) {
      const remainder = length % MAX_BITS;
      const end = length - remainder;
      for (let index = 0; index < end; index += MAX_BITS) add(this.pattern.slice(index, index + MAX_BITS), index);
      if (remainder > 0) add(this.pattern.slice(length - MAX_BITS), length - MAX_BITS);
    } else if (length > 0) {
      add(this.pattern, 0);
    }
    this.chunks = chunks;
  }

  /** `BitapSearch.searchIn(text).isMatch`. */
  matches(text: string): boolean {
    const lower = text.toLowerCase();
    if (this.pattern === lower) return true;
    return this.chunks.some((chunk) => bitapIsMatch(lower, chunk.pattern, chunk.alphabet, chunk.start));
  }
}

/**
 * Fuse's `search()` with `ignoreLocation: true`, `findAllMatches: false` and `minMatchCharLength: 1`, reduced to its
 * `isMatch`: a score is `errors / patternLen`, everything else kept as Fuse (and the desktop port) has it.
 */
function bitapIsMatch(text: string, pattern: string, alphabet: ReadonlyMap<number, number>, location: number): boolean {
  const patternLen = pattern.length;
  const textLen = text.length;
  const expectedLocation = Math.min(location, textLen);
  const score = (errors: number): number => errors / patternLen;
  let currentThreshold = SEARCH_THRESHOLD;
  let bestLocation = expectedLocation;
  // Exact matches first: each one lowers the threshold to 0.
  for (let index = text.indexOf(pattern, Math.max(0, bestLocation)); index !== -1;) {
    currentThreshold = Math.min(currentThreshold, 0);
    bestLocation = index + patternLen;
    index = text.indexOf(pattern, bestLocation);
  }
  bestLocation = -1;
  let lastBitArr: number[] = [];
  let binMax = patternLen + textLen;
  const mask = (1 << (patternLen - 1)) >>> 0;
  const get = (array: readonly number[], index: number): number => (index < 0 ? 0 : (array[index] ?? 0));
  for (let errors = 0; errors < patternLen; errors += 1) {
    let binMin = 0;
    let binMid = binMax;
    while (binMin < binMid) {
      if (score(errors) <= currentThreshold) binMin = binMid;
      else binMax = binMid;
      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }
    binMax = binMid;
    let start = Math.max(1, expectedLocation - binMid + 1);
    const finish = Math.min(expectedLocation + binMid, textLen) + patternLen;
    const bitArr: number[] = new Array<number>(Math.max(0, finish + 2)).fill(0);
    if (finish + 1 < bitArr.length) bitArr[finish + 1] = ((1 << errors) - 1) >>> 0;
    for (let j = finish; j >= start; j -= 1) {
      const currentLocation = j - 1;
      const charMatch =
        currentLocation >= 0 && currentLocation < textLen ? (alphabet.get(text.charCodeAt(currentLocation)) ?? 0) : 0;
      let value = (((get(bitArr, j + 1) << 1) | 1) & charMatch) >>> 0;
      if (errors > 0) {
        value = (value | (((get(lastBitArr, j + 1) | get(lastBitArr, j)) << 1) | 1 | get(lastBitArr, j + 1))) >>> 0;
      }
      bitArr[j] = value;
      if ((value & mask) !== 0) {
        const finalScore = score(errors);
        if (finalScore <= currentThreshold) {
          currentThreshold = finalScore;
          bestLocation = currentLocation;
          if (bestLocation <= expectedLocation) break;
          start = Math.max(1, 2 * expectedLocation - bestLocation);
        }
      }
    }
    if (score(errors + 1) > currentThreshold) break;
    lastBitArr = bitArr;
  }
  return bestLocation >= 0;
}

/** Whether any non-blank text matches, as Fuse includes an item when one of its keys matches. */
export function anyMatches(pattern: SearchPattern, texts: readonly string[]): boolean {
  return texts.some((text) => searchTrim(text) !== '' && pattern.matches(text));
}
