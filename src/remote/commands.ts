import { GhostexNative, type ExecResult } from '../../modules/ghostex-native/src';
import { isDemoMachineId } from '../demo/identity';
import { execDemoCommand } from '../demo/world';
import { loginShellCommand, shellQuote } from '../commands/ghostexCli';
import {
  cliArguments,
  powershellCommand,
  powershellPrelude,
  powershellQuote,
  readablePowerShellError,
  windowsCliScript,
  windowsEnvironmentProbe,
  windowsProcess,
} from './powershell';
import { noteLinkAnswer, trackLinkTransfer } from './linkActivity';

export type RemoteEnvironment = { kind: 'posix' } | { kind: 'powershell' } | { kind: 'wsl'; distribution: string };

export type RemoteScript = { posix: string; powershell: string };
const environments = new Map<string, Promise<RemoteEnvironment>>();
const resolved = new Map<string, RemoteEnvironment>();
const PROBE_TIMEOUT = 15000;

/** A command over the machine's connection; its answer proves the connection alive (`linkActivity.ts`). */
function exec(machineId: string, command: string, timeoutMs: number): Promise<ExecResult> {
  return noteLinkAnswer(machineId, GhostexNative.exec(machineId, command, timeoutMs));
}

function execWithInput(machineId: string, command: string, input: string, timeoutMs: number): Promise<ExecResult> {
  return noteLinkAnswer(machineId, GhostexNative.execWithInput(machineId, command, input, timeoutMs));
}

/** The longest an upload keeps a quiet link from being judged; a dead link fails it natively long before. */
const UPLOAD_TRANSFER_MAX_MS = 10 * 60_000;

/**
 * Uploads a phone file to `remotePath` over the machine's connection, as one heavy transfer: while it
 * runs, a quiet link is busy, not lost, so no liveness check tears the connection down under it.
 */
export function uploadOverLink(machineId: string, localPath: string, remotePath: string): Promise<void> {
  return trackLinkTransfer(machineId, UPLOAD_TRANSFER_MAX_MS, () =>
    GhostexNative.uploadFile(machineId, localPath, remotePath),
  );
}

export function forgetRemoteEnvironment(machineId: string): void {
  environments.delete(machineId);
  resolved.delete(machineId);
}

export function cachedRemoteEnvironment(machineId: string): RemoteEnvironment | undefined {
  return resolved.get(machineId);
}

/** Each connection pins its login environment, including the selected WSL distribution. */
export function remoteEnvironment(machineId: string): Promise<RemoteEnvironment> {
  const existing = environments.get(machineId);
  if (existing !== undefined) return existing;
  const request = probeEnvironment(machineId)
    .then((target) => {
      if (environments.get(machineId) === request) resolved.set(machineId, target);
      return target;
    })
    .catch((error: unknown) => {
      if (environments.get(machineId) === request) environments.delete(machineId);
      throw error;
    });
  environments.set(machineId, request);
  return request;
}

async function probeEnvironment(machineId: string): Promise<RemoteEnvironment> {
  // A direct SSH login inside WSL stays POSIX, even if Windows interop is available.
  const unix = await exec(machineId, "printf '__GHOSTEX_POSIX__'; uname -s", PROBE_TIMEOUT);
  if (unix.exitCode === 0 && /__GHOSTEX_POSIX__(Linux|Darwin)/u.test(unix.stdout)) return { kind: 'posix' };
  const windows = readableResult(await exec(machineId, powershellCommand(windowsEnvironmentProbe), PROBE_TIMEOUT));
  const line = windows.stdout.split(/\r?\n/u).find((value) => value.startsWith('__GHOSTEX_REMOTE_WINDOWS__'));
  if (windows.exitCode !== 0 || line === undefined) {
    throw new Error(windows.stderr.trim() || unix.stderr.trim() || 'Could not identify the remote SSH shell.');
  }
  const settings = JSON.parse(line.slice('__GHOSTEX_REMOTE_WINDOWS__'.length)) as {
    backend?: string;
    distribution?: string;
  };
  if (settings.backend !== 'wsl') return { kind: 'powershell' };
  const requested = settings.distribution?.trim();
  const argv = [
    ...(requested ? ['--distribution', requested] : []),
    '--exec',
    'sh',
    '-c',
    'printf "__GHOSTEX_WSL__%s\\n" "$WSL_DISTRO_NAME"',
  ];
  const wsl = readableResult(
    await exec(machineId, powershellCommand(powershellPrelude + windowsProcess("'wsl.exe'", argv)), PROBE_TIMEOUT),
  );
  const distribution = wsl.stdout
    .split(/\r?\n/u)
    .find((value) => value.startsWith('__GHOSTEX_WSL__'))
    ?.slice('__GHOSTEX_WSL__'.length)
    .trim();
  if (wsl.exitCode !== 0 || !distribution)
    throw new Error(wsl.stderr.trim() || 'Initialize the WSL distribution selected in Windows Ghostex settings.');
  return { kind: 'wsl', distribution };
}

function wslScript(target: Extract<RemoteEnvironment, { kind: 'wsl' }>, posix: string, interactive = false): string {
  return (
    powershellPrelude +
    windowsProcess(
      "'wsl.exe'",
      ['--distribution', target.distribution, '--exec', 'sh', '-c', loginShellCommand(posix)],
      interactive,
    )
  );
}

/** Windows exec scripts travel over stdin, avoiding OpenSSH's Windows command-line limit. */
async function execScript(machineId: string, script: string, timeoutMs: number): Promise<ExecResult> {
  const loader = powershellCommand(powershellPrelude + '& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))');
  return readableResult(await execWithInput(machineId, loader, script, timeoutMs));
}

function readableResult(result: ExecResult): ExecResult {
  return { ...result, stderr: readablePowerShellError(result.stderr) };
}

export async function execRemoteCommand(machineId: string, command: string, timeoutMs: number): Promise<ExecResult> {
  if (isDemoMachineId(machineId)) return execDemoCommand(command);
  const target = await remoteEnvironment(machineId);
  if (target.kind === 'posix') return exec(machineId, loginShellCommand(command), timeoutMs);
  return execScript(
    machineId,
    target.kind === 'powershell' ? windowsCliScript(cliArguments(command)) : wslScript(target, command),
    timeoutMs,
  );
}

export async function execRemoteScript(
  machineId: string,
  script: RemoteScript,
  timeoutMs: number,
): Promise<ExecResult> {
  if (isDemoMachineId(machineId)) return execDemoCommand(script.posix);
  const target = await remoteEnvironment(machineId);
  if (target.kind === 'posix') return exec(machineId, loginShellCommand(script.posix), timeoutMs);
  return execScript(
    machineId,
    target.kind === 'powershell' ? powershellPrelude + script.powershell : wslScript(target, script.posix),
    timeoutMs,
  );
}

export function terminalCommandFor(target: RemoteEnvironment, command: string): string {
  if (target.kind === 'posix') return loginShellCommand(command);
  return powershellCommand(
    target.kind === 'powershell' ? windowsCliScript(cliArguments(command), true) : wslScript(target, command, true),
    true,
  );
}

export async function remoteTerminalCommand(machineId: string, command: string): Promise<string> {
  return terminalCommandFor(await remoteEnvironment(machineId), command);
}

export async function remoteShellCommand(machineId: string, cwd?: string): Promise<string | null> {
  const target = await remoteEnvironment(machineId);
  if (target.kind === 'powershell') {
    const location = cwd ? `Set-Location -LiteralPath ${powershellQuote(cwd)}; ` : '';
    return powershellCommand(
      powershellPrelude +
        "$gxShell=Join-Path $env:ProgramFiles 'PowerShell/7/pwsh.exe'; if (!(Test-Path -LiteralPath $gxShell)) { $gxShell='powershell.exe' }; " +
        location +
        windowsProcess('$gxShell', ['-NoLogo'], true),
      true,
    );
  }
  const script = `${cwd ? `cd ${shellQuote(cwd)} && ` : ''}exec "$SHELL" -l`;
  if (target.kind === 'posix') return cwd ? loginShellCommand(script) : null;
  return powershellCommand(wslScript(target, script, true), true);
}

/** SFTP terminates on Windows OpenSSH, so WSL paths need translation before upload. */
export async function remoteUploadPath(machineId: string, path: string): Promise<string> {
  const target = await remoteEnvironment(machineId);
  if (target.kind === 'posix') return path;
  if (target.kind === 'powershell') return path.replace(/\\/gu, '/');
  const result = await execScript(machineId, wslScript(target, `wslpath -w ${shellQuote(path)}`), PROBE_TIMEOUT);
  const translated = result.stdout.trim();
  if (result.exitCode !== 0 || !translated)
    throw new Error(result.stderr.trim() || 'Could not resolve the WSL upload path.');
  return translated.replace(/\\/gu, '/');
}
