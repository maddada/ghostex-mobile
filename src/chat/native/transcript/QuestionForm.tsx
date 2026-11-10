/**
 * A question form an agent wrote as a ```questions block, drawn where the block sits in its reply:
 * every question at once, choices picked with a tap, a note or text box per question, and one Send
 * button. The rules (picks, Other, what is sent, the answered state) are the chat core's
 * (`questionForms`, packages/gx-chat-core/src/questions/forms.rs); this file only lays them out.
 *
 * CDXC:SessionChat 2026-10-11 SEE-ALSO:
 * Desktop draws the same form in apps/desktop/src/app/native_chat/question_form.rs; the grammar is
 * packages/gx-chat-core/src/transcript/question_forms.rs. Change them together.
 */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewInstance,
} from 'react-native';

import { useLaptopFold } from '../../../components/common/verticalBar/laptopFold';
import type { Json } from '../../rust/document';
import { useTranscriptEnv } from './context';
import { useRevealFocusedField } from './fieldReveal';
import { useEchoedText } from '../cards/useEchoedText';
import { AskCard, AskHead, AskOption, PrimaryButton, SoftButton, answeredColor, askColor } from '../cards/askCard';
import { arr, obj, str, type JsonRecord } from './json';
import { Glyph } from './icons';
import { SingleLinePill, SingleLineTile } from './singleLineCard';
import { MONO_FONT } from './theme';
import { LinkWords } from './LinkWords';
import { QuestionFlashFrame, useQuestionAnchor } from './OpenQuestions';
import GhostexImageIntakeView from '../../../../modules/ghostex-native/src/GhostexImageIntakeView';
import { imagesFromIntake } from '../composer/imageIntake';

/** The document's `questionForms`, by form id. */
const FormsContext = createContext<{ [id: string]: Json }>({});
export const QuestionFormsProvider = FormsContext.Provider;

/** One form's state from the document's `questionForms` (a one-click question's too, `InlineAnswers.tsx`). */
export function useQuestionFormState(id: string): JsonRecord | null {
  return obj(useContext(FormsContext)[id]);
}

/** What the footer says about the questions left blank, behind the (i) icon; desktop `SKIPPED_HINT` (ask_card.rs) says the same. */
const SKIPPED_HINT = 'Questions you leave blank are sent as skipped.';

const HINT_WIDTH = 236;

/** The (i) icon's width (`styles.info`). */
const INFO_ICON_ROOM = 20;

/**
 * A small (i) icon that shows `hint` in a bubble above it on a tap; a tap anywhere else closes it. Half folded like
 * a laptop a bubble that would reach into the fold's band from below it stands under the icon instead (hints keep
 * off the knick, as menus and sheets do).
 *
 * CDXC:SessionChat 2026-10-24 DECISION: User: "remove the text about skipped (add i icon there for that)". The footer's sentence wrapped into five lines beside the buttons on the phone, so the icon takes its place and the sentence shows on a tap (a hover tooltip on the computer, desktop `ask_info_hint` in ask_card.rs). Skip all and Send answers keep their size and place.
 */
function InfoHint({ hint }: { hint: string }) {
  const { theme } = useTranscriptEnv();
  const icon = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState<number | null>(null);
  const screen = useWindowDimensions();
  const fold = useLaptopFold();
  const close = () => {
    setAnchor(null);
    setBubbleHeight(null);
  };
  const left =
    anchor === null ? 0 : Math.max(12, Math.min(anchor.x + anchor.width / 2 - 24, screen.width - HINT_WIDTH - 12));
  const underIcon =
    anchor !== null &&
    fold !== null &&
    bubbleHeight !== null &&
    anchor.y - 8 > fold.top &&
    anchor.y - 8 - bubbleHeight < fold.bottom;
  return (
    <>
      <Pressable
        ref={icon}
        collapsable={false}
        accessibilityRole="button"
        accessibilityLabel={hint}
        hitSlop={12}
        onPress={() => icon.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }))}
        style={styles.info}
      >
        <Glyph name="info-circle" size={17} color={theme.muted} />
      </Pressable>
      {anchor === null ? null : (
        <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close the hint" />
          <View
            pointerEvents="none"
            onLayout={(event) => setBubbleHeight(event.nativeEvent.layout.height)}
            style={[
              styles.bubble,
              {
                left,
                ...(underIcon ? { top: anchor.y + anchor.height + 8 } : { bottom: screen.height - anchor.y + 8 }),
                backgroundColor: theme.light ? '#fefefe' : '#1d1d1d',
                borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.1)',
              },
            ]}
          >
            <Text style={[styles.bubbleText, { color: theme.foreground }]}>{hint}</Text>
          </View>
        </Modal>
      )}
    </>
  );
}

/**
 * The footer's leftover room, where the (i) icon sits. The buttons take their size first; when less than the icon's
 * width is left the icon goes, so the buttons stay on one line whatever the phone's width (it wraps only when the
 * buttons alone do not fit, as with the large-text setting).
 */
function InfoSlot() {
  const [room, setRoom] = useState<number | null>(null);
  return (
    <View style={styles.status} onLayout={(event) => setRoom(event.nativeEvent.layout.width)}>
      {room !== null && room >= INFO_ICON_ROOM ? <InfoHint hint={SKIPPED_HINT} /> : null}
    </View>
  );
}

function letter(index: number): string {
  return index < 26 ? String.fromCharCode(97 + index) : String(index + 1);
}

/** The form's own notes box's hint; desktop (question_form.rs) says the same. */
const NOTES_PLACEHOLDER = 'Anything else? (optional)';

function placeholder(question: JsonRecord | null, draft: JsonRecord | null): string {
  if (question?.text === true) return str(question, 'placeholder') || 'Your answer (optional)';
  return draft?.otherPicked === true ? 'What would you prefer instead? (optional)' : 'Note (optional)';
}

/** The form, outlined for a moment when the Previous question pill or a Q-tag link lands on it. */
export function QuestionForm({ id, source }: { id: string; source: string }) {
  const { theme } = useTranscriptEnv();
  // Asked by a work item too: drawn once, as its ask card (gx-chat-core work_cards.rs `card_tags`).
  if (useQuestionFormState(id)?.coveredByCard === true) return null;
  return (
    <QuestionFlashFrame target={id} light={theme.light}>
      <QuestionFormCard id={id} source={source} />
    </QuestionFlashFrame>
  );
}

/** The form's card; the Resources sheet draws it too (`ResourceSheet.tsx`). */
export function QuestionFormCard({ id, source }: { id: string; source: string }) {
  const { theme, dispatch } = useTranscriptEnv();
  const form = obj(useContext(FormsContext)[id]);
  if (form === null) {
    return <Text style={[styles.source, { color: theme.cardMuted }]}>{source}</Text>;
  }
  const phase = str(form, 'state');
  const enabled = phase === 'open';
  // Put off For later (gx-chat-core `questions/later.rs`): grey instead of the amber Waiting, and
  // still answerable; desktop question_form.rs.
  const later = form.later === true;
  // Removed without an answer (gx-chat-core `questions/later.rs`): it opens to be read, takes no answer.
  // Withdrawn by the agent (the Resources sheet shows it): the same, read-only look.
  const withdrawn = phase === 'withdrawn';
  const canceled = phase === 'canceled' || withdrawn;
  const error = str(form, 'error');
  const questions = arr(form.questions);
  // The form's state is a pill on the right, as "Answered" is once it folds (desktop question_form.rs).
  const detail =
    error.length > 0
      ? 'These questions could not be shown'
      : questions.length === 1
        ? '1 question'
        : `${questions.length} questions`;
  const state =
    error.length > 0 ? (
      <SingleLinePill label="Not shown" color={theme.error} />
    ) : (
      <SingleLinePill
        {...(phase === 'sending' ? {} : { icon: canceled ? ('x' as const) : ('clock' as const) })}
        label={
          phase === 'sending'
            ? 'Sending…'
            : phase === 'queued'
              ? 'Queued'
              : canceled
                ? withdrawn
                  ? 'Withdrawn'
                  : 'Canceled'
                : later
                  ? 'For later'
                  : 'Waiting'
        }
        color={later || canceled ? theme.muted : askColor(theme.light)}
      />
    );
  const drafts = arr(form.drafts);
  const questionViews = questions.map((question, index) => (
    <View key={index} style={index > 0 ? [styles.later, { borderTopColor: theme.ink(0.06) }] : undefined}>
      <FormQuestion
        formId={id}
        index={index}
        question={obj(question)}
        draft={obj(drafts[index])}
        otherLabel={str(form, 'otherLabel')}
        enabled={enabled}
        answered={phase === 'answered'}
      />
    </View>
  ));
  // The form's own notes box under the last question (the SessionChat 2026-10-14 DECISION in
  // packages/gx-chat-core/src/questions/forms.rs).
  const notes = str(form, 'notes');
  const body =
    form.takesNotes === true && (enabled || notes.trim().length > 0) ? (
      <>
        {questionViews}
        <View style={[styles.later, { borderTopColor: theme.ink(0.06) }]}>
          <FormNotes formId={id} notes={notes} enabled={enabled} />
        </View>
      </>
    ) : (
      questionViews
    );
  // An answered form is one line that opens the read-only form and closes it again; the core says
  // which (`collapsed`, the SessionChat 2026-10-12 DECISION in packages/gx-chat-core/src/questions/forms.rs).
  if (phase === 'answered' && error.length === 0) {
    const open = form.collapsed !== true;
    return (
      <AskCard
        singleLine
        head={
          <AskHead
            singleLine
            title={str(form, 'title') || 'Ghostex form'}
            trailing={<SingleLinePill icon="check" label="Answered" color={answeredColor(theme.light)} />}
            accessibilityLabel={open ? 'Hide the questions' : 'Show the questions'}
            onPress={() => dispatch({ type: 'formToggle', form: id })}
          />
        }
      >
        {open ? body : null}
      </AskCard>
    );
  }
  const head = (
    <AskHead
      lead={<SingleLineTile glyph="checklist" ring={theme.cardPanel} />}
      title={str(form, 'title') || 'Ghostex form'}
      detail={detail}
      trailing={state}
    />
  );
  if (error.length > 0) {
    return (
      <AskCard head={head}>
        <View style={styles.errorBody}>
          <Text style={{ color: theme.error }}>These questions could not be shown: {error}</Text>
          {form.resent === true ? (
            // Desktop question_form.rs RESENT_NOTE: gxserver asked the agent to send them again.
            <Text style={[styles.detail, { color: theme.cardMuted }]}>
              Ghostex asked the agent to send these questions again.
            </Text>
          ) : null}
          <Text style={[styles.source, { color: theme.cardMuted }]}>{source}</Text>
        </View>
      </AskCard>
    );
  }
  const canSend = form.canSend === true;
  const sendError = str(form, 'sendError');
  const status =
    phase === 'answered'
      ? 'Sent to the agent.'
      : phase === 'queued'
        ? 'Queued: it goes to the agent after this turn ends.'
        : phase === 'sending'
          ? form.reconnecting === true
            ? "Reconnecting to Ghostex… your answers go out as soon as it's back."
            : 'Sending…'
          : canceled
            ? withdrawn
              ? 'Withdrawn: no answer needed.'
              : 'Canceled: it takes no answer.'
            : sendError.length > 0
              ? sendError
              : '';
  const sendLabel = phase === 'answered' ? 'Sent' : phase === 'queued' ? 'Queued' : str(form, 'submit');
  const footer = (
    <>
      {status.length > 0 ? (
        <Text style={[styles.status, { color: enabled && sendError.length > 0 ? theme.error : theme.muted }]}>
          {status}
        </Text>
      ) : (
        // Nothing to report: the (i) icon holds the sentence about blank questions, in the status' place.
        <InfoSlot />
      )}
      {enabled ? (
        <SoftButton
          tight
          label={later ? 'Back to unanswered' : 'For later'}
          onPress={() => dispatch({ type: 'questionForLater', id, later: !later })}
        />
      ) : null}
      {enabled ? (
        // Skip all sends at once, every question skipped whatever is picked (the core's `skip_all`; the
        // SessionChat 2026-10-16 DECISION on `SKIPPED` in packages/gx-visual/src/questions.rs).
        <SoftButton tight label="Skip all" onPress={() => dispatch({ type: 'formSkipAll', form: id })} />
      ) : null}
      {canceled ? null : (
        <PrimaryButton
          tight
          label={sendLabel}
          disabled={!canSend}
          onPress={() => dispatch({ type: 'formSend', form: id })}
        />
      )}
    </>
  );
  return (
    <AskCard head={head} footer={footer} tightFooter>
      {body}
    </AskCard>
  );
}

function FormNotes({ formId, notes, enabled }: { formId: string; notes: string; enabled: boolean }) {
  const { theme, dispatch } = useTranscriptEnv();
  const report = useCallback((text: string) => dispatch({ type: 'formNotes', form: formId, text }), [dispatch, formId]);
  const [text, setText] = useEchoedText(`${formId}:notes`, notes, report);
  const reveal = useRevealFocusedField();
  if (!enabled) {
    return (
      <Text selectable style={[styles.detail, { color: theme.cardMuted }]}>
        Notes: {notes}
      </Text>
    );
  }
  return (
    <FormBox formId={formId} slot="notes" text={text} setText={setText}>
      {(onSelectionChange) => (
        <TextInput
          multiline
          value={text}
          placeholder={NOTES_PLACEHOLDER}
          placeholderTextColor={theme.placeholder}
          accessibilityLabel="Notes"
          onFocus={reveal}
          onContentSizeChange={reveal}
          onChangeText={setText}
          onSelectionChange={onSelectionChange}
          style={[
            styles.input,
            {
              color: theme.foreground,
              borderColor: theme.inputBorder,
              backgroundColor: theme.light ? theme.background : theme.cardRow,
            },
          ]}
        />
      )}
    </FormBox>
  );
}

/**
 * A form's note or text box that takes an image the keyboard inserts or the long-press Paste puts
 * in (`GhostexImageIntakeView`, Android), the composer's own intake: it is uploaded like an attached
 * photo and written into the box as the composer's `[Image #N](path)` reference, numbered on from the
 * form's other boxes (gx-chat-core `insert_answer_attachments`), so the answers carry it.
 *
 * CDXC:Clipboard 2026-11-02 SEE-ALSO: the user's DECISION on pasting images into question notes is in apps/desktop/src/app/native_chat/form_attachments.rs. A React Native `TextInput` cannot draw a pill inside its text without the composer's hidden-glyph projection, so the box shows the reference as text.
 */
function FormBox({
  formId,
  slot,
  text,
  setText,
  children,
}: {
  formId: string;
  slot: number | 'notes';
  text: string;
  setText: (text: string) => void;
  children: (onSelectionChange: (event: { nativeEvent: { selection: { start: number; end: number } } }) => void) => ReactNode;
}) {
  const { theme, uploadFiles, queryAsync } = useTranscriptEnv();
  const forms = useContext(FormsContext);
  const textRef = useRef(text);
  textRef.current = text;
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const onSelectionChange = useCallback(
    (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
      selection.current = event.nativeEvent.selection;
    },
    [],
  );
  const onImages = useCallback(
    (event: { nativeEvent: unknown }) => {
      if (uploadFiles === undefined || queryAsync === undefined) return;
      const { files, failed } = imagesFromIntake(event.nativeEvent);
      if (files.length === 0) {
        if (failed > 0) setStatus({ text: 'The pasted image could not be read.', error: true });
        return;
      }
      const original = textRef.current;
      const { start, end } = selection.current ?? { start: original.length, end: original.length };
      setStatus({ text: files.length > 1 ? 'Saving the pasted images…' : 'Saving the pasted image…', error: false });
      uploadFiles(files)
        .then(async (paths) => {
          const edit = obj(
            await queryAsync('insertAnswerAttachments', [
              textRef.current,
              paths,
              original,
              start,
              end,
              otherBoxes(forms[formId], slot),
            ]),
          );
          if (typeof edit?.text !== 'string') throw new Error('The image reference could not be inserted. Please paste it again.');
          setText(edit.text);
          setStatus(null);
        })
        .catch((error: unknown) =>
          setStatus({ text: error instanceof Error ? error.message : 'The pasted image could not be saved.', error: true }),
        );
    },
    [formId, forms, queryAsync, setText, slot, uploadFiles],
  );
  return (
    <View>
      <GhostexImageIntakeView onImages={onImages}>{children(onSelectionChange)}</GhostexImageIntakeView>
      {status !== null ? (
        <Text style={[styles.hint, { color: status.error ? '#fb7185' : theme.muted }]}>{status.text}</Text>
      ) : null}
    </View>
  );
}

/** The text of form `form`'s boxes other than `slot`, which go to the agent in the same message. */
function otherBoxes(form: Json | undefined, slot: number | 'notes'): string {
  const record = obj(form);
  const texts = arr(record?.drafts)
    .map((draft, index) => (index === slot ? '' : str(draft, 'other')))
    .filter((text) => text.length > 0);
  if (slot !== 'notes') texts.push(str(record, 'notes'));
  return texts.join('\n');
}

function FormQuestion({
  formId,
  index,
  question,
  draft,
  otherLabel,
  enabled,
  answered,
}: {
  formId: string;
  index: number;
  question: JsonRecord | null;
  draft: JsonRecord | null;
  otherLabel: string;
  enabled: boolean;
  answered: boolean;
}) {
  const { theme, dispatch } = useTranscriptEnv();
  const tag = str(question, 'tag');
  const detail = str(question, 'detail');
  const multiple = question?.multiple === true;
  const isText = question?.text === true;
  const picked = new Set(arr(draft?.indices).filter((value): value is number => typeof value === 'number'));
  const choices = arr(question?.choices);
  const written = str(draft, 'other');
  const pick = (choice: number) => dispatch({ type: 'formChoice', form: formId, question: index, choice });
  const report = useCallback(
    (text: string) => dispatch({ type: 'formText', form: formId, question: index, text }),
    [dispatch, formId, index],
  );
  const [text, setText] = useEchoedText(`${formId}:${index}`, written, report);
  const reveal = useRevealFocusedField();
  const skipped = draft?.skipped === true;
  const anchor = useQuestionAnchor(formId, tag);
  return (
    <View ref={anchor} collapsable={false} style={styles.question}>
      <View style={styles.questionHead}>
        <LinkWords
          text={str(question, 'title')}
          runs={question?.titleRuns}
          color={theme.foreground}
          style={styles.questionTitle}
        />
        {tag.length > 0 ? (
          <Text style={[styles.tag, { color: theme.muted, backgroundColor: `${theme.muted}2e` }]}>{tag}</Text>
        ) : null}
      </View>
      {detail.length > 0 ? (
        <LinkWords text={detail} runs={question?.detailRuns} color={theme.cardMuted} style={styles.detail} />
      ) : null}
      {!isText && multiple ? <Text style={[styles.hint, { color: theme.muted }]}>Pick any that apply.</Text> : null}
      {!isText
        ? choices.map((choice, choiceIndex) => (
            <AskOption
              key={choiceIndex}
              keyLabel={letter(choiceIndex)}
              label={str(choice, 'shownLabel') || str(choice, 'label')}
              detail={str(choice, 'detail')}
              {...(Array.isArray(obj(choice)?.detailRuns)
                ? {
                    renderDetail: (style: StyleProp<TextStyle>) => (
                      <LinkWords text={str(choice, 'detail')} runs={obj(choice)?.detailRuns} color={theme.muted} style={style} />
                    ),
                  }
                : {})}
              recommended={obj(choice)?.recommended === true}
              picked={picked.has(choiceIndex)}
              multiple={multiple}
              enabled={enabled}
              answered={answered}
              onPress={() => pick(choiceIndex)}
            />
          ))
        : null}
      {!isText ? (
        <AskOption
          keyLabel={letter(choices.length)}
          label={otherLabel}
          picked={draft?.otherPicked === true}
          multiple={multiple}
          other
          enabled={enabled}
          answered={answered}
          onPress={() => pick(choices.length)}
        />
      ) : null}
      {enabled ? (
        <FormBox formId={formId} slot={index} text={text} setText={setText}>
          {(onSelectionChange) => (
            <TextInput
              multiline
              value={text}
              placeholder={placeholder(question, draft)}
              placeholderTextColor={theme.placeholder}
              onFocus={reveal}
              onContentSizeChange={reveal}
              onChangeText={setText}
              onSelectionChange={onSelectionChange}
              style={[
                styles.input,
                {
                  color: theme.foreground,
                  borderColor: theme.inputBorder,
                  backgroundColor: theme.light ? theme.background : theme.cardRow,
                },
                isText && styles.textAnswer,
              ]}
            />
          )}
        </FormBox>
      ) : written.trim().length > 0 ? (
        <Text selectable style={[styles.detail, { color: theme.cardMuted }]}>
          {isText ? written : `Note: ${written}`}
        </Text>
      ) : skipped ? (
        <Text style={[styles.detail, { color: theme.muted }]}>Skipped</Text>
      ) : isText ? (
        <Text style={[styles.detail, { color: theme.muted }]}>Not answered</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  later: { marginTop: 16, paddingTop: 16, borderTopWidth: 1 },
  errorBody: { gap: 8 },
  question: { gap: 8 },
  // The user's pick (desktop question_form.rs): the tag is a filled chip at the right end of the title's first line, the title wrapping beside it.
  questionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tag: {
    flexShrink: 0,
    marginTop: 2,
    fontFamily: MONO_FONT,
    fontSize: 10.5,
    lineHeight: 18,
    fontWeight: '500',
    paddingHorizontal: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  questionTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 22, fontWeight: '500' },
  detail: { fontSize: 13, lineHeight: 19 },
  hint: { fontSize: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13.5,
    minHeight: 38,
    textAlignVertical: 'top',
  },
  textAnswer: { minHeight: 70 },
  status: { flex: 1, minWidth: 0, fontSize: 12.5 },
  info: { alignSelf: 'flex-start', width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    position: 'absolute',
    width: HINT_WIDTH,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  bubbleText: { fontSize: 13, lineHeight: 18 },
  source: { fontFamily: MONO_FONT, fontSize: 12 },
});
