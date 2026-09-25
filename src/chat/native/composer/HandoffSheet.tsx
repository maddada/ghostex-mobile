/**
 * Handoff / Export, the phone form of desktop's dialog (`apps/desktop/src/app/window/
 * export_transcript_modal.rs`, opened by `gx_store/git/export_transcript.rs`): the same copy, the
 * two modes, "Continue with", then the export and the new conversation the export hands over to.
 * It opens from More actions > Handoff / Export, and from the model menu's pick of another agent's
 * model (`handoffToModel`), which selects that agent and launches the new conversation on the
 * picked model when the agent belongs to the model's family.
 *
 * CDXC:TranscriptExport 2026-09-25 WHY:
 * The phone exports through `ghostex export-transcript`, which takes no include options, so the
 * dialog has no Include switches and the file carries the daemon's default selection (commands and
 * file changes in, reasoning out), the same selection desktop's switches start on. Desktop's Open
 * Location is left out: the file is on the computer. The new conversation opens the way the
 * terminal screen's Export and Fork open theirs (`sessionShell.ts`).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import type { GhostexAgentLauncher } from '../../../contract/mobileSummary';
import { resolveAgentIconId } from '../../../contract/mobileSummary';
import type { MachineConnectionTarget } from '../../../machines/credentials';
import { exportTranscript, machineAgents, modelPickerProvider, sessionRecord, sessionTitle, startHandoffConversation } from '../sessionShell';
import { Glyph, type GlyphName } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';

const TITLE = 'Handoff / Export';
/** Desktop's sentence, which ends "and what to include."; this dialog has no Include switches. */
const DESCRIPTION = 'Ghostex writes this conversation to a Markdown file. Pick what to do with it.';
const HANDOFF_CARD_TITLE = 'Handoff to an agent';
const HANDOFF_CARD_DESCRIPTION = 'Start a new conversation with the handover attached.';
const EXPORT_CARD_TITLE = 'Export to Markdown';
const EXPORT_CARD_DESCRIPTION = 'Save the conversation as a file and copy its path.';
const CONTINUE_WITH = 'Continue with';
const SELECT_AGENT_PLACEHOLDER = 'Select agent';
const EXPORT_HINT = 'The file is saved in the Ghostex exports folder.';
const SAVED_AS_MARKDOWN = 'Saved as Markdown';
const EXPORT_FAILED = 'The transcript export failed.';

/**
 * One opening of the dialog, with a fresh id so every request reopens it: `target` is the core's
 * `handoffToModel` params, or null for More actions > Handoff / Export.
 */
export type HandoffRequest = { id: number; target: { provider: string; model: string; effort: string } | null };

type Mode = 'handoff' | 'export';

/**
 * The mode the user last chose, a per-client preference like desktop's
 * `export-transcript-modal` prefs file, so a plain open comes back as it was left.
 */
const MODE_KEY = 'ghostex.chat.handoffExportMode';

function readRememberedMode(): Promise<Mode | null> {
  return AsyncStorage.getItem(MODE_KEY)
    .then((value) => (value === 'handoff' || value === 'export' ? value : null))
    .catch(() => null);
}

function rememberMode(mode: Mode): void {
  void AsyncStorage.setItem(MODE_KEY, mode).catch(() => undefined);
}
type Stage = { kind: 'options' } | { kind: 'exporting' } | { kind: 'starting' } | { kind: 'done'; path: string } | { kind: 'failed'; message: string };

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
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const agents = useMemo(() => (request === null ? [] : machineAgents(machine.id)), [machine.id, request]);

  // A model pick opens on Handoff with that model's agent selected (the user's decision in
  // `export_transcript.rs`): the first configured agent of its family. A plain open comes back in
  // the mode the user last chose, Handoff until they choose.
  useEffect(() => {
    if (request === null) return undefined;
    const target = request.target;
    setMode('handoff');
    setStage({ kind: 'options' });
    setPicking(false);
    setCopied(false);
    setSelected(target === null ? null : (agents.find((agent) => modelPickerProvider(agent.icon) === target.provider)?.agentId ?? null));
    if (target !== null) return undefined;
    let current = true;
    void readRememberedMode().then((remembered) => {
      if (current && remembered !== null) setMode(remembered);
    });
    return () => {
      current = false;
    };
  }, [agents, request]);

  if (request === null) return null;
  const effectiveMode: Mode = agents.length === 0 ? 'export' : mode;
  const ownAgentId = sessionRecord(machine.id, sessionId)?.agent.trim() ?? '';
  const agent: GhostexAgentLauncher | null =
    agents.find((candidate) => candidate.agentId === selected) ??
    agents.find((candidate) => candidate.agentId === ownAgentId) ??
    agents[0] ??
    null;
  const busy = stage.kind === 'exporting' || stage.kind === 'starting';
  const done = stage.kind === 'done';
  const disabled = busy || done;
  const showResult = done && effectiveMode === 'export';
  const canRun = !busy && !done && (effectiveMode === 'export' || agent !== null);
  const primaryLabel =
    stage.kind === 'exporting'
      ? 'Exporting…'
      : stage.kind === 'starting'
        ? 'Starting…'
        : stage.kind === 'failed'
          ? 'Try Again'
          : effectiveMode === 'handoff'
            ? agent !== null
              ? `Handoff to ${agentName(agent)}`
              : 'Handoff'
            : 'Export';

  const run = (): void => {
    if (!canRun) return;
    setPicking(false);
    setStage({ kind: 'exporting' });
    const handoffAgent = effectiveMode === 'handoff' ? agent : null;
    void exportTranscript(machine, sessionId, projectId).then(
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
          target: request.target,
        }).catch((error: unknown) => {
          const message = error instanceof Error && error.message.trim().length > 0 ? error.message : 'Could not create the new agent session.';
          onFailure('Could not start the conversation', message);
        });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message.trim() : '';
        setStage({ kind: 'failed', message: message.length > 0 ? message : EXPORT_FAILED });
      }
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
          rememberMode(value);
          setPicking(false);
        }}
        accessibilityRole='radio'
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
            <Glyph name='check' size={14} color={P.foreground} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Sheet visible onClose={busy ? () => undefined : onClose} title={TITLE} maxHeight='90%'>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
        <Text style={styles.description}>{DESCRIPTION}</Text>
        <View style={styles.modes}>
          {agents.length > 0 ? modeCard('handoff', 'switch-horizontal', HANDOFF_CARD_TITLE, HANDOFF_CARD_DESCRIPTION) : null}
          {modeCard('export', 'file-text', EXPORT_CARD_TITLE, EXPORT_CARD_DESCRIPTION)}
        </View>
        {effectiveMode === 'export' ? (
          <Text style={styles.hint}>{EXPORT_HINT}</Text>
        ) : (
          <View style={styles.agentRow}>
            <Text style={styles.section}>{CONTINUE_WITH}</Text>
            <Pressable
              disabled={disabled}
              onPress={() => setPicking((open) => !open)}
              accessibilityRole='button'
              accessibilityLabel={`${CONTINUE_WITH} ${agent !== null ? agentName(agent) : SELECT_AGENT_PLACEHOLDER}`}
              style={[styles.select, disabled ? styles.dim : null]}
            >
              {agent !== null ? <AgentMark agent={agent} /> : null}
              <Text style={[styles.selectText, agent === null ? styles.placeholder : null]} numberOfLines={1}>
                {agent !== null ? agentName(agent) : SELECT_AGENT_PLACEHOLDER}
              </Text>
              <Glyph name={picking ? 'chevron-up' : 'chevron-down'} size={16} color={P.muted} />
            </Pressable>
          </View>
        )}
        {picking && effectiveMode === 'handoff' ? (
          <View style={styles.agentList}>
            {agents.map((candidate) => (
              <Pressable
                key={candidate.agentId}
                onPress={() => {
                  setSelected(candidate.agentId);
                  setPicking(false);
                }}
                accessibilityRole='menuitem'
                accessibilityState={{ checked: candidate.agentId === agent?.agentId }}
                style={({ pressed }) => [styles.agentOption, pressed ? styles.pressed : null]}
              >
                <AgentMark agent={candidate} />
                <Text style={styles.agentOptionText} numberOfLines={1}>
                  {agentName(candidate)}
                </Text>
                {candidate.agentId === agent?.agentId ? <Glyph name='check' size={16} color={P.foreground} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {stage.kind === 'failed' ? <Text style={styles.error}>{stage.message}</Text> : null}
        {showResult && stage.kind === 'done' ? (
          <View style={styles.result}>
            <View style={styles.resultTitle}>
              <Glyph name='check' size={16} color='#22c55e' />
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
          accessibilityRole='button'
          style={({ pressed }) => [styles.button, pressed ? styles.pressed : null, busy ? styles.dim : null]}
        >
          <Text style={styles.buttonText}>{showResult ? 'Done' : 'Cancel'}</Text>
        </Pressable>
        {showResult && stage.kind === 'done' ? (
          <Pressable
            onPress={() => {
              void Clipboard.setStringAsync(stage.path).then(() => setCopied(true));
            }}
            accessibilityRole='button'
            style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
          >
            <Text style={styles.buttonText}>{copied ? 'Path Copied' : 'Copy Path'}</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={!canRun}
            onPress={run}
            accessibilityRole='button'
            accessibilityState={{ disabled: !canRun, busy }}
            style={({ pressed }) => [styles.button, styles.primary, pressed ? styles.pressedPrimary : null, !canRun ? styles.dim : null]}
          >
            {busy ? <ActivityIndicator size='small' color={P.send.ink} /> : null}
            <Text style={styles.primaryText} numberOfLines={1}>
              {primaryLabel}
            </Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

function agentName(agent: GhostexAgentLauncher): string {
  return agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
}

function AgentMark({ agent }: { agent: GhostexAgentLauncher }) {
  const P = useTranscriptTheme();
  const Icon = AGENT_ICONS[resolveAgentIconId(agent.icon, agentName(agent))];
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
  cardIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: P.input },
  cardTitle: { color: P.foreground, fontSize: 14, fontWeight: '600' },
  cardDescription: { color: P.muted, fontSize: 12.5, lineHeight: 17 },
  cardCheck: { position: 'absolute', top: 10, right: 10 },
  hint: { color: P.muted, fontSize: 13, lineHeight: 18, minHeight: 36, textAlignVertical: 'center' },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  section: { color: P.foreground, fontSize: 13, fontWeight: '600' },
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
    borderColor: P.menuBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonText: { color: P.foreground, fontSize: 14 },
  primary: { backgroundColor: P.send.fill, borderColor: P.send.fill, flexShrink: 1 },
  primaryText: { color: P.send.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  pressed: { backgroundColor: P.controlPressed },
  pressedPrimary: { opacity: 0.85 },
  dim: { opacity: 0.5 },
}));
