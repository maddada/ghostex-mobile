/**
 * The usage pane's account identity and filtering. The chat core's `accountUsageColumns` returns
 * every account's columns in input order; this joins those rows before keeping the saved, enabled
 * Claude and Codex accounts. Window labels, percentages and reset times belong to the core.
 * The widget reuses those projected window names with the raw finite percent and absolute reset time.
 */

import { usageColumns, type UsageColumn } from '../chat/native/composer/accountUsage';
import { arr, isTrue, obj, str } from '../chat/native/composer/json';
import { UsageCopy } from '../copy';

/** The providers whose usage the app knows: Claude and Codex for now (OMP is a later host extension). */
const PROVIDERS = ['claude', 'codex'] as const;
export type UsageProvider = (typeof PROVIDERS)[number];

/** One account of the computer with its usage. */
export type UsageAccount = {
  readonly id: string;
  readonly provider: UsageProvider;
  readonly name: string;
  /** Shown beside the name, as the Accounts panel does; empty when absent or the same as the name. */
  readonly email: string;
  /** What the computer says about reading this account's usage; empty when nothing. */
  readonly usageError: string;
  /** One per usage window, in the answer's order. */
  readonly meters: readonly UsageColumn[];
  /** The login reports no usage window: the pane says "Usage is unavailable for this login." instead of bars. */
  readonly unavailable: boolean;
  /** The CLIProxyAPI hub the account is on (its name), or empty for a Claude Swap or Codex Swap account. */
  readonly hub: string;
};

/**
 * The answer with each CLIProxyAPI hub account (`cliproxyHubs[].accounts`, sent only while that extension is on and
 * the computer has the hub's management key) appended to `accounts` as a saved account, so the core projects its
 * meters like any other. A hub account whose login is also a saved Claude Swap or Codex Swap account here is left out:
 * the Swap one already shows it, as the computer's sidebar does (apps/desktop/src/app/titlebar/account_usage.rs
 * `distinct_accounts`); an unsaved or turned-off Swap login doesn't count. Hub accounts the hub turned off are left
 * out too.
 *
 * SEE-ALSO: server/src/accounts/hub/mod.rs (`rows`), server/src/accounts/hub/sidebar.rs.
 */
export function withHubAccounts(answer: unknown): unknown {
  const root = obj(answer);
  const hubs = arr(root?.cliproxyHubs);
  if (root === null || root === undefined || hubs.length === 0) return answer;
  const accounts = arr(root.accounts);
  // Only a Swap login saved here and not turned off stands in for its hub twin, matched by provider, email and,
  // when both name one, Codex workspace (gxserver's `swapLogins`; older computers: the saved accounts themselves).
  const saved = Array.isArray(root.swapLogins)
    ? arr(root.swapLogins)
    : accounts.filter((row) => isTrue(row, 'registered') && !isTrue(row, 'userDisabled'));
  const swapLogin = (provider: string, email: string, workspace: string) =>
    email.length > 0 &&
    saved.some((row) => {
      const theirs = str(row, 'workspace');
      return (
        str(row, 'provider') === provider &&
        str(row, 'email').toLowerCase() === email.toLowerCase() &&
        (theirs.length === 0 || workspace.length === 0 || theirs === workspace)
      );
    });
  const added: unknown[] = [];
  for (const hub of hubs) {
    for (const row of arr(obj(hub)?.accounts)) {
      const provider = str(row, 'provider');
      const name = str(row, 'name');
      const email = name.includes('@') ? name : '';
      if (!PROVIDERS.some((entry) => entry === provider) || str(row, 'status') === 'disabled') continue;
      if (swapLogin(provider, email, str(row, 'workspace'))) continue;
      // The hub's reason for an account it can't use, when there is no usage error to show.
      const reason = str(row, 'usageError') || (str(row, 'status') === 'error' ? str(row, 'statusMessage') : '');
      added.push({
        id: str(row, 'id'),
        provider,
        name,
        email: '',
        registered: true,
        status: 'ready',
        usage: arr(obj(row)?.usage),
        usageError: reason,
        hubLabel: str(hub, 'label'),
      });
    }
  }
  return added.length === 0 ? answer : { ...root, accounts: [...accounts, ...added] };
}

/**
 * The saved, enabled Claude and Codex accounts of an `agentAccounts` answer, in its order: the panel's own rule for
 * the accounts it offers, saved (`registered`) and not turned off (`userDisabled`).
 */
function savedAccounts(answer: unknown): { row: unknown; provider: UsageProvider; index: number }[] {
  const accounts: { row: unknown; provider: UsageProvider; index: number }[] = [];
  for (const [index, row] of arr(obj(answer)?.accounts).entries()) {
    const provider = PROVIDERS.find((entry) => entry === str(row, 'provider'));
    if (provider === undefined || !isTrue(row, 'registered') || isTrue(row, 'userDisabled')) continue;
    accounts.push({ row, provider, index });
  }
  return accounts;
}

/** Join by input position before filtering: the core includes rows with missing or duplicate account ids. */
export function buildUsageMeters(answer: unknown, columns: unknown): UsageAccount[] {
  const projected = arr(columns);
  return savedAccounts(answer).map(({ row, provider, index }) => {
    const name = str(row, 'name');
    const email = str(row, 'email');
    const meters = usageColumns(obj(projected[index])?.usage);
    return {
      id: str(row, 'id'),
      provider,
      name,
      email: email === name ? '' : email,
      usageError: str(row, 'usageError'),
      meters,
      unavailable: meters.length === 0,
      hub: str(row, 'hubLabel'),
    };
  });
}

/** One usage bar of the Home Screen widget (the snapshot's `usage.bars`). */
export type UsageBar = {
  readonly label: string;
  /** Within 0 to 100, as the pane's bar draws it. */
  readonly usedPercent: number;
  /** ISO time of the window's reset; absent when the computer gives none. */
  readonly resetsAt?: string;
};

/** The widget's limit (schema `maxItems`). */
export const MAX_USAGE_BARS = 6;

/**
 * The Home Screen widget's usage bars: the pane's accounts in the pane's order, one bar per usage window with the
 * pane's window name, the first six. A bar is named by its provider ("Claude 5h"), or by its account where the
 * computer has more than one account of that provider ("Work 5h"). A window without a readable percent gets no bar
 * rather than an empty one; the reset travels as a time, so the widget can count down to it.
 */
export function buildUsageBars(answer: unknown, columns: unknown): UsageBar[] {
  const accounts = savedAccounts(answer);
  const projected = arr(columns);
  const bars: UsageBar[] = [];
  for (const { row, provider, index } of accounts) {
    const shared = accounts.filter((account) => account.provider === provider).length > 1;
    const name = str(row, 'name');
    const owner = shared && name.length > 0 ? name : UsageCopy.provider[provider];
    for (const [windowIndex, window] of arr(obj(row)?.usage).entries()) {
      const used = obj(window)?.usedPercent;
      const label = str(arr(obj(projected[index])?.usage)[windowIndex], 'name');
      if (typeof used !== 'number' || !Number.isFinite(used) || label.length === 0) continue;
      const resetsAt = Date.parse(str(window, 'resetsAt'));
      bars.push({
        label: UsageCopy.widgetBar(owner, label),
        usedPercent: Math.min(100, Math.max(0, used)),
        ...(Number.isNaN(resetsAt) ? {} : { resetsAt: new Date(resetsAt).toISOString() }),
      });
      if (bars.length === MAX_USAGE_BARS) return bars;
    }
  }
  return bars;
}
