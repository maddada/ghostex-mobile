/**
 * Docs viewer: one file from the computer, read over SSH and shown in a WebView: Markdown or HTML,
 * and (for file links from chat and terminals) plain text, source code and pictures.
 *
 * Markdown is rendered into a dark reading page; HTML runs as authored, with Agentation injected so
 * the page can be annotated (the header button turns it off and on). Both load from the phone's
 * mirror of the computer's folders (`src/docs/page.ts`), so relative images, styles and links work;
 * files a page builds the paths of while it runs are copied when they fail to load
 * (`src/docs/assetLoader.ts`).
 * A link to another Markdown or HTML file opens it in a new viewer, web links go through the
 * machine-aware opener (localhost links open in the Web Preview), and Reload reads the file again,
 * which is how an agent's latest edit shows up. What a page names on the computer by an absolute
 * path or a loopback address (an image at `/Users/…/shot.png`, a link to `file:///…/notes.md`, a
 * picture from `http://localhost:3000/…`) is the computer's too: links open it from there, and
 * embedded files are copied into the mirror or loaded through a forward
 * (CDXC:RemoteMachines 2026-10-16 in `webPreview/machineLinks.ts`). Video and audio play from the
 * computer's gxserver (`docs/mediaStream.ts`).
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { useStackScreenRail } from '../components/common/verticalBar/stackRail';
import { CopyGlyph, PencilGlyph } from '../components/sessions/icons';
import { RefreshIcon } from '../components/terminal/icons';
import { DocsCopy } from '../copy';
import { agentationInjectionScript, parseDocPageMessage } from '../docs/agentation';
import { assetLoaderAnswerScript, assetLoaderInjectionScript, parseDocAssetsMessage } from '../docs/assetLoader';
import {
  buildDocPage,
  mirrorPathsToRemote,
  mirrorRequestedAssets,
  remotePathForMirrorUrl,
  type DocPage,
} from '../docs/page';
import { viewerProject } from '../docs/mediaStream';
import { remotePathFromFileUrl } from '../docs/openDoc';
import { openComputerFile } from '../docs/openComputerFile';
import { baseName, docKindForPath, normalizeRemotePath } from '../docs/paths';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette } from '../theme/palette';
import {
  classifyMachineLink,
  holdComputerForward,
  openComputerForward,
  releaseComputerForward,
} from '../webPreview/machineLinks';
import { useOpenMachineLink } from '../webPreview/useOpenMachineLink';

type Props = NativeStackScreenProps<RootStackParamList, 'DocViewer'>;

type LoadState =
  { kind: 'loading' } | { kind: 'ready'; page: DocPage; nonce: number } | { kind: 'failed'; message: string };

type Notice = { id: number; title?: string; message: string; error: boolean };

/** Annotation tools stay as the user last left them for the rest of the app run. */
let annotationsEnabled = true;

export default function DocViewerScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { machineId, fragment, projectId } = route.params;
  const remotePath = normalizeRemotePath(route.params.path);
  const machine = useMachinesStore((state) => state.machines.find((candidate) => candidate.id === machineId));
  const openMachineLink = useOpenMachineLink();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [annotate, setAnnotate] = useState(annotationsEnabled);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeCounter = useRef(0);
  const generation = useRef(0);
  const webViewRef = useRef<WebView<object>>(null);
  // The machine record is rebuilt on every inventory poll; only its id picks what is loaded.
  const machineRef = useRef(machine);
  machineRef.current = machine;

  const showNotice = useCallback((message: string, error = false, title?: string) => {
    noticeCounter.current += 1;
    setNotice({ id: noticeCounter.current, message, error, ...(title !== undefined ? { title } : {}) });
  }, []);

  const reload = useCallback(() => {
    const target = machineRef.current;
    generation.current += 1;
    const current = generation.current;
    if (target === undefined) {
      setLoad({ kind: 'failed', message: DocsCopy.machineMissing });
      return;
    }
    setLoad({ kind: 'loading' });
    buildDocPage(target, remotePath, () => current !== generation.current, viewerProject(target.id, projectId))
      .then((page) => {
        if (current !== generation.current) return;
        setLoad({ kind: 'ready', page, nonce: current });
        if (page.skippedAssets > 0) showNotice(DocsCopy.skippedAssets(page.skippedAssets));
      })
      .catch((error: unknown) => {
        if (current !== generation.current) return;
        setLoad({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      });
  }, [projectId, remotePath, showNotice]);

  useEffect(() => {
    reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  const isHtml = docKindForPath(remotePath) === 'html';
  const toggleAnnotate = useCallback(() => {
    setAnnotate((current) => {
      annotationsEnabled = !current;
      return !current;
    });
  }, []);
  const copyPath = useCallback(() => {
    void Clipboard.setStringAsync(remotePath);
    showNotice(remotePath, false, DocsCopy.pathCopied);
  }, [remotePath, showNotice]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: baseName(remotePath),
      headerRight: () => (
        <View style={styles.headerButtons}>
          {isHtml ? (
            <HeaderButton
              label={annotate ? DocsCopy.annotateOn : DocsCopy.annotateOff}
              onPress={toggleAnnotate}
              active={annotate}
              icon={<PencilGlyph size={17} color={annotate ? GhostexPalette.ACCENT : GhostexPalette.FOREGROUND} />}
            />
          ) : null}
          <HeaderButton
            label={DocsCopy.copyPath}
            onPress={copyPath}
            icon={<CopyGlyph size={17} color={GhostexPalette.FOREGROUND} />}
          />
          <HeaderButton
            label={DocsCopy.reload}
            onPress={reload}
            icon={<RefreshIcon size={18} color={GhostexPalette.FOREGROUND} />}
          />
        </View>
      ),
    });
  }, [annotate, copyPath, isHtml, navigation, reload, remotePath, toggleAnnotate]);
  // On the iPhone Duo the same buttons stand in the side bar under Back. An HTML page's annotation tool
  // has text fields, so there the rail keeps clear of the keyboard, annotating or not (it never moves
  // when the switch flips).
  useStackScreenRail(
    useMemo(
      () => ({
        entries: [
          ...(isHtml
            ? [
                {
                  key: 'annotate',
                  label: annotate ? DocsCopy.annotateOn : DocsCopy.annotateOff,
                  icon: (size: number) => (
                    <PencilGlyph size={size} color={annotate ? GhostexPalette.ACCENT : GhostexPalette.FOREGROUND} />
                  ),
                  onPress: toggleAnnotate,
                  selected: annotate,
                },
              ]
            : []),
          {
            key: 'copy-path',
            label: DocsCopy.copyPath,
            icon: (size: number) => <CopyGlyph size={size} color={GhostexPalette.FOREGROUND} />,
            onPress: copyPath,
          },
          {
            key: 'reload',
            label: DocsCopy.reload,
            icon: (size: number) => <RefreshIcon size={size} color={GhostexPalette.FOREGROUND} />,
            onPress: reload,
          },
        ],
        reserveKeyboard: isHtml,
      }),
      [annotate, copyPath, isHtml, reload, toggleAnnotate],
    ),
  );

  const page = load.kind === 'ready' ? load.page : null;
  const loadedPage = useRef<DocPage | null>(null);
  loadedPage.current = page;
  const source = useMemo(
    () => (page === null ? null : { uri: fragment ? `${page.uri}#${encodeURIComponent(fragment)}` : page.uri }),
    [fragment, page],
  );

  /** Opens another file on the computer where the phone opens it (`docs/openComputerFile.ts`). */
  const openLinkedFile = useCallback(
    (path: string, fragmentText: string): void => {
      openComputerFile(navigation, machineId, path, {
        ...(projectId !== undefined ? { projectId } : {}),
        ...(fragmentText.length > 0 ? { fragment: decodeFragment(fragmentText) } : {}),
        notify: showNotice,
      });
    },
    [machineId, navigation, projectId, showNotice],
  );

  const handleShouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      // Frames load what their page asks for; only the page's own navigations are routed.
      if (request.isTopFrame === false) return true;
      const url = request.url;
      if (page === null) return false;
      if (/^(about|data|blob|javascript):/iu.test(url)) return true;
      if (/^https?:\/\//iu.test(url)) {
        if (machineRef.current !== undefined) openMachineLink(machineRef.current.id, url);
        return false;
      }
      const mirrored = remotePathForMirrorUrl(url);
      if (mirrored === null) {
        /*
         * An absolute path the page wrote (`/Users/…`, `file:///…`, `C:/…`) resolved against the
         * phone's own file system; it names a file on the computer.
         */
        const file = remotePathFromFileUrl(url);
        if (file !== null) openLinkedFile(file.path, file.fragment ?? '');
        else if (/^[a-z]:\//iu.test(url)) openLinkedFile(decodeFragment(url.split(/[?#]/u)[0] ?? ''), '');
        else void Linking.openURL(url).catch(() => undefined);
        return false;
      }
      const target = normalizeRemotePath(mirrored.remotePath);
      // The page itself, including a jump to one of its own anchors.
      if (target === remotePath || target === `${remotePath}.ghostex-view.html`) return true;
      openLinkedFile(target, mirrored.fragment);
      return false;
    },
    [openLinkedFile, openMachineLink, page, remotePath],
  );

  /*
   * Forwards this viewer opened for a page's loopback pictures and media, released when it goes.
   * The machine id never changes for a mounted viewer, so this runs once, on unmount.
   */
  const heldPortsRef = useRef(new Set<number>());
  useEffect(() => {
    const held = heldPortsRef.current;
    return () => {
      for (const port of held) void releaseComputerForward(machineId, port);
      held.clear();
    };
  }, [machineId]);

  /**
   * The phone URLs for loopback addresses a page failed to load (`http://localhost:3000/a.png`):
   * the same path through a forward to that port on the computer.
   */
  const forwardRequestedAddresses = useCallback(async (urls: readonly string[]): Promise<Record<string, string>> => {
    const target = machineRef.current;
    const replacements: Record<string, string> = {};
    if (target === undefined) return replacements;
    for (const url of urls) {
      const link = classifyMachineLink(url);
      if (link.kind !== 'computer') continue;
      try {
        const { localPort, gxserver } = await openComputerForward(target, link.address);
        if (!gxserver && !heldPortsRef.current.has(link.address.remotePort)) {
          holdComputerForward(target.id, link.address.remotePort);
          heldPortsRef.current.add(link.address.remotePort);
        }
        replacements[url] = `${link.address.scheme}://127.0.0.1:${localPort}${link.address.path}`;
      } catch {
        // Nothing listens there on the computer either; the picture stays broken, as it would there.
      }
    }
    return replacements;
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const assets = parseDocAssetsMessage(event.nativeEvent.data);
      if (assets !== null) {
        if (page === null) return;
        const answer = (replacements: Readonly<Record<string, string>>) => {
          // A reload in between replaced the page (and its mirror state); the old page is gone.
          if (loadedPage.current !== page) return;
          webViewRef.current?.injectJavaScript(assetLoaderAnswerScript(assets.urls, replacements));
        };
        void Promise.all([
          mirrorRequestedAssets(page, assets.urls).catch(() => ({})),
          forwardRequestedAddresses(assets.urls),
        ]).then(([mirrored, forwarded]) => answer({ ...mirrored, ...forwarded }));
        return;
      }
      const message = parseDocPageMessage(event.nativeEvent.data);
      if (message === null) return;
      if (message.type === 'agentationCopy') {
        void Clipboard.setStringAsync(mirrorPathsToRemote(message.markdown));
        showNotice(DocsCopy.annotationsCopiedHint, false, DocsCopy.annotationsCopied);
      } else if (message.type === 'agentationFailed') {
        showNotice(DocsCopy.agentationFailed, true);
      }
    },
    [forwardRequestedAddresses, page, showNotice],
  );

  const injectAgentation = isHtml && annotate;
  const injectedScript = useMemo(
    () => (injectAgentation ? agentationInjectionScript() : undefined),
    [injectAgentation],
  );

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      {load.kind === 'ready' && source !== null ? (
        <WebView<object>
          // A new read, or annotation tools turned on or off, loads the page afresh.
          key={`${load.nonce}:${injectAgentation ? 'a' : 'p'}`}
          ref={webViewRef}
          source={source}
          originWhitelist={['*']}
          // iOS reads the page's sibling files only when access is widened to the mirror folder.
          allowingReadAccessToURL={load.page.rootUri}
          allowFileAccess
          // A page's own module scripts, stylesheets and frames are `file://` loads from a `file://` page.
          allowFileAccessFromFileURLs
          // A player page names the computer's stream through a phone forward, which is not the page's to report.
          injectedJavaScriptBeforeContentLoaded={
            load.page.kind === 'video' || load.page.kind === 'audio' ? undefined : ASSET_LOADER_SCRIPT
          }
          injectedJavaScript={injectedScript}
          onMessage={handleMessage}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          style={styles.webview}
          containerStyle={styles.webview}
          setSupportMultipleWindows={false}
          allowsInlineMediaPlayback
          allowsLinkPreview={false}
          allowsBackForwardNavigationGestures={false}
          webviewDebuggingEnabled={__DEV__}
          startInLoadingState
          renderLoading={() => <LoadingSurface message={DocsCopy.opening} />}
        />
      ) : load.kind === 'failed' ? (
        <View style={styles.centered}>
          <Text style={styles.failureTitle}>{DocsCopy.openFailed}</Text>
          <Text style={styles.failureBody} selectable>
            {load.message}
          </Text>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.retryButton}>
            <Text style={styles.retryText}>{DocsCopy.retry}</Text>
          </Pressable>
        </View>
      ) : (
        <LoadingSurface message={DocsCopy.readingFile} />
      )}
      <NoticeToast notice={notice} bottom={insets.bottom + 16} />
    </View>
  );
}

const ASSET_LOADER_SCRIPT = assetLoaderInjectionScript();

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function HeaderButton({
  label,
  icon,
  onPress,
  active = false,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerButton,
        active && styles.headerButtonActive,
        pressed && styles.headerButtonPressed,
      ]}
    >
      {icon}
    </Pressable>
  );
}

function LoadingSurface({ message }: { message: string }) {
  return (
    <View style={[styles.centered, StyleSheet.absoluteFill]}>
      <ActivityIndicator color={GhostexPalette.MUTED} />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

function NoticeToast({ notice, bottom }: { notice: Notice | null; bottom: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<Notice | null>(null);
  useEffect(() => {
    if (notice === null) return undefined;
    setShown(notice);
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setShown(null));
    }, 3200);
    return () => clearTimeout(timer);
  }, [notice, opacity]);
  if (shown === null) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toastRow, { bottom, opacity }]} accessibilityLiveRegion="polite">
      <View style={styles.toast}>
        {shown.title !== undefined ? <Text style={styles.toastTitle}>{shown.title}</Text> : null}
        <Text style={[styles.toastText, shown.error && styles.toastError]} numberOfLines={3}>
          {shown.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: GhostexPalette.BACKGROUND },
  webview: { flex: 1, backgroundColor: GhostexPalette.BACKGROUND },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerButton: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  headerButtonActive: { backgroundColor: 'rgba(125,211,252,0.12)' },
  headerButtonPressed: { opacity: 0.6 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  loadingText: { color: GhostexPalette.MUTED, fontSize: 13 },
  failureTitle: { color: GhostexPalette.FOREGROUND, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  failureBody: { color: GhostexPalette.MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: {
    marginTop: 6,
    paddingHorizontal: 18,
    height: 40,
    borderRadius: 10,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: GhostexPalette.ACCENT_FOREGROUND, fontSize: 14, fontWeight: '600' },
  toastRow: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    maxWidth: 420,
    borderWidth: 1,
    borderColor: GhostexPalette.BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
    backgroundColor: '#1f1f1f',
  },
  toastTitle: { color: GhostexPalette.FOREGROUND, fontSize: 13, fontWeight: '600' },
  toastText: { color: GhostexPalette.MUTED, fontSize: 13, lineHeight: 18 },
  toastError: { color: GhostexPalette.DANGER },
});
