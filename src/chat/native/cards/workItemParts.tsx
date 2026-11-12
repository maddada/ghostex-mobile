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
import * as Clipboard from 'expo-clipboard';
import { Pressable, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { SidebarPalette } from '../../../theme/palette';
import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { Sheet } from '../composer/Sheet';
import { askColor, tint } from './askCard';
import { PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { openQuestionReply } from '../transcript/QuestionReply';
import { Markdown } from '../transcript/markdown/Markdown';
import { messageCommands } from '../transcript/markdown/runCommands';
import { replyDraftRow, useReplyDraft, type ReplyDraftScope } from './replyDrafts';

/** Every button's touch area: 8 above and below a 28-point button make Apple's 44. */
export const WORK_BUTTON_SLOP = { top: 8, bottom: 8, left: 3, right: 3 };

/** The button the answers fold into when they do not fit one line (desktop `CHOOSE_ANSWER`). */
export const CHOOSE_ANSWER = 'Choose an answer';

/**
 * A button's width, roughly as `WorkButton` draws it on one line: its label at 14 points grown by
 * the phone's text size (`fontScale`: Android's and iOS's larger text), its sides, and an icon or
 * mark. Generous, so an estimate never lets a row cut an answer.
 */
function buttonWidth(label: string, icon: boolean, mark: boolean, fontScale: number): number {
  return label.length * 8.6 * fontScale + 24 + (icon ? 20 : 0) + (mark ? 16 : 0);
}

/** Each status's colour, the board's (`CoordinatorBoard.tsx` `GROUP_COLOR`, desktop `group_look`). */
export const STATUS_COLOR: Record<string, string> = {
  needs: SidebarPalette.ROW_QUESTION,
  blocked: SidebarPalette.ROW_APPROVAL,
  waiting: '#7fa1c4',
  moving: '#c68a06',
  finished: '#2fa865',
};

/** An item pill's sides and dot. */
const PILL_PAD = 7;
const PILL_DOT = 6;

type PillFit = 'full' | 'dots' | 'plus';

/** The item pills' widths, each with the 6 gap after it: whole, dots only, one "+N" pill. */
function pillWidths(pills: JsonRecord[], fontScale: number): [number, number, number] {
  if (pills.length === 0) return [0, 0, 0];
  const gaps = 6 * pills.length;
  const full = pills.reduce(
    (sum, pill) => sum + PILL_PAD * 2 + PILL_DOT + 4 + str(pill, 'id').length * 7.6 * fontScale + 2,
    0,
  );
  const dots = (PILL_PAD * 2 + PILL_DOT + 2) * pills.length;
  const plus = PILL_PAD * 2 + `+${pills.length}`.length * 7.6 * fontScale + 2;
  return [full + gaps, dots + gaps, plus + 6];
}

function pillFit(widths: [number, number, number], room: number): PillFit {
  if (widths[0] <= room) return 'full';
  if (widths[1] <= room) return 'dots';
  return 'plus';
}

/**
 * An opened row's item pills, leading its answers (gx-chat-core `item_pills`; desktop
 * `item_pill_elements`): a dot in the item's state colour (an item that waits on the answer in the
 * blocked red) and its short id. A tap opens the item in the Work sheet; a long press reads its
 * whole name and state, with Open. `dots` drops the ids, `plus` is one "+N" pill that lists them.
 *
 * CDXC:Coordinators 2026-11-12 DECISION:
 * User, of the line under an opened row's title: "has to be pills looking, and small, only show id
 * (hover to read which work item), and show dot color for each one before the id in the pill".
 */
function ItemPills({ pills, fit, dispatch }: { pills: JsonRecord[]; fit: PillFit; dispatch: (action: never) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [reading, setReading] = useState<JsonRecord[] | null>(null);
  if (pills.length === 0) return null;
  const open = (pill: JsonRecord) => {
    const command = obj(pill.command);
    if (command !== null) dispatch(command as never);
  };
  return (
    <>
      {fit === 'plus' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pills.map((pill) => str(pill, 'tip')).join(', ')}
          onPress={() => setReading(pills)}
          style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
        >
          <Text style={styles.pillText}>{`+${pills.length}`}</Text>
        </Pressable>
      ) : (
        pills.map((pill, index) => (
          <Pressable
            key={`pill:${index}`}
            accessibilityRole="button"
            accessibilityLabel={str(pill, 'tip')}
            accessibilityHint="Long-press to read it"
            hitSlop={4}
            onPress={() => open(pill)}
            onLongPress={() => setReading([pill])}
            style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
          >
            <View style={[styles.pillDot, { backgroundColor: STATUS_COLOR[str(pill, 'state')] ?? P.cardMuted }]} />
            {fit === 'full' ? <Text style={styles.pillText}>{str(pill, 'id')}</Text> : null}
          </Pressable>
        ))
      )}
      <Sheet visible={reading !== null} onClose={() => setReading(null)} title="Work items">
        <View>
          {(reading ?? []).map((pill, index) => (
            <Pressable
              key={`read:${index}`}
              accessibilityRole="button"
              onPress={() => {
                setReading(null);
                open(pill);
              }}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <View style={[styles.pillDot, { backgroundColor: STATUS_COLOR[str(pill, 'state')] ?? P.cardMuted }]} />
              <Text style={[styles.menuText, { flex: 1 }]} numberOfLines={2}>
                {str(pill, 'tip')}
              </Text>
              <Glyph name="external-link" size={15} color={P.cardMuted} />
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  );
}

/** A Reply button's width as `WorkAnswerLine` measures it. */
function replyWidthOf(replied: string, draft: boolean, fontScale: number): number {
  return buttonWidth(replyLabel(replied), true, draft, fontScale);
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
    ...(typeof reply.questions === 'string' ? { questions: reply.questions, to: str(reply, 'to') } : {}),
    scope,
  });
}

/**
 * An opened row's (and an opened Work sheet card's) space between its title with its work item
 * line, its description and its answers: the question card's (desktop question.rs, 12 from the
 * head to the text and from the text to the options; `OPENED_ROW_GAP` in work_cards.rs).
 *
 * CDXC:Coordinators 2026-11-12 DECISION:
 * User, of an opened row: "please add space between the title/description/choice buttons they're
 * too close together now".
 */
export const OPENED_ROW_GAP = 12;

/**
 * The part of an opened work row or card under its title line: it takes a tap itself, so a tap
 * there never shuts the row or card around it (only its title line does), while the links, chips
 * and buttons inside keep their own taps.
 *
 * CDXC:Coordinators 2026-11-12 DECISION:
 * User, of an opened row whose command he could not copy: "let's make collapsing require clicking
 * on the header of the card not the inner part please".
 */
export function TextArea({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <View style={style} onStartShouldSetResponder={() => true}>
      {children}
    </View>
  );
}

/** A Markdown text as words to copy: a link becomes its label. */
function plainWords(markdown: string): string {
  return markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/**
 * A work ask's description in an opened row or card. A long press opens Copy text and, for a
 * command in it (an inline span the core marked, gx-chat-core `native_markdown::ask_markdown`),
 * what a reply's command offers in the transcript's long-press menu: Copy command and Paste in
 * terminal, or Run in terminal for a command block (`MessageActions.tsx`).
 */
export function WorkDescription({
  text,
  color,
  title,
  dispatch,
}: {
  text: string;
  color: string;
  title: string;
  dispatch: (action: never) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [open, setOpen] = useState(false);
  const commands = messageCommands(text);
  const items: { label: string; icon: GlyphName; run: () => void }[] = [
    { label: 'Copy text', icon: 'copy', run: () => void Clipboard.setStringAsync(plainWords(text)) },
  ];
  for (const { command, inline } of commands) {
    const named = commands.length > 1 ? ` ${command.length > 32 ? `${command.slice(0, 31)}\u2026` : command}` : '';
    if (inline) {
      items.push({ label: `Copy command${named}`, icon: 'copy', run: () => void Clipboard.setStringAsync(command) });
      items.push({
        label: `Paste in terminal${named}`,
        icon: 'terminal-2',
        run: () => dispatch({ type: 'pasteInTerminal', command } as never),
      });
    } else {
      items.push({
        label: `Run in terminal${named}`,
        icon: 'terminal-2',
        run: () => dispatch({ type: 'runInTerminal', command } as never),
      });
    }
  }
  return (
    <>
      <Pressable accessibilityHint="Long-press to copy" delayLongPress={350} onLongPress={() => setOpen(true)}>
        <Markdown text={text} color={color} breaks selectable={false} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        <View>
          {items.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                item.run();
              }}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <Glyph name={item.icon} size={15} color={P.cardMuted} />
              <Text style={styles.menuText} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  );
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
 * A work item's button: the tone card's neutral filled button (`ToneButton`, never the dark primary
 * fill on glass), but it grows to a second line instead of having a fixed height, so a long label
 * wraps and is never clipped.
 *
 * CDXC:Coordinators 2026-11-11 WHY:
 * User, of a docked ask on Ghostex 11.4.0 for Android whose first answer ("Release 11.4.1 once the
 * running fixes land") lost its second line to the 28-point button: "Bug with the q choices in work
 * items text cut off ... if we make choices show as dropdown like in desktop would be fixed".
 */
function WorkButton({
  label,
  icon,
  trailing,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: GlyphName;
  trailing?: ReactNode;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true}
      hitSlop={WORK_BUTTON_SLOP}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? P.neutralFillPressed : P.neutralFill },
        disabled === true && styles.disabled,
      ]}
    >
      {icon !== undefined ? <Glyph name={icon} size={14} color={P.foreground} /> : null}
      <Text style={[styles.buttonLabel, { color: P.foreground }]}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

/**
 * The answers of a folded ask, one a row, each whole: a long one wraps to more lines, never cut; the
 * recommended one keeps its star and the one given its check (desktop `answer_menu_rows`).
 */
function AnswerChoices({
  answers,
  disabled,
  onPick,
}: {
  answers: JsonRecord[];
  disabled: boolean;
  onPick: (command: JsonRecord) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View>
      {answers.map((answer, index) => {
        const command = obj(answer.command);
        const picked = isTrue(answer, 'picked');
        const recommended = isTrue(answer, 'recommended');
        const off = disabled || command === null || isTrue(answer, 'locked');
        return (
          <Pressable
            key={`choice:${index}`}
            accessibilityRole="button"
            accessibilityLabel={`${str(answer, 'label')}${recommended ? ', Recommended' : ''}`}
            accessibilityState={{ disabled: off && !picked, selected: picked }}
            disabled={off}
            onPress={() => (command !== null ? onPick(command) : undefined)}
            style={({ pressed }) => [
              styles.choice,
              pressed && styles.menuRowPressed,
              off && !picked && styles.disabled,
            ]}
          >
            {picked ? <Glyph name="check" size={15} color={P.foreground} /> : null}
            <Text style={styles.choiceText}>{str(answer, 'label')}</Text>
            {recommended ? <Star /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * An item's answers and its Reply on one line, never wrapped: when they do not all fit the line,
 * the answers fold into "Choose an answer" (desktop `answers_dropdown`), which opens them one a
 * row, each whole: a sheet on the dock, a list in place on the Work sheet (`chooser`), as iOS shows
 * no sheet over a sheet. Once one is given, only that one stays when they do not fit. A row with no
 * answers shows what it asks for in their place: Open for a page or form (`open`), else Reply.
 * `divider`: an opened row, whose Reply stands apart after a thin line. Every button grows to more
 * lines rather than cut its words (`WorkButton`).
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
  question = '',
  chooser = 'sheet',
  initialChoosing = false,
  pills = [],
  logos,
  logosWidth = 0,
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
  /** The ask, over the answers in the Choose an answer sheet. */
  question?: string;
  chooser?: 'sheet' | 'inline';
  /** The folded answers start open (the Work sheet's closed card asked for them). */
  initialChoosing?: boolean;
  /** An opened row's item pills, before its answers (`ItemPills`). */
  pills?: JsonRecord[];
  /** An opened row's threads as their logos, after the item pills at the line's left, and their width. */
  logos?: ReactNode;
  logosWidth?: number;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { width, fontScale } = useWindowDimensions();
  const [choosing, setChoosing] = useState(initialChoosing);
  const row = reply !== null ? replyDraftRow(reply as never) : null;
  const draft = useReplyDraft(scope, row).length > 0;
  const given = answers.some((answer) => isTrue(answer, 'picked'));
  const locked = given || answers.some((answer) => isTrue(answer, 'locked'));
  const lineRoom = room > 0 ? room : width + room;
  const replyButton =
    reply !== null ? (
      <WorkButton
        key="reply"
        label={replyLabel(replied)}
        icon={replied.length > 0 ? 'check' : 'arrow-back-up'}
        trailing={draft && replied.length === 0 ? <DraftSign /> : undefined}
        accessibilityLabel={draft ? 'Reply, draft kept' : undefined}
        disabled={(busy || locked) && replied.length === 0}
        onPress={() => {
          if (replied.length > 0) return;
          before?.('reply');
          openWorkReply(reply, scope);
        }}
      />
    ) : null;
  const pillRoom = pillWidths(pills, fontScale);
  if (answers.length === 0) {
    // A form or page offers Reply after its Open (gx-chat-core `questionsReply`).
    const alone =
      open != null
        ? buttonWidth('Open', true, false, fontScale) +
          (replyButton !== null ? 6 + replyWidthOf(replied, draft, fontScale) : 0)
        : replyWidthOf(replied, draft, fontScale);
    const lead = (
      <>
        <ItemPills pills={pills} fit={pillFit(pillRoom, lineRoom - alone - logosWidth)} dispatch={dispatch} />
        {logos}
        {divider ? <View style={styles.flex} /> : null}
      </>
    );
    if (open != null) {
      return (
        <View style={styles.line}>
          {lead}
          <WorkButton label="Open" icon="external-link" onPress={() => dispatch(open as never)} />
          {replyButton}
        </View>
      );
    }
    return replyButton !== null || pills.length > 0 || logos != null ? (
      <View style={styles.line}>
        {lead}
        {replyButton}
      </View>
    ) : null;
  }
  const answer = (command: JsonRecord) => {
    if (busy || locked) return;
    setChoosing(false);
    before?.('answer');
    dispatch(command as never);
  };
  const answerButton = (choice: JsonRecord, index: number) => {
    const picked = isTrue(choice, 'picked');
    const recommended = isTrue(choice, 'recommended');
    const command = obj(choice.command);
    return (
      <WorkButton
        key={`answer:${index}`}
        label={str(choice, 'label')}
        icon={picked ? 'check' : undefined}
        trailing={recommended ? <Star /> : undefined}
        accessibilityLabel={recommended ? `${str(choice, 'label')}, Recommended` : undefined}
        disabled={(busy || locked) && !picked}
        onPress={() => (command !== null ? answer(command) : undefined)}
      />
    );
  };
  const widths = answers.map((choice) =>
    buttonWidth(str(choice, 'label'), isTrue(choice, 'picked'), isTrue(choice, 'recommended'), fontScale),
  );
  const replyWidth =
    reply !== null ? buttonWidth(replyLabel(replied), true, draft, fontScale) + 6 + (divider ? 13 : 0) : 0;
  const answersWidth = widths.reduce((sum, value) => sum + value, 0) + 6 * Math.max(0, widths.length - 1);
  // The item pills lead: the answers fold first, then the pills drop their ids, then they are one "+N".
  const fits = answersWidth + replyWidth + pillRoom[0] + logosWidth <= lineRoom;
  // Answers no wider than the dropdown stay as they are: folding them would gain nothing.
  const fold = !given && !fits && answersWidth > buttonWidth(CHOOSE_ANSWER, true, false, fontScale);
  const shown = fits || !given ? answers : answers.filter((choice) => isTrue(choice, 'picked'));
  const list = <AnswerChoices answers={answers} disabled={busy || locked} onPick={answer} />;
  const used = fold
    ? buttonWidth(CHOOSE_ANSWER, true, false, fontScale) + replyWidth
    : (fits ? answersWidth : shown.reduce((sum, choice) => sum + widths[answers.indexOf(choice)]!, 0)) + replyWidth;
  return (
    <View style={styles.column}>
      <View style={styles.line}>
        <ItemPills pills={pills} fit={pillFit(pillRoom, lineRoom - used - logosWidth)} dispatch={dispatch} />
        {logos}
        {/* Opened: the item pills at the left, the answers and Reply at the right edge (user,
            2026-11-12: "move the answer buttons to bottom right. keep work item tag bottom left"). */}
        {divider ? <View style={styles.flex} /> : null}
        {fold ? (
          <WorkButton
            label={CHOOSE_ANSWER}
            icon={chooser === 'inline' && choosing ? 'chevron-up' : 'chevron-down'}
            accessibilityLabel={`${CHOOSE_ANSWER}, ${answers.length} answers`}
            disabled={busy}
            onPress={() => setChoosing((was) => !was)}
          />
        ) : (
          shown.map((choice) => answerButton(choice, answers.indexOf(choice)))
        )}
        {replyButton !== null && divider ? <View style={styles.divider} /> : null}
        {replyButton}
      </View>
      {fold && chooser === 'inline' && choosing ? <View style={styles.choicesBox}>{list}</View> : null}
      {fold && chooser === 'sheet' ? (
        <Sheet visible={choosing} onClose={() => setChoosing(false)} title={CHOOSE_ANSWER}>
          {question.length > 0 ? <Text style={[styles.choiceQuestion, { color: P.cardMuted }]}>{question}</Text> : null}
          {list}
        </Sheet>
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
 * lengths, then Mention in chat box, which puts the item, form or page in the chat box.
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
      label: 'Mention in chat box',
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
  // One line: its buttons shrink and wrap their words rather than run past it or wrap below.
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  // An item pill (desktop `item_pill_elements`): small and round, a dot and a short id.
  pill: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 22,
    paddingHorizontal: PILL_PAD,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: P.ink(0.1),
    backgroundColor: P.ink(0.04),
  },
  pillPressed: { backgroundColor: P.ink(0.08) },
  pillDot: { width: PILL_DOT, height: PILL_DOT, borderRadius: PILL_DOT / 2 },
  pillText: { fontSize: PROSE_SIZE, lineHeight: 18, color: P.cardMuted, fontVariant: ['tabular-nums'] },
  button: {
    minHeight: 28,
    flexShrink: 1,
    maxWidth: '100%',
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonLabel: { flexShrink: 1, fontSize: PROSE_SIZE, lineHeight: 20, fontWeight: '400' },
  disabled: { opacity: 0.5 },
  choicesBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.ink(0.1),
    backgroundColor: P.ink(0.04),
    paddingVertical: 2,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  choiceText: { flexShrink: 1, color: P.foreground, fontSize: PROSE_SIZE + 1, lineHeight: 21 },
  choiceQuestion: { paddingHorizontal: 16, paddingBottom: 8, fontSize: PROSE_SIZE, lineHeight: 20 },
  divider: { width: 1, height: 16, marginHorizontal: 3, backgroundColor: P.ink(0.1) },
  draft: { fontSize: PROSE_SIZE, color: P.muted },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 16 },
  menuRowPressed: { backgroundColor: P.neutralFillPressed },
  menuText: { color: P.foreground, fontSize: PROSE_SIZE + 1 },
  flex: { flex: 1 },
  dots: { width: 26, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
}));
