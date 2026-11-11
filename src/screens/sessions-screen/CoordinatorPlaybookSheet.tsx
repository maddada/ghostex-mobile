/**
 * The phone's View playbook: the playbook an orchestrator reads, read-only, opened from its row's
 * long-press menu or its chat's More sheet. The text is what `ghostex coordinator guide` prints for its project: Ghostex's
 * playbook, the reply format the user chose, then the user's overrides. The desktop shows the same
 * page from the same row (apps/desktop/src/app/window/coordinator_details_modal.rs).
 *
 * CDXC:Coordinators 2026-11-09 WHY: the user: "i still don't know how a user can see the
 * coordinator playbook". Overrides stay a computer-side edit (Settings > Chat > Coordinator
 * playbook), so this sheet only reads.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useFoldCardPlacement } from '../../components/common/foldAvoidance';
import { runGhostexCli } from '../../components/sessions/cli';
import { coordinatorGuideCommand } from '../../commands/ghostexCli';
import { GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

/**
 * The playbook a project's coordinators read (`ghostex coordinator guide --project-id`, which every
 * computer from 11.2.1 answers), for this sheet wherever it opens: a coordinator's long-press menu
 * and its chat's More sheet.
 */
export async function loadCoordinatorPlaybook(
  machine: Parameters<typeof runGhostexCli>[0],
  projectId: string,
): Promise<string> {
  const { stdout } = await runGhostexCli(machine, coordinatorGuideCommand(projectId));
  return stdout.trim();
}

export type CoordinatorPlaybookSheetProps = {
  /** The guide's text; a rejection shows its message in the sheet. */
  load: () => Promise<string>;
  onClose: () => void;
};

export default function CoordinatorPlaybookSheet({ load, onClose }: CoordinatorPlaybookSheetProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const [guide, setGuide] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (text) => {
        if (!cancelled) setGuide(text);
      },
      (loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      },
    );
    return () => {
      cancelled = true;
    };
    // Read once per opening of the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placement = useFoldCardPlacement({ avoidsKeyboard: false, belowSafeAreaTop: true });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, placement.style]} onPress={onClose}>
        <Pressable style={styles.card} onLayout={placement.onCardLayout} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>Coordinator playbook</Text>
          <Text style={styles.body}>
            What this coordinator follows: Ghostex&apos;s playbook and your reply format, then your overrides, which it
            follows over the playbook. Edit your overrides on the computer, in Settings &gt; Chat &gt; Coordinator
            playbook.
          </Text>
          {guide === null && error === null ? <ActivityIndicator style={styles.loading} color={appearance.muted} /> : null}
          {error !== null ? <Text style={styles.error}>{error}</Text> : null}
          {guide !== null ? (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              <Text selectable style={styles.guide}>
                {guide.length > 0 ? guide : 'This computer did not show a playbook.'}
              </Text>
            </ScrollView>
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            onPress={onClose}
          >
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    // The same card as the Goal & Instructions and Memory sheets (CoordinatorDetailsSheet.tsx).
    backdrop: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    card: {
      backgroundColor: appearance.background,
      borderRadius: 12,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      maxHeight: '100%',
      overflow: 'hidden',
      padding: 16,
    },
    title: {
      color: appearance.foreground,
      fontSize: 17,
      fontWeight: 'bold',
    },
    body: {
      color: appearance.muted,
      fontSize: 12,
      marginTop: 8,
      lineHeight: 17,
    },
    loading: {
      marginTop: 16,
    },
    error: {
      color: appearance.muted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 14,
    },
    scroll: {
      marginTop: 12,
      flexGrow: 0,
      flexShrink: 1,
      borderRadius: 8,
      backgroundColor: appearance.card,
    },
    scrollContent: {
      padding: 12,
    },
    guide: {
      color: appearance.foreground,
      fontSize: 13,
      lineHeight: 19,
    },
    closeButton: {
      marginTop: 16,
      borderRadius: 8,
      backgroundColor: appearance.neutralFill,
      alignItems: 'center',
      paddingVertical: 10,
    },
    closeButtonPressed: {
      backgroundColor: appearance.neutralFillPressed,
    },
    closeLabel: {
      color: appearance.foreground,
      fontSize: 14,
    },
  });
