/**
 * The phone's New Coordinator form, opened from a project's agent menu: name the orchestrator, pick
 * its agent, model and effort, and see the locked line its first message starts with.
 *
 * The desktop's dialog is apps/desktop/src/app/window/new_coordinator_modal.rs; the copy and the
 * defaults match it. The choices come from `ghostex coordinator options` and the orchestrator is
 * created by `ghostex coordinator create`, so the agent list, the Claude-on-Opus-5.5 default, the
 * Low/Medium/High/XHigh efforts with High first choice and each agent's skill line are gxserver's
 * (server/src/ghostex_cli/coordinator/command.rs), and an unnamed orchestrator gets gxserver's
 * placeholder title. Half folded like a laptop the card keeps off the fold (`useFoldCardPlacement`).
 *
 * CDXC:Coordinators 2026-11-09 WHY:
 * The contributor (sebastianarena, PR #542) chose this, from his own "Can I choose where the coordinator runs?": A project cloned twice on this computer (the list merges the copies, contract/grouping.ts) gets a Folder row between Name and Agent, each folder named by the end of its path, starting on the folder with the project's newest session (else the project's own); the form stays open until the coordinator is created and shows a refusal itself. One folder shows no row.
 * SEE-ALSO: apps/desktop/src/app/window/new_coordinator_computer.rs (the desktop's Computer field, which also offers other computers).
 *
 * CDXC:Coordinators 2026-10-17 DECISION:
 * User: "let's please allow picking more cli agents here ... we should just include a line that can't be removed saying: "Read and adhere to this skill: /ghostex-orchestrator" ... also remove this [First request] and this [Goal]", and for the phone: "phone too". No Goal or First request field; the first message is shown locked.
 */

import { useMemo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CreateCoordinatorInput } from '../../commands/ghostexCli';
import type { ProjectCopy } from '../../contract/grouping';
import { useFoldCardPlacement } from '../../components/common/foldAvoidance';
import KeyboardAvoidingContainer from '../../components/common/keyboard/KeyboardAvoidingContainer';
import { LockGlyph } from '../../components/onboarding/SetupIcons';
import KeyboardAwareScrollView from '../../components/common/keyboard/KeyboardAwareScrollView';
import { GhostexStrokeWidth } from '../../theme/palette';

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

/** A lineup longer than this gets a search field above its Model chips (OpenCode lists hundreds). */
const MODEL_SEARCH_THRESHOLD = 12;
/** How many matching Model chips the search shows at once. */
const MODEL_SEARCH_LIMIT = 24;

/**
 * The Model chips a long lineup shows: the models whose label or id has every typed word, at most
 * MODEL_SEARCH_LIMIT of them, with the picked one always among them.
 */
function searchedModels(models: CoordinatorModel[], query: string, picked: string): CoordinatorModel[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const matches = models.filter((model) => {
    const haystack = `${model.label} ${model.value}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  const shown = matches.slice(0, MODEL_SEARCH_LIMIT);
  const selected = models.find((model) => model.value === picked);
  if (selected !== undefined && !shown.includes(selected)) shown.unshift(selected);
  return shown;
}

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
        // OpenCode's first row ("OpenCode's default") has no value: it keeps OpenCode's own model.
        .filter((model) => model.value.length > 0 || model.label.length > 0),
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

/** Why Create did not make the coordinator: a plain sentence, the computer's words (behind Details), and `open` when it made one that did not start. */
export type NewCoordinatorRefusal = {
  message: string;
  details?: string;
  open?: () => void;
  /** The computer's answer was not understood and its list could not be read: Create stays off. */
  uncertain?: boolean;
};

export type NewCoordinatorSheetProps = {
  projectTitle: string;
  /** The project's folders on this computer when it is cloned twice (the Folder row); absent for one. */
  copies?: ProjectCopy[];
  /** The folder the Folder row starts on: one of `copies`. */
  defaultProjectId?: string;
  loadOptions: () => Promise<CoordinatorOptions>;
  /**
   * Resolves to why it was not created, or null once it is (the form is closed then). `stillOpen` says whether this
   * form is still the one on screen, so a late answer never closes a newer one.
   */
  onCreate: (
    input: Omit<CreateCoordinatorInput, 'projectId'> & { agentName: string; projectId?: string },
    stillOpen: () => boolean,
  ) => Promise<NewCoordinatorRefusal | null>;
  onCancel: () => void;
};

export default function NewCoordinatorSheet({
  projectTitle,
  copies,
  defaultProjectId,
  loadOptions,
  onCreate,
  onCancel,
}: NewCoordinatorSheetProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const [options, setOptions] = useState<CoordinatorOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [name, setName] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const folders = copies !== undefined && copies.length > 1 ? copies : null;
  const [folder, setFolder] = useState(
    () => folders?.find((copy) => copy.projectId === defaultProjectId)?.projectId ?? folders?.[0]?.projectId ?? '',
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<NewCoordinatorRefusal | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

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
    setModelQuery('');
    setModel(startModel?.value ?? '');
    setEffort(effortFor(startModel, pickedEffort, loaded.defaultEffort));
  };

  const agent = options?.agents.find((entry) => entry.agentId === agentId);
  const selectedModel = agent?.models.find((entry) => entry.value === model);
  // A coordinator made but not started is opened, never created again.
  const createdAlready = createError?.open !== undefined || createError?.uncertain === true;
  const canCreate = agent !== undefined && !creating && !createdAlready;
  // While Create runs (and once a coordinator was made) the choices it sent are fixed, so the form never shows
  // a folder, name or agent other than the ones the computer is acting on.
  const locked = creating || createdAlready;

  const create = (): void => {
    if (agent === undefined || creating || createdAlready) return;
    setCreating(true);
    setCreateError(null);
    setDetailsOpen(false);
    void onCreate(
      {
        agentId: agent.agentId,
        agentName: agent.name,
        title: name,
        model,
        effort,
        ...(folders !== null ? { projectId: folder } : {}),
      },
      () => mounted.current,
    ).then(
      (refused) => {
        if (!mounted.current) return;
        setCreating(false);
        setCreateError(refused);
      },
      (error: unknown) => {
        if (!mounted.current) return;
        setCreating(false);
        setCreateError({
          message: 'Coordinator not created. Try again.',
          details: error instanceof Error ? error.message : String(error),
        });
      },
    );
  };

  const chipRow = (
    label: string,
    items: Choice[],
    selected: string,
    onPick: (value: string) => void,
    header?: ReactNode,
  ) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {header}
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {items.map((item) => {
          const isSelected = item.value === selected;
          return (
            <Pressable
              key={item.value || 'default'}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled: locked }}
              disabled={locked}
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
                  editable={!locked}
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Checkout redesign"
                  placeholderTextColor={appearance.muted}
                />
                <Text style={styles.hint}>
                  Shown in the sidebar so you can find this coordinator later. It keeps this name.
                </Text>
              </View>
              {folders !== null
                ? chipRow(
                    'Folder',
                    folders.map((copy) => ({ value: copy.projectId, label: copy.label })),
                    folder,
                    (value) => {
                      if (locked) return;
                      setFolder(value);
                      setCreateError(null);
                    },
                  )
                : null}
              {folders !== null ? <Text style={styles.hint}>Where the coordinator runs.</Text> : null}
              {options === null ? (
                loadError === null ? (
                  <ActivityIndicator style={styles.loading} color={appearance.muted} />
                ) : (
                  <Text style={styles.error}>{loadError}</Text>
                )
              ) : options.agents.length === 0 ? (
                <Text style={styles.error}>
                  No agent a coordinator can run on is set up on this computer: Claude, Codex, ZCode, Cursor, Grok,
                  Copilot, Antigravity, Pi, OMP, OpenCode or DeepSeek Harness.
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
                    ? chipRow(
                        'Model',
                        agent.models.length > MODEL_SEARCH_THRESHOLD
                          ? searchedModels(agent.models, modelQuery, model)
                          : agent.models,
                        model,
                        (value) => {
                          setModel(value);
                          setEffort(
                            effortFor(
                              agent.models.find((entry) => entry.value === value),
                              effort,
                              options.defaultEffort,
                            ),
                          );
                        },
                        agent.models.length > MODEL_SEARCH_THRESHOLD ? (
                          <TextInput
                            keyboardAppearance={appearance.light ? 'light' : 'dark'}
                            accessibilityLabel="Search models"
                            style={[styles.input, styles.modelSearch]}
                            value={modelQuery}
                            onChangeText={setModelQuery}
                            placeholder={`Search ${agent.models.length} models`}
                            placeholderTextColor={appearance.muted}
                            autoCapitalize="none"
                            autoCorrect={false}
                          />
                        ) : undefined,
                      )
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
                    <LockGlyph size={14} color={appearance.muted} />
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
              {createError !== null ? (
                <View>
                  <Text style={styles.error}>{createError.message}</Text>
                  {createError.details !== undefined && createError.details.length > 0 ? (
                    <Pressable accessibilityRole="button" onPress={() => setDetailsOpen((open) => !open)}>
                      <Text style={styles.hint}>{detailsOpen ? 'Hide details' : 'Details'}</Text>
                    </Pressable>
                  ) : null}
                  {detailsOpen && createError.details !== undefined ? (
                    <Text style={styles.hint} selectable>
                      {createError.details}
                    </Text>
                  ) : null}
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
                {createError?.open !== undefined ? (
                  <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={createError.open}>
                    <Text style={styles.primaryLabel}>Open coordinator</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!canCreate}
                    style={[styles.primaryButton, !canCreate ? styles.buttonDisabled : null]}
                    onPress={create}
                  >
                    <Text style={styles.primaryLabel}>{creating ? 'Creating…' : 'Create'}</Text>
                  </Pressable>
                )}
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
  modelSearch: {
    marginBottom: 8,
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
  loading: {
    marginTop: 16,
  },
  error: {
    color: appearance.muted,
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
    backgroundColor: appearance.accent,
    alignItems: 'center',
    paddingVertical: 10,
  },
  buttonDisabled: {
    opacity: 0.4,
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
