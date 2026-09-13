/**
 * React Native side of the Find webview bridge — the GUI for `gx f`.
 *
 * The Find page (built from the main repo's apps/mobile/views/find/find-prompts-main.tsx
 * into src/find/find-prompts-html.generated.ts) posts `{ id, op, params }`
 * requests via window.ReactNativeWebView.postMessage and expects
 * `{ id, ok, result?, error? }` responses through
 * `window.ghostexMobileFindDeliver`. This module maps each op onto the matching
 * `ghostex` CLI verb over the machine's SSH channel — the phone has no HTTP
 * path to gxserver, and keeping RN a dumb verb runner leaves all Find behavior
 * (ranking, paging, hotkeys, UI) in the shared page code.
 *
 * Host-owned ops (`focusSession`, `launchSession`, `copyText`, `close`) are not
 * CLI verbs: they change what the app is showing, so the screen handles them.
 */

import * as Clipboard from 'expo-clipboard';

import {
  readAgentPromptTextCommand,
  resolveAgentPromptLaunchCommand,
  searchAgentPromptsCommand,
  toggleAgentPromptFavoriteCommand,
} from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import type { MachineConnectionTarget } from '../machines/credentials';

export type FindPromptsBridgeRequest = {
  id: number;
  op:
    | 'close'
    | 'copyText'
    | 'focusSession'
    | 'launchSession'
    | 'readText'
    | 'resolveLaunch'
    | 'search'
    | 'toggleFavorite';
  params?: Record<string, unknown>;
};

export type FindPromptsBridgeResponse = {
  error?: string;
  id: number;
  ok: boolean;
  result?: unknown;
};

/** What the screen must act on itself, because it changes the app's own state. */
export type FindPromptsHostAction =
  | { type: 'close' }
  | { type: 'focusSession'; projectId: string; sessionId: string }
  | {
      type: 'launchSession';
      agent: string;
      command: string;
      cwd: string;
      cwdExists: boolean;
      title: string;
    };

/**
 * A cold search walks every agent history store on the machine and rebuilds the
 * Codex derived cache, so the first call can run for tens of seconds; warm
 * searches answer in well under a second.
 */
const FIND_SEARCH_TIMEOUT_MS = 60000;
/** Key-addressed reads and toggles are single index lookups. */
const FIND_ACTION_TIMEOUT_MS = 20000;

export function parseFindPromptsBridgeRequest(raw: string): FindPromptsBridgeRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== 'number') return null;
  if (
    record.op !== 'close' &&
    record.op !== 'copyText' &&
    record.op !== 'focusSession' &&
    record.op !== 'launchSession' &&
    record.op !== 'readText' &&
    record.op !== 'resolveLaunch' &&
    record.op !== 'search' &&
    record.op !== 'toggleFavorite'
  ) {
    return null;
  }
  const params =
    typeof record.params === 'object' && record.params !== null && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : {};
  return { id: record.id, op: record.op, params };
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function booleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === 'boolean' ? value : undefined;
}

function agentsParam(params: Record<string, unknown>): string[] | undefined {
  const value = params.agents;
  if (!Array.isArray(value)) return undefined;
  const agents = value.filter((entry): entry is string => typeof entry === 'string');
  return agents.length > 0 ? agents : undefined;
}

function requiredKey(params: Record<string, unknown>): string {
  const key = stringParam(params, 'key');
  if (key === undefined) throw new Error('This result no longer has a prompt key.');
  return key;
}

/**
 * Turns a page request into either a CLI round trip or a host action. Returning
 * the action rather than performing it keeps this module free of navigation and
 * screen state.
 *
 * CDXC:PromptSearch 2026-09-13 WHY:
 * The CLI prints each Find payload directly, without a nested `result` field.
 * Reading `json.result` discarded successful replies and made search fail on `.rows`.
 */
export async function runFindPromptsBridgeRequest(
  machine: MachineConnectionTarget,
  request: FindPromptsBridgeRequest,
): Promise<{ hostAction?: FindPromptsHostAction; response: FindPromptsBridgeResponse }> {
  const params = request.params ?? {};
  try {
    switch (request.op) {
      case 'search': {
        const result = await runGhostexCli(
          machine,
          searchAgentPromptsCommand({
            agents: agentsParam(params),
            groupByDay: booleanParam(params, 'groupByDay'),
            includeFacets: booleanParam(params, 'includeFacets'),
            limit: numberParam(params, 'limit'),
            offset: numberParam(params, 'offset'),
            project: stringParam(params, 'project'),
            query: stringParam(params, 'query') ?? '',
            refresh: booleanParam(params, 'refresh'),
            textLimit: numberParam(params, 'textLimit'),
          }),
          { timeoutMs: FIND_SEARCH_TIMEOUT_MS },
        );
        return { response: { id: request.id, ok: true, result: result.json } };
      }
      case 'readText': {
        const result = await runGhostexCli(
          machine,
          readAgentPromptTextCommand(requiredKey(params)),
          { timeoutMs: FIND_ACTION_TIMEOUT_MS },
        );
        return { response: { id: request.id, ok: true, result: result.json } };
      }
      case 'toggleFavorite': {
        const result = await runGhostexCli(
          machine,
          toggleAgentPromptFavoriteCommand(requiredKey(params), booleanParam(params, 'favorite')),
          { timeoutMs: FIND_ACTION_TIMEOUT_MS },
        );
        return { response: { id: request.id, ok: true, result: result.json } };
      }
      case 'resolveLaunch': {
        const action = stringParam(params, 'action') === 'fork' ? 'fork' : 'resume';
        const result = await runGhostexCli(
          machine,
          resolveAgentPromptLaunchCommand(
            requiredKey(params),
            action,
            stringParam(params, 'forkAgent'),
          ),
          { timeoutMs: FIND_ACTION_TIMEOUT_MS },
        );
        return { response: { id: request.id, ok: true, result: result.json } };
      }
      case 'copyText': {
        await Clipboard.setStringAsync(stringParam(params, 'text') ?? '');
        return { response: { id: request.id, ok: true } };
      }
      case 'focusSession': {
        const projectId = stringParam(params, 'projectId');
        const sessionId = stringParam(params, 'sessionId');
        if (projectId === undefined || sessionId === undefined) {
          throw new Error('That session is missing its project or session id.');
        }
        return {
          hostAction: { projectId, sessionId, type: 'focusSession' },
          response: { id: request.id, ok: true },
        };
      }
      case 'launchSession': {
        const command = stringParam(params, 'command');
        const cwd = stringParam(params, 'cwd');
        if (command === undefined || cwd === undefined) {
          throw new Error('That prompt did not resolve to a runnable command.');
        }
        return {
          hostAction: {
            agent: stringParam(params, 'agent') ?? '',
            command,
            cwd,
            cwdExists: booleanParam(params, 'cwdExists') ?? false,
            title: stringParam(params, 'title') ?? '',
            type: 'launchSession',
          },
          response: { id: request.id, ok: true },
        };
      }
      case 'close': {
        return { hostAction: { type: 'close' }, response: { id: request.id, ok: true } };
      }
    }
  } catch (error) {
    return {
      response: {
        error: error instanceof Error ? error.message : String(error),
        id: request.id,
        ok: false,
      },
    };
  }
}
