/**
 * TEMPORARY verification harness (delete after use): exercises the new
 * Send & Attach File chooser flow — real ContextMenu dismissal deferral →
 * Alert chooser → expo-image-picker photo library — outside the terminal
 * screen so it needs no SSH session.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import ContextMenu from './components/sessions/ContextMenu';

const log = (message: string) => console.log(`[chooser-repro] ${message}`);

export default function AttachChooserRepro() {
  const [menuVisible, setMenuVisible] = useState(false);
  const pendingAfterMenuDismiss = useRef<(() => void) | null>(null);

  const promptAttachmentSource = () => {
    log('presenting chooser alert');
    Alert.alert('Send & Attach File', undefined, [
      {
        text: 'Photo Library',
        onPress: () => {
          log('Photo Library pressed; calling launchImageLibraryAsync');
          void (async () => {
            try {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsMultipleSelection: false,
                allowsEditing: false,
              });
              if (result.canceled) {
                log('picker canceled');
                return;
              }
              const asset = result.assets?.[0];
              log(
                `picked asset: fileName=${asset?.fileName ?? 'null'} mime=${
                  asset?.mimeType ?? 'null'
                } uri=${asset?.uri ?? 'null'}`,
              );
            } catch (error) {
              log(`ERROR ${String(error)}`);
            }
          })();
        },
      },
      { text: 'Choose File', onPress: () => log('Choose File pressed') },
      { text: 'Cancel', style: 'cancel', onPress: () => log('chooser canceled') },
    ]);
  };

  useEffect(() => {
    const t1 = setTimeout(() => {
      log('opening menu');
      setMenuVisible(true);
    }, 3000);
    const t2 = setTimeout(() => {
      log('simulating attach item press');
      setMenuVisible(false);
      if (Platform.OS === 'ios') {
        pendingAfterMenuDismiss.current = promptAttachmentSource;
        return;
      }
      promptAttachmentSource();
    }, 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: '#111', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', textAlign: 'center' }}>attach chooser repro</Text>
        <ContextMenu
          visible={menuVisible}
          title="Repro Session"
          items={[
            {
              kind: 'item',
              key: 'attachPath',
              label: 'Send & Attach File',
              icon: <Text style={{ color: '#fff' }}>·</Text>,
              onPress: () => undefined,
            },
          ]}
          onClose={() => setMenuVisible(false)}
          onDismissed={() => {
            const pending = pendingAfterMenuDismiss.current;
            pendingAfterMenuDismiss.current = null;
            if (pending !== null) {
              log('onDismissed running pending chooser');
              pending();
            }
          }}
        />
      </View>
    </SafeAreaProvider>
  );
}
