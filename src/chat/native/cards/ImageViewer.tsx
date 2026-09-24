/**
 * The full-size image preview over the whole chat. Port of desktop `image_viewer/` (React's
 * `session-chat-image-viewer.tsx`): the picture fitted to the screen, pinch or double tap to zoom,
 * a tap outside it closes, next / previous across the message's pictures, and Copy path / Copy
 * image with a tick once done. Desktop's Save image goes through the app shell's Downloads
 * writer, which the phone does not have, so it is not offered.
 */

import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RustChat } from '../../rust/useRustChat';
import { Glyph, type GlyphName } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { useChatImage } from './useChatImage';
import { useChatOverlayStore } from './overlayStore';

export function ImageViewer({ chat }: { chat: RustChat }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const viewer = useChatOverlayStore((state) => state.imageViewer);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [completed, setCompleted] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const lastTap = useRef(0);
  const [zoomed, setZoomed] = useState(false);
  const image = viewer === null ? null : viewer.images[viewer.index] ?? null;
  const source = useChatImage(chat, image);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const uri = source.status === 'ready' ? source.uri : null;

  useEffect(() => {
    setCompleted(null);
    setZoomed(false);
    setNatural(null);
    if (uri === null) return;
    Image.getSize(
      uri,
      (w, h) => setNatural({ width: w, height: h }),
      () => setNatural(null)
    );
  }, [uri]);

  if (viewer === null || image === null) return null;
  const close = () => useChatOverlayStore.setState({ imageViewer: null });
  const step = (delta: number) => {
    const count = viewer.images.length;
    useChatOverlayStore.setState({ imageViewer: { images: viewer.images, index: (viewer.index + delta + count) % count } });
  };
  const frameWidth = width - 32;
  const frameHeight = height - insets.top - insets.bottom - 120;
  const fitted = fit(natural, frameWidth, frameHeight);
  const copyPath = typeof image.copyPath === 'string' ? image.copyPath : '';
  const base64 = uri !== null && uri.startsWith('data:') ? uri.slice(uri.indexOf(',') + 1) : null;

  const toggleZoom = () => {
    const next = !zoomed;
    setZoomed(next);
    scroll.current?.scrollResponderZoomTo({
      x: next ? fitted.width / 4 : 0,
      y: next ? fitted.height / 4 : 0,
      width: next ? fitted.width / 2 : fitted.width,
      height: next ? fitted.height / 2 : fitted.height,
      animated: true,
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close image preview" style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.toolbar, { top: insets.top + 8 }]}>
          {viewer.images.length > 1 ? (
            <Text style={styles.counter}>{`${viewer.index + 1} / ${viewer.images.length}`}</Text>
          ) : null}
          <View style={styles.toolbarSpacer} />
          <View style={styles.actions}>
            {copyPath.length > 0 ? (
              <ToolbarButton
                label="Copy path"
                icon={completed === 'Path copied' ? 'check' : 'copy'}
                onPress={() => {
                  void Clipboard.setStringAsync(copyPath).then(() => setCompleted('Path copied'));
                }}
              />
            ) : null}
            {base64 !== null ? (
              <ToolbarButton
                label="Copy image"
                icon={completed === 'Image copied' ? 'check' : 'photo'}
                onPress={() => {
                  void Clipboard.setImageAsync(base64).then(() => setCompleted('Image copied'));
                }}
              />
            ) : null}
            <ToolbarButton label="Close" icon="x" onPress={close} />
          </View>
        </View>
        <View style={styles.stage} pointerEvents="box-none">
          {uri === null ? (
            source.status === 'loading' ? (
              <ActivityIndicator color={P.muted} />
            ) : (
              <Text style={styles.unavailable}>{image.label || 'Image unavailable'}</Text>
            )
          ) : (
            <ScrollView
              ref={scroll}
              style={{ width: fitted.width, height: fitted.height, flexGrow: 0 }}
              contentContainerStyle={{ width: fitted.width, height: fitted.height }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Pressable
                accessibilityLabel={image.alt || image.label || 'Image'}
                onPress={() => {
                  const now = Date.now();
                  if (now - lastTap.current < 300) toggleZoom();
                  lastTap.current = now;
                }}
              >
                <Image source={{ uri }} style={{ width: fitted.width, height: fitted.height }} resizeMode="contain" />
              </Pressable>
            </ScrollView>
          )}
        </View>
        {viewer.images.length > 1 ? (
          <View style={[styles.stepRow, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
            <ToolbarButton label="Previous image" icon="chevron-left" onPress={() => step(-1)} />
            <ToolbarButton label="Next image" icon="chevron-right" onPress={() => step(1)} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** The picture's size inside the frame at its own aspect ratio, never enlarged past its pixels. */
function fit(natural: { width: number; height: number } | null, maxWidth: number, maxHeight: number) {
  if (natural === null || natural.width <= 0 || natural.height <= 0) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(1, maxWidth / natural.width, maxHeight / natural.height);
  return { width: natural.width * scale, height: natural.height * scale };
}

function ToolbarButton({ label, icon, onPress }: { label: string; icon: GlyphName; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.toolbarButton, pressed && { backgroundColor: P.input }]}
    >
      <Glyph name={icon} size={16} color={P.primary} />
    </Pressable>
  );
}

const useStyles = themedStyles((P) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
  },
  toolbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbarSpacer: {
    flex: 1,
  },
  counter: {
    color: P.muted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.background,
  },
  toolbarButton: {
    width: 40,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailable: {
    color: P.muted,
    fontSize: 14,
  },
  stepRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
}));
