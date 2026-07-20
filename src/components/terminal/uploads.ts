/**
 * File attach & send flow (terminal-screen.md §5):
 * document picker → remote temp path via `GhostexNative.exec` (exact script
 * from the spec, sanitized filename) → SFTP upload → insert
 * `[<title>](<remotePath>)` into the terminal, where title = "Image #N" /
 * "File #N" with module-scoped per-kind counters.
 */

import * as DocumentPicker from 'expo-document-picker';

import { GhostexNative } from '../../../modules/ghostex-native/src';

const REMOTE_PATH_EXEC_TIMEOUT_MS = 20000;

/** Per-kind attachment title counters, module-scoped for the app run. */
let imageCounter = 0;
let fileCounter = 0;

/** Sanitize to [A-Za-z0-9._-]; every other character becomes '-'. */
export function sanitizeAttachmentFilename(name: string): string {
  const trimmed = name.trim();
  const base = trimmed.length > 0 ? trimmed : 'upload.bin';
  return base.replace(/[^A-Za-z0-9._-]/g, '-');
}

/** Remote temp-path creation script, verbatim from the spec (§5). */
export function remoteAttachmentPathScript(sanitizedFilename: string): string {
  return [
    'tmp_base="${TMPDIR:-/tmp}"',
    'attachment_dir="${tmp_base%/}/ghostex-ios-attachments"',
    'mkdir -p "$attachment_dir"',
    'tmp_path="$(mktemp "$attachment_dir/upload-XXXXXX")"',
    `target_path="\${tmp_path}-${sanitizedFilename}"`,
    'mv "$tmp_path" "$target_path"',
    `printf '%s\\n' "$target_path"`,
  ].join('\n');
}

/** file:// URI → local filesystem path for the native SFTP upload. */
function localPathFromUri(uri: string): string {
  const withoutScheme = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

export type AttachmentUploadResult = 'sent' | 'cancelled';

/**
 * Pick one document, stage a remote path, upload, and send the markdown-style
 * reference into the terminal. Throws on failure (caller shows "Upload
 * Failed"); resolves 'cancelled' when the picker was dismissed.
 */
export async function pickAndSendAttachment(
  machineId: string,
  sessionKey: string,
): Promise<AttachmentUploadResult> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return 'cancelled';
  const asset = result.assets[0];
  if (asset === undefined) return 'cancelled';

  const sanitized = sanitizeAttachmentFilename(asset.name);
  const exec = await GhostexNative.exec(
    machineId,
    remoteAttachmentPathScript(sanitized),
    REMOTE_PATH_EXEC_TIMEOUT_MS,
  );
  const remotePath = exec.stdout.trim().split('\n').pop()?.trim() ?? '';
  if (exec.exitCode !== 0 || remotePath.length === 0) {
    throw new Error(exec.stderr.trim().length > 0 ? exec.stderr.trim() : 'Remote path creation failed.');
  }

  await GhostexNative.uploadFile(machineId, localPathFromUri(asset.uri), remotePath);

  const isImage = asset.mimeType?.startsWith('image/') === true;
  const title = isImage ? `Image #${++imageCounter}` : `File #${++fileCounter}`;
  // No trailing newline, per spec.
  await GhostexNative.sendText(sessionKey, `[${title}](${remotePath})`);
  return 'sent';
}
