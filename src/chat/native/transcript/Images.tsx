/**
 * Pictures in the transcript: the user's own thumbnails above their bubble, the pictures an agent
 * shared above its prose, and pictures written into prose. Sizes are the shared
 * `image-visual.json` desktop's `images.rs` reads. Machine files load through the core
 * (`loadImage`), and a tap opens the image viewer `NativeChatOverlays` draws.
 */

import { memo, useId, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { openChatImageViewer } from '../cards';
import { mixHex } from '../cards/PillsStrip';
import { useChatViewSize } from '../chatPlacement';
import { fileNameOf, imageFailureCopy } from '../cards/ImageUnavailable';
import { useImageDisplay, useOptionalNativeChatUi, useTranscriptEnv, type ChatImageSource } from './context';
import { Glyph } from './icons';
import { arr, obj, str } from './json';
import { OWNS_HOLD } from './messageSelection';
import { openTranscriptMenu } from './transcriptMenuStore';
import { HorizontalFade } from './verticalFade';

/** A picture's file on the computer (`copyPath`, or the path it is read from); none for a web address or pasted bytes. */
function imageFilePath(image: ChatImageSource): string {
  const copyPath = str(image, 'copyPath');
  const path = copyPath.length > 0 ? copyPath : str(image, 'transport') === 'read' ? str(image, 'path') : '';
  return /^(https?:|data:)/i.test(path) ? '' : path;
}

/**
 * Holding a picture with a file behind it opens the file menu a held file link opens: Copy Path, the
 * phone's share of the desktop's Copy Path and folder row (CDXC:SessionChat 2026-10-17 in desktop
 * `native_chat/file_actions.rs`; the phone cannot show a folder on the computer).
 */
function fileMenuProps(image: ChatImageSource): { onLongPress?: () => void; nativeID?: string } {
  const path = imageFilePath(image);
  // `OWNS_HOLD`: inside a message's text on Android the hold stays this picture's, not the message's menu.
  return path.length > 0 ? { onLongPress: () => openTranscriptMenu({ href: path }), nativeID: OWNS_HOLD } : {};
}

/**
 * Opens the viewer on a tapped picture with the transcript's pictures to step through; a picture
 * drawn outside the chat screen (Markdown in a card) opens on its own list.
 */
function useOpenPicture(): (image: ChatImageSource, list: readonly ChatImageSource[], index: number) => void {
  const ui = useOptionalNativeChatUi();
  return ui === null ? (_image, list, index) => openChatImageViewer(list, index) : ui.openPicture;
}

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
  stripHeight: 136,
  stripMaxWidth: 230,
  singleHeight: 252,
  singleMaxWidth: 420,
  stripGap: 10,
  stripRadius: 8,
  captionGap: 5,
  captionSize: 11.5,
  captionMinWidth: 96,
  stripPaddingBottom: 4,
};

function Thumbnail({ image }: { image: ChatImageSource }) {
  const { theme } = useTranscriptEnv();
  const display = useImageDisplay(image);
  const frame = [styles.thumbnail, { borderColor: theme.border, backgroundColor: theme.input }];
  if (display.state === 'ready') return <Image source={{ uri: display.uri }} style={frame} resizeMode="cover" />;
  if (display.state === 'loading')
    return (
      <View style={[frame, styles.centered]}>
        <ActivityIndicator size="small" color={theme.muted} />
      </View>
    );
  return null;
}

/** A picture written into prose, where its author wrote it (`inline_image` in `images.rs`). */
export const InlineImage = memo(function InlineImage({ image }: { image: ChatImageSource }) {
  const { theme } = useTranscriptEnv();
  const openPicture = useOpenPicture();
  const display = useImageDisplay(image);
  const label = str(image, 'label');
  const alt = str(image, 'alt');
  if (display.state === 'unavailable') {
    // The picture's words with the crossed photo before them, still opening the viewer so its
    // card can say why the picture is not there (desktop `inline_image`).
    const named = label.length > 0 ? fileNameOf(label) : 'Image';
    return (
      <Pressable
        {...fileMenuProps(image)}
        style={[styles.inlineMissing, { borderColor: theme.border }]}
        onPress={() => openPicture(image, [image], 0)}
        accessibilityRole="button"
        accessibilityLabel={`${imageFailureCopy({ reason: display.reason, error: '' }).title}: ${named}`}
      >
        <Glyph name="photo-off" size={13} color={theme.muted} />
        <Text style={[styles.inlineMissingLabel, { color: theme.muted }]}>{named}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      {...fileMenuProps(image)}
      style={styles.inline}
      onPress={() => openPicture(image, [image], 0)}
      accessibilityRole="imagebutton"
      accessibilityLabel={`View ${alt.length > 0 ? alt : label}`}
    >
      <Thumbnail image={image} />
    </Pressable>
  );
});

/**
 * A paragraph made only of pictures: one row at each picture's own shape with its file name under
 * it, scrolling sideways when it is wider than the screen (desktop `picture_strip` in `images.rs`).
 *
 * CDXC:SessionChat 2026-10-16 DECISION:
 * User picked option B, Filmstrip (Q134): pictures an agent writes on lines of their own sit side by
 * side, about 136px tall (a lone picture larger), with the file name always under each, and each
 * frame follows its picture's shape so a wide, short picture never gets black bars. Only in an
 * agent's messages: of the strip in a sent prompt the user said "this is too big my fam … in the
 * sent user messages no need for massive image like this. revert it there to how it was before",
 * so a prompt's pictures keep the small inline thumbnails (`strips={false}` on its `Markdown`).
 * Supersedes the 2026-10-15 decision, which drew the strip in prompts too and letterboxed a wide
 * picture.
 */
export const PictureStrip = memo(function PictureStrip({ images }: { images: ChatImageSource[] }) {
  const single = images.length === 1;
  const { width: screenWidth } = useChatViewSize();
  const openPicture = useOpenPicture();
  const height = single ? VISUAL.singleHeight : VISUAL.stripHeight;
  // A lone picture is never wider than the screen it is read on; a row of them scrolls instead.
  const maxWidth = single ? Math.min(VISUAL.singleMaxWidth, screenWidth - 48) : VISUAL.stripMaxWidth;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={!single} contentContainerStyle={styles.strip}>
      {images.map((image, index) => (
        <StripTile
          key={index}
          image={image}
          index={index}
          height={height}
          maxWidth={maxWidth}
          onOpen={() => openPicture(image, images, index)}
        />
      ))}
    </ScrollView>
  );
});

function StripTile({
  image,
  index,
  height,
  maxWidth,
  onOpen,
}: {
  image: ChatImageSource;
  index: number;
  height: number;
  maxWidth: number;
  onOpen(): void;
}) {
  const { theme } = useTranscriptEnv();
  const display = useImageDisplay(image);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const label = str(image, 'label');
  const alt = str(image, 'alt');
  const named = label.length > 0 ? fileNameOf(label) : `Image #${index + 1}`;
  if (display.state === 'unavailable') {
    return (
      <Pressable
        {...fileMenuProps(image)}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${imageFailureCopy({ reason: display.reason, error: '' }).title}: ${named}`}
        style={[styles.card, { borderColor: theme.border, backgroundColor: theme.cardBackground }]}
      >
        <View style={[styles.cardWell, { backgroundColor: theme.input }]}>
          <Glyph name="photo-off" size={14} color={theme.muted} />
        </View>
        <Text numberOfLines={1} style={[styles.cardLabel, { color: theme.foreground }]}>
          {named}
        </Text>
      </Pressable>
    );
  }
  // Its own shape once the picture says it; a screenshot's 16:10 until then.
  // The frame is the picture's shape: a picture wider than the cap gets shorter, never black bars.
  const aspect = size !== null && size.width > 0 && size.height > 0 ? size.width / size.height : 1.6;
  const width = Math.min(height * aspect, maxWidth);
  const frameHeight = width / aspect;
  return (
    <Pressable
      {...fileMenuProps(image)}
      onPress={onOpen}
      accessibilityRole="imagebutton"
      accessibilityLabel={`View ${alt.length > 0 ? alt : named}`}
      style={[styles.stripTile, { width: Math.max(width, VISUAL.captionMinWidth) }]}
    >
      <View
        style={[
          styles.stripFrame,
          { width, height: frameHeight, borderColor: theme.border },
          display.state === 'loading' && styles.stripLoading,
        ]}
      >
        {display.state === 'ready' ? (
          <Image
            source={{ uri: display.uri }}
            style={styles.stripPicture}
            resizeMode="contain"
            onLoad={(event) => {
              const source = event.nativeEvent.source;
              if (source !== undefined && (source.width !== size?.width || source.height !== size?.height))
                setSize({ width: source.width, height: source.height });
            }}
          />
        ) : (
          <ActivityIndicator size="small" color={theme.muted} />
        )}
      </View>
      <View style={styles.caption}>
        <Text numberOfLines={1} style={[styles.captionName, { color: theme.cardMuted }]}>
          {named}
        </Text>
        {size !== null ? (
          <Text style={[styles.captionMeta, { color: theme.muted }]}>{`${size.width}×${size.height}`}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A message's own pictures: right-aligned above a prompt, left-aligned above an agent's prose. */
/**
 * Your message's words with a loading tile after them for each picture still being saved (core
 * `composer/attaching.rs`; desktop `images.rs` `with_loading_pictures`): where the picture shows once
 * it is in, as a thumbnail beside the words.
 */
export function WithLoadingPictures({ count, children }: { count: number; children: ReactNode }) {
  const { theme } = useTranscriptEnv();
  if (count === 0) return <>{children}</>;
  return (
    <View style={styles.loadingRow}>
      {children !== null ? <View style={styles.loadingText}>{children}</View> : null}
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[styles.thumbnail, styles.centered, styles.missing, { borderColor: theme.border }]}
          accessibilityRole="progressbar"
          accessibilityLabel="Attaching the picture"
        >
          <ActivityIndicator size="small" color={theme.muted} />
        </View>
      ))}
    </View>
  );
}

export const ImageRow = memo(function ImageRow({
  images,
  user,
  end = user,
}: {
  images: unknown;
  user: boolean;
  /** The pictures sit at the right end: the user's own, unless their messages are left-aligned. */
  end?: boolean;
}) {
  const { theme } = useTranscriptEnv();
  const openPicture = useOpenPicture();
  const list = arr(images)
    .map((entry) => obj(entry))
    .filter((entry): entry is ChatImageSource => entry !== null);
  if (list.length === 0) return null;
  return (
    <View style={[styles.row, { gap: user ? VISUAL.userRowGap : VISUAL.assistantRowGap }, end && styles.rowEnd]}>
      {list.map((image, index) => (
        <ImageTile
          key={index}
          image={image}
          index={index}
          user={user}
          onOpen={() => openPicture(image, list, index)}
          themeMuted={theme.muted}
        />
      ))}
    </View>
  );
});

/**
 * The pictures an agent opened from disk: under a tool row that read one, and as the strip a folded
 * turn keeps under its fold row. 48px tiles that wrap, the user's dashed square for a file that has
 * gone, each opening the viewer (desktop `read_pictures.rs`; the rules are gx-chat-core
 * `read_images.rs`, CDXC:SessionChat 2026-11-02).
 */
/** Where a strip under a closed fold of a message's calls starts: under a tool row's label (ROW_PAD_X 8 + TILE 22 + 8). */
export const FOLDED_CALLS_INSET = 38;

export const ReadImages = memo(function ReadImages({ images, inset }: { images: unknown; inset: number }) {
  const { theme } = useTranscriptEnv();
  const openPicture = useOpenPicture();
  const list = arr(images)
    .map((entry) => obj(entry))
    .filter((entry): entry is ChatImageSource => entry !== null);
  if (list.length === 0) return null;
  return (
    <View style={[styles.row, { gap: VISUAL.userRowGap, paddingLeft: inset }]}>
      {list.map((image, index) => (
        <ImageTile
          key={index}
          image={image}
          index={index}
          user
          onOpen={() => openPicture(image, list, index)}
          themeMuted={theme.muted}
        />
      ))}
    </View>
  );
});

/** The fade over a strip's edge that hides more pictures (the pills strip's `PILLS_FADE`). */
const STRIP_FADE = 24;

/**
 * The pictures a closed fold keeps in view: one row of thumbnails that scrolls sideways when it does
 * not fit, fading into `edge` (the opaque colour behind it) at an edge that hides more, as the pills
 * strip does (`PillsStrip.tsx`). Desktop `read_picture_strip` in `read_pictures.rs`; the user's
 * decision is gx-chat-core `read_images.rs` (CDXC:SessionChat 2026-11-02).
 */
export const ReadImageStrip = memo(function ReadImageStrip({
  images,
  inset,
  edge,
}: {
  images: unknown;
  inset: number;
  edge?: string;
}) {
  const { theme } = useTranscriptEnv();
  const openPicture = useOpenPicture();
  const fadeId = useId();
  const [edges, setEdges] = useState({ left: false, right: false });
  const metrics = useRef({ x: 0, width: 0, content: 0 });
  const update = () => {
    const { x, width, content } = metrics.current;
    const next = { left: x > 0.5, right: content - width - x > 0.5 };
    setEdges((was) => (was.left === next.left && was.right === next.right ? was : next));
  };
  const list = arr(images)
    .map((entry) => obj(entry))
    .filter((entry): entry is ChatImageSource => entry !== null);
  if (list.length === 0) return null;
  const color = edge ?? theme.background;
  return (
    <View style={[styles.stripArea, { marginLeft: inset }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        alwaysBounceHorizontal={false}
        overScrollMode="never"
        directionalLockEnabled
        nestedScrollEnabled
        scrollEventThrottle={16}
        onScroll={(event) => {
          metrics.current.x = event.nativeEvent.contentOffset.x;
          update();
        }}
        onLayout={(event) => {
          metrics.current.width = event.nativeEvent.layout.width;
          update();
        }}
        onContentSizeChange={(width) => {
          metrics.current.content = width;
          update();
        }}
        contentContainerStyle={{ gap: VISUAL.userRowGap }}
      >
        {list.map((image, index) => (
          <ImageTile
            key={index}
            image={image}
            index={index}
            user
            onOpen={() => openPicture(image, list, index)}
            themeMuted={theme.muted}
          />
        ))}
      </ScrollView>
      {edges.left ? (
        <HorizontalFade id={`${fadeId}-left`} color={color} from={1} to={0} style={[styles.stripFade, { left: 0 }]} />
      ) : null}
      {edges.right ? (
        <HorizontalFade id={`${fadeId}-right`} color={color} from={0} to={1} style={[styles.stripFade, { right: 0 }]} />
      ) : null}
    </View>
  );
});

/** A folded turn card's fill over the page, opaque, which a strip inside the card fades into. */
export function cardEdge(theme: { background: string; foreground: string }): string {
  return mixHex(theme.background, theme.foreground, 0.025);
}

function ImageTile({
  image,
  index,
  user,
  onOpen,
  themeMuted,
}: {
  image: ChatImageSource;
  index: number;
  user: boolean;
  onOpen(): void;
  themeMuted: string;
}) {
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
        <Pressable {...fileMenuProps(image)} onPress={onOpen} accessibilityRole="button" accessibilityLabel={spoken}>
          <View style={[styles.thumbnail, styles.centered, styles.missing, { borderColor: theme.border }]}>
            <Glyph name="photo-off" size={18} color={themeMuted} />
          </View>
        </Pressable>
      );
    return (
      <Pressable
        {...fileMenuProps(image)}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        style={[styles.card, { borderColor: theme.border, backgroundColor: theme.cardBackground }]}
      >
        <View style={[styles.cardWell, { backgroundColor: theme.input }]}>
          <Glyph name="photo-off" size={14} color={themeMuted} />
        </View>
        <Text numberOfLines={1} style={[styles.cardLabel, { color: theme.foreground }]}>
          {named}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      {...fileMenuProps(image)}
      onPress={onOpen}
      accessibilityRole="imagebutton"
      accessibilityLabel={`View ${alt.length > 0 ? alt : label}`}
    >
      <Thumbnail image={image} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { flexShrink: 1 },
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
  stripArea: { position: 'relative', minWidth: 0 },
  stripFade: { position: 'absolute', top: 0, bottom: 0, width: STRIP_FADE },
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
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: VISUAL.stripGap,
    paddingBottom: VISUAL.stripPaddingBottom,
  },
  stripTile: { gap: VISUAL.captionGap },
  stripFrame: {
    borderRadius: VISUAL.stripRadius,
    borderWidth: VISUAL.borderWidth,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripLoading: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  stripPicture: { width: '100%', height: '100%' },
  caption: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  captionName: { flexShrink: 1, fontSize: VISUAL.captionSize, lineHeight: VISUAL.captionSize * 1.3 },
  captionMeta: { fontSize: VISUAL.captionSize, lineHeight: VISUAL.captionSize * 1.3 },
  cardLabel: { flexShrink: 1, fontSize: 12, fontWeight: '500', paddingHorizontal: 6 },
});
