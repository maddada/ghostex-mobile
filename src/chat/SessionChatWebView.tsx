/**
 * Session Chat surface: hosts the bundled shared chat page (the same React UI
 * as the desktop and web apps) in a webview and services its bridge requests
 * over the machine's SSH channel (src/chat/session-chat-bridge.ts). Scoped to
 * one (machine, projectId, sessionId); the Terminal screen mounts it in place
 * of the native terminal view while a tab is in chat mode.
 */

import { useCallback, useMemo, useRef } from 'react';
import { Linking, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { MachineConnectionTarget } from '../machines/credentials';
import {
  parseSessionChatBridgeRequest,
  runSessionChatBridgeRequest,
  type SessionChatBridgeResponse,
} from './session-chat-bridge';
import { SESSION_CHAT_HTML } from './session-chat-html.generated';

const CHAT_BACKGROUND = '#0e0e0e';

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
  style?: StyleProp<ViewStyle>;
};

export default function SessionChatWebView({
  agentId,
  machine,
  projectId,
  sessionId,
  style,
}: SessionChatWebViewProps) {
  const webviewRef = useRef<WebView>(null);

  const configScript = useMemo(
    () =>
      `window.__ghostexMobileChatConfig = ${injectableJson({ agentId })}; true;`,
    [agentId],
  );

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
      source={{ html: SESSION_CHAT_HTML }}
      originWhitelist={['about:blank']}
      style={[styles.webview, style]}
      containerStyle={styles.container}
      injectedJavaScriptBeforeContentLoaded={configScript}
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
    backgroundColor: CHAT_BACKGROUND,
  },
  webview: {
    backgroundColor: CHAT_BACKGROUND,
    flex: 1,
  },
});
