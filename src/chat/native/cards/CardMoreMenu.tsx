/**
 * The ⋯ button of a Ghostex form card, a page card and the page sheet's bar, and the menu it opens
 * (`MenuSheet`): Snooze with its lengths (the dock's 1 hour, 6 hours and 24 hours, gx-chat-core
 * `questions/later.rs` `snooze`) and, for a page, Export page and Import answers (`pageExport.ts`),
 * as the desktop page window's ⋯ menu holds them.
 *
 * CDXC:SessionChat 2026-11-13 DECISION:
 * User, asked whether the phone gets Snooze for forms and pages (Q2940): "on phone just a clock icon under the 3 dots". So no Snooze button on the card: a ⋯ on the form card, the page card and the page sheet's bar holds Snooze (a clock), which opens the three lengths; the page sheet closes once the page is snoozed. Export page and Import answers moved into the page's ⋯ too, as on the desktop (apps/desktop/src/app/window/visual_page_modal/more_menu.rs). A snoozed form or page leaves the dock and the unanswered counts until it comes back, and the agent is told nothing.
 */

import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import type { UserAction } from '../../rust/actions';
import { MenuSheet, type MenuRow } from '../composer/MenuSheet';
import { Glyph } from '../composer/icons';
import { pickExportedAnswers } from './pageExport';

/** The menu's Snooze row: a clock that opens the dock's three lengths. */
export function snoozeRow(id: string): MenuRow {
  return {
    label: 'Snooze',
    iconPath: 'titlebar/clock.svg',
    children: [
      { label: '1 hour', hours: 1 },
      { label: '6 hours', hours: 6 },
      { label: '24 hours', hours: 24 },
    ].map(({ label, hours }) => ({ label, command: { type: 'snoozeQuestion', id, hours } })),
  };
}

/** A page's Export page and Import answers rows. */
export function pageRows(pageId: string): MenuRow[] {
  return [
    { label: 'Export page', iconPath: 'titlebar/file-export.svg', command: { type: 'exportPage', pageId } },
    { label: 'Import answers', iconPath: 'titlebar/file.svg', command: { local: 'importAnswers' } },
  ];
}

/**
 * `rows` are the menu's; a row's core action goes to `dispatch`, and `onSnoozed` runs after a
 * Snooze (the page sheet closes).
 */
export function CardMoreMenu({
  rows,
  dispatch,
  color,
  onSnoozed,
  size = 18,
}: {
  rows: MenuRow[];
  dispatch: (action: UserAction) => void;
  color: string;
  onSnoozed?: () => void;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  // The answers picker waits for the menu to finish going away: iOS presents it from the top view
  // controller, which the closing sheet still is (CDXC in screens/terminal-screen/use-agent-actions.ts).
  const pending = useRef<(() => void) | null>(null);
  const importAnswers = () => {
    void pickExportedAnswers().then(
      (text) => {
        if (text !== null) dispatch({ type: 'importPageAnswers', text });
      },
      () => undefined,
    );
  };
  if (rows.length === 0) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More"
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.6 }]}
      >
        <Glyph name="dots" size={size} color={color} />
      </Pressable>
      <MenuSheet
        rows={open ? rows : null}
        onClose={() => setOpen(false)}
        onDismissed={() => {
          const run = pending.current;
          pending.current = null;
          run?.();
        }}
        onCommand={(command) => {
          if (command.local === 'importAnswers') {
            if (Platform.OS === 'ios') pending.current = importAnswers;
            else importAnswers();
            return;
          }
          dispatch(command as UserAction);
          if (command.type === 'snoozeQuestion') onSnoozed?.();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: 30, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
});
