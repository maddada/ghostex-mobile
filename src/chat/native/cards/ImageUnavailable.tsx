/**
 * What the image viewer shows in place of a picture it cannot show. Port of desktop
 * `image_viewer/unavailable.rs`: a left-aligned notice card, the crossed photo beside a title that
 * says why, the sentence under it, the file's name and its folder shortened to one line, and Copy
 * path at the bottom right. Desktop's Open image and Show in Finder open the
 * file on the computer; the phone cannot reach the session's machine's files, so it offers only
 * Copy path.
 */

import * as Clipboard from 'expo-clipboard';
import { Pressable, Text, View } from 'react-native';

import { Glyph } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import type { ChatImage } from './overlayStore';
import type { ChatImageFailure } from './useChatImage';

/**
 * The title and sentence for one failure reason: the same words as desktop's `failure_copy`
 * (`apps/desktop/src/app/native_chat/image_viewer/unavailable.rs`); the reasons come from the core's
 * `image_read_failure_reason` plus the renderer's own `damaged` and `unavailable`.
 */
export function imageFailureCopy(failure: ChatImageFailure): { title: string; detail: string } {
  switch (failure.reason) {
    case 'missing':
      return { title: 'Image not found', detail: 'The file was moved or deleted.' };
    case 'tooLarge':
      return { title: "Can't preview this image", detail: 'The file is empty or larger than 20 MB.' };
    case 'notImage':
      return { title: "Can't open this image", detail: "The file isn't a recognized image." };
    case 'unsupported':
      return { title: "Can't open this image", detail: "This image format can't be shown here." };
    case 'damaged':
      return { title: "Can't open this image", detail: 'The file looks damaged or incomplete.' };
    case 'unavailable':
      return { title: 'Image unavailable', detail: 'There is no file or address to load it from.' };
    default:
      return {
        title: "Can't open this image",
        detail: failure.error.trim().length > 0 ? failure.error.trim() : "The file couldn't be read.",
      };
  }
}

/** The folder and the file name of a path written with either separator. */
function splitPath(path: string): { folder: string; file: string } {
  const trimmed = path.replace(/[\\/]+$/, '');
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return at < 0 ? { folder: '', file: trimmed } : { folder: trimmed.slice(0, at), file: trimmed.slice(at + 1) };
}

/** A label that is a whole path, cut to its file name (desktop `file_name_of`). */
export function fileNameOf(label: string): string {
  return label.split(/[\\/]/).filter((segment) => segment.length > 0).pop() ?? label;
}

/**
 * A folder shortened to one readable line, the same way as desktop's `short_folder`: the home
 * folder as `~`, hash-named folders as `…`, and only the first segment and the last three kept
 * when it is still long.
 */
export function shortFolder(folder: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  let segments = folder.split(/[\\/]/);
  const homeAt = segments.findIndex((segment) => segment === 'Users' || segment === 'home');
  if (homeAt >= 0 && homeAt <= 1 && segments.length > homeAt + 1) segments = ['~', ...segments.slice(homeAt + 2)];
  let shortened: string[] = [];
  for (const raw of segments) {
    const segment = raw.length >= 24 && /^[0-9a-fA-F-]+$/.test(raw) ? '…' : raw;
    if (segment === '…' && shortened[shortened.length - 1] === '…') continue;
    shortened.push(segment);
  }
  if (shortened.length > 5) {
    const tail = shortened.slice(shortened.length - 3);
    shortened = [shortened[0], ...(tail[0] === '…' ? [] : ['…']), ...tail];
  }
  return shortened.join(separator);
}

export function ImageUnavailable({
  image,
  failure,
  copied,
  onCopied,
}: {
  image: ChatImage;
  failure: ChatImageFailure;
  copied: boolean;
  onCopied(): void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { title, detail } = imageFailureCopy(failure);
  const copyPath = typeof image.copyPath === 'string' ? image.copyPath : '';
  const path = copyPath.length > 0 ? copyPath : typeof image.path === 'string' ? image.path : '';
  const { folder, file } = splitPath(path);
  const name = file.length > 0 ? file : (image.label ?? '');
  const shortened = shortFolder(folder);
  return (
    <View style={styles.card} onStartShouldSetResponder={() => true}>
      <View style={styles.header}>
        <View style={styles.iconWell}>
          <Glyph name="photo-off" size={18} color={P.muted} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
      </View>
      {name.length > 0 || shortened.length > 0 ? (
        <View style={styles.fileBlock} accessible accessibilityLabel={path.length > 0 ? path : name}>
          {name.length > 0 ? (
            <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
              {name}
            </Text>
          ) : null}
          {shortened.length > 0 ? (
            <View style={styles.folderRow}>
              <Glyph name="folder" size={12} color={P.muted} />
              <Text style={styles.folder} numberOfLines={1} ellipsizeMode="middle">
                {shortened}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {copyPath.length > 0 ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy path"
            onPress={() => {
              void Clipboard.setStringAsync(copyPath).then(onCopied);
            }}
            style={({ pressed }) => [styles.button, pressed && { backgroundColor: P.input }]}
          >
            <Glyph name={copied ? 'check' : 'copy'} size={13} color={P.foreground} />
            <Text style={styles.buttonLabel}>{copied ? 'Copied' : 'Copy path'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  card: {
    width: '100%',
    maxWidth: 460,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.cardBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWell: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.input,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: P.foreground,
    fontSize: 14,
    fontWeight: '600',
  },
  detail: {
    color: P.muted,
    fontSize: 12.5,
  },
  fileBlock: {
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.input,
  },
  name: {
    color: P.foreground,
    fontSize: 12.5,
    fontWeight: '500',
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  folder: {
    flexShrink: 1,
    color: P.muted,
    fontSize: 11.5,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 12,
  },
  button: {
    height: 32,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: P.border,
  },
  buttonLabel: {
    color: P.foreground,
    fontSize: 12.5,
  },
}));
