/**
 * Docs viewer: one file from the computer, read over SSH. Files uses rendered documents, numbered source
 * or name-and-size metadata; chat and terminal links also open pictures and media here.
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
 * computer's gxserver (`docs/mediaStream.ts`). Opened from Files, its header is the design's preview
 * header: Copy Full Path, Add to Session Context (only when Files was opened from
 * an agent session), Share and Reload. Metadata keeps Reload in the header, Copy and Share below the file name.
 * Half folded like a laptop the page, with its loading and failure states (Retry), ends 8 pt above the fold, as the
 * Web Preview's does: the page is the computer's content with controls of its own (links, an HTML page's buttons and
 * fields, the annotation tool) that the app cannot move off the knick.
 */

import { documentAppearanceScript, documentAppearanceStyles } from '../docs/plainDocument';
import { useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import * as Clipboard from 'expo-clipboard';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { measureInWindow } from '../components/common/measureInWindow';
import NoticeToast, { type Notice } from '../components/common/NoticeToast';
import { useLaptopFold } from '../components/common/verticalBar/laptopFold';
import { foldUpperHalfInset } from '../components/common/verticalBar/layout';
import { useStackScreenRail } from '../components/common/verticalBar/stackRail';
import { useScrollToBarEdges, type RailEntry } from '../components/common/verticalBar/VerticalBarArea';
import { CopyGlyph, PencilGlyph, ShareGlyph } from '../components/sessions/icons';
import { DocsCopy } from '../copy';
import { agentationInjectionScript, parseDocPageMessage } from '../docs/agentation';
import { assetLoaderAnswerScript, assetLoaderInjectionScript, parseDocAssetsMessage } from '../docs/assetLoader';
import { buildDocPage, mirrorPathsToRemote, mirrorRequestedAssets, type DocPage } from '../docs/page';
import { docNavigationFor, navigationWasTapped, type DocNavigation } from '../docs/pageRules';
import { viewerProject } from '../docs/mediaStream';
import { openComputerFile } from '../docs/openComputerFile';
import { baseName, docKindForPath, extensionOf, MIRROR_FOLDER, normalizeRemotePath } from '../docs/paths';
import { FileKindIcon } from '../files/FileRows';
import { useProjectDocsRpc } from '../files/machine';
import { formatFileSize, statProjectFile } from '../files/preview';
import { PreviewHeaderButtons, previewEntries } from '../files/PreviewButtons';
import { previewActions } from '../files/rowMenu';
import { canShareFiles } from '../files/shareSheet';
import { useShareFile } from '../files/useShareFile';
import { useAddToSessionContext } from '../files/useSessionContext';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';

import {
  classifyMachineLink,
  holdComputerForward,
  isGxserverAddress,
  openComputerForward,
  releaseComputerForward,
} from '../webPreview/machineLinks';
import { useOpenMachineLink } from '../webPreview/useOpenMachineLink';

type Props = NativeStackScreenProps<RootStackParamList, 'DocViewer'>;

type LoadState =
  { kind: 'loading' } | { kind: 'ready'; page: DocPage; nonce: number } | { kind: 'failed'; message: string };

/** Annotation tools stay as the user last left them for the rest of the app run. */
let annotationsEnabled = true;

export default function DocViewerScreen({ navigation, route }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const insets = useSafeAreaInsets();
  const infoEdges = useScrollToBarEdges(styles.infoContent);
  const { machineId, fragment, projectId, entryPath, size: listedSize, session } = route.params;
  const remotePath = normalizeRemotePath(route.params.path);
  const machine = useMachinesStore((state) => state.machines.find((candidate) => candidate.id === machineId));
  const openMachineLink = useOpenMachineLink();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [annotate, setAnnotate] = useState(annotationsEnabled);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Laptop pose: the content area's bottom edge in the window (a stack screen stands below its header, so it is
  // measured there), so the page ends above the fold.
  const fold = useLaptopFold();
  const areaRef = useRef<ViewInstance | null>(null);
  const [areaBottom, setAreaBottom] = useState<number | null>(null);
  const noticeCounter = useRef(0);
  const generation = useRef(0);
  const webViewRef = useRef<WebView<object>>(null);
  // The machine record is rebuilt on every inventory poll; only its id picks what is loaded.
  const machineRef = useRef(machine);
  machineRef.current = machine;

  const showNotice = useCallback((message: string, error = false, title?: string, lasting = false) => {
    noticeCounter.current += 1;
    setNotice({
      id: noticeCounter.current,
      message,
      error,
      ...(title !== undefined ? { title } : {}),
      ...(lasting ? { lasting } : {}),
    });
  }, []);
  // Ends a lasting notice (the file being fetched for Share…); a notice shown meanwhile stays.
  const clearNotice = useCallback(() => setNotice((current) => (current?.lasting === true ? null : current)), []);
  // Opened from Files: gxserver reads the file by its path in that project, for Share… and Add to Session Context.
  const rpc = useProjectDocsRpc(machineId);
  const { share, sharing } = useShareFile(rpc, projectId ?? '', { show: showNotice, clear: clearNotice });
  const fromFiles = entryPath !== undefined && projectId !== undefined ? entryPath : null;
  const info = load.kind === 'ready' && load.page.kind === 'info' ? load.page : null;
  const knownSize = info !== null ? info.size : (listedSize ?? null);
  const shareFile = useMemo(
    () =>
      canShareFiles && fromFiles !== null
        ? () => share({ path: fromFiles, name: baseName(remotePath), size: knownSize })
        : null,
    [fromFiles, knownSize, remotePath, share],
  );
  const addToContext = useAddToSessionContext(
    rpc,
    machineId,
    projectId ?? '',
    fromFiles !== null ? session : undefined,
    showNotice,
  );
  const addFileToContext = useMemo(
    () =>
      addToContext === null || fromFiles === null
        ? null
        : () => addToContext({ path: fromFiles, name: baseName(remotePath) }),
    [addToContext, fromFiles, remotePath],
  );

  const appearanceRef = useRef(appearance);
  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  const readPage = useCallback(
    (refreshSize: boolean) => {
      const target = machineRef.current;
      generation.current += 1;
      const current = generation.current;
      if (target === undefined) {
        setLoad({ kind: 'failed', message: DocsCopy.machineMissing });
        return;
      }
      setLoad({ kind: 'loading' });
      const size =
        fromFiles === null
          ? Promise.resolve(undefined)
          : refreshSize
            ? statProjectFile(rpc, projectId ?? '', fromFiles)
            : Promise.resolve(listedSize ?? null);
      size
        .then((fileSize) =>
          buildDocPage(
            target,
            remotePath,
            appearanceRef.current,
            () => current !== generation.current,
            viewerProject(target.id, projectId),
            fileSize,
          ),
        )
        .then((page) => {
          if (current !== generation.current) return;
          setLoad({ kind: 'ready', page, nonce: current });
          if (page.kind !== 'info' && page.kind !== 'source' && page.skippedAssets > 0) {
            showNotice(DocsCopy.skippedAssets(page.skippedAssets));
          }
        })
        .catch((error: unknown) => {
          if (current !== generation.current) return;
          setLoad({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
        });
    },
    [fromFiles, listedSize, projectId, remotePath, rpc, showNotice],
  );
  const reload = useCallback(() => readPage(true), [readPage]);

  useEffect(() => {
    readPage(false);
    return () => {
      generation.current += 1;
    };
  }, [readPage]);

  const isHtml = info === null && docKindForPath(remotePath) === 'html';
  const toggleAnnotate = useCallback(() => {
    setAnnotate((current) => {
      annotationsEnabled = !current;
      return !current;
    });
  }, []);
  const copyPath = useCallback(() => {
    Clipboard.setStringAsync(remotePath).then(
      () => showNotice(remotePath, false, DocsCopy.pathCopied),
      (failure: unknown) =>
        showNotice(failure instanceof Error ? failure.message : String(failure), true, DocsCopy.copyFailed),
    );
  }, [remotePath, showNotice]);

  // An HTML page's annotation switch, then the file's buttons: from Files the design's preview header, else
  // Copy path and Reload (outside Files there is neither Add to Session Context nor Share…).
  const buttons = useMemo(
    (): RailEntry[] => [
      ...(isHtml
        ? [
            {
              key: 'annotate',
              label: annotate ? DocsCopy.annotateOn : DocsCopy.annotateOff,
              icon: (size: number) => (
                <PencilGlyph size={size} color={annotate ? appearance.accent : appearance.foreground} />
              ),
              onPress: toggleAnnotate,
              selected: annotate,
            },
          ]
        : []),
      ...previewEntries(
        info !== null
          ? ['reload']
          : previewActions({ sessionContext: addFileToContext !== null, share: shareFile !== null }),
        { copyPath, addToSessionContext: addFileToContext, share: shareFile, reload },
        { copyPathLabel: fromFiles !== null ? DocsCopy.copyFullPath : DocsCopy.copyPath, sharing },
      ),
    ],
    [
      addFileToContext,
      annotate,
      copyPath,
      fromFiles,
      info,
      isHtml,
      reload,
      shareFile,
      sharing,
      toggleAnnotate,
      appearance,
    ],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: baseName(remotePath),
      headerRight: () => <PreviewHeaderButtons entries={buttons} />,
    });
  }, [buttons, navigation, remotePath]);
  // On the iPhone Duo the same buttons stand in the side bar under Back. An HTML page's annotation tool
  // has text fields, so there the rail keeps clear of the keyboard, annotating or not (it never moves
  // when the switch flips).
  useStackScreenRail(useMemo(() => ({ entries: buttons, reserveKeyboard: isHtml }), [buttons, isHtml]));

  const page = load.kind === 'ready' && load.page.kind !== 'info' ? load.page : null;
  const loadedPage = useRef<typeof page>(null);
  loadedPage.current = page;
  const isSource = page?.kind === 'source';
  useEffect(() => {
    if (page !== null && page.kind !== 'html') {
      webViewRef.current?.injectJavaScript(documentAppearanceScript(appearance));
    }
  }, [appearance, page]);
  const source = useMemo(
    () =>
      page === null
        ? null
        : page.kind === 'source'
          ? { html: page.html }
          : { uri: fragment ? `${page.uri}#${encodeURIComponent(fragment)}` : page.uri },
    [fragment, page],
  );

  const themedSource = useMemo(
    () => page?.kind === 'source'
      ? { html: page.html.replace(/(<style id="ghostex-document-theme">)[\s\S]*?(<\/style>)/u, `$1${documentAppearanceStyles(appearance)}$2`) }
      : source,
    [appearance, page, source],
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

  /*
   * When the user last touched the page. The app sees the touch itself (React Native's touch events
   * on the page's container), so a page's script cannot fake one (CDXC:Docs 2026-11-14 in docs/page.ts).
   */
  const lastTouchAt = useRef<number | null>(null);
  const noteTouch = useCallback(() => {
    lastTouchAt.current = Date.now();
  }, []);
  // One question at a time: a page that keeps navigating while one is open is refused meanwhile.
  const askingRef = useRef(false);

  const openNavigation = useCallback(
    (link: Exclude<DocNavigation, { kind: 'stay' | 'refuse' }>): void => {
      if (link.kind === 'file') openLinkedFile(link.path, link.fragment);
      else if (link.kind === 'web') {
        if (machineRef.current !== undefined) openMachineLink(machineRef.current.id, link.url);
      } else void Linking.openURL(link.url).catch(() => undefined);
    },
    [openLinkedFile, openMachineLink],
  );

  /**
   * Ask before leaving a Docs page (`pageRules.ts`): a tap on an ordinary link opens it as before;
   * a navigation the user did not tap, or another app's link, shows its whole target first and
   * opens only on Open (Cancel is the default), as the desktop's "Open a link in another app?".
   */
  const handleShouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      // A frame's own navigations stay in the frame, which the page's policy limits to `blob:`.
      if (request.isTopFrame === false) return true;
      if (page === null) return false;
      const tapped = navigationWasTapped(lastTouchAt.current, Date.now(), request.navigationType, Platform.OS);
      const link = docNavigationFor(request.url, remotePath, tapped);
      if (link.kind === 'stay') return true;
      if (link.kind === 'refuse') return false;
      if (link.ask === null) {
        openNavigation(link);
        return false;
      }
      if (askingRef.current) return false;
      askingRef.current = true;
      const done = () => {
        askingRef.current = false;
      };
      const shown = link.kind === 'file' ? link.path : link.url;
      Alert.alert(
        DocsCopy.linkAskTitle[link.ask],
        DocsCopy.linkAskDetail(shown.length > 600 ? `${shown.slice(0, 600)}…` : shown, link.ask),
        [
          { text: DocsCopy.linkAskCancel, style: 'cancel', onPress: done },
          {
            text: DocsCopy.linkAskOpen,
            onPress: () => {
              done();
              openNavigation(link);
            },
          },
        ],
        { cancelable: true, onDismiss: done },
      );
      return false;
    },
    [openNavigation, page, remotePath],
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
   * the same path through a forward to that port on the computer. Only ports the page's own markup
   * names are forwarded, and never gxserver's (CDXC:Docs 2026-10-25 in docs/page.ts).
   */
  const forwardRequestedAddresses = useCallback(
    async (
      requestingPage: Exclude<DocPage, { kind: 'info' | 'source' }>,
      urls: readonly string[],
    ): Promise<Record<string, string>> => {
      const target = machineRef.current;
      const replacements: Record<string, string> = {};
      if (target === undefined) return replacements;
      for (const url of urls) {
        const link = classifyMachineLink(url);
        if (link.kind !== 'computer') continue;
        if (!requestingPage.loopbackPorts.has(link.address.remotePort)) continue;
        // `/visual/` makes the check ask the computer for gxserver's port when it is not known yet.
        if (await isGxserverAddress(target, link.address.remotePort, '/visual/')) continue;
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
    },
    [],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (page?.kind === 'source') return;
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
          forwardRequestedAddresses(page, assets.urls),
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
    () => `${isHtml ? '' : documentAppearanceScript(appearance)}${injectAgentation ? agentationInjectionScript() : ''}`,
    [injectAgentation, isHtml, appearance],
  );
  // What the page leaves free above the area's bottom in the laptop pose; 0 elsewhere.
  const contentInset = areaBottom === null ? 0 : foldUpperHalfInset(fold, areaBottom);

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <View
        ref={areaRef}
        style={styles.area}
        onLayout={() => measureInWindow(areaRef, (frame) => setAreaBottom(frame.y + frame.height))}
      >
        <View
          testID="doc-content"
          style={[styles.area, contentInset > 0 && { marginBottom: contentInset }]}
          onTouchStart={noteTouch}
          onTouchEnd={noteTouch}
          onTouchCancel={noteTouch}
        >
      {info !== null ? (
        <ScrollView style={infoEdges.scroll} contentContainerStyle={[styles.infoContent, infoEdges.content]}>
          <View style={styles.info}>
            <View style={styles.infoIcon}>
              <FileKindIcon name={baseName(remotePath)} size={34} />
            </View>
            <Text style={styles.infoTitle} accessibilityRole="header">
              {DocsCopy.cantPreview}
            </Text>
            <Text style={styles.infoName} selectable>
              {baseName(remotePath)}
            </Text>
            <Text style={styles.infoMeta}>
              {DocsCopy.infoMeta(
                info.size === null ? DocsCopy.sizeUnknown : formatFileSize(info.size),
                DocsCopy.infoKind(extensionOf(remotePath), info.reason === 'image'),
              )}
            </Text>
            <Text style={styles.infoMeta}>{DocsCopy.infoWhy[info.reason]}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={copyPath}
              style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
            >
              <CopyGlyph size={16} color={appearance.accentForeground} />
              <Text style={styles.copyText}>{DocsCopy.copyFullPath}</Text>
            </Pressable>
            {shareFile !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: sharing }}
                disabled={sharing}
                onPress={shareFile}
                style={({ pressed }) => [styles.shareButton, (pressed || sharing) && styles.pressed]}
              >
                <ShareGlyph size={16} color={appearance.foreground} />
                <Text style={styles.shareText}>{DocsCopy.share}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.infoPath} selectable>
              {remotePath}
            </Text>
          </View>
        </ScrollView>
      ) : load.kind === 'ready' && page !== null && source !== null ? (
        <WebView<object>
          // A new read, or annotation tools turned on or off, loads the page afresh.
          key={`${load.nonce}:${injectAgentation ? 'a' : 'p'}`}
          ref={webViewRef}
          source={themedSource ?? undefined}
          accessibilityLabel={isSource ? DocsCopy.sourceView(baseName(remotePath)) : undefined}
          javaScriptEnabled={!isSource}
          originWhitelist={isSource ? ['about:blank'] : ['*']}
          // Source is inline escaped text, not an authored page with access to sibling assets. A page
          // reads its own folder's mirror (its project's, for Markdown), not other pages' copies.
          allowingReadAccessToURL={page.kind === 'source' ? undefined : page.readAccessUri}
          // Android loads the mirror from the Docs loader's origin with no file access at all
          // (DOCS_LOADER_ORIGIN in docs/paths.ts); iOS reads it from `file://`.
          androidCacheAssetFolder={isSource ? undefined : MIRROR_FOLDER}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={Platform.OS === 'ios' && !isSource}
          allowUniversalAccessFromFileURLs={false}
          // A player page names the computer's stream through a phone forward, which is not the page's to report.
          injectedJavaScriptBeforeContentLoaded={
            isSource || page.kind === 'video' || page.kind === 'audio' ? undefined : ASSET_LOADER_SCRIPT
          }
          injectedJavaScript={isSource ? undefined : injectedScript}
          onMessage={isSource ? undefined : handleMessage}
          onShouldStartLoadWithRequest={isSource ? undefined : handleShouldStartLoad}
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
        </View>
      </View>
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

function LoadingSurface({ message }: { message: string }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  return (
    <View style={[styles.centered, StyleSheet.absoluteFill]}>
      <ActivityIndicator color={appearance.muted} />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: appearance.background },
  area: { flex: 1 },
  webview: { flex: 1, backgroundColor: appearance.background },
  pressed: { opacity: 0.6 },
  infoContent: { paddingHorizontal: 28, paddingTop: 56, paddingBottom: 32 },
  info: { width: '100%', maxWidth: 420, alignSelf: 'center', alignItems: 'center', gap: 8 },
  infoIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    backgroundColor: appearance.card,
  },
  infoTitle: { color: appearance.foreground, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  infoName: { color: appearance.foreground, fontSize: 15, textAlign: 'center' },
  infoMeta: { color: appearance.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    minWidth: 200,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: appearance.accent,
  },
  copyText: { color: appearance.accentForeground, fontSize: 14, fontWeight: '600' },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 200,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: appearance.border,
    backgroundColor: appearance.card,
  },
  shareText: { color: appearance.foreground, fontSize: 14, fontWeight: '600' },
  infoPath: {
    marginTop: 4,
    color: appearance.muted,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'Menlo',
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: appearance.background,
  },
  loadingText: { color: appearance.muted, fontSize: 13 },
  failureTitle: { color: appearance.foreground, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  failureBody: { color: appearance.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: {
    marginTop: 6,
    paddingHorizontal: 18,
    height: 40,
    borderRadius: 10,
    backgroundColor: appearance.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: appearance.accentForeground, fontSize: 14, fontWeight: '600' },
});
