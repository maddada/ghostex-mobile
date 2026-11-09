/**
 * Your messages under the opt-in chat look (`chatLook` in the chat document): Message layout's Left
 * aligned and Your messages' Band. At Default nothing here runs and your message is today's
 * right-aligned bubble (`MessageRow.tsx` `UserMessage`). Port of
 * desktop `user_message_look.rs`, with its sizes; the column is the screen's width less the
 * transcript's own padding.
 *
 * Left aligned keeps the bubble and moves it to the agent's left edge; Band draws your message across the column on a fill one step off the bubble's, in brighter text. Each style applies to every row you wrote (sent, queued, waiting or not sent); the queued message's play and Back to composer icons stay tappable at the message's right end, and every other action stays in its long-press menu.
 *
 * CDXC:SessionChat 2026-11-07 SEE-ALSO:
 * packages/gx-chat-core/src/transcript/chat_look.rs (the user decisions, the settings and the implied Left), apps/desktop/src/app/native_chat/user_message_look.rs (the desktop draws the same looks).
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { mixHexColors } from '../../../theme/palette';
import { stepTowardHex } from '../../../theme/sidebarAppearance';
import type { ChatLook, ProjectedMessage } from '../../rust/document';
import { useTranscriptEnv } from './context';
import { ImageRow } from './Images';
import { DeliveryIndicator, UserActions } from './MessageActions';
import { MessageLongPressContext } from './markdown/blockLongPress';
import { MessageSelection } from './messageSelection';
import { StartupDelivery } from './SystemRows';
import { strengthenedText } from './textStrength';
import { MESSAGE_PART_GAP, type TranscriptTheme } from './theme';

/** How far the Band's fill sits off the background: one input step further than the bubble's (`input`). */
const BAND_STEP_DARK = 0.03 * 2;
const BAND_STEP_LIGHT = 0.032 * 2;

/** Your message's text under Your messages Band: a third of the way from the foreground to the bubble's text, at the chat's Text strength (desktop `user_style_prose`). */
export function userStyleProse(theme: TranscriptTheme, strength: number): string {
  return strengthenedText(mixHexColors(theme.primary, theme.foreground, 100 / 3), strength, theme.light);
}

/** The Band's fill (desktop `ChatAppearance.user_band`). */
function userBandFill(theme: TranscriptTheme): string {
  return stepTowardHex(theme.background, !theme.light, theme.light ? BAND_STEP_LIGHT : BAND_STEP_DARK);
}

/**
 * Your message on the left: the bubble, or under Band your words across the column with the delivery and queued icons at its right end. `children` is the message's text (and
 * its Show more); `openMenu` the hold's menu.
 */
export function LeftUserMessage({
  message,
  look,
  hasBody,
  openMenu,
  children,
}: {
  message: ProjectedMessage;
  look: ChatLook;
  hasBody: boolean;
  openMenu: ((selectedWords?: string) => void) | undefined;
  children: ReactNode;
}) {
  const { theme } = useTranscriptEnv();
  const band = look.userStyle === 'band';
  const frameStyle = band
    ? [styles.line, styles.band, { backgroundColor: userBandFill(theme) }]
    : [styles.bubble, { backgroundColor: theme.input }];
  // Under Band the icons sit inside the full-width line, at its right end.
  const inside = band;
  const words = inside ? <View style={styles.words}>{children}</View> : children;
  const content = (
    <>
      {words}
      {inside ? <DeliveryIndicator message={message} inline /> : null}
    </>
  );
  const frame = !hasBody ? (
    // Pictures alone: the icons still take the row's right end.
    inside ? (
      <View style={styles.line}>
        <View style={styles.words} />
        <DeliveryIndicator message={message} inline />
      </View>
    ) : null
  ) : openMenu === undefined ? (
    <View style={frameStyle}>{content}</View>
  ) : (
    <MessageSelection openMenu={openMenu} style={frameStyle}>
      <MessageLongPressContext.Provider value={openMenu}>{content}</MessageLongPressContext.Provider>
    </MessageSelection>
  );
  const column = (
    <View style={[styles.column, inside && styles.columnStretch]}>
      {inside ? (
        frame
      ) : (
        <View style={styles.bubbleRow}>
          {frame}
          <DeliveryIndicator message={message} />
        </View>
      )}
      {/* The not-sent note under the message, on its own side, as the desktop draws it. */}
      <StartupDelivery message={message} waitingLine={false} end={false} />
      <UserActions message={message} start />
    </View>
  );
  const spoken = `user message: ${(typeof message.text === 'string' ? message.text : '').slice(0, 2000)}`;
  return (
    <View style={styles.message} accessibilityLabel={spoken}>
      <ImageRow images={message.images} user end={false} />
      {column}
    </View>
  );
}

const styles = StyleSheet.create({
  message: { gap: MESSAGE_PART_GAP, minWidth: 0 },
  column: { alignItems: 'flex-start', gap: 4 },
  columnStretch: { alignItems: 'stretch' },
  bubbleRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 6,
  },
  bubble: { maxWidth: '80%', flexShrink: 1, borderRadius: 16, padding: 12 },
  line: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, minWidth: 0 },
  words: { flex: 1, minWidth: 0 },
  band: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
});
