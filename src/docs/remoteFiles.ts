/**
 * Reads files off the computer for the Docs viewer: many paths per SSH exec, each answered with
 * its bytes as base64, so a page and every image and stylesheet it pulls in cost a few round trips
 * instead of one per file. The phone already has the user's shell on that computer, and a chat
 * link or a Docs row can name any file there, so this reads the path it is given, like the chat's
 * image viewer does.
 */

import { shellQuote } from '../commands/ghostexCli';
import { ensureConnected } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { execRemoteScript } from '../remote/commands';
import { powershellQuote } from '../remote/powershell';

export type RemoteFileRead =
  | { status: 'ok'; base64: string; bytes: number }
  | { status: 'missing' }
  | { status: 'tooLarge' };

/** Printed before the answers, so a login shell's banner never reads as one. */
const ANSWER_MARKER = '__GHOSTEX_DOCS_READ__';
const READ_EXEC_TIMEOUT_MS = 60_000;

/** Runs under `sh`, whatever the account's login shell is (a fish login cannot parse `f() {}`). */
function posixReadScript(paths: readonly string[], maximumBytes: number): string {
  const script = [
    'gx_read() {',
    '  if [ -f "$1" ] && [ -r "$1" ]; then',
    '    gx_size=$(wc -c < "$1" 2>/dev/null | tr -d "[:space:]")',
    `    if [ -n "$gx_size" ] && [ "$gx_size" -le ${maximumBytes} ]; then`,
    "      printf 'ok '; base64 < \"$1\" | tr -d '\\r\\n'; printf '\\n'",
    "    else printf 'large\\n'; fi",
    "  else printf 'missing\\n'; fi",
    '}',
    `printf '%s\\n' ${shellQuote(ANSWER_MARKER)}`,
    ...paths.map((path) => `gx_read ${shellQuote(path)}`),
  ].join('\n');
  return `sh -c ${shellQuote(script)}`;
}

function powershellReadScript(paths: readonly string[], maximumBytes: number): string {
  return `
[Console]::Out.WriteLine(${powershellQuote(ANSWER_MARKER)})
foreach ($gxPath in @(${paths.map(powershellQuote).join(',')})) {
  try {
    $gxFile=Get-Item -LiteralPath $gxPath -ErrorAction Stop
    if ($gxFile.PSIsContainer) { [Console]::Out.WriteLine('missing') }
    elseif ($gxFile.Length -gt ${maximumBytes}) { [Console]::Out.WriteLine('large') }
    else { [Console]::Out.WriteLine('ok ' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($gxFile.FullName))) }
  } catch { [Console]::Out.WriteLine('missing') }
}
`;
}

/** Answers one read per path, in order. Throws only when the computer could not be asked at all. */
export async function readRemoteFiles(
  machine: MachineConnectionTarget,
  paths: readonly string[],
  maximumBytes: number
): Promise<RemoteFileRead[]> {
  if (paths.length === 0) return [];
  await ensureConnected(machine);
  const exec = await execRemoteScript(
    machine.id,
    { posix: posixReadScript(paths, maximumBytes), powershell: powershellReadScript(paths, maximumBytes) },
    READ_EXEC_TIMEOUT_MS
  );
  const lines = exec.stdout.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === ANSWER_MARKER);
  if (start < 0) {
    const detail = exec.stderr.trim() || exec.stdout.trim();
    throw new Error(detail.length > 0 ? detail.split('\n').slice(-1)[0] ?? detail : 'The computer did not answer.');
  }
  const answers = lines.slice(start + 1);
  return paths.map((_, index): RemoteFileRead => {
    const line = (answers[index] ?? '').trim();
    if (line.startsWith('ok')) {
      const base64 = line.slice(2).trim();
      return { status: 'ok', base64, bytes: base64ByteLength(base64) };
    }
    return line === 'large' ? { status: 'tooLarge' } : { status: 'missing' };
  });
}

function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** UTF-8 text from base64 (a leading byte-order mark is dropped). Invalid sequences become U+FFFD. */
export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const chunks: string[] = [];
  let units: number[] = [];
  const flush = () => {
    chunks.push(String.fromCharCode(...units));
    units = [];
  };
  let index = binary.charCodeAt(0) === 0xef && binary.charCodeAt(1) === 0xbb && binary.charCodeAt(2) === 0xbf ? 3 : 0;
  while (index < binary.length) {
    const byte = binary.charCodeAt(index);
    let code = 0xfffd;
    let length = 1;
    if (byte < 0x80) code = byte;
    else if (byte >= 0xc2 && byte < 0xe0) length = 2;
    else if (byte >= 0xe0 && byte < 0xf0) length = 3;
    else if (byte >= 0xf0 && byte < 0xf5) length = 4;
    if (length > 1) {
      let value = byte & (length === 2 ? 0x1f : length === 3 ? 0x0f : 0x07);
      let valid = index + length <= binary.length;
      for (let offset = 1; valid && offset < length; offset += 1) {
        const next = binary.charCodeAt(index + offset);
        if ((next & 0xc0) !== 0x80) valid = false;
        else value = (value << 6) | (next & 0x3f);
      }
      if (valid && !(length === 3 && value < 0x800) && !(length === 4 && (value < 0x10000 || value > 0x10ffff))) {
        code = value;
      } else {
        length = 1;
      }
    }
    if (code > 0xffff) {
      code -= 0x10000;
      units.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      units.push(code);
    }
    index += length;
    if (units.length >= 8192) flush();
  }
  flush();
  return chunks.join('');
}
