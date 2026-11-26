/**
 * Edit machine's Agent CLIs and Skills and tools: what that computer has installed, read and
 * installed through its own Ghostex (src/machines/machineTools.ts), the desktop's Settings > Agents
 * and Integrations with that machine picked.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { readableSecondaryText } from '../../theme/sidebarAppearance';
import { useAppearance } from '../../theme/useAppearance';
import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { DownloadGlyph, RefreshGlyph } from '../../components/sessions/icons';
import { EditMachineCopy } from '../../copy/machines';
import { openShownCommandTerminal } from '../../machines/appUpdate';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { machineNameById } from '../../machines/store';
import {
  agentCliRow,
  DESKTOP_CONTROL_TOOL_IDS,
  refreshMachineTools,
  runRowAction,
  skillRow,
  tooOldMessage,
  toolRow,
  useMachineToolsStore,
  type MachineTools,
  type RowTone,
  type ToolRowView,
} from '../../machines/machineTools';
import {
  canonicalNativeModeFamily,
  modeForFamily,
  readAgentSessionModes,
  saveAgentSessionMode,
  SESSION_MODE_OPTIONS,
  TERMINAL_MODE_LEGACY_WARNING,
  type AgentSessionMode,
  type NativeModeFamily,
} from '../../settings/agentSessionMode';
import type { RootStackParamList } from '../../navigation/types';
import { SetupPalette } from '../../theme/palette';
import { useFormStyles } from './styles';

const TONE_COLOR: Record<RowTone, string> = {
  muted: SetupPalette.MUTED,
  warning: SetupPalette.WARN,
  success: SetupPalette.OK,
};

function Row({
  machine,
  row,
  first,
  tools,
  sessionModes,
  onChangeSessionMode,
}: {
  machine: MachineConnectionTarget;
  row: ToolRowView;
  first: boolean;
  tools: MachineTools;
  sessionModes?: Record<string, AgentSessionMode> | null;
  onChangeSessionMode?: (family: NativeModeFamily, mode: AgentSessionMode) => void;
}) {
  const appearance = useAppearance();
  const formStyles = useFormStyles();
  const [legacyTipOpen, setLegacyTipOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const runInTerminal = row.busy ? null : (row.runInTerminal ?? null);
  const starting = tools.starting[row.key] === true;
  const failed = tools.failed[row.key];
  const done = failed === undefined ? tools.done[row.key] : undefined;
  const action = row.action;
  const nativeFamily =
    sessionModes != null && row.key.startsWith('agent:')
      ? canonicalNativeModeFamily(row.key.slice('agent:'.length))
      : null;
  const currentMode = nativeFamily !== null && sessionModes != null ? modeForFamily(sessionModes, nativeFamily) : null;
  return (
    <View style={[modeStyles.rowWrap, first ? formStyles.rowFirst : null, { borderTopColor: appearance.border }]}>
      <View style={[formStyles.row, formStyles.rowFirst]}>
        <View style={formStyles.rowMain}>
          <Text style={formStyles.rowLabel}>{row.title}</Text>
          <Text
            style={[
              formStyles.rowDetail,
              {
                color: readableSecondaryText(
                  TONE_COLOR[failed ? 'warning' : done ? 'success' : row.tone],
                  appearance.foreground,
                  [appearance.background, appearance.card, appearance.cardActive],
                ),
              },
            ]}
          >
            {failed ?? done ?? row.detail}
          </Text>
        </View>
        {row.busy ? <ActivityIndicator size="small" color={appearance.muted} /> : null}
        {action !== null ? (
          <SetupButton
            small
            label={action.label}
            busy={starting}
            icon={
              action.operation === 'update' ? (
                <RefreshGlyph size={14} color={appearance.foreground} />
              ) : action.operation === 'uninstallSkill' ? undefined : (
                <DownloadGlyph size={14} color={appearance.foreground} />
              )
            }
            onPress={() => void runRowAction(machine, row.key, action)}
          />
        ) : null}
      </View>
      {runInTerminal !== null ? (
        <View style={[formStyles.row, { paddingTop: 2, borderTopWidth: 0 }]}>
          <SetupButton
            small
            variant="primary"
            label={EditMachineCopy.machineTools.runInTerminal}
            busy={opening}
            onPress={() => {
              setOpening(true);
              void openShownCommandTerminal(machine, runInTerminal)
                .then(({ sessionKey, title }) =>
                  navigation.navigate('Terminal', { sessionKey, machineId: machine.id, title }),
                )
                .catch((error: unknown) =>
                  Alert.alert(
                    EditMachineCopy.machineTools.runInTerminalFailed,
                    error instanceof Error ? error.message : String(error),
                  ),
                )
                .finally(() => setOpening(false));
            }}
          />
        </View>
      ) : null}
      {nativeFamily !== null && currentMode !== null && onChangeSessionMode !== undefined ? (
        <View style={modeStyles.modeBlock}>
          <View style={modeStyles.modeRow}>
            <Text style={[modeStyles.modeLabel, { color: appearance.muted }]}>Session mode</Text>
            <View style={modeStyles.modeControls}>
              {currentMode === 'agent-cli' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title} Terminal-based mode info`}
                  accessibilityHint="Shows why Terminal-based mode is legacy"
                  accessibilityState={{ expanded: legacyTipOpen }}
                  hitSlop={8}
                  onPress={() => setLegacyTipOpen((prev) => !prev)}
                  style={({ pressed }) => [modeStyles.legacyDotButton, pressed ? { opacity: 0.7 } : null]}
                >
                  <View style={[modeStyles.legacyDot, { backgroundColor: SetupPalette.WARN }]} />
                </Pressable>
              ) : null}
              <View
                style={[
                  modeStyles.segmentTrack,
                  { borderColor: appearance.border, backgroundColor: appearance.background },
                ]}
                accessibilityRole="radiogroup"
                accessibilityLabel={`${row.title} session mode`}
              >
                {SESSION_MODE_OPTIONS.map((option) => {
                  const selected = option.value === currentMode;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${row.title} ${option.label}`}
                      onPress={() => {
                        if (!selected) {
                          if (option.value !== 'agent-cli') setLegacyTipOpen(false);
                          onChangeSessionMode(nativeFamily, option.value);
                        }
                      }}
                      style={({ pressed }) => [
                        modeStyles.segmentBtn,
                        selected ? { backgroundColor: appearance.neutralFill } : null,
                        pressed ? { opacity: 0.78 } : null,
                      ]}
                    >
                      <Text
                        style={[
                          modeStyles.segmentText,
                          { color: selected ? appearance.foreground : appearance.muted },
                          selected ? modeStyles.segmentTextActive : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
          {currentMode === 'agent-cli' && legacyTipOpen ? (
            <Pressable
              onPress={() => setLegacyTipOpen(false)}
              style={[
                modeStyles.legacyTooltip,
                {
                  backgroundColor: appearance.background,
                  borderColor: appearance.border,
                },
              ]}
            >
              <Text style={[modeStyles.legacyTooltipText, { color: appearance.foreground }]}>
                {TERMINAL_MODE_LEGACY_WARNING}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Card({
  machine,
  tools,
  heading,
  rows,
  sessionModes,
  onChangeSessionMode,
}: {
  machine: MachineConnectionTarget;
  tools: MachineTools;
  heading?: string;
  rows: ToolRowView[];
  sessionModes?: Record<string, AgentSessionMode> | null;
  onChangeSessionMode?: (family: NativeModeFamily, mode: AgentSessionMode) => void;
}) {
  const formStyles = useFormStyles();
  if (rows.length === 0) return null;
  return (
    <>
      {heading !== undefined ? <Text style={formStyles.fieldHint}>{heading}</Text> : null}
      <View style={formStyles.rowsCard}>
        {rows.map((row, index) => (
          <Row
            key={row.key}
            machine={machine}
            row={row}
            first={index === 0}
            tools={tools}
            sessionModes={sessionModes}
            onChangeSessionMode={onChangeSessionMode}
          />
        ))}
      </View>
    </>
  );
}

function Notice({ text, busy, onRetry }: { text: string; busy: boolean; onRetry?: () => void }) {
  const appearance = useAppearance();
  const formStyles = useFormStyles();
  return (
    <View style={formStyles.rowsCard}>
      <View style={[formStyles.row, formStyles.rowFirst]}>
        {busy ? <ActivityIndicator size="small" color={appearance.muted} /> : null}
        <View style={formStyles.rowMain}>
          <Text style={formStyles.rowDetail}>{text}</Text>
        </View>
        {onRetry !== undefined ? (
          <SetupButton small label={EditMachineCopy.machineTools.retry} disabled={busy} onPress={onRetry} />
        ) : null}
      </View>
    </View>
  );
}

export default function MachineToolsSection({
  machine,
  reachable,
}: {
  machine: MachineConnectionTarget;
  reachable: boolean;
}) {
  const formStyles = useFormStyles();
  const tools = useMachineToolsStore((state) => state.byMachineId[machine.id]);
  const copy = EditMachineCopy.machineTools;
  const computer = machineNameById(machine.id);
  const [sessionModes, setSessionModes] = useState<Record<string, AgentSessionMode> | null>(null);
  const [modeSaveError, setModeSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!reachable) {
      setSessionModes(null);
      setModeSaveError(null);
      return;
    }
    let live = true;
    void readAgentSessionModes(machine).then((result) => {
      if (!live) return;
      if (result.kind === 'values') {
        setSessionModes(result.modes);
      } else {
        setSessionModes(null);
      }
    });
    return () => {
      live = false;
    };
    // Reload when the machine id or reachability changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.id, reachable]);

  const handleChangeSessionMode = (family: NativeModeFamily, mode: AgentSessionMode) => {
    if (sessionModes === null) return;
    const before = sessionModes;
    setSessionModes({ ...before, [family]: mode });
    setModeSaveError(null);
    void saveAgentSessionMode(machine, family, mode, before).then((error) => {
      if (error === null) return;
      setSessionModes(before);
      setModeSaveError(`Couldn't save Session mode on ${computer}: ${error}`);
    });
  };

  if (!reachable) {
    return (
      <>
        <Text style={formStyles.sectionLabel}>{copy.agentsLabel}</Text>
        <Notice text={copy.notConnected(computer)} busy={false} />
      </>
    );
  }
  const reading = tools?.reading ?? true;
  const retry = () => void refreshMachineTools(machine);
  const agents = tools?.agents;
  const integrations = tools?.integrations;
  const managed = tools?.tools;
  const allTools = managed?.data ?? [];
  const desktopRows = DESKTOP_CONTROL_TOOL_IDS.flatMap((id) => allTools.filter((tool) => tool.id === id)).map((tool) =>
    toolRow(tool, computer),
  );
  const toolRows = allTools
    .filter(
      (tool) => tool.supported === true && tool.id !== 'powershell' && !DESKTOP_CONTROL_TOOL_IDS.includes(tool.id),
    )
    .map((tool) => toolRow(tool, computer));
  const cli = integrations?.data?.ghostexCli;
  const cliRow: ToolRowView | null =
    cli === undefined
      ? null
      : {
          key: 'cli:ghostex',
          title: copy.ghostexCli,
          detail:
            cli.installed === true && cli.path
              ? copy.cliFound(cli.path)
              : cli.pathFix
                ? copy.cliOffPath(cli.pathFix.files)
                : copy.cliMissing,
          tone: cli.installed === true ? 'success' : 'warning',
          busy: false,
          // Only a computer whose gxserver offers the fix (`pathFix`) gets Repair; older ones send none.
          action:
            cli.installed !== true && cli.pathFix ? { label: copy.repair, operation: 'addCliFolderToPath' } : null,
        };
  // Skills Settings doesn't list (no catalog name) stay off the phone too.
  const skillRows = (integrations?.data?.skills ?? []).filter((skill) => (skill.name ?? '') !== '').map(skillRow);
  return (
    <>
      <Text style={formStyles.sectionLabel}>{copy.agentsLabel}</Text>
      {tools === undefined || (agents?.data == null && agents?.error == null) ? (
        <Notice text={copy.reading} busy />
      ) : agents?.error != null ? (
        <Notice text={agents.error} busy={reading} onRetry={retry} />
      ) : (
        <>
          <Card
            machine={machine}
            tools={tools}
            rows={(agents?.data ?? []).map(agentCliRow)}
            sessionModes={sessionModes}
            onChangeSessionMode={handleChangeSessionMode}
          />
          {modeSaveError !== null ? <Text style={formStyles.fieldError}>{modeSaveError}</Text> : null}
        </>
      )}
      <Text style={formStyles.sectionLabel}>{copy.toolsLabel}</Text>
      {tools === undefined || (integrations?.data == null && integrations?.error == null) ? (
        <Notice text={copy.reading} busy />
      ) : (
        <>
          {integrations?.error != null ? (
            <Notice text={integrations.error} busy={reading} onRetry={retry} />
          ) : (
            <>
              {cliRow !== null ? <Card machine={machine} tools={tools} rows={[cliRow]} /> : null}
              <Card machine={machine} tools={tools} heading={copy.skills} rows={skillRows} />
            </>
          )}
          {managed?.error != null ? (
            <Notice text={managed.error} busy={reading} onRetry={retry} />
          ) : (
            <>
              {desktopRows.length === 0 && managed?.data != null ? (
                // A Ghostex from before Desktop control could be installed from another device.
                <>
                  <Text style={formStyles.fieldHint}>{copy.desktopControl}</Text>
                  <Notice text={tooOldMessage(computer)} busy={false} />
                </>
              ) : (
                <Card machine={machine} tools={tools} heading={copy.desktopControl} rows={desktopRows} />
              )}
              <Card machine={machine} tools={tools} heading={copy.tools} rows={toolRows} />
            </>
          )}
        </>
      )}
    </>
  );
}

const modeStyles = StyleSheet.create({
  rowWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modeBlock: {
    paddingBottom: 10,
    gap: 6,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  modeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legacyDotButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legacyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legacyTooltip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  legacyTooltipText: {
    fontSize: 12,
    lineHeight: 16.5,
  },
  modeLabel: {
    fontSize: 12.5,
  },
  segmentTrack: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  segmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '500',
  },
  segmentTextActive: {
    fontWeight: '600',
  },
});
