/**
 * The chat core's hidden WebView, mounted once at the app's root. It loads the page that carries
 * the Rust chat core as WebAssembly and hands everything the page posts to {@link wasmCoreBridge}. Nothing in it is ever drawn: it is a 1×1
 * view behind the app.
 */

import { Asset } from 'expo-asset';
import { Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { findNodeHandle, StyleSheet, View, type HostInstance } from 'react-native';
import { WebView } from 'react-native-webview';

import { logAppEvent } from '../../../app/appLog';
import { wasmCoreBridge } from './bridge';
import { describeLoadError, pageFromUpdate, pageUriProblem, uriBasename, type PagePathKind } from './pageLoad';

// Built by `cargo xtask build-mobile-chat-wasm` in the main repo (gitignored); Metro bundles it as
// an asset, so it ships in every over-the-air update.
const CHAT_CORE_PAGE = require('../../../../assets/chat-core/chat-core.html') as number;

/**
 * The page's file: expo-asset's copy, or, when expo-asset found none in the running update, the
 * update's own HTML asset (pageLoad.ts pageFromUpdate). Returns '' when neither exists.
 *
 * CDXC:SessionChat 2026-11-02 WHY: issue #393. When expo-asset finds no local copy it leaves the
 * URI empty, and `downloadAsync()` on iOS turns '' into `file:///`, a folder WKWebView can never
 * load. So the empty case is caught before `downloadAsync()` runs.
 */
async function resolvePageUri(): Promise<{ uri: string; from: string }> {
  const asset = Asset.fromModule(CHAT_CORE_PAGE);
  if (asset.localUri == null && asset.uri === '') {
    return { uri: pageFromUpdate(Updates.manifest, Updates.localAssets) ?? '', from: 'the update manifest' };
  }
  const downloaded = await asset.downloadAsync();
  return { uri: downloaded.localUri ?? downloaded.uri, from: 'expo-asset' };
}

/** One stat of a local page path; null for remote URIs or when the app may not read the folder. */
function pagePathKind(uri: string): PagePathKind {
  if (!uri.startsWith('file:')) return null;
  try {
    const info = Paths.info(uri);
    if (!info.exists) return null;
    return info.isDirectory ? 'directory' : 'file';
  } catch {
    return null;
  }
}

/** Mounted as soon as the app shows, so the page starts while SSH connects; a chat waits for it (`wasmCoreBridge.ready`). */
export function ChatCoreWebViewHost() {
  const reloadKey = useSyncExternalStore(wasmCoreBridge.subscribeView, wasmCoreBridge.reloadKey);
  const [uri, setUri] = useState<string | null>(null);
  const hostRef = useRef<HostInstance>(null);

  useEffect(() => {
    let cancelled = false;
    resolvePageUri()
      .then(({ uri: resolved, from }) => {
        if (cancelled) return;
        const kind = pagePathKind(resolved);
        logAppEvent(
          `Chat engine: page ${uriBasename(resolved) || '(none)'} from ${from}${kind ? `, a ${kind === 'directory' ? 'folder' : 'file'}` : ''}.`,
        );
        const problem = pageUriProblem(resolved, kind);
        if (problem !== null) {
          console.warn(`[chat-core] ${problem}`);
          wasmCoreBridge.fail(problem);
          return;
        }
        setUri(resolved);
      })
      .catch((error: unknown) => {
        wasmCoreBridge.fail(`The chat core page is missing from this build (${String(error)}).`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    wasmCoreBridge.mounted();
    return () => wasmCoreBridge.unmounted();
  }, []);

  // A reload (a crash, or a grown page) starts the page over.
  useEffect(() => {
    if (reloadKey > 0) wasmCoreBridge.mounted();
  }, [reloadKey]);

  if (uri === null) return null;
  return (
    // Keyed with the page, so a reload gives the wrapper a fresh tag too; never flattened, as the
    // bridge posts to the page through the wrapper's tag (bridge.ts `attach`).
    <View
      key={reloadKey}
      ref={hostRef}
      collapsable={false}
      style={styles.host}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        source={{ uri }}
        originWhitelist={['*']}
        allowFileAccess
        allowingReadAccessToURL={uri.slice(0, uri.lastIndexOf('/') + 1)}
        javaScriptEnabled
        onLoadEnd={(event) => {
          const target = (event.nativeEvent as unknown as { target?: unknown }).target;
          if (typeof target === 'number') wasmCoreBridge.attach(target, findNodeHandle(hostRef.current) ?? null);
        }}
        onMessage={(event) => wasmCoreBridge.receive(event.nativeEvent.data)}
        onRenderProcessGone={() => wasmCoreBridge.died('The chat core page stopped.')}
        onContentProcessDidTerminate={() => wasmCoreBridge.died('The chat core page stopped.')}
        // Keeps WebKit's own reason (code, domain, the file it tried and whether that is a folder):
        // issue #393's -1101 reached no log while it was dropped here.
        onError={(event) => wasmCoreBridge.died(describeLoadError(event.nativeEvent, uri, pagePathKind(uri)))}
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 1×1 and nearly transparent: a WebView that is not laid out or fully transparent can stop running
  // its scripts on some Android versions.
  host: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0.01 },
  webView: { width: 1, height: 1, backgroundColor: 'transparent' },
});
