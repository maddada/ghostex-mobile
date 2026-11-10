/**
 * "How to use coordinators": the sheet the coordinator tips' pill opens. The text comes from the
 * core (`coordinatorIntro`, packages/gx-chat-core/src/extras/coordinator_intro.rs in the Ghostex main
 * repo, where the user's decision lives): each tip is its own card in the Settings style (an icon
 * tile, a title and a muted line) with a line to type that a tap puts in the chat box. "Don't show
 * again" is a checkbox that applies when the sheet closes (`PillMenuSheet`): gxserver then drops the
 * pill from every coordinator. Desktop: apps/desktop/src/app/native_chat/coordinator_intro.rs.
 */

import { Pressable, ScrollView, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import type { UserAction } from '../../rust/actions';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Glyph, type GlyphName } from './icons';

export type CoordinatorIntroTip = { icon: string; title: string; detail: string; example: string };
export type CoordinatorIntro = {
  title: string;
  lede: string;
  exampleHint: string;
  dontShowAgain: string;
  dontShowAgainNote: string;
  tips: CoordinatorIntroTip[];
};

/** The pill's id in `chatPills`. */
export const INTRO_PILL = 'coordinatorIntro';

/** The tips on the document, or null where the pill does not show. */
export function coordinatorIntro(document: ChatDocument): CoordinatorIntro | null {
  const intro = (document as ChatDocument & { coordinatorIntro?: CoordinatorIntro | null }).coordinatorIntro;
  return intro !== null && typeof intro === 'object' && Array.isArray(intro.tips) ? intro : null;
}

const TIP_GLYPHS: Record<string, GlyphName> = {
  'coordinator-captain-hat': 'coordinator-captain-hat',
  // The desktop's small-size copy of the same picture; the phone draws the picture itself.
  'coordinator-captain-hat-small': 'coordinator-captain-hat',
  // An older chat core still names the crown.
  'coordinator-crown': 'coordinator-captain-hat',
  'file-type-html': 'file-type-html',
  microscope: 'microscope',
  photo: 'photo',
  'users-group': 'users-group',
  checklist: 'checklist',
  'layout-board-split': 'layout-board-split',
  note: 'note',
  bell: 'bell',
  'device-desktop': 'device-desktop',
};

export function CoordinatorIntroMenu({
  chat,
  document,
  dontShowAgain,
  onDontShowAgain,
  onDone,
}: {
  chat: RustChat;
  document: ChatDocument;
  dontShowAgain: boolean;
  onDontShowAgain: (ticked: boolean) => void;
  onDone: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const intro = coordinatorIntro(document);
  if (intro === null) return null;
  const useExample = (example: string) => {
    chat.dispatch({
      type: 'useCoordinatorIntroExample',
      example,
      text: chat.state?.composer.text ?? '',
    } as unknown as UserAction);
    onDone();
  };
  return (
    <View style={styles.menu}>
      <ScrollView style={styles.rows} nestedScrollEnabled>
        <Text style={styles.lede}>{intro.lede}</Text>
        {intro.tips.map((tip) => (
          <View key={tip.title} style={styles.card} accessibilityLabel={tip.title}>
            <View style={styles.tile}>
              <Glyph name={TIP_GLYPHS[tip.icon] ?? 'bulb'} size={17} color={P.cardMuted} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.title}>{tip.title}</Text>
              <Text style={styles.detail}>{tip.detail}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Put in the chat box: ${tip.example}`}
                onPress={() => useExample(tip.example)}
                style={({ pressed }) => [styles.example, pressed && styles.examplePressed]}
              >
                <Glyph name="arrow-down-left" size={12} color={P.muted} />
                <Text style={styles.exampleText} numberOfLines={1}>
                  {tip.example}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Text style={styles.hint}>{intro.exampleHint}</Text>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: dontShowAgain }}
          accessibilityLabel={intro.dontShowAgain}
          onPress={() => onDontShowAgain(!dontShowAgain)}
          hitSlop={6}
          style={styles.checkRow}
        >
          <View style={[styles.check, dontShowAgain && styles.checkTicked]}>
            {dontShowAgain ? <Glyph name="check" size={12} color={P.foreground} /> : null}
          </View>
          <Text style={styles.checkLabel}>{intro.dontShowAgain}</Text>
        </Pressable>
        <Text style={styles.note}>{intro.dontShowAgainNote}</Text>
      </View>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  menu: {
    flexShrink: 1,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  rows: {
    flexShrink: 1,
  },
  lede: {
    color: P.cardMuted,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  /** One tip: Settings' card look (fields/row.rs), a hairline and a faint wash, no black fill. */
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.ink(0.03),
  },
  /** Settings' icon tile: 34pt, a 9pt radius, a hairline and a faint wash. */
  tile: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.ink(0.035),
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: P.foreground,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
  },
  detail: {
    color: P.cardMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  example: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    height: 30,
    borderRadius: 7,
    backgroundColor: P.ink(0.045),
  },
  examplePressed: {
    backgroundColor: P.ink(0.09),
  },
  exampleText: {
    flexShrink: 1,
    color: P.foreground,
    fontSize: 12.5,
  },
  hint: {
    color: P.muted,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: P.border,
    paddingTop: 10,
    paddingHorizontal: 4,
    gap: 3,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: P.ink(0.28),
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkTicked: {
    borderColor: P.ink(0.7),
    backgroundColor: P.ink(0.14),
  },
  checkLabel: {
    color: P.foreground,
    fontSize: 14,
  },
  note: {
    color: P.muted,
    fontSize: 12,
    lineHeight: 16,
    paddingLeft: 26,
  },
}));
