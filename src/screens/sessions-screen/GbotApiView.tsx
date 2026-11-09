/**
 * GBot Settings > Bot API on the phone: whether an app or script may message the GBot with a key, its key's use, New
 * key and the command to paste, with the key filled in once, right after it was made.
 *
 * CDXC:GBots 2026-11-09 DECISION: Coordinator brief (M11), on the user's behalf: GBot Settings has a "Bot API" section,
 * on the desktop, the web build and the phone, "showing the command to paste with the key filled in once". Turning it on
 * and New key ask for the user's approval (the phone's own approval card, or the computer's); the command waits for it.
 * SEE-ALSO: apps/desktop/src/app/window/gbot_settings_modal/bot_api.rs (the desktop tab), server/src/gbots/api/.
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { SwitchRow } from '../../components/common/SwitchRow';
import { gbotApiWhen, type GbotApi } from '../../contract/gbotApi';
import { GhostexStrokeWidth } from '../../theme/palette';
import { useGbotFormStyles } from './GbotFormParts';

export type GbotApiVerb = 'on' | 'new-key' | 'off' | 'share-memory-on' | 'share-memory-off';

export type GbotApiViewProps = {
  name: string;
  load: () => Promise<GbotApi>;
  /** Runs `verb` and answers the API as it is afterwards (the key in it after `on` and `new-key`). */
  act: (verb: GbotApiVerb) => Promise<GbotApi>;
};

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export default function GbotApiView(props: GbotApiViewProps): ReactElement {
  const { appearance, styles: form } = useGbotFormStyles();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        box: {
          marginTop: 14,
          borderRadius: 8,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.card,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 8,
        },
        row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
        label: { color: appearance.foreground, fontSize: 14, flexShrink: 1 },
        small: { color: appearance.muted, fontSize: 12.5, lineHeight: 17 },
        heading: { color: appearance.foreground, fontSize: 14, fontWeight: '600', marginTop: 16 },
        code: {
          borderRadius: 7,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.input,
          paddingHorizontal: 10,
          paddingVertical: 8,
        },
        codeText: { color: appearance.foreground, fontFamily: MONO, fontSize: 11.5, lineHeight: 16 },
        buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        button: {
          borderRadius: 7,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.input,
          paddingHorizontal: 12,
          paddingVertical: 6,
        },
        buttonLabel: { color: appearance.foreground, fontSize: 13 },
        disabled: { opacity: 0.5 },
      }),
    [appearance],
  );
  const [api, setApi] = useState<GbotApi | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<GbotApiVerb | null>(null);
  const [copied, setCopied] = useState<'command' | 'key' | null>(null);

  useEffect(() => {
    let cancelled = false;
    props.load().then(
      (loaded) => {
        if (cancelled) return;
        setApi(loaded);
        if (loaded.key.length > 0) setKey(loaded.key);
      },
      (loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      },
    );
    return () => {
      cancelled = true;
    };
    // Read once per opening of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = useCallback(
    (verb: GbotApiVerb) => {
      if (busy !== null) return;
      setBusy(verb);
      setError(null);
      setCopied(null);
      props.act(verb).then(
        (after) => {
          setApi(after);
          setKey(after.key.length > 0 ? after.key : verb === 'off' ? '' : key);
          setBusy(null);
        },
        (actError: unknown) => {
          setError(actError instanceof Error ? actError.message : String(actError));
          setBusy(null);
        },
      );
    },
    [busy, key, props],
  );

  const copy = (what: 'command' | 'key', value: string): void => {
    void Clipboard.setStringAsync(value);
    setCopied(what);
  };

  if (api === null) {
    return error === null ? (
      <ActivityIndicator style={form.loading} color={appearance.muted} />
    ) : (
      <Text style={form.error}>{error}</Text>
    );
  }
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled ? styles.disabled : null]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
  const switchLabel = `Apps may message ${props.name}`;
  const used =
    api.lastUsedAt.length > 0
      ? `last used ${gbotApiWhen(api.lastUsedAt)} (${api.uses} calls)`
      : 'not used yet';
  return (
    <View>
      <Text style={form.hint}>
        {`Let an app or script message ${props.name} with a key and get its reply. It stays off until you turn it on, and turning it on asks for your approval.`}
      </Text>
      {error !== null ? <Text style={form.error}>{error}</Text> : null}
      <View style={styles.box}>
        <SwitchRow
          value={api.on}
          onValueChange={(next) => act(next ? 'on' : 'off')}
          disabled={busy !== null}
          label={switchLabel}
          style={styles.row}
        >
          <Text style={styles.label}>{switchLabel}</Text>
          <Switch value={api.on} disabled={busy !== null} onValueChange={(next) => act(next ? 'on' : 'off')} />
        </SwitchRow>
        {api.on ? (
          <SwitchRow
            value={api.shareMemory}
            onValueChange={(next) => act(next ? 'share-memory-on' : 'share-memory-off')}
            disabled={busy !== null}
            label={`Apps may read ${props.name}'s memory`}
            style={styles.row}
          >
            <Text style={styles.label}>{`Apps may read ${props.name}'s memory`}</Text>
            <Switch
              value={api.shareMemory}
              disabled={busy !== null}
              onValueChange={(next) => act(next ? 'share-memory-on' : 'share-memory-off')}
            />
          </SwitchRow>
        ) : null}
        {api.on ? (
          <View style={styles.row}>
            <Text style={[styles.small, { flexShrink: 1 }]}>{`Made ${gbotApiWhen(api.createdAt)} · ${used}`}</Text>
            {button('New key', () => act('new-key'), busy !== null)}
          </View>
        ) : null}
      </View>
      {busy === 'on' || busy === 'new-key' || busy === 'share-memory-on' ? (
        <Text style={[styles.small, { marginTop: 8 }]}>Waiting for your approval on this phone or your computer…</Text>
      ) : null}
      {api.on ? (
        <>
          <Text style={styles.heading}>{key.length > 0 ? 'Copy the key now' : 'Send a message'}</Text>
          <View style={[styles.box, { marginTop: 8 }]}>
            <ScrollView horizontal style={styles.code}>
              <Text selectable style={styles.codeText}>
                {key.length > 0 ? api.command.replace('<your GBot API key>', key) : api.command}
              </Text>
            </ScrollView>
            <View style={styles.buttons}>
              {button(copied === 'command' ? 'Copied' : 'Copy command', () =>
                copy('command', key.length > 0 ? api.command.replace('<your GBot API key>', key) : api.command),
              )}
              {key.length > 0 ? button(copied === 'key' ? 'Copied' : 'Copy key', () => copy('key', key)) : null}
            </View>
          </View>
          <Text style={[styles.small, { marginTop: 8 }]}>
            {key.length > 0
              ? 'Ghostex shows this key once and keeps only its fingerprint. Lost it? New key makes another, and the old one stops working.'
              : 'The key was shown once, when it was made. New key makes another, and the old one stops working.'}
          </Text>
        </>
      ) : null}
      <Text style={styles.heading}>Who can reach it</Text>
      <Text style={[styles.small, { marginTop: 4 }]}>{api.reach}</Text>
      <Text style={[styles.small, { marginTop: 4 }]}>
        {`A message from an app is information, never your instructions: ${props.name}'s chats for apps start in their own folder, can't read your secret folders or Ghostex's own files, don't read its memory unless you let them, never save to it, and only you answer what they wait on.`}
      </Text>
    </View>
  );
}
