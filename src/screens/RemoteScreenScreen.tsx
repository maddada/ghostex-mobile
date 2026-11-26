/**
 * Remote screen: the computer's screen, full screen on the phone, driven by touch. The viewer is the
 * computer's screen helper's own page (voxl), reached through the computer's gxserver on the same
 * loopback forward the chat uses; WebCodecs decodes it, which needs the page's `http://127.0.0.1`
 * origin (a secure context). CDXC:RemoteScreen 2026-11-26 in remoteScreen/api.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { RemoteScreenCopy } from '../copy';
import { machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { startRemoteScreen, stopRemoteScreen, type RemoteScreenStart } from '../remoteScreen/api';
import { useAppearance } from '../theme/useAppearance';

type Props = NativeStackScreenProps<RootStackParamList, 'RemoteScreen'>;

type State = { kind: 'starting' } | RemoteScreenStart;

export default function RemoteScreenScreen({ navigation, route }: Props) {
  const { machineId } = route.params;
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId) ?? null);
  const appearance = useAppearance();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const name = machine === null ? '' : machineDisplayLabel(machine);

  useEffect(() => {
    if (machine === null) return;
    let live = true;
    setState({ kind: 'starting' });
    void startRemoteScreen(machine).then((answer) => {
      if (live) setState(answer);
    });
    return () => {
      live = false;
    };
    // A new attempt (Try again) or another computer starts it again; the record's identity does not.
  }, [machineId, attempt]);

  // Leaving the screen ends the stream on the computer, so it never keeps capturing unwatched.
  useEffect(() => {
    if (machine === null) return;
    return () => {
      void stopRemoteScreen(machine);
    };
  }, [machineId]);

  const close = useCallback(() => navigation.goBack(), [navigation]);

  // The viewer stays on its own page: anything else it tries to open is refused.
  const shouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest) => state.kind === 'ready' && request.url.startsWith(state.uri),
    [state],
  );

  return (
    <View style={styles.page}>
      {state.kind === 'ready' ? (
        <WebView<object>
          source={{ uri: state.uri }}
          style={styles.webview}
          originWhitelist={['http://*']}
          onShouldStartLoadWithRequest={shouldStartLoad}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          keyboardDisplayRequiresUserAction={false}
          bounces={false}
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          allowsLinkPreview={false}
          onError={() => setState({ kind: 'failed', code: 'pageFailed', message: '' })}
          webviewDebuggingEnabled={__DEV__}
        />
      ) : (
        <View style={styles.state}>
          <Text style={[styles.stateTitle, { color: appearance.foreground }]}>
            {state.kind === 'starting' ? RemoteScreenCopy.starting(name) : RemoteScreenCopy.failedTitle(name)}
          </Text>
          {state.kind === 'failed' ? (
            <>
              <Text style={[styles.stateBody, { color: appearance.muted }]}>
                {RemoteScreenCopy.failedBody(state.code, state.message, name)}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAttempt((n) => n + 1)}
                style={[styles.retry, { borderColor: appearance.muted }]}
              >
                <Text style={{ color: appearance.foreground }}>{RemoteScreenCopy.tryAgain}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={RemoteScreenCopy.close}
        onPress={close}
        hitSlop={10}
        style={[styles.close, { top: insets.top + 8 }]}
      >
        <Text style={styles.closeText}>{RemoteScreenCopy.close}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  webview: { flex: 1, backgroundColor: '#000' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  stateTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  stateBody: { fontSize: 14, textAlign: 'center' },
  retry: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  close: {
    position: 'absolute',
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
