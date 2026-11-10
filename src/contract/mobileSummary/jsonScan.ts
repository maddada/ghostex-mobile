/**
 * Resilient JSON extraction: a brace-matching scan tolerant of shell banners.
 * Part of the mobile summary contract (`./index.ts`).
 */

// ---------------------------------------------------------------------------
// Resilient JSON extraction (brace-matching scan tolerant of shell banners).
// ---------------------------------------------------------------------------

/**
 * Return the complete JSON object text starting at `start` (which must index a
 * '{'), or null when the braces never balance before end of output.
 */
function extractJsonObjectAt(output: string, start: number): string | null {
  let inString = false;
  let escaping = false;
  let depth = 0;
  for (let index = start; index < output.length; index++) {
    const value = output[index];
    if (inString) {
      if (escaping) escaping = false;
      else if (value === '\\') escaping = true;
      else if (value === '"') inString = false;
      continue;
    }
    if (value === '"') inString = true;
    else if (value === '{') depth++;
    else if (value === '}') {
      depth--;
      if (depth === 0) return output.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * Scan `output` for balanced `{...}` blocks starting at each '{' from
 * `fromIndex`, invoking `visit` with each block's text and start index.
 * `visit` returns the next scan index (or null to stop and return its result).
 */
export function scanJsonObjects<T>(
  output: string,
  visit: (text: string, start: number) => { done: true; result: T } | { done: false; nextIndex: number },
): T | null {
  let searchStart = 0;
  while (searchStart < output.length) {
    const start = output.indexOf('{', searchStart);
    if (start < 0) return null;
    const candidate = extractJsonObjectAt(output, start);
    if (candidate === null) {
      searchStart = start + 1;
      continue;
    }
    const outcome = visit(candidate, start);
    if (outcome.done) return outcome.result;
    searchStart = outcome.nextIndex;
  }
  return null;
}
