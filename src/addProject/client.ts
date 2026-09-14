import { execRemoteCommand } from '../remote/commands';
/**
 * Add Project transport: the four gxserver reads/writes the flow needs, run as
 * Ghostex CLI verbs over the machine's existing SSH connection.
 *
 * This does not reuse `components/sessions/cli.ts::runGhostexCli` because the
 * Add Project verbs need three things the session runner deliberately does not
 * have: per-command exec timeouts (a clone outlives the 20s inventory budget),
 * the parsed JSON payload even when the CLI exits non-zero (a failed clone job
 * exits 1 while the RPC itself succeeded, and the real reason lives in
 * `job.error`), and structured error strings surfaced verbatim to the inline
 * error banners instead of a truncated blob of stdout.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import {
  addProjectCommand,
  browseDirectoriesCommand,
  cloneRepositoryCommand,
  discoverSourceControlCommand,
  lookupRepositoryCommand,
  type SourceControlLookupProvider,
} from '../commands/ghostexCli';
import { scanJsonObjects } from '../contract/mobileSummary';
import { FailureCopy } from '../copy';
import {
  ensureConnected,
  INVENTORY_EXEC_TIMEOUT_MS,
  isOutdatedMachineFailure,
  summarizeFailure,
} from '../inventory/client';
import { hasPassword, type MachineConnectionTarget } from '../machines/credentials';

/** Discovery probes are 5s each and the CLI's own RPC budget defaults to 15s. */
const DISCOVERY_RPC_TIMEOUT_MS = 30000;
const DISCOVERY_EXEC_TIMEOUT_MS = 45000;
const LOOKUP_RPC_TIMEOUT_MS = 30000;
const LOOKUP_EXEC_TIMEOUT_MS = 45000;
/** The clone job keeps running server-side if the CLI stops waiting. */
const CLONE_WAIT_TIMEOUT_MS = 240000;
const CLONE_EXEC_TIMEOUT_MS = 300000;

export type AddProjectProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops';
export type AddProjectSourceId = 'url' | AddProjectProviderId;

export type AddProjectProviderAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown';
export type AddProjectProviderStatus = 'available' | 'missing' | 'unsupported';

export type AddProjectProviderDiscovery = {
  provider: AddProjectProviderId;
  label: string;
  status: AddProjectProviderStatus;
  installHint: string;
  detail?: string;
  auth: { status: AddProjectProviderAuthStatus; detail?: string };
};

export type AddProjectSourceControlDiscovery = {
  providers: AddProjectProviderDiscovery[];
};

export type AddProjectBrowseEntry = { name: string; fullPath: string };

export type AddProjectBrowseResult = {
  /** Server-resolved absolute directory the entries live in. */
  parentPath: string;
  entries: AddProjectBrowseEntry[];
};

export type AddProjectRepositoryInfo = {
  provider: string;
  nameWithOwner: string;
  url: string;
  sshUrl: string;
};

export type AddProjectCloneResult = {
  /** Path the daemon registered the cloned project at. */
  projectPath: string;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstJsonObject(output: string): JsonObject | null {
  return scanJsonObjects<JsonObject>(output, (text, start) => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isObject(parsed)) return { done: true, result: parsed };
    } catch {
      // Login-shell banners can contain brace blocks; keep scanning.
    }
    return { done: false, nextIndex: start + 1 };
  });
}

/**
 * The most specific failure text a CLI JSON payload carries. A failed clone
 * reports through the job record while the envelope still says `ok: true`.
 * `message` is preferred over `error` at the envelope level because gxserver's
 * `error` is the machine-readable code ("notFound") and `message` is the
 * sentence meant for a person; the clone job record is the other way round.
 */
function structuredError(json: JsonObject | null): string | null {
  if (json === null) return null;
  const job = isObject(json.job) ? json.job : null;
  const candidates = [
    job === null ? '' : readString(job.error),
    job === null ? '' : readString(job.message),
    readString(json.message),
    readString(json.error),
  ];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

async function runAddProjectCli(
  machine: MachineConnectionTarget,
  command: string,
  timeoutMs: number
): Promise<JsonObject> {
  let output = '';
  let json: JsonObject | null = null;
  let failed = false;
  try {
    await ensureConnected(machine);
    const result = await execRemoteCommand(machine.id, command, timeoutMs);
    output = `${result.stdout}\n${result.stderr}`.trim();
    json = firstJsonObject(result.stdout);
    const ok = json === null || typeof json.ok !== 'boolean' || json.ok;
    failed = result.exitCode !== 0 || !ok;
  } catch (error) {
    output = error instanceof Error ? error.message : String(error);
    failed = true;
  }
  if (!failed && json !== null) return json;
  const structured = structuredError(json);
  if (structured !== null) {
    // `ghostex <unknown verb> --json` reports through the JSON envelope, and its
    // `error` carries the CLI's whole usage dump. That is an outdated machine,
    // not an error worth printing.
    throw new Error(isOutdatedMachineFailure(structured) ? FailureCopy.outdatedForFeature : structured);
  }
  const machineHasPassword = await hasPassword(machine.id);
  throw new Error(summarizeFailure(output, machineHasPassword));
}

function parseBrowseEntries(value: unknown): AddProjectBrowseEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: AddProjectBrowseEntry[] = [];
  for (const raw of value) {
    if (!isObject(raw)) continue;
    const name = readString(raw.name);
    const fullPath = readString(raw.fullPath);
    if (name.length === 0 || fullPath.length === 0) continue;
    entries.push({ name, fullPath });
  }
  return entries;
}

/** Directory suggestions for one directory query (no `cwd`, dirs only). */
export async function browseDirectories(
  machine: MachineConnectionTarget,
  partialPath: string
): Promise<AddProjectBrowseResult> {
  const json = await runAddProjectCli(machine, browseDirectoriesCommand(partialPath), INVENTORY_EXEC_TIMEOUT_MS);
  return {
    parentPath: readString(json.parentPath),
    entries: parseBrowseEntries(json.entries),
  };
}

const PROVIDER_IDS: readonly AddProjectProviderId[] = ['github', 'gitlab', 'bitbucket', 'azure-devops'];

function parseProviderDiscovery(value: unknown): AddProjectProviderDiscovery | null {
  if (!isObject(value)) return null;
  const provider = readString(value.provider) as AddProjectProviderId;
  if (!PROVIDER_IDS.includes(provider)) return null;
  const status = readString(value.status);
  const auth = isObject(value.auth) ? value.auth : null;
  const authStatus = auth === null ? '' : readString(auth.status);
  const authDetail = auth === null ? '' : readString(auth.detail);
  const detail = readString(value.detail);
  return {
    provider,
    label: readString(value.label),
    status: status === 'available' || status === 'missing' || status === 'unsupported' ? status : 'unsupported',
    installHint: readString(value.installHint),
    ...(detail.length > 0 ? { detail } : {}),
    auth: {
      status: authStatus === 'authenticated' || authStatus === 'unauthenticated' ? authStatus : 'unknown',
      ...(authDetail.length > 0 ? { detail: authDetail } : {}),
    },
  };
}

/** Which hosting CLIs this machine can clone with. */
export async function discoverSourceControl(
  machine: MachineConnectionTarget
): Promise<AddProjectSourceControlDiscovery> {
  const json = await runAddProjectCli(
    machine,
    discoverSourceControlCommand({ timeoutMs: DISCOVERY_RPC_TIMEOUT_MS }),
    DISCOVERY_EXEC_TIMEOUT_MS
  );
  const discovery = isObject(json.discovery) ? json.discovery : null;
  const rawProviders = discovery === null ? [] : discovery.providers;
  const providers: AddProjectProviderDiscovery[] = [];
  if (Array.isArray(rawProviders)) {
    for (const raw of rawProviders) {
      const parsed = parseProviderDiscovery(raw);
      if (parsed !== null) providers.push(parsed);
    }
  }
  return { providers };
}

/** Resolve `owner/repo` into clone URLs through the machine's gh/glab CLI. */
export async function lookupRepository(
  machine: MachineConnectionTarget,
  provider: SourceControlLookupProvider,
  repository: string
): Promise<AddProjectRepositoryInfo> {
  const json = await runAddProjectCli(
    machine,
    lookupRepositoryCommand(provider, repository, { timeoutMs: LOOKUP_RPC_TIMEOUT_MS }),
    LOOKUP_EXEC_TIMEOUT_MS
  );
  const raw = isObject(json.repository) ? json.repository : null;
  const sshUrl = raw === null ? '' : readString(raw.sshUrl);
  const url = raw === null ? '' : readString(raw.url);
  if (sshUrl.length === 0 && url.length === 0) {
    throw new Error('The machine returned no clone URL for this repository.');
  }
  return {
    provider: raw === null ? provider : readString(raw.provider),
    nameWithOwner: raw === null ? repository : readString(raw.nameWithOwner),
    url,
    sshUrl,
  };
}

/**
 * Clone into `destinationPath` and register the result as a project. The
 * daemon's clone job performs the registration itself, so there is no separate
 * add step afterwards.
 */
export async function cloneRepository(
  machine: MachineConnectionTarget,
  remoteUrl: string,
  destinationPath: string
): Promise<AddProjectCloneResult> {
  const json = await runAddProjectCli(
    machine,
    cloneRepositoryCommand(remoteUrl, destinationPath, {
      waitTimeoutMs: CLONE_WAIT_TIMEOUT_MS,
      timeoutMs: LOOKUP_RPC_TIMEOUT_MS,
    }),
    CLONE_EXEC_TIMEOUT_MS
  );
  if (json.waitTimedOut === true) {
    throw new Error('The clone is still running on the machine. Reopen the project list once it finishes.');
  }
  const job = isObject(json.job) ? json.job : null;
  const state = job === null ? '' : readString(job.state);
  if (job === null || state !== 'completed') {
    throw new Error(structuredError(json) ?? 'The clone did not finish.');
  }
  return { projectPath: readString(job.projectPath) };
}

/** Register a directory as a Ghostex project, creating it when asked. */
export async function addProjectPath(
  machine: MachineConnectionTarget,
  path: string,
  options: { createIfMissing: boolean }
): Promise<void> {
  await runAddProjectCli(
    machine,
    addProjectCommand(path, { createIfMissing: options.createIfMissing }),
    INVENTORY_EXEC_TIMEOUT_MS
  );
}
