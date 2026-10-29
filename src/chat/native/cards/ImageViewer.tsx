/**
 * The full-size image preview over the whole chat. Port of desktop `image_viewer/` (React's
 * `session-chat-image-viewer.tsx`): the picture fitted to the screen, pinch or double tap to zoom,
 * a tap outside it closes, next / previous (the round buttons at the sides, or a sideways swipe while
 * not zoomed) across the transcript's pictures with a "3 / 6" counter under them, and Copy path / Copy
 * image with a tick once done.
 *
 * CDXC:SessionChat 2026-10-24 SEE-ALSO:
 * The list is every picture the transcript shows, in order (gx-chat-core `transcript/pictures.rs`, with
 * the user's words, asked through `openPicture` in `../transcript/context.tsx`). It stops at its ends,
 * where that side's button is not drawn, as desktop's `image_viewer/step_arrows.rs` does; a phone has
 * no pointer to bring them near, so they show whenever there is a picture that way. Desktop's Save image goes
 * through the app shell's Downloads writer, which the phone does not have, so it is not offered.
 */

import * as Clipboard from 'expo-clipboard';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useVerticalBarSpace } from '../../../components/common/verticalBar/VerticalBarArea';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph, type GlyphName } from './icons';
import { ImageUnavailable } from './ImageUnavailable';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { useChatImage, type ChatImageFailure } from './useChatImage';
import { useChatOverlayStore, type ChatImage } from './overlayStore';

/** The viewer the transcript and the composer's thumbnails open (`openChatImageViewer`). */
export function ImageViewer({ chat }: { chat: RustChat }) {
  const viewer = useChatOverlayStore((state) => state.imageViewer);
  return (
    <ImageViewerModal
      chat={chat}
      viewer={viewer}
      onChange={(next) => useChatOverlayStore.setState({ imageViewer: next })}
    />
  );
}

/** The pictures a viewer shows and the one on screen. */
export type ImageViewerList = { images: ChatImage[]; index: number };

/**
 * The viewer itself, for a list its opener keeps: the page sheet (`PageSheet.tsx`) opens it over the
 * page with the page's pictures, without touching the transcript's viewer.
 */
export function ImageViewerModal({
  chat,
  viewer,
  onChange,
}: {
  chat: RustChat;
  viewer: ImageViewerList | null;
  onChange: (next: ImageViewerList | null) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const insets = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  const { width, height } = useWindowDimensions();
  const [completed, setCompleted] = useState<string | null>(null);
  /** The zoom (`Zoom`), kept here so a new picture starts unzoomed. */
  const scale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const image = viewer === null ? null : (viewer.images[viewer.index] ?? null);
  const source = useChatImage(chat, image);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  /**
   * The picture failed to draw: only the `<Image>` that shows it decides that, never a separate
   * size probe.
   *
   * CDXC:SessionChat 2026-10-15 WHY:
   * `Image.getSize` on Android reads the size through Fresco's encoded-image metadata, a different
   * path from the decode `<Image>` does, and it rejected a valid 1080x2520 phone JPEG the composer
   * thumbnail drew fine, so a picture the phone had just attached opened as "damaged". The size now
   * comes from the `<Image>`'s own `onLoad`, and a draw failure says the phone cannot show the
   * picture rather than calling the file damaged, because nothing here has read its bytes.
   */
  const [broken, setBroken] = useState(false);
  const uri = source.status === 'ready' && !broken ? source.uri : null;
  const readyUri = source.status === 'ready' ? source.uri : null;

  useEffect(() => {
    setCompleted(null);
    scale.value = 1;
    offsetX.value = 0;
    offsetY.value = 0;
    setNatural(null);
    setBroken(false);
  }, [readyUri]);

  if (viewer === null || image === null) return null;
  const close = () => onChange(null);
  const step = (delta: number) => {
    const next = viewer.index + delta;
    if (next < 0 || next >= viewer.images.length) return;
    onChange({ images: viewer.images, index: next });
  };
  const several = viewer.images.length > 1;
  const hasPrevious = viewer.index > 0;
  const hasNext = viewer.index < viewer.images.length - 1;
  const frameWidth = width - 32;
  const frameHeight = height - insets.top - insets.bottom - 120;
  const fitted = fit(natural, frameWidth, frameHeight);
  const failure: ChatImageFailure | null =
    source.status === 'unavailable' ? source.failure : broken ? { reason: 'unsupported', error: '' } : null;
  const copyPath = failure === null && typeof image.copyPath === 'string' ? image.copyPath : '';
  const base64 = uri !== null && uri.startsWith('data:') ? uri.slice(uri.indexOf(',') + 1) : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      {/* A Modal is its own native root on Android, so its gestures need their own root view. */}
      <GestureHandlerRootView style={styles.backdrop}>
        <Pressable accessibilityLabel="Close image preview" style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.toolbar, { top: insets.top + 8 }, bar.margin]}>
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
            failure !== null ? (
              <View style={styles.unavailable} pointerEvents="box-none">
                <ImageUnavailable
                  image={image}
                  failure={failure}
                  copied={completed === 'Path copied'}
                  onCopied={() => setCompleted('Path copied')}
                />
              </View>
            ) : (
              <ActivityIndicator color={P.muted} />
            )
          ) : (
            <ZoomSurface
              zoom={{ scale, offsetX, offsetY }}
              fitted={fitted}
              several={several}
              label={image.alt || image.label || 'Image'}
              onStep={step}
              onClose={close}
            >
              <Image
                source={{ uri }}
                style={{ width: fitted.width, height: fitted.height }}
                resizeMode="contain"
                onLoad={(event) => {
                  const { width: w, height: h } = event.nativeEvent.source;
                  if (w > 0 && h > 0 && (natural?.width !== w || natural?.height !== h))
                    setNatural({ width: w, height: h });
                }}
                onError={() => setBroken(true)}
              />
            </ZoomSurface>
          )}
        </View>
        {hasPrevious ? <EdgeButton side="left" onPress={() => step(-1)} /> : null}
        {hasNext ? <EdgeButton side="right" onPress={() => step(1)} /> : null}
        {several ? (
          <View style={[styles.counterRow, { bottom: insets.bottom + 16 }]} pointerEvents="none">
            <Text style={styles.counter}>{`${viewer.index + 1} / ${viewer.images.length}`}</Text>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

/** The picture's zoom: scale and offset of its centre from the stage's centre, in stage points. */
type Zoom = { scale: SharedValue<number>; offsetX: SharedValue<number>; offsetY: SharedValue<number> };

/**
 * The surface over the whole stage that pinches, pans and double taps the picture it holds, steps on a
 * sideways swipe and closes on a tap outside the picture. Its own component so the gesture hooks run
 * only while a picture is on screen.
 *
 * CDXC:SessionChat 2026-10-21 WHY:
 * The zoom used to be a `ScrollView` with `maximumZoomScale` and `scrollResponderZoomTo`, which only
 * iOS implements: on Android pinch did nothing and a double tap threw "zoomToRect is not
 * implemented" and crashed the app. Pinch, pan and double tap are now gesture-handler gestures on a
 * surface covering the stage, driving a reanimated transform, the same on both platforms. The
 * surface also takes the tap outside the picture that closes the viewer, because it sits over the
 * backdrop.
 */
function ZoomSurface({
  zoom,
  fitted,
  several,
  label,
  onStep,
  onClose,
  children,
}: {
  zoom: Zoom;
  fitted: { width: number; height: number };
  several: boolean;
  label: string;
  onStep: (delta: number) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const styles = useStyles();
  const { scale, offsetX, offsetY } = zoom;
  const stageWidth = useSharedValue(0);
  const stageHeight = useSharedValue(0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: scale.value }],
  }));
  const maxOffset = (s: number) => {
    'worklet';
    return {
      x: Math.max(0, (fitted.width * s - stageWidth.value) / 2),
      y: Math.max(0, (fitted.height * s - stageHeight.value) / 2),
    };
  };
  const clamp = (value: number, limit: number) => {
    'worklet';
    return Math.min(limit, Math.max(-limit, value));
  };
  const insidePicture = (x: number, y: number) => {
    'worklet';
    const dx = x - stageWidth.value / 2 - offsetX.value;
    const dy = y - stageHeight.value / 2 - offsetY.value;
    return Math.abs(dx) <= (fitted.width * scale.value) / 2 && Math.abs(dy) <= (fitted.height * scale.value) / 2;
  };
  const pinch = usePinchGesture({
    onActivate: (event) => {
      start.value = {
        scale: scale.value,
        x: offsetX.value,
        y: offsetY.value,
        focalX: event.focalX,
        focalY: event.focalY,
      };
    },
    onUpdate: (event) => {
      const from = start.value;
      const next = Math.min(MAX_ZOOM, Math.max(1, from.scale * event.scale));
      // Keep the point of the picture that was under the fingers under them as they move.
      const pointX = (from.focalX - stageWidth.value / 2 - from.x) / from.scale;
      const pointY = (from.focalY - stageHeight.value / 2 - from.y) / from.scale;
      const limit = maxOffset(next);
      scale.value = next;
      offsetX.value = clamp(event.focalX - stageWidth.value / 2 - next * pointX, limit.x);
      offsetY.value = clamp(event.focalY - stageHeight.value / 2 - next * pointY, limit.y);
    },
  });
  const pan = usePanGesture({
    maxPointers: 1,
    onActivate: () => {
      start.value = { ...start.value, x: offsetX.value, y: offsetY.value };
    },
    onUpdate: (event) => {
      const limit = maxOffset(scale.value);
      offsetX.value = clamp(start.value.x + event.translationX, limit.x);
      offsetY.value = clamp(start.value.y + event.translationY, limit.y);
    },
    onDeactivate: (event) => {
      // A sideways swipe over a picture that is not zoomed steps to the next or previous one.
      if (
        several &&
        scale.value <= 1.01 &&
        Math.abs(event.translationX) > SWIPE_STEP &&
        Math.abs(event.translationX) > Math.abs(event.translationY)
      ) {
        runOnJS(onStep)(event.translationX < 0 ? 1 : -1);
        return;
      }
      const limit = maxOffset(scale.value);
      if (limit.x > 0) offsetX.value = withDecay({ velocity: event.velocityX, clamp: [-limit.x, limit.x] });
      if (limit.y > 0) offsetY.value = withDecay({ velocity: event.velocityY, clamp: [-limit.y, limit.y] });
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onDeactivate: (event) => {
      if (event.canceled) return;
      if (scale.value > 1.01) {
        scale.value = withTiming(1);
        offsetX.value = withTiming(0);
        offsetY.value = withTiming(0);
        return;
      }
      if (!insidePicture(event.x, event.y)) return;
      // Zoom in around the tapped point.
      const limit = maxOffset(DOUBLE_TAP_ZOOM);
      const pointX = event.x - stageWidth.value / 2 - offsetX.value;
      const pointY = event.y - stageHeight.value / 2 - offsetY.value;
      scale.value = withTiming(DOUBLE_TAP_ZOOM);
      offsetX.value = withTiming(clamp(offsetX.value - (DOUBLE_TAP_ZOOM - 1) * pointX, limit.x));
      offsetY.value = withTiming(clamp(offsetY.value - (DOUBLE_TAP_ZOOM - 1) * pointY, limit.y));
    },
  });
  const tapOutside = useTapGesture({
    onDeactivate: (event) => {
      if (!event.canceled && !insidePicture(event.x, event.y)) runOnJS(onClose)();
    },
  });
  const gestures = useSimultaneousGestures(pinch, pan, doubleTap, tapOutside);

  return (
    <GestureDetector gesture={gestures}>
      <View
        collapsable={false}
        accessible
        accessibilityLabel={label}
        style={[StyleSheet.absoluteFill, styles.zoomSurface]}
        onLayout={(event) => {
          stageWidth.value = event.nativeEvent.layout.width;
          stageHeight.value = event.nativeEvent.layout.height;
        }}
      >
        <Animated.View pointerEvents="none" style={zoomStyle}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
/** How far a finger travels sideways before a swipe steps to another picture. */
const SWIPE_STEP = 60;

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

/** The round previous / next button at one side, centred on the screen's height. */
function EdgeButton({ side, onPress }: { side: 'left' | 'right'; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={[styles.edge, side === 'left' ? styles.edgeLeft : styles.edgeRight]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={side === 'left' ? 'Previous image' : 'Next image'}
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => [styles.edgeButton, pressed && { backgroundColor: P.input }]}
      >
        <Glyph name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={22} color={P.primary} />
      </Pressable>
    </View>
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
  counterRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: 'center',
  },
  counter: {
    color: P.primary,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  edge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 2,
    justifyContent: 'center',
  },
  edgeLeft: {
    left: 12,
  },
  edgeRight: {
    right: 12,
  },
  edgeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
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
  zoomSurface: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailable: {
    width: '100%',
    paddingHorizontal: 20,
    alignItems: 'center',
  },
}));
