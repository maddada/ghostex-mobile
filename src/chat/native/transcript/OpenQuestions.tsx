/**
 * The brief highlight on the question a jump lands on (from the "Previous question" icon pill on the
 * working row, `cards/ChatPills.tsx`, or a Q-tag link in a reply), and the pill's tone. Which questions are unanswered, which one a tap
 * goes to and the row it sits in are the chat core's (`openQuestions`,
 * packages/gx-chat-core/src/questions/open_questions.rs); Transcript.tsx scrolls, this draws.
 *
 * CDXC:SessionChat 2026-10-14 SEE-ALSO:
 * Desktop draws the same pill and highlight in apps/desktop/src/app/native_chat/open_questions.rs and
 * scroll_bottom.rs; the rules are packages/gx-chat-core/src/transcript/open_questions.rs. Change them
 * together.
 */

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type ViewInstance } from 'react-native';

/** `questionTone`, `pillGap`, `questionFlashMs` and `questionJumpMargin` in `scroll-bottom.json`. */
export const QUESTION_PILL = {
  gap: 8,
  flashMs: 1600,
  jumpMargin: 12,
  tone: {
    dark: { background: '#1d1218', border: 'rgba(244,114,182,0.4)', text: '#f9a8d4', ring: '#f472b6' },
    light: { background: '#fdf2f8', border: 'rgba(190,24,93,0.35)', text: '#9d174d', ring: '#be185d' },
  },
};

/**
 * The Q-tag pills in a reply: `question-tags.json` in
 * packages/gx-chat-core/visual (desktop reads it in `open_questions.rs`), one tone per state of the
 * tag's question (gx-chat-core `TagState`, where the user's 2026-10-15 decision lives).
 *
 * The phone is its own repo and cannot import that file, so these numbers are a copy; keep them equal
 * to it. User (2026-11-11): "let's change these to the same #F472B6 color that we use to represent
 * questions everywhere pls": a waiting (open) tag is the question pink, #f472b6 on a dark chat and
 * #be185d on a light one, as `ROW_QUESTION` and the marked "Needs you" headings are.
 */
export const QUESTION_TAGS = {
  radius: 6,
  paddingX: 5,
  iconSize: 12,
  gap: 3,
  tone: {
    dark: {
      open: { text: '#f472b6', border: 'rgba(244,114,182,0.4)' },
      answered: { text: '#a3c9aa', border: 'rgba(143,191,153,0.3)' },
      withdrawn: { text: '#838383', border: 'rgba(255,255,255,0.13)' },
      skipped: { text: '#838383', border: 'rgba(255,255,255,0.13)' },
    },
    light: {
      open: { text: '#be185d', border: 'rgba(190,24,93,0.4)' },
      answered: { text: '#3f6e4a', border: 'rgba(79,138,92,0.34)' },
      withdrawn: { text: '#71717a', border: 'rgba(0,0,0,0.16)' },
      skipped: { text: '#71717a', border: 'rgba(0,0,0,0.16)' },
    },
  },
} as const;

export type QuestionTagState = keyof typeof QUESTION_TAGS.tone.dark;

/**
 * The question a jump just landed on; `key` changes with every jump so a repeat flashes again.
 * `question` is the tag a Q-tag link named (`jump.question`), so the jump lands on that question.
 */
export type QuestionFlash = { target: string; question: string | null; key: number };

const FlashContext = createContext<QuestionFlash | null>(null);
export const QuestionFlashProvider = FlashContext.Provider;

/**
 * Where the jump's card and question are drawn, for Transcript.tsx to measure once the row is on
 * screen: the card under its id, the named form question under `questionAnchorKey`.
 */
export type QuestionAnchors = Map<string, ViewInstance>;
const AnchorsContext = createContext<QuestionAnchors | null>(null);
export const QuestionAnchorsProvider = AnchorsContext.Provider;

export function questionAnchorKey(form: string, tag: string): string {
  return `${form}#${tag.toUpperCase()}`;
}

/** A ref that files its view under `key` while `key` is set. */
function useAnchorRef(key: string | null) {
  const anchors = useContext(AnchorsContext);
  return useCallback(
    (view: ViewInstance | null) => {
      if (anchors === null || key === null) return;
      if (view) anchors.set(key, view);
      else anchors.delete(key);
    },
    [anchors, key],
  );
}

/** The ref a form question puts on its own view: filed while a Q-tag jump names it. */
export function useQuestionAnchor(form: string, tag: string) {
  const flash = useContext(FlashContext);
  const named =
    flash !== null &&
    flash.target === form &&
    tag.length > 0 &&
    flash.question !== null &&
    flash.question.toUpperCase() === tag.toUpperCase();
  return useAnchorRef(named ? questionAnchorKey(form, tag) : null);
}

/** A question form or page card, outlined for a moment when a jump lands on it. */
export function QuestionFlashFrame({
  target,
  light,
  children,
}: {
  target: string;
  light: boolean;
  children: ReactNode;
}) {
  const flash = useContext(FlashContext);
  const active = flash !== null && target.length > 0 && flash.target === target;
  const opacity = useRef(new Animated.Value(0)).current;
  const key = active ? flash.key : null;
  useEffect(() => {
    if (key === null) {
      opacity.setValue(0);
      return;
    }
    opacity.setValue(1);
    const fade = Animated.timing(opacity, {
      toValue: 0,
      duration: QUESTION_PILL.flashMs / 3,
      delay: (QUESTION_PILL.flashMs * 2) / 3,
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [key, opacity]);
  const anchor = useAnchorRef(active ? target : null);
  const ring = (light ? QUESTION_PILL.tone.light : QUESTION_PILL.tone.dark).ring;
  return (
    <View ref={anchor} collapsable={false}>
      {children}
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, { borderColor: ring, backgroundColor: `${ring}14`, opacity }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 18, borderWidth: 2 },
});
