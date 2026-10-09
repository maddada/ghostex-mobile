/**
 * The phone's New Coordinator form, opened from a project's agent menu: name the coordinator, pick
 * its agent, model and effort, and optionally give it a goal and a first request.
 *
 * The desktop's dialog is apps/desktop/src/app/window/new_coordinator_modal.rs; the copy and the
 * defaults match it. The choices come from `ghostex coordinator options` and the coordinator is
 * created by `ghostex coordinator create`, so the lineup, the Claude-on-Opus-5.5 default and the
 * medium effort default are gxserver's (server/src/ghostex_cli/coordinator/command.rs), and an
 * unnamed coordinator gets gxserver's placeholder title.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CreateCoordinatorInput } from '../../commands/ghostexCli';
import KeyboardAvoidingContainer from '../../components/common/keyboard/KeyboardAvoidingContainer';
import KeyboardAwareScrollView from '../../components/common/keyboard/KeyboardAwareScrollView';
import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';

type Choice = { value: string; label: string };
type CoordinatorModel = Choice & { efforts: Choice[] };
type CoordinatorAgent = { agentId: string; name: string; models: CoordinatorModel[]; defaultModel: string };
export type CoordinatorOptions = { agents: CoordinatorAgent[]; defaultEffort: string };

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
      models: records(agent.models)
        .map((model) => ({
          value: text(model.value),
          label: text(model.label) || text(model.value),
          efforts: choices(model.efforts),
        }))
        .filter((model) => model.value.length > 0),
    }))
    .filter((agent) => agent.agentId.length > 0);
  return { agents, defaultEffort: text(root.defaultEffort) };
}

/** The effort a model starts on: the one already picked when it takes it, else the default, else its first. */
function effortFor(model: CoordinatorModel | undefined, picked: string, fallback: string): string {
  const efforts = model?.efforts ?? [];
  if (efforts.some((effort) => effort.value === picked)) return picked;
  return (efforts.find((effort) => effort.value === fallback) ?? efforts[0])?.value ?? '';
}

export type NewCoordinatorSheetProps = {
  projectTitle: string;
  loadOptions: () => Promise<CoordinatorOptions>;
  onCreate: (input: Omit<CreateCoordinatorInput, 'projectId'> & { agentName: string }) => void;
  onCancel: () => void;
};

export default function NewCoordinatorSheet({ projectTitle, loadOptions, onCreate, onCancel }: NewCoordinatorSheetProps) {
  const [options, setOptions] = useState<CoordinatorOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [request, setRequest] = useState('');

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
      goal,
      task: request,
      model,
      effort,
    });
  };

  const chipRow = (
    label: string,
    items: Choice[],
    selected: string,
    onPick: (value: string) => void,
  ) => (
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
              <Text style={styles.title}>New Orchestrator</Text>
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
                <Text style={styles.hint}>Shown in the sidebar so you can find this orchestrator later. It keeps this name.</Text>
              </View>
              {options === null ? (
                loadError === null ? (
                  <ActivityIndicator style={styles.loading} color={GhostexPalette.MUTED} />
                ) : (
                  <Text style={styles.error}>{loadError}</Text>
                )
              ) : options.agents.length === 0 ? (
                <Text style={styles.error}>
                  No Claude, Codex, ZCode or Empryo agent is set up on this computer. An orchestrator runs on one of them.
                </Text>
              ) : (
                <>
                  {chipRow(
                    'Agent',
                    options.agents.map((entry) => ({ value: entry.agentId, label: entry.name })),
                    agentId,
                    (value) => {
                      const next = options.agents.find((entry) => entry.agentId === value);
                      if (next !== undefined) pickAgent(next, options, effort);
                    },
                  )}
                  {agent !== undefined && agent.models.length > 0
                    ? chipRow('Model', agent.models, model, (value) => {
                        setModel(value);
                        setEffort(effortFor(agent.models.find((entry) => entry.value === value), effort, options.defaultEffort));
                      })
                    : null}
                  {selectedModel !== undefined && selectedModel.efforts.length > 0
                    ? chipRow('Effort', selectedModel.efforts, effort, setEffort)
                    : null}
                </>
              )}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Goal (optional)</Text>
                <TextInput
                  accessibilityLabel="Goal"
                  style={styles.input}
                  value={goal}
                  onChangeText={setGoal}
                  placeholder="One line it works toward, e.g. Ship the new checkout by Friday"
                  placeholderTextColor={GhostexPalette.MUTED}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>First request (optional)</Text>
                <TextInput
                  accessibilityLabel="First request"
                  style={[styles.input, styles.multiline]}
                  value={request}
                  onChangeText={setRequest}
                  multiline
                  placeholder="Describe the work. It plans it, starts a thread for each task, and reports back."
                  placeholderTextColor={GhostexPalette.MUTED}
                />
                <Text style={styles.hint}>Threads show up under the orchestrator in the session list.</Text>
              </View>
              <View style={styles.buttonRow}>
                <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={onCancel}>
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
  multiline: {
    minHeight: 88,
    textAlignVertical: 'top',
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
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
  },
});
