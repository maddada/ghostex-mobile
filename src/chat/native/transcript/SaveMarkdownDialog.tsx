/**
 * Save to Markdown (desktop `save_markdown/`): a reply's Save to md opens this dialog over the chat,
 * drawn from `document.saveMarkdown`. The folder and the file name are the core's (it suggests the
 * name from the session title and the project's Docs files, and validates both); the dialog reports
 * every edit (`markdownSaveFolder`, `markdownSaveName`) and Save (`markdownSaveSubmit`), and the core
 * writes the file into the project's Docs folder on the computer through gxserver. When it is saved
 * the screen copies the full path and says so (`markdownSaved`), as desktop does.
 *
 * CDXC:SessionChat 2026-09-25 WHY:
 * The file the dialog saves lives on the computer, like desktop's, so it shows up in Docs on both.
 * A phone also has its own place to keep a file, so the dialog adds Share, which hands the same
 * Markdown to the platform share sheet under the file name typed here: iOS shares a `.md` file
 * (Save to Files lives there), Android shares the text, because React Native's Share sends only
 * text on Android and the app ships no file-sharing module.
 */

import { File, Paths } from 'expo-file-system';
import { useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RustChat } from '../../rust/useRustChat';
import { useEchoedText } from '../cards/useEchoedText';
import { Glyph } from '../composer/icons';
import { isTrue, obj, str } from './json';
import { useSaveMarkdownSource } from './saveMarkdownStore';
import { useTranscriptTheme } from './theme';

const DESCRIPTION = 'Save this final response in the project Docs folder. Its full path will be copied after saving.';

/** Hands the Markdown to the platform share sheet as `<name>.md`. */
async function shareMarkdown(markdown: string, fileName: string): Promise<void> {
  const stem = fileName.trim().replace(/[\\/:*?"<>|]/gu, ' ').trim() || 'Saved response';
  const name = `${stem}.md`;
  if (Platform.OS === 'ios') {
    const file = new File(Paths.cache, name);
    file.create({ intermediates: true, overwrite: true });
    file.write(markdown);
    await Share.share({ url: file.uri, title: name });
    return;
  }
  await Share.share({ title: name, message: markdown }, { dialogTitle: name });
}

export function SaveMarkdownDialog({ chat }: { chat: RustChat }) {
  const theme = useTranscriptTheme();
  const markdown = useSaveMarkdownSource((store) => store.markdown);
  const state = obj(chat.state?.document?.saveMarkdown);
  // Every open is a new sheet: the echo bookkeeping restarts with it.
  const generation = useRef(0);
  const wasOpen = useRef(false);
  if (state !== null && !wasOpen.current) generation.current += 1;
  wasOpen.current = state !== null;
  const identity = String(generation.current);
  const { dispatch } = chat;
  const [folder, setFolder] = useEchoedText(identity, str(state, 'folder'), (value) =>
    dispatch({ type: 'markdownSaveFolder', value })
  );
  const [fileName, setFileName] = useEchoedText(identity, str(state, 'fileName'), (value) =>
    dispatch({ type: 'markdownSaveName', value })
  );
  if (state === null) return null;
  const saving = isTrue(state, 'saving');
  const unavailable = isTrue(state, 'loading') || str(state, 'listingError').length > 0;
  const folderError = str(state, 'folderError') || str(state, 'listingError');
  const nameError = str(state, 'fileNameError');
  const destructive = theme.light ? '#e7000b' : '#ff6467';
  const cancel = () => dispatch({ type: 'markdownSaveCancel' });
  const submit = () => {
    if (!saving && !unavailable) dispatch({ type: 'markdownSaveSubmit' });
  };
  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    error: string,
    affix: { prefix?: string; suffix?: string },
    options: { selectOnFocus: boolean; autoFocus: boolean; onSubmit?: () => void }
  ) => {
    const invalid = error.length > 0;
    return (
      <View style={styles.field}>
        <Text style={[styles.label, { color: invalid ? destructive : theme.foreground }]}>{label}</Text>
        <View
          style={[
            styles.input,
            {
              backgroundColor: theme.input,
              borderColor: invalid ? destructive : theme.inputBorder,
            },
          ]}
        >
          {affix.prefix !== undefined ? <Text style={[styles.affix, { color: theme.muted }]}>{affix.prefix}</Text> : null}
          <TextInput
            value={value}
            onChangeText={onChange}
            editable={!saving}
            accessibilityLabel={label}
            autoCapitalize='none'
            autoCorrect={false}
            autoFocus={options.autoFocus}
            selectTextOnFocus={options.selectOnFocus}
            returnKeyType={options.onSubmit !== undefined ? 'done' : 'next'}
            {...(options.onSubmit !== undefined ? { onSubmitEditing: options.onSubmit } : {})}
            style={[styles.inputText, { color: invalid ? destructive : theme.foreground }]}
          />
          {affix.suffix !== undefined ? <Text style={[styles.affix, { color: theme.muted }]}>{affix.suffix}</Text> : null}
        </View>
        {label === 'Folder' ? <Text style={[styles.hint, { color: theme.muted }]}>Use / to create nested folders.</Text> : null}
        {invalid ? <Text style={[styles.error, { color: destructive }]}>{error}</Text> : null}
      </View>
    );
  };
  const button = (label: string, onPress: () => void, disabled: boolean, primary: boolean, busy = false) => (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [
        styles.button,
        { borderColor: theme.border },
        pressed && !disabled && { backgroundColor: theme.input },
        disabled && styles.disabled,
      ]}
    >
      {busy ? <ActivityIndicator size='small' color={theme.foreground} /> : null}
      <Text style={[styles.buttonText, { color: theme.foreground }]}>{label}</Text>
      {primary ? <Glyph name='chevron-right' size={16} color={theme.primary} /> : null}
    </Pressable>
  );
  return (
    <Modal visible transparent animationType='fade' onRequestClose={cancel} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={saving ? undefined : cancel} accessibilityLabel='Cancel saving' />
          <View style={[styles.card, { backgroundColor: theme.light ? theme.background : '#191919' }]} accessibilityViewIsModal>
            <View style={styles.header}>
              <Text style={[styles.title, { color: theme.foreground }]}>Save to Markdown</Text>
              <Text style={[styles.description, { color: theme.muted }]}>{DESCRIPTION}</Text>
            </View>
            <ScrollView style={styles.fields} contentContainerStyle={styles.fieldsContent} keyboardShouldPersistTaps='handled'>
              {field('Folder', folder, setFolder, folderError, { prefix: '…/docs/' }, { selectOnFocus: false, autoFocus: false })}
              {field('File name', fileName, setFileName, nameError, { suffix: '.md' }, {
                selectOnFocus: isTrue(state, 'suggested'),
                autoFocus: true,
                onSubmit: submit,
              })}
            </ScrollView>
            {/* Desktop stacks its footer below 640px wide, the save action on top. */}
            <View style={styles.footer}>
              {button('Save to md', submit, saving || unavailable, true, saving || unavailable)}
              {markdown !== null
                ? button('Share', () => void shareMarkdown(markdown, fileName).catch(() => undefined), saving, false)
                : null}
              {button('Cancel', cancel, saving, false)}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.65)' },
  card: { width: 448, maxWidth: '100%', maxHeight: '100%', padding: 24, gap: 24, borderRadius: 14 },
  header: { gap: 6 },
  title: { fontSize: 16, lineHeight: 16, fontWeight: '500' },
  description: { fontSize: 14, lineHeight: 20 },
  fields: { flexGrow: 0 },
  fieldsContent: { gap: 28 },
  field: { gap: 12 },
  label: { fontSize: 14, lineHeight: 19.25, fontWeight: '500' },
  input: { flexDirection: 'row', alignItems: 'center', minHeight: 36, borderWidth: 1, paddingHorizontal: 10, gap: 4 },
  inputText: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: 6 },
  affix: { fontSize: 14, fontWeight: '500' },
  hint: { fontSize: 14, lineHeight: 21 },
  error: { fontSize: 14, lineHeight: 20 },
  footer: { gap: 8 },
  button: {
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonText: { fontSize: 14, fontWeight: '500' },
  disabled: { opacity: 0.5 },
});
