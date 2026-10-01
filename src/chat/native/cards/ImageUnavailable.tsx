/**
 * What the image viewer shows in place of a picture it cannot show. Port of desktop
 * `image_viewer/unavailable.rs`: an icon, a title that says why, the file's name, its full path
 * wrapping in small muted text, and Copy path. Desktop's Open image and Show in Finder open the
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
  const name = path.split(/[\\/]/).filter((segment) => segment.length > 0).pop() ?? image.label ?? '';
  return (
    <View style={styles.card} onStartShouldSetResponder={() => true}>
      <View style={styles.iconWell}>
        <Glyph name="photo-off" size={22} color={P.muted} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {name.length > 0 ? <Text style={styles.name}>{name}</Text> : null}
      {path.length > 0 ? (
        <View style={styles.pathBox}>
          <Text style={styles.path}>{path}</Text>
        </View>
      ) : null}
      {copyPath.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy path"
          onPress={() => {
            void Clipboard.setStringAsync(copyPath).then(onCopied);
          }}
          style={({ pressed }) => [styles.button, pressed && { backgroundColor: P.input }]}
        >
          <Glyph name={copied ? 'check' : 'copy'} size={14} color={P.foreground} />
          <Text style={styles.buttonLabel}>{copied ? 'Copied' : 'Copy path'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  card: {
    width: '100%',
    maxWidth: 560,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 22,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.background,
  },
  iconWell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.input,
  },
  title: {
    color: P.foreground,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    paddingTop: 2,
  },
  detail: {
    color: P.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  name: {
    color: P.foreground,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    paddingTop: 4,
  },
  pathBox: {
    alignSelf: 'stretch',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: P.input,
  },
  path: {
    color: P.muted,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
  },
  button: {
    marginTop: 4,
    height: 34,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.border,
  },
  buttonLabel: {
    color: P.foreground,
    fontSize: 13,
  },
}));
