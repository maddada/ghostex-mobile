/**
 * The sheet a chat page card (`ghostex show`) opens on the phone: the published page over the whole
 * screen with a slim bar for its title, Refresh and Close, the phone form of the desktop's floating
 * page window. The page comes from the computer's gxserver through the chat's own forward
 * (`webPreview/machineLinks.ts`) and wears the chat's theme from its first paint. Like the desktop's
 * window it closes once the page's answers are sent (CDXC:SessionChat 2026-10-11 on
 * apps/desktop/src/app/window/visual_page_modal.rs).
 *
 * CDXC:SessionChat 2026-10-23 DECISION:
 * User answered "Yes, after the desktop" when asked whether the phone's page gets the desktop page window's features (the 2026-10-22 decisions on apps/desktop/src/app/window/visual_page_modal.rs): tapping a picture in the page opens the chat's image viewer over the page with every picture of the page, the page is harder to lose, reopening it goes back to where it was scrolled, and a Refresh button appears when its file changed on the computer. Asked how Android's back closes the sheet, the user picked "Two presses within 2 seconds"; asked whether pages published with `ghostex show --browser` also open here, "Yes, every page opens in the sheet" (unlike the desktop, which sends those to the browser).
 *
 * CDXC:SessionChat 2026-10-23 WHY:
 * The phone has no "outside" to click, so the desktop's two clicks away became: no swipe-to-dismiss, Close in the bar closes at once, and Android's back (the button or the edge swipe) only arms the sheet for `CLOSE_ARMED_FOR_MS` while the bar says "Press back again to close"; a second back within that time closes it. The file check runs only over the warm chat link (plain HTTP through the forward), never as an SSH exec every two seconds, which would take the computer's few SSH command slots from the terminals; a computer without the warm link gets no Refresh.
 * SEE-ALSO: apps/desktop/src/app/window/visual_page_modal/source.rs (the desktop's check and Refresh), server/src/visual_pages/source.rs (the two routes).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { GhostexNative } from '../../../../modules/ghostex-native/src';
import { useVerticalBarSpace } from '../../../components/common/verticalBar/VerticalBarArea';
import { WebPreviewCopy } from '../../../copy';
import type { MachineConnectionTarget } from '../../../machines/credentials';
import { useSettingsStore } from '../../../settings/store';
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
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Glyph } from './icons';
import { ImageViewerModal, type ImageViewerList } from './ImageViewer';
import { keepUnsavedDraft, sendUnsavedDraft } from './pageDrafts';
import { PAGE_SCRIPT, PENDING_DRAFT_SCRIPT, pageIdOfPath, readPageMessage } from './pageSheetScript';

/** How long the first back press keeps the sheet armed for a second one to close it. */
const CLOSE_ARMED_FOR_MS = 2_000;
/** How often the open sheet asks whether the page's file changed (the desktop's interval). */
const SOURCE_CHECK_EVERY_MS = 2_000;
const SOURCE_CHECK_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 30_000;
/** How long the page has to hand over the draft it had not saved, when it closes or moves port. */
const PENDING_DRAFT_TIMEOUT_MS = 800;

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
 * The page through the phone's forward on `localPort`, in the chat's theme. `gx-floating=1`: the
 * page closes itself once its answers are sent, as in the desktop's window.
 */
function sheetUri(page: ComputerAddress, localPort: number): string {
  const themed = withPageTheme(page.path, useSettingsStore.getState().settings.sessionChatTheme);
  return localPreviewUrl(page.scheme, localPort, `${themed}${themed.includes('#') ? '&' : '#'}gx-floating=1`);
}

export type PageSheetProps = {
  chat: RustChat;
  machine: MachineConnectionTarget;
  /** The page on the computer (`/visual/<id>` on its gxserver), or `null` while closed. */
  page: ComputerAddress | null;
  onClose: () => void;
  /**
   * A link the page followed, written as the computer would (`http://127.0.0.1:<port>/…`). The
   * opener decides whether it replaces the page, goes to the phone's browser, or closes the sheet
   * and opens elsewhere, as the desktop's page window sends the page's links out.
   */
  onOpenLink: (url: string) => void;
};

export function PageSheet({ chat, machine, page, onClose, onOpenLink }: PageSheetProps) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const insets = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
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
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [pictures, setPictures] = useState<ImageViewerList | null>(null);
  const [armed, setArmed] = useState(false);
  const [changed, setChanged] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  /** Takes the page's answer to {@link PENDING_DRAFT_SCRIPT} while one is awaited. */
  const draftReplyRef = useRef<((draft: Record<string, unknown> | null) => void) | null>(null);

  // Opening (or reopening) a page: the forward first, then the page through it.
  useEffect(() => {
    setUri(null);
    uriRef.current = null;
    localPortRef.current = null;
    setFailure(null);
    setLoading(true);
    setTitle('');
    setPictures(null);
    setArmed(false);
    if (page === null) return undefined;
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
      Alert.alert('The page could not be refreshed', answer.error.message);
      return;
    }
    setChanged(false);
    webviewRef.current?.reload();
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
      const url =
        page !== null && parsed.host === LOOPBACK_HOST && parsed.port === localPort
          ? `${parsed.scheme}://${LOOPBACK_HOST}:${page.remotePort}${parsed.pathAndQuery}`
          : request.url;
      onOpenLink(url);
      return false;
    },
    [onOpenLink, page],
  );

  const received = useCallback(
    (event: WebViewMessageEvent) => {
      const message = readPageMessage(event.nativeEvent.data);
      if (message === null) return;
      if (message.type === 'images') setPictures({ images: message.images, index: message.index });
      else if (message.type === 'draft') draftReplyRef.current?.(message.draft);
      else close();
    },
    [close],
  );

  if (page === null) return null;
  const retry = () => setAttempt((current) => current + 1);
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={backPressed}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.sheet, { paddingTop: insets.top, paddingBottom: insets.bottom }, bar.padding]}>
        <View style={styles.bar}>
          <View style={styles.heading}>
            <Text numberOfLines={1} style={styles.title}>
              {title.length > 0 ? title : 'Page'}
            </Text>
            <Text numberOfLines={1} style={[styles.detail, armed && { color: P.foreground }]}>
              {armed ? 'Press back again to close' : 'Interactive page'}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close page"
            onPress={close}
            hitSlop={6}
            style={({ pressed }) => [styles.close, pressed && { backgroundColor: P.input }]}
          >
            <Glyph name="x" size={18} color={P.primary} />
          </Pressable>
        </View>
        <View style={styles.page}>
          {uri !== null ? (
            <WebView<object>
              ref={webviewRef}
              source={{ uri }}
              originWhitelist={['http://*', 'https://*']}
              style={styles.webview}
              injectedJavaScriptBeforeContentLoaded={PAGE_SCRIPT}
              injectedJavaScript={PAGE_SCRIPT}
              onMessage={received}
              onShouldStartLoadWithRequest={shouldStartLoad}
              onLoadStart={() => setFailure(null)}
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(state) => setTitle(state.title?.startsWith('http') ? '' : (state.title ?? ''))}
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
              renderError={() => <View style={styles.webview} />}
              // Links the page opens leave through `onOpenLink`, never as a window of their own.
              setSupportMultipleWindows={false}
              allowsLinkPreview={false}
              webviewDebuggingEnabled={__DEV__}
            />
          ) : null}
          {failure !== null ? (
            <View style={styles.state}>
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
            <View style={styles.state} pointerEvents="none">
              <ActivityIndicator color={P.muted} />
            </View>
          ) : null}
        </View>
      </View>
      {/* Inside the sheet's modal so it opens over the page, which stays open underneath. */}
      <ImageViewerModal chat={chat} viewer={pictures} onChange={setPictures} />
    </Modal>
  );
}

const useStyles = themedStyles((P) => ({
  sheet: { flex: 1, backgroundColor: P.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 8,
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
  close: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1 },
  webview: { flex: 1, backgroundColor: P.background },
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
