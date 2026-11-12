/**
 * Raw DEFLATE (RFC 1951) decoding in plain TypeScript, for the deflated frames a computer sends on an
 * `/api/events` socket opened with `encoding=deflate` (server/src/server/link_compression.rs). One
 * `FrameInflater` per socket: each frame ends at a sync flush and may point back into the 32 KiB of text
 * the frames before it decoded to, as permessage-deflate does with context takeover.
 *
 * CDXC:StateSync 2026-11-12 WHY:
 * Written here rather than taken from a package: React Native's WebSocket has no compression extension on
 * iOS and Hermes has no DecompressionStream, and a new dependency would change the over-the-air runtime
 * (scripts/ota-runtime-version.js), so a compressed link could not reach the phones already installed.
 * SEE-ALSO: server/src/server/link_compression.rs (`FrameDeflater`)
 */

const WINDOW = 32 * 1024;

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: how many codes of each length, and the symbols in code order. */
type Huffman = { counts: Uint16Array; symbols: Uint16Array };

function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16);
  for (let index = 0; index < lengths.length; index += 1) counts[lengths[index]!] += 1;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let length = 1; length < 16; length += 1) offsets[length] = offsets[length - 1]! + counts[length - 1]!;
  const symbols = new Uint16Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol]!;
    if (length !== 0) symbols[offsets[length]!++] = symbol;
  }
  return { counts, symbols };
}

const FIXED_LITERALS = huffman(
  Array.from({ length: 288 }, (_, symbol) => (symbol < 144 ? 8 : symbol < 256 ? 9 : symbol < 280 ? 7 : 8)),
);
const FIXED_DISTANCES = huffman(Array.from({ length: 30 }, () => 5));

class InflateError extends Error {}

class Bits {
  private position = 0;
  private bitBuffer = 0;
  private bitCount = 0;
  constructor(private readonly input: Uint8Array) {}

  /** No more input, or only the zero bits that pad the last byte. */
  atEnd(): boolean {
    return this.position >= this.input.length && (this.bitCount === 0 || (this.bitCount < 8 && this.bitBuffer === 0));
  }

  bits(count: number): number {
    while (this.bitCount < count) {
      if (this.position >= this.input.length) throw new InflateError('Deflate input ended early.');
      this.bitBuffer |= this.input[this.position++]! << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  /** Drops what is left of the current byte (before a stored block's lengths). */
  alignToByte(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  byte(): number {
    if (this.position >= this.input.length) throw new InflateError('Deflate input ended early.');
    return this.input[this.position++]!;
  }

  decode(code: Huffman): number {
    let value = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length < 16; length += 1) {
      value |= this.bits(1);
      const count = code.counts[length]!;
      if (value - first < count) return code.symbols[index + value - first]!;
      index += count;
      first = (first + count) << 1;
      value <<= 1;
    }
    throw new InflateError('Bad Huffman code.');
  }
}

/** A growing byte buffer whose first `WINDOW` bytes or fewer are the text of earlier frames. */
class Output {
  bytes: Uint8Array;
  length: number;
  constructor(history: Uint8Array) {
    this.bytes = new Uint8Array(Math.max(history.length * 2, 64 * 1024));
    this.bytes.set(history);
    this.length = history.length;
  }

  private room(extra: number): void {
    if (this.length + extra <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  }

  push(byte: number): void {
    this.room(1);
    this.bytes[this.length++] = byte;
  }

  copy(distance: number, length: number): void {
    if (distance > this.length) throw new InflateError('Deflate distance reaches before the window.');
    this.room(length);
    let from = this.length - distance;
    for (let index = 0; index < length; index += 1) this.bytes[this.length++] = this.bytes[from++]!;
  }
}

function dynamicCodes(bits: Bits): [Huffman, Huffman] {
  const literalCount = bits.bits(5) + 257;
  const distanceCount = bits.bits(5) + 1;
  const codeLengthCount = bits.bits(4) + 4;
  const codeLengths = new Uint8Array(19);
  for (let index = 0; index < codeLengthCount; index += 1) codeLengths[CODE_LENGTH_ORDER[index]!] = bits.bits(3);
  const codeLengthCode = huffman(codeLengths);
  const lengths = new Uint8Array(literalCount + distanceCount);
  let index = 0;
  while (index < lengths.length) {
    const symbol = bits.decode(codeLengthCode);
    if (symbol < 16) {
      lengths[index++] = symbol;
      continue;
    }
    let repeat: number;
    let value = 0;
    if (symbol === 16) {
      if (index === 0) throw new InflateError('Repeat with no length before it.');
      value = lengths[index - 1]!;
      repeat = 3 + bits.bits(2);
    } else if (symbol === 17) repeat = 3 + bits.bits(3);
    else repeat = 11 + bits.bits(7);
    if (index + repeat > lengths.length) throw new InflateError('Too many code lengths.');
    lengths.fill(value, index, index + repeat);
    index += repeat;
  }
  return [huffman(lengths.subarray(0, literalCount)), huffman(lengths.subarray(literalCount))];
}

function inflateBlocks(bits: Bits, out: Output): void {
  while (!bits.atEnd()) {
    bits.bits(1); // BFINAL: a frame ends at a sync flush, so the stream goes on either way.
    const type = bits.bits(2);
    if (type === 0) {
      bits.alignToByte();
      const length = bits.byte() | (bits.byte() << 8);
      const inverse = bits.byte() | (bits.byte() << 8);
      if ((length ^ 0xffff) !== inverse) throw new InflateError('Stored block length check failed.');
      for (let index = 0; index < length; index += 1) out.push(bits.byte());
      continue;
    }
    if (type === 3) throw new InflateError('Reserved block type.');
    const [literals, distances] = type === 1 ? [FIXED_LITERALS, FIXED_DISTANCES] : dynamicCodes(bits);
    for (;;) {
      const symbol = bits.decode(literals);
      if (symbol < 256) {
        out.push(symbol);
        continue;
      }
      if (symbol === 256) break;
      const lengthIndex = symbol - 257;
      if (lengthIndex >= 29) throw new InflateError('Bad length symbol.');
      const length = LENGTH_BASE[lengthIndex]! + bits.bits(LENGTH_EXTRA[lengthIndex]!);
      const distanceSymbol = bits.decode(distances);
      if (distanceSymbol >= 30) throw new InflateError('Bad distance symbol.');
      const distance = DIST_BASE[distanceSymbol]! + bits.bits(DIST_EXTRA[distanceSymbol]!);
      out.copy(distance, length);
    }
  }
}

/** UTF-8 bytes to text (Hermes has no TextDecoder). Malformed sequences become U+FFFD. */
export function utf8Text(bytes: Uint8Array, start: number, end: number): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  let index = start;
  while (index < end) {
    const first = bytes[index++]!;
    let code = first;
    if (first >= 0xf0 && index + 2 < end) {
      code = ((first & 0x07) << 18) | ((bytes[index]! & 0x3f) << 12) | ((bytes[index + 1]! & 0x3f) << 6) | (bytes[index + 2]! & 0x3f);
      index += 3;
    } else if (first >= 0xe0 && index + 1 < end) {
      code = ((first & 0x0f) << 12) | ((bytes[index]! & 0x3f) << 6) | (bytes[index + 1]! & 0x3f);
      index += 2;
    } else if (first >= 0xc0 && index < end) {
      code = ((first & 0x1f) << 6) | (bytes[index]! & 0x3f);
      index += 1;
    } else if (first >= 0x80) code = 0xfffd;
    if (code > 0xffff) {
      code -= 0x10000;
      chunk.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else chunk.push(code);
    if (chunk.length >= 8192) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  }
  parts.push(String.fromCharCode(...chunk));
  return parts.join('');
}

/** One socket's inflate stream. `frame` throws on bytes that do not decode; the socket is then unusable. */
export class FrameInflater {
  private history = new Uint8Array(0);

  frame(data: ArrayBuffer | Uint8Array): string {
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);
    const out = new Output(this.history);
    const start = this.history.length;
    inflateBlocks(new Bits(input), out);
    const text = utf8Text(out.bytes, start, out.length);
    this.history = out.bytes.slice(Math.max(0, out.length - WINDOW), out.length);
    return text;
  }
}
