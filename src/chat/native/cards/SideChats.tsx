/**
 * Side chats on the phone: the Side chats pill's sheet (one row per side chat of this session, a tap
 * opening it as its own chat, with Bring back and Delete) and the "Side chat of" bar at the top of a
 * side chat's own chat. Rows, labels and the calls come from the core (gx-chat-core
 * `extras/side_chats.rs`, where the user's decision lives); the desktop's twin is
 * apps/desktop/src/app/native_chat/side_chats.rs.
 */
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { waitingColor } from './AgentPanels';
import { Glyph } from './icons';
import { arr, isTrue, obj, str } from './json';
import { TranscriptEnvProvider, type TranscriptEnv } from '../transcript/context';
import { SessionPill } from '../transcript/SessionPill';
import { PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';

/** The sidebar's working colour, as the Workers sheet uses it. */
const WORKING = '#c68a06';

function rowStatus(row: unknown): string {
  const waiting = str(row, 'waiting');
  if (waiting === 'approval') return 'Needs your approval';
  if (waiting === 'question') return 'Waiting for an answer';
  if (isTrue(row, 'working')) return 'Working';
  if (isTrue(row, 'unread')) return 'New reply';
  if (isTrue(row, 'sleeping')) return 'Sleeping';
  return '';
}

function IconButton({
  glyph,
  label,
  onPress,
}: {
  glyph: 'arrow-back-up' | 'trash';
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
    >
      <Glyph name={glyph} size={16} color={P.cardMuted} />
    </Pressable>
  );
}

/** The Side chats pill's sheet (`sideChatsPanel`). A row opens that side chat and closes the sheet. */
export function SideChatsMenu({
  chat,
  document,
  onDone,
}: {
  chat: RustChat;
  document: ChatDocument;
  onDone: () => void;
}) {
  const styles = useStyles();
  const panel = obj(document.sideChatsPanel);
  if (panel === null) return null;
  const headerWaiting = waitingColor(str(panel, 'waiting'));
  return (
    <View accessibilityLabel="Side chats" style={styles.menu}>
      <View style={styles.menuMeta}>
        <Text style={styles.meta} numberOfLines={1}>
          {str(panel, 'meta')}
        </Text>
        {headerWaiting !== null ? <View style={[styles.dot, { backgroundColor: headerWaiting }]} /> : null}
      </View>
      <ScrollView style={styles.menuRows} contentContainerStyle={styles.rows} nestedScrollEnabled>
        {arr(panel.rows).map((row, index) => (
          <SideChatRow key={str(row, 'sessionId') || String(index)} row={row} chat={chat} onDone={onDone} />
        ))}
      </ScrollView>
    </View>
  );
}

function SideChatRow({ row, chat, onDone }: { row: unknown; chat: RustChat; onDone: () => void }) {
  const styles = useStyles();
  const title = str(row, 'title');
  const sessionId = str(row, 'sessionId');
  const waiting = waitingColor(str(row, 'waiting'));
  const status = rowStatus(row);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open side chat ${title}`}
      onPress={() => {
        chat.dispatch({ type: 'openSideChat', projectId: str(row, 'projectId'), sessionId });
        onDone();
      }}
      style={styles.row}
    >
      <View style={styles.marker}>
        {waiting !== null ? (
          <View style={[styles.dot, { backgroundColor: waiting }]} />
        ) : isTrue(row, 'working') ? (
          <View style={[styles.dot, { backgroundColor: WORKING }]} />
        ) : (
          <View style={styles.ring} />
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {status.length > 0 ? (
          <Text style={styles.detail} numberOfLines={1}>
            {status}
          </Text>
        ) : null}
      </View>
      <IconButton
        glyph="arrow-back-up"
        label="Bring back to this chat"
        onPress={() => {
          chat.dispatch({ type: 'bringBackSideChat', sessionId });
          onDone();
        }}
      />
      <IconButton
        glyph="trash"
        label="Delete side chat"
        onPress={() => chat.dispatch({ type: 'deleteSideChat', sessionId })}
      />
    </Pressable>
  );
}

/** The bar at the top of a side chat's own chat: whose side chat it is, Bring back and Delete. */
export function SideChatBar({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const bar = obj(document.sideChatOf);
  const { dispatch } = chat;
  // The pill is the card pill of "Message from" cards, which reads the transcript's env.
  const env = useMemo<TranscriptEnv>(
    () => ({
      dispatch,
      theme: P,
      simple: false,
      workOpen: false,
      filePreviews: false,
      mutedThinking: false,
      main: false,
    }),
    [dispatch, P],
  );
  if (bar === null) return null;
  const parent = str(bar, 'parentTitle');
  return (
    <View accessibilityLabel={`Side chat of ${parent}`} style={styles.bar}>
      <Glyph name="messages" size={14} color={P.cardMuted} />
      <Text style={styles.barLabel}>Side chat of</Text>
      <View style={styles.barParent}>
        <TranscriptEnvProvider value={env}>
          <SessionPill pill={obj(bar.parentPill) ?? {}} textStyle={styles.barParentText} plain />
        </TranscriptEnvProvider>
      </View>
      <IconButton
        glyph="arrow-back-up"
        label="Bring back to the main session"
        onPress={() => chat.dispatch({ type: 'bringBackSideChat' })}
      />
      <IconButton glyph="trash" label="Delete side chat" onPress={() => chat.dispatch({ type: 'deleteSideChat' })} />
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  menu: {
    flexShrink: 1,
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  menuMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  meta: {
    flex: 1,
    minWidth: 0,
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  menuRows: {
    flexShrink: 1,
  },
  rows: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  marker: {
    width: 13,
    height: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  ring: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: P.mutedInk(0.7),
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: P.foreground,
    fontSize: PROSE_SIZE,
  },
  detail: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    backgroundColor: P.ink(0.08),
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: P.ink(0.08),
  },
  barLabel: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
  },
  barParent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
  },
  barParentText: {
    color: P.foreground,
    fontSize: PROSE_SIZE - 1,
  },
}));
