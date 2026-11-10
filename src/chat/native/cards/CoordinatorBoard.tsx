/**
 * A coordinator's board, the Board pill's sheet: its lines of work grouped by who has the ball
 * (Backlog, To do, Needs you, Blocked, On hold, In progress, Done today, Removed), each a card of its title and
 * its work's links.
 * Groups, rows, tags, folds and counts come from the core (gx-chat-core
 * `extras/coordinator_board.rs`, where the user's decision lives); this only lays them out. A row
 * opens its thread, its question card or its link, as the desktop's side panel does
 * (`apps/desktop/src/app/native_chat/coordinator_board.rs`).
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import { SidebarPalette } from '../../../theme/palette';
import { Glyph, type GlyphName } from './icons';
import type { TablerIconComponent } from '../../../assets/tablerIcons.generated';
import { TagGlyph } from '../../../components/sessions/icons';
import { customSessionTagIcon, sessionTagIcon } from '../../../contract/sessionTags';
import { arr, asJson, isTrue, num, obj, str } from './json';
import { PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { remoteWorkerNotice } from './remoteWorker';
import { AgentMark } from './agentMark';
import { BoardRelayButtons } from './RelayedApprovalCard';
import { openRelayedCardForThread } from './relayedApprovals';
import { openQuestionReply } from '../transcript/QuestionReply';

/** An opened card's Reply, Open, Show in chat, Dismiss and Snooze (desktop `board_card_buttons`). */
function BoardCardActions({ row, chat, onDone }: { row: unknown; chat: RustChat; onDone: () => void }) {
  const styles = useStyles();
  const [snoozing, setSnoozing] = useState(false);
  const actions = obj(obj(row)?.actions);
  if (actions === null) return null;
  const reply = obj(actions.reply);
  const snooze = arr(actions.snooze)
    .map(obj)
    .filter((choice): choice is Record<string, unknown> => choice !== null);
  const button = (label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.cardButton, pressed && styles.cardButtonPressed]}
    >
      <Text style={styles.cardButtonText}>{label}</Text>
    </Pressable>
  );
  const run = (command: unknown) => {
    chat.dispatch(command as unknown as UserAction);
    onDone();
  };
  return (
    <>
      {reply !== null
        ? button('Reply', () => {
            onDone();
            openQuestionReply({
              form: typeof reply.form === 'string' ? reply.form : null,
              tag: str(reply, 'tag'),
              ...(typeof reply.item === 'string' ? { item: reply.item, key: str(reply, 'key') } : {}),
            });
          })
        : null}
      {obj(actions.open) !== null ? button('Open', () => run(actions.open)) : null}
      {obj(actions.showInChat) !== null ? button('Show in chat', () => run(actions.showInChat)) : null}
      {obj(actions.dismiss) !== null ? button('Dismiss', () => run(actions.dismiss)) : null}
      {snooze.length > 0 ? button(snoozing ? 'Snooze for' : 'Snooze', () => setSnoozing((was) => !was)) : null}
      {snoozing ? snooze.map((choice) => button(str(choice, 'label'), () => run(choice.command))) : null}
    </>
  );
}

/** Each group's colour: the sidebar's question pink, approval red and working amber. */
const GROUP_COLOR: Record<string, string | null> = {
  needs: SidebarPalette.ROW_QUESTION,
  blocked: SidebarPalette.ROW_APPROVAL,
  // On hold: waiting on something outside, a calm blue-grey (desktop `HOLD_COLOR`).
  hold: '#7fa1c4',
  moving: '#c68a06',
  done: '#2fa865',
};

/** A chip's words: what the link is, then its label ("PR #414", "Issue #12", "GHX-142"). */
function chipLabel(kind: string, label: string): string {
  switch (kind) {
    case 'pr':
      return `PR ${label}`;
    case 'issue':
      return `Issue ${label}`;
    default:
      return label;
  }
}

/** A tag's tint (`BoardTag::tone`), or null for the muted chip. */
export function toneColor(tone: string): string | null {
  switch (tone) {
    case 'question':
      return SidebarPalette.ROW_QUESTION;
    case 'bad':
      return SidebarPalette.ROW_APPROVAL;
    case 'running':
    case 'warn':
      return '#c68a06';
    case 'good':
      return '#2fa865';
    case 'held':
    case 'merged':
      return '#8b78f0';
    case 'closed':
      return '#8a8f98';
    default:
      return null;
  }
}

/** The group's marker: a ring with a dot, a filled disc, a dashed ring or a check. */
function GroupMarker({ group }: { group: string }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const color = GROUP_COLOR[group] ?? P.cardMuted;
  if (group === 'done') return <Glyph name="circle-check-filled" size={12} color={color} />;
  // On hold: two bars, a pause (desktop `player-pause`).
  if (group === 'hold') {
    return (
      <View style={styles.pause}>
        <View style={[styles.pauseBar, { backgroundColor: color }]} />
        <View style={[styles.pauseBar, { backgroundColor: color }]} />
      </View>
    );
  }
  if (group === 'blocked' || group === 'moving') {
    return <View style={[styles.disc, { backgroundColor: color }]} />;
  }
  if (group === 'needs') {
    return (
      <View style={[styles.ring, { borderColor: color }]}>
        <View style={[styles.ringDot, { backgroundColor: color }]} />
      </View>
    );
  }
  return <View style={[styles.ring, { borderColor: color, borderStyle: 'dashed' }]} />;
}

/** The Blocked pill's id (gx-chat-core `BLOCKED_PILL`): a tap opens the board at Blocked. */
export const BLOCKED_PILL = 'boardBlocked';

/** The user's own tag on a card: the sidebar's glyph and colour (gx-chat-core `userTag`). */
function UserTagChip({ tag }: { tag: unknown }) {
  const styles = useStyles();
  const color = str(tag, 'color') || '#8e949d';
  const Icon = tagIcon(str(tag, 'icon'));
  return (
    <View accessibilityLabel={str(tag, 'title')} style={[styles.tag, { borderColor: `${color}73` }]}>
      <Icon size={12} color={color} />
      <Text style={styles.tagText} numberOfLines={1}>
        {str(tag, 'label')}
      </Text>
    </View>
  );
}

/** A tag's glyph from its asset name (`star-filled`, `brand-github`): a built-in's by its value,
 * a custom tag's by its catalog icon id. */
function tagIcon(icon: string): TablerIconComponent {
  const builtin: Record<string, string> = {
    'star-filled': 'favorite',
    'alert-triangle': 'high-priority',
    'arrow-down': 'low-priority',
    microscope: 'research',
    checkbox: 'todo',
    'player-play': 'in-progress',
    'test-pipe': 'testing',
    'barrier-block': 'blocked',
    'player-pause': 'on-hold',
    'circle-check': 'done',
    bug: 'bug',
    puzzle: 'feature',
    palette: 'design',
  };
  const tag = builtin[icon];
  if (tag !== undefined) return sessionTagIcon(tag) ?? TagGlyph;
  const id =
    icon === 'terminal-2' ? 'terminal' : icon.replace(/-([a-z0-9])/gu, (_, next: string) => next.toUpperCase());
  return customSessionTagIcon(id);
}

/** Which glyph a menu row draws (gx-chat-core `BoardMenuItem::icon`). */
function menuGlyph(icon: string): GlyphName {
  switch (icon) {
    case 'external-link':
    case 'message-plus':
    case 'circle-check':
    case 'tag':
    case 'trash':
    case 'arrow-back-up':
      return icon;
    default:
      return 'chevron-right';
  }
}

/**
 * A card's menu, opened in place under the held card: the core's rows (Open, Mention in chat,
 * Tags, Mark done, Remove or Restore), and Tags turning the list into the sidebar's tags with a
 * back row, as the desktop's menu reopens in place. In place rather than a second sheet, which iOS
 * cannot show over the board's own.
 */
function CardMenu({
  row,
  tagOptions,
  tagsPage,
  onTags,
  onPick,
}: {
  row: unknown;
  tagOptions: unknown[];
  tagsPage: boolean;
  onTags: (open: boolean) => void;
  onPick: (command: Record<string, unknown>) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const setTag = obj(obj(row)?.setTag);
  const current = str(row, 'tag');
  if (tagsPage && setTag !== null) {
    return (
      <View style={styles.cardMenu}>
        <Pressable accessibilityRole="button" onPress={() => onTags(false)} style={styles.cardMenuRow}>
          <Glyph name="chevron-left" size={15} color={P.cardMuted} />
          <Text style={[styles.cardMenuText, { color: P.cardMuted }]}>Tags</Text>
        </Pressable>
        {current.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onPick({ ...setTag, tag: '' })}
            style={styles.cardMenuRow}
          >
            <Glyph name="x" size={15} color={P.cardMuted} />
            <Text style={styles.cardMenuText}>No tag</Text>
          </Pressable>
        ) : null}
        {tagOptions.map((option) => {
          const value = str(option, 'value');
          const Icon = tagIcon(str(option, 'icon'));
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: value === current }}
              onPress={() => onPick({ ...setTag, tag: value })}
              style={styles.cardMenuRow}
            >
              <Icon size={15} color={str(option, 'color') || P.cardMuted} />
              <Text style={[styles.cardMenuText, styles.flex]}>{str(option, 'label')}</Text>
              {value === current ? <Glyph name="check" size={14} color={P.cardMuted} /> : null}
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={styles.cardMenu}>
      {arr(obj(row)?.menu).map((item, index) => {
        const destructive = isTrue(item, 'destructive');
        const color = destructive ? SidebarPalette.ROW_APPROVAL : P.foreground;
        const command = obj(obj(item)?.command);
        const tags = str(item, 'submenu') === 'tags';
        return (
          <Pressable
            key={`${index}:${str(item, 'label')}`}
            accessibilityRole="button"
            onPress={() => (tags ? onTags(true) : command !== null ? onPick(command) : undefined)}
            style={styles.cardMenuRow}
          >
            {str(item, 'icon') === 'agent' ? (
              <AgentMark icon={str(row, 'agentIcon') || null} size={15} />
            ) : (
              <Glyph name={menuGlyph(str(item, 'icon'))} size={15} color={color} />
            )}
            <Text style={[styles.cardMenuText, styles.flex, { color }]}>{str(item, 'label')}</Text>
            {tags ? <Glyph name="chevron-right" size={14} color={P.cardMuted} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A board pill's tap (gx-chat-core `show_item`): the card to show, once per `seq`. */
export type BoardFocus = { key: string; seq: number };

export function CoordinatorBoardMenu({
  chat,
  document,
  onDone,
  focus = null,
}: {
  chat: RustChat;
  document: ChatDocument;
  onDone: () => void;
  /** The card to scroll to and ring for a moment (desktop `scroll_into_view`). */
  focus?: BoardFocus | null;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  // Where each group sits in the list and each card in its group, so a board pill's card can be
  // scrolled to once both are known.
  const list = useRef<ScrollViewInstance>(null);
  const groupTops = useRef<Record<string, number>>({});
  const cardTops = useRef<Record<string, { group: string; y: number }>>({});
  const scrolledFor = useRef<number | null>(null);
  const [ringed, setRinged] = useState<string | null>(null);
  const scrollToFocus = () => {
    if (focus === null || scrolledFor.current === focus.seq) return;
    const card = cardTops.current[focus.key];
    const group = card !== undefined ? groupTops.current[card.group] : undefined;
    if (card === undefined || group === undefined) return;
    scrolledFor.current = focus.seq;
    list.current?.scrollTo({ y: Math.max(0, group + card.y - 8), animated: true });
  };
  useEffect(() => {
    if (focus === null) return undefined;
    setRinged(focus.key);
    scrollToFocus();
    const timer = setTimeout(() => setRinged(null), 2200);
    return () => clearTimeout(timer);
    // `scrollToFocus` reads refs; a new tap is a new `seq`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, focus?.seq]);
  // The card whose menu a long press opened, and whether it shows its Tags page. Remove is one of
  // its rows (the phone's long-press rule: a card's actions open on a hold).
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuTags, setMenuTags] = useState(false);
  const board = obj(document.coordinatorBoard);
  if (board === null) return null;
  // Puts a card's reference in the chat box so the user can comment on it, and closes the sheet.
  const mention = (reference: string) => {
    if (reference.length === 0) return;
    chat.dispatch({
      type: 'insertBoardReference',
      reference,
      text: chat.state?.composer.text ?? '',
    } as unknown as UserAction);
    onDone();
  };
  const run = (command: unknown) => {
    const type = str(command, 'type');
    if (type.length === 0) return;
    // A thread on another computer: the phone talks only to the coordinator's computer.
    if (type === 'openCoordinatorThread' && str(command, 'serverId').trim().length > 0) {
      const notice = remoteWorkerNotice('another computer');
      Alert.alert(notice.title, notice.message);
      return;
    }
    chat.dispatch(asJson(command) as unknown as UserAction);
    onDone();
  };
  return (
    // "Work" over the coordinator's work items (gx-chat-core `work_panel.rs`), "Board" from an older gxserver.
    <View accessibilityLabel={str(board, 'title') || 'Board'} style={styles.menu}>
      <Text style={styles.meta} numberOfLines={1}>
        {isTrue(board, 'empty') ? 'Nothing open' : str(board, 'meta')}
      </Text>
      <ScrollView ref={list} style={styles.rows} nestedScrollEnabled>
        {arr(board.groups).map((group) => {
          const id = str(group, 'id');
          const open = isTrue(group, 'open');
          const more = str(group, 'moreLabel');
          return (
            <View
              key={id}
              onLayout={(event) => {
                groupTops.current[id] = event.nativeEvent.layout.y;
                scrollToFocus();
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${str(group, 'title')}, ${num(group, 'count') ?? 0}`}
                onPress={() => chat.dispatch({ type: 'toggleCoordinatorBoardGroup', group: id })}
                style={styles.groupLine}
              >
                <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={12} color={P.cardMuted} />
                <GroupMarker group={id} />
                <Text style={styles.groupTitle}>{str(group, 'title')}</Text>
                <Text style={styles.groupCount}>{num(group, 'count') ?? 0}</Text>
              </Pressable>
              {arr(obj(group)?.rows).map((row, index) => {
                const command = obj(obj(row)?.command);
                const toggle = obj(obj(row)?.toggle);
                const openThread = obj(obj(row)?.openThread);
                const key = str(row, 'key') || String(index);
                const restore = obj(obj(row)?.restore);
                const tags = arr(obj(row)?.tags);
                const answers = arr(obj(row)?.answers);
                const menuRows = arr(obj(row)?.menu);
                const expanded = isTrue(row, 'expanded');
                // A thread waiting on a relayed approval shows that card's buttons in place of its
                // chips (desktop `board_relay_buttons`; the user's Q1297).
                const relayed = openRelayedCardForThread(document, str(openThread, 'sessionId'));
                const reference = str(row, 'reference');
                const note = str(row, 'note');
                // A tap opens the card in place (one at a time: gx-chat-core `toggle`); a question's
                // card jumps to its form instead.
                const tapCard =
                  toggle !== null
                    ? () => {
                        setMenuFor(null);
                        chat.dispatch(asJson(toggle) as unknown as UserAction);
                      }
                    : command !== null
                      ? () => run(command)
                      : undefined;
                // At most two chips fit beside the age; the rest are counted in "+N" (desktop
                // `fit_chips`), so a closed card keeps its two lines. An open card shows them all.
                const shownTags = expanded ? tags : tags.slice(0, 2);
                const hiddenTags = tags.length - shownTags.length;
                const line = str(row, 'detail') || note;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole={tapCard !== undefined ? 'button' : 'text'}
                    accessibilityLabel={str(row, 'title')}
                    accessibilityState={{ expanded }}
                    accessibilityHint={menuRows.length > 0 ? 'Long-press for its actions' : undefined}
                    onPress={tapCard}
                    onLongPress={
                      menuRows.length > 0
                        ? () => {
                            setMenuTags(false);
                            setMenuFor(menuFor === key ? null : key);
                          }
                        : undefined
                    }
                    onLayout={(event) => {
                      cardTops.current[key] = { group: id, y: event.nativeEvent.layout.y };
                      if (focus?.key === key) scrollToFocus();
                    }}
                    style={[
                      styles.card,
                      expanded && styles.cardOpen,
                      ringed === key ? { borderColor: P.accent, backgroundColor: `${P.accent}14` } : null,
                    ]}
                  >
                    <View style={styles.cardTitleLine}>
                      <Text style={styles.rowTitle} numberOfLines={expanded ? undefined : 1}>
                        {str(row, 'title')}
                      </Text>
                      {openThread !== null ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open the thread ${str(row, 'title')}`}
                          hitSlop={6}
                          onPress={() => run(openThread)}
                          style={styles.agentButton}
                        >
                          <AgentMark icon={str(row, 'agentIcon') || null} size={14} />
                        </Pressable>
                      ) : null}
                      {restore !== null ? (
                        <Text
                          accessibilityRole="button"
                          accessibilityLabel="Restore to the board"
                          style={styles.restore}
                          onPress={() => chat.dispatch(asJson(restore) as unknown as UserAction)}
                        >
                          Restore
                        </Text>
                      ) : null}
                    </View>
                    {expanded && line.length > 0 ? <Text style={styles.cardLine}>{line}</Text> : null}
                    <View style={[styles.chipLine, expanded && styles.chipLineOpen]}>
                      <View style={[styles.chips, expanded && styles.chipsOpen]}>
                        {relayed !== null ? (
                          <BoardRelayButtons card={relayed} dispatch={chat.dispatch} />
                        ) : answers.length > 0 ? (
                          <>
                            {/* A Work panel ask names the work it belongs to before its answers (gx-chat-core work_panel.rs). */}
                            {str(row, 'lead').length > 0 ? (
                              <Text numberOfLines={1} style={styles.lead}>
                                {str(row, 'lead')}
                              </Text>
                            ) : null}
                            <View style={styles.answers}>
                              {answers.map((answer, answerIndex) => (
                                <Pressable
                                  key={`answer:${answerIndex}`}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Answer ${str(answer, 'label')}`}
                                  disabled={isTrue(answer, 'locked')}
                                  onPress={() => {
                                    const answerCommand = obj(obj(answer)?.command);
                                    if (answerCommand !== null)
                                      chat.dispatch(asJson(answerCommand) as unknown as UserAction);
                                  }}
                                  style={[
                                    styles.answer,
                                    answerIndex > 0 && styles.answerDivider,
                                    isTrue(answer, 'picked') && styles.answerPicked,
                                    isTrue(answer, 'locked') && !isTrue(answer, 'picked') && styles.answerFaded,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.tagText,
                                      (isTrue(answer, 'picked') || isTrue(answer, 'recommended')) &&
                                        styles.answerStrong,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {isTrue(answer, 'picked') ? `✓ ${str(answer, 'label')}` : str(answer, 'label')}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          </>
                        ) : tags.length === 0 && !expanded ? (
                          <Text style={note.length > 0 ? styles.note : styles.noLinks} numberOfLines={1}>
                            {note.length > 0 ? note : 'No links yet'}
                          </Text>
                        ) : null}
                        {(answers.length > 0 || relayed !== null ? [] : shownTags).map((tag, tagIndex) => {
                          if (str(tag, 'kind') === 'userTag') {
                            return <UserTagChip key={`userTag:${tagIndex}`} tag={tag} />;
                          }
                          const tint = toneColor(str(tag, 'tone'));
                          const open = obj(obj(tag)?.command);
                          const coloured = str(tag, 'kind') === 'release' || str(tag, 'kind') === 'question';
                          return (
                            <Pressable
                              key={`${str(tag, 'kind')}:${tagIndex}`}
                              accessibilityRole={open !== null ? 'link' : 'text'}
                              accessibilityLabel={str(tag, 'title') || str(tag, 'label')}
                              onPress={open !== null ? () => run(open) : undefined}
                              style={[styles.tag, coloured && tint !== null && { borderColor: tint }]}
                            >
                              {!coloured ? (
                                <View style={[styles.tagDot, { backgroundColor: tint ?? P.cardMuted }]} />
                              ) : null}
                              <Text
                                style={[styles.tagText, coloured && tint !== null && { color: tint }]}
                                numberOfLines={1}
                                ellipsizeMode="tail"
                              >
                                {chipLabel(str(tag, 'kind'), str(tag, 'label'))}
                              </Text>
                            </Pressable>
                          );
                        })}
                        {answers.length === 0 && relayed === null && hiddenTags > 0 ? (
                          <View style={styles.tag}>
                            <Text style={styles.tagText}>{`+${hiddenTags}`}</Text>
                          </View>
                        ) : null}
                      </View>
                      {expanded ? null : <Text style={styles.age}>{str(row, 'age')}</Text>}
                    </View>
                    {relayed !== null ? (
                      <Text style={styles.note} numberOfLines={2}>
                        {[str(relayed, 'title'), str(relayed, 'codePreview') || str(relayed, 'code')]
                          .filter((part) => part.length > 0)
                          .join('\n')}
                      </Text>
                    ) : null}
                    {expanded ? (
                      <View style={styles.cardButtons}>
                        {/* No Open button: the link chip opens the link and the agent button the
                            thread, each thing once (the user's 2026-11-06 words on the desktop's
                            `board_card_buttons`). Open stays in the long-press menu. */}
                        {/* The dock's actions (gx-chat-core `panel_actions`): Reply, Open, Show in
                            chat, Dismiss, Snooze, so an opened card offers the same everywhere. */}
                        <BoardCardActions row={row} chat={chat} onDone={onDone} />
                        {reference.length > 0 ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => mention(reference)}
                            style={({ pressed }) => [styles.cardButton, pressed && styles.cardButtonPressed]}
                          >
                            <Glyph name="message-plus" size={14} color={P.foreground} />
                            <Text style={styles.cardButtonText}>Mention</Text>
                          </Pressable>
                        ) : null}
                        <View style={styles.flex} />
                        <Text style={styles.age}>{str(row, 'age')}</Text>
                      </View>
                    ) : null}
                    {menuFor === key ? (
                      <CardMenu
                        row={row}
                        tagOptions={arr(board.tagOptions)}
                        tagsPage={menuTags}
                        onTags={setMenuTags}
                        onPick={(picked) => {
                          setMenuFor(null);
                          setMenuTags(false);
                          if (str(picked, 'type') === 'insertBoardReference') {
                            mention(str(picked, 'reference'));
                          } else if (str(picked, 'type') === 'coordinatorBoardChange') {
                            chat.dispatch(asJson(picked) as unknown as UserAction);
                          } else {
                            run(picked);
                          }
                        }}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
              {more.length > 0 ? (
                <Text
                  accessibilityRole="button"
                  style={styles.more}
                  onPress={() => chat.dispatch({ type: 'coordinatorBoardMore', group: id })}
                >
                  {more}
                </Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
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
  meta: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  rows: {
    flexShrink: 1,
  },
  groupLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
  },
  groupTitle: {
    color: P.foreground,
    fontSize: PROSE_SIZE,
    fontWeight: '600',
  },
  groupCount: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
    fontVariant: ['tabular-nums'],
  },
  ring: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  disc: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pause: {
    width: 12,
    height: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 3,
  },
  pauseBar: {
    width: 3,
    height: 12,
    borderRadius: 1.5,
  },
  /** A line of work's card: two lines, always (desktop `board_card`). */
  card: {
    position: 'relative',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.ink(0.08),
    backgroundColor: P.ink(0.035),
  },
  /** The open card (gx-chat-core `expanded`): a step brighter, growing to its content. */
  cardOpen: {
    borderColor: P.ink(0.14),
    backgroundColor: P.ink(0.055),
  },
  /** The open card's latest line, whole. */
  cardLine: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
    lineHeight: Math.round((PROSE_SIZE - 1) * 1.4),
  },
  chipLineOpen: {
    height: undefined,
  },
  chipsOpen: {
    flexWrap: 'wrap',
    overflow: 'visible',
  },
  cardButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  cardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: P.ink(0.12),
  },
  cardButtonPressed: {
    backgroundColor: P.ink(0.08),
  },
  cardButtonText: {
    color: P.foreground,
    fontSize: PROSE_SIZE - 1,
  },
  flex: {
    flex: 1,
  },
  /** A held card's menu, in place under its content. */
  cardMenu: {
    marginTop: 2,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.ink(0.1),
    backgroundColor: P.ink(0.04),
  },
  cardMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  cardMenuText: {
    color: P.foreground,
    fontSize: PROSE_SIZE,
  },
  cardTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    color: P.foreground,
    fontSize: PROSE_SIZE,
  },
  age: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
    fontVariant: ['tabular-nums'],
  },
  agentButton: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: P.ink(0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 24,
  },
  chips: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  /** The red × that floats over a long-pressed card's top-right corner (desktop `board_remove_badge`). */
  noLinks: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
  },
  /** The coordinator's own line for a card with no links: a step brighter than "No links yet". */
  note: {
    flexShrink: 1,
    color: P.prose,
    fontSize: PROSE_SIZE - 2,
  },
  /** An item's one-click answers, one segmented pill (desktop `board_answers`). */
  answers: {
    flexDirection: 'row',
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.ink(0.14),
    overflow: 'hidden',
  },
  answer: {
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  answerDivider: {
    borderLeftWidth: 1,
    borderLeftColor: P.ink(0.14),
  },
  answerPicked: {
    backgroundColor: P.ink(0.14),
  },
  answerFaded: {
    opacity: 0.4,
  },
  answerStrong: {
    color: P.foreground,
  },
  tag: {
    flexShrink: 1,
    maxWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.ink(0.12),
  },
  tagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  lead: { flexShrink: 1, minWidth: 40, fontSize: 12.5, color: P.cardMuted },
  tagText: {
    flexShrink: 1,
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
  },
  restore: {
    paddingHorizontal: 5,
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
  },
  more: {
    paddingLeft: 12,
    paddingVertical: 4,
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
  },
}));
