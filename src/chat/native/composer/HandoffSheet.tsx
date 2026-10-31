/**
 * Handoff / Export, the phone form of desktop's dialog (`apps/desktop/src/app/window/
 * export_transcript_modal.rs`, opened by `gx_store/git/export_transcript.rs`): the same copy, the
 * two cards, "Continue with", the destination and Include, then the export and the new conversation the export hands over to.
 * It opens from More actions > Handoff / Export, and from the model menu's pick of another agent's
 * model (`handoffToModel`), which selects that agent and launches the new conversation on the
 * picked model when the agent belongs to the model's family.
 *
 * Desktop's Open Location is left out: the file is on the computer. The new conversation opens the
 * way the terminal screen's Export and Fork open theirs (`sessionShell.ts`).
 *
 * CDXC:TranscriptExport 2026-10-31 DECISION:
 * User: the phone gets the desktop's new shape: "Handoff to an agent" and "Handoff to MD", the default destination one quiet row with Change… opening the computer and project choices, the button reading "Handoff to <agent>" here and "Handoff to <project>" (plus "on <computer>") elsewhere, Include closed with everything off, and the same memory. Desktop's "Clone it there…" is left out: Add Project is several screens on the phone and has no way back to this sheet, so the sheet says what the computer lacks and the user adds the project first.
 */

import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import type { GhostexAgentLauncher } from '../../../contract/mobileSummary';
import { resolveAgentArtId } from '../../../contract/mobileSummary';
import {
  branchDifferenceLine,
  handoffBranchNoticeApplies,
  handoffComputer,
  handoffDestinationLabel,
  handoffDestinationSummary,
  handoffIsElsewhere,
  handoffProject,
  handoffProjectLabel,
  openingHandoffDestination,
  parseHandoffPrefs,
  type HandoffComputer,
  type HandoffInclude,
  type HandoffPrefs,
} from '../../../contract/handoff/handoff';
import { useInventoryStore } from '../../../inventory/store';
import type { MachineConnectionTarget } from '../../../machines/credentials';
import { machineTargetFor } from '../../../screens/terminal-screen/session-lookups';
import {
  exportTranscript,
  machineAgents,
  modelPickerProvider,
  projectBranch,
  sessionRecord,
  sessionTitle,
  startHandoffConversation,
} from '../sessionShell';
import { handoffComputersFor } from './handoffComputers';
import { loadHandoffPrefs, saveHandoffPrefs } from './handoffPrefsStore';
import { Glyph, type GlyphName } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';

const TITLE = 'Handoff / Export';
const DESCRIPTION = 'Ghostex writes this conversation to a Markdown file. Pick what to do with it and what to include.';
const HANDOFF_CARD_TITLE = 'Handoff to an agent';
const HANDOFF_CARD_DESCRIPTION = 'Start a new conversation with the handover attached.';
const DESTINATION = 'Destination';
const DESTINATION_CHANGE = 'Change…';
const DESTINATION_RESET = 'Use this project';
const DESTINATION_HIDE = 'Hide choices';
const COMPUTER = 'Computer';
const SELECT_COMPUTER_PLACEHOLDER = 'Select computer';
const PROJECT = 'Project';
const SELECT_PROJECT_PLACEHOLDER = 'Select project';
const NO_COMPUTER_HINT = "No computer is connected. Connect one from the sidebar's computer tabs to hand off to it.";
const BRANCH_NOTICE_TITLE = 'Please note the difference in branches';
const BRANCH_NOTICE_SUBTITLE = "We're just handing off the session, not switching the branch there";
const EXPORT_CARD_TITLE = 'Handoff to MD';
const EXPORT_CARD_DESCRIPTION = 'Save the conversation as a file and copy its path.';
const CONTINUE_WITH = 'Continue with';
const SELECT_AGENT_PLACEHOLDER = 'Select agent';
const EXPORT_HINT = 'The file is saved in the Ghostex exports folder.';
const INCLUDE = 'Include';
const INCLUDE_NOTHING = 'Messages only';
const INCLUDE_ROWS: readonly { key: keyof HandoffInclude; label: string; description: string }[] = [
  {
    key: 'commands',
    label: 'Commands & output',
    description: 'Terminal commands the agent ran, with the tail of their output.',
  },
  { key: 'patches', label: 'File changes', description: 'The patches the agent applied to files.' },
  { key: 'reasoning', label: 'Reasoning', description: "The agent's own reasoning sections." },
];
const SAVED_AS_MARKDOWN = 'Saved as Markdown';
const EXPORT_FAILED = 'The transcript export failed.';

/**
 * One opening of the dialog, with a fresh id so every request reopens it: `target` is the core's
 * `handoffToModel` params, or null for More actions > Handoff / Export.
 */
export type HandoffRequest = { id: number; target: { provider: string; model: string; effort: string } | null };

type Mode = 'handoff' | 'export';

type Picker = 'agent' | 'computer' | 'project';

type Stage =
  | { kind: 'options' }
  | { kind: 'exporting' }
  | { kind: 'starting' }
  | { kind: 'done'; path: string }
  | { kind: 'failed'; message: string };

export function HandoffSheet({
  request,
  machine,
  projectId,
  sessionId,
  onClose,
  onFailure,
}: {
  request: HandoffRequest | null;
  machine: MachineConnectionTarget;
  projectId: string;
  sessionId: string;
  onClose: () => void;
  /** The new conversation could not start after the dialog closed (desktop's toast). */
  onFailure: (title: string, message: string) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [mode, setMode] = useState<Mode>('handoff');
  const [stage, setStage] = useState<Stage>({ kind: 'options' });
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picker | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [include, setInclude] = useState<HandoffInclude>({ commands: false, patches: false, reasoning: false });
  const [includeOpen, setIncludeOpen] = useState(false);
  const [branchNotice, setBranchNotice] = useState<{ key: string; line: string } | null>(null);
  /** The saved choices: changing a card or a switch keeps the agent and destination in here. */
  const saved = useRef<HandoffPrefs>(parseHandoffPrefs(null));
  const agents = useMemo(() => (request === null ? [] : machineAgents(machine.id)), [machine.id, request]);
  const computers = useMemo(
    () => (request === null ? [] : handoffComputersFor(machine.id, projectId)),
    [machine.id, projectId, request],
  );
  const computer = handoffComputer(computers, selectedMachineId);
  const project = computer === null ? null : handoffProject(computer, selectedProjectId);
  const elsewhere = destinationOpen && computer !== null && project !== null && handoffIsElsewhere(computer, project);

  // A model pick means this conversation on that model: it opens on Handoff, here, with that model's
  // agent selected (the user's decision in `export_transcript.rs`). A plain open comes back as the
  // user left it, and a remembered destination opens showing where it goes.
  useEffect(() => {
    if (request === null) return undefined;
    const target = request.target;
    setMode('handoff');
    setStage({ kind: 'options' });
    setPicking(null);
    setCopied(false);
    setSelectedMachineId(null);
    setSelectedProjectId(null);
    setDestinationOpen(false);
    setBranchNotice(null);
    setSelected(
      target === null
        ? null
        : (agents.find((agent) => modelPickerProvider(agent.icon) === target.provider)?.agentId ?? null),
    );
    let current = true;
    void loadHandoffPrefs().then((prefs) => {
      if (!current) return;
      saved.current = prefs;
      setInclude(prefs.include);
      setIncludeOpen(prefs.includeOpen);
      if (target !== null) return;
      setMode(prefs.card === 'markdown' ? 'export' : 'handoff');
      setSelected(prefs.agentId);
      const destination = openingHandoffDestination(prefs.destination, computers);
      if (destination !== null) {
        setSelectedMachineId(destination.machineId);
        setSelectedProjectId(destination.projectId);
      }
      setDestinationOpen(destination !== null || prefs.destinationOpen);
    });
    return () => {
      current = false;
    };
  }, [agents, computers, request]);

  // The branch notice reads both checkouts, as desktop's `git_export_read_branches` does.
  const noticeKey =
    request !== null && mode === 'handoff' && elsewhere && computer !== null && project !== null
      ? `${computer.machineId}\n${project.projectId}`
      : null;
  useEffect(() => {
    setBranchNotice(null);
    if (noticeKey === null || computer === null || project === null) return undefined;
    if (!handoffBranchNoticeApplies(computer, project)) return undefined;
    const sourcePath = ownProjectPath(machine.id, projectId);
    const to = machineTargetFor(computer.machineId);
    if (sourcePath === null || to === null || project.path === null) return undefined;
    let current = true;
    void Promise.all([projectBranch(machine, sourcePath), projectBranch(to, project.path)]).then(([source, target]) => {
      const line = branchDifferenceLine(source, target, computer.label);
      if (current && line !== null) setBranchNotice({ key: noticeKey, line });
    });
    return () => {
      current = false;
    };
    // `noticeKey` names the computer and project these read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeKey]);

  if (request === null) return null;
  const effectiveMode: Mode = agents.length === 0 ? 'export' : mode;
  // The agents of the computer the session starts on: another computer has its own.
  const offeredAgents = elsewhere && computer !== null && !computer.isSource ? machineAgents(computer.machineId) : agents;
  const ownAgentId = sessionRecord(machine.id, sessionId)?.agent.trim() ?? '';
  const agent: GhostexAgentLauncher | null =
    offeredAgents.find((candidate) => candidate.agentId === selected) ??
    offeredAgents.find((candidate) => candidate.agentId === ownAgentId) ??
    offeredAgents[0] ??
    null;
  const busy = stage.kind === 'exporting' || stage.kind === 'starting';
  const done = stage.kind === 'done';
  const disabled = busy || done;
  const showResult = done && effectiveMode === 'export';
  const canRun =
    !busy && !done && (effectiveMode === 'export' || (agent !== null && (!destinationOpen || project !== null)));
  const primaryLabel =
    stage.kind === 'exporting'
      ? 'Exporting…'
      : stage.kind === 'starting'
        ? 'Starting…'
        : stage.kind === 'failed'
          ? 'Try Again'
          : effectiveMode === 'export'
            ? 'Export'
            : elsewhere && computer !== null && project !== null
              ? handoffDestinationLabel(project.title, computer.label, computer.isSource)
              : agent !== null && (!destinationOpen || project !== null)
                ? `Handoff to ${agentName(agent)}`
                : 'Handoff';

  /** Saves the card and Include as they are now, with the remembered agent and destination. */
  const persist = (changes: Partial<HandoffPrefs>): void => {
    saved.current = { ...saved.current, ...changes };
    saveHandoffPrefs(saved.current);
  };

  const run = (): void => {
    if (!canRun) return;
    setPicking(null);
    setStage({ kind: 'exporting' });
    const handoffAgent = effectiveMode === 'export' ? null : agent;
    const destinationMachine = elsewhere && computer !== null ? machineTargetFor(computer.machineId) : null;
    const destination =
      destinationMachine !== null && project !== null ? { machine: destinationMachine, projectId: project.projectId } : undefined;
    const leavesComputer = elsewhere && computer !== null && !computer.isSource;
    // A handoff remembers its agent and destination when it runs, so a pick the user backed out of
    // doesn't come back. The model picker's handoff is about that one model, not a preference.
    if (handoffAgent !== null && request.target === null) {
      persist({
        agentId: selected,
        destination: elsewhere && computer !== null && project !== null ? { machineId: computer.machineId, projectId: project.projectId } : null,
        destinationOpen: elsewhere,
      });
    }
    void exportTranscript(machine, sessionId, projectId, include).then(
      (path) => {
        if (handoffAgent === null) {
          setStage({ kind: 'done', path });
          return;
        }
        // Desktop closes the dialog as the conversation starts and reports a failure as a toast.
        setStage({ kind: 'starting' });
        onClose();
        void startHandoffConversation(machine, {
          projectId,
          agent: handoffAgent,
          path,
          sessionTitle: sessionTitle(machine.id, sessionId),
          target: elsewhere ? null : request.target,
          ...(destination !== undefined ? { destination } : {}),
        }).catch((error: unknown) => {
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Could not create the new agent session.';
          onFailure(leavesComputer ? 'Could not hand off to the other computer' : 'Could not start the conversation', message);
        });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message.trim() : '';
        setStage({ kind: 'failed', message: message.length > 0 ? message : EXPORT_FAILED });
      },
    );
  };

  const modeCard = (value: Mode, glyph: GlyphName, title: string, description: string) => {
    const active = effectiveMode === value;
    return (
      <Pressable
        key={value}
        disabled={disabled}
        onPress={() => {
          setMode(value);
          persist({ card: value === 'export' ? 'markdown' : 'agent' });
          setPicking(null);
        }}
        accessibilityRole="radio"
        accessibilityState={{ checked: active, disabled }}
        style={[styles.card, active ? styles.cardActive : null, disabled ? styles.dim : null]}
      >
        <View style={styles.cardIcon}>
          <Glyph name={glyph} size={16} color={P.foreground} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDescription}>{description}</Text>
        {active ? (
          <View style={styles.cardCheck}>
            <Glyph name="check" size={14} color={P.foreground} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Sheet visible onClose={busy ? () => undefined : onClose} title={TITLE} maxHeight="90%">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.description}>{DESCRIPTION}</Text>
        <View style={styles.modes}>
          {agents.length > 0
            ? modeCard('handoff', 'switch-horizontal', HANDOFF_CARD_TITLE, HANDOFF_CARD_DESCRIPTION)
            : null}
          {modeCard('export', 'file-text', EXPORT_CARD_TITLE, EXPORT_CARD_DESCRIPTION)}
        </View>
        {effectiveMode === 'export' ? (
          <Text style={styles.hint}>{EXPORT_HINT}</Text>
        ) : (
          <>
            <SelectRow
              label={CONTINUE_WITH}
              value={agent !== null ? agentName(agent) : null}
              placeholder={SELECT_AGENT_PLACEHOLDER}
              leading={agent !== null ? <AgentMark agent={agent} /> : null}
              open={picking === 'agent'}
              disabled={disabled}
              onPress={() => setPicking((open) => (open === 'agent' ? null : 'agent'))}
            />
            {picking === 'agent' ? (
              <View style={styles.agentList}>
                {offeredAgents.map((candidate) => (
                  <OptionRow
                    key={candidate.agentId}
                    label={agentName(candidate)}
                    leading={<AgentMark agent={candidate} />}
                    checked={candidate.agentId === agent?.agentId}
                    onPress={() => {
                      setSelected(candidate.agentId);
                      setPicking(null);
                    }}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
        {effectiveMode === 'handoff' ? (
          <View style={styles.agentRow}>
            <Text style={styles.section}>{DESTINATION}</Text>
            <Text style={styles.destination} numberOfLines={2}>
              {handoffDestinationSummary(destinationOpen, computer, project)}
            </Text>
            <Pressable
              disabled={disabled}
              onPress={() => {
                setPicking(null);
                if (!destinationOpen) {
                  setDestinationOpen(true);
                  return;
                }
                setDestinationOpen(false);
                setSelectedMachineId(null);
                setSelectedProjectId(null);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null, disabled ? styles.dim : null]}
            >
              <Text style={styles.buttonText}>
                {!destinationOpen ? DESTINATION_CHANGE : elsewhere ? DESTINATION_RESET : DESTINATION_HIDE}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {effectiveMode === 'handoff' && destinationOpen ? (
          <>
            <SelectRow
              label={COMPUTER}
              value={computer?.label ?? null}
              placeholder={SELECT_COMPUTER_PLACEHOLDER}
              open={picking === 'computer'}
              disabled={disabled || computers.length === 0}
              onPress={() => setPicking((open) => (open === 'computer' ? null : 'computer'))}
            />
            {picking === 'computer' ? (
              <View style={styles.agentList}>
                {computers.map((candidate) => (
                  <OptionRow
                    key={candidate.machineId}
                    label={candidate.label}
                    checked={candidate.machineId === computer?.machineId}
                    onPress={() => {
                      setSelectedMachineId(candidate.machineId);
                      setSelectedProjectId(null);
                      setPicking(null);
                    }}
                  />
                ))}
              </View>
            ) : null}
            <SelectRow
              label={PROJECT}
              value={project !== null ? handoffProjectLabel(project.title, project.isOwn, project.sameRepo, project.path) : null}
              placeholder={SELECT_PROJECT_PLACEHOLDER}
              open={picking === 'project'}
              disabled={disabled || computer === null || computer.choices.length === 0}
              onPress={() => setPicking((open) => (open === 'project' ? null : 'project'))}
            />
            {picking === 'project' && computer !== null ? (
              <View style={styles.agentList}>
                {computer.choices.map((candidate) => (
                  <OptionRow
                    key={candidate.projectId}
                    label={handoffProjectLabel(candidate.title, candidate.isOwn, candidate.sameRepo, candidate.path)}
                    checked={candidate.projectId === project?.projectId}
                    onPress={() => {
                      setSelectedProjectId(candidate.projectId);
                      setPicking(null);
                    }}
                  />
                ))}
              </View>
            ) : null}
            {computers.length === 0 ? <Text style={styles.hint}>{NO_COMPUTER_HINT}</Text> : null}
            {computer !== null && missingProjectHint(computer) !== null ? (
              <Text style={styles.hint}>{missingProjectHint(computer)}</Text>
            ) : null}
            {branchNotice !== null && branchNotice.key === noticeKey ? (
              <View style={styles.result}>
                <Text style={styles.resultTitleText}>{BRANCH_NOTICE_TITLE}</Text>
                <Text style={styles.path}>{branchNotice.line}</Text>
                <Text style={styles.path}>{BRANCH_NOTICE_SUBTITLE}</Text>
              </View>
            ) : null}
          </>
        ) : null}
        {!showResult ? (
          <Pressable
            disabled={disabled}
            onPress={() => {
              const next = !includeOpen;
              setIncludeOpen(next);
              persist({ includeOpen: next });
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: includeOpen }}
            style={[styles.includeHeader, disabled ? styles.dim : null]}
          >
            <Glyph name={includeOpen ? 'chevron-down' : 'chevron-right'} size={16} color={P.muted} />
            <Text style={styles.section}>{INCLUDE}</Text>
            <Text style={styles.includeSummary} numberOfLines={1}>
              {INCLUDE_ROWS.filter((row) => include[row.key])
                .map((row) => row.label)
                .join(', ') || INCLUDE_NOTHING}
            </Text>
          </Pressable>
        ) : null}
        {!showResult && includeOpen ? (
          <View style={styles.agentList}>
            {INCLUDE_ROWS.map((row) => (
              <View key={row.key} style={styles.includeRow}>
                <View style={styles.includeText}>
                  <Text style={styles.agentOptionText}>{row.label}</Text>
                  <Text style={styles.cardDescription}>{row.description}</Text>
                </View>
                <Switch
                  accessibilityLabel={row.label}
                  value={include[row.key]}
                  disabled={disabled}
                  onValueChange={(on) => {
                    const next = { ...include, [row.key]: on };
                    setInclude(next);
                    persist({ include: next });
                  }}
                />
              </View>
            ))}
          </View>
        ) : null}
        {stage.kind === 'failed' ? <Text style={styles.error}>{stage.message}</Text> : null}
        {showResult && stage.kind === 'done' ? (
          <View style={styles.result}>
            <View style={styles.resultTitle}>
              <Glyph name="check" size={16} color="#22c55e" />
              <Text style={styles.resultTitleText}>{SAVED_AS_MARKDOWN}</Text>
            </View>
            <Text selectable style={styles.path}>
              {stage.path}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          disabled={busy}
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null, busy ? styles.dim : null]}
        >
          <Text style={styles.buttonText}>{showResult ? 'Done' : 'Cancel'}</Text>
        </Pressable>
        {showResult && stage.kind === 'done' ? (
          <Pressable
            onPress={() => {
              void Clipboard.setStringAsync(stage.path).then(() => setCopied(true));
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
          >
            <Text style={styles.buttonText}>{copied ? 'Path Copied' : 'Copy Path'}</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={!canRun}
            onPress={run}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canRun, busy }}
            style={({ pressed }) => [
              styles.button,
              styles.primary,
              pressed ? styles.pressedPrimary : null,
              !canRun ? styles.dim : null,
            ]}
          >
            {busy ? <ActivityIndicator size="small" color={P.send.ink} /> : null}
            <Text style={styles.primaryText} numberOfLines={1}>
              {primaryLabel}
            </Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

/** What desktop's dialog says beside its Clone it there… and Add a project there… buttons. */
function missingProjectHint(computer: HandoffComputer): string | null {
  if (computer.missingRepository !== null) return `${computer.label} doesn't have ${computer.missingRepository} yet.`;
  return computer.choices.length === 0 && !computer.isSource ? `${computer.label} has no projects yet.` : null;
}

function ownProjectPath(machineId: string, projectId: string): string | null {
  return (
    useInventoryStore
      .getState()
      .inventoriesByMachineId[machineId]?.summary?.projects.find((entry) => entry.projectId === projectId)?.path ?? null
  );
}

function SelectRow({
  label,
  value,
  placeholder,
  leading,
  open,
  disabled,
  onPress,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  leading?: ReactNode;
  open: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={styles.agentRow}>
      <Text style={styles.section}>{label}</Text>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value ?? placeholder}`}
        style={[styles.select, disabled ? styles.dim : null]}
      >
        {leading}
        <Text style={[styles.selectText, value === null ? styles.placeholder : null]} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Glyph name={open ? 'chevron-up' : 'chevron-down'} size={16} color={P.muted} />
      </Pressable>
    </View>
  );
}

function OptionRow({
  label,
  leading,
  checked,
  onPress,
}: {
  label: string;
  leading?: ReactNode;
  checked: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ checked }}
      style={({ pressed }) => [styles.agentOption, pressed ? styles.pressed : null]}
    >
      {leading}
      <Text style={styles.agentOptionText} numberOfLines={2}>
        {label}
      </Text>
      {checked ? <Glyph name="check" size={16} color={P.foreground} /> : null}
    </Pressable>
  );
}

function agentName(agent: GhostexAgentLauncher): string {
  return agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
}

function AgentMark({ agent }: { agent: GhostexAgentLauncher }) {
  const P = useTranscriptTheme();
  const Icon = AGENT_ICONS[resolveAgentArtId(agent.icon, agentName(agent))];
  return Icon !== undefined ? <Icon size={16} color={P.foreground} /> : null;
}

const useStyles = themedStyles((P) => ({
  content: { paddingHorizontal: 16, paddingBottom: 12, gap: 14 },
  description: { color: P.muted, fontSize: 14, lineHeight: 20 },
  modes: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  card: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.border,
    padding: 12,
    gap: 6,
    backgroundColor: P.composerBackground,
  },
  cardActive: { borderColor: P.ring, backgroundColor: P.selectedFill },
  cardIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.input,
  },
  cardTitle: { color: P.foreground, fontSize: 14, fontWeight: '600' },
  cardDescription: { color: P.muted, fontSize: 12.5, lineHeight: 17 },
  cardCheck: { position: 'absolute', top: 10, right: 10 },
  hint: { color: P.muted, fontSize: 13, lineHeight: 18, minHeight: 36, textAlignVertical: 'center' },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  section: { color: P.foreground, fontSize: 13, fontWeight: '600', minWidth: 92 },
  destination: { flex: 1, minWidth: 0, color: P.foreground, fontSize: 14 },
  includeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  includeSummary: { flex: 1, minWidth: 0, color: P.muted, fontSize: 13, textAlign: 'right' },
  includeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  includeText: { flex: 1, minWidth: 0, gap: 2 },
  select: {
    flex: 1,
    minWidth: 0,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.input,
  },
  selectText: { flex: 1, minWidth: 0, color: P.foreground, fontSize: 14 },
  placeholder: { color: P.placeholder },
  agentList: { borderRadius: 12, borderWidth: 1, borderColor: P.menuBorder, paddingVertical: 4 },
  agentOption: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 12 },
  agentOptionText: { flex: 1, minWidth: 0, color: P.foreground, fontSize: 15 },
  error: { color: P.error, fontSize: 13, lineHeight: 18 },
  result: { gap: 6, borderRadius: 12, borderWidth: 1, borderColor: P.border, padding: 12 },
  resultTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultTitleText: { color: P.foreground, fontSize: 14, fontWeight: '600' },
  path: { color: P.muted, fontSize: 12.5, lineHeight: 17 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: P.menuBorder,
  },
  button: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: P.neutralFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonText: { color: P.foreground, fontSize: 14 },
  primary: { backgroundColor: P.send.fill, borderColor: P.send.fill, flexShrink: 1 },
  primaryText: { color: P.send.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  pressed: { backgroundColor: P.controlPressed },
  buttonPressed: { backgroundColor: P.neutralFillPressed },
  pressedPrimary: { opacity: 0.85 },
  dim: { opacity: 0.5 },
}));
