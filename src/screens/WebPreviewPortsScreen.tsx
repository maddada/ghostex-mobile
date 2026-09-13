/**
 * Web preview step 1: enter an address or choose a listening port.
 *
 * Two ways in, both first class. The address field is what the user already knows
 * ("my app runs on 3000") and never depends on the computer answering, while
 * the list below it is discovery for everything else, read from
 * `ghostex ports --json`. A failed listing therefore reports itself and leaves
 * the field working, rather than blocking the screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PortSections } from './web-preview/PortSections';
import { WebPreviewCopy } from '../copy';
import { machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette } from '../theme/palette';
import { fetchRemotePorts, type RemoteListeningPort } from '../webPreview/ports';
import { useWebPreviewStore } from '../webPreview/store';
import { parseAddressInput } from '../webPreview/urls';
import { webPreviewTargetForUrl } from '../webPreview/routing';
import { styles } from './web-preview/styles';

type Props = NativeStackScreenProps<RootStackParamList, 'WebPreviewPorts'>;

type ListingState =
  { kind: 'loading' } | { kind: 'loaded'; ports: RemoteListeningPort[] } | { kind: 'failed'; message: string };

/**
 * CDXC:Browser 2026-09-12 DECISION:
 * User: allow typing an address immediately on the mobile browser list and editing it while browsing.
 */
export default function WebPreviewPortsScreen({ navigation, route }: Props) {
  const machine = useMachinesStore((state) =>
    state.machines.find((candidate) => candidate.id === route.params.machineId)
  );
  const hydrateWebPreview = useWebPreviewStore((state) => state.hydrate);
  const rememberedPort = useWebPreviewStore((state) => state.lastPortByMachine[route.params.machineId]);

  const [addressText, setAddressText] = useState(rememberedPort === undefined ? '' : String(rememberedPort));
  const [addressError, setAddressError] = useState<string | null>(null);
  const [listing, setListing] = useState<ListingState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const listingRequestRef = useRef(0);

  /*
   * The machine record is rebuilt on every inventory poll, so reading it through
   * a ref keeps the listing from re-running every few seconds. Only the machine
   * id decides which machine is listed, and that is fixed for this screen.
   */
  const machineRef = useRef(machine);
  machineRef.current = machine;

  const loadPorts = useCallback(async (isRefresh: boolean): Promise<void> => {
    const request = ++listingRequestRef.current;
    const isCurrent = () => listingRequestRef.current === request;
    setDetailsError(null);
    setInspecting(false);
    const target = machineRef.current;
    if (target === undefined) {
      setListing({ kind: 'failed', message: WebPreviewCopy.machineMissing });
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setListing({ kind: 'loading' });
    try {
      const ports = await fetchRemotePorts(target);
      if (!isCurrent()) return;
      setListing({ kind: 'loaded', ports });
      setRefreshing(false);
      if (ports.length > 0) {
        setInspecting(true);
        try {
          const enriched = await fetchRemotePorts(target, true);
          if (isCurrent()) setListing({ kind: 'loaded', ports: enriched });
        } catch {
          if (isCurrent()) setDetailsError('Could not read page details. You can still open a port or refresh to try again.');
        } finally {
          if (isCurrent()) setInspecting(false);
        }
      }
    } catch (error) {
      if (!isCurrent()) return;
      setListing({
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadPorts(false);
    return () => { listingRequestRef.current += 1; };
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
    setAddressText((current) => (current.length === 0 ? String(rememberedPort) : current));
  }, [rememberedPort]);

  const openPort = useCallback(
    (entry: RemoteListeningPort): void => {
      navigation.navigate('WebPreview', { machineId: route.params.machineId, remotePort: entry.port, scheme: entry.web?.scheme ?? 'http' });
    },
    [navigation, route.params.machineId]
  );

  const submitAddress = useCallback((): void => {
    const url = parseAddressInput(addressText);
    if (url === null) {
      setAddressError(WebPreviewCopy.invalidAddress);
      return;
    }
    setAddressError(null);
    const target = webPreviewTargetForUrl(url);
    navigation.navigate('WebPreview', target === null
      ? { machineId: route.params.machineId, url }
      : { machineId: route.params.machineId, ...target });
  }, [navigation, route.params.machineId, addressText]);

  const addressValid = parseAddressInput(addressText) !== null;
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
            value={addressText}
            onChangeText={(value) => {
              prefilledRef.current = true;
              setAddressText(value);
              setAddressError(null);
            }}
            onSubmitEditing={submitAddress}
            placeholder={WebPreviewCopy.manualPlaceholder}
            placeholderTextColor={GhostexPalette.MUTED}
            keyboardType='url'
            selectTextOnFocus
            autoCapitalize='none'
            autoCorrect={false}
            spellCheck={false}
            returnKeyType='go'
            submitBehavior='blurAndSubmit'
            accessibilityLabel={WebPreviewCopy.manualSection}
          />
          <Pressable
            accessibilityRole='button'
            accessibilityState={{ disabled: !addressValid }}
            disabled={!addressValid}
            onPress={submitAddress}
            style={[styles.openButton, !addressValid && styles.openButtonDisabled]}
          >
            <Text style={styles.openButtonLabel}>{WebPreviewCopy.openButton}</Text>
          </Pressable>
        </View>
        {addressError === null ? (
          <Text style={styles.hint}>{WebPreviewCopy.manualHint}</Text>
        ) : (
          <View accessibilityRole='alert' style={styles.errorBanner}>
            <Text style={styles.errorBannerBody}>{addressError}</Text>
          </View>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>{WebPreviewCopy.listeningSection}{listedPorts.length > 0 ? ` (${listedPorts.length})` : ''}</Text>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={WebPreviewCopy.refreshButton}
            onPress={() => void loadPorts(true)}
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

        {inspecting ? (
          <View style={styles.pendingRow}>
            <ActivityIndicator size='small' color={GhostexPalette.ACCENT} />
            <Text style={styles.pendingLabel}>Reading page titles and icons…</Text>
          </View>
        ) : null}
        {detailsError ? <Text style={styles.hint}>{detailsError}</Text> : null}
        {listedPorts.length > 0 ? <PortSections ports={listedPorts} onOpen={openPort} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
