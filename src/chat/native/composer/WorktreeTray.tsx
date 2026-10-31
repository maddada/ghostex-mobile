/**
 * The worktree tray on top of a new chat's message box (`worktree_tray.rs` on desktop): the project
 * and machine chip, This folder, New worktree (from a base branch) or Existing, from the document's `worktreeTray` key. gx-chat-core
 * decides when it shows, what it offers and what is picked; this only lays it out, opens the base
 * branch and worktree lists in the composer's menu sheet, and reports picks. No branch name is shown:
 * gxserver makes it from the first message.
 */

import { Pressable, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { WorktreeTray as Tray } from '../../rust/document';
import { Glyph } from './icons';
import type { MenuRow } from './MenuSheet';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function WorktreeTray({
  tray,
  dispatch,
  openRows,
  retry,
  projectLabel,
  openProjects,
}: {
  tray: Tray;
  dispatch: (action: UserAction) => void;
  /** Opens the composer's menu sheet with these rows. */
  openRows: (title: string, rows: MenuRow[]) => void;
  /** Sends the box's text again (Try again after a failure). */
  retry: () => void;
  /** The project chip's words, or null while the tray can't offer one. */
  projectLabel: string | null;
  /** Opens the project and machine search. */
  openProjects: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const status = tray.status;
  const chip = (label: string, title: string, rows: MenuRow[]) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={tray.busy}
      onPress={() => openRows(title, rows)}
      style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
    >
      <Glyph name="git-branch" size={13} color={P.muted} />
      <Text style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
      <Glyph name="chevron-down" size={12} color={P.muted} />
    </Pressable>
  );
  return (
    <View style={styles.tray}>
      {projectLabel !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Project: ${projectLabel}`}
          disabled={tray.busy}
          onPress={openProjects}
          style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
        >
          <Glyph name="folder" size={13} color={P.muted} />
          <Text style={styles.chipText} numberOfLines={1}>
            {projectLabel}
          </Text>
          <Glyph name="chevron-down" size={12} color={P.muted} />
        </Pressable>
      ) : null}
      {tray.segments.length > 0 ? (
      <View style={styles.segments} accessibilityRole="radiogroup">
        {tray.segments.map((segment, index) => {
          const on = segment.mode === tray.mode;
          return (
            <Pressable
              key={segment.mode}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: tray.busy }}
              accessibilityLabel={segment.label}
              disabled={on || tray.busy}
              onPress={() => dispatch({ type: 'setDraftWorktree', mode: segment.mode })}
              style={[styles.segment, index > 0 ? styles.segmentDivider : null, on ? styles.segmentOn : null]}
            >
              <Text style={[styles.segmentText, on ? styles.segmentTextOn : null]} numberOfLines={1}>
                {segment.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      ) : null}
      {status?.state === 'creating' || status?.state === 'opened' ? (
        <View style={styles.status}>
          <Glyph name="loader" size={13} color={P.muted} />
          <Text style={styles.statusText} numberOfLines={1}>
            {status.label}
          </Text>
        </View>
      ) : null}
      {status?.state === 'failed' ? (
        <View style={styles.status}>
          <Glyph name="alert-triangle" size={13} color={P.error} />
          <Text style={[styles.statusText, { color: P.error }]} numberOfLines={2}>
            {status.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={retry}
            style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
          >
            <Text style={styles.chipText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {status === null && tray.mode === 'newWorktree'
        ? chip(
            tray.baseBranch ?? 'main',
            'Start the worktree from',
            tray.branches.map((branch) => ({
              label: branch.name,
              detail: branch.current === true ? 'Current' : '',
              checked: branch.name === tray.baseBranch,
              command: { type: 'setDraftWorktree', baseBranch: branch.name },
            })),
          )
        : null}
      {status === null && tray.mode === 'existingWorktree'
        ? chip(
            tray.worktreeLabel ?? 'Pick a worktree',
            'Existing worktrees',
            tray.worktrees.map((worktree) => ({
              label: worktree.name,
              detail: worktree.branch,
              checked: worktree.worktreeKey === tray.worktreeKey,
              command: { type: 'setDraftWorktree', worktreeKey: worktree.worktreeKey },
            })),
          )
        : null}
      {status === null && tray.segments.length > 0 && tray.mode === 'folder' && tray.currentBranch !== null ? (
        <View style={styles.current}>
          <Glyph name="git-branch" size={13} color={P.muted} />
          <Text style={styles.statusText} numberOfLines={1}>
            {tray.currentBranch}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  /** Attached to the box like a tab: inset from its corners, no bottom edge, over the root's gap. */
  tray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: -9,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 7,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: P.composerBorder,
    backgroundColor: P.background,
  },
  segments: {
    flexDirection: 'row',
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.composerBorder,
    overflow: 'hidden',
  },
  segment: { justifyContent: 'center', paddingHorizontal: 10 },
  segmentDivider: { borderLeftWidth: 1, borderLeftColor: P.composerBorder },
  segmentOn: { backgroundColor: P.border },
  segmentText: { color: P.muted, fontSize: 13 },
  segmentTextOn: { color: P.primary },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: P.composerBorder,
    backgroundColor: P.composerBackground,
    maxWidth: 200,
  },
  pressed: { backgroundColor: P.border },
  chipText: { color: P.primary, fontSize: 12.5, flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexGrow: 1 },
  statusText: { color: P.muted, fontSize: 12.5, flexShrink: 1 },
  current: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto' },
}));
