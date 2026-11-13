/**
 * The phone's New Coordinator form, opened from a project's agent menu: name the coordinator, pick
 * its folder when the project is cloned twice, and see the locked line its first message starts
 * with. Next opens the agent menu as "Pick the coordinator's agent", and the pick creates it
 * (use-sessions-screen-menus.tsx `coordinatorAgentMenuItems`).
 *
 * The desktop's dialog is apps/desktop/src/app/window/new_coordinator_modal.rs; the copy matches
 * it. The coordinator is created by `ghostex coordinator create`, so its start model and effort
 * (Opus 5.5 at High on Claude) and an unnamed coordinator's placeholder title are gxserver's
 * (server/src/ghostex_cli/coordinator/command.rs). Half folded like a laptop the card keeps off the
 * fold (`useFoldCardPlacement`).
 *
 * CDXC:Coordinators 2026-11-09 WHY:
 * The contributor (sebastianarena, PR #542) chose this, from his own "Can I choose where the coordinator runs?": A project cloned twice on this computer (the list merges the copies, contract/grouping.ts) gets a Folder row under Name, each folder named by the end of its path, starting on the folder with the project's newest session (else the project's own). One folder shows no row.
 * SEE-ALSO: apps/desktop/src/app/window/new_coordinator_computer.rs (the desktop's Computer field, which also offers other computers).
 *
 * CDXC:Coordinators 2026-10-17 DECISION:
 * User: "we should just include a line that can't be removed saying: "Read and adhere to this skill: /ghostex-orchestrator" ... also remove this [First request] and this [Goal]", and for the phone: "phone too". No Goal or First request field; the first message is shown locked.
 *
 * CDXC:Coordinators 2026-11-13 DECISION:
 * User (Q2980 "Build it: auto-send + remind on drift"): the form drops its Agent, Model and Effort fields; Next opens the normal agent picker titled "Pick the coordinator's agent", where any agent may be picked, and the pick starts the coordinator and sends its first message. Agents whose start model may make a weaker coordinator carry the warning on their row.
 */

import { useMemo, useState } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ProjectCopy } from '../../contract/grouping';
import { useFoldCardPlacement } from '../../components/common/foldAvoidance';
import KeyboardAvoidingContainer from '../../components/common/keyboard/KeyboardAvoidingContainer';
import { LockGlyph } from '../../components/onboarding/SetupIcons';
import KeyboardAwareScrollView from '../../components/common/keyboard/KeyboardAwareScrollView';
import { GhostexStrokeWidth } from '../../theme/palette';
import { coordinatorQualityWarning } from '../../sessions/coordinatorQuality';

/**
 * The (i) text beside "New Orchestrator…" in the agent menu.
 * SEE-ALSO: NEW_ORCHESTRATOR_BENEFITS in packages/gx-core/src/sidebar_menu/header.rs (the desktop's tooltip; keep the two equal).
 */
export const NEW_ORCHESTRATOR_BENEFITS = `Recommended
• The main way Ghostex itself is built
• You talk to one agent and the work gets done
• It keeps improving as it saves memories about your project
• Needs a very good model, e.g. Opus 5.5 at high or xhigh`;

/** The locked first line before the agent is picked: the skill by its name, which each agent's first message writes its own way. */
const FIRST_LINE = 'Read and adhere to this skill: ghostex-coordinator';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    : [];
}

/**
 * `ghostex coordinator options --json`, read for the agent step's warnings: each listed agent's
 * warning by the model and effort it starts a coordinator on. A computer from before 2026-11-13
 * lists only the agents a coordinator could run on then.
 */
export function coordinatorAgentWarnings(json: unknown): Record<string, string> {
  const root = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  const warnings: Record<string, string> = {};
  for (const agent of records(root.agents)) {
    const agentId = text(agent.agentId);
    if (agentId.length === 0) continue;
    const models = records(agent.models);
    const startValue = text(agent.defaultModel);
    const start = models.find((model) => text(model.value) === startValue);
    const warning = coordinatorQualityWarning(
      { value: startValue, label: start === undefined ? '' : text(start.label) },
      start === undefined ? undefined : text(start.defaultEffort),
    );
    if (warning !== null) warnings[agentId] = warning;
  }
  return warnings;
}

/** What Next hands on: the name ('' leaves it unnamed) and, for a project cloned twice, the folder. */
export type NewCoordinatorPick = { title: string; projectId?: string };

export type NewCoordinatorSheetProps = {
  projectTitle: string;
  /** The project's folders on this computer when it is cloned twice (the Folder row); absent for one. */
  copies?: ProjectCopy[];
  /** The folder the Folder row starts on: one of `copies`. */
  defaultProjectId?: string;
  onNext: (pick: NewCoordinatorPick) => void;
  onCancel: () => void;
};

export default function NewCoordinatorSheet({
  projectTitle,
  copies,
  defaultProjectId,
  onNext,
  onCancel,
}: NewCoordinatorSheetProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const [name, setName] = useState('');
  const folders = copies !== undefined && copies.length > 1 ? copies : null;
  const [folder, setFolder] = useState(
    () => folders?.find((copy) => copy.projectId === defaultProjectId)?.projectId ?? folders?.[0]?.projectId ?? '',
  );

  const next = (): void => onNext({ title: name.trim(), ...(folders !== null ? { projectId: folder } : {}) });

  const placement = useFoldCardPlacement({ avoidsKeyboard: true, belowSafeAreaTop: true });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingContainer safeAreaTop style={styles.keyboardFill}>
        <Pressable style={[styles.backdrop, placement.style]} onPress={onCancel}>
          <Pressable style={styles.card} onLayout={placement.onCardLayout} onPress={(event) => event.stopPropagation()}>
            <KeyboardAwareScrollView contentContainerStyle={styles.cardContent}>
              <Text style={styles.title}>New Coordinator</Text>
              <Text style={styles.body}>
                {`One agent you talk to about ${projectTitle}. It plans the work, hands each task to a thread (its own agent session, optionally in its own worktree), and reports back when threads finish or need you.`}
              </Text>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  keyboardAppearance={appearance.light ? 'light' : 'dark'}
                  accessibilityLabel="Name"
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Checkout redesign"
                  placeholderTextColor={appearance.muted}
                  returnKeyType="next"
                  onSubmitEditing={next}
                />
                <Text style={styles.hint}>
                  Shown in the sidebar so you can find this coordinator later. It keeps this name.
                </Text>
              </View>
              {folders !== null ? (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Folder</Text>
                  <View accessibilityRole="radiogroup" style={styles.chips}>
                    {folders.map((copy) => {
                      const isSelected = copy.projectId === folder;
                      return (
                        <Pressable
                          key={copy.projectId}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: isSelected }}
                          style={[styles.chip, isSelected ? styles.chipSelected : null]}
                          onPress={() => setFolder(copy.projectId)}
                        >
                          <Text style={[styles.chipLabel, isSelected ? styles.chipLabelSelected : null]}>
                            {copy.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.hint}>Where the coordinator runs.</Text>
                </View>
              ) : null}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>First message</Text>
                <View accessibilityLabel={`First message, locked: ${FIRST_LINE}`} style={styles.lockedLine}>
                  <LockGlyph size={14} color={appearance.muted} />
                  <Text style={styles.lockedText} selectable>
                    {FIRST_LINE}
                  </Text>
                </View>
                <Text style={styles.hint}>
                  Every coordinator starts with this line, which loads its playbook, written the way its agent runs a
                  skill. Write your first request in its chat.
                </Text>
              </View>
              <View style={styles.buttonRow}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
                  onPress={onCancel}
                >
                  <Text style={styles.cancelLabel}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Opens the list of agents to pick the coordinator's"
                  style={styles.primaryButton}
                  onPress={next}
                >
                  <Text style={styles.primaryLabel}>Next</Text>
                </Pressable>
              </View>
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  // The same card as the Session Automations dialog (DelayedSendDialog.tsx).
  keyboardFill: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: appearance.background,
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    maxHeight: '100%',
    overflow: 'hidden',
  },
  cardContent: {
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
  field: {
    marginTop: 14,
  },
  fieldLabel: {
    color: appearance.muted,
    fontSize: 12,
    marginBottom: 4,
  },
  hint: {
    color: appearance.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  input: {
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: appearance.foreground,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  lockedLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  lockedText: {
    flex: 1,
    color: appearance.muted,
    fontSize: 14,
    lineHeight: 19,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: appearance.input,
    borderColor: appearance.border,
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipSelected: {
    borderColor: appearance.accent,
    backgroundColor: appearance.cardActive,
  },
  chipLabel: {
    color: appearance.muted,
    fontSize: 14,
  },
  chipLabelSelected: {
    color: appearance.foreground,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: appearance.accent,
    alignItems: 'center',
    paddingVertical: 10,
  },
  primaryLabel: {
    color: appearance.accentForeground,
    fontSize: 14,
    fontWeight: '600',
  },
  cancelButton: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: appearance.neutralFill,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelButtonPressed: {
    backgroundColor: appearance.neutralFillPressed,
  },
  cancelLabel: {
    color: appearance.foreground,
    fontSize: 14,
  },
});
