/**
 * The card every question the chat shows is drawn in: an agent's own question tool
 * (`QuestionCard.tsx`) and its answered record (`QuestionExchangeCards.tsx`), a ```questions form
 * (`transcript/QuestionForm.tsx`) and the answers sent from a form or an HTML page
 * (`transcript/PageAnswersCard.tsx`). A tinted tile and a two-line title lead it, the options are
 * radio or checkbox rows that light up in the asking colour, and the answers come back as plain text under their question.
 *
 * CDXC:SessionChat 2026-10-11 SEE-ALSO:
 * The desktop's copy is apps/desktop/src/app/native_chat/ask_card.rs; the HTML question pages draw it in server/src/visual_pages/kit.rs. Change them together.
 */

import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { Glyph } from './icons';
import {
  SINGLE_LINE_CARD,
  SINGLE_LINE_HEADER_HEIGHT,
  SINGLE_LINE_TITLE,
  SingleLineNumberTile,
  SingleLineTile,
  singleLinePressed,
  singleLineShell,
} from '../transcript/singleLineCard';
import { MONO_FONT, themedStyles, useTranscriptTheme } from '../transcript/theme';

/** Whether an answered exchange got an answer. */
export type AskTone = 'answered' | 'quiet';

/**
 * The colour a waiting question and the option the reader picked share: the questions pink
 * (desktop `ask_color`; user, 2026-11-11: "let's change these to the same #F472B6 color that we use to
 * represent questions everywhere", then "All four").
 */
export function askColor(light: boolean): string {
  return light ? '#be185d' : '#f472b6';
}

/** The green that marks an answer. */
export function answeredColor(light: boolean): string {
  return light ? '#059669' : '#34d399';
}

/** `#rrggbb` at an alpha. */
export function tint(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/**
 * The card's shell around its head, its body and its footer band. `singleLine` is an answered card
 * that folds to a `singleLine` head: the shell every one-line card shares (`singleLineCard.tsx`).
 */
export function AskCard({
  head,
  children,
  footer,
  style,
  bodyStyle,
  singleLine,
  lined,
  tightFooter,
}: {
  head: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Added to the body's padded box (the question card lets it shrink under its height cap). */
  bodyStyle?: StyleProp<ViewStyle>;
  singleLine?: boolean;
  /** The body on the one-line cards' edge, under a `lined` head (the page answers). */
  lined?: boolean;
  /**
   * The footer's padding and gaps tightened (12 and 6, not 14 and 8) so a row of a few buttons fits one line on a
   * 360dp phone (the question form's: the (i) icon, For later, Skip all, Send answers).
   */
  tightFooter?: boolean;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const hasBody = children !== undefined && children !== null && children !== false;
  return (
    <View style={[styles.card, singleLine === true && singleLineShell(P), style]}>
      {head}
      {hasBody ? (
        <View style={[styles.body, (singleLine === true || lined === true) && styles.singleLineBody, bodyStyle]}>
          {children}
        </View>
      ) : null}
      {footer !== undefined && footer !== null ? (
        <View style={[styles.footer, tightFooter === true && styles.footerTight]}>{footer}</View>
      ) : null}
    </View>
  );
}

/**
 * The head row: `lead` (a `SingleLineTile`), title over a muted detail line, then whatever trails
 * it. With `onPress` the whole row folds the card and lights edge to edge when pressed.
 * `singleLine` is the 44pt head of a card that folds to one line, led by the question-bubble tile
 * in the fold's title type (`singleLineCard.tsx`); `lined` puts the lead and title at the one-line
 * cards' x, in their title weight (the page answers).
 */
export function AskHead({
  lead,
  lined,
  title,
  detail,
  trailing,
  chevron,
  onPress,
  accessibilityLabel,
  singleLine,
}: (
  { singleLine?: false; lead: ReactNode; lined?: boolean } | { singleLine: true; lead?: undefined; lined?: undefined }
) & {
  title: string;
  detail?: string;
  trailing?: ReactNode;
  /** `open` / `closed` draws the fold chevron: down while open, up while folded, since the card it heads is docked on the composer (desktop `chevron` in ask_card.rs, CDXC:SessionChat 2026-10-23). */
  chevron?: 'open' | 'closed';
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const compact = singleLine === true;
  const headStyle = compact
    ? [styles.head, styles.singleLineHead]
    : lined === true
      ? [styles.head, styles.linedHead]
      : styles.head;
  const content = (
    <>
      {singleLine === true ? <SingleLineTile glyph="question" /> : lead}
      <View style={styles.titles}>
        <Text
          style={
            compact
              ? [styles.title, SINGLE_LINE_TITLE]
              : lined === true
                ? [styles.title, { fontWeight: SINGLE_LINE_CARD.titleWeight }]
                : styles.title
          }
          numberOfLines={1}
        >
          {title}
        </Text>
        {detail !== undefined && detail.length > 0 ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron !== undefined ? (
        <Glyph name={chevron === 'open' ? 'chevron-down' : 'chevron-up'} size={14} color={P.muted} />
      ) : null}
    </>
  );
  if (onPress === undefined) return <View style={headStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        headStyle,
        pressed && (compact ? singleLinePressed(P) : { backgroundColor: P.pressedFill }),
      ]}
    >
      {content}
    </Pressable>
  );
}

/** One short bar per question, the asked ones lit: the progress through a multi-question ask. */
export function ProgressDots({ index, count }: { index: number; count: number }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const hue = tint(askColor(P.light), 0.8);
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }, (_, dot) => (
        <View key={dot} style={[styles.dot, { backgroundColor: dot <= index ? hue : P.ink(0.12) }]} />
      ))}
    </View>
  );
}

/** A muted keycap: an option's letter. */
export function Keycap({ label, lit }: { label: string; lit: boolean }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return <Text style={[styles.keycap, { color: lit ? P.foreground : P.muted }]}>{label}</Text>;
}

/** One option the reader can pick: radio or checkbox, label over its detail, an optional keycap. */
export function AskOption({
  label,
  detail,
  picked,
  multiple,
  keyLabel,
  recommended,
  other,
  enabled,
  answered,
  onPress,
  renderDetail,
}: {
  label: string;
  detail?: string;
  /** Draws the detail in the given style instead of plain text (a question form's links, `QuestionForm.tsx`). */
  renderDetail?: (style: StyleProp<TextStyle>) => ReactNode;
  picked: boolean;
  multiple: boolean;
  keyLabel?: string;
  recommended?: boolean;
  /** "Other / none of these": its label stays muted until it is picked. */
  other?: boolean;
  enabled: boolean;
  /** The question was answered and sent: a pick reads green, like the answers card. */
  answered?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  // A pick waiting to be sent is a light pink tint; once sent it reads green at full strength (desktop ask_card.rs).
  const sent = answered === true;
  const hue = sent ? answeredColor(P.light) : askColor(P.light);
  const [edge, wash] = sent ? [0.55, 0.08] : [0.32, 0.04];
  const markHue = sent ? hue : tint(hue, 0.85);
  const showDetail = detail !== undefined && detail.length > 0 && detail !== label;
  return (
    <Pressable
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={{ checked: picked, disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: picked ? tint(hue, edge) : P.controlBorder,
          backgroundColor: picked ? tint(hue, wash) : pressed ? P.pressedFill : P.light ? P.background : P.cardRow,
        },
        !enabled && !picked && styles.dimmed,
      ]}
    >
      <View
        style={[
          styles.mark,
          multiple ? styles.checkbox : styles.radio,
          { borderColor: picked ? markHue : P.mutedInk(0.7) },
          picked && multiple && { backgroundColor: markHue },
        ]}
      >
        {picked && multiple ? <Glyph name="check" size={11} color={P.background} /> : null}
        {picked && !multiple ? <View style={[styles.radioDot, { backgroundColor: markHue }]} /> : null}
      </View>
      <View style={styles.optionBody}>
        <View style={styles.optionLine}>
          <Text style={[styles.optionLabel, { color: other === true && !picked ? P.cardMuted : P.foreground }]}>
            {label}
          </Text>
          {recommended === true ? <RecommendedMark /> : null}
        </View>
        {showDetail ? (
          renderDetail !== undefined ? (
            renderDetail(styles.optionDetail)
          ) : (
            <Text style={styles.optionDetail}>{detail}</Text>
          )
        ) : null}
      </View>
      {keyLabel !== undefined ? <Keycap label={keyLabel} lit={picked} /> : null}
    </Pressable>
  );
}

/**
 * The quiet mark beside the option the agent recommends: a small muted "Recommended" in sentence
 * case after a faint star in the asking colour, with no pill, fill or border.
 *
 * CDXC:SessionChat 2026-11-02 DECISION:
 * User: "make the 'recommended' tag more subtle, not like a pill, and not all caps", first on the HTML pages, then the chat's own question card to match them. The same mark as the desktop (apps/desktop/src/app/native_chat/ask_card.rs `recommended_mark`) and the pages (server/src/visual_pages/kit.rs `.gx-rec`). Supersedes the light-grey Recommended pill.
 */
function RecommendedMark() {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={styles.recommended}>
      <Glyph name="star" size={10} color={tint(askColor(P.light), 0.75)} />
      <Text style={styles.recommendedText}>Recommended</Text>
    </View>
  );
}

/**
 * The filled button that moves the ask on (Next, Send answer, Send).
 */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  tight,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** 10dp of side padding, not 12 (a footer row that must stay on one line). */
  tight?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.primary,
        tight === true && styles.buttonTight,
        pressed && styles.primaryPressed,
        disabled === true && styles.disabled,
      ]}
    >
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * The quiet button beside the primary one (the question form's Skip all): a faint fill of the
 * foreground, the normal text colour, no border, the primary button's size.
 *
 * CDXC:SessionChat 2026-10-16 DECISION: User: "skip all looks disabled cuz it's darker color"; shown a mockup of options, they picked "soft fill": the foreground at 10% on the dark theme and 7% on the light one, normal text colour, no border. Send answers keeps the solid fill. Matches the desktop `ask_soft_button` (apps/desktop/src/app/native_chat/ask_card.rs) and the page kit's `.gx-skip-all`.
 */
export function SoftButton({ label, onPress, tight }: { label: string; onPress: () => void; tight?: boolean }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.soft,
        tight === true && styles.buttonTight,
        { backgroundColor: P.ink(P.light ? (pressed ? 0.11 : 0.07) : pressed ? 0.15 : 0.1) },
      ]}
    >
      <Text style={styles.softLabel}>{label}</Text>
    </Pressable>
  );
}

/** An answer as plain text: the foreground colour at medium weight, no chip, border or fill (desktop `plain_answer`). */
export function PlainAnswer({ children }: { children: string }) {
  const styles = useStyles();
  return (
    <Text selectable style={styles.plainAnswer}>
      {children}
    </Text>
  );
}

/** The muted words beside or under an answer. */
export function AnswerAside({ children, italic }: { children: string; italic?: boolean }) {
  const styles = useStyles();
  return <Text style={[styles.aside, italic === true && styles.italic]}>{children}</Text>;
}

/** The line height of an answered question in a receipt row. */
const RECEIPT_QUESTION_LINE = 19;

/**
 * One answered question in a receipt: its number, the question (muted), and under it the plain
 * answer and whatever follows it.
 */
export function ReceiptRow({
  number,
  question,
  renderQuestion,
  answer,
  below,
  first,
}: {
  number: number;
  question: string;
  /** Draws the question in the given style instead of plain text (its links, `PageAnswersCard.tsx`). */
  renderQuestion?: (style: StyleProp<TextStyle>) => ReactNode;
  answer: ReactNode;
  below?: ReactNode;
  first: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.receiptRow, !first && styles.receiptDivider]}>
      {/* The card's own tile with the number in it, so the question and answer line up under the title. */}
      <SingleLineNumberTile number={number} />
      <View style={styles.receiptBody}>
        {question.length > 0 ? (
          renderQuestion !== undefined ? (
            renderQuestion(styles.receiptQuestion)
          ) : (
            <Text style={styles.receiptQuestion}>{question}</Text>
          )
        ) : null}
        <View style={styles.answerLine}>{answer}</View>
        {below}
      </View>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  card: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.cardPanel,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  linedHead: { paddingHorizontal: SINGLE_LINE_CARD.paddingX },
  singleLineHead: {
    height: SINGLE_LINE_HEADER_HEIGHT,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
    paddingVertical: 0,
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: P.foreground,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  detail: {
    color: P.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  singleLineBody: {
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
    paddingBottom: SINGLE_LINE_CARD.paddingX,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: P.light ? P.border : 'rgba(255,255,255,0.04)',
    backgroundColor: P.cardFooter,
  },
  footerTight: {
    gap: 6,
    paddingHorizontal: 12,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 18,
    height: 4,
    borderRadius: 2,
  },
  keycap: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    marginTop: 1,
    borderWidth: 1,
    borderRadius: 5,
    borderColor: P.ink(0.12),
    backgroundColor: P.light ? P.background : 'rgba(14,14,14,0.5)',
    fontFamily: MONO_FONT,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
    textAlign: 'center',
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  mark: {
    width: 16,
    height: 16,
    marginTop: 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    borderRadius: 8,
  },
  checkbox: {
    borderRadius: 4,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  optionBody: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  optionLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  optionLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  optionDetail: {
    color: P.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  recommended: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recommendedText: {
    color: P.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  dimmed: {
    opacity: 0.55,
  },
  primary: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.controlPrimary,
    backgroundColor: P.controlPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonTight: {
    paddingHorizontal: 10,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  soft: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  softLabel: {
    color: P.foreground,
    fontSize: 13.5,
    fontWeight: '500',
  },
  primaryLabel: {
    color: P.background,
    fontSize: 13.5,
    fontWeight: '500',
  },
  disabled: {
    opacity: 0.5,
  },
  plainAnswer: {
    flexShrink: 1,
    color: P.foreground,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  aside: {
    flexShrink: 1,
    color: P.muted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  italic: {
    fontStyle: 'italic',
  },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
  },
  receiptDivider: {
    borderTopWidth: 1,
    borderTopColor: P.ink(0.05),
  },
  receiptBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    // The question's first line sits centred on the number tile.
    paddingTop: (SINGLE_LINE_CARD.tile.size - RECEIPT_QUESTION_LINE) / 2,
  },
  receiptQuestion: {
    color: P.muted,
    fontSize: 13,
    lineHeight: RECEIPT_QUESTION_LINE,
  },
  answerLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
}));
