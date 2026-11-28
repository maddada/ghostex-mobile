/**
 * The sheet a chat page card (`ghostex show`) opens on the phone: the published page over the whole
 * screen with a slim bar for its title, Refresh, a ⋯ menu (`CardMoreMenu.tsx`), Hide and Close, the phone form of the desktop's floating
 * page window. The page comes from the computer's gxserver through the chat's own forward
 * (`webPreview/machineLinks.ts`) and wears the chat's theme from its first paint. Like the desktop's
 * window it closes once the page's answers are sent (CDXC:SessionChat 2026-10-11 on
 * apps/desktop/src/app/window/visual_page_modal.rs). Half folded like a laptop the page, with its loading and
 * failure states (Retry), ends 8 pt above the fold under the bar: the page is the computer's content with controls of
 * its own that the app cannot move off the knick, so it keeps to the upper screen, where the keyboard never comes.
 *
 * CDXC:SessionChat 2026-10-23 DECISION:
 * User answered "Yes, after the desktop" when asked whether the phone's page gets the desktop page window's features (the 2026-10-22 decisions on apps/desktop/src/app/window/visual_page_modal.rs): tapping a picture in the page opens the chat's image viewer over the page with every picture of the page, the page is harder to lose, reopening it goes back to where it was scrolled, and a Refresh button appears when its file changed on the computer. Asked how Android's back closes the sheet, the user picked "Two presses within 2 seconds"; asked whether pages published with `ghostex show --browser` also open here, "Yes, every page opens in the sheet" (unlike the desktop, which sends those to the browser).
 *
 * CDXC:SessionChat 2026-10-23 WHY:
 * The phone has no "outside" to click, so the desktop's two clicks away became: no swipe-to-dismiss, Close in the bar closes at once, and Android's back (the button or the edge swipe) only arms the sheet for `CLOSE_ARMED_FOR_MS` while the bar says "Press back again to close"; a second back within that time closes it. The file check runs only over the warm chat link (plain HTTP through the forward), never as an SSH exec every two seconds, which would take the computer's few SSH command slots from the terminals; a computer without the warm link gets no Refresh.
 * SEE-ALSO: apps/desktop/src/app/window/visual_page_modal/source.rs (the desktop's check and Refresh), server/src/visual_pages/source.rs (the two routes).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { GhostexNative } from '../../../../modules/ghostex-native/src';
import { foldUpperHalfInset } from '../../../components/common/verticalBar/layout';
import { useLaptopFold } from '../../../components/common/verticalBar/laptopFold';
import { useVerticalBarSpace } from '../../../components/common/verticalBar/VerticalBarArea';
import { WebPreviewCopy } from '../../../copy';
import type { MachineConnectionTarget } from '../../../machines/credentials';
import { describeForwardFailure, type WebPreviewFailure } from '../../../webPreview/forwards';
import {
  holdComputerForward,
  openComputerForward,
  releaseComputerForward,
  withPageTheme,
  type ComputerAddress,
} from '../../../webPreview/machineLinks';
import { LOOPBACK_HOST, localPreviewUrl, parseHttpUrl } from '../../../webPreview/urls';
import { chatMachineLink } from '../../rust/machine-link';
import type { RustChat } from '../../rust/useRustChat';
import { chatIsLightNow, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Glyph } from './icons';
import { ImageViewerModal, type ImageViewerList } from './ImageViewer';
import { CardMoreMenu, pageMenuRows } from './CardMoreMenu';
import { useMachineShares, useShareLinksSupported } from '../../../sharing/api';
import { ShareLinkSheet } from '../../../sharing/ShareLinkSheet';
import { keepUnsavedDraft, sendUnsavedDraft } from './pageDrafts';
import { PAGE_DICTATION_SCRIPT, usePageDictation } from './pageDictation';
import { usePageArtBackdrop, type PageOrigin, type SheetSize } from './pageArtBackdrop';
import {
  PAGE_SCRIPT,
  PENDING_DRAFT_SCRIPT,
  RELOAD_SCRIPT,
  pageIdOfPath,
  readPageMessage,
  resendScript,
} from './pageSheetScript';
import { AlertOutlet, closeOrCancelAlert } from '../../../components/common/dialog/AlertHost';
import { showAlert } from '../../../components/common/dialog/alert';

/** How long the first back press keeps the sheet armed for a second one to close it. */
const CLOSE_ARMED_FOR_MS = 2_000;
/** How often the open sheet asks whether the page's file changed (the desktop's interval). */
const SOURCE_CHECK_EVERY_MS = 2_000;
const SOURCE_CHECK_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 30_000;
/** How long the page has to hand over the draft it had not saved, when it closes or moves port. */
const PENDING_DRAFT_TIMEOUT_MS = 800;
/** Cap on waiting for a first-time artwork blur pass before revealing the loaded page. */
const FIRST_BLUR_WAIT_MS = 350;
/** Minimum height of the sheet's top bar (`styles.bar.minHeight`), used before its first `onLayout`. */
const SHEET_BAR_MIN_HEIGHT = 48;
/** Right padding of the sheet's top bar (`styles.bar.paddingRight`). */
const SHEET_BAR_PADDING_RIGHT = 8;
/** Touch target width of the sheet's Close button (`styles.close.width`). */
const CLOSE_BUTTON_WIDTH = 40;
/** Size of the Close `×` glyph (`<Glyph name="x" size={CLOSE_GLYPH_SIZE} />`). */
const CLOSE_GLYPH_SIZE = 18;
/**
 * Rightmost painted coordinate of `GLYPHS.x` (`M18 6l-12 12`, `strokeWidth: 1.8`, round cap) in
 * its 24x24 viewBox (`icons.tsx`).
 */
const CLOSE_GLYPH_RIGHT_EDGE = 18 + 1.8 / 2;
/**
 * Distance from the sheet's right edge to the visual right edge of the Close `×` glyph, handed to
 * the page as `gx-controls-inset` so floating page chips (`.gx-outside-bar`) line up right under
 * the `×` instead of the bar's outer padding.
 */
const CLOSE_VISUAL_RIGHT_INSET =
  Math.round(
    (SHEET_BAR_PADDING_RIGHT +
      (CLOSE_BUTTON_WIDTH - CLOSE_GLYPH_SIZE) / 2 +
      ((24 - CLOSE_GLYPH_RIGHT_EDGE) / 24) * CLOSE_GLYPH_SIZE) *
      1000,
  ) / 1000;

/**
 * Whether a navigation replaces the page rather than loading into a sub-frame: Android reports no
 * flag (it only asks for the top frame), and on iOS a `target=_blank` link has no target frame.
 * The same rule as the Web preview's (`WebPreviewScreen.tsx`).
 */
function isTopNavigation(request: ShouldStartLoadRequest & { hasTargetFrame?: boolean }): boolean {
  return request.isTopFrame !== false || request.hasTargetFrame === false;
}

const withoutFragment = (url: string): string => url.split('#')[0] ?? url;

/**
 * A page's link to another HTML file beside it, which the page itself follows in place through its
 * gxserver (`/visual/<id>/link?href=…`, server/src/visual_pages/linked.rs and the page bootstrap in
 * theme.rs); gxserver answers with a redirect to that file's own page.
 *
 * CDXC:SessionChat 2026-11-20 DECISION:
 * User, asked whether a Live page's links to the other pages of its set (a cover page and its decks)
 * should switch pages inside the phone's page view, as they do in the desktop's page window: yes. The
 * sheet lets the page go to that route and, once it lands on the other page, opens that page as its
 * own (`onOpenLink`), so Refresh, Hide, the title and the drafts kept while offline all belong to the
 * page on screen rather than to the one the card opened. Older phones send the route out as a link.
 */
const PAGE_LINK_PATH = /^\/visual\/[0-9a-f]{32}\/link\?/u;

/**
 * The page through the phone's forward on `localPort`, in the chat's theme. `gx-floating=1`: the
 * page closes itself once its answers are sent, as in the desktop's window. `gx-controls=right`
 * and `gx-controls-inset` align floating page chips (`.gx-outside-bar`) with the visual right edge
 * of the sheet's Close `×` glyph.
 */
function sheetUri(page: ComputerAddress, localPort: number): string {
  const themed = withPageTheme(page.path, chatIsLightNow() ? 'light' : 'dark');
  const separator = themed.includes('#') ? '&' : '#';
  return localPreviewUrl(
    page.scheme,
    localPort,
    `${themed}${separator}gx-floating=1&gx-controls=right&gx-controls-inset=${CLOSE_VISUAL_RIGHT_INSET}`,
  );
}

export type PageSheetProps = {
  chat: RustChat;
  machine: MachineConnectionTarget;
  /** The page on the computer (`/visual/<id>` on its gxserver), or `null` while closed. */
  page: ComputerAddress | null;
  onClose: () => void;
  /**
   * Hide: the sheet closes as Close does and the page waits as a pill in the chat's pills bar
   * (`hiddenPages.ts`), named by `title`, the page's own title as the sheet shows it. Without it
   * the sheet has no Hide.
   */
  onHide?: (title: string) => void;
  /**
   * A link the page followed, written as the computer would (`http://127.0.0.1:<port>/…`). The
   * opener decides whether it replaces the page, goes to the phone's browser, or closes the sheet
   * and opens elsewhere, as the desktop's page window sends the page's links out.
   */
  onOpenLink: (url: string) => void;
  /** The pages starred in this chat (the document's `starredPages`), for the ⋯ menu's Star or Unstar. */
  starredPages?: readonly string[];
};

export function PageSheet({ chat, machine, page, starredPages, onClose, onHide, onOpenLink }: PageSheetProps) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const insets = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  const windowDims = useWindowDimensions();
  const canShare = useShareLinksSupported(machine);
  const { pages: sharedPages } = useMachineShares(machine.id);
  const [shareOpen, setShareOpen] = useState(false);
  // Laptop pose: the page area's bottom edge in the window (the sheet covers the window from its top), so the page
  // ends above the fold.
  const fold = useLaptopFold();
  const [pageBottom, setPageBottom] = useState<number | null>(null);
  const [measuredSheetSize, setMeasuredSheetSize] = useState<SheetSize | null>(null);
  const [measuredPageOrigin, setMeasuredPageOrigin] = useState<PageOrigin | null>(null);
  const sheetSize = useMemo<SheetSize>(
    () => measuredSheetSize ?? { width: windowDims.width, height: windowDims.height },
    [measuredSheetSize, windowDims.width, windowDims.height],
  );
  const pageOrigin = useMemo<PageOrigin>(
    () => measuredPageOrigin ?? { x: bar.left, y: insets.top + SHEET_BAR_MIN_HEIGHT },
    [measuredPageOrigin, bar.left, insets.top],
  );
  const webviewRef = useRef<WebView<object>>(null);
  // The machine record is rebuilt on every connection the inventory records; only its id matters.
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const pageId = page === null ? null : pageIdOfPath(page.path);

  const [attempt, setAttempt] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const uriRef = useRef<string | null>(null);
  const localPortRef = useRef<number | null>(null);
  const [failure, setFailure] = useState<WebPreviewFailure | null>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [blurWaitExpired, setBlurWaitExpired] = useState(false);
  const [title, setTitle] = useState('');
  const [pictures, setPictures] = useState<ImageViewerList | null>(null);
  const [armed, setArmed] = useState(false);
  const [changed, setChanged] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  const artBackdrop = usePageArtBackdrop({
    open: page !== null,
    light: P.light,
    baseColor: P.background,
    sheetSize,
    pageOrigin,
  });
  const receiveBlurredArt = artBackdrop.receiveBlurredArt;
  // Hold the loading overlay briefly if the page finished before a first-time artwork blur returned,
  // so both the header bar and the page reveal on the exact same blurred JPEG with no flash or seam.
  useEffect(() => {
    if (!pageLoaded || !artBackdrop.active || artBackdrop.blurred !== null || blurWaitExpired) return undefined;
    const timer = setTimeout(() => setBlurWaitExpired(true), FIRST_BLUR_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pageLoaded, artBackdrop.active, artBackdrop.blurred, blurWaitExpired]);
  const loading = !pageLoaded || (artBackdrop.active && artBackdrop.blurred === null && !blurWaitExpired);
  // Push backdrop updates (rotation, theme/dimming changes, or first-time blur completion) into the live page.
  useEffect(() => {
    if (uri === null) return;
    webviewRef.current?.injectJavaScript(artBackdrop.glassScript);
  }, [uri, artBackdrop.glassKey, artBackdrop.glassScript]);
  // The page's text boxes dictate only while the reader sees the page (`pageDictation.ts`).
  const dictation = usePageDictation(machine, webviewRef, page !== null && uri !== null && appActive && pictures === null);
  const askDictation = dictation.asked;
  const beforeContentScript = useMemo(
    () =>
      [PAGE_SCRIPT, dictation.available ? PAGE_DICTATION_SCRIPT : null, artBackdrop.glassScript]
        .filter((part): part is string => part !== null)
        .join('\n'),
    [dictation.available, artBackdrop.glassScript],
  );
  const afterContentScript = useMemo(
    () => `${PAGE_SCRIPT}\n${artBackdrop.glassScript}`,
    [artBackdrop.glassScript],
  );
  /** Takes the page's answer to {@link PENDING_DRAFT_SCRIPT} while one is awaited. */
  const draftReplyRef = useRef<((draft: Record<string, unknown> | null) => void) | null>(null);
  /** The answers the page is sending, until it closes or gxserver refused them ({@link resendScript}). */
  const sendingRef = useRef<string | null>(null);

  // Opening (or reopening) a page: the forward first, then the page through it.
  useEffect(() => {
    setUri(null);
    uriRef.current = null;
    localPortRef.current = null;
    setFailure(null);
    setPageLoaded(false);
    setBlurWaitExpired(false);
    setTitle('');
    setPictures(null);
    setArmed(false);
    sendingRef.current = null;
    if (page === null) {
      setMeasuredSheetSize(null);
      setMeasuredPageOrigin(null);
      return undefined;
    }
    let live = true;
    let held = false;
    const target = machineRef.current;
    openComputerForward(target, page)
      .then(async ({ localPort, gxserver }) => {
        // The computer's gxserver rides the chat's own forward, which nothing here may close.
        if (!gxserver) {
          holdComputerForward(target.id, page.remotePort);
          if (!live) {
            void releaseComputerForward(target.id, page.remotePort);
            return;
          }
          held = true;
        }
        if (!live) return;
        // What this page typed but could not save when it last closed goes first, so it opens with it.
        if (pageId !== null) await sendUnsavedDraft(target.id, pageId);
        if (!live) return;
        const next = sheetUri(page, localPort);
        localPortRef.current = localPort;
        uriRef.current = next;
        setUri(next);
      })
      .catch((error: unknown) => {
        if (live) setFailure(describeForwardFailure(page.remotePort, error, false));
      });
    return () => {
      live = false;
      if (held) void releaseComputerForward(target.id, page.remotePort);
    };
  }, [attempt, page, pageId]);

  // Asks the page's gxserver whether the file it was published from changed, while the app is in front.
  useEffect(() => {
    setChanged(false);
    if (page === null || pageId === null) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const link = chatMachineLink(machineRef.current);
    const check = async (): Promise<void> => {
      if (!live) return;
      if (AppState.currentState === 'active') {
        const route = await link.route();
        // An older Ghostex, or an sshd without forwarding: no Refresh rather than an exec a turn.
        if (route === 'legacy') return;
        if (route === 'socket') {
          const answer = await link.rpc('readVisualPageSource', { pageId }, SOURCE_CHECK_TIMEOUT_MS);
          if (!live) return;
          if (answer.error !== null) {
            // gxserver refused (no such page, or a gxserver older than the route): ask no more.
            if (answer.error.code !== 'unreachable' && answer.error.code !== 'serverStarting') return;
          } else {
            const status = (answer.result ?? {}) as { refreshable?: unknown; changed?: unknown };
            // A page published without its file's path (an older `ghostex show`) never changes.
            if (status.refreshable !== true) return;
            if (!refreshingRef.current) setChanged(status.changed === true);
          }
        }
      }
      timer = setTimeout(() => void check(), SOURCE_CHECK_EVERY_MS);
    };
    timer = setTimeout(() => void check(), SOURCE_CHECK_EVERY_MS);
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [page, pageId]);

  /**
   * Keeps what the page typed but has not saved on its computer yet (pageDrafts.ts), asking the page
   * for it (`ghostex.__pending()`); a page that does not answer in time keeps nothing.
   */
  const keepPendingDraft = useCallback(async (): Promise<void> => {
    const webview = webviewRef.current;
    if (webview === null || page === null || pageId === null) return;
    const draft = await new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = setTimeout(() => {
        draftReplyRef.current = null;
        resolve(null);
      }, PENDING_DRAFT_TIMEOUT_MS);
      draftReplyRef.current = (reply) => {
        clearTimeout(timer);
        draftReplyRef.current = null;
        resolve(reply);
      };
      webview.injectJavaScript(PENDING_DRAFT_SCRIPT);
    });
    if (draft !== null) keepUnsavedDraft(machineRef.current, page, pageId, draft);
  }, [page, pageId]);

  /**
   * The link to the computer came back. The page's forward is opened again (nothing else may have yet)
   * on the phone port it had (GhostexPortForward.kt), so the page carries on and sends the drafts and
   * answers it kept trying (server/src/visual_pages/theme.rs). When that port was taken meanwhile, the
   * page moves to the new one, taking along what it had typed but not saved.
   */
  useEffect(() => {
    if (page === null || pageId === null) return undefined;
    let live = true;
    const target = machineRef.current;
    const subscription = GhostexNative.addListener('onConnectionState', (event) => {
      if (event.machineId !== target.id || event.state !== 'connected') return;
      void (async () => {
        const { localPort } = await openComputerForward(target, page);
        if (!live || localPortRef.current === null || localPortRef.current === localPort) return;
        localPortRef.current = localPort;
        await keepPendingDraft();
        await sendUnsavedDraft(target.id, pageId);
        if (!live || localPortRef.current !== localPort) return;
        const next = sheetUri(page, localPort);
        uriRef.current = next;
        setUri(next);
      })().catch(() => undefined);
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, [page, pageId, keepPendingDraft]);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), CLOSE_ARMED_FOR_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  /** Closes once the page handed over what it has not saved yet, which is then sent on its own. */
  const close = useCallback(() => {
    setPictures(null);
    const target = machineRef.current;
    void keepPendingDraft().then(() => {
      onClose();
      if (pageId !== null) void sendUnsavedDraft(target.id, pageId);
    });
  }, [keepPendingDraft, onClose, pageId]);

  /** Hide: closes the same way, then leaves the page as a pill (`hiddenPages.ts`). */
  const hide = useCallback(() => {
    if (onHide === undefined) return;
    setPictures(null);
    const target = machineRef.current;
    const shown = title.length > 0 ? title : 'Live page';
    void keepPendingDraft().then(() => {
      onHide(shown);
      if (pageId !== null) void sendUnsavedDraft(target.id, pageId);
    });
  }, [keepPendingDraft, onHide, pageId, title]);

  /** Android's back: the first one arms, a second within `CLOSE_ARMED_FOR_MS` closes. */
  const backPressed = useCallback(() => {
    if (armed) close();
    else setArmed(true);
  }, [armed, close]);

  /** Publishes the file again under the same address, then reloads where the reader was. */
  const refresh = useCallback(async () => {
    if (pageId === null || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    const answer = await chatMachineLink(machineRef.current).rpc('refreshVisualPage', { pageId }, REFRESH_TIMEOUT_MS);
    refreshingRef.current = false;
    setRefreshing(false);
    if (answer.error !== null) {
      showAlert('The page could not be refreshed', answer.error.message);
      return;
    }
    setChanged(false);
    webviewRef.current?.injectJavaScript(RELOAD_SCRIPT);
  }, [pageId]);

  const shouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      if (!isTopNavigation(request)) return true;
      const current = uriRef.current;
      if (current !== null && withoutFragment(request.url) === withoutFragment(current)) return true;
      const parsed = parseHttpUrl(request.url);
      if (parsed === null) {
        if (/^(about|data|blob|javascript):/iu.test(request.url)) return true;
        // mailto:, tel: and the like belong to the phone's own apps.
        void Linking.openURL(request.url).catch(() => undefined);
        return false;
      }
      // An address through the page's own forward is the computer's gxserver, as the page wrote it.
      const localPort = localPortRef.current;
      const onForward = page !== null && parsed.host === LOOPBACK_HOST && parsed.port === localPort;
      // A link to another page of its set: the page goes there itself (`PAGE_LINK_PATH`).
      if (onForward && PAGE_LINK_PATH.test(parsed.pathAndQuery)) return true;
      const url = onForward
        ? `${parsed.scheme}://${LOOPBACK_HOST}:${page.remotePort}${parsed.pathAndQuery}`
        : request.url;
      onOpenLink(url);
      return false;
    },
    [onOpenLink, page],
  );

  /**
   * The page landed on another page of its set (`PAGE_LINK_PATH`) without the redirect passing
   * {@link shouldStartLoad} (where a platform does not ask for redirects): that page becomes the
   * sheet's own.
   */
  const followLinkedPage = useCallback(
    (url: string) => {
      const parsed = parseHttpUrl(url);
      if (page === null || parsed === null || PAGE_LINK_PATH.test(parsed.pathAndQuery)) return;
      if (parsed.host !== LOOPBACK_HOST || parsed.port !== localPortRef.current) return;
      const landed = pageIdOfPath(parsed.pathAndQuery);
      if (landed === null || landed === pageId) return;
      onOpenLink(`${parsed.scheme}://${LOOPBACK_HOST}:${page.remotePort}${withoutFragment(parsed.pathAndQuery)}`);
    },
    [onOpenLink, page, pageId],
  );

  const received = useCallback(
    (event: WebViewMessageEvent) => {
      const message = readPageMessage(event.nativeEvent.data);
      if (message === null) return;
      if (message.type === 'images') setPictures({ images: message.images, index: message.index });
      else if (message.type === 'draft') draftReplyRef.current?.(message.draft);
      else if (message.type === 'sending') sendingRef.current = message.body;
      else if (message.type === 'sendEnded') sendingRef.current = null;
      else if (message.type === 'dictate') askDictation(message.action);
      else if (message.type === 'blurredArt') receiveBlurredArt(message);
      else close();
    },
    [askDictation, close, receiveBlurredArt],
  );

  if (page === null) return null;
  const retry = () => setAttempt((current) => current + 1);
  // What the page leaves free above the area's bottom in the laptop pose; 0 elsewhere.
  const pageInset = pageBottom === null ? 0 : foldUpperHalfInset(fold, pageBottom);
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={closeOrCancelAlert(backPressed)}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        style={[styles.sheet, { paddingTop: insets.top, paddingBottom: insets.bottom }, bar.padding]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setMeasuredSheetSize((prev) => (prev?.width === width && prev.height === height ? prev : { width, height }));
        }}
      >
        {artBackdrop.active ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {artBackdrop.blurred !== null && artBackdrop.rect !== null ? (
              <Image
                source={{ uri: artBackdrop.blurred.dataUri }}
                resizeMode="stretch"
                fadeDuration={0}
                style={{
                  position: 'absolute',
                  left: artBackdrop.rect.x,
                  top: artBackdrop.rect.y,
                  width: artBackdrop.rect.width,
                  height: artBackdrop.rect.height,
                }}
              />
            ) : artBackdrop.rawSource !== null ? (
              <Image
                source={artBackdrop.rawSource}
                resizeMode="cover"
                blurRadius={Platform.OS === 'ios' ? 30 : 25}
                fadeDuration={0}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: artBackdrop.tint }]} />
          </View>
        ) : null}
        <View style={[styles.bar, artBackdrop.active && { borderBottomColor: P.ink(0.09) }]}>
          <View style={styles.heading}>
            <Text numberOfLines={1} style={styles.title}>
              {title.length > 0 ? title : 'Live page'}
            </Text>
            <Text numberOfLines={1} style={[styles.detail, armed && { color: P.foreground }]}>
              {armed ? 'Press back again to close' : 'Live page'}
            </Text>
          </View>
          {changed || refreshing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh the page"
              accessibilityHint="The page's file changed on the computer"
              disabled={refreshing}
              onPress={() => void refresh()}
              hitSlop={6}
              style={({ pressed }) => [styles.refresh, pressed && { opacity: 0.8 }]}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={P.background} />
              ) : (
                <Glyph name="refresh" size={14} color={P.background} />
              )}
              <Text style={styles.refreshText}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
            </Pressable>
          ) : null}
          {pageId !== null ? (
            // This page: Snooze, Star, Copy reference and Reference in chat; Share: optional Share link,
            // Export page and Import answers (`CardMoreMenu.tsx` `pageMenuRows`); a snoozed page's
            // sheet closes, and so does one put in the chat box, which then shows its pill.
            <CardMoreMenu
              rows={pageMenuRows(pageId, {
                snooze: true,
                starred: starredPages?.includes(pageId) ?? false,
                shared: canShare ? sharedPages.has(pageId) : null,
                title,
              })}
              dispatch={chat.dispatch}
              color={P.primary}
              onSnoozed={close}
              onReferenced={close}
              onShare={canShare ? () => setShareOpen(true) : undefined}
            />
          ) : null}
          {onHide !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hide page"
              accessibilityHint="Keeps the page as a pill above the chat box"
              onPress={hide}
              hitSlop={6}
              style={({ pressed }) => [styles.close, pressed && { backgroundColor: P.input }]}
            >
              <Glyph name="window-minimize" size={18} color={P.primary} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close page"
            onPress={close}
            hitSlop={6}
            style={({ pressed }) => [styles.close, pressed && { backgroundColor: P.input }]}
          >
            <Glyph name="x" size={CLOSE_GLYPH_SIZE} color={P.primary} />
          </Pressable>
        </View>
        <View
          style={styles.page}
          onLayout={(event) => {
            const { x, y, height } = event.nativeEvent.layout;
            setPageBottom(y + height);
            setMeasuredPageOrigin((prev) => (prev?.x === x && prev.y === y ? prev : { x, y }));
          }}
        >
          <View testID="page-area" style={[styles.page, pageInset > 0 && { marginBottom: pageInset }]}>
            {uri !== null ? (
              <WebView<object>
                ref={webviewRef}
                source={{ uri }}
                originWhitelist={['http://*', 'https://*']}
                style={[
                  styles.webview,
                  artBackdrop.active && styles.transparent,
                  artBackdrop.active && loading && styles.webviewLoading,
                ]}
                injectedJavaScriptBeforeContentLoaded={beforeContentScript}
                injectedJavaScript={afterContentScript}
                onMessage={received}
                onShouldStartLoadWithRequest={shouldStartLoad}
                onLoadStart={() => setFailure(null)}
                onLoadEnd={() => {
                  setPageLoaded(true);
                  // A Send still on its way when the page reloaded goes again, so the sheet closes
                  // once the computer has the answers.
                  const sending = sendingRef.current;
                  if (sending !== null) webviewRef.current?.injectJavaScript(resendScript(sending));
                }}
                onNavigationStateChange={(state) => {
                  setTitle(state.title?.startsWith('http') ? '' : (state.title ?? ''));
                  followLinkedPage(state.url);
                }}
                onError={(event) => {
                  event.preventDefault();
                  // A link this sheet sent elsewhere comes back as a cancelled load, not a failure.
                  const { code, description } = event.nativeEvent;
                  if (code === -999 || description.includes('ERR_ABORTED')) return;
                  setFailure({
                    message: WebPreviewCopy.forwardedPageFailed(page.remotePort),
                    hint: WebPreviewCopy.connectionLostHint,
                  });
                }}
                renderError={() => <View style={[styles.webview, artBackdrop.active && styles.transparent]} />}
                // Links the page opens leave through `onOpenLink`, never as a window of their own.
                setSupportMultipleWindows={false}
                allowsLinkPreview={false}
                webviewDebuggingEnabled={__DEV__}
              />
            ) : null}
            {failure !== null ? (
              <View style={[styles.state, artBackdrop.active && styles.transparent]}>
                <Text style={styles.stateBody}>{failure.message}</Text>
                {failure.hint.length > 0 ? <Text style={styles.stateHint}>{failure.hint}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={retry}
                  style={({ pressed }) => [styles.retry, pressed && { backgroundColor: P.input }]}
                >
                  <Text style={styles.retryText}>{WebPreviewCopy.retryButton}</Text>
                </Pressable>
              </View>
            ) : loading ? (
              <View style={[styles.state, artBackdrop.active && styles.transparent]} pointerEvents="none">
                <ActivityIndicator color={P.muted} />
              </View>
            ) : null}
          </View>
        </View>
      </View>
      {/* Inside the sheet's modal so it opens over the page, which stays open underneath. */}
      <ImageViewerModal chat={chat} viewer={pictures} onChange={setPictures} />
      {canShare && pageId !== null ? (
        <ShareLinkSheet
          visible={shareOpen}
          machine={machine}
          target={{ kind: 'page', pageId, title: title.length > 0 ? title : 'Live page' }}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      <AlertOutlet active />
    </Modal>
  );
}

const useStyles = themedStyles((P) => ({
  sheet: { flex: 1, backgroundColor: P.background, overflow: 'hidden' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: SHEET_BAR_MIN_HEIGHT,
    paddingLeft: 16,
    paddingRight: SHEET_BAR_PADDING_RIGHT,
    borderBottomWidth: 1,
    borderBottomColor: P.border,
  },
  heading: { flex: 1, minWidth: 0 },
  title: { color: P.foreground, fontSize: 14, fontWeight: '600' },
  detail: { color: P.muted, fontSize: 12 },
  refresh: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: P.controlPrimary,
  },
  refreshText: { color: P.background, fontSize: 12.5, fontWeight: '600' },
  close: { width: CLOSE_BUTTON_WIDTH, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1 },
  webview: { flex: 1, backgroundColor: P.background },
  transparent: { backgroundColor: 'transparent' },
  webviewLoading: { opacity: 0.01 },
  state: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
    backgroundColor: P.background,
  },
  stateBody: { color: P.foreground, fontSize: 14, textAlign: 'center' },
  stateHint: { color: P.muted, fontSize: 12.5, textAlign: 'center' },
  retry: {
    marginTop: 6,
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: P.foreground, fontSize: 13, fontWeight: '600' },
}));
