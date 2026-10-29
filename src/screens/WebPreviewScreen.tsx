/**
 * Web preview: browse a web app running on the computer.
 *
 * The page is fetched from `http://127.0.0.1:<localPort>` on the phone, which is
 * one end of an SSH local port forward whose other end is `localhost:<remotePort>`
 * on the computer. The user is never shown the phone-side port: the address bar
 * and every message here say `localhost:<remotePort>`, which is what the same
 * page is at on the computer.
 *
 * The computer's own gxserver (an agent's `ghostex show` page, which posts its
 * answers and draft back to the same origin) is reached through the forward the
 * chat link already holds to it, never one of the preview's own, and that
 * forward stays up when the preview is left (`webPreview/machineLinks.ts`).
 *
 * Cross-port links are followed the same way. `onShouldStartLoadWithRequest`
 * sees every navigation (including `target=_blank`), so a link to another
 * loopback port gets its own forward and is then loaded rewritten. Requests the
 * page makes itself — fetch/XHR/WebSocket — cannot be intercepted from here, so
 * a page that calls a second port from JavaScript still has to be opened on that
 * port directly. Form posts to an already-forwarded port are rewritten in the
 * page instead (see `buildLinkRewriteScript`), because a cancelled-and-reissued
 * navigation would lose the request body.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type ViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewErrorEvent } from 'react-native-webview/lib/WebViewTypes';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { measureInWindow } from '../components/common/measureInWindow';
import { bandRowFrame } from '../components/common/verticalBar/layout';
import {
  barBackgroundToEdges,
  railMenuItems,
  useBandOverflow,
  useContentTop,
  useHeaderPlacement,
  useLiveMenuAnchor,
  useRailButtons,
  useRailOverflow,
  useVerticalBarSpace,
  type RailButtons,
  type RailEntry,
} from '../components/common/verticalBar/VerticalBarArea';
import ContextMenu, { type MenuAnchor } from '../components/sessions/ContextMenu';
import {
  ArrowIcon,
  CloseIcon,
  DesktopIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  RefreshIcon,
} from '../components/terminal/icons';
import { DuoChromeCopy, WebPreviewCopy } from '../copy';
import { ensureConnected } from '../inventory/client';
import { hasPassword } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette } from '../theme/palette';
import { describeForwardFailure, startWebPreviewForward, type WebPreviewFailure } from '../webPreview/forwards';
import { holdComputerForward, releaseComputerForward } from '../webPreview/machineLinks';
import { DESKTOP_VIEWPORT_SCRIPT, desktopUserAgent, siteKeyForUrl } from '../webPreview/desktopSite';
import { useWebPreviewStore } from '../webPreview/store';
import {
  LOOPBACK_HOST,
  isLoopbackHost,
  localPreviewUrl,
  parseHttpUrl,
  parseAddressInput,
  remoteDisplayAddress,
} from '../webPreview/urls';
import { BAND_ROW_HEIGHT, BAND_ROW_PADDING, TOOLBAR_BUTTON_SIZE, TOOLBAR_PADDING, styles } from './web-preview/styles';

type Props = NativeStackScreenProps<RootStackParamList, 'WebPreview'>;

/**
 * iOS also reports whether the navigation has a target frame. A `target=_blank`
 * link has none, which makes `isTopFrame` false even though the navigation is
 * not a sub-frame at all; the flag is missing on Android.
 */
type PreviewLoadRequest = ShouldStartLoadRequest & { hasTargetFrame?: boolean };

/**
 * One place on the computer, as the preview means to open it. `host` is the loopback host the link
 * named, which the computer's end of the forward dials (`computerDialHost`).
 */
type RemoteTarget = { scheme: 'http' | 'https'; remotePort: number; path: string; host: string };

/**
 * A failure and where it came from. A forward that never opened has no failed
 * page behind it, so this screen draws its surface itself; a page that failed to
 * load is drawn through RNCWebView's own error slot, which keeps the WebView —
 * and therefore its history — mounted underneath.
 */
type PreviewFailureState = WebPreviewFailure & { origin: 'forward' | 'load' };

/**
 * What the address bar shows. A preview can leave the computer entirely by
 * following an ordinary web link, and then the honest address is the real one.
 */
type PreviewAddress = ({ kind: 'remote' } & RemoteTarget) | { kind: 'external'; url: string };

/**
 * The page the WebView is told to load. The nonce only changes when the same
 * URI has to be loaded again from a page that has since navigated elsewhere,
 * because React drops an identical `source.uri` and RNCWebView would never see
 * the request.
 */
type PreviewSource = { uri: string; nonce: number };

function addressText(address: PreviewAddress): string {
  return address.kind === 'remote'
    ? `${address.scheme}://${remoteDisplayAddress(address.remotePort, address.path)}`
    : address.url;
}

/**
 * Whether a navigation replaces the page, rather than loading into a sub-frame.
 *
 * Android never reports the flag: its WebView only raises
 * shouldOverrideUrlLoading for the top frame, and the synchronous bridge
 * path (RNCWebViewClient.createWebViewEvent) omits `isTopFrame`
 * altogether, so it arrives here as undefined. Only an explicit `false`
 * means a sub-frame — and on iOS not even then, because a `target=_blank`
 * link has no target frame at all, which also makes `isTopFrame` false.
 * Those are exactly the links that must be rewritten, not handed to
 * WebKit's own new-window path.
 */
function isTopNavigation(request: PreviewLoadRequest): boolean {
  return request.isTopFrame !== false || request.hasTargetFrame === false;
}

/**
 * A navigation this screen cancelled itself, reported back as a load failure.
 * `NSURLErrorCancelled` on iOS and `net::ERR_ABORTED` on Android both mean "the
 * app stopped this load", which is the rewrite working, not a page that failed.
 */
function isCancelledLoad(code: number, description: string): boolean {
  return code === -999 || description.includes('ERR_ABORTED');
}

/**
 * Rewrite absolute computer-side URLs to the phone-side origin, in the page.
 *
 * `onShouldStartLoadWithRequest` can only cancel a navigation and start a new
 * one, which turns a form POST into a GET and drops its body. Ports that are
 * already forwarded therefore have their `form[action]` and `a[href]`
 * attributes pointed straight at the phone-side origin, so those submissions
 * never reach the navigation handler. A port that is not forwarded yet is left
 * alone and still goes through the handler, which is what opens its forward.
 */
function buildLinkRewriteScript(forwarded: ReadonlyArray<readonly [number, number]>): string {
  const table = JSON.stringify(Object.fromEntries(forwarded.map(([remote, local]) => [String(remote), local])));
  return `(function () {
  try {
    var map = ${table};
    var pattern = /^(https?:)\\/\\/(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(?::(\\d+))?(?=[\\/?#]|$)/i;
    var rewrite = function (value) {
      if (typeof value !== 'string') return null;
      var match = pattern.exec(value);
      if (match === null) return null;
      var port = match[2] === undefined ? (match[1] === 'https:' ? 443 : 80) : parseInt(match[2], 10);
      var local = map[String(port)];
      if (local === undefined) return null;
      return match[1] + '//${LOOPBACK_HOST}:' + local + value.slice(match[0].length);
    };
    var retarget = function (root, selector, attribute) {
      if (typeof root.querySelectorAll !== 'function') return;
      var nodes = root.querySelectorAll(selector);
      for (var index = 0; index < nodes.length; index++) {
        var current = nodes[index].getAttribute(attribute);
        var next = rewrite(current);
        // An unchanged value would re-enter the observer below for nothing.
        if (next !== null && next !== current) nodes[index].setAttribute(attribute, next);
      }
    };
    var apply = function (root) {
      retarget(root, 'form[action]', 'action');
      retarget(root, 'a[href]', 'href');
    };
    apply(document);
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) apply(added[j]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (error) {
    // A page that forbids DOM access keeps working through the navigation handler.
  }
  true;
})();`;
}

/** The toolbar buttons of the status band's row: side by side, `TOOLBAR_BUTTON_SIZE` wide. */
const WEB_BAND_BUTTONS = { size: TOOLBAR_BUTTON_SIZE, gap: 0 } as const;

export default function WebPreviewScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const headerPlacement = useHeaderPlacement();
  /**
   * CDXC:Mobile 2026-10-25 WHY: react-native-webview 14.0.1 declares `class WebView<P = undefined>`,
   * so its props become `WebViewProps & undefined`, which TypeScript reduces to `never` and every
   * prop fails to type. `WebView<object>` restores the 13.x default (`P = {}`); drop it here, in
   * DocViewerScreen.tsx and in chat/native/cards/PageSheet.tsx once the package fixes its default.
   */
  const webviewRef = useRef<WebView<object>>(null);
  const machine = useMachinesStore((state) =>
    state.machines.find((candidate) => candidate.id === route.params.machineId),
  );
  const setLastPort = useWebPreviewStore((state) => state.setLastPort);
  const hydrateWebPreview = useWebPreviewStore((state) => state.hydrate);
  const previewHydrated = useWebPreviewStore((state) => state.hydrated);
  const setDesktopSite = useWebPreviewStore((state) => state.setDesktopSite);

  /*
   * The machine record is rebuilt whenever the inventory records a connection,
   * so it must not be a dependency of anything that would re-forward and reload
   * the page. Only its id identifies the forwards, and that never changes here.
   */
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const mountedRef = useRef(true);
  const machineId = route.params.machineId;

  /*
   * Resolved while the screen is idle, because the failure copy needs it from a
   * catch block and awaiting a keychain read there could replace the failure
   * being reported with one nobody is waiting for.
   */
  const hasPasswordRef = useRef(false);

  /*
   * This screen's live forwards, both ways round. `remoteToLocal` answers "does
   * this computer-side port already have a tunnel", `localToRemote` answers "is
   * this loopback URL one we produced". They are refs rather than state because
   * `onShouldStartLoadWithRequest` has to decide synchronously.
   */
  const remoteToLocalRef = useRef(new Map<number, number>());
  const localToRemoteRef = useRef(new Map<number, number>());
  /**
   * Whether the WebView on screen was built for the desktop site. The user agent cannot be changed
   * under a live page, so a change of mode remounts the WebView (`webViewKey`) and loads again.
   * A ref too, because `onShouldStartLoadWithRequest` has to decide synchronously.
   */
  const desktopModeRef = useRef(false);
  const [desktopMode, setDesktopMode] = useState(false);
  /** Mirror of `remoteToLocal` for the in-page rewrite, which needs a render. */
  const [forwardedPairs, setForwardedPairs] = useState<ReadonlyArray<readonly [number, number]>>([]);

  /** Where Retry goes: the port that was last asked for, failed or not. */
  const intendedRef = useRef<RemoteTarget>({
    scheme: route.params.scheme ?? 'http',
    remotePort: route.params.remotePort ?? 80,
    path: route.params.path ?? '/',
    host: route.params.host ?? 'localhost',
  });
  /**
   * Ports whose forward this screen holds (`holdComputerForward`), released when it goes. The
   * computer's own gxserver is never among them: its forward is the chat link's
   * (`gxserverPortsRef`), and closing it when the preview was left dropped the chat's socket.
   */
  const heldPortsRef = useRef(new Set<number>());
  const gxserverPortsRef = useRef(new Set<number>());
  /**
   * The host each port was first opened with. A page at `127.0.0.1:3000` linking to
   * `localhost:3000` keeps its forward instead of replacing it (and the page's origin) with one that
   * dials another host.
   */
  const hostByPortRef = useRef(new Map<number, string>());
  /** Guards every state write against an older navigation finishing last. */
  const seqRef = useRef(0);

  const [address, setAddress] = useState<PreviewAddress>(() =>
    route.params.url ? { kind: 'external', url: route.params.url } : { kind: 'remote', ...intendedRef.current },
  );
  const [addressDraft, setAddressDraft] = useState(() => addressText(address));
  const editingAddressRef = useRef(false);
  const addressInputRef = useRef<TextInputInstance>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  useEffect(() => {
    if (!editingAddressRef.current) setAddressDraft(addressText(address));
  }, [address]);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const [failure, setFailure] = useState<PreviewFailureState | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  /** The page's own load progress (0 to 1), for the bar under the address bar. */
  const [loadProgress, setLoadProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void hasPassword(machineId).then((value) => {
      hasPasswordRef.current = value;
    });
  }, [machineId]);

  /*
   * Leaving the preview releases the phone-side listeners it opened. The
   * machine id is the only thing needed to name them, and it never changes for
   * a mounted screen, so this runs exactly once, on unmount.
   */
  useEffect(() => {
    const forwarded = remoteToLocalRef.current;
    const held = heldPortsRef.current;
    return () => {
      for (const remotePort of held) void releaseComputerForward(machineId, remotePort);
      held.clear();
      forwarded.clear();
    };
  }, [machineId]);

  /*
   * Forwards belong to the SSH connection. When it goes, every phone-side port
   * this screen recorded names a listener that no longer exists, and a
   * reconnect can hand the same number back to a different remote port — so the
   * tables are forgotten rather than reused.
   */
  useEffect(() => {
    const subscription = GhostexNative.addListener('onConnectionState', (event) => {
      if (event.machineId !== machineId) return;
      if (event.state !== 'disconnected' && event.state !== 'failed') return;
      remoteToLocalRef.current.clear();
      localToRemoteRef.current.clear();
      // The connection took every forward with it, and with them every hold.
      heldPortsRef.current.clear();
      if (mountedRef.current) setForwardedPairs([]);
    });
    return () => subscription.remove();
  }, [machineId]);

  /** The remembered Desktop site choice for the site `url` belongs to. */
  const wantsDesktopSite = useCallback((url: string): boolean => {
    const key = siteKeyForUrl(url, (localPort) => localToRemoteRef.current.get(localPort));
    return key !== null && useWebPreviewStore.getState().desktopSites[key] === true;
  }, []);

  /**
   * Put `uri` on screen. An identical `source.uri` is dropped by React and by
   * RNCWebView, so the same page is reloaded through the ref (which keeps
   * history) and only a source prop that has gone stale forces a remount.
   */
  const loadUri = useCallback(
    (uri: string): void => {
      const wanted = wantsDesktopSite(uri);
      const modeChanged = wanted !== desktopModeRef.current;
      if (modeChanged) {
        desktopModeRef.current = wanted;
        setDesktopMode(wanted);
      }
      if (!modeChanged && currentUrlRef.current === uri) {
        webviewRef.current?.reload();
        return;
      }
      setSource((previous) => {
        if (previous === null) return { uri, nonce: 0 };
        // A new user agent needs a new WebView, so a mode change always takes a fresh nonce.
        return previous.uri === uri || modeChanged
          ? { uri, nonce: previous.nonce + 1 }
          : { uri, nonce: previous.nonce };
      });
    },
    [wantsDesktopSite],
  );

  /** Forward `remotePort`, then load it. Native is idempotent per (machine, port). */
  const openRemotePort = useCallback(
    async (scheme: 'http' | 'https', remotePort: number, path: string, linkHost: string): Promise<void> => {
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      const isCurrent = (): boolean => mountedRef.current && seqRef.current === seq;
      const host = hostByPortRef.current.get(remotePort) ?? linkHost;
      intendedRef.current = { scheme, remotePort, path, host };

      const target = machineRef.current;
      if (target === undefined) {
        if (isCurrent()) {
          setFailure({ origin: 'forward', message: WebPreviewCopy.machineMissing, hint: '' });
          setConnecting(false);
        }
        return;
      }
      // The address bar names what is being opened, so a failure keeps pointing
      // at the port that failed instead of the last one that worked.
      setAddress({ kind: 'remote', scheme, remotePort, path, host });
      setConnecting(true);
      setFailure(null);
      try {
        const { localPort, gxserver } = await startWebPreviewForward(target, { remotePort, host, path });
        /*
         * Recorded before the liveness checks below: the forward exists now, and
         * a screen that has gone away still has to release it.
         */
        hostByPortRef.current.set(remotePort, host);
        if (gxserver) gxserverPortsRef.current.add(remotePort);
        else if (!heldPortsRef.current.has(remotePort)) {
          holdComputerForward(target.id, remotePort);
          heldPortsRef.current.add(remotePort);
        }
        const previousLocal = remoteToLocalRef.current.get(remotePort);
        if (previousLocal !== undefined && previousLocal !== localPort) localToRemoteRef.current.delete(previousLocal);
        remoteToLocalRef.current.set(remotePort, localPort);
        localToRemoteRef.current.set(localPort, remotePort);
        if (!mountedRef.current) {
          remoteToLocalRef.current.delete(remotePort);
          localToRemoteRef.current.delete(localPort);
          if (heldPortsRef.current.delete(remotePort)) void releaseComputerForward(target.id, remotePort);
          return;
        }
        setForwardedPairs([...remoteToLocalRef.current.entries()]);
        if (seqRef.current !== seq) return;
        loadUri(localPreviewUrl(scheme, localPort, path));
        // The Ports screen's prefill is for the user's own servers, not a page gxserver published.
        if (!gxserver) setLastPort(target.id, remotePort);
      } catch (error) {
        if (!isCurrent()) return;
        setFailure({ origin: 'forward', ...describeForwardFailure(remotePort, error, hasPasswordRef.current) });
        // The page behind the failure surface is not the one being addressed.
        setCanGoBack(false);
        setCanGoForward(false);
      } finally {
        if (isCurrent()) setConnecting(false);
      }
    },
    [loadUri, setLastPort],
  );

  const openAddress = useCallback(
    (url: string): void => {
      const parsed = parseHttpUrl(url);
      if (parsed === null) return;
      if (isLoopbackHost(parsed.host)) {
        void openRemotePort(parsed.scheme, parsed.port, parsed.pathAndQuery, parsed.host);
        return;
      }
      // A newly entered website supersedes any pending port-forward navigation.
      seqRef.current += 1;
      setAddress({ kind: 'external', url });
      setFailure(null);
      setConnecting(false);
      loadUri(url);
    },
    [loadUri, openRemotePort],
  );

  const submitAddress = useCallback((): void => {
    const url = parseAddressInput(addressDraft);
    if (url === null) {
      setAddressError(WebPreviewCopy.invalidAddress);
      return;
    }
    editingAddressRef.current = false;
    addressInputRef.current?.blur();
    setAddressError(null);
    setAddressDraft(url);
    openAddress(url);
  }, [addressDraft, openAddress]);

  /*
   * Retry re-establishes only the port that failed. The forward it is replacing
   * may still be half-alive on the native side, so it is released and forgotten
   * before the new one is asked for; forwards for other ports this preview
   * opened are healthy and stay up. gxserver's forward is the chat's and is never
   * closed from here: the SSH connection is verified instead, and a dead one is
   * redialled, which brings every forward back fresh.
   */
  const retry = useCallback((): void => {
    if (address.kind === 'external') {
      openAddress(address.url);
      return;
    }
    void (async () => {
      const target = intendedRef.current;
      const stale = remoteToLocalRef.current.get(target.remotePort);
      if (stale !== undefined) {
        remoteToLocalRef.current.delete(target.remotePort);
        localToRemoteRef.current.delete(stale);
        if (mountedRef.current) setForwardedPairs([...remoteToLocalRef.current.entries()]);
        const machineTarget = machineRef.current;
        if (gxserverPortsRef.current.has(target.remotePort)) {
          if (machineTarget !== undefined)
            await ensureConnected(machineTarget, { verify: true }).catch(() => undefined);
        } else if (heldPortsRef.current.delete(target.remotePort)) {
          await releaseComputerForward(machineId, target.remotePort);
        }
      }
      await openRemotePort(target.scheme, target.remotePort, target.path, target.host);
    })();
  }, [address, machineId, openAddress, openRemotePort]);

  // Opening the screen, and re-opening it with new params from a followed link.
  useEffect(() => {
    if (route.params.url !== undefined) {
      openAddress(route.params.url);
      return;
    }
    void openRemotePort(
      route.params.scheme ?? 'http',
      route.params.remotePort ?? 80,
      route.params.path ?? '/',
      route.params.host ?? 'localhost',
    );
  }, [
    openAddress,
    openRemotePort,
    route.params.url,
    route.params.path,
    route.params.remotePort,
    route.params.scheme,
    route.params.host,
  ]);

  /** Whether the page on screen is one the computer's gxserver serves (a `ghostex show` page). */
  const onGxserverPage = useCallback((): boolean => {
    const parsed = currentUrlRef.current === null ? null : parseHttpUrl(currentUrlRef.current);
    if (parsed === null || parsed.host !== LOOPBACK_HOST) return false;
    const remotePort = localToRemoteRef.current.get(parsed.port);
    return remotePort !== undefined && gxserverPortsRef.current.has(remotePort);
  }, []);

  const handleShouldStartLoad = useCallback(
    (request: PreviewLoadRequest): boolean => {
      const parsed = parseHttpUrl(request.url);
      // about:blank, data:, blob: and app schemes are the WebView's business.
      if (parsed === null) return true;
      if (!isLoopbackHost(parsed.host)) {
        /*
         * A web link on a page the computer's gxserver published (`ghostex show`) goes to the
         * phone's browser, as the desktop's page window sends it to the user's browser, so the
         * page (and the answers being written in it) stays put. Elsewhere an ordinary web link
         * is not on the computer and loads in place.
         */
        if (isTopNavigation(request) && onGxserverPage()) {
          void Linking.openURL(request.url).catch(() => undefined);
          return false;
        }
        /*
         * Following a link to a site with the other Desktop site choice reloads it in that mode,
         * as Safari does; a link within the same site keeps the page it is on.
         */
        if (isTopNavigation(request) && wantsDesktopSite(request.url) !== desktopModeRef.current) {
          loadUri(request.url);
          return false;
        }
        return true;
      }
      /*
       * Only page navigations are rewritten. A sub-frame cannot be moved to a
       * different port without replacing the whole page, and it belongs to the
       * same class as fetch/XHR: a resource the preview cannot re-point.
       */
      if (!isTopNavigation(request)) return true;
      /*
       * Our own rewritten URLs come back through here on every navigation the
       * page makes. They are the only loopback URLs whose host is 127.0.0.1 and
       * whose port this screen forwarded, so that pair identifies them.
       */
      if (parsed.host === LOOPBACK_HOST && localToRemoteRef.current.has(parsed.port)) {
        if (wantsDesktopSite(request.url) !== desktopModeRef.current) {
          loadUri(request.url);
          return false;
        }
        return true;
      }
      /*
       * Always through the native call, never through the table: a reconnect
       * this screen has not heard about yet leaves the table naming a listener
       * that is gone, and `startPortForward` is idempotent while the connection
       * lives and reports `E_NOT_CONNECTED` when it does not.
       */
      void openRemotePort(parsed.scheme, parsed.port, parsed.pathAndQuery, parsed.host);
      return false;
    },
    [loadUri, onGxserverPage, openRemotePort, wantsDesktopSite],
  );

  const handleNavigationStateChange = useCallback((state: WebViewNavigation): void => {
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
    const parsed = parseHttpUrl(state.url);
    if (parsed === null) return;
    currentUrlRef.current = state.url;
    setCurrentUrl(state.url);
    const remotePort = parsed.host === LOOPBACK_HOST ? localToRemoteRef.current.get(parsed.port) : undefined;
    if (remotePort === undefined) setAddress({ kind: 'external', url: state.url });
    else {
      setAddress({
        kind: 'remote',
        scheme: parsed.scheme,
        remotePort,
        path: parsed.pathAndQuery,
        host: hostByPortRef.current.get(remotePort) ?? 'localhost',
      });
    }
  }, []);

  /**
   * A page that would not load. The tunnel is plain TCP end to end, so a
   * loopback origin this screen forwarded can fail because the SSH connection
   * went away or because the port does not speak the scheme that was asked for;
   * both are named, and both are answered by Retry.
   */
  const handleLoadError = useCallback((event: WebViewErrorEvent): void => {
    const { code, description, url } = event.nativeEvent;
    if (isCancelledLoad(code, description)) {
      // Our own rewrite stopping the original navigation is not a failure.
      event.preventDefault();
      return;
    }
    const parsed = parseHttpUrl(url);
    const remotePort =
      parsed !== null && parsed.host === LOOPBACK_HOST ? localToRemoteRef.current.get(parsed.port) : undefined;
    if (parsed === null || remotePort === undefined) {
      setFailure({
        origin: 'load',
        message: WebPreviewCopy.externalPageFailed(url),
        hint: WebPreviewCopy.externalPageFailedHint,
      });
    } else {
      // Retry re-attempts the page that failed, not the last one that worked.
      intendedRef.current = {
        scheme: parsed.scheme,
        remotePort,
        path: parsed.pathAndQuery,
        host: hostByPortRef.current.get(remotePort) ?? 'localhost',
      };
      setFailure({
        origin: 'load',
        message:
          parsed.scheme === 'https'
            ? WebPreviewCopy.httpsTunnelFailed(remotePort)
            : WebPreviewCopy.forwardedPageFailed(remotePort),
        hint: WebPreviewCopy.connectionLostHint,
      });
    }
    setCanGoBack(false);
    setCanGoForward(false);
  }, []);

  const goBack = useCallback((): void => {
    webviewRef.current?.goBack();
  }, []);

  const goForward = useCallback((): void => {
    webviewRef.current?.goForward();
  }, []);

  const reload = useCallback((): void => {
    webviewRef.current?.reload();
  }, []);

  /** The site on screen, which the Desktop site choice is remembered under. */
  const siteKey = useMemo(
    () =>
      currentUrl === null ? null : siteKeyForUrl(currentUrl, (localPort) => localToRemoteRef.current.get(localPort)),
    [currentUrl],
  );

  /** Remember the choice for this site, then show the page again in the new mode. */
  const toggleDesktopSite = useCallback((): void => {
    const url = currentUrlRef.current;
    if (siteKey === null || url === null) return;
    setDesktopSite(siteKey, !desktopModeRef.current);
    loadUri(url);
  }, [loadUri, setDesktopSite, siteKey]);

  /*
   * The remembered sites are read from disk, and a preview opened straight from a link can have
   * loaded its first page before that finished. When the table arrives and the page on screen
   * should have been the other mode, it is shown again.
   */
  useEffect(() => {
    void hydrateWebPreview();
  }, [hydrateWebPreview]);
  useEffect(() => {
    const url = currentUrlRef.current;
    if (previewHydrated && url !== null && wantsDesktopSite(url) !== desktopModeRef.current) loadUri(url);
  }, [loadUri, previewHydrated, wantsDesktopSite]);

  // Computer-side addresses stay in the preview that owns their forwards.
  const openInBrowser = useCallback((): void => {
    if (currentUrl === null || address.kind === 'remote' || isLoopbackHost(parseHttpUrl(currentUrl)?.host ?? ''))
      return;
    void Linking.openURL(currentUrl).catch(() => {
      Alert.alert(WebPreviewCopy.previewTitle, WebPreviewCopy.openInBrowserFailed);
    });
  }, [address.kind, currentUrl]);

  // Android's back gesture walks the page's history before leaving the preview.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!canGoBack) return false;
        webviewRef.current?.goBack();
        return true;
      });
      return () => subscription.remove();
    }, [canGoBack]),
  );

  const linkRewriteScript = useMemo(() => buildLinkRewriteScript(forwardedPairs), [forwardedPairs]);

  // On the iPhone Duo's side bar, as the approved panes mockup (owner D1, 2026-10-26): Close, Back,
  // Reload and "More options", whose menu holds Forward, Desktop Site and Open in Browser, and Reload
  // too while the side bar has no room for it. Same labels, actions and states as the toolbar. The
  // address field takes the keyboard.
  const isFocused = useIsFocused();
  const inRail = headerPlacement.kind === 'rail' && isFocused;
  // The "…" menu while open, at its button (F3). It stays open when the pose changes (FL-LAY-14),
  // following its button, or centred while the toolbar holds its items instead (status band, top).
  const [railMenu, setRailMenu] = useState<{ anchor?: MenuAnchor } | null>(null);
  const moreButtonRef = useRef<ViewInstance | null>(null);
  const railMenuAnchor = useLiveMenuAnchor(
    railMenu === null ? null : { key: 'more', pressed: railMenu.anchor },
    moreButtonRef,
  );
  const contentTop = useContentTop();
  const bar = useVerticalBarSpace();
  const reloadDisabled = source === null || failure !== null;
  const railButtons = useMemo<RailButtons>(
    () => ({
      pinned: 1,
      moreMenu: 'always',
      reserveKeyboard: true,
      entries: [
        {
          key: 'close',
          label: WebPreviewCopy.closeLabel,
          icon: (size) => <CloseIcon size={size} color={GhostexPalette.FOREGROUND} />,
          onPress: () => navigation.goBack(),
        },
        {
          key: 'back',
          label: WebPreviewCopy.backLabel,
          icon: (size) => <ArrowIcon direction="left" size={size} color={GhostexPalette.FOREGROUND} />,
          onPress: goBack,
          disabled: !canGoBack,
        },
        {
          key: 'reload',
          label: WebPreviewCopy.reloadLabel,
          icon: (size) => <RefreshIcon size={size} color={GhostexPalette.FOREGROUND} />,
          onPress: reload,
          disabled: reloadDisabled,
        },
        {
          key: 'more',
          label: DuoChromeCopy.more,
          icon: (size) => <EllipsisIcon size={size} color={GhostexPalette.FOREGROUND} />,
          onPress: (anchor) => setRailMenu({ anchor }),
        },
      ],
    }),
    [canGoBack, goBack, navigation, reload, reloadDisabled],
  );
  useRailButtons(railButtons, GhostexPalette.BACKGROUND, inRail);
  const railOverflow = useRailOverflow(railButtons, inRail);
  // The status band's row (§12 "1b"): the rail's buttons (Close, Back, Reload, "…"), those that do not
  // fit moving into the "…" menu, last first.
  const inBand = headerPlacement.kind === 'band';
  const bandOverflow = useBandOverflow(
    railButtons,
    inBand ? headerPlacement.frame.width - 2 * BAND_ROW_PADDING : 0,
    WEB_BAND_BUTTONS,
    inBand,
  );
  const overflowEntries = inBand ? bandOverflow.menu : railOverflow;
  const railMenuEntries = useMemo<RailEntry[]>(
    () => [
      ...overflowEntries,
      {
        key: 'forward',
        label: WebPreviewCopy.forwardLabel,
        icon: (size) => <ArrowIcon direction="right" size={size} color={GhostexPalette.FOREGROUND} />,
        onPress: goForward,
        disabled: !canGoForward,
      },
      {
        key: 'desktop-site',
        label: WebPreviewCopy.desktopSiteLabel,
        icon: (size) => (
          <DesktopIcon size={size} color={desktopMode ? GhostexPalette.ACCENT : GhostexPalette.FOREGROUND} />
        ),
        onPress: toggleDesktopSite,
        disabled: siteKey === null || failure !== null,
        selected: desktopMode,
      },
      {
        key: 'open-in-browser',
        label: WebPreviewCopy.openInBrowserLabel,
        icon: (size) => <ExternalLinkIcon size={size} color={GhostexPalette.FOREGROUND} />,
        onPress: openInBrowser,
        disabled: currentUrl === null || address.kind === 'remote',
      },
    ],
    [
      address.kind,
      canGoForward,
      currentUrl,
      desktopMode,
      failure,
      goForward,
      openInBrowser,
      overflowEntries,
      siteKey,
      toggleDesktopSite,
    ],
  );

  /*
   * RNCWebView keeps the WebView mounted and draws this over it, so the page's
   * history and scroll position survive a failure. It stays in its error state
   * until a load finishes, which includes the moments after Retry has already
   * started the next attempt — hence the connecting surface for that window.
   */
  const renderLoadFailure = useCallback(
    () =>
      failure !== null && failure.origin === 'load' ? (
        <PreviewFailure failure={failure} onRetry={retry} />
      ) : (
        <ConnectingSurface address={address} />
      ),
    [address, failure, retry],
  );

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <View
        style={[
          styles.toolbar,
          // In the side bar's poses the address row is the top row: below the system's top margin (F1),
          // its background running on under the side bar (F4).
          headerPlacement.kind === 'rail'
            ? [{ paddingTop: contentTop }, barBackgroundToEdges(bar, TOOLBAR_PADDING)]
            : { paddingTop: insets.top + 6 },
        ]}
      >
        {/* On the iPhone Duo unfolded in portrait the buttons stand in the status band; the address row stays below it.
            In the side bar's poses they stand there instead (railButtons). */}
        {headerPlacement.kind === 'band' ? (
          <View
            style={[
              styles.toolbarButtons,
              styles.bandToolbarButtons,
              bandRowFrame(headerPlacement.frame, BAND_ROW_HEIGHT),
            ]}
          >
            {railButtons.entries
              .filter((entry) => bandOverflow.shows(entry.key))
              .map((entry) => (
                <ToolbarButton
                  key={entry.key}
                  buttonRef={entry.key === 'more' ? moreButtonRef : undefined}
                  label={entry.label}
                  disabled={entry.disabled}
                  onPress={() =>
                    entry.key === 'more' ? measureInWindow(moreButtonRef, entry.onPress) : entry.onPress()
                  }
                  icon={entry.icon(18)}
                />
              ))}
          </View>
        ) : headerPlacement.kind === 'rail' ? null : (
          <View style={[styles.toolbarButtons]}>
            <ToolbarButton
              label={WebPreviewCopy.closeLabel}
              onPress={() => navigation.goBack()}
              icon={<CloseIcon size={18} color={GhostexPalette.FOREGROUND} />}
            />
            <View style={styles.toolbarNavGroup}>
              <ToolbarButton
                label={WebPreviewCopy.backLabel}
                disabled={!canGoBack}
                onPress={goBack}
                icon={<ArrowIcon direction="left" size={18} color={GhostexPalette.FOREGROUND} />}
              />
              <ToolbarButton
                label={WebPreviewCopy.forwardLabel}
                disabled={!canGoForward}
                onPress={goForward}
                icon={<ArrowIcon direction="right" size={18} color={GhostexPalette.FOREGROUND} />}
              />
              <ToolbarButton
                label={WebPreviewCopy.reloadLabel}
                disabled={source === null || failure !== null}
                onPress={reload}
                icon={<RefreshIcon size={18} color={GhostexPalette.FOREGROUND} />}
              />
            </View>
            <ToolbarButton
              label={WebPreviewCopy.desktopSiteLabel}
              disabled={siteKey === null || failure !== null}
              active={desktopMode}
              onPress={toggleDesktopSite}
              icon={<DesktopIcon size={18} color={desktopMode ? GhostexPalette.ACCENT : GhostexPalette.FOREGROUND} />}
            />
            <ToolbarButton
              label={WebPreviewCopy.openInBrowserLabel}
              disabled={currentUrl === null || address.kind === 'remote'}
              onPress={openInBrowser}
              icon={<ExternalLinkIcon size={18} color={GhostexPalette.FOREGROUND} />}
            />
          </View>
        )}
        <View style={styles.addressBar}>
          <TextInput
            ref={addressInputRef}
            style={styles.addressText}
            value={addressDraft}
            onFocus={() => {
              editingAddressRef.current = true;
            }}
            onBlur={() => {
              editingAddressRef.current = false;
            }}
            onChangeText={(value) => {
              setAddressDraft(value);
              setAddressError(null);
            }}
            onSubmitEditing={submitAddress}
            accessibilityLabel={WebPreviewCopy.manualSection}
            placeholder={WebPreviewCopy.manualPlaceholder}
            placeholderTextColor={GhostexPalette.MUTED}
            keyboardType="url"
            returnKeyType="go"
            submitBehavior="submit"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            selectTextOnFocus
          />
          <ToolbarButton
            label={WebPreviewCopy.openButton}
            onPress={submitAddress}
            icon={<ArrowIcon direction="right" size={18} color={GhostexPalette.FOREGROUND} />}
          />
        </View>
        {addressError !== null ? (
          <Text accessibilityRole="alert" style={styles.errorBannerBody}>
            {addressError}
          </Text>
        ) : null}
      </View>

      <View style={styles.contentArea}>
        {source !== null ? (
          <WebView<object>
            ref={webviewRef}
            key={`${source.nonce}:${desktopMode ? 'desktop' : 'phone'}`}
            source={{ uri: source.uri }}
            originWhitelist={['http://*', 'https://*']}
            style={styles.webview}
            onNavigationStateChange={handleNavigationStateChange}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onError={handleLoadError}
            renderError={renderLoadFailure}
            // Android runs the before-content script at navigation start, ahead of the new document,
            // so the viewport is also set once the page has loaded; WebKit runs it at document start.
            injectedJavaScript={desktopMode ? `${linkRewriteScript}\n${DESKTOP_VIEWPORT_SCRIPT}` : linkRewriteScript}
            // CDXC:Browser 2026-10-17 WHY: the Desktop site switch is the phone side of the desktop
            // Browser's size and user-agent menu. WebKit takes a desktop content mode plus the Mac
            // Safari agent; Android takes the Chrome agent and a desktop-width viewport tag.
            userAgent={desktopMode ? desktopUserAgent() : undefined}
            contentMode={desktopMode ? 'desktop' : 'recommended'}
            injectedJavaScriptBeforeContentLoaded={desktopMode ? DESKTOP_VIEWPORT_SCRIPT : undefined}
            onLoadStart={() => {
              setPageLoading(true);
              setLoadProgress(0);
            }}
            onLoadProgress={(event) => setLoadProgress(event.nativeEvent.progress)}
            onLoadEnd={() => setPageLoading(false)}
            // Every `target=_blank` link has to reach the handler above instead of
            // asking for a window this screen has nowhere to put.
            setSupportMultipleWindows={false}
            allowsLinkPreview={false}
            webviewDebuggingEnabled={__DEV__}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
          />
        ) : null}
        {/*
          A forward that never opened has no failed page load behind it, so
          RNCWebView never enters its error state; that surface is drawn here.
        */}
        {failure !== null && failure.origin === 'forward' ? <PreviewFailure failure={failure} onRetry={retry} /> : null}
        {source === null && failure === null ? <ConnectingSurface address={address} /> : null}

        {/* Progress for work happening behind a page that is already on screen:
            opening the next port's forward, or loading the next page. */}
        {(connecting || pageLoading) && source !== null && failure === null ? (
          <LoadProgressBar progress={pageLoading ? loadProgress : 0} />
        ) : null}
      </View>
      {railMenu !== null ? (
        <ContextMenu
          visible
          title={WebPreviewCopy.previewTitle}
          items={railMenuItems(railMenuEntries, () => setRailMenu(null))}
          onClose={() => setRailMenu(null)}
          anchor={railMenuAnchor}
        />
      ) : null}
    </View>
  );
}

/**
 * CDXC:Browser 2026-09-26 WHY:
 * A dev server's first load through the SSH forward can take many seconds on a slow link (a Vite app
 * fetches hundreds of modules one round trip at a time; about 20s at a 300ms round trip) while its
 * page stays blank. The small spinner that used to sit at the bottom edge read as "nothing is
 * loading", and pressing Go looked like what started the page. A browser-style bar across the top of
 * the page, fed by the WebView's own progress, shows the load is alive.
 */
function LoadProgressBar({ progress }: { progress: number }) {
  const width = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // A sliver while the forward opens or the first bytes are on their way.
    Animated.timing(width, {
      toValue: Math.max(0.08, Math.min(1, progress)),
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [progress, width]);
  return (
    <View style={styles.progressTrack} pointerEvents="none" accessibilityRole="progressbar">
      <Animated.View
        style={[styles.progressFill, { width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
      />
    </View>
  );
}

function ConnectingSurface({ address }: { address: PreviewAddress }) {
  return (
    <View style={[styles.stateSurface, styles.failureOverlay]}>
      <ActivityIndicator size="small" color={GhostexPalette.ACCENT} />
      <Text style={styles.stateBody}>
        {address.kind === 'remote'
          ? WebPreviewCopy.connecting(address.remotePort)
          : WebPreviewCopy.loadingAddress(address.url)}
      </Text>
    </View>
  );
}

function PreviewFailure({ failure, onRetry }: { failure: WebPreviewFailure; onRetry: () => void }) {
  return (
    <View style={[styles.stateSurface, styles.failureOverlay]}>
      <Text style={styles.stateTitle}>{WebPreviewCopy.errorTitle}</Text>
      <Text style={styles.stateBody}>{failure.message}</Text>
      {failure.hint.length > 0 ? <Text style={styles.stateBody}>{failure.hint}</Text> : null}
      <View style={styles.stateActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.pillButton, pressed && styles.pillButtonPressed]}
        >
          <Text style={styles.pillButtonLabel}>{WebPreviewCopy.retryButton}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ToolbarButton({
  active,
  buttonRef,
  disabled,
  icon,
  label,
  onPress,
}: {
  /** The button's own view, for a menu that stands at it (the band's "…"). */
  buttonRef?: RefObject<ViewInstance | null>;
  /** A switch that is on: the button reads as pressed in and is announced as a checked switch. */
  active?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  const isDisabled = disabled === true;
  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole={active === undefined ? 'button' : 'switch'}
      accessibilityLabel={label}
      accessibilityState={active === undefined ? { disabled: isDisabled } : { disabled: isDisabled, checked: active }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolbarButton,
        (pressed || active === true) && !isDisabled && styles.toolbarButtonPressed,
        isDisabled && styles.toolbarButtonDisabled,
      ]}
    >
      {icon}
    </Pressable>
  );
}
