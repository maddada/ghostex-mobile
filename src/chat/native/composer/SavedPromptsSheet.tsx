/**
 * Saved prompts, the phone form of the desktop's Stashed Prompts modal that the chat box's Stash
 * button opens when the draft is empty (or on a right press; a long press here). It lists the
 * prompts stashed in this project and its worktrees, newest first; tapping one puts it in the chat
 * box the way desktop's Insert does (it replaces the draft), and the trash button deletes it.
 *
 * CDXC:SavedPrompts 2026-10-01 WHY:
 * The list comes through `session-chat-rpc listStashedPrompts` (the call the core already makes for
 * the Stash badge) and deletion through `ghostex saved-prompts delete`, whose allowlist has carried
 * it since the shared Saved Prompts page. Tags, editing and the Sent and Recovered tabs stay on the
 * desktop modal.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { shellQuote } from '../../../commands/ghostexCli';
import type { MachineConnectionTarget } from '../../../machines/credentials';
import { execRemoteCommand } from '../../../remote/commands';
import { sessionChatRpc } from '../../rust/transport';
import { Glyph } from './icons';
import { arr, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';

const DELETE_TIMEOUT_MS = 30_000;

type SavedPrompt = { promptId: string; content: string; sessionTitle: string; updatedAt: string };

type Stage = { kind: 'loading' } | { kind: 'ready'; prompts: SavedPrompt[] } | { kind: 'failed'; message: string };

function savedPrompts(result: unknown): SavedPrompt[] {
  return arr(obj(result)?.prompts)
    .map((row) => ({
      promptId: str(row, 'promptId'),
      content: str(row, 'content'),
      sessionTitle: str(row, 'sessionTitle'),
      updatedAt: str(row, 'updatedAt'),
    }))
    .filter((prompt) => prompt.promptId.length > 0 && prompt.content.trim().length > 0);
}

/** "5m ago", "3h ago", "2d ago", or the date. */
function age(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

export function SavedPromptsSheet({
  visible,
  machine,
  projectId,
  sessionId,
  onClose,
  onInsert,
  onChanged,
}: {
  visible: boolean;
  machine: MachineConnectionTarget;
  projectId: string;
  sessionId: string;
  onClose: () => void;
  /** Puts the prompt in the chat box. */
  onInsert: (content: string) => void;
  /** The stash changed (a delete), so the Stash badge re-reads its count. */
  onChanged: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    setStage({ kind: 'loading' });
    void sessionChatRpc(machine, 'listStashedPrompts', { projectId, sessionId, includeDelivered: false, includeRecovery: false }).then(
      (answer) => {
        if (answer.error === null) setStage({ kind: 'ready', prompts: savedPrompts(answer.result) });
        else setStage({ kind: 'failed', message: answer.error.message });
      }
    );
  }, [machine, projectId, sessionId]);

  useEffect(() => {
    if (visible) load();
  }, [load, visible]);

  const remove = useCallback(
    (prompt: SavedPrompt) => {
      setDeleting(prompt.promptId);
      const payload = shellQuote(JSON.stringify({ promptId: prompt.promptId }));
      execRemoteCommand(machine.id, `ghostex saved-prompts delete --payload-json ${payload} --json`, DELETE_TIMEOUT_MS)
        .then((result) => {
          if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'The prompt was not deleted.');
          setStage((current) =>
            current.kind === 'ready' ? { kind: 'ready', prompts: current.prompts.filter((row) => row.promptId !== prompt.promptId) } : current
          );
          onChanged();
        })
        .catch((error: unknown) => {
          Alert.alert('Delete failed', error instanceof Error ? error.message : 'The prompt was not deleted.');
        })
        .finally(() => setDeleting(null));
    },
    [machine.id, onChanged]
  );

  const confirmRemove = useCallback(
    (prompt: SavedPrompt) => {
      Alert.alert('Delete saved prompt?', prompt.content.slice(0, 160), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove(prompt) },
      ]);
    },
    [remove]
  );

  let body;
  if (stage.kind === 'loading') {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={P.muted} />
      </View>
    );
  } else if (stage.kind === 'failed') {
    body = (
      <View style={styles.centered}>
        <Text style={styles.error}>{stage.message}</Text>
        <Pressable onPress={load} accessibilityRole="button" style={({ pressed }) => [styles.retry, pressed && { backgroundColor: P.controlPressed }]}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  } else if (stage.prompts.length === 0) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.empty}>No saved prompts in this project. Type a prompt and tap Stash to keep it for later.</Text>
      </View>
    );
  } else {
    body = (
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {stage.prompts.map((prompt) => {
          const meta = [prompt.sessionTitle, age(prompt.updatedAt)].filter((part) => part.length > 0).join(' · ');
          return (
            <View key={prompt.promptId} style={styles.row}>
              <Pressable
                onPress={() => {
                  onInsert(prompt.content);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityHint="Puts this prompt in the chat box"
                style={({ pressed }) => [styles.rowBody, pressed && { backgroundColor: P.controlPressed }]}
              >
                <Text style={styles.content} numberOfLines={4}>
                  {prompt.content.trim()}
                </Text>
                {meta.length > 0 ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {meta}
                  </Text>
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => confirmRemove(prompt)}
                disabled={deleting !== null}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Delete saved prompt"
                style={({ pressed }) => [styles.delete, pressed && { backgroundColor: P.controlPressed }]}
              >
                {deleting === prompt.promptId ? <ActivityIndicator size="small" color={P.muted} /> : <Glyph name="trash" size={16} color={P.muted} />}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Saved prompts">
      {body}
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 32 },
  empty: { color: P.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { color: P.error, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: P.inputBorder },
  retryText: { color: P.menuForeground, fontSize: 14 },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, borderRadius: 12, borderWidth: 1, borderColor: P.menuBorder },
  rowBody: { flex: 1, minWidth: 0, gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  content: { color: P.menuForeground, fontSize: 14, lineHeight: 20 },
  meta: { color: P.muted, fontSize: 12 },
  delete: { width: 36, height: 36, margin: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
}));
