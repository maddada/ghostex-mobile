/**
 * The phone's New Coordinator form, opened from a project's agent menu: name the orchestrator, pick
 * its agent, model and effort, and see the locked line its first message starts with.
 *
 * The desktop's dialog is apps/desktop/src/app/window/new_coordinator_modal.rs; the copy and the
 * defaults match it. The choices come from `ghostex coordinator options` and the orchestrator is
 * created by `ghostex coordinator create`, so the agent list, the Claude-on-Opus-5.5 default, the
 * Low/Medium/High/XHigh efforts with High first choice and each agent's skill line are gxserver's
 * (server/src/ghostex_cli/coordinator/command.rs), and an unnamed orchestrator gets gxserver's
 * placeholder title.
 *
 * CDXC:Coordinators 2026-10-17 DECISION:
 * User: "let's please allow picking more cli agents here ... we should just include a line that can't be removed saying: "Read and adhere to this skill: /ghostex-orchestrator" ... also remove this [First request] and this [Goal]", and for the phone: "phone too". No Goal or First request field; the first message is shown locked.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CreateCoordinatorInput } from '../../commands/ghostexCli';
import KeyboardAvoidingContainer from '../../components/common/keyboard/KeyboardAvoidingContainer';
import { LockGlyph } from '../../components/onboarding/SetupIcons';
import KeyboardAwareScrollView from '../../components/common/keyboard/KeyboardAwareScrollView';
import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';

type Choice = { value: string; label: string };
type CoordinatorModel = Choice & { efforts: Choice[]; defaultEffort: string };
type CoordinatorAgent = {
  agentId: string;
  name: string;
  models: CoordinatorModel[];
  defaultModel: string;
  /** The locked first line ("Read and adhere to this skill: …"); '' from a computer before 2026-10-17. */
  skillLine: string;
};
export type CoordinatorOptions = { agents: CoordinatorAgent[]; defaultEffort: string };

/**
 * The (i) text beside "New Orchestrator…" in the agent menu.
 * SEE-ALSO: NEW_ORCHESTRATOR_BENEFITS in packages/gx-core/src/sidebar_menu/header.rs (the desktop's tooltip; keep the two equal).
 */
export const NEW_ORCHESTRATOR_BENEFITS = `Recommended
• The main way Ghostex itself is built
• You talk to one agent and the work gets done
• It keeps improving as it saves memories about your project
• Needs a very good model, e.g. Opus 5.5 at high or xhigh`;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    : [];
}

function choices(value: unknown): Choice[] {
  return records(value)
    .map((entry) => ({ value: text(entry.value), label: text(entry.label) || text(entry.value) }))
    .filter((choice) => choice.value.length > 0);
}

/** `ghostex coordinator options --json`, as the form reads it. */
export function parseCoordinatorOptions(json: unknown): CoordinatorOptions {
  const root = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  const agents = records(root.agents)
    .map((agent) => ({
      agentId: text(agent.agentId),
      name: text(agent.name) || text(agent.agentId),
      defaultModel: text(agent.defaultModel),
      skillLine: text(agent.skillLine),
      models: records(agent.models)
        .map((model) => ({
          value: text(model.value),
          label: text(model.label) || text(model.value),
          efforts: choices(model.efforts),
          defaultEffort: text(model.defaultEffort),
        }))
        .filter((model) => model.value.length > 0),
    }))
    .filter((agent) => agent.agentId.length > 0);
  return { agents, defaultEffort: text(root.defaultEffort) };
}

/**
 * The effort a model starts on: the one already picked when it takes it, else the model's own
 * default (its highest orchestrator level), else the form's default, else its last.
 */
function effortFor(model: CoordinatorModel | undefined, picked: string, fallback: string): string {
  const efforts = model?.efforts ?? [];
  if (efforts.some((effort) => effort.value === picked)) return picked;
  const preferred = [model?.defaultEffort ?? '', fallback];
  return (
    (
      preferred
        .map((value) => efforts.find((effort) => effort.value === value))
        .find((effort) => effort !== undefined) ?? efforts[efforts.length - 1]
    )?.value ?? ''
  );
}

export type NewCoordinatorSheetProps = {
  projectTitle: string;
  loadOptions: () => Promise<CoordinatorOptions>;
  onCreate: (input: Omit<CreateCoordinatorInput, 'projectId'> & { agentName: string }) => void;
  onCancel: () => void;
};

export default function NewCoordinatorSheet({
  projectTitle,
  loadOptions,
  onCreate,
  onCancel,
}: NewCoordinatorSheetProps) {
  const [options, setOptions] = useState<CoordinatorOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadOptions().then(
      (loaded) => {
        if (cancelled) return;
        setOptions(loaded);
        const first = loaded.agents[0];
        if (first !== undefined) pickAgent(first, loaded, '');
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
    // The options load once per opening of the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickAgent = (agent: CoordinatorAgent, loaded: CoordinatorOptions, pickedEffort: string): void => {
    const startModel = agent.models.find((entry) => entry.value === agent.defaultModel) ?? agent.models[0];
    setAgentId(agent.agentId);
    setModel(startModel?.value ?? '');
    setEffort(effortFor(startModel, pickedEffort, loaded.defaultEffort));
  };

  const agent = options?.agents.find((entry) => entry.agentId === agentId);
  const selectedModel = agent?.models.find((entry) => entry.value === model);
  const canCreate = agent !== undefined;

  const create = (): void => {
    if (agent === undefined) return;
    onCreate({
      agentId: agent.agentId,
      agentName: agent.name,
      title: name,
      model,
      effort,
    });
  };

  const chipRow = (label: string, items: Choice[], selected: string, onPick: (value: string) => void) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {items.map((item) => {
          const isSelected = item.value === selected;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              style={[styles.chip, isSelected ? styles.chipSelected : null]}
              onPress={() => onPick(item.value)}
            >
              <Text style={[styles.chipLabel, isSelected ? styles.chipLabelSelected : null]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingContainer safeAreaTop style={styles.keyboardFill}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
            <KeyboardAwareScrollView contentContainerStyle={styles.cardContent}>
              <Text style={styles.title}>New Coordinator</Text>
              <Text style={styles.body}>
                {`One agent you talk to about ${projectTitle}. It plans the work, hands each task to a thread (its own agent session, optionally in its own worktree), and reports back when threads finish or need you.`}
              </Text>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  accessibilityLabel="Name"
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Checkout redesign"
                  placeholderTextColor={GhostexPalette.MUTED}
                />
                <Text style={styles.hint}>
                  Shown in the sidebar so you can find this coordinator later. It keeps this name.
                </Text>
              </View>
              {options === null ? (
                loadError === null ? (
                  <ActivityIndicator style={styles.loading} color={GhostexPalette.MUTED} />
                ) : (
                  <Text style={styles.error}>{loadError}</Text>
                )
              ) : options.agents.length === 0 ? (
                <Text style={styles.error}>
                  No agent a coordinator can run on is set up on this computer: Claude, Codex, ZCode, Cursor, Grok,
                  Copilot, Antigravity, Pi or OMP.
                </Text>
              ) : (
                <>
                  {chipRow(
                    'Agent',
                    options.agents.map((entry) => ({ value: entry.agentId, label: entry.name })),
                    agentId,
                    (value) => {
                      const next = options.agents.find((entry) => entry.agentId === value);
                      if (next !== undefined) pickAgent(next, options, '');
                    },
                  )}
                  {agent !== undefined && agent.models.length > 0
                    ? chipRow('Model', agent.models, model, (value) => {
                        setModel(value);
                        setEffort(
                          effortFor(
                            agent.models.find((entry) => entry.value === value),
                            effort,
                            options.defaultEffort,
                          ),
                        );
                      })
                    : null}
                  {selectedModel !== undefined && selectedModel.efforts.length > 0
                    ? chipRow('Effort', selectedModel.efforts, effort, setEffort)
                    : null}
                </>
              )}
              {agent !== undefined && agent.skillLine.length > 0 ? (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>First message</Text>
                  <View accessibilityLabel={`First message, locked: ${agent.skillLine}`} style={styles.lockedLine}>
                    <LockGlyph size={14} color={GhostexPalette.MUTED} />
                    <Text style={styles.lockedText} selectable>
                      {agent.skillLine}
                    </Text>
                  </View>
                  <Text style={styles.hint}>
                    Every coordinator starts with this line, which loads its playbook. Write your first request in its
                    chat.
                  </Text>
                </View>
              ) : null}
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
                  disabled={!canCreate}
                  style={[styles.primaryButton, !canCreate ? styles.buttonDisabled : null]}
                  onPress={create}
                >
                  <Text style={styles.primaryLabel}>Create</Text>
                </Pressable>
              </View>
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: GhostexPalette.BACKGROUND,
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    maxHeight: '100%',
    overflow: 'hidden',
  },
  cardContent: {
    padding: 16,
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 17,
    fontWeight: 'bold',
  },
  body: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
  },
  field: {
    marginTop: 14,
  },
  fieldLabel: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginBottom: 4,
  },
  hint: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  input: {
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: GhostexPalette.FOREGROUND,
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
    borderColor: GhostexPalette.BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  lockedText: {
    flex: 1,
    color: GhostexPalette.MUTED,
    fontSize: 14,
    lineHeight: 19,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderColor: GhostexPalette.BORDER,
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipSelected: {
    borderColor: GhostexPalette.ACCENT,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  chipLabel: {
    color: GhostexPalette.MUTED,
    fontSize: 14,
  },
  chipLabelSelected: {
    color: GhostexPalette.FOREGROUND,
    fontWeight: '600',
  },
  loading: {
    marginTop: 16,
  },
  error: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    paddingVertical: 10,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  cancelButton: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: GhostexPalette.NEUTRAL_FILL,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelButtonPressed: {
    backgroundColor: GhostexPalette.NEUTRAL_FILL_PRESSED,
  },
  cancelLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
  },
});
