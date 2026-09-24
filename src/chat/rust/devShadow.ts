/**
 * Development-only: run the Rust chat core for the chat the WebView is showing and log what it
 * publishes, without drawing anything. Turned on by Settings > Chat > "Rust chat engine (preview)",
 * which only development builds show. The log carries counts and states, never chat text.
 */

import { useEffect, useRef } from 'react';

import type { MachineConnectionTarget } from '../../machines/credentials';
import { useSettingsStore } from '../../settings/store';
import { useRustChat } from './useRustChat';

export function useRustChatDevShadow(machine: MachineConnectionTarget, projectId: string, sessionId: string): void {
  const enabled = useSettingsStore((store) => __DEV__ && store.settings.sessionChatRustEngine);
  const chat = useRustChat(enabled ? { machine, projectId, sessionId } : null);
  const logged = useRef({ frames: -1, status: '' });
  const state = chat.state;

  useEffect(() => {
    if (state === null) return;
    const { framesPublished } = state.stats;
    if (framesPublished === logged.current.frames && state.status === logged.current.status) return;
    logged.current = { frames: framesPublished, status: state.status };
    const document = state.document;
    console.log(
      `[rust-chat] ${sessionId} status=${state.status} frames=${framesPublished} revision=${state.revision}` +
        ` items=${state.items.length} view=${document?.view.kind ?? '-'} chatStatus=${document?.status ?? '-'}` +
        ` working=${document?.working ?? '-'} queue=${document?.queue.prompts.length ?? '-'}` +
        ` composerReady=${state.composer.ready} rpcs=${state.stats.rpcsSent}/${state.stats.rpcsRefused}` +
        ` unknownEffects=${state.stats.unknownEffects}${state.error !== null ? ` error="${state.error}"` : ''}`
    );
  }, [sessionId, state]);

  useEffect(
    () =>
      chat.onViewRequest((request) => {
        console.log(`[rust-chat] ${sessionId} view request ${request.kind}${request.kind === 'hostAction' ? `:${request.action}` : ''}`);
      }),
    [chat.onViewRequest, sessionId]
  );
}
