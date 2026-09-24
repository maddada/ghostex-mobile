/**
 * The refusal a send gets when the agent CLI never painted an input box (a trust prompt, an auth
 * screen, a first-run step): `operationErrorCode === 'composerNotReady'`. Port of desktop
 * `composer_not_ready.rs`: the headline, the reason, the terminal's current screen on demand
 * (`terminalTail.notice`, re-read on every Show) and the switch to the terminal.
 *
 * Any other refused operation is the plain error line desktop draws in the same place.
 */

import { ScrollView, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph } from './icons';
import { MONO_FONT, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { CARD_LINE_HEIGHT, CARD_TEXT_SIZE, ChatButton, StatusCard, useCardText } from './primitives';
import type { CardHostAction } from './types';

const NOT_READY_HEADLINE = 'Message not sent. Your draft was restored.';

export function composerNotReady(document: ChatDocument): boolean {
  return document.operationErrorCode === 'composerNotReady' && typeof document.operationError === 'string';
}

export function ComposerNotReadyCard({
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
  const P = useTranscriptTheme();
  if (!composerNotReady(document)) {
    if (typeof document.operationError !== 'string') return null;
    return (
      <Text accessibilityRole="alert" style={cardText.error}>
        {document.operationError}
      </Text>
    );
  }
  const notice = document.terminalTail?.notice;
  const open = notice?.open === true;
  const reason = document.operationError ?? '';
  const body = [
    reason.length > 0 && reason !== NOT_READY_HEADLINE ? (
      <Text key="reason" style={cardText.prose}>
        {reason}
      </Text>
    ) : null,
    open ? (
      <View key="tail" style={styles.tailBox}>
        {notice.loading ? (
          <Text style={styles.tailStatus}>Reading the terminal…</Text>
        ) : notice.error !== null && notice.error !== undefined ? (
          <Text style={styles.tailStatus}>{notice.error}</Text>
        ) : notice.excerpt.length > 0 ? (
          <ScrollView style={styles.tailScroll} nestedScrollEnabled>
            <Text style={styles.tailText} selectable>
              {notice.excerpt}
            </Text>
          </ScrollView>
        ) : (
          <Text style={styles.tailStatus}>{notice.empty ?? ''}</Text>
        )}
      </View>
    ) : null,
  ];
  const actions = [
    <ChatButton
      key="toggle"
      icon={open ? 'chevron-down' : 'chevron-right'}
      label={open ? 'Hide terminal' : 'Show terminal'}
      onPress={() => chat.dispatch({ type: 'terminalTailToggle' })}
    />,
    onHostAction ? (
      <ChatButton key="terminal" icon="terminal-2" label="Terminal View" onPress={() => onHostAction('terminalView')} />
    ) : null,
  ];
  const header = (
    <View style={styles.header}>
      <View style={styles.headerIcon}>
        <Glyph name="alert-circle" size={14} color={P.error} />
      </View>
      <Text style={styles.headline}>{NOT_READY_HEADLINE}</Text>
    </View>
  );
  return (
    <View accessibilityRole="alert" style={styles.fill}>
      <StatusCard header={header} body={body} actions={actions} />
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  fill: {
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  headerIcon: {
    height: CARD_LINE_HEIGHT,
    justifyContent: 'center',
  },
  headline: {
    flex: 1,
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: CARD_LINE_HEIGHT,
    fontWeight: '500',
  },
  tailBox: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.wellFill,
  },
  tailStatus: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: P.cardMuted,
    fontSize: 12,
  },
  tailScroll: {
    maxHeight: 192,
  },
  tailText: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: P.foreground,
    fontFamily: MONO_FONT,
    fontSize: 11,
    lineHeight: 16,
  },
}));
