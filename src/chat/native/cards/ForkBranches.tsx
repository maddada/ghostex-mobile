/**
 * The fork branch switcher (desktop `fork_branches.rs`): a small button in the top right of the
 * conversation, drawn only when this session has a fork family (`forkBranches`), with the branch
 * glyph and the count. It opens the family as rows: the core's own `menu` (the "Branches" heading,
 * one row per branch with its lifecycle dot, "Current" on this one), and a pick runs the row's
 * `selectForkBranch`, which the screen performs (`sessionShell.ts`, `openForkBranch`).
 *
 * CDXC:SessionFork 2026-09-25 SEE-ALSO:
 * The placement and the tooltip are the user's decisions in
 * apps/desktop/src/app/native_chat/fork_branches.rs. A phone has no hover, so the tooltip's
 * sentence is the button's accessibility label and the description under the sheet's heading.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph } from '../composer/icons';
import { MenuSheet, rowsOf, type MenuRow } from '../composer/MenuSheet';
import { useTranscriptTheme } from '../transcript/theme';
import { num, obj, str } from './json';

export function ForkBranchBadge({ chat }: { chat: RustChat }) {
  const theme = useTranscriptTheme();
  const [open, setOpen] = useState(false);
  const branches = obj(chat.state?.document?.forkBranches);
  const count = num(branches, 'count');
  const tooltip = str(branches, 'tooltip');
  const menu = branches?.menu;
  const rows = useMemo<MenuRow[]>(
    () => rowsOf(menu).map((row) => (row.heading === true && tooltip.length > 0 ? { ...row, description: tooltip } : row)),
    [menu, tooltip]
  );
  if (count === null) return null;
  return (
    <>
      <View pointerEvents='box-none' style={styles.anchor}>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole='button'
          accessibilityLabel={tooltip}
          hitSlop={8}
          style={({ pressed }) => [
            styles.badge,
            { borderColor: theme.controlBorder, backgroundColor: open || pressed ? theme.border : theme.background },
          ]}
        >
          <Glyph name='git-branch' size={14} color={theme.muted} />
          <Text style={[styles.count, { color: theme.muted }]}>{count}</Text>
        </Pressable>
      </View>
      <MenuSheet
        rows={open && rows.length > 0 ? rows : null}
        onClose={() => setOpen(false)}
        onCommand={(command) => {
          chat.dispatch(command as UserAction);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Clear of the list's own scroll indicator at the right edge, as desktop keeps it off its scrollbar.
  // 27 = 10 + the 17 the user moved it left on desktop (2026-10-10), so the two chats match.
  anchor: { position: 'absolute', top: 6, right: 27 },
  badge: { height: 24, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, borderWidth: 1 },
  count: { fontSize: 11 },
});
