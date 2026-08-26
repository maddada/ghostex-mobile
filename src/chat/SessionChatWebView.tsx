/**
 * Session Chat surface: hosts the bundled shared chat page (the same React UI
 * as the desktop and web apps) in a webview and services its bridge requests
 * over the machine's SSH channel (src/chat/session-chat-bridge.ts). Scoped to
 * one (machine, projectId, sessionId); the Terminal screen mounts it in place
 * of the native terminal view while a tab is in chat mode.
 */

import { Paths } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert, Linking, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { useInventoryStore } from '../inventory/store';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import { useTerminalStore } from '../terminal/sessions';
import {
  handoffSessionChatDraft,
  parseSessionChatBridgeNotice,
  parseSessionChatBridgeRequest,
  releaseSessionChatDraftHandoffStash,
  runSessionChatBridgeRequest,
  type SessionChatBridgeResponse,
} from './session-chat-bridge';

const CHAT_BACKGROUNDS = { dark: '#0e0e0e', light: '#fdfdfd' } as const;

/*
 * The chat page ships as a real directory in the app bundle, not as an HTML
 * string, so it has a base URL and can pull in its Shiki syntax-highlighting
 * grammars on demand. `session-chat` is written by `bun run build:mobile-chat`
 * in the Ghostex main repo and reaches the bundle through
 * modules/ghostex-native (a gradle assets.srcDir on Android, the podspec's
 * resources on iOS).
 */
const CHAT_ASSET_DIR = 'session-chat';

let cachedChatBaseUri: string | null = null;

/** Resolved once, on first mount rather than at import time. */
function chatBundleBaseUri(): string {
  if (cachedChatBaseUri !== null) {
    return cachedChatBaseUri;
  }
  cachedChatBaseUri = resolveChatBundleBaseUri();
  return cachedChatBaseUri;
}

function resolveChatBundleBaseUri(): string {
  if (Platform.OS === 'android') {
    // Library assets are merged into the APK assets root, which the WebView
    // always reaches under this URL. (Paths.bundle is `asset://` on Android —
    // expo-file-system's own scheme for reading the APK, not a loadable URL.)
    return `file:///android_asset/${CHAT_ASSET_DIR}/`;
  }
  // iOS: Paths.bundle wraps `Bundle.main.bundlePath`. It comes back as a file
  // URL, but normalise the two shape details we depend on rather than assume
  // them, since this string is concatenated into a URL.
  const bundle = Paths.bundle.uri;
  const withScheme = bundle.startsWith('file://') ? bundle : `file://${bundle}`;
  const withSlash = withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
  return `${withSlash}${CHAT_ASSET_DIR}/`;
}


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
  /** Warm native terminal entry that owns raw Codex effort keystrokes. */
  terminalSessionKey: string;
  /** Switches the retained tab from chat back to its terminal model picker. */
  onSwitchToTerminalForAgentPicker: () => void;
  /** Agent icon id ("claude", "codex", …) for the page's empty state. */
  agentId: string;
  /**
   * Live agent-is-working signal from the machine inventory. The page cannot
   * see it (its own view of the turn is whatever the last read returned), so
   * the host pushes it in like the desktop and web hosts do.
   */
  working: boolean;
  /** Keeps the page loading offscreen until chat mode is selected. */
  visible: boolean;
  /**
   * Bumped by the host every time the user enters chat mode for this session.
   * Each new value runs one terminal → chat draft transfer: whatever was typed
   * into the agent CLI is moved out of the terminal and dropped into the chat
   * composer, so switching views never leaves text behind. Starts at 0, which
   * runs nothing (a preloaded page the user has not switched to yet).
   */
  draftTransferRequestId?: number;
  /**
   * Bumped by the host every time the user leaves chat mode for this session,
   * running the same transfer the other way: whatever is in the chat composer
   * is parked in Saved Prompts, typed into the agent CLI, and then unparked.
   * Starts at 0, which runs nothing.
   */
  handoffToTerminalRequestId?: number;
  /**
   * Bumped by the host every time the user picks Search Conversation from the
   * terminal header menu. The chat page carries no search button of its own on
   * this surface, so each new value opens its search box. Starts at 0, which
   * opens nothing.
   */
  openSearchRequestId?: number;
  /** Bumped when native chrome asks the shared page to reveal Session Note. */
  openSessionNoteRequestId?: number;
  /** Bumped when native chrome asks the shared page to reveal Saved Prompts. */
  openSavedPromptsRequestId?: number;
  /**
   * How many prompts are waiting in this session's Ghostex queue, reported by
   * the page every time one of its reads or mutations answers with the list.
   * The host uses it for the terminal view's "Queued: N" button, which is why
   * the page keeps running (and keeps long-polling) while terminal mode is
   * visible. Never called at all by a machine whose Ghostex predates the
   * queue, so the button stays hidden instead of claiming a queue of zero.
   */
  onQueueCountChange?: (count: number) => void;
  /** Chat-only palette. The mobile app chrome remains independently themed. */
  theme?: 'light' | 'dark';
  /** Installed CSS font-family name, or blank to use the bundled app font. */
  fontFamily?: string;
  /** Width of the message transcript only; the prompt composer stays unchanged. */
  transcriptWidthPercent?: number;
  /** Reveal thinking-owned tool calls without requiring a tap. */
  verboseMode?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function SessionChatWebView({
  agentId,
  fontFamily = '',
  machine,
  onQueueCountChange,
  onSwitchToTerminalForAgentPicker,
  projectId,
  sessionId,
  style,
  theme = 'dark',
  transcriptWidthPercent = 100,
  terminalSessionKey,
  verboseMode = false,
  visible,
  working,
  draftTransferRequestId = 0,
  handoffToTerminalRequestId = 0,
  openSearchRequestId = 0,
  openSessionNoteRequestId = 0,
  openSavedPromptsRequestId = 0,
}: SessionChatWebViewProps) {
  const webviewRef = useRef<WebView>(null);
  const baseUri = chatBundleBaseUri();
  const source = useMemo(() => ({ uri: `${baseUri}index.html` }), [baseUri]);

  const configScript = useMemo(
    () =>
      `window.__ghostexMobileChatConfig = ${injectableJson({
        agentId,
        fontFamily,
        projectId,
        sessionId,
        sessionKey: `${machine.id}:${projectId}:${sessionId}`,
        theme,
        transcriptWidthPercent,
        verboseMode,
      })}; true;`,
    [agentId, fontFamily, machine.id, projectId, sessionId, theme, transcriptWidthPercent, verboseMode],
  );

  /*
   * The page installs `ghostexMobileChatSetHostState` while its inline bundle
   * script runs, i.e. strictly before load-end. Pushing both on change and
   * once at load-end therefore covers the two orderings (state settled before
   * the page was ready, and state changing afterwards) without either push
   * being dropped.
   */
  const hostStateRef = useRef({ working });
  hostStateRef.current = { working };
  const pushHostState = useCallback((): void => {
    webviewRef.current?.injectJavaScript(
      'window.ghostexMobileChatSetHostState && window.ghostexMobileChatSetHostState(' +
        `${injectableJson(hostStateRef.current)}); true;`,
    );
  }, []);

  useEffect(() => {
    pushHostState();
  }, [working, pushHostState]);

  const presentationRef = useRef({ fontFamily, theme, transcriptWidthPercent, verboseMode });
  presentationRef.current = { fontFamily, theme, transcriptWidthPercent, verboseMode };
  const pushPresentation = useCallback((): void => {
    webviewRef.current?.injectJavaScript(
      'window.ghostexMobileChatSetPresentation && window.ghostexMobileChatSetPresentation(' +
        `${injectableJson(presentationRef.current)}); true;`,
    );
  }, []);

  useEffect(() => {
    pushPresentation();
  }, [fontFamily, pushPresentation, theme, transcriptWidthPercent, verboseMode]);

  const pushCurrentState = useCallback((): void => {
    pushHostState();
    pushPresentation();
  }, [pushHostState, pushPresentation]);

  /*
   * Terminal → chat draft transfer. The CLI's composer is only readable
   * through the daemon's Ctrl+G prompt-editor handshake, which takes seconds,
   * so this runs after the switch rather than blocking it, and stays silent on
   * failure: the user asked to see the chat, not to move text. `insertDraft`
   * is installed by the page's bundle script, i.e. before load-end, and a
   * transfer can only be requested once the user has already switched to a
   * mounted page, so there is no pre-mount ordering to cover here.
   */
  const handledDraftTransferRef = useRef(draftTransferRequestId);
  useEffect(() => {
    if (draftTransferRequestId === handledDraftTransferRef.current) return;
    handledDraftTransferRef.current = draftTransferRequestId;
    if (draftTransferRequestId <= 0 || sessionId.length === 0) return;
    let cancelled = false;
    void handoffSessionChatDraft(machine, projectId, sessionId).then((content) => {
      if (cancelled || content.length === 0) return;
      webviewRef.current?.injectJavaScript(
        'window.ghostexMobileChatInsertDraft && window.ghostexMobileChatInsertDraft(' +
          `${injectableJson(content)}); true;`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [draftTransferRequestId, machine, projectId, sessionId]);

  /*
   * Chat → terminal draft transfer. The page has to make the draft durable
   * before it can let go of it, so this only asks; the text comes back later as
   * the `draftHandoffToTerminal` notice handled in handleMessage below, and a
   * composer that held nothing answers with no notice at all.
   */
  const handledHandoffToTerminalRef = useRef(handoffToTerminalRequestId);
  useEffect(() => {
    if (handoffToTerminalRequestId === handledHandoffToTerminalRef.current) return;
    handledHandoffToTerminalRef.current = handoffToTerminalRequestId;
    if (handoffToTerminalRequestId <= 0) return;
    webviewRef.current?.injectJavaScript(
      'window.ghostexMobileChatHandoffToTerminal && window.ghostexMobileChatHandoffToTerminal(); true;',
    );
  }, [handoffToTerminalRequestId]);

  // `ghostexMobileChatOpenSearch` is installed by the page's bundle script,
  // before load-end, and the page holds a request that lands before its search
  // box mounts, so this needs no readiness handshake of its own.
  const handledSearchRequestRef = useRef(openSearchRequestId);
  useEffect(() => {
    if (openSearchRequestId === handledSearchRequestRef.current) return;
    handledSearchRequestRef.current = openSearchRequestId;
    if (openSearchRequestId <= 0) return;
    webviewRef.current?.injectJavaScript(
      'window.ghostexMobileChatOpenSearch && window.ghostexMobileChatOpenSearch(); true;',
    );
  }, [openSearchRequestId]);

  const handledSessionNoteRequestRef = useRef(openSessionNoteRequestId);
  useEffect(() => {
    if (openSessionNoteRequestId === handledSessionNoteRequestRef.current) return;
    handledSessionNoteRequestRef.current = openSessionNoteRequestId;
    if (openSessionNoteRequestId <= 0) return;
    webviewRef.current?.injectJavaScript(
      'window.ghostexMobileChatOpenSessionNote && window.ghostexMobileChatOpenSessionNote(); true;',
    );
  }, [openSessionNoteRequestId]);

  const handledSavedPromptsRequestRef = useRef(openSavedPromptsRequestId);
  useEffect(() => {
    if (openSavedPromptsRequestId === handledSavedPromptsRequestRef.current) return;
    handledSavedPromptsRequestRef.current = openSavedPromptsRequestId;
    if (openSavedPromptsRequestId <= 0) return;
    webviewRef.current?.injectJavaScript(
      'window.ghostexMobileChatOpenSavedPrompts && window.ghostexMobileChatOpenSavedPrompts(); true;',
    );
  }, [openSavedPromptsRequestId]);

  const deliver = useCallback((response: SessionChatBridgeResponse): void => {
    webviewRef.current?.injectJavaScript(
      `window.ghostexMobileChatDeliver && window.ghostexMobileChatDeliver(${injectableJson(response)}); true;`,
    );
  }, []);

  const focusSavedPromptSession = useCallback(
    async (params: Record<string, unknown>): Promise<void> => {
      const machineRecord = useMachinesStore.getState().machines.find(
        (entry) => entry.id === machine.id,
      );
      if (machineRecord !== undefined) {
        await useInventoryStore.getState().refreshMachine(machineRecord);
      }
      const agentSessionId =
        typeof params.agentSessionId === 'string' ? params.agentSessionId.trim() : '';
      const targetProjectId =
        typeof params.projectId === 'string' ? params.projectId.trim() : '';
      const targetSessionId =
        typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
      const sessions =
        useInventoryStore.getState().inventoriesByMachineId[machine.id]?.summary?.sessions ?? [];
      const target = sessions.find(
        (candidate) =>
          (agentSessionId.length > 0 && candidate.agentSessionId === agentSessionId) ||
          (targetSessionId.length > 0 &&
            candidate.sessionId === targetSessionId &&
            (targetProjectId.length === 0 || candidate.projectId === targetProjectId)),
      );
      if (target === undefined) {
        throw new Error('That saved prompt’s session is no longer available on this machine.');
      }
      const sessionKey = await useTerminalStore.getState().attachSession(machine, {
        projectId: target.projectId || undefined,
        sessionId: target.sessionId,
        title: target.displayTitle,
      });
      useTerminalStore.getState().selectTab(sessionKey);
    },
    [machine],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent): void => {
      // Id-less notices first: they carry no request to answer.
      const notice = parseSessionChatBridgeNotice(event.nativeEvent.data);
      if (notice !== null) {
        if (notice.notice === 'queueCount') {
          onQueueCountChange?.(notice.count);
          return;
        }
        // The handed-off draft. No trailing newline: it lands in the agent
        // CLI's input for the user to review and submit, like the Prompt
        // Editor's insert. Its Saved Prompts row is dropped only once the
        // terminal has taken the text, so a refused send stays recoverable.
        const { content, promptId } = notice;
        void GhostexNative.sendText(terminalSessionKey, content)
          .then(() => {
            if (promptId !== undefined) void releaseSessionChatDraftHandoffStash(machine, promptId);
          })
          .catch(() => undefined);
        return;
      }
      const request = parseSessionChatBridgeRequest(event.nativeEvent.data);
      if (request === null) return;
      if (request.op === 'switchToTerminalForAgentPicker') {
        onSwitchToTerminalForAgentPicker();
        deliver({ id: request.id, ok: true, result: { switched: true } });
        return;
      }
      if (request.op === 'sendKey') {
        const key = request.params?.key;
        const terminalKey =
          key === 'shift-up'
            ? 'up'
            : key === 'shift-down'
              ? 'down'
              : key === 'shift-tab'
                ? 'tab'
                : null;
        if (terminalKey === null) {
          deliver({ id: request.id, ok: false, error: 'Unknown chat terminal key.' });
          return;
        }
        void GhostexNative.sendKey(terminalSessionKey, terminalKey, { shift: true })
          .then(() => deliver({ id: request.id, ok: true, result: { sent: true } }))
          .catch((error: unknown) =>
            deliver({
              id: request.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return;
      }
      if (request.op === 'jumpToSavedPromptSession') {
        void focusSavedPromptSession(request.params ?? {})
          .then(() => deliver({ id: request.id, ok: true, result: { focused: true } }))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            Alert.alert('Saved Prompt Session', message, [{ text: 'OK' }]);
            deliver({ id: request.id, ok: false, error: message });
          });
        return;
      }
      void runSessionChatBridgeRequest(machine, projectId, sessionId, request).then(deliver);
    },
    [
      deliver,
      focusSavedPromptSession,
      machine,
      onQueueCountChange,
      onSwitchToTerminalForAgentPicker,
      projectId,
      sessionId,
      terminalSessionKey,
    ],
  );

  return (
    <WebView
      ref={webviewRef}
      source={source}
      // Only the page's own origin, exactly as when it loaded as an HTML
      // string under about:blank. Everything else stays with
      // onShouldStartLoadWithRequest below.
      originWhitelist={['file://*']}
      // iOS needs the read scope widened from the single index.html file to
      // its directory, or the page cannot load ./shiki/*.js beside it.
      allowingReadAccessToURL={baseUri}
      style={[styles.webview, { backgroundColor: CHAT_BACKGROUNDS[theme] }]}
      containerStyle={[
        styles.container,
        { backgroundColor: CHAT_BACKGROUNDS[theme] },
        style,
        !visible && styles.preloading,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
      injectedJavaScriptBeforeContentLoaded={configScript}
      onLoadEnd={pushCurrentState}
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
