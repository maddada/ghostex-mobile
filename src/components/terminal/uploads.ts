import { execRemoteScript, remoteUploadPath } from '../../remote/commands';
import { windowsAttachmentPath } from '../../remote/files';
/**
 * File attach & send flow (terminal-screen.md §5):
 * document picker (Files) or image picker (photo library) → remote temp path
 * via `GhostexNative.exec` (exact script from the spec, sanitized filename) →
 * SFTP upload → insert `[<title>](<remotePath>)` into the terminal, where
 * title = "Image #N" / "File #N" with module-scoped per-kind counters. Both
 * pickers share the same post-pick pipeline; only the source differs.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

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

/*
 * Session Chat upload destinations. The desktop and web hosts reach gxserver
 * over HTTP, so their chat attachments are written by saveSessionChatImage /
 * saveSessionChatAttachment into the resolved Ghostex data directory's `i`
 * and `f` folders on the machine that runs the session. The phone has no HTTP
 * path to gxserver and SFTPs the bytes itself, so it stages
 * the same two directories with the same naming instead of dropping chat
 * attachments in the terminal flow's temp directory — the reference the agent
 * receives has to name a stable Ghostex path, not a file the OS may reap.
 */

/** Image extensions gxserver's session_chat_image_extension recognizes. */
const CHAT_IMAGE_EXTENSIONS = [
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
];

/**
 * Extension for a chat image, mirroring gxserver: the suggested name's
 * extension when it is a known image one (jpeg normalized to jpg), otherwise
 * sniffed from the payload's leading bytes, otherwise png.
 */
export function sessionChatImageExtension(base64Data: string, suggestedName?: string): string {
  const suggested = suggestedName?.split('.').pop()?.toLowerCase() ?? '';
  if (CHAT_IMAGE_EXTENSIONS.includes(suggested)) {
    return suggested === 'jpeg' ? 'jpg' : suggested;
  }
  // Base64 is deterministic per leading byte triple, so the magic numbers can
  // be matched on the encoded prefix without decoding the whole payload.
  if (base64Data.startsWith('iVBORw0KGgo')) return 'png';
  if (base64Data.startsWith('/9j/')) return 'jpg';
  if (base64Data.startsWith('R0lGOD')) return 'gif';
  if (base64Data.startsWith('UklGR')) return 'webp';
  if (base64Data.startsWith('Qk')) return 'bmp';
  return 'png';
}

/**
 * Flat, portable file name for a chat attachment, mirroring gxserver's
 * sanitized_session_chat_attachment_name (path segments dropped, everything
 * outside [A-Za-z0-9._-] replaced, leading/trailing dots and dashes trimmed,
 * capped at 80 characters). Returns null when nothing usable remains.
 */
export function sanitizeSessionChatAttachmentName(suggestedName: string): string | null {
  const base = suggestedName.split(/[/\\]/).pop()?.trim() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return cleaned.length === 0 ? null : cleaned.slice(0, 80);
}

/**
 * Script that creates the resolved Ghostex data subdirectory on the machine
 * and prints the first free `<prefix><tail>` path in it, falling back to `<prefix>-<n><tail>`
 * exactly like gxserver's unique_session_chat_*_path helpers. Both arguments
 * are already sanitized to [A-Za-z0-9._-], so they interpolate safely.
 */
export function remoteSessionChatUploadPathScript(directory: 'i' | 'f', prefix: string, tail: string): string {
  return [
    'case "${GHOSTEX_HOME:-}" in',
    '  /*) ghostex_data_dir="${GHOSTEX_HOME%/}" ;;',
    '  *) case "${XDG_DATA_HOME:-}" in',
    '       /*) ghostex_data_dir="${XDG_DATA_HOME%/}/ghostex" ;;',
    '       *) ghostex_data_dir="$HOME/.local/share/ghostex" ;;',
    '     esac ;;',
    'esac',
    `upload_dir="$ghostex_data_dir/${directory}"`,
    'mkdir -p "$upload_dir" || exit 1',
    `target_path="$upload_dir/${prefix}${tail}"`,
    'index=2',
    'while [ -e "$target_path" ] && [ "$index" -lt 100 ]; do',
    `  target_path="$upload_dir/${prefix}-\${index}${tail}"`,
    '  index=$((index + 1))',
    'done',
    `printf '%s\\n' "$target_path"`,
  ].join('\n');
}

/** file:// URI → local filesystem path for the native SFTP upload. */
export function localPathFromUri(uri: string): string {
  const withoutScheme = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

export type AttachmentUploadResult = 'sent' | 'cancelled';

/**
 * Delivers the finished `[Title](remotePath)` reference. The terminal view
 * types it into the PTY; the Session Chat view has no PTY in front of the
 * user, so it sends the reference as a chat message instead.
 */
export type AttachmentReferenceSink = (reference: string) => Promise<void>;

/**
 * Everything after a picker hands back one local asset: stage the remote path,
 * upload the bytes, and deliver the markdown-style reference. Shared by the
 * document-picker and photo-library entry points so both produce identical
 * references and share the per-kind title counters.
 */
async function sendPickedAttachment(
  machineId: string,
  sessionKey: string,
  picked: { localUri: string; name: string; isImage: boolean },
  deliver?: AttachmentReferenceSink
): Promise<AttachmentUploadResult> {
  const sanitized = sanitizeAttachmentFilename(picked.name);
  const exec = await execRemoteScript(
    machineId,
    { posix: remoteAttachmentPathScript(sanitized), powershell: windowsAttachmentPath(sanitized) },
    REMOTE_PATH_EXEC_TIMEOUT_MS
  );
  const remotePath = exec.stdout.trim().split('\n').pop()?.trim() ?? '';
  if (exec.exitCode !== 0 || remotePath.length === 0) {
    throw new Error(exec.stderr.trim().length > 0 ? exec.stderr.trim() : 'Remote path creation failed.');
  }

  await GhostexNative.uploadFile(
    machineId,
    localPathFromUri(picked.localUri),
    await remoteUploadPath(machineId, remotePath)
  );

  const title = picked.isImage ? `Image #${++imageCounter}` : `File #${++fileCounter}`;
  const reference = `[${title}](${remotePath})`;
  if (deliver !== undefined) {
    await deliver(reference);
  } else {
    // No trailing newline, per spec.
    await GhostexNative.sendText(sessionKey, reference);
  }
  return 'sent';
}

/**
 * Pick one document, stage a remote path, upload, and deliver the
 * markdown-style reference through `deliver` (default: type it into the
 * terminal). Throws on failure (caller shows "Upload Failed"); resolves
 * 'cancelled' when the picker was dismissed.
 */
export async function pickAndSendAttachment(
  machineId: string,
  sessionKey: string,
  deliver?: AttachmentReferenceSink
): Promise<AttachmentUploadResult> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return 'cancelled';
  const asset = result.assets[0];
  if (asset === undefined) return 'cancelled';

  return sendPickedAttachment(
    machineId,
    sessionKey,
    {
      localUri: asset.uri,
      name: asset.name,
      isImage: asset.mimeType?.startsWith('image/') === true,
    },
    deliver
  );
}

/** Extension for a photo-library asset whose name the picker did not supply. */
function imageAssetExtension(mimeType: string | undefined): string {
  const subtype = mimeType?.startsWith('image/') === true ? mimeType.slice('image/'.length) : '';
  const cleaned = subtype.split(';')[0]?.trim().toLowerCase() ?? '';
  if (cleaned.length === 0 || !/^[a-z0-9]+$/.test(cleaned)) return 'jpg';
  return cleaned === 'jpeg' ? 'jpg' : cleaned;
}

/**
 * Photo-library counterpart of `pickAndSendAttachment`. iOS presents PHPicker,
 * which runs out of process and needs no photo-library permission request;
 * Android presents the system photo picker. Single selection, no editing, so
 * the asset arrives as the original file.
 */
export async function pickAndSendImageAttachment(
  machineId: string,
  sessionKey: string,
  deliver?: AttachmentReferenceSink
): Promise<AttachmentUploadResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    allowsEditing: false,
  });
  if (result.canceled) return 'cancelled';
  const asset = result.assets?.[0];
  if (asset === undefined) return 'cancelled';

  const uriName = asset.uri.split('?')[0]?.split('/').pop()?.trim() ?? '';
  const name =
    asset.fileName !== null && asset.fileName !== undefined && asset.fileName.trim().length > 0
      ? asset.fileName
      : uriName.length > 0
        ? uriName
        : `image.${imageAssetExtension(asset.mimeType)}`;

  return sendPickedAttachment(machineId, sessionKey, { localUri: asset.uri, name, isImage: true }, deliver);
}
