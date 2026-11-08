/**
 * A session's links sheet: every PR, GitHub issue and Linear ticket it is linked to, two lines
 * each, and the chat's suggestions. The chat strip's "+N" (SessionLinksStrip.tsx) and the session
 * list's long-press Links row both open it. The phone's form of the desktop's links list
 * (apps/desktop/src/app/native_sidebar/links_list.rs).
 *
 * CDXC:SessionLinks 2026-10-24 DECISION:
 * User: a tap opens a link (in the phone's browser view, or its default browser when the
 * computer's Settings > Browser > Open session links in says so), and removing one takes a second
 * tap ("click on an x icon button (twice to confirm)"). Per the phone's long-press rule, holding a
 * linked entry opens its actions under it: Copy link, Pin or Unpin, and Remove (which asks
 * "Remove?" first); the row shows no pin or × of its own, except a pinned row's filled pin. This
 * supersedes the same day's long press that copied and the always-visible pin and ×. A suggestion
 * or a removed link keeps its Link or Restore button, and a long press on it copies.
 *
 * CDXC:SessionLinks 2026-10-24 DECISION:
 * User: "when a link is gone i see that i can't bring it back why not?", "i mean when i hit x button
 * twice on it". A collapsed "Removed (N)" group at the bottom lists every removed link with Restore,
 * as on the desktop (apps/desktop/src/app/native_sidebar/links_list.rs). The "Removed · Undo" row
 * that stood in for a just-removed link is gone (CDXC:SessionLinks 2026-10-27 in sessionLinks.ts,
 * `sessionLinksWithoutRemoved`): the link leaves its group at once and leads Removed.
 *
 * CDXC:SessionLinks 2026-10-27 DECISION:
 * User: "also the height of the row that has "undo" is bigger than the other rows, just wanted to
 * note this is wrong". A row's button (Link, Restore, a pinned row's pin) is sized to the row's text
 * line, with a wider touch area, so it never makes its row taller than a plain one.
 *
 * CDXC:SessionLinks 2026-10-24 DECISION:
 * User: "can u pls make all the sections in these cards colapsible with chevron? please add this for
 * pr and github issues etc (the headers there". Every group header has the same chevron, folds on
 * a tap and keeps its count; which groups are folded is one choice per group for every session,
 * kept across restarts (`sessionLinksFoldedGroups`), as on the desktop.
 *
 * CDXC:SessionLinks 2026-10-24 DECISION:
 * User picked "B. Open work first, finished work folded" for the links list: it leads with an
 * "Open N" group of the links that still need something, merged and closed links sit in one
 * "Merged / Closed N" group folded until opened, then Suggested and Removed (folded), replacing
 * the Pull requests / GitHub issues / Linear sections here as on the desktop's card and "+N"
 * dropdown.
 *
 * CDXC:SessionLinks 2026-10-24 DECISION:
 * User: "make suggested and removed also have the same look as other ones (2 rows)". Suggested and
 * Removed entries use the same two-line row as linked ones (number, title and state, then "Mentioned
 * in the chat" or where a removed link came from), with Link or Restore where the × sits and no
 * dashed box.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import {
  addSessionLinkCommand,
  pinSessionLinkCommand,
  refreshSessionLinksCommand,
  removeSessionLinkCommand,
  restoreSessionLinkCommand,
} from '../../commands/ghostexCli';
import { ChipGlyph } from '../../components/sessions/WorkChips';
import type { GhostexSession, GhostexSessionLink } from '../../contract/mobileSummary';
import type { MachineRecord } from '../../machines/store';
import { runSessionCommand } from '../../sessions/sessionCommands';
import { useSettingsStore } from '../../settings/store';
import { SidebarPalette } from '../../theme/palette';
import { Glyph } from './composer/icons';
import { Sheet } from './composer/Sheet';
import {
  sessionLinkCardLines,
  sessionLinkDetailLine,
  sessionLinkLook,
  sessionLinkSummary,
  sessionLinksWithoutRemoved,
  SUGGESTED_SHOWN_FIRST,
  suggestedOpensUnfolded,
  suggestionsShown,
} from './sessionLinks';
import { themedStyles, useTranscriptTheme } from './transcript/theme';

/** How long a × waits for its confirming tap. */
const REMOVE_ARMED_FOR_MS = 3000;
/**
 * How long a removed link stays out of the list without the computer publishing its removal; past
 * it the sheet shows what the computer says again (the removal failed, and said so).
 */
const REMOVAL_PENDING_FOR_MS = 10_000;
/** A row button's height: no taller than the row's first text line. */
const ROW_BUTTON_HEIGHT = 20;
const ROW_BUTTON_HIT_SLOP = { top: 12, bottom: 12, left: 8, right: 8 };

/** Opens a link where the computer's setting says: the phone's browser view, or its default browser. */
export function openSessionLink(
  url: string,
  openTarget: 'embedded' | 'external',
  openInApp: (url: string) => void,
  onError: (message: string) => void,
): void {
  if (url.length === 0) return;
  if (openTarget === 'external') {
    void Linking.openURL(url).catch(() => onError(`Could not open ${url}`));
  } else {
    openInApp(url);
  }
}

/** Copies a link, the long press on a chip or an entry. */
export function copySessionLink(url: string, onStatus: (message: string) => void): void {
  if (url.length === 0) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  void Clipboard.setStringAsync(url)
    .then(() => onStatus('Link copied'))
    .catch(() => onStatus('Could not copy the link'));
}

export type SessionLinksSheetProps = {
  visible: boolean;
  onClose: () => void;
  machine: MachineRecord;
  session: GhostexSession;
  openTarget: 'embedded' | 'external';
  /** Opens a page in the phone's own browser view (WebPreview). */
  openInApp: (url: string) => void;
};

export default function SessionLinksSheet({
  visible,
  onClose,
  machine,
  session,
  openTarget,
  openInApp,
}: SessionLinksSheetProps): ReactElement | null {
  const [armed, setArmed] = useState<string | null>(null);
  /** The linked entry whose actions a long press opened under it. */
  const [held, setHeld] = useState<string | null>(null);
  /** Links removed here whose removal the computer has not published yet. */
  const [removing, setRemoving] = useState<string[]>([]);
  /** The "Add a link" field under the title, its text, and what the computer refused. */
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  /** "Show all" was tapped under Suggested: every suggestion shows until "Show fewer". */
  const [allSuggested, setAllSuggested] = useState(false);
  const folded = useSettingsStore((store) => store.settings.sessionLinksFoldedGroups);
  /**
   * Suggested's fold for this open of the sheet, over the saved one: `null` until the sheet has
   * opened on known links, then `true` when it opened on 2 or fewer linked links
   * (`suggestedOpensUnfolded`), `'saved'` to follow the saved fold, or the person's own fold or
   * unfold, until the sheet closes (gx-core CDXC:SessionLinks 2026-10-28 DECISION).
   */
  const [suggestedOpen, setSuggestedOpen] = useState<boolean | 'saved' | null>(null);
  const linkedCount = session.links?.items.length;
  useEffect(() => {
    if (!visible) {
      setSuggestedOpen(null);
      return;
    }
    if (linkedCount === undefined) return;
    setSuggestedOpen((open) => open ?? (suggestedOpensUnfolded(linkedCount) ? true : 'saved'));
  }, [visible, linkedCount]);
  const setSetting = useSettingsStore((store) => store.setSetting);
  const [status, setStatus] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removalTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const styles = useStyles();
  const P = useTranscriptTheme();
  useEffect(
    () => () => {
      if (armTimer.current !== null) clearTimeout(armTimer.current);
      removalTimers.current.forEach(clearTimeout);
    },
    [],
  );
  // Opening the sheet reads the session's links now rather than on their usual schedule
  // (server/src/server/session_links_sync.rs `want_session_links_now`).
  useEffect(() => {
    if (!visible) return;
    void runSessionCommand(machine, refreshSessionLinksCommand(session.sessionId, session.projectId), {
      onError: () => {},
    });
  }, [visible, machine, session.sessionId, session.projectId]);
  const published = session.links;
  if (published === undefined) return null;
  const links = sessionLinksWithoutRemoved(published, removing);

  const open = (url: string) => {
    if (openTarget !== 'external') onClose();
    openSessionLink(url, openTarget, openInApp, setStatus);
  };
  const copy = (url: string) => copySessionLink(url, setStatus);
  const remove = (key: string) => {
    if (armed === key) {
      setArmed(null);
      setRemoving((current) => (current.includes(key) ? current : [...current, key]));
      removalTimers.current.push(
        setTimeout(
          () => setRemoving((current) => current.filter((pending) => pending !== key)),
          REMOVAL_PENDING_FOR_MS,
        ),
      );
      void runSessionCommand(machine, removeSessionLinkCommand(session.sessionId, session.projectId, key), {
        onError: (message: string) => setStatus(message),
      });
      return;
    }
    setArmed(key);
    if (armTimer.current !== null) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed((current) => (current === key ? null : current)), REMOVE_ARMED_FOR_MS);
  };
  const restore = (key: string) => {
    setRemoving((current) => current.filter((pending) => pending !== key));
    void runSessionCommand(machine, restoreSessionLinkCommand(session.sessionId, session.projectId, key), {
      onError: (message: string) => setStatus(message),
    });
  };
  const add = (url: string) => {
    void runSessionCommand(machine, addSessionLinkCommand(session.sessionId, session.projectId, url), {
      onError: (message: string) => setStatus(message),
    });
  };
  /**
   * Links what the field holds (`ghostex link add`): SPX-123, #123, owner/repo#123 or a URL. The
   * field closes once it is linked and shows what the computer refused otherwise.
   *
   * CDXC:SessionLinks 2026-10-27 DECISION:
   * User: "also i need a button to add 1 manually (just write SPX-123 or #123 or paste a link to
   * link it)". Add in the sheet's title row opens the field, as the desktop list's + opens its
   * "Add a link" dialog (apps/desktop/src/app/window/add_session_link_modal.rs).
   */
  const submitAdd = async () => {
    const text = addText.trim();
    if (text.length === 0 || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    const result = await runSessionCommand(machine, addSessionLinkCommand(session.sessionId, session.projectId, text), {
      onError: (message: string) => setAddError(message),
    });
    setAddBusy(false);
    if (result !== null) {
      setAdding(false);
      setAddText('');
    }
  };
  const toggleAdd = () => {
    setAdding((open) => !open);
    setAddError(null);
  };
  /**
   * A suggestion's ×: tap it, and tap it again while it is red to dismiss it for good (it goes
   * under Removed).
   *
   * CDXC:SessionLinks 2026-10-27 DECISION:
   * User: "i should be able to press x on suggested ones to remove them also please" (gxserver's
   * `dismiss_suggestion` in server/src/session_links/store.rs).
   *
   * CDXC:SessionLinks 2026-11-04 DECISION:
   * User: "when i click on the x button for links please don't show 'Remove?' instead make the x
   * button turn redish to indicate i need to click again to confirm pls". The armed × keeps its size
   * and place and turns red on the soft red fill, as on the desktop (links_list.rs
   * `render_remove_button`).
   */
  const dismissButton = (key: string, label: string) => {
    const isArmed = armed === key;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isArmed ? 'Tap again to remove the link' : `Remove ${label}`}
        hitSlop={ROW_BUTTON_HIT_SLOP}
        onPress={() => remove(key)}
        style={({ pressed }) => [
          styles.remove,
          isArmed ? { backgroundColor: P.destructiveFill } : pressed && { backgroundColor: P.neutralFillPressed },
        ]}
      >
        <Glyph name="x" size={14} color={isArmed ? P.error : P.muted} />
      </Pressable>
    );
  };
  // What Open and Pinned list as not finished, as on the desktop (CDXC:SessionLinks 2026-11-08 in
  // apps/desktop/src/app/native_sidebar/links_list.rs): one still loading waits under Loading.
  const openCount = links.items.filter((link) => !link.finished && !link.loading).length;
  const failingCount = links.items.filter((link) => link.checks === 'failing').length;
  const summary = [`${openCount} open`, failingCount > 0 ? `${failingCount} failing checks` : '']
    .filter((part) => part.length > 0)
    .join(' · ');

  const isFolded = (id: string) => {
    if (id !== 'suggested') return folded.includes(id);
    const open = suggestedOpen ?? (suggestedOpensUnfolded(published.items.length) ? true : 'saved');
    return open === 'saved' ? folded.includes(id) : !open;
  };
  const toggleSection = (id: string) => {
    const fold = !isFolded(id);
    if (id === 'suggested') setSuggestedOpen(!fold);
    setSetting('sessionLinksFoldedGroups', fold ? [...folded, id] : folded.filter((section) => section !== id));
  };
  const sectionHeader = (id: string, title: string, count: number) => {
    const open = !isFolded(id);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} ${count}`}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        onPress={() => toggleSection(id)}
        style={styles.sectionHeader}
      >
        <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={13} color={P.muted} />
        <Text style={styles.section}>
          {title} {count}
        </Text>
      </Pressable>
    );
  };

  /** Every entry's two lines (a linked link, a suggestion, a removed link) with its own action on the right. */
  const entryRow = (link: GhostexSessionLink, action: ReactElement | null, holdMenu = false) => {
    const look = sessionLinkLook(link);
    /*
     * CDXC:SessionLinks 2026-10-24 DECISION:
     * User: "no need for the word merged and closed i should be able to hover their icon to get that
     * word instead in tooltip". No state word on the row: the icon's colour says it, and the row's
     * accessibility label (`sessionLinkSummary`) still names it; the phone has no hover.
     */
    const detail = sessionLinkDetailLine(link);
    const row = (
      <Pressable
        key={link.key}
        accessibilityRole="link"
        accessibilityLabel={sessionLinkSummary(link)}
        accessibilityHint={holdMenu ? 'Touch and hold for Copy link, Pin and Remove' : undefined}
        onPress={() => open(link.url)}
        onLongPress={() => {
          if (!holdMenu) {
            copy(link.url);
            return;
          }
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          setHeld((current) => (current === link.key ? null : link.key));
        }}
        style={({ pressed }) => [
          styles.row,
          link.finished && styles.finished,
          pressed && { backgroundColor: P.pressedFill },
        ]}
      >
        <View style={styles.rowGlyph}>
          <ChipGlyph glyph={look.glyph} color={look.color} size={15} />
        </View>
        <View style={styles.rowText}>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>{link.label}</Text>
            <Text
              style={[styles.rowTitle, link.loading && link.title.length === 0 && { color: P.muted }]}
              numberOfLines={1}
            >
              {link.loading && link.title.length === 0 ? 'Loading…' : link.title}
            </Text>
          </View>
          {detail.length > 0 ? (
            <Text
              style={[styles.rowDetail, link.checks === 'failing' && { color: SidebarPalette.WORK_CLOSED }]}
              numberOfLines={1}
            >
              {detail}
            </Text>
          ) : null}
        </View>
        {action}
      </Pressable>
    );
    if (held !== link.key) return row;
    const isArmed = armed === link.key;
    return (
      <View key={link.key}>
        {row}
        {/*
         * CDXC:SessionLinks 2026-10-24 DECISION:
         * User: "when i hover over the title of a link in the floating thingy pls make it show the full title of that link (issue/pr/etc)", "also please make the tooltip look like this one which we have in the sidebar". The phone has no hover, so the card the desktop shows over a link opens at the top of its long-press menu: the full title in bold, wrapping, then a pull request's branch muted (`sessionLinkCardLines`).
         */}
        <View style={styles.heldCard}>
          {sessionLinkCardLines(link).map((line, index) => (
            <Text key={line} style={index === 0 ? styles.heldCardTitle : styles.heldCardLine}>
              {line}
            </Text>
          ))}
        </View>
        <View style={styles.heldMenu}>
          {menuButton('Copy link', () => {
            setHeld(null);
            copy(link.url);
          })}
          {menuButton(link.pinned ? 'Unpin' : 'Pin', () => {
            setHeld(null);
            pin(link);
          })}
          {/* User: "please don't show x to remove link that's pinned": unpin it first. */}
          {link.pinned
            ? null
            : menuButton(
                isArmed ? 'Remove?' : 'Remove',
                () => {
                  if (isArmed) setHeld(null);
                  remove(link.key);
                },
                isArmed,
              )}
        </View>
      </View>
    );
  };
  /** One action of a held entry's menu. */
  const menuButton = (label: string, onPress: () => void, destructive = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label === 'Remove?' ? 'Tap again to remove the link' : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkButton,
        {
          backgroundColor: destructive ? P.destructiveFill : pressed ? P.neutralFillPressed : P.neutralFill,
        },
      ]}
    >
      <Text style={[styles.linkButtonText, destructive && { color: P.error }]}>{label}</Text>
    </Pressable>
  );
  /**
   * A suggestion's Link or a removed link's Restore: a small icon button where a linked entry's ×
   * sits.
   *
   * CDXC:SessionLinks 2026-10-24 DECISION:
   * User: "for suggested i want the row to look just like the regular rows we have there".
   * Suggested and Removed rows are drawn like linked ones; only their action differs, an icon
   * button (link, arrow-back) instead of a bordered text button.
   */
  const iconButton = (glyph: 'link' | 'restore', accessibilityLabel: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={ROW_BUTTON_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [styles.remove, pressed && { backgroundColor: P.neutralFillPressed }]}
    >
      <ChipGlyph glyph={glyph} color={P.muted} size={16} />
    </Pressable>
  );

  const pin = (link: GhostexSessionLink) =>
    void runSessionCommand(
      machine,
      pinSessionLinkCommand(session.sessionId, session.projectId, link.key, !link.pinned),
      {
        onError: (message: string) => setStatus(message),
      },
    );
  /** A linked entry's pin and ×. */
  /** A pinned entry's filled pin; its actions are in the long-press menu. */
  const linkedActions = (link: GhostexSessionLink) =>
    link.pinned ? (
      <View style={styles.remove} accessible accessibilityLabel="Pinned">
        <ChipGlyph glyph="pinFilled" color={P.muted} size={14} />
      </View>
    ) : null;
  /**
   * Pinned leads, then Open and Merged / Closed hold the rest.
   *
   * CDXC:SessionLinks 2026-10-24 DECISION:
   * User: "for the linked issues/prs/linear i want to be able to pin a few so they appear on top
   * under "pinned" and they always appear in the sidebar". The long-press menu's Pin or Unpin
   * (`ghostex link pin|unpin`) pins an entry, and a Pinned group leads the sheet, as on the desktop.
   */
  const inGroup = (link: GhostexSessionLink, id: string) =>
    id === 'pinned'
      ? link.pinned
      : id === 'loading'
        ? !link.pinned && link.loading
        : id === 'open'
          ? !link.pinned && !link.loading && !link.finished
          : !link.pinned && !link.loading && link.finished;
  const section = (id: string, title: string) => {
    const items = links.items.filter((link) => inGroup(link, id));
    if (items.length === 0) return null;
    return (
      <View key={id}>
        {sectionHeader(id, title, items.length)}
        {(isFolded(id) ? [] : items).map((link) => entryRow(link, linkedActions(link), true))}
      </View>
    );
  };
  const removed = links.removed;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Links · ${summary}`}
      accessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={adding ? 'Close the add field' : 'Add a link'}
          accessibilityState={{ expanded: adding }}
          hitSlop={8}
          onPress={toggleAdd}
          style={({ pressed }) => [styles.addButton, pressed && { backgroundColor: P.neutralFillPressed }]}
        >
          <Glyph name={adding ? 'x' : 'link'} size={14} color={P.muted} />
          <Text style={styles.section}>{adding ? 'Cancel' : 'Add'}</Text>
        </Pressable>
      }
    >
      <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        {adding ? (
          <View style={styles.addField}>
            <TextInput
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              editable={!addBusy}
              placeholder="SPX-123, #123, owner/repo#123 or a link"
              placeholderTextColor={P.muted}
              returnKeyType="go"
              value={addText}
              onChangeText={(text) => {
                setAddText(text);
                setAddError(null);
              }}
              onSubmitEditing={() => void submitAdd()}
              style={styles.addInput}
            />
            {addBusy ? <Text style={styles.status}>Linking…</Text> : null}
            {addError !== null ? <Text style={[styles.status, { color: P.error }]}>{addError}</Text> : null}
          </View>
        ) : null}
        {section('pinned', 'Pinned')}
        {section('open', 'Open')}
        {section('loading', 'Loading')}
        {section('finished', 'Merged / Closed')}
        {links.suggested.length > 0 ? (
          <View>
            {sectionHeader('suggested', 'Suggested', links.suggested.length)}
            {(isFolded('suggested') ? [] : suggestionsShown(links.suggested, allSuggested)).map((suggestion) =>
              entryRow(
                suggestion,
                <View style={styles.rowActions}>
                  {/* A Linear ticket not read yet has no URL; its ID links it as well. */}
                  {iconButton('link', `Link ${suggestion.label}`, () =>
                    add(suggestion.url.length > 0 ? suggestion.url : suggestion.label),
                  )}
                  {dismissButton(suggestion.key, suggestion.label)}
                </View>,
              ),
            )}
            {!isFolded('suggested') && links.suggested.length > SUGGESTED_SHOWN_FIRST ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: allSuggested }}
                hitSlop={4}
                onPress={() => setAllSuggested((all) => !all)}
                style={styles.showAll}
              >
                <Text style={styles.section}>
                  {allSuggested ? 'Show fewer' : `Show all ${links.suggested.length}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {removed.length > 0 ? (
          <View>
            {sectionHeader('removed', 'Removed', removed.length)}
            {(isFolded('removed') ? [] : removed).map((link) =>
              entryRow(
                link,
                iconButton('restore', `Restore ${link.label}`, () => restore(link.key)),
              ),
            )}
          </View>
        ) : null}
        {status !== null ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
  heldCard: {
    marginHorizontal: 6,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.menuBorder,
    backgroundColor: P.neutralFill,
  },
  heldCardTitle: { color: P.foreground, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  heldCardLine: { color: P.muted, fontSize: 12.5, lineHeight: 17 },
  heldMenu: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 6, paddingBottom: 8 },
  sheetBody: { paddingHorizontal: 12, paddingBottom: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, marginBottom: 4 },
  // Suggested's "Show all N" / "Show fewer": the section header's words, under the rows.
  showAll: { paddingVertical: 6, paddingHorizontal: 6 },
  // A tight line without Android's font padding, so the chevron centres on the letters rather than
  // on a box whose padding sits above them.
  section: { color: P.muted, fontSize: 12, lineHeight: 16, includeFontPadding: false, textAlignVertical: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  finished: { opacity: 0.62 },
  rowGlyph: { paddingTop: 2 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowLabel: { color: P.foreground, fontSize: 14 },
  rowTitle: { color: P.foreground, fontSize: 14, flex: 1, minWidth: 0, opacity: 0.86 },
  rowDetail: { color: P.muted, fontSize: 12.5 },
  // As tall as a row's text line (14px text), so a row with a button is as tall as one without;
  // ROW_BUTTON_HIT_SLOP keeps the touch area.
  remove: {
    minWidth: 28,
    height: ROW_BUTTON_HEIGHT,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  linkButton: { paddingHorizontal: 12, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  linkButtonText: { color: P.foreground, fontSize: 13 },
  status: { color: P.muted, fontSize: 12.5, marginTop: 10 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 28, borderRadius: 7 },
  addField: { marginTop: 6, marginBottom: 4 },
  addInput: {
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.menuBorder,
    backgroundColor: P.neutralFill,
    color: P.foreground,
    fontSize: 14,
  },
}));
