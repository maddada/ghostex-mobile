/**
 * The terminal notice card: a state the agent's terminal is stuck in (a trust prompt, an expired
 * login, a usage limit, a dialog), with the choices that answer it. Drawn from `terminalNotice`
 * and `noticeVisible`; port of desktop `notice.rs` and `terminal_dialog.rs`.
 *
 * The "Show terminal output" disclosure is not drawn: React and desktop hide it in chats narrower
 * than 1070px, which every phone is.
 *
 * CDXC:SessionChat 2026-10-11 DECISION: User picked the proposed notices design: a notice is a tone card (ToneCard.tsx) washed in
 * the tone the chat core gives it, with its actions in the footer (the account switch first and filled, Terminal view beside it,
 * Dismiss quiet at the right end). The `/resume` picker, pass-through and side-question cards keep their own shells.
 * SEE-ALSO: apps/desktop/src/app/native_chat/notice.rs, packages/gx-chat-core/src/questions/notice_tone.rs
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import { useChatViewSize } from '../chatPlacement';
import type { RustChat } from '../../rust/useRustChat';
import { phoneKeepsCancel } from './dialogCancel';
import { foldedNoticeChoices } from './answers';
import { arr, asJson, isTrue, num, obj, str } from './json';
import { MONO_FONT, themedStyles, useTranscriptTheme } from '../transcript/theme';
import {
  CARD_TEXT_SIZE,
  CHOICE_ROW_CHROME,
  ChoiceRow,
  ChoiceRowLabelMeasure,
  useCardText,
  useWellStyle,
} from './primitives';
import { Glyph } from './icons';
import { DetailsToggle } from './DetailsToggle';
import { AutoBlockLine, PendingAnswerNote, ToneButton, ToneCard, dimPending } from './ToneCard';
import { PanelBlocks } from './PanelBlocks';
import { PermissionDetails } from './PermissionDetails';
import { SideAnswer, SideQuestionCard } from './SideQuestionCard';
import { PassthroughCard, TerminalPickerCard } from './TerminalPickerCard';
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
  const { height } = useChatViewSize();
  const notice = obj(document.terminalNotice);
  const key = `notice:${str(notice, 'kind')}:${str(notice, 'detectedAt')}`;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [moreKey, setMoreKey] = useState<string | null>(null);
  const [choiceWidths, setChoiceWidths] = useState<Record<string, number>>({});
  const dialogInput = useDialogInput(obj(notice?.dialog));
  if (notice === null || document.noticeVisible !== true) return null;

  // An answered approval waits here, dimmed and held, until its prompt is gone (the chat core's questions/pending_approval.rs).
  const pending = document.approvalPending?.card === 'notice';
  const busy = document.questionCard?.busy === true || pending;
  const choices = arr(notice.choices);
  const answerable = choices.length > 0;
  const dialog = obj(notice.dialog);
  // A tabbed Claude panel with option rows (`/plugin`'s install scope) shows its details above the rows and never folds them
  // away (notice.rs, terminal_prompts.rs `highlighted_row`).
  const panel = arr(obj(dialog?.presentation)?.blocks).length > 0;
  // A live dialog's rows are numbered choices that open with the card (`dialog_rows.rs` in the chat core).
  const numbered = notice?.numbered === true;
  const foldedChoices = foldedNoticeChoices(notice);
  const foldable = foldedChoices !== null;
  const collapsed = foldable && expandedKey !== key;
  const rateLimit = choices.some((choice) => str(choice, 'label').startsWith('Wait here, then continue automatically'));

  if (obj(obj(dialog?.presentation)?.picker) !== null) {
    return <TerminalPickerCard chat={chat} document={document} notice={notice} />;
  }
  if (obj(notice.passthrough) !== null) {
    return <PassthroughCard chat={chat} document={document} notice={notice} onHostAction={onHostAction} />;
  }
  if (dialog !== null && !numbered && Array.isArray(dialog.rows) && dialog.rows.length === 0) {
    if (obj(obj(dialog.presentation)?.sideQuestion) !== null) {
      return <SideQuestionCard chat={chat} dialog={dialog} />;
    }
    const copyTitle = str(obj(obj(dialog.presentation)?.copy), 'title');
    const panelTitle = str(obj(dialog.presentation), 'title');
    const parts = terminalDialogParts(chat, dialog, busy, dialogInput, look);
    // "Ready to code?" with "Tell Claude what to change" highlighted: the plan the feedback is about stays readable
    // above the field (notice.rs).
    const feedbackPlan = obj(notice.plan);
    // A refused answer says why, and the card can then be closed (`dismiss_notice` in the chat core).
    const refusal =
      typeof document.noticeError === 'string'
        ? [
            <Text key="error" accessibilityRole="alert" style={cardText.prose}>
              {document.noticeError}
            </Text>,
          ]
        : [];
    return (
      <ToneCard
        tone={str(notice, 'tone')}
        title={copyTitle || panelTitle || str(dialog, 'title')}
        body={
          feedbackPlan === null
            ? [...parts.body, ...refusal]
            : [
                <SideAnswer
                  key={`plan:${key}`}
                  dispatch={dispatch}
                  markdown={str(feedbackPlan, 'markdown')}
                  references={asJson(feedbackPlan.references)}
                />,
                ...parts.body,
                ...refusal,
              ]
        }
        footerEnd={
          refusal.length > 0
            ? [
                ...parts.actions,
                <ToneButton
                  key="dismiss"
                  kind="secondary"
                  label="Dismiss"
                  onPress={() => dispatch({ type: 'dismissNotice' })}
                />,
              ]
            : parts.actions
        }
      />
    );
  }

  const body: ReactNode[] = [];
  // The notice's own actions sit at the footer's right end, ahead of a live dialog's buttons and Dismiss.
  const actions: ReactNode[] = [];
  const footerEnd: ReactNode[] = [];
  if (panel && !rateLimit && dialog !== null) {
    const parts = terminalDialogParts(chat, dialog, busy, dialogInput, look);
    body.push(...parts.body);
    footerEnd.push(...parts.actions);
  }
  // A permission prompt read whole (`approval` in the chat core) says what it asks itself (notice.rs).
  const approval = obj(notice.approval);
  if (approval !== null) {
    body.push(
      <PermissionDetails
        key="permission"
        approval={approval}
        collapsed={collapsed}
        onExpand={() => setExpandedKey(key)}
      />,
    );
    const autoBlockAt = str(notice, 'autoBlockAt');
    if (autoBlockAt.length > 0) body.push(<AutoBlockLine key="auto-block" at={autoBlockAt} />);
  }
  // The plan "Ready to code?" asks to approve, whole: Claude's pane shows only a screenful of it (`plan` in the chat core's
  // questions/document.rs; desktop notice.rs).
  const plan = obj(notice.plan);
  if (!collapsed && plan !== null) {
    body.push(
      <SideAnswer
        key={`plan:${key}`}
        dispatch={dispatch}
        markdown={str(plan, 'markdown')}
        references={asJson(plan.references)}
      />,
    );
  }
  if (!collapsed && !panel && approval === null && typeof notice.detail === 'string') {
    body.push(
      <Text key="detail" style={cardText.prose}>
        {notice.detail}
      </Text>,
    );
  }
  // The command a collapsed approval card is asking to run (`collapsedDetail` in the chat core).
  if (collapsed && typeof notice.collapsedDetail === 'string') {
    body.push(
      <Text key="collapsed-detail" style={styles.monoText}>
        {notice.collapsedDetail}
      </Text>,
    );
  }
  // The terminal's own words (`details`) and what a failed start printed (`errorLines`), behind Details (notice.rs).
  if (!collapsed && (typeof notice.details === 'string' || typeof notice.errorLines === 'string')) {
    body.push(<DetailsToggle key={`details:${key}`} lines={[notice.details, notice.errorLines]} />);
  }
  if (answerable && numbered) {
    const moreOpen = moreKey === key;
    const more = obj(notice.more);
    body.push(
      <ScrollView
        key="choices"
        style={{ maxHeight: height * (panel ? 0.3 : 0.45) }}
        contentContainerStyle={styles.choicesColumn}
        nestedScrollEnabled
      >
        {choices
          .filter((choice) => moreOpen || obj(choice)?.folded !== true)
          .map((choice, index) => (
            <DialogChoiceRow
              key={`${num(choice, 'index') ?? index}`}
              choice={obj(choice) ?? {}}
              disabled={busy}
              regularLabel={rateLimit}
              onPress={() => dispatch({ type: 'answer', answer: asJson(obj(choice)?.answer) })}
            />
          ))}
        {more !== null && !moreOpen ? (
          <DialogChoiceRow
            key="more"
            choice={{ title: str(more, 'label'), detail: str(more, 'detail') }}
            regularLabel={rateLimit}
            onPress={() => setMoreKey(key)}
          />
        ) : null}
      </ScrollView>,
    );
  } else if (answerable) {
    /*
     * CDXC:SessionChat 2026-10-28 DECISION: a folded card shows the rows the chat core names in `collapsedChoices` (the Cmd+Enter
     * row and the No, Q706), so a permission prompt folds to Yes and No; each row keeps its own answer. A native core from before
     * that field (an over-the-air update on an older build) still sends `collapsedChoiceCount`, the first rows.
     * SEE-ALSO: packages/gx-chat-core/src/questions/notice_choices.rs (collapsed_choice_positions)
     */
    const shownChoices = collapsed ? (foldedChoices ?? []) : choices;
    const labels = shownChoices.map((choice) => str(choice, collapsed ? 'collapsedLabel' : 'label'));
    /*
     * CDXC:SessionChat 2026-09-27 DECISION: User: when a notice card's choices do not fit side by side, "make buttons appear full
     * width and on top of each other", for every card like the model switch confirmation. Each collapsed button starts at the width
     * the widest label needs on one line and the row wraps, so the buttons share the row in equal halves only when every label fits
     * whole, and otherwise stack full width. Until the labels are measured they sit side by side as before.
     * SEE-ALSO: apps/desktop/src/app/native_chat/notice.rs
     */
    const widths = labels.map((label) => choiceWidths[label]);
    const widest = collapsed && widths.every((width) => width !== undefined) ? Math.max(...(widths as number[])) : null;
    const stacked = widest !== null && !Number.isFinite(widest);
    const choiceStyle =
      !collapsed || stacked
        ? null
        : widest === null
          ? styles.collapsedChoice
          : { flexGrow: 1, flexShrink: 1, flexBasis: widest + CHOICE_ROW_CHROME, minWidth: 0 };
    body.push(
      <ScrollView
        key="choices"
        style={{ maxHeight: height * 0.45 }}
        contentContainerStyle={collapsed && !stacked ? styles.choicesRow : styles.choicesColumn}
        nestedScrollEnabled
      >
        {collapsed
          ? labels.map((label, index) => (
              <ChoiceRowLabelMeasure
                key={`measure:${index}`}
                label={label}
                onWidth={(width) =>
                  setChoiceWidths((previous) =>
                    previous[label] === width ? previous : { ...previous, [label]: width },
                  )
                }
              />
            ))
          : null}
        {shownChoices.map((choice, index) => (
          <View key={`${num(choice, 'index') ?? index}`} style={choiceStyle}>
            {/* CDXC:SessionChat 2026-09-26 DECISION: User: a notice card's choice must never wrap onto 2 lines; truncate it with "..." and show the whole label on hover. The phone has no hover, so pressing and holding shows it. SEE-ALSO: apps/desktop/src/app/native_chat/notice.rs */}
            <ChoiceRow
              label={str(choice, collapsed ? 'collapsedLabel' : 'label')}
              selected={false}
              dense={collapsed}
              singleLine
              disabled={busy}
              onPress={() => dispatch({ type: 'answer', answer: asJson(obj(choice)?.answer) })}
            />
          </View>
        ))}
      </ScrollView>,
    );
  }
  if (!collapsed && !rateLimit && !panel && dialog !== null) {
    const parts = terminalDialogParts(chat, dialog, busy, dialogInput, look);
    body.push(...parts.body);
    footerEnd.push(...parts.actions);
    // No Esc key on a phone: a numbered dialog with no "No" row keeps a way out (dialogCancel.ts).
    if (phoneKeepsCancel(notice)) {
      const dialogId = str(dialog, 'id');
      footerEnd.push(
        <ToneButton
          key="dialog-action:cancel"
          kind="secondary"
          label="Cancel"
          onPress={() =>
            dispatch({ type: 'answer', answer: { kind: 'terminalDialog', dialogId, dialogAction: 'cancel' } })
          }
        />,
      );
    }
  }
  // Only sign-in and usage-limit notices offer the account panel (notice.rs).
  const kind = str(notice, 'kind');
  if (
    !collapsed &&
    obj(document.accountPanel) !== null &&
    (kind === 'loginExpired' || kind === 'usageLimit') &&
    onHostAction
  ) {
    actions.push(
      <ToneButton
        key="switch-account"
        kind="primary"
        icon="switch-horizontal"
        label="Switch account"
        onPress={() => onHostAction('switchAccount')}
      />,
    );
  }
  for (const action of arr(notice.actions)) {
    if (collapsed && str(action, 'kind') !== 'trustAndRemember') continue;
    if (str(action, 'kind') === 'switchToTerminal') {
      if (onHostAction) {
        actions.push(
          <ToneButton
            key={`action:${str(action, 'id')}`}
            kind="secondary"
            icon="terminal-2"
            label="Terminal view"
            onPress={() => onHostAction('terminalView')}
          />,
        );
      }
      continue;
    }
    // The first action the chat answers itself is the one filled button when no account switch took that place.
    actions.push(
      <ToneButton
        key={`action:${str(action, 'id')}`}
        kind={actions.length === 0 ? 'primary' : 'secondary'}
        label={str(action, 'label')}
        onPress={() => dispatch({ type: 'answer', answer: asJson(obj(action)?.answer) })}
      />,
    );
  }
  // A card with rows or a dialog is answered, not closed, until an answer on it is refused (`dismiss_notice` in the
  // chat core's questions/actions.rs, GitHub #458).
  if (
    ((notice.choices === null || notice.choices === undefined) &&
      (notice.dialog === null || notice.dialog === undefined)) ||
    typeof document.noticeError === 'string'
  ) {
    footerEnd.push(
      <ToneButton key="dismiss" kind="secondary" label="Dismiss" onPress={() => dispatch({ type: 'dismissNotice' })} />,
    );
  }
  if (typeof document.noticeError === 'string') {
    body.push(
      <Text key="error" accessibilityRole="alert" style={cardText.prose}>
        {document.noticeError}
      </Text>,
    );
  }
  return (
    <ToneCard
      tone={str(notice, 'tone')}
      title={
        approval !== null
          ? str(approval, 'title')
          : (panel && str(obj(dialog?.presentation), 'title')) || str(notice, 'title')
      }
      detail={approval !== null ? str(approval, 'source') : undefined}
      trailing={
        foldable ? (
          <Glyph name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} color={look.P.muted} />
        ) : undefined
      }
      body={dimPending(body, pending)}
      footerStart={
        pending
          ? [<PendingAnswerNote key="pending" words={document.approvalPending?.sending ?? 'Sending…'} />]
          : numbered
            ? [
                <Text key="number-hint" style={styles.numberHint}>
                  Tap a row to pick it
                </Text>,
              ]
            : undefined
      }
      footerEnd={[...actions, ...footerEnd]}
      accessibilityLabel={collapsed ? 'Show all options' : 'Show less'}
      onPressHeader={foldable ? () => setExpandedKey(collapsed ? key : null) : undefined}
    />
  );
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
  { styles, P, cardText, wellStyle }: DialogLook,
): { body: ReactNode[]; actions: ReactNode[] } {
  const { dispatch } = chat;
  const dialogId = str(dialog, 'id');
  const body: ReactNode[] = [];
  const actions: ReactNode[] = [];
  if (dialogId === 'codex-transcript-pager') {
    body.push(
      <Text key="pager" style={cardText.prose}>
        {str(dialog, 'body')}
      </Text>,
    );
    actions.push(
      <ToneButton
        key="restore"
        kind="primary"
        label={busy ? 'Restoring chat…' : 'Restore chat'}
        onPress={() =>
          dispatch({ type: 'answer', answer: { kind: 'terminalDialog', dialogId, dialogAction: 'cancel' } })
        }
      />,
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
        </Text>,
      );
    });
  } else if (arr(presentation?.blocks).length > 0) {
    body.push(<PanelBlocks key="blocks" chat={chat} dialog={dialog} blocks={arr(presentation?.blocks)} />);
  } else if (!hasRows && str(dialog, 'body').length > 0) {
    body.push(
      <View key="dialog-body" style={[wellStyle, styles.dialogBody]}>
        <ScrollView nestedScrollEnabled>
          <Text style={styles.monoText}>{str(dialog, 'body')}</Text>
        </ScrollView>
      </View>,
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
      />,
    );
    // Beside numbered rows the labelled Confirm is the one filled button (terminal_dialog.rs).
    actions.push(
      <ToneButton
        key="submit"
        kind={search && hasRows ? 'secondary' : 'primary'}
        label={search ? 'Search' : str(presentation, 'submitLabel')}
        onPress={submit}
      />,
    );
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
          dispatch({
            type: 'answer',
            answer: { kind: 'terminalDialog', dialogId, dialogAction: 'key', text, keyModifiers: 0 },
          });
        }}
      />,
    );
  }
  // Written copy and blocks come with buttons for everything the key-hint footer says, and numbered rows with their own hint.
  if (copy === null && !hasRows && arr(presentation?.blocks).length === 0 && str(dialog, 'footer').length > 0) {
    body.push(
      <Text key="footer" style={cardText.prose}>
        {str(dialog, 'footer')}
      </Text>,
    );
  }
  for (const action of arr(presentation?.actions)) {
    actions.push(
      <ToneButton
        key={`dialog-action:${str(action, 'action')}`}
        // The labelled Confirm says what Enter picks, so it is the card's filled button (terminal_dialog.rs).
        kind={hasRows && str(action, 'action') === 'confirm' ? 'primary' : 'secondary'}
        label={str(action, 'label')}
        onPress={() =>
          dispatch({
            type: 'answer',
            answer: { kind: 'terminalDialog', dialogId, dialogAction: asJson(obj(action)?.action) },
          })
        }
      />,
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

/**
 * One numbered row of a live terminal dialog (option D, `dialog_rows.rs` in the chat core; desktop `dialog_choice`): the
 * question card's row sizes with the number at the start, filled on the row the terminal highlights, the name on one line
 * (whole while held), a muted suffix and detail, and the row's stats at the end. A row without a number is "More".
 */
function DialogChoiceRow({
  choice,
  disabled,
  regularLabel,
  onPress,
}: {
  choice: Record<string, unknown>;
  disabled?: boolean;
  regularLabel?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [revealed, setRevealed] = useState(false);
  const highlighted = choice.highlighted === true;
  const number = num(choice, 'number');
  const suffix = str(choice, 'suffix');
  const detail = str(choice, 'detail');
  const meta = str(choice, 'meta');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={str(choice, 'title')}
      accessibilityState={{ selected: highlighted, disabled: disabled === true }}
      disabled={disabled === true}
      onPress={onPress}
      onLongPress={() => setRevealed(true)}
      onPressOut={() => setRevealed(false)}
      style={({ pressed }) => [
        styles.dialogRow,
        P.light && { backgroundColor: P.background },
        highlighted && styles.dialogRowHighlighted,
        disabled === true && { opacity: 0.6 },
        pressed && { backgroundColor: P.pressedFill },
      ]}
    >
      <View style={[styles.dialogRowNumber, highlighted && styles.dialogRowNumberHighlighted]}>
        <Text style={[styles.dialogRowNumberText, highlighted && { color: P.background }]}>
          {number === null ? '⋯' : String(number)}
        </Text>
      </View>
      <View style={styles.dialogRowText}>
        <View style={styles.dialogRowTitleLine}>
          <Text
            style={[styles.dialogRowTitle, regularLabel && styles.dialogRowTitleRegular]}
            {...(revealed ? {} : { numberOfLines: 1, ellipsizeMode: 'tail' as const })}
          >
            {str(choice, 'title')}
          </Text>
          {suffix.length > 0 ? <Text style={styles.dialogRowSuffix}>{suffix}</Text> : null}
          {choice.ticked === true ? <Glyph name="check" size={14} color={P.controlPrimary} /> : null}
        </View>
        {detail.length > 0 ? <Text style={styles.dialogRowDetail}>{detail}</Text> : null}
      </View>
      {meta.length > 0 ? (
        <Text style={styles.dialogRowMeta} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

const useStyles = themedStyles((P) => ({
  dialogRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.controlBorder,
  },
  dialogRowHighlighted: {
    borderColor: P.selectedBorder,
    backgroundColor: P.selectedFill,
  },
  dialogRowNumber: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: P.controlBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogRowNumberHighlighted: {
    backgroundColor: P.controlPrimary,
    borderColor: P.controlPrimary,
  },
  dialogRowNumberText: {
    color: P.cardMuted,
    fontSize: 11.5,
    fontWeight: '700',
  },
  dialogRowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  dialogRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  dialogRowTitle: {
    flexShrink: 1,
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: 19,
    fontWeight: '600',
  },
  // CDXC:SessionChat 2026-11-01 DECISION: User wants the usage limit choices at normal chat weight while the card title stays bold. Other numbered dialog choices keep their weight.
  dialogRowTitleRegular: {
    fontWeight: '400',
  },
  dialogRowSuffix: {
    color: P.cardMuted,
    fontSize: 12,
  },
  dialogRowDetail: {
    color: P.cardMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  dialogRowMeta: {
    maxWidth: 120,
    color: P.muted,
    fontSize: 12,
    lineHeight: 19,
  },
  numberHint: {
    color: P.muted,
    fontSize: 12.5,
  },
  choicesColumn: {
    gap: 6,
  },
  choicesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
