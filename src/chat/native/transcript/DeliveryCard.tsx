/**
 * The card under a message that has not reached the agent: the chat core's `deliveryCards` entry
 * for it (packages/gx-chat-core/src/composer/delivery_card.rs), in the Dictate card's shape
 * (`composer/DictationBar.tsx`): the level's icon, the title and ⋯ on one line, one sentence, the
 * main actions as filled buttons. Only the icon carries the level's colour.
 *
 * CDXC:SessionChat 2026-11-13 DECISION:
 * User, of the failed send's loose grey line with bare Retry and Remove under the bubble: "these look so out of place here". Q2941 B: the Dictate card right under the bubble, keeping every action ("please don't lose options", with a 3 dots menu when there are too many); Q2944: the level shows only in the icon's colour. The note used to draw above the bubble on the phone; the card sits under it, at the bubble's side.
 * SEE-ALSO: apps/desktop/src/app/native_chat/delivery_card.rs (the desktop's card).
 */

import { StyleSheet, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import { CardMoreMenu } from '../cards/CardMoreMenu';
import { toneLook, ToneButton } from '../cards/ToneCard';
import type { GlyphName as CardGlyphName } from '../cards/icons';
import { Glyph as CardGlyph } from '../cards/icons';
import type { MenuRow } from '../composer/MenuSheet';
import { useTranscriptEnv } from './context';
import { arr, obj, str, type JsonRecord } from './json';

/** The icons a card's buttons and menu rows name, as the menu's icon files. */
const MENU_ICONS: Record<string, string> = {
  refresh: 'titlebar/refresh.svg',
  'terminal-2': 'titlebar/terminal-2.svg',
  trash: 'titlebar/trash.svg',
  pencil: 'titlebar/pencil.svg',
};

const BUTTON_ICONS: Record<string, CardGlyphName> = {
  refresh: 'refresh',
  'terminal-2': 'terminal-2',
};

export function DeliveryCard({ card, end = true }: { card: JsonRecord; end?: boolean }) {
  const { theme, dispatch } = useTranscriptEnv();
  const level = str(card, 'level');
  // Working stays muted: the spinner beside the bubble already turns.
  const hue = level === 'failed' ? toneLook('error', theme.light).hue : level === 'needs' ? toneLook('wait', theme.light).hue : null;
  const run = (item: JsonRecord) => {
    const command = obj(item.command);
    if (command !== null) dispatch(command as unknown as UserAction);
  };
  const menu: MenuRow[] = arr(card.menu)
    .map((item) => obj(item))
    .filter((item): item is JsonRecord => item !== null)
    .map((item) => {
      const icon = MENU_ICONS[str(item, 'icon')];
      return { label: str(item, 'label'), command: item.command, ...(icon === undefined ? {} : { iconPath: icon }) };
    });
  const buttons = arr(card.buttons)
    .map((item) => obj(item))
    .filter((item): item is JsonRecord => item !== null);
  const title = str(card, 'title');
  const sentence = str(card, 'sentence');
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${sentence}`}
      style={[
        styles.card,
        end ? styles.end : styles.start,
        { borderColor: theme.composerBorder, backgroundColor: theme.composerBackground },
      ]}
    >
      <View style={styles.head}>
        <CardGlyph name={level === 'failed' ? 'alert-circle' : 'clock'} size={15} color={hue ?? theme.muted} />
        <Text numberOfLines={1} style={[styles.title, { color: theme.foreground }]}>
          {title}
        </Text>
        <CardMoreMenu rows={menu} dispatch={dispatch} color={theme.muted} size={16} />
      </View>
      <Text style={[styles.sentence, { color: theme.cardMuted }]}>{sentence}</Text>
      {buttons.length > 0 ? (
        <View style={styles.buttons}>
          {buttons.map((item) => (
            <ToneButton
              key={str(item, 'id')}
              label={str(item, 'label')}
              icon={BUTTON_ICONS[str(item, 'icon')]}
              kind={item.primary === true ? 'primary' : 'secondary'}
              onPress={() => run(item)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '88%',
    maxWidth: 380,
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 15,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 11,
    gap: 4,
  },
  end: { alignSelf: 'flex-end' },
  start: { alignSelf: 'flex-start' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  title: { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 18, fontWeight: '600' },
  sentence: { fontSize: 13, lineHeight: 18, paddingRight: 7 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 6, paddingRight: 7 },
});
