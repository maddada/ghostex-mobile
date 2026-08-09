/**
 * Session Chat surface: hosts the bundled shared chat page (the same React UI
 * as the desktop and web apps) in a webview and services its bridge requests
 * over the machine's SSH channel (src/chat/session-chat-bridge.ts). Scoped to
 * one (machine, projectId, sessionId); the Terminal screen mounts it in place
 * of the native terminal view while a tab is in chat mode.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Linking, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { MachineConnectionTarget } from '../machines/credentials';
import {
  parseSessionChatBridgeRequest,
  runSessionChatBridgeRequest,
  type SessionChatBridgeResponse,
} from './session-chat-bridge';
import { SESSION_CHAT_HTML } from './session-chat-html.generated';

const CHAT_BACKGROUNDS = { dark: '#0e0e0e', light: '#fdfdfd' } as const;
const CHAT_SOURCE = { html: SESSION_CHAT_HTML } as const;

/** JSON that is safe to embed inside injected JavaScript source. */
function injectableJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export type SessionChatWebViewProps = {
  machine: MachineConnectionTarget;
  projectId: string;
  sessionId: string;
  /** Agent icon id ("claude", "codex", …) for the page's empty state. */
  agentId: string;
  /**
   * Live agent-is-working signal from the machine inventory. The page cannot
   * see it (its own view of the turn is whatever the last read returned), so
   * the host pushes it in like the desktop and web hosts do.
   */
  working: boolean;
  /** False while the session cannot take input (asleep / not live). */
  canSend: boolean;
  /** Keeps the page loading offscreen until chat mode is selected. */
  visible: boolean;
  /** Chat-only palette. The mobile app chrome remains independently themed. */
  theme?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
};

export default function SessionChatWebView({
  agentId,
  canSend,
  machine,
  projectId,
  sessionId,
  style,
  theme = 'dark',
  visible,
  working,
}: SessionChatWebViewProps) {
  const webviewRef = useRef<WebView>(null);

  const configScript = useMemo(
    () =>
      `window.__ghostexMobileChatConfig = ${injectableJson({ agentId, theme })}; true;`,
    [agentId, theme],
  );

  /*
   * The page installs `ghostexMobileChatSetHostState` while its inline bundle
   * script runs, i.e. strictly before load-end. Pushing both on change and
   * once at load-end therefore covers the two orderings (state settled before
   * the page was ready, and state changing afterwards) without either push
   * being dropped.
   */
  const hostStateRef = useRef({ canSend, working });
  hostStateRef.current = { canSend, working };
  const pushHostState = useCallback((): void => {
    webviewRef.current?.injectJavaScript(
      'window.ghostexMobileChatSetHostState && window.ghostexMobileChatSetHostState(' +
        `${injectableJson(hostStateRef.current)}); true;`,
    );
  }, []);

  useEffect(() => {
    pushHostState();
  }, [canSend, working, pushHostState]);

  const deliver = useCallback((response: SessionChatBridgeResponse): void => {
    webviewRef.current?.injectJavaScript(
      `window.ghostexMobileChatDeliver && window.ghostexMobileChatDeliver(${injectableJson(response)}); true;`,
    );
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent): void => {
      const request = parseSessionChatBridgeRequest(event.nativeEvent.data);
      if (request === null) return;
      void runSessionChatBridgeRequest(machine, projectId, sessionId, request).then(deliver);
    },
    [machine, projectId, sessionId, deliver],
  );

  return (
    <WebView
      ref={webviewRef}
      source={CHAT_SOURCE}
      originWhitelist={['about:blank']}
      style={[styles.webview, { backgroundColor: CHAT_BACKGROUNDS[theme] }]}
      containerStyle={[
        styles.container,
        { backgroundColor: CHAT_BACKGROUNDS[theme] },
        style,
        !visible && styles.preloading,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
      injectedJavaScriptBeforeContentLoaded={configScript}
      onLoadEnd={pushHostState}
      onMessage={handleMessage}
      // Markdown links in the transcript open in the system browser instead
      // of navigating the chat surface away.
      onShouldStartLoadWithRequest={(request) => {
        if (request.url.startsWith('http://') || request.url.startsWith('https://')) {
          void Linking.openURL(request.url).catch(() => undefined);
          return false;
        }
        return true;
      }}
      allowsLinkPreview={false}
      bounces={false}
      setSupportMultipleWindows={false}
      hideKeyboardAccessoryView
      webviewDebuggingEnabled={__DEV__}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: CHAT_BACKGROUNDS.dark,
  },
  webview: {
    backgroundColor: CHAT_BACKGROUNDS.dark,
    flex: 1,
  },
  preloading: {
    height: 1,
    left: -2,
    opacity: 0,
    position: 'absolute',
    top: -2,
    width: 1,
  },
});
