/**
 * What a needs-you work item offers, drawn once for both places the phone shows it (the dock on the
 * chat box, `WorkCards.tsx`, and the Work sheet's opened cards, `CoordinatorBoard.tsx`): its answers
 * as the dock's filled buttons, the recommended one starred, Reply after them (after a thin divider
 * on an opened row), and one menu of what every item repeats: Show in chat, Dismiss, Snooze with its
 * lengths, and Mention. Port of desktop `native_chat/work_actions.rs` and the dock row's ⋯ menu
 * (`work_cards.rs` `row_menu`); the rows' words and commands are the chat core's
 * (gx-chat-core `extras/work_cards.rs` `dock` and `panel_actions`).
 *
 * CDXC:Coordinators 2026-11-11 DECISION:
 * User, of the desktop's opened row: "C. Answers and one menu" (only the answers stay buttons; Show
 * in chat, Dismiss, Snooze and Mention are one ⋯ menu), Reply after a divider, and "i dont like the
 * choices wrapping, please make them never wrap… should just show a dropdown". Then, of the phone:
 * "please please make sure we make the work items work the same way as it does on desktop". The
 * phone has no hover, so its ⋯ always shows, and its menu is a sheet on the dock and a list in place
 * on the Work sheet (iOS shows no sheet over a sheet); the answers that do not fit one line fold
 * into "Choose an answer", which opens them one per line under it.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { ToneButton } from './ToneCard';
import { askColor, tint } from './askCard';
import { PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { openQuestionReply } from '../transcript/QuestionReply';
import { replyDraftRow, useReplyDraft, type ReplyDraftScope } from './replyDrafts';

/** Every button's touch area: 8 above and below a 28-point button make Apple's 44. */
export const WORK_BUTTON_SLOP = { top: 8, bottom: 8, left: 3, right: 3 };

/** The button the answers fold into when they do not fit one line (desktop `CHOOSE_ANSWER`). */
const CHOOSE_ANSWER = 'Choose an answer';

/** A button's width, roughly as `ToneButton` draws it: its label, sides, and an icon or mark. */
function buttonWidth(label: string, icon: boolean, mark: boolean): number {
  return label.length * 7.4 + 24 + (icon ? 20 : 0) + (mark ? 16 : 0);
}

/** A Reply's label: the words it sent, cut short so the button stays a button (desktop `reply_answer`). */
function replyLabel(replied: string): string {
  if (replied.length === 0) return 'Reply';
  return replied.length > 32 ? `${replied.slice(0, 31).trimEnd()}…` : replied;
}

/** Opens a work item's Reply sheet, which keeps its draft for the chat (`replyDrafts.ts`). */
export function openWorkReply(reply: JsonRecord, scope: ReplyDraftScope | null): void {
  openQuestionReply({
    form: typeof reply.form === 'string' ? reply.form : null,
    tag: str(reply, 'tag'),
    ...(typeof reply.item === 'string' ? { item: reply.item, key: str(reply, 'key') } : {}),
    scope,
  });
}

/** The quiet word after a Reply that holds words not yet sent (desktop `draft_sign`). */
function DraftSign() {
  const styles = useStyles();
  return <Text style={styles.draft}>Draft</Text>;
}

/** The recommended answer's star, the question forms' (`askCard.tsx`). */
function Star() {
  const P = useTranscriptTheme();
  return <Glyph name="star" size={10} color={tint(askColor(P.light), 0.75)} />;
}

/**
 * An item's answers and its Reply on one line, never wrapped: past `room` the answers fold into
 * "Choose an answer", which opens them one per line. A row with no answers shows what it asks for
 * in their place: Open for a page or form (`open`), else Reply. `divider`: an opened row, whose Reply
 * stands apart after a thin line.
 */
export function WorkAnswerLine({
  answers,
  reply,
  replied,
  open,
  busy,
  divider,
  room,
  scope,
  dispatch,
  before,
}: {
  answers: JsonRecord[];
  reply: JsonRecord | null;
  replied: string;
  open?: JsonRecord | null;
  busy: boolean;
  divider: boolean;
  /** The line's width in points; the screen's width less `room` when negative. */
  room: number;
  scope: ReplyDraftScope | null;
  dispatch: (action: never) => void;
  /** Runs before a Reply or an answer goes (the Work sheet closes for the Reply sheet). */
  before?: (kind: 'reply' | 'answer') => void;
}) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const [choosing, setChoosing] = useState(false);
  const row = reply !== null ? replyDraftRow(reply as never) : null;
  const draft = useReplyDraft(scope, row).length > 0;
  const given = answers.some((answer) => isTrue(answer, 'picked'));
  const locked = given || answers.some((answer) => isTrue(answer, 'locked'));
  const lineRoom = room > 0 ? room : width + room;
  const replyButton =
    reply !== null ? (
      <ToneButton
        key="reply"
        kind="secondary"
        label={replyLabel(replied)}
        icon={replied.length > 0 ? 'check' : 'arrow-back-up'}
        trailing={draft && replied.length === 0 ? <DraftSign /> : undefined}
        accessibilityLabel={draft ? 'Reply, draft kept' : undefined}
        disabled={(busy || locked) && replied.length === 0}
        hitSlop={WORK_BUTTON_SLOP}
        onPress={() => {
          if (replied.length > 0) return;
          before?.('reply');
          openWorkReply(reply, scope);
        }}
      />
    ) : null;
  if (answers.length === 0) {
    if (open != null) {
      return (
        <View style={styles.line}>
          <ToneButton
            kind="secondary"
            label="Open"
            icon="external-link"
            hitSlop={WORK_BUTTON_SLOP}
            onPress={() => dispatch(open as never)}
          />
        </View>
      );
    }
    return replyButton !== null ? <View style={styles.line}>{replyButton}</View> : null;
  }
  const answerButton = (answer: JsonRecord, index: number) => {
    const picked = isTrue(answer, 'picked');
    const recommended = isTrue(answer, 'recommended');
    const command = obj(answer.command);
    return (
      <ToneButton
        key={`answer:${index}`}
        kind="secondary"
        label={str(answer, 'label')}
        icon={picked ? 'check' : undefined}
        trailing={recommended ? <Star /> : undefined}
        accessibilityLabel={recommended ? `${str(answer, 'label')}, Recommended` : undefined}
        disabled={(busy || locked) && !picked}
        hitSlop={WORK_BUTTON_SLOP}
        onPress={() => {
          if (busy || locked || command === null) return;
          setChoosing(false);
          before?.('answer');
          dispatch(command as never);
        }}
      />
    );
  };
  const widths = answers.map((answer) =>
    buttonWidth(str(answer, 'label'), isTrue(answer, 'picked'), isTrue(answer, 'recommended')),
  );
  const replyWidth = reply !== null ? buttonWidth(replyLabel(replied), true, draft) + 6 + (divider ? 13 : 0) : 0;
  const need = widths.reduce((sum, value) => sum + value, 0) + 6 * Math.max(0, widths.length - 1) + replyWidth;
  const fold =
    !given &&
    need > lineRoom &&
    widths.reduce((sum, value) => sum + value, 0) > buttonWidth(CHOOSE_ANSWER, true, false);
  return (
    <View style={styles.column}>
      <View style={styles.line}>
        {fold ? (
          <ToneButton
            kind="secondary"
            label={CHOOSE_ANSWER}
            icon={choosing ? 'chevron-up' : 'chevron-down'}
            accessibilityLabel={CHOOSE_ANSWER}
            disabled={busy}
            hitSlop={WORK_BUTTON_SLOP}
            onPress={() => setChoosing((was) => !was)}
          />
        ) : (
          answers.map((answer, index) => answerButton(answer, index))
        )}
        {replyButton !== null && divider ? <View style={styles.divider} /> : null}
        {replyButton}
      </View>
      {fold && choosing ? (
        <View style={styles.choices}>{answers.map((answer, index) => answerButton(answer, index))}</View>
      ) : null}
    </View>
  );
}

/** One row of an item's menu. */
export type WorkMenuRow = {
  label: string;
  icon: GlyphName;
  command?: JsonRecord;
  snooze?: JsonRecord[];
  destructive?: boolean;
};

/**
 * An item's menu rows from its actions (desktop `row_menu`): Show in chat, Dismiss, Snooze with its
 * lengths, then Mention, which puts the item in the chat box.
 */
export function workMenuRows(actions: JsonRecord | null, mention: string, composerText: string): WorkMenuRow[] {
  if (actions === null) return [];
  const rows: WorkMenuRow[] = [];
  const show = obj(actions.showInChat);
  if (show !== null) rows.push({ label: 'Show in chat', icon: 'arrow-down-left', command: show });
  const dismiss = obj(actions.dismiss);
  if (dismiss !== null) rows.push({ label: 'Dismiss', icon: 'x', command: dismiss });
  const snooze = arr(actions.snooze)
    .map(obj)
    .filter((choice): choice is JsonRecord => choice !== null);
  if (snooze.length > 0) rows.push({ label: 'Snooze', icon: 'clock', snooze });
  if (mention.length > 0) {
    rows.push({
      label: 'Mention',
      icon: 'message-plus',
      command: { type: 'insertBoardReference', reference: mention, text: composerText },
    });
  }
  return rows;
}

/**
 * An item's menu as a list: its rows, and Snooze opening its lengths in place with a back row, as
 * the desktop's dropdown opens its submenu. `onPick` runs a row's command.
 */
export function WorkMenuList({
  rows,
  onPick,
  header,
}: {
  rows: WorkMenuRow[];
  onPick: (command: JsonRecord) => void;
  header?: ReactNode;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [snoozing, setSnoozing] = useState<JsonRecord[] | null>(null);
  if (snoozing !== null) {
    return (
      <View>
        <Pressable accessibilityRole="button" onPress={() => setSnoozing(null)} style={styles.menuRow}>
          <Glyph name="chevron-left" size={15} color={P.cardMuted} />
          <Text style={[styles.menuText, { color: P.cardMuted }]}>Snooze for</Text>
        </Pressable>
        {snoozing.map((choice, index) => (
          <Pressable
            key={`snooze:${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Snooze for ${str(choice, 'label')}`}
            onPress={() => {
              const command = obj(choice.command);
              setSnoozing(null);
              if (command !== null) onPick(command);
            }}
            style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
          >
            <Glyph name="clock" size={15} color={P.cardMuted} />
            <Text style={styles.menuText}>{str(choice, 'label')}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <View>
      {header}
      {rows.map((row) => (
        <Pressable
          key={row.label}
          accessibilityRole="button"
          onPress={() =>
            row.snooze !== undefined ? setSnoozing(row.snooze) : row.command ? onPick(row.command) : undefined
          }
          style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
        >
          <Glyph name={row.icon} size={15} color={P.cardMuted} />
          <Text style={[styles.menuText, styles.flex]}>{row.label}</Text>
          {row.snooze !== undefined ? <Glyph name="chevron-right" size={14} color={P.cardMuted} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** The ⋯ that opens an item's menu: always shown, since a phone has no hover. */
export function WorkMenuButton({ onPress, active }: { onPress: () => void; active?: boolean }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="More actions"
      accessibilityState={{ expanded: active === true }}
      hitSlop={{ top: 11, bottom: 11, left: 8, right: 8 }}
      onPress={onPress}
      style={({ pressed }) => [styles.dots, (pressed || active === true) && { backgroundColor: P.neutralFillPressed }]}
    >
      <Glyph name="dots" size={14} color={P.cardMuted} />
    </Pressable>
  );
}

const useStyles = themedStyles((P) => ({
  column: { gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  choices: { alignItems: 'flex-start', gap: 6 },
  divider: { width: 1, height: 16, marginHorizontal: 3, backgroundColor: P.ink(0.1) },
  draft: { fontSize: 13, color: P.muted },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 16 },
  menuRowPressed: { backgroundColor: P.neutralFillPressed },
  menuText: { color: P.foreground, fontSize: PROSE_SIZE + 1 },
  flex: { flex: 1 },
  dots: { width: 26, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
}));
