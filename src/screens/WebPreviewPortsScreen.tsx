/**
 * Web preview step 1: choose which of the computer's ports to preview.
 *
 * Two ways in, both first class. The port field is what the user already knows
 * ("my app runs on 3000") and never depends on the computer answering, while
 * the list below it is discovery for everything else, read from
 * `ghostex ports --json`. A failed listing therefore reports itself and leaves
 * the field working, rather than blocking the screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorldGlyph } from '../components/sessions/icons';
import { WebPreviewCopy } from '../copy';
import { machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette } from '../theme/palette';
import { fetchRemotePorts, type RemoteListeningPort } from '../webPreview/ports';
import { useWebPreviewStore } from '../webPreview/store';
import { parsePortInput } from '../webPreview/urls';
import { styles } from './web-preview/styles';

type Props = NativeStackScreenProps<RootStackParamList, 'WebPreviewPorts'>;

type ListingState =
  { kind: 'loading' } | { kind: 'loaded'; ports: RemoteListeningPort[] } | { kind: 'failed'; message: string };

/** Secondary line of a port row: the process, then the addresses it bound. */
function portRowDescription(entry: RemoteListeningPort): string {
  const command = entry.command ?? WebPreviewCopy.portRowUnknownCommand;
  if (entry.addresses.length === 0) return command;
  return `${command} · ${entry.addresses.join(', ')}`;
}

export default function WebPreviewPortsScreen({ navigation, route }: Props) {
  const machine = useMachinesStore((state) =>
    state.machines.find((candidate) => candidate.id === route.params.machineId)
  );
  const hydrateWebPreview = useWebPreviewStore((state) => state.hydrate);
  const rememberedPort = useWebPreviewStore((state) => state.lastPortByMachine[route.params.machineId]);

  const [portText, setPortText] = useState(rememberedPort === undefined ? '' : String(rememberedPort));
  const [portError, setPortError] = useState<string | null>(null);
  const [listing, setListing] = useState<ListingState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  /*
   * The machine record is rebuilt on every inventory poll, so reading it through
   * a ref keeps the listing from re-running every few seconds. Only the machine
   * id decides which machine is listed, and that is fixed for this screen.
   */
  const machineRef = useRef(machine);
  machineRef.current = machine;

  const loadPorts = useCallback(async (isRefresh: boolean): Promise<void> => {
    const target = machineRef.current;
    if (target === undefined) {
      setListing({ kind: 'failed', message: WebPreviewCopy.machineMissing });
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setListing({ kind: 'loading' });
    try {
      const ports = await fetchRemotePorts(target);
      setListing({ kind: 'loaded', ports });
    } catch (error) {
      setListing({
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadPorts(false);
  }, [loadPorts]);

  // Remembered ports come off disk, so the field starts empty on a cold start
  // and is filled in once the store has read them.
  useEffect(() => {
    void hydrateWebPreview();
  }, [hydrateWebPreview]);

  /*
   * Only prefill an untouched field: a port the user has already typed over is
   * what they want to open, not the one they opened last time.
   */
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || rememberedPort === undefined) return;
    prefilledRef.current = true;
    setPortText((current) => (current.length === 0 ? String(rememberedPort) : current));
  }, [rememberedPort]);

  const openPort = useCallback(
    (port: number): void => {
      navigation.navigate('WebPreview', { machineId: route.params.machineId, remotePort: port });
    },
    [navigation, route.params.machineId]
  );

  const submitTypedPort = useCallback((): void => {
    const port = parsePortInput(portText);
    if (port === null) {
      setPortError(WebPreviewCopy.invalidPort);
      return;
    }
    setPortError(null);
    openPort(port);
  }, [openPort, portText]);

  const typedPortValid = parsePortInput(portText) !== null;
  const listedPorts = listing.kind === 'loaded' ? listing.ports : [];

  // A machine deleted while this screen was open has nothing left to preview.
  if (machine === undefined) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.stateSurface}>
          <Text style={styles.stateBody}>{WebPreviewCopy.machineMissing}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.pickerContent}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadPorts(true)}
            tintColor={GhostexPalette.MUTED}
            colors={[GhostexPalette.ACCENT]}
            progressBackgroundColor={GhostexPalette.CARD}
          />
        }
      >
        <Text style={styles.intro}>{WebPreviewCopy.pickerIntro(machineDisplayLabel(machine))}</Text>

        <Text style={styles.sectionTitle}>{WebPreviewCopy.manualSection}</Text>
        <View style={styles.portEntryRow}>
          <TextInput
            style={styles.portInput}
            value={portText}
            onChangeText={(value) => {
              setPortText(value);
              setPortError(null);
            }}
            onSubmitEditing={submitTypedPort}
            placeholder={WebPreviewCopy.manualPlaceholder}
            placeholderTextColor={GhostexPalette.MUTED}
            keyboardType='number-pad'
            autoCapitalize='none'
            autoCorrect={false}
            spellCheck={false}
            returnKeyType='go'
            submitBehavior='blurAndSubmit'
            accessibilityLabel={WebPreviewCopy.manualSection}
          />
          <Pressable
            accessibilityRole='button'
            accessibilityState={{ disabled: !typedPortValid }}
            disabled={!typedPortValid}
            onPress={submitTypedPort}
            style={[styles.openButton, !typedPortValid && styles.openButtonDisabled]}
          >
            <Text style={styles.openButtonLabel}>{WebPreviewCopy.openButton}</Text>
          </Pressable>
        </View>
        {portError === null ? (
          <Text style={styles.hint}>{WebPreviewCopy.manualHint}</Text>
        ) : (
          <View accessibilityRole='alert' style={styles.errorBanner}>
            <Text style={styles.errorBannerBody}>{portError}</Text>
          </View>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>{WebPreviewCopy.listeningSection}</Text>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={WebPreviewCopy.refreshButton}
            onPress={() => void loadPorts(false)}
            style={styles.pillButton}
          >
            <Text style={styles.pillButtonLabel}>{WebPreviewCopy.refreshButton}</Text>
          </Pressable>
        </View>

        {listing.kind === 'loading' ? (
          <View style={styles.pendingRow}>
            <ActivityIndicator size='small' color={GhostexPalette.ACCENT} />
            <Text style={styles.pendingLabel}>{WebPreviewCopy.listeningLoading}</Text>
          </View>
        ) : null}

        {listing.kind === 'failed' ? (
          <View accessibilityRole='alert' style={styles.errorBanner}>
            <Text style={styles.errorBannerTitle}>{WebPreviewCopy.listeningFailedTitle}</Text>
            <Text style={styles.errorBannerBody}>{listing.message}</Text>
            <Text style={styles.errorBannerHint}>{WebPreviewCopy.listeningFailedHint}</Text>
          </View>
        ) : null}

        {listing.kind === 'loaded' && listedPorts.length === 0 ? (
          <Text style={styles.emptyRow}>{WebPreviewCopy.listeningEmpty}</Text>
        ) : null}

        {listedPorts.length > 0 ? (
          <View style={styles.listSection}>
            {listedPorts.map((entry, index) => (
              <Pressable
                key={entry.port}
                accessibilityRole='button'
                accessibilityLabel={WebPreviewCopy.portRowTitle(entry.port)}
                onPress={() => openPort(entry.port)}
                style={({ pressed }) => [
                  styles.portRow,
                  index > 0 && styles.portRowDivided,
                  pressed && styles.portRowPressed,
                ]}
              >
                <View style={styles.portRowIcon}>
                  <WorldGlyph size={14} color={GhostexPalette.MUTED} />
                </View>
                <View style={styles.portRowBody}>
                  <Text numberOfLines={1} style={styles.portRowTitle}>
                    {WebPreviewCopy.portRowTitle(entry.port)}
                  </Text>
                  <Text numberOfLines={1} style={styles.portRowDescription}>
                    {portRowDescription(entry)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
