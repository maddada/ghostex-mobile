export function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function powershellCommand(script: string, interactive = false): string {
  let bytes = '';
  for (let index = 0; index < script.length; index += 1) {
    const unit = script.charCodeAt(index);
    bytes += String.fromCharCode(unit & 255, unit >>> 8);
  }
  return `powershell.exe -NoLogo ${interactive ? '' : '-NoProfile -NonInteractive '}-EncodedCommand ${btoa(bytes)}`;
}

export const powershellPrelude =
  "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; ";

export const windowsStorage = `
$gxData = Join-Path $env:LOCALAPPDATA 'Ghostex/Data'
$gxConfig = Join-Path $env:APPDATA 'Ghostex'
if ($env:GHOSTEX_HOME -and [IO.Path]::IsPathRooted($env:GHOSTEX_HOME)) {
  $gxData=$env:GHOSTEX_HOME
  $gxConfig=$env:GHOSTEX_HOME
}
`;

export const windowsEnvironmentProbe = `${powershellPrelude}${windowsStorage}
$settingsPath=Join-Path $gxConfig 'native-sidebar-settings.json'
$settings=$null
if (Test-Path -LiteralPath $settingsPath) { $settings=Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json }
$backend='powershell'
if ($settings.windowsTerminalBackend -eq 'wsl') { $backend='wsl' }
Write-Output ('__GHOSTEX_REMOTE_WINDOWS__' + (@{backend=$backend; distribution=$settings.windowsWslDistribution} | ConvertTo-Json -Compress))
`;

/**
 * CDXC:RemoteMachines 2026-09-14 WHY:
 * PowerShell 5.1 drops literal quotes when it marshals native argv. Construct
 * the Windows command line explicitly so JSON, empty values and Unicode
 * prompts survive unchanged, including when SSH uses cmd as its default shell.
 * Keep simple arguments unquoted: wsl.exe treats a quoted option name as the Linux command to run.
 */
export function windowsProcess(programExpression: string, argv: string[], interactive = false): string {
  return String.raw`
$gxArgs=@(${argv.map(powershellQuote).join(',')})
$gxQuoted=@($gxArgs | ForEach-Object {
  if ($_ -match '^[A-Za-z0-9_./:=+-]+$') { return $_ }
  $value=[regex]::Replace($_, '(\\*)"', '$1$1\"')
  $value=[regex]::Replace($value, '(\\+)$', '$1$1')
  '"'+$value+'"'
})
$gxStart=[Diagnostics.ProcessStartInfo]::new()
$gxStart.FileName=${programExpression}
$gxStart.Arguments=$gxQuoted -join ' '
$gxStart.UseShellExecute=$false
$gxStart.CreateNoWindow=$${interactive ? 'false' : 'true'}
${
  interactive
    ? ''
    : String.raw`$gxStart.RedirectStandardOutput=$true
$gxStart.RedirectStandardError=$true
$gxStart.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
$gxStart.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)`
}
$gxProcess=[Diagnostics.Process]::Start($gxStart)
${interactive ? '' : '$gxStdout=$gxProcess.StandardOutput.ReadToEndAsync(); $gxStderr=$gxProcess.StandardError.ReadToEndAsync()'}
$gxProcess.WaitForExit()
${interactive ? '' : '[Console]::Out.Write($gxStdout.Result); [Console]::Error.Write($gxStderr.Result)'}
exit $gxProcess.ExitCode
`;
}

export function windowsCliScript(argv: string[], interactive = false): string {
  return `${powershellPrelude}${windowsStorage}
$gxCandidates=@(
  (Join-Path $gxData 'gxserver/package/bin/ghostex.exe'),
  (Join-Path $env:ProgramFiles 'Ghostex/resources/native/ghostex.exe'),
  (Join-Path $env:USERPROFILE '.local/bin/ghostex.exe')
)
$gxCommand=Get-Command ghostex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($gxCommand) { $gxCandidates+= $gxCommand.Source }
$gxExe=$gxCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (!$gxExe) { throw 'Ghostex CLI not found. Install Ghostex on this Windows machine.' }
${windowsProcess('$gxExe', argv, interactive)}`;
}

/** Decode only the literal argv grammar emitted by the existing CLI builders. */
export function cliArguments(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let started = false;
  let quote: "'" | '"' | null = null;
  for (const character of command) {
    if (quote !== null) {
      if (character === quote) quote = null;
      else {
        if (quote === '"' && /[$`\\]/u.test(character)) throw new Error('Expected literal CLI arguments.');
        word += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      if (/[;&|<>$`\\()]/u.test(character)) throw new Error('Expected literal CLI arguments.');
      word += character;
      started = true;
    }
  }
  if (quote !== null) throw new Error('Unterminated CLI argument.');
  if (started) words.push(word);
  if (words.shift() !== 'ghostex') throw new Error('Expected a Ghostex CLI command.');
  return words;
}
