/**
 * The terminal notice card: a state the agent's terminal is stuck in (a trust prompt, an expired
 * login, a usage limit, a dialog), with the choices that answer it. Drawn from `terminalNotice`
 * and `noticeVisible`; port of desktop `notice.rs` and `terminal_dialog.rs`.
 *
 * The "Show terminal output" disclosure is not drawn: React and desktop hide it in chats narrower
 * than 1070px, which every phone is.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import type { GlyphName } from './icons';
import { arr, asJson, isTrue, num, obj, str } from './json';
import { MONO_FONT, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { CARD_TEXT_SIZE, CardHeader, ChatButton, ChoiceRow, StatusCard, useCardText, useWellStyle } from './primitives';
import type { CardHostAction } from './types';

export function NoticeCard({
  chat,
  document,
  onHostAction,
}: {
  chat: RustChat;
  document: ChatDocument;
  onHostAction?: CardHostAction;
}) {
  const cardText = useCardText();
  const styles = useStyles();
  const look: DialogLook = { styles, P: useTranscriptTheme(), cardText, wellStyle: useWellStyle() };
  const { dispatch } = chat;
  const { height } = useWindowDimensions();
  const notice = obj(document.terminalNotice);
  const key = `notice:${str(notice, 'kind')}:${str(notice, 'detectedAt')}`;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const dialogInput = useDialogInput(obj(notice?.dialog));
  if (notice === null || document.noticeVisible !== true) return null;

  const busy = document.questionCard?.busy === true;
  const choices = arr(notice.choices);
  const answerable = choices.length > 0;
  const collapsed = answerable && expandedKey !== key;
  const dialog = obj(notice.dialog);
  const rateLimit = choices.some((choice) => str(choice, 'label').startsWith('Wait here, then continue automatically'));

  if (dialog !== null && Array.isArray(dialog.rows) && dialog.rows.length === 0) {
    const copyTitle = str(obj(obj(dialog.presentation)?.copy), 'title');
    return (
      <StatusCard
        header={<CardHeader icon="terminal-2" title={copyTitle || str(dialog, 'title')} />}
        {...terminalDialogParts(chat, dialog, busy, dialogInput, look)}
      />
    );
  }

  const body: ReactNode[] = [];
  const actions: ReactNode[] = [];
  if (!collapsed && typeof notice.detail === 'string') {
    body.push(
      <Text key="detail" style={cardText.prose}>
        {notice.detail}
      </Text>
    );
  }
  if (answerable) {
    const shown = collapsed ? (num(notice, 'collapsedChoiceCount') ?? 2) : choices.length;
    body.push(
      <ScrollView
        key="choices"
        style={{ maxHeight: height * 0.45 }}
        contentContainerStyle={collapsed ? styles.choicesRow : styles.choicesColumn}
        nestedScrollEnabled
      >
        {choices.slice(0, shown).map((choice, index) => (
          <View key={`${num(choice, 'index') ?? index}`} style={collapsed ? styles.collapsedChoice : null}>
            <ChoiceRow
              label={str(choice, collapsed ? 'collapsedLabel' : 'label')}
              selected={false}
              dense={collapsed}
              disabled={busy}
              onPress={() => dispatch({ type: 'answer', answer: asJson(obj(choice)?.answer) })}
            />
          </View>
        ))}
      </ScrollView>
    );
  }
  if (!collapsed && !rateLimit && dialog !== null) {
    const parts = terminalDialogParts(chat, dialog, busy, dialogInput, look);
    body.push(...parts.body);
    actions.push(...parts.actions);
  }
  // Only sign-in and usage-limit notices offer the account panel (notice.rs).
  const kind = str(notice, 'kind');
  if (!collapsed && obj(document.accountPanel) !== null && (kind === 'loginExpired' || kind === 'usageLimit') && onHostAction) {
    actions.push(
      <ChatButton key="switch-account" icon="switch-horizontal" label="Switch account" onPress={() => onHostAction('switchAccount')} />
    );
  }
  for (const action of arr(notice.actions)) {
    if (collapsed && str(action, 'kind') !== 'trustAndRemember') continue;
    if (str(action, 'kind') === 'switchToTerminal') {
      if (onHostAction) {
        actions.push(
          <ChatButton key={`action:${str(action, 'id')}`} icon="terminal-2" label="Terminal View" onPress={() => onHostAction('terminalView')} />
        );
      }
      continue;
    }
    actions.push(
      <ChatButton
        key={`action:${str(action, 'id')}`}
        label={str(action, 'label')}
        onPress={() => dispatch({ type: 'answer', answer: asJson(obj(action)?.answer) })}
      />
    );
  }
  if ((notice.choices === null || notice.choices === undefined) && (notice.dialog === null || notice.dialog === undefined)) {
    actions.push(<ChatButton key="dismiss" label="Dismiss" onPress={() => dispatch({ type: 'dismissNotice' })} />);
  }
  if (typeof document.noticeError === 'string') {
    body.push(
      <Text key="error" accessibilityRole="alert" style={cardText.prose}>
        {document.noticeError}
      </Text>
    );
  }
  const severity = str(notice, 'severity');
  const icon: GlyphName = severity === 'error' ? 'alert-circle' : severity === 'warning' ? 'alert-triangle' : 'info-circle';
  const header = (
    <CardHeader
      icon={icon}
      title={str(notice, 'title')}
      chevron={answerable ? (collapsed ? 'closed' : 'open') : undefined}
      hasBody={body.length > 0}
      accessibilityLabel={collapsed ? 'Show all options' : 'Show less'}
      onPress={answerable ? () => setExpandedKey(collapsed ? key : null) : undefined}
    />
  );
  return <StatusCard header={header} body={body} actions={actions} />;
}

/** The themed styles a terminal dialog draws with, read by the card that owns it. */
type DialogLook = {
  styles: ReturnType<typeof useStyles>;
  P: ReturnType<typeof useTranscriptTheme>;
  cardText: ReturnType<typeof useCardText>;
  wellStyle: ReturnType<typeof useWellStyle>;
};

/** The body rows and footer actions of a terminal dialog (`render_terminal_dialog`). */
function terminalDialogParts(
  chat: RustChat,
  dialog: Record<string, unknown>,
  busy: boolean,
  [inputValue, setInputValue]: DialogInput,
  { styles, P, cardText, wellStyle }: DialogLook
): { body: ReactNode[]; actions: ReactNode[] } {
  const { dispatch } = chat;
  const dialogId = str(dialog, 'id');
  const body: ReactNode[] = [];
  const actions: ReactNode[] = [];
  if (dialogId === 'codex-transcript-pager') {
    body.push(
      <Text key="pager" style={cardText.prose}>
        {str(dialog, 'body')}
      </Text>
    );
    actions.push(
      <ChatButton
        key="restore"
        label={busy ? 'Restoring chat…' : 'Restore chat'}
        onPress={() => dispatch({ type: 'answer', answer: { kind: 'terminalDialog', dialogId, dialogAction: 'cancel' } })}
      />
    );
    return { body, actions };
  }
  const presentation = obj(dialog.presentation);
  const copy = obj(presentation?.copy);
  const hasRows = arr(dialog.rows).length > 0;
  if (copy !== null) {
    // Written copy reads as the card's prose, and its buttons already say what the keyboard hint would.
    arr(copy.paragraphs).forEach((paragraph, index) => {
      body.push(
        <Text key={`copy:${index}`} style={cardText.prose}>
          {typeof paragraph === 'string' ? paragraph : ''}
        </Text>
      );
    });
  } else if (!hasRows && str(dialog, 'body').length > 0) {
    body.push(
      <View key="dialog-body" style={[wellStyle, styles.dialogBody]}>
        <ScrollView nestedScrollEnabled>
          <Text style={styles.monoText}>{str(dialog, 'body')}</Text>
        </ScrollView>
      </View>
    );
  }
  const input = str(dialog, 'input');
  if (input === 'text' || input === 'search') {
    const search = input === 'search';
    const multiline = isTrue(presentation, 'multilineInput');
    const submit = () =>
      dispatch({
        type: 'answer',
        answer: { kind: 'terminalDialog', dialogId, dialogAction: search ? 'text' : 'submit', text: inputValue },
      });
    body.push(
      <TextInput
        key="input"
        style={[styles.dialogInput, multiline && styles.dialogInputMultiline]}
        value={inputValue}
        onChangeText={setInputValue}
        editable={!busy}
        multiline={multiline}
        maxLength={search ? 512 : 8192}
        submitBehavior="submit"
        returnKeyType={search ? 'search' : 'done'}
        onSubmitEditing={submit}
        placeholder={search ? 'Search options…' : 'Enter text…'}
        placeholderTextColor={P.placeholder}
      />
    );
    actions.push(<ChatButton key="submit" label={search ? 'Search' : str(presentation, 'submitLabel')} onPress={submit} />);
  }
  if (input === 'key') {
    body.push(
      <TextInput
        key="key"
        accessibilityLabel="Press the new shortcut"
        style={styles.keyInput}
        value=""
        placeholder="Tap here, then press the new shortcut"
        placeholderTextColor={P.muted}
        onKeyPress={(event) => {
          const pressed = event.nativeEvent.key;
          const text = pressed === ' ' ? ' ' : pressed;
          dispatch({ type: 'answer', answer: { kind: 'terminalDialog', dialogId, dialogAction: 'key', text, keyModifiers: 0 } });
        }}
      />
    );
  }
  if (copy === null && str(dialog, 'footer').length > 0) {
    body.push(
      <Text key="footer" style={cardText.prose}>
        {str(dialog, 'footer')}
      </Text>
    );
  }
  for (const action of arr(presentation?.actions)) {
    actions.push(
      <ChatButton
        key={`dialog-action:${str(action, 'action')}`}
        label={str(action, 'label')}
        onPress={() =>
          dispatch({ type: 'answer', answer: { kind: 'terminalDialog', dialogId, dialogAction: asJson(obj(action)?.action) } })
        }
      />
    );
  }
  return { body, actions };
}

type DialogInput = [string, (value: string) => void];

/**
 * The dialog's text field value. It follows the dialog's own `inputValue` whenever the terminal
 * reports a new one or a different dialog opens, and Submit sends what is typed.
 */
function useDialogInput(dialog: Record<string, unknown> | null): DialogInput {
  const identity = `${str(dialog, 'id')}:${str(dialog, 'title')}:${str(dialog, 'input')}`;
  const serverValue = str(dialog, 'inputValue');
  const [value, setValue] = useState(serverValue);
  useEffect(() => setValue(serverValue), [identity, serverValue]);
  return [value, setValue];
}

const useStyles = themedStyles((P) => ({
  choicesColumn: {
    gap: 6,
  },
  choicesRow: {
    flexDirection: 'row',
    gap: 6,
  },
  collapsedChoice: {
    flex: 1,
    minWidth: 0,
  },
  dialogBody: {
    maxHeight: 256,
    backgroundColor: P.light ? P.input : 'rgba(29,29,29,0.3)',
  },
  monoText: {
    color: P.cardMuted,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 17,
  },
  dialogInput: {
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    borderWidth: 1,
    borderColor: P.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: P.background,
  },
  dialogInputMultiline: {
    minHeight: 60,
    maxHeight: 140,
  },
  keyInput: {
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: 6,
    padding: 8,
  },
}));
