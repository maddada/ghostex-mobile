/**
 * Web preview: browse a web app running on the computer.
 *
 * The page is fetched from `http://127.0.0.1:<localPort>` on the phone, which is
 * one end of an SSH local port forward whose other end is `localhost:<remotePort>`
 * on the computer. The user is never shown the phone-side port: the address bar
 * and every message here say `localhost:<remotePort>`, which is what the same
 * page is at on the computer.
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Alert, BackHandler, Linking, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewErrorEvent } from 'react-native-webview/lib/WebViewTypes';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { ArrowIcon, CloseIcon, ExternalLinkIcon, RefreshIcon } from '../components/terminal/icons';
import { WebPreviewCopy } from '../copy';
import { hasPassword } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette } from '../theme/palette';
import { describeForwardFailure, startWebPreviewForward, type WebPreviewFailure } from '../webPreview/forwards';
import { useWebPreviewStore } from '../webPreview/store';
import { LOOPBACK_HOST, isLoopbackHost, localPreviewUrl, parseHttpUrl, remoteDisplayAddress } from '../webPreview/urls';
import { styles } from './web-preview/styles';

type Props = NativeStackScreenProps<RootStackParamList, 'WebPreview'>;

/**
 * iOS also reports whether the navigation has a target frame. A `target=_blank`
 * link has none, which makes `isTopFrame` false even though the navigation is
 * not a sub-frame at all; the flag is missing on Android.
 */
type PreviewLoadRequest = ShouldStartLoadRequest & { hasTargetFrame?: boolean };

/** One place on the computer, as the preview means to open it. */
type RemoteTarget = { scheme: 'http' | 'https'; remotePort: number; path: string };

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
  return address.kind === 'remote' ? remoteDisplayAddress(address.remotePort, address.path) : address.url;
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

export default function WebPreviewScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);
  const machine = useMachinesStore((state) =>
    state.machines.find((candidate) => candidate.id === route.params.machineId)
  );
  const setLastPort = useWebPreviewStore((state) => state.setLastPort);

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
  /** Mirror of `remoteToLocal` for the in-page rewrite, which needs a render. */
  const [forwardedPairs, setForwardedPairs] = useState<ReadonlyArray<readonly [number, number]>>([]);

  /** Where Retry goes: the port that was last asked for, failed or not. */
  const intendedRef = useRef<RemoteTarget>({
    scheme: route.params.scheme ?? 'http',
    remotePort: route.params.remotePort,
    path: route.params.path ?? '/',
  });
  /** Guards every state write against an older navigation finishing last. */
  const seqRef = useRef(0);

  const [address, setAddress] = useState<PreviewAddress>({ kind: 'remote', ...intendedRef.current });
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const [failure, setFailure] = useState<PreviewFailureState | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
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
    return () => {
      for (const remotePort of forwarded.keys()) {
        void GhostexNative.stopPortForward(machineId, remotePort).catch(() => undefined);
      }
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
      if (mountedRef.current) setForwardedPairs([]);
    });
    return () => subscription.remove();
  }, [machineId]);

  /**
   * Put `uri` on screen. An identical `source.uri` is dropped by React and by
   * RNCWebView, so the same page is reloaded through the ref (which keeps
   * history) and only a source prop that has gone stale forces a remount.
   */
  const loadUri = useCallback((uri: string): void => {
    if (currentUrlRef.current === uri) {
      webviewRef.current?.reload();
      return;
    }
    setSource((previous) => {
      if (previous === null) return { uri, nonce: 0 };
      return previous.uri === uri ? { uri, nonce: previous.nonce + 1 } : { uri, nonce: previous.nonce };
    });
  }, []);

  /** Forward `remotePort`, then load it. Native is idempotent per (machine, port). */
  const openRemotePort = useCallback(
    async (scheme: 'http' | 'https', remotePort: number, path: string): Promise<void> => {
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      const isCurrent = (): boolean => mountedRef.current && seqRef.current === seq;
      intendedRef.current = { scheme, remotePort, path };

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
      setAddress({ kind: 'remote', scheme, remotePort, path });
      setConnecting(true);
      setFailure(null);
      try {
        const localPort = await startWebPreviewForward(target, remotePort);
        /*
         * Recorded before the liveness checks below: the forward exists now, and
         * a screen that has gone away still has to release it.
         */
        remoteToLocalRef.current.set(remotePort, localPort);
        localToRemoteRef.current.set(localPort, remotePort);
        if (!mountedRef.current) {
          remoteToLocalRef.current.delete(remotePort);
          localToRemoteRef.current.delete(localPort);
          void GhostexNative.stopPortForward(target.id, remotePort).catch(() => undefined);
          return;
        }
        setForwardedPairs([...remoteToLocalRef.current.entries()]);
        if (seqRef.current !== seq) return;
        loadUri(localPreviewUrl(scheme, localPort, path));
        setLastPort(target.id, remotePort);
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
    [loadUri, setLastPort]
  );

  /*
   * Retry re-establishes only the port that failed. The forward it is replacing
   * may still be half-alive on the native side, so it is stopped and forgotten
   * before the new one is asked for; forwards for other ports this preview
   * opened are healthy and stay up.
   */
  const retry = useCallback((): void => {
    void (async () => {
      const target = intendedRef.current;
      const stale = remoteToLocalRef.current.get(target.remotePort);
      if (stale !== undefined) {
        remoteToLocalRef.current.delete(target.remotePort);
        localToRemoteRef.current.delete(stale);
        if (mountedRef.current) setForwardedPairs([...remoteToLocalRef.current.entries()]);
        await GhostexNative.stopPortForward(machineId, target.remotePort).catch(() => undefined);
      }
      await openRemotePort(target.scheme, target.remotePort, target.path);
    })();
  }, [machineId, openRemotePort]);

  // Opening the screen, and re-opening it with new params from a followed link.
  useEffect(() => {
    void openRemotePort(route.params.scheme ?? 'http', route.params.remotePort, route.params.path ?? '/');
  }, [openRemotePort, route.params.path, route.params.remotePort, route.params.scheme]);

  const handleShouldStartLoad = useCallback(
    (request: PreviewLoadRequest): boolean => {
      const parsed = parseHttpUrl(request.url);
      // about:blank, data:, blob: and app schemes are the WebView's business.
      if (parsed === null) return true;
      // An ordinary web link: it is not on the computer, so it loads in place.
      if (!isLoopbackHost(parsed.host)) return true;
      /*
       * Only page navigations are rewritten. A sub-frame cannot be moved to a
       * different port without replacing the whole page, and it belongs to the
       * same class as fetch/XHR: a resource the preview cannot re-point.
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
      if (request.isTopFrame === false && request.hasTargetFrame !== false) return true;
      /*
       * Our own rewritten URLs come back through here on every navigation the
       * page makes. They are the only loopback URLs whose host is 127.0.0.1 and
       * whose port this screen forwarded, so that pair identifies them.
       */
      if (parsed.host === LOOPBACK_HOST && localToRemoteRef.current.has(parsed.port)) {
        return true;
      }
      /*
       * Always through the native call, never through the table: a reconnect
       * this screen has not heard about yet leaves the table naming a listener
       * that is gone, and `startPortForward` is idempotent while the connection
       * lives and reports `E_NOT_CONNECTED` when it does not.
       */
      void openRemotePort(parsed.scheme, parsed.port, parsed.pathAndQuery);
      return false;
    },
    [openRemotePort]
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
      intendedRef.current = { scheme: parsed.scheme, remotePort, path: parsed.pathAndQuery };
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

  /*
   * Loopback listeners are reachable by every app on the phone, so handing the
   * phone-side URL to the system browser opens the same page there.
   */
  const openInBrowser = useCallback((): void => {
    if (currentUrl === null) return;
    void Linking.openURL(currentUrl).catch(() => {
      Alert.alert(WebPreviewCopy.previewTitle, WebPreviewCopy.openInBrowserFailed);
    });
  }, [currentUrl]);

  // Android's back gesture walks the page's history before leaving the preview.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!canGoBack) return false;
        webviewRef.current?.goBack();
        return true;
      });
      return () => subscription.remove();
    }, [canGoBack])
  );

  const linkRewriteScript = useMemo(() => buildLinkRewriteScript(forwardedPairs), [forwardedPairs]);
  const connectingPort = address.kind === 'remote' ? address.remotePort : route.params.remotePort;

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
        <ConnectingSurface remotePort={connectingPort} />
      ),
    [connectingPort, failure, retry]
  );

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <View style={[styles.toolbar, { paddingTop: insets.top + 6 }]}>
        <View style={styles.toolbarButtons}>
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
              icon={<ArrowIcon direction='left' size={18} color={GhostexPalette.FOREGROUND} />}
            />
            <ToolbarButton
              label={WebPreviewCopy.forwardLabel}
              disabled={!canGoForward}
              onPress={goForward}
              icon={<ArrowIcon direction='right' size={18} color={GhostexPalette.FOREGROUND} />}
            />
            <ToolbarButton
              label={WebPreviewCopy.reloadLabel}
              disabled={source === null || failure !== null}
              onPress={reload}
              icon={<RefreshIcon size={18} color={GhostexPalette.FOREGROUND} />}
            />
          </View>
          <ToolbarButton
            label={WebPreviewCopy.openInBrowserLabel}
            disabled={currentUrl === null}
            onPress={openInBrowser}
            icon={<ExternalLinkIcon size={18} color={GhostexPalette.FOREGROUND} />}
          />
        </View>
        <View style={styles.addressBar}>
          <Text numberOfLines={1} ellipsizeMode='middle' style={styles.addressText}>
            {addressText(address)}
          </Text>
        </View>
      </View>

      <View style={styles.contentArea}>
        {source !== null ? (
          <WebView
            ref={webviewRef}
            key={source.nonce}
            source={{ uri: source.uri }}
            originWhitelist={['http://*', 'https://*']}
            style={styles.webview}
            onNavigationStateChange={handleNavigationStateChange}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onError={handleLoadError}
            renderError={renderLoadFailure}
            injectedJavaScript={linkRewriteScript}
            onLoadStart={() => setPageLoading(true)}
            onLoadEnd={() => setPageLoading(false)}
            // Every `target=_blank` link has to reach the handler above instead of
            // asking for a window this screen has nowhere to put.
            setSupportMultipleWindows={false}
            allowsLinkPreview={false}
            webviewDebuggingEnabled={__DEV__}
            contentInsetAdjustmentBehavior='never'
            automaticallyAdjustContentInsets={false}
          />
        ) : null}
        {/*
          A forward that never opened has no failed page load behind it, so
          RNCWebView never enters its error state; that surface is drawn here.
        */}
        {failure !== null && failure.origin === 'forward' ? (
          <PreviewFailure failure={failure} onRetry={retry} />
        ) : null}
        {source === null && failure === null ? <ConnectingSurface remotePort={connectingPort} /> : null}

        {/* Progress for work happening behind a page that is already on screen:
            opening the next port's forward, or loading the next page. */}
        {(connecting || pageLoading) && source !== null && failure === null ? (
          <View style={styles.loadingStrip} pointerEvents='none'>
            <ActivityIndicator size='small' color={GhostexPalette.ACCENT} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ConnectingSurface({ remotePort }: { remotePort: number }) {
  return (
    <View style={[styles.stateSurface, styles.failureOverlay]}>
      <ActivityIndicator size='small' color={GhostexPalette.ACCENT} />
      <Text style={styles.stateBody}>{WebPreviewCopy.connecting(remotePort)}</Text>
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
        <Pressable accessibilityRole='button' onPress={onRetry} style={styles.pillButton}>
          <Text style={styles.pillButtonLabel}>{WebPreviewCopy.retryButton}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ToolbarButton({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  const isDisabled = disabled === true;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolbarButton,
        pressed && !isDisabled && styles.toolbarButtonPressed,
        isDisabled && styles.toolbarButtonDisabled,
      ]}
    >
      {icon}
    </Pressable>
  );
}
