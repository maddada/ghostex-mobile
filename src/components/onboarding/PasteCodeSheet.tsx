/**
 * "Paste a pairing code" sheet (mobile-03-scan.html, `.paste-code-sheet`): a
 * monospace field validated on every keystroke with `readPairingCode`, a hint
 * that names the user and computer the code is for, and a Pair button. Also
 * the path the scanner opens directly when camera access is denied, with a
 * line explaining why.
 */

import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScanCopy } from '../../copy';
import { readPairingCode, type ReadPairingCodeResult } from '../../machines/pairingCodes';
import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import BottomSheet from '../common/BottomSheet';
import { CheckGlyph } from './SetupIcons';
import { SETUP_MONOSPACE, SetupButton, setupText } from './SetupPrimitives';

export type PasteCodeSheetProps = {
  visible: boolean;
  /** Shown above the field when the scanner could not use the camera. */
  cameraDenied: boolean;
  onClose: () => void;
  /** Called with a code that passed `readPairingCode`. */
  onCode: (code: Exclude<ReadPairingCodeResult, null>) => void;
};

function validityLine(parsed: ReadPairingCodeResult): string {
  if (parsed === null) return ScanCopy.paste.invalid;
  if (parsed.kind === 'easyConnect') {
    return ScanCopy.paste.validEasyConnect(parsed.code.user, parsed.code.name);
  }
  if (parsed.kind === 'tailscale') {
    return ScanCopy.paste.validTailscale(parsed.code.user, parsed.code.name);
  }
  return ScanCopy.paste.validLegacy;
}

export default function PasteCodeSheet({ visible, cameraDenied, onClose, onCode }: PasteCodeSheetProps) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text.trim().length === 0 ? null : readPairingCode(text)), [text]);
  const showHint = text.trim().length > 0;

  const submit = (): void => {
    if (parsed === null) return;
    setText('');
    onCode(parsed);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={setupText.title}>{ScanCopy.paste.title}</Text>
      {cameraDenied ? (
        <Text style={[setupText.small, styles.deniedLine]}>
          {ScanCopy.cameraDenied}{' '}
          <Text
            style={setupText.accent}
            onPress={() => void Linking.openSettings().catch(() => undefined)}
          >
            {ScanCopy.cameraDeniedSettingsLink}
          </Text>
        </Text>
      ) : null}
      <Text style={[setupText.lede, styles.lede]}>
        {ScanCopy.paste.ledePrefix}
        <Text style={setupText.strong}>{ScanCopy.paste.ledeStrong}</Text>
        {ScanCopy.paste.ledeSuffix}
      </Text>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          placeholder={ScanCopy.paste.placeholder}
          placeholderTextColor={SetupPalette.DIM}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoFocus
          value={text}
          onChangeText={setText}
        />
        {showHint ? (
          <View style={styles.hintRow}>
            {parsed !== null ? <CheckGlyph size={14} color={SetupPalette.OK} /> : null}
            <Text style={[styles.hint, parsed !== null ? styles.hintOk : styles.hintError]}>
              {validityLine(parsed)}
            </Text>
          </View>
        ) : null}
      </View>
      <SetupButton
        variant="primary"
        label={ScanCopy.paste.button}
        disabled={parsed === null}
        onPress={submit}
        style={styles.button}
      />
      <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.cancel}>
        <Text style={[setupText.small, setupText.dim, setupText.center]}>Cancel</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  deniedLine: {
    marginTop: 8,
    color: SetupPalette.WARN,
  },
  lede: {
    marginTop: 8,
  },
  field: {
    marginTop: 16,
    gap: 6,
  },
  input: {
    minHeight: 84,
    padding: 12,
    borderRadius: GhostexRadii.control,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER_STRONG,
    backgroundColor: SetupPalette.PAGE,
    color: SetupPalette.FOREGROUND,
    fontFamily: SETUP_MONOSPACE,
    fontSize: 13,
    lineHeight: 18,
    textAlignVertical: 'top',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hint: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  hintOk: {
    color: SetupPalette.OK,
  },
  hintError: {
    color: SetupPalette.ERROR,
  },
  button: {
    marginTop: 16,
  },
  cancel: {
    marginTop: 12,
    alignSelf: 'center',
  },
});
