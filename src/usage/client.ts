/**
 * Reads a computer's Claude and Codex accounts with their usage: gxserver's `agentAccounts` with `operation: "list"`,
 * the read behind Settings › Accounts on the computer, which needs no chat session (the chat's Accounts panel reads
 * the same answer with `operation: "session"`). It travels as the chat's own requests do (`sessionChatRpc`): over the
 * computer's warm link (`POST /api/agentAccounts`) or, on an older link, `ghostex session-chat-rpc agentAccounts`.
 * gxserver answers from its last reading while that is under two minutes old; `refresh` asks for a newer one, as the
 * Accounts panel's Refresh does.
 *
 * SEE-ALSO: server/src/accounts/endpoint.rs (`dispatch`, `state_value`), server/src/accounts/runtime.rs (`refresh`),
 * server/src/ghostex_cli/session_chat_rpc.rs (`SESSION_CHAT_RPC_METHODS`)
 */

import { sessionChatRpc } from '../chat/rust/transport';
import { wasmCoreBridge } from '../chat/rust/wasm-core/bridge';
import type { MachineConnectionTarget } from '../machines/credentials';
import { buildUsageMeters, type UsageAccount } from './usageMeters';

/** A computer reading every account's usage afresh can take a while (it asks Claude and Codex). */
const ACCOUNTS_TIMEOUT_MS = 60_000;

/** gxserver's `agentAccounts` answer as it came; throws the computer's or the route's sentence. */
export async function readAccountsAnswer(machine: MachineConnectionTarget, refresh: boolean): Promise<unknown> {
  const answer = await sessionChatRpc(
    machine,
    'agentAccounts',
    { operation: 'list', ...(refresh ? { refresh: true } : {}) },
    ACCOUNTS_TIMEOUT_MS,
  );
  if (answer.error !== null) throw new Error(answer.error.message);
  return answer.result;
}

/**
 * Reads one account's usage again now (`readUsageNow`): a Claude account off Claude Code's own usage screen on the
 * computer, a Codex account from its usage service; the next `list` then carries it. A computer whose gxserver
 * predates the operation refuses it, and the caller falls back to a fresh `list`.
 *
 * SEE-ALSO: server/src/accounts/usage_screen.rs (`read_now`)
 */
export async function readAccountUsageNow(machine: MachineConnectionTarget, accountId: string): Promise<void> {
  // The read starts Claude Code on the computer, so it gets longer than a list.
  const answer = await sessionChatRpc(machine, 'agentAccounts', { operation: 'readUsageNow', id: accountId }, 120_000);
  if (answer.error !== null) throw new Error(answer.error.message);
}

/** The accounts with core-projected meters at the time of the answer, for the usage pane. */
export async function readAccountUsage(machine: MachineConnectionTarget, refresh: boolean): Promise<UsageAccount[]> {
  const answer = await readAccountsAnswer(machine, refresh);
  const columns = await wasmCoreBridge.call({
    op: 'accountUsageColumns',
    args: [JSON.stringify(answer), Date.now()],
  });
  return buildUsageMeters(answer, columns);
}
