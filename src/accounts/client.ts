/**
 * A computer's Claude and Codex accounts and their sign-ins, for the phone's Accounts screen: gxserver's
 * `agentAccounts` on that computer, through the chat's own route (`sessionChatRpc`), as the usage pane reads it.
 *
 * A sign-in runs on the computer that keeps the account (`setupStart`), never on the phone: the phone only shows its
 * page link, its code box and its progress (`setupStatus`, polled), and types the code the browser shows into it
 * (`setupInput`). Every start says `fromAnotherDevice`, so the computer opens no browser of its own and a Codex
 * sign-in uses a one-time code (`userCode`) instead of a browser on that computer (server/src/accounts/setup.rs).
 *
 * CDXC:AgentProviders 2026-11-13 DECISION: User (Q2779 B, Q2780): another computer's accounts are managed from the
 * device the user holds; the phone gets the same flow as desktop Settings › Accounts with a computer switch, and the
 * chat panel's Reconnect opens it on the session's computer. A computer that can't be reached shows an honest line
 * instead of buttons that can't work (Q2781).
 *
 * SEE-ALSO: src/usage/client.ts, apps/desktop/src/app/window/settings_modal/tabs/accounts/connect.rs.
 */

import { sessionChatRpc } from '../chat/rust/transport';
import { wasmCoreBridge } from '../chat/rust/wasm-core/bridge';
import { arr, isTrue, obj, str } from '../chat/native/composer/json';
import type { MachineConnectionTarget } from '../machines/credentials';
import { buildUsageMeters, type UsageAccount } from '../usage/usageMeters';

/** This phone's sign-ins on a computer: gxserver shows and lets change only the jobs of the owner that started them. */
export const MOBILE_ACCOUNTS_OWNER = 'ghostex-mobile-accounts';
/** Reading every account's usage afresh can take a while (it asks Claude and Codex). */
const LIST_TIMEOUT_MS = 60_000;
const JOB_TIMEOUT_MS = 30_000;

export type AccountProvider = 'claude' | 'codex';
export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = ['claude', 'codex'];

/** What a request to the computer came back with: its answer, or why not (`unreachable`: it didn't get there). */
export type AccountsAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; unreachable: boolean; message: string };

/** One saved Claude or Codex account on the computer. */
export type ManagedAccount = UsageAccount & {
  /** gxserver's state: `ready`, `loginRequired`, `identityChanged`, `unavailable`, `disabled`… */
  readonly status: string;
  /** The saved login needs a new sign-in (anything but ready, except turned off), as desktop's `needs_sign_in`. */
  readonly needsSignIn: boolean;
  readonly disabled: boolean;
};

/** A sign-in as gxserver reports it (`setupJobs`). */
export type SignInJob = {
  readonly id: string;
  readonly provider: AccountProvider;
  /** `signingIn`, `saving`, `complete` or `failed`. */
  readonly status: string;
  readonly url: string;
  readonly output: string;
  /** A Codex device-code sign-in's one-time code. */
  readonly userCode: string;
  readonly error: string;
  /** The account it reconnects, or the account it added once complete. */
  readonly accountId: string;
  readonly acknowledged: boolean;
};

async function call(machine: MachineConnectionTarget, params: Record<string, unknown>, timeoutMs: number) {
  const answer = await sessionChatRpc(machine, 'agentAccounts', params, timeoutMs);
  if (answer.error !== null) {
    const code = answer.error.code;
    return {
      ok: false as const,
      unreachable: code === 'unreachable' || code === 'cloudBoxUnavailable' || code === 'cloudBoxAsleep',
      message: answer.error.message,
    };
  }
  return { ok: true as const, value: answer.result };
}

/** The computer's saved Claude and Codex accounts with their meters, turned-off ones last. */
export async function readManagedAccounts(
  machine: MachineConnectionTarget,
  refresh: boolean,
): Promise<AccountsAnswer<ManagedAccount[]>> {
  const answer = await call(machine, { operation: 'list', ...(refresh ? { refresh: true } : {}) }, LIST_TIMEOUT_MS);
  if (!answer.ok) return answer;
  const rows = arr(obj(answer.value)?.accounts).filter(
    (row) => ACCOUNT_PROVIDERS.includes(str(row, 'provider') as AccountProvider) && isTrue(row, 'registered'),
  );
  // The core projects the meters as the chat panel and the usage pane draw them; without it a row keeps its name.
  let meters = new Map<string, UsageAccount>();
  if (rows.length > 0) {
    try {
      const columns = await wasmCoreBridge.call({
        op: 'accountUsageColumns',
        args: [JSON.stringify({ accounts: rows }), Date.now()],
      });
      meters = new Map(buildUsageMeters({ accounts: rows }, columns).map((account) => [account.id, account]));
    } catch {
      // No chat core yet: names and states only.
    }
  }
  const accounts = rows.map((row): ManagedAccount => {
    const id = str(row, 'id');
    const name = str(row, 'name');
    const email = str(row, 'email');
    const status = str(row, 'status');
    const disabled = isTrue(row, 'userDisabled') || status === 'disabled';
    return {
      id,
      provider: str(row, 'provider') as AccountProvider,
      name,
      email: email === name ? '' : email,
      usageError: str(row, 'usageError'),
      meters: meters.get(id)?.meters ?? [],
      unavailable: (meters.get(id)?.meters.length ?? 0) === 0,
      status,
      disabled,
      needsSignIn: !disabled && status !== 'ready' && status !== 'loading' && status.length > 0,
    };
  });
  return { ok: true, value: [...accounts.filter((a) => !a.disabled), ...accounts.filter((a) => a.disabled)] };
}

function jobs(value: unknown): SignInJob[] {
  return arr(obj(value)?.setupJobs).map((job) => ({
    id: str(job, 'id'),
    provider: (str(job, 'provider') === 'codex' ? 'codex' : 'claude') as AccountProvider,
    status: str(job, 'status'),
    url: str(job, 'url'),
    output: str(job, 'output'),
    userCode: str(job, 'userCode'),
    error: str(job, 'error'),
    accountId: str(job, 'accountId'),
    acknowledged: isTrue(job, 'acknowledged'),
  }));
}

async function jobCall(machine: MachineConnectionTarget, params: Record<string, unknown>) {
  const answer = await call(machine, { owner: MOBILE_ACCOUNTS_OWNER, ...params }, JOB_TIMEOUT_MS);
  return answer.ok ? { ok: true as const, value: jobs(answer.value) } : answer;
}

/** Starts a sign-in on the computer: a new account of `provider`, or again for saved account `accountId`. */
export function startSignIn(machine: MachineConnectionTarget, provider: AccountProvider, accountId: string | null) {
  return jobCall(machine, {
    operation: 'setupStart',
    provider,
    shareHistory: true,
    fromAnotherDevice: true,
    ...(accountId !== null ? { accountId } : {}),
  });
}

export const readSignIns = (machine: MachineConnectionTarget) => jobCall(machine, { operation: 'setupStatus' });
export const sendSignInCode = (machine: MachineConnectionTarget, jobId: string, input: string) =>
  jobCall(machine, { operation: 'setupInput', jobId, input });
export const cancelSignIn = (machine: MachineConnectionTarget, jobId: string) =>
  jobCall(machine, { operation: 'setupCancel', jobId });
export const acknowledgeSignIn = (machine: MachineConnectionTarget, jobId: string) =>
  jobCall(machine, { operation: 'setupAcknowledge', jobId });

/** The login is asking for the code the browser shows (Claude's "Paste code here if prompted"), as desktop reads it. */
export function asksForCode(output: string): boolean {
  const text = output.toLowerCase();
  return (
    text.includes('paste code') ||
    text.includes('enter code') ||
    text.includes('authorization code') ||
    text.includes('paste the code')
  );
}

export function signInRunning(job: SignInJob): boolean {
  return job.status !== 'complete' && job.status !== 'failed';
}
