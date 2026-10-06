/**
 * One Find result in full: its agent, session title, project and last-active
 * time with the usage and model line, the whole prompt (selectable), and the
 * actions `gx f` offers on a result: Resume, Fork into another agent, Copy and
 * Star.
 *
 * Opening a result lands on the Terminal screen, exactly where the user would
 * have opened it from the sessions list: a session that already owns the
 * conversation is attached, otherwise the command gxserver resolved runs as a
 * quick terminal in the prompt's recorded folder (the daemon registers or reuses
 * the project there, which is what lets the phone open a conversation from a
 * folder it has never seen).
 */

import { useCallback, useEffect, useState } from 'react';
import { CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionSheet from '../components/common/ActionSheet';
import { CopyGlyph, GitForkGlyph, PlayGlyph, StarGlyph } from '../components/sessions/icons';
import { quickTerminalCommand } from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import { FindPromptsCopy } from '../copy';
import { formatLastActiveFull, formatPromptMetaLine } from '../find/findFormat';
import { useFindPromptsStore } from '../find/findPromptsStore';
import { FIND_STAR_COLOR } from '../find/findStyles';
import {
  FIND_PROMPT_FORK_AGENTS,
  resolveFindPromptLaunch,
  type FindPromptAgent,
  type FindPromptLaunchResult,
} from '../find/promptSearch';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useTerminalStore } from '../terminal/sessions';
import { GhostexRadii, GhostexStrokeWidth } from '../theme/palette';
import type { Appearance } from '../theme/useAppearance';
import { useAppearanceHeader } from './settings/useAppearanceHeader';

type Props = NativeStackScreenProps<RootStackParamList, 'FindPrompt'>;

type Status = { kind: 'error' | 'info'; message: string; detail?: string };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export default function FindPromptScreen({ navigation, route }: Props) {
  const { machineId, promptKey } = route.params;
  const appearance = useAppearanceHeader();
  const styles = createStyles(appearance);
  const insets = useSafeAreaInsets();
  const machine = useMachinesStore((state) => state.machines.find((candidate) => candidate.id === machineId));
  const row = useFindPromptsStore((state) => state.rows.find((candidate) => candidate.key === promptKey));
  const fullText = useFindPromptsStore((state) => state.fullText[promptKey]);
  const [forkOpen, setForkOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  // Rows carry a capped copy of long prompts; fetch the rest for reading and copying.
  useEffect(() => {
    if (machine !== undefined && row !== undefined) void useFindPromptsStore.getState().loadFullText(machine, row);
  }, [machine, row]);

  const openPlan = useCallback(
    async (plan: FindPromptLaunchResult) => {
      if (machine === undefined) return;
      if (plan.mode === 'focus') {
        const sessionKey = await useTerminalStore
          .getState()
          .attachSession(machine, { projectId: plan.projectId, sessionId: plan.sessionId });
        // Find and this screen give way to the Terminal, as if it had been opened from the sessions list.
        navigation.dispatch((state) =>
          CommonActions.reset({
            ...state,
            routes: [
              ...state.routes.slice(0, -2),
              { key: `Terminal-${Date.now()}`, name: 'Terminal', params: { machineId: machine.id, sessionKey } },
            ],
            index: state.routes.length - 2,
          }),
        );
        return;
      }
      await runGhostexCli(machine, quickTerminalCommand(plan.cwd, { command: plan.commandLine, title: plan.title }));
      navigation.pop(2);
    },
    [machine, navigation],
  );

  const launch = useCallback(
    async (action: 'fork' | 'resume', forkAgent?: FindPromptAgent) => {
      if (machine === undefined || busy) return;
      setBusy(true);
      setStatus(null);
      try {
        await openPlan(await resolveFindPromptLaunch(machine, promptKey, action, forkAgent));
      } catch (error) {
        setStatus({
          kind: 'error',
          message: action === 'fork' ? FindPromptsCopy.forkFailed : FindPromptsCopy.resumeFailed,
          detail: errorMessage(error),
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, machine, openPlan, promptKey],
  );

  if (machine === undefined || row === undefined) {
    return (
      <View style={styles.page}>
        <Text style={styles.gone}>{FindPromptsCopy.gone}</Text>
      </View>
    );
  }

  const text = fullText ?? row.text;
  const metaLine = formatPromptMetaLine(row.meta);
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setStatus({ kind: 'info', message: FindPromptsCopy.copied });
    } catch (error) {
      setStatus({ kind: 'error', message: FindPromptsCopy.copyFailed, detail: errorMessage(error) });
    }
  };

  return (
    <View style={[styles.page, { paddingBottom: insets.bottom }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerLine}>
          <Text style={[styles.agent, { color: row.agentColor || appearance.muted }]}>{row.agent}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {row.title}
          </Text>
        </View>
        <Text style={styles.meta} numberOfLines={2} ellipsizeMode="middle" selectable>
          {row.project.length > 0 ? row.project : FindPromptsCopy.noProject}
        </Text>
        <Text style={styles.meta}>
          {formatLastActiveFull(row.ts)}
          {metaLine.length > 0 ? ` ${metaLine}` : ''}
        </Text>
        <View style={styles.promptCard}>
          <Text style={styles.prompt} selectable>
            {text}
          </Text>
          {row.truncated && fullText === undefined ? (
            <ActivityIndicator style={styles.more} size="small" color={appearance.muted} />
          ) : null}
        </View>
      </ScrollView>

      {status !== null ? (
        <Text
          style={[styles.status, status.kind === 'error' ? styles.statusError : null]}
          numberOfLines={3}
          accessibilityRole="alert"
        >
          {status.message}
          {status.detail !== undefined ? <Text style={styles.statusDetail}> {status.detail}</Text> : null}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={({ pressed }) => [styles.primary, pressed || busy ? styles.primaryPressed : null]}
          onPress={() => void launch('resume')}
        >
          {busy ? (
            <ActivityIndicator size="small" color={appearance.background} />
          ) : (
            <PlayGlyph size={16} color={appearance.background} />
          )}
          <Text style={styles.primaryLabel}>{FindPromptsCopy.resume}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={({ pressed }) => [styles.secondary, pressed ? styles.secondaryPressed : null]}
          onPress={() => setForkOpen(true)}
        >
          <GitForkGlyph size={16} color={appearance.foreground} />
          <Text style={styles.secondaryLabel}>{FindPromptsCopy.fork}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondary, pressed ? styles.secondaryPressed : null]}
          onPress={() => void copy()}
        >
          <CopyGlyph size={16} color={appearance.foreground} />
          <Text style={styles.secondaryLabel}>{FindPromptsCopy.copy}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={row.favorite ? FindPromptsCopy.unfavorite : FindPromptsCopy.favorite}
          accessibilityState={{ selected: row.favorite }}
          style={({ pressed }) => [styles.secondary, pressed ? styles.secondaryPressed : null]}
          onPress={() => void useFindPromptsStore.getState().toggleFavorite(machine, row.key)}
        >
          <StarGlyph size={16} color={row.favorite ? FIND_STAR_COLOR : appearance.foreground} filled={row.favorite} />
          <Text style={styles.secondaryLabel}>{row.favorite ? FindPromptsCopy.starred : FindPromptsCopy.star}</Text>
        </Pressable>
      </View>

      <ActionSheet
        visible={forkOpen}
        title={FindPromptsCopy.forkTitle}
        items={FIND_PROMPT_FORK_AGENTS.map((agent, position) => ({
          key: agent,
          label: `${position + 1}  ${agent}`,
          onPress: () => {
            setForkOpen(false);
            void launch('fork', agent);
          },
        }))}
        onClose={() => setForkOpen(false)}
      />
    </View>
  );
}

const stylesByAppearance = new WeakMap<Appearance, ReturnType<typeof buildStyles>>();

function createStyles(appearance: Appearance) {
  let styles = stylesByAppearance.get(appearance);
  if (styles === undefined) {
    styles = buildStyles(appearance);
    stylesByAppearance.set(appearance, styles);
  }
  return styles;
}

function buildStyles(appearance: Appearance) {
  const button = {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: GhostexRadii.control,
  } as const;
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: appearance.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 14,
      gap: 6,
    },
    headerLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    agent: {
      fontSize: 14,
      fontWeight: '700',
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: appearance.foreground,
      fontSize: 15,
      fontWeight: '600',
    },
    meta: {
      color: appearance.muted,
      fontSize: 12,
    },
    promptCard: {
      marginTop: 8,
      padding: 12,
      borderRadius: GhostexRadii.card,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    prompt: {
      color: appearance.foreground,
      fontSize: 15,
      lineHeight: 23,
    },
    more: {
      marginTop: 8,
      alignSelf: 'flex-start',
    },
    status: {
      marginHorizontal: 14,
      marginBottom: 6,
      color: appearance.muted,
      fontSize: 12,
    },
    statusError: {
      color: '#ff8f8f',
    },
    statusDetail: {
      opacity: 0.7,
    },
    actions: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 10,
      borderTopWidth: GhostexStrokeWidth,
      borderTopColor: appearance.border,
    },
    primary: {
      ...button,
      flex: 1.4,
      backgroundColor: appearance.foreground,
    },
    primaryPressed: {
      opacity: 0.75,
    },
    primaryLabel: {
      color: appearance.background,
      fontSize: 14,
      fontWeight: '700',
    },
    secondary: {
      ...button,
      flex: 1,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    secondaryPressed: {
      backgroundColor: appearance.cardActive,
    },
    secondaryLabel: {
      color: appearance.foreground,
      fontSize: 13,
    },
    gone: {
      color: appearance.muted,
      fontSize: 15,
      textAlign: 'center',
      padding: 28,
    },
  });
}
