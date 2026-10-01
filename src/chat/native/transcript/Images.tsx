/**
 * Pictures in the transcript: the user's own thumbnails above their bubble, the pictures an agent
 * shared above its prose, and pictures written into prose. Sizes are the shared
 * `image-visual.json` desktop's `images.rs` reads. Machine files load through the core
 * (`loadImage`), and a tap opens the image viewer `NativeChatOverlays` draws.
 */

import { memo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { openChatImageViewer } from '../cards';
import { fileNameOf, imageFailureCopy } from '../cards/ImageUnavailable';
import { useImageDisplay, useTranscriptEnv, type ChatImageSource } from './context';
import { Glyph } from './icons';
import { arr, obj, str } from './json';

const VISUAL = {
  thumbnailSize: 48,
  thumbnailRadius: 8,
  borderWidth: 1,
  userRowGap: 6,
  assistantRowGap: 8,
  rowPaddingY: 4,
  inlineMarginX: 4,
  inlineMarginY: 2,
  loadingIconSize: 16,
};

function Thumbnail({ image }: { image: ChatImageSource }) {
  const { theme } = useTranscriptEnv();
  const display = useImageDisplay(image);
  const frame = [styles.thumbnail, { borderColor: theme.border, backgroundColor: theme.input }];
  if (display.state === 'ready') return <Image source={{ uri: display.uri }} style={frame} resizeMode='cover' />;
  if (display.state === 'loading')
    return (
      <View style={[frame, styles.centered]}>
        <ActivityIndicator size='small' color={theme.muted} />
      </View>
    );
  return null;
}

/** A picture written into prose, where its author wrote it (`inline_image` in `images.rs`). */
export const InlineImage = memo(function InlineImage({ image }: { image: ChatImageSource }) {
  const { theme } = useTranscriptEnv();
  const display = useImageDisplay(image);
  const label = str(image, 'label');
  const alt = str(image, 'alt');
  if (display.state === 'unavailable') {
    // The picture's words with the crossed photo before them, still opening the viewer so its
    // card can say why the picture is not there (desktop `inline_image`).
    const named = label.length > 0 ? fileNameOf(label) : 'Image';
    return (
      <Pressable
        style={[styles.inlineMissing, { borderColor: theme.border }]}
        onPress={() => openChatImageViewer([image], 0)}
        accessibilityRole='button'
        accessibilityLabel={`${imageFailureCopy({ reason: display.reason, error: '' }).title}: ${named}`}
      >
        <Glyph name='photo-off' size={13} color={theme.muted} />
        <Text style={[styles.inlineMissingLabel, { color: theme.muted }]}>{named}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      style={styles.inline}
      onPress={() => openChatImageViewer([image], 0)}
      accessibilityRole='imagebutton'
      accessibilityLabel={`View ${alt.length > 0 ? alt : label}`}
    >
      <Thumbnail image={image} />
    </Pressable>
  );
});

/** A message's own pictures: right-aligned above a prompt, left-aligned above an agent's prose. */
export const ImageRow = memo(function ImageRow({ images, user }: { images: unknown; user: boolean }) {
  const { theme } = useTranscriptEnv();
  const list = arr(images)
    .map((entry) => obj(entry))
    .filter((entry): entry is ChatImageSource => entry !== null);
  if (list.length === 0) return null;
  return (
    <View style={[styles.row, { gap: user ? VISUAL.userRowGap : VISUAL.assistantRowGap }, user && styles.rowEnd]}>
      {list.map((image, index) => (
        <ImageTile key={index} image={image} index={index} user={user} onOpen={() => openChatImageViewer(list, index)} themeMuted={theme.muted} />
      ))}
    </View>
  );
});

function ImageTile({ image, index, user, onOpen, themeMuted }: { image: ChatImageSource; index: number; user: boolean; onOpen(): void; themeMuted: string }) {
  const { theme } = useTranscriptEnv();
  const display = useImageDisplay(image);
  const label = str(image, 'label');
  const alt = str(image, 'alt');
  if (display.state === 'unavailable') {
    // A file that has since gone, or bytes that would not decode: a small missing-image
    // placeholder that still opens the viewer, where the card says why (desktop `image_tile`).
    const named = label.length > 0 ? fileNameOf(label) : `Image #${index + 1}`;
    const spoken = `${imageFailureCopy({ reason: display.reason, error: '' }).title}: ${named}`;
    if (user)
      return (
        <Pressable onPress={onOpen} accessibilityRole='button' accessibilityLabel={spoken}>
          <View style={[styles.thumbnail, styles.centered, styles.missing, { borderColor: theme.border }]}>
            <Glyph name='photo-off' size={18} color={themeMuted} />
          </View>
        </Pressable>
      );
    return (
      <Pressable
        onPress={onOpen}
        accessibilityRole='button'
        accessibilityLabel={spoken}
        style={[styles.card, { borderColor: theme.border, backgroundColor: theme.cardBackground }]}
      >
        <View style={[styles.cardWell, { backgroundColor: theme.input }]}>
          <Glyph name='photo-off' size={14} color={themeMuted} />
        </View>
        <Text numberOfLines={1} style={[styles.cardLabel, { color: theme.foreground }]}>
          {named}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onOpen} accessibilityRole='imagebutton' accessibilityLabel={`View ${alt.length > 0 ? alt : label}`}>
      <Thumbnail image={image} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    width: VISUAL.thumbnailSize,
    height: VISUAL.thumbnailSize,
    borderRadius: VISUAL.thumbnailRadius,
    borderWidth: VISUAL.borderWidth,
  },
  centered: { alignItems: 'center', justifyContent: 'center' },
  inline: { marginHorizontal: VISUAL.inlineMarginX, marginVertical: VISUAL.inlineMarginY },
  row: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: VISUAL.rowPaddingY },
  rowEnd: { justifyContent: 'flex-end' },
  missing: { borderStyle: 'dashed' },
  inlineMissing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginHorizontal: VISUAL.inlineMarginX,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: VISUAL.borderWidth,
    borderStyle: 'dashed',
  },
  inlineMissingLabel: { fontSize: 13 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 160,
    maxWidth: 220,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardWell: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { flexShrink: 1, fontSize: 12, fontWeight: '500', paddingHorizontal: 6 },
});
