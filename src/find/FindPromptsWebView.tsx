/**
 * Find surface — the GUI for `gx f`. Hosts the bundled shared Find page (the
 * same React UI as the desktop and web apps) in a webview and services its
 * bridge requests over the machine's SSH channel (src/find/find-prompts-bridge.ts).
 *
 * Scoped to one machine, because prompt history lives on the machine that ran
 * the agent. Requests that change what the app is showing come back as host
 * actions for the screen to perform.
 */

import { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { MachineConnectionTarget } from '../machines/credentials';
import {
  parseFindPromptsBridgeRequest,
  runFindPromptsBridgeRequest,
  type FindPromptsBridgeResponse,
  type FindPromptsHostAction,
} from './find-prompts-bridge';
import { FIND_PROMPTS_HTML } from './find-prompts-html.generated';

const FIND_BACKGROUNDS = { dark: '#0e0e0e', light: '#fdfdfd' } as const;
const FIND_SOURCE = { html: FIND_PROMPTS_HTML } as const;

/** JSON that is safe to embed inside injected JavaScript source. */
function injectableJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export type FindPromptsWebViewProps = {
  machine: MachineConnectionTarget;
  /**
   * Performs the requests that change the app itself: focusing a session that
   * already owns the conversation, opening a new one for the resolved command,
   * or leaving Find.
   */
  onHostAction: (action: FindPromptsHostAction) => void;
  style?: StyleProp<ViewStyle>;
  theme?: 'dark' | 'light';
  /** Keeps the page loading offscreen until Find is selected. */
  visible: boolean;
};

export default function FindPromptsWebView({
  machine,
  onHostAction,
  style,
  theme = 'dark',
  visible,
}: FindPromptsWebViewProps) {
  const webviewRef = useRef<WebView>(null);

  const configScript = useMemo(
    () => `window.__ghostexMobileFindConfig = ${injectableJson({ theme })}; true;`,
    [theme],
  );

  const deliver = useCallback((response: FindPromptsBridgeResponse): void => {
    webviewRef.current?.injectJavaScript(
      `window.ghostexMobileFindDeliver && window.ghostexMobileFindDeliver(${injectableJson(
        response,
      )}); true;`,
    );
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent): void => {
      const request = parseFindPromptsBridgeRequest(event.nativeEvent.data);
      if (request === null) return;
      void runFindPromptsBridgeRequest(machine, request).then(({ hostAction, response }) => {
        deliver(response);
        if (hostAction) onHostAction(hostAction);
      });
    },
    [deliver, machine, onHostAction],
  );

  return (
    <WebView
      ref={webviewRef}
      source={FIND_SOURCE}
      originWhitelist={['about:blank']}
      style={[styles.webview, { backgroundColor: FIND_BACKGROUNDS[theme] }]}
      containerStyle={[
        styles.container,
        { backgroundColor: FIND_BACKGROUNDS[theme] },
        style,
        !visible && styles.preloading,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
      injectedJavaScriptBeforeContentLoaded={configScript}
      onMessage={handleMessage}
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
    backgroundColor: FIND_BACKGROUNDS.dark,
    flex: 1,
  },
  // Matches the chat surface: a 1x1 offscreen box keeps the page mounted and
  // warm without a zero-size webview, which some hosts refuse to lay out.
  preloading: {
    height: 1,
    left: -2,
    opacity: 0,
    position: 'absolute',
    top: -2,
    width: 1,
  },
  webview: {
    backgroundColor: FIND_BACKGROUNDS.dark,
    flex: 1,
  },
});
